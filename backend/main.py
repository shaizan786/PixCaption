"""
Smart Photo Caption Generator — Google Cloud Function
=====================================================
"""

import base64
import json
import os
import uuid
import random
from datetime import datetime
from typing import List
import concurrent.futures

import functions_framework
from google.cloud import storage, vision

# ── Global State (Optimizes Cold Starts) ──────────────────────────────────────
# Initialize clients globally so they are reused across function invocations.
# This saves significant time on warm starts.
VISION_CLIENT = vision.ImageAnnotatorClient()
STORAGE_CLIENT = storage.Client()
BUCKET_NAME = os.environ.get("BUCKET_NAME", "")

# ── Helpers ───────────────────────────────────────────────────────────────────

def cors_headers(origin: str = "*") -> dict:
    return {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "3600",
    }

def json_response(data: dict, status: int = 200) -> tuple:
    return (
        json.dumps(data),
        status,
        {**cors_headers(), "Content-Type": "application/json"},
    )

def error_response(message: str, status: int = 500) -> tuple:
    return json_response({"error": message}, status)

# ── Cloud Function Entry Point ────────────────────────────────────────────────

@functions_framework.http
def generateCaption(request):
    if request.method == "OPTIONS":
        return ("", 204, cors_headers())

    if request.method != "POST":
        return error_response("Method not allowed. Use POST.", 405)

    try:
        body = request.get_json(silent=True) or {}
        image_b64 = body.get("image")
        mime_type = body.get("mimeType", "image/jpeg")

        if not image_b64:
            return error_response("Missing required field: image (base64).", 400)

        # Faster stripping of data-URI prefix (avoids creating a list via split)
        prefix_idx = image_b64.find(",")
        if prefix_idx != -1:
            image_b64 = image_b64[prefix_idx + 1:]

        image_bytes = base64.b64decode(image_b64)
    except Exception as exc:
        return error_response(f"Failed to parse request or decode image: {exc}", 400)

    # Sanity check size (10 MB)
    if len(image_bytes) > 10 * 1024 * 1024:
        return error_response("Image exceeds 10 MB limit.", 413)

    image_url = None
    vision_response = None

    # ── Concurrent I/O Execution ──
    # Run Vision API and GCS Upload simultaneously to slash total execution time.
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
        future_vision = executor.submit(analyze_image, image_bytes)
        
        future_gcs = None
        if BUCKET_NAME:
            future_gcs = executor.submit(upload_to_gcs, image_bytes, mime_type, BUCKET_NAME)
        else:
            print("[WARN] BUCKET_NAME env var not set — skipping GCS upload.")

        # Gather GCS result
        if future_gcs:
            try:
                image_url = future_gcs.result()
            except Exception as exc:
                print(f"[WARN] GCS upload failed: {exc}")

        # Gather Vision result
        try:
            vision_response = future_vision.result()
        except Exception as exc:
            return error_response(f"Vision API error: {exc}", 502)

    # ── Build caption ──
    caption, labels = build_caption_and_labels(vision_response)
    # ── Build Rich AI Output ──
    ai_output = generate_rich_output(vision_response)
    
    # Merge image URL into the final response
    ai_output["imageUrl"] = image_url

    return json_response(ai_output)

# ── Upgraded AI Output Builder ────────────────────────────────────────────────

def generate_rich_output(response: vision.AnnotateImageResponse) -> dict:
    """
    Synthesises a rich metadata object from Vision API results, including
    multiple caption styles, hashtags, and accessibility alt-text.
    """
    # 1. Collect Signals
    labels = [lbl.description for lbl in response.label_annotations if lbl.score >= 0.65]
    objects = [obj.name for obj in response.localized_object_annotations if obj.score >= 0.60]
    
    web = response.web_detection
    best_guesses = [g.label for g in (web.best_guess_labels or [])]
    web_entities = [e.description for e in (web.web_entities or []) if e.score and e.score >= 0.5]

    color_adjectives = get_dominant_colors(response)

    # 2. Deduplicate & Prioritize
    ordered = list(dict.fromkeys(objects + labels + web_entities))
    top_tags = ordered[:8]
    
    # 3. Generate Hashtags
    # Remove spaces, make lowercase, ensure valid hashtag format
    hashtags = [f"#{tag.replace(' ', '').lower()}" for tag in top_tags[:5]]

    # 4. Generate Alt-Text (Factual & concise for screen readers)
    alt_text_elements = [best_guesses[0]] if best_guesses else []
    alt_text_elements.extend(objects[:2] if objects else labels[:2])
    alt_text = f"Image showing {_humanise_list(alt_text_elements)}."
    
    # 5. Generate Caption Variations
    captions = compose_caption_variations(
        best_guesses=best_guesses,
        objects=objects,
        labels=labels,
        web_entities=web_entities,
        color_adjectives=color_adjectives
    )

    return {
        "captions": captions,
        "altText": alt_text,
        "hashtags": hashtags,
        "tags": top_tags
    }

def compose_caption_variations(best_guesses: List[str], objects: List[str], labels: List[str], 
                               web_entities: List[str], color_adjectives: List[str]) -> dict:
    """
    Creates multiple styles of captions (Descriptive, Social, Short) 
    using contextual templates.
    """
    color_prefix = f"{random.choice(color_adjectives)}-toned " if color_adjectives else ""
    primary_obj = objects[0].lower() if objects else (labels[0].lower() if labels else "scene")
    subject = best_guesses[0] if best_guesses else primary_obj
    
    # Emojis based on generic themes
    emojis = ["✨", "📸", "👀", "🎨", "🌟"]
    if "green" in " ".join(color_adjectives) or "nature" in " ".join(labels).lower():
        emojis.extend(["🌿", "🍃", "🌲"])
    if "blue" in " ".join(color_adjectives) or "water" in " ".join(labels).lower():
        emojis.extend(["🌊", "💧", "🔵"])

    # -- 1. Descriptive Caption (Similar to your original, good for CMS/Blogs) --
    desc_templates = [
        f"A {color_prefix}photograph of {subject}, featuring {_humanise_list(objects[:3] or labels[:3])}.",
        f"This {color_prefix}image captures a {primary_obj} in a setting full of {_humanise_list(labels[1:3])}.",
        f"An evocative {color_prefix}composition focusing on {subject}."
    ]
    descriptive = random.choice(desc_templates)

    # -- 2. Social Media Caption (Engaging, conversational, uses emojis) --
    social_templates = [
        f"Loving the vibes in this {color_prefix}shot! {primary_obj} front and center. {random.choice(emojis)}",
        f"Can we take a moment to appreciate this {subject}? Beautiful {_humanise_list(labels[:2])} going on here. {random.choice(emojis)}",
        f"A perfect capture of a {primary_obj}. The details are amazing! {random.choice(emojis)}{random.choice(emojis)}"
    ]
    social = random.choice(social_templates)

    # -- 3. Short / Artistic Caption (Minimalist) --
    short_templates = [
        f"Focus on {primary_obj}.",
        f"{color_prefix.capitalize()}moods.",
        f"Glimpses of {subject}.",
        f"Simply {_humanise_list(labels[:1])}."
    ]
    short = random.choice(short_templates)

    # Capitalize the first letter of each
    return {
        "descriptive": descriptive[0].upper() + descriptive[1:],
        "social": social[0].upper() + social[1:],
        "short": short[0].upper() + short[1:]
    }
    
# ── GCS Upload ────────────────────────────────────────────────────────────────

def upload_to_gcs(image_bytes: bytes, mime_type: str, bucket_name: str) -> str:
    ext_map = {
        "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp",
        "image/gif": "gif", "image/bmp": "bmp",
    }
    ext = ext_map.get(mime_type, "jpg")
    date_prefix = datetime.utcnow().strftime("%Y/%m/%d")
    blob_name = f"uploads/{date_prefix}/{uuid.uuid4()}.{ext}"

    bucket = STORAGE_CLIENT.bucket(bucket_name)
    blob = bucket.blob(blob_name)

    blob.upload_from_string(image_bytes, content_type=mime_type)
    blob.make_public()

    return blob.public_url

# ── Vision API ────────────────────────────────────────────────────────────────

def analyze_image(image_bytes: bytes) -> vision.AnnotateImageResponse:
    image = vision.Image(content=image_bytes)

    # Removed SAFE_SEARCH_DETECTION to save processing time/costs as it wasn't used
    features = [
        vision.Feature(type_=vision.Feature.Type.LABEL_DETECTION, max_results=15),
        vision.Feature(type_=vision.Feature.Type.OBJECT_LOCALIZATION, max_results=10),
        vision.Feature(type_=vision.Feature.Type.WEB_DETECTION, max_results=5),
        vision.Feature(type_=vision.Feature.Type.IMAGE_PROPERTIES),
    ]

    response = VISION_CLIENT.annotate_image(
        vision.AnnotateImageRequest(image=image, features=features)
    )

    if response.error.message:
        raise RuntimeError(f"Vision API returned error: {response.error.message}")

    return response

# ── Caption Builder ───────────────────────────────────────────────────────────

def get_dominant_colors(response: vision.AnnotateImageResponse) -> List[str]:
    colors = []
    if response.image_properties_annotation and response.image_properties_annotation.dominant_colors:
        for color_info in response.image_properties_annotation.dominant_colors.colors[:2]:
            color = color_info.color
            r, g, b = color.red, color.green, color.blue
            if r > 200 and g > 200 and b > 200:   colors.append("bright")
            elif r < 50 and g < 50 and b < 50:     colors.append("dark")
            elif r > 150 and g < 100 and b < 100:  colors.append("warm red")
            elif r > 150 and g > 100 and b < 100:  colors.append("golden")
            elif r < 100 and g > 150 and b < 100:  colors.append("lush green")
            elif r < 100 and g < 100 and b > 150:  colors.append("cool blue")
            elif r > 150 and g > 150 and b < 100:  colors.append("yellow")
            elif r > 150 and g < 100 and b > 150:  colors.append("magenta")
            elif r < 100 and g > 150 and b > 150:  colors.append("teal")
            elif r > 200 and g > 200 and b < 150:  colors.append("warm beige")
            else:                                  colors.append("muted")
        
        # Deduplicate while preserving order (Python 3.7+ standard)
        return list(dict.fromkeys(colors))
    return []

def build_caption_and_labels(response: vision.AnnotateImageResponse) -> tuple[str, list]:
    labels = [lbl.description for lbl in response.label_annotations if lbl.score >= 0.65]
    objects = [obj.name for obj in response.localized_object_annotations if obj.score >= 0.60]
    
    web = response.web_detection
    best_guesses = [g.label for g in (web.best_guess_labels or [])]
    web_entities = [
        e.description for e in (web.web_entities or []) 
        if e.score and e.score >= 0.5 and e.description
    ]

    color_adjectives = get_dominant_colors(response)

    # ── Deduplicate & prioritise (Optimized) ──
    # dict.fromkeys is much faster and cleaner than a manual `seen` set loop
    ordered = list(dict.fromkeys(objects + labels + web_entities))
    top_labels = ordered[:8]

    caption = compose_caption(
        best_guesses=best_guesses,
        objects=objects,
        labels=labels,
        web_entities=web_entities,
        color_adjectives=color_adjectives
    )

    return caption, top_labels

def compose_caption(best_guesses: List[str], objects: List[str], labels: List[str], 
                    web_entities: List[str], color_adjectives: List[str]) -> str:
    # (Caption logic remains largely untouched as it is standard string formatting, 
    # but uses your existing robust template logic)
    
    color_prefix = f"{random.choice(color_adjectives)}-toned " if color_adjectives else ""

    all_terms = objects + labels + web_entities
    primary_obj = objects[0].lower() if objects else None
    secondary_objs = [o.lower() for o in objects[1:3]] if len(objects) > 1 else []
    top_labels_lower = [l.lower() for l in labels[:3]]
    web_term = web_entities[0].lower() if web_entities else None

    context_phrase = _humanise_list(top_labels_lower[:2]) if top_labels_lower else ""

    templates = []

    if best_guesses and objects:
        subject = best_guesses[0]
        templates.append(f"A {color_prefix}photograph of {subject}, featuring {_humanise_list(objects[:3])}.")
        if secondary_objs:
            templates.append(f"In this {color_prefix}shot, a {primary_obj} stands alongside {_humanise_list(secondary_objs)} — a scene reminiscent of {subject}.")

    if objects and labels:
        ctx = [l for l in labels[:4] if l.lower() != primary_obj]
        if ctx:
            templates.append(f"This {color_prefix}image captures a {primary_obj} in a setting full of {_humanise_list(ctx[:2])}.")
        if len(objects) >= 2:
            templates.append(f"A {color_prefix}composition featuring {_humanise_list([o.lower() for o in objects[:3]])}, with subtle hints of {_humanise_list(labels[:2])}.")
        else:
            templates.append(f"A {color_prefix}close-up of a {primary_obj}, radiating {_humanise_list(labels[:2])}.")

    if labels and not objects:
        top = labels[:4]
        templates.append(f"An evocative {color_prefix}image that brings to mind {_humanise_list([l.lower() for l in top[:3]])}.")
        templates.append(f"A {color_prefix}scene steeped in themes of {top[0].lower()} and {top[1].lower() if len(top)>1 else 'texture'}.")

    if web_entities and not objects:
        templates.append(f"A {color_prefix}photograph associated with {web_term}, captured with an artistic eye.")

    if all_terms:
        templates.append(f"This {color_prefix}image shows {_humanise_list(all_terms[:3])} in a beautifully composed frame.")

    if context_phrase:
        templates.append(f"A {color_prefix}moment that feels like {context_phrase} — quiet, yet full of story.")

    if not templates:
        templates.append("A visually compelling photograph with a rich and interesting composition.")

    caption = random.choice(templates)
    caption = caption[0].upper() + caption[1:]
    if not caption.endswith((".", "!", "?")):
        caption += "."

    return caption

def _humanise_list(items: list) -> str:
    items = [str(i) for i in items if i]
    if not items: return ""
    if len(items) == 1: return items[0]
    if len(items) == 2: return f"{items[0]} and {items[1]}"
    return f"{', '.join(items[:-1])}, and {items[-1]}"