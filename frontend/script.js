/**
 * PixCaption — Smart Photo Caption Generator
 * Frontend logic: upload handling, API calls, UI state management
 *
 * CONFIGURE: Set your Cloud Function URL below
 */

// ────────────────────────────────────────────
// CONFIG — Update this after deploying your function
// ────────────────────────────────────────────
const CLOUD_FUNCTION_URL = "YOUR_URL";
// Example: "https://us-central1-my-project-123.cloudfunctions.net/generateCaption"


// ────────────────────────────────────────────
// DOM Elements
// ────────────────────────────────────────────
const uploadZone   = document.getElementById("upload-zone");
const fileInput    = document.getElementById("file-input");
const browseBtn    = document.getElementById("browse-btn");
const uploadCard   = document.getElementById("upload-card");
const resultCard   = document.getElementById("result-card");
const previewImg   = document.getElementById("preview-img");
const captionText  = document.getElementById("caption-text");

const tagsContainer = document.getElementById("tags-container");
const hashtagsContainer = document.getElementById("hashtags-container"); // New
const captionTabs = document.querySelectorAll(".cap-tab"); // New

const cloudUrlText = document.getElementById("cloud-url-text");

const loadingState  = document.getElementById("loading-state");
const captionOutput = document.getElementById("caption-output");
const errorState    = document.getElementById("error-state");
const errorMsg      = document.getElementById("error-msg");

const copyBtn       = document.getElementById("copy-btn");
const regenerateBtn = document.getElementById("regenerate-btn");
const resetBtn      = document.getElementById("reset-btn");
const retryBtn      = document.getElementById("retry-btn");

const stepUpload  = document.getElementById("step-upload");
const stepVision  = document.getElementById("step-vision");
const stepCaption = document.getElementById("step-caption");

const fileName = document.getElementById("file-name");
const fileSize = document.getElementById("file-size");




// ────────────────────────────────────────────
// State
// ────────────────────────────────────────────
let currentFile = null;
let currentBase64 = null;
let currentCaptions = {}; // Store the multiple caption styles

// ────────────────────────────────────────────
// Upload Zone Events
// ────────────────────────────────────────────
browseBtn.addEventListener("click", () => fileInput.click());

uploadZone.addEventListener("click", (e) => {
  if (e.target !== browseBtn) fileInput.click();
});

fileInput.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (file) handleFile(file);
});

// Drag & Drop
uploadZone.addEventListener("dragover", (e) => {
  e.preventDefault();
  uploadZone.classList.add("drag-over");
});

uploadZone.addEventListener("dragleave", (e) => {
  if (!uploadZone.contains(e.relatedTarget)) {
    uploadZone.classList.remove("drag-over");
  }
});

uploadZone.addEventListener("drop", (e) => {
  e.preventDefault();
  uploadZone.classList.remove("drag-over");
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith("image/")) {
    handleFile(file);
  } else {
    showToast("Please drop an image file.");
  }
});


// ────────────────────────────────────────────
// File Handling
// ────────────────────────────────────────────
function handleFile(file) {
  // Validate
  if (!file.type.startsWith("image/")) {
    showToast("Only image files are supported.");
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    showToast("Image must be under 10 MB.");
    return;
  }

  currentFile = file;

  // Show preview immediately
  const reader = new FileReader();
  reader.onload = (e) => {
    const dataUrl = e.target.result;
    currentBase64 = dataUrl.split(",")[1]; // strip data:image/...;base64,

    // Update preview
    previewImg.src = dataUrl;
    fileName.textContent = truncateFilename(file.name, 24);
    fileSize.textContent = formatBytes(file.size);

    // Swap cards
    showResultCard();

    // Start API call
    generateCaption(currentBase64, file.type);
  };
  reader.readAsDataURL(file);
}

function truncateFilename(name, maxLen) {
  if (name.length <= maxLen) return name;
  const ext = name.split(".").pop();
  return name.substring(0, maxLen - ext.length - 4) + "…." + ext;
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}


// ────────────────────────────────────────────
// UI State Transitions
// ────────────────────────────────────────────
function showResultCard() {
  uploadCard.classList.add("hidden");
  resultCard.classList.remove("hidden");
  showLoading();
}

function showUploadCard() {
  resultCard.classList.add("hidden");
  uploadCard.classList.remove("hidden");
  // Reset file input
  fileInput.value = "";
  currentFile = null;
  currentBase64 = null;
}

function showLoading() {
  loadingState.classList.remove("hidden");
  captionOutput.classList.add("hidden");
  errorState.classList.add("hidden");
  resetLoadingSteps();
}

function showOutput(captions, altText, hashtags, tags, imageUrl) {
  loadingState.classList.add("hidden");
  errorState.classList.add("hidden");
  captionOutput.classList.remove("hidden");

  // Store globally so tabs can switch them
  currentCaptions = captions;
  
  // Set default caption (Descriptive) and reset tabs
  captionText.textContent = `"${captions.descriptive}"`;
  captionTabs.forEach(t => t.classList.remove("active"));
  document.querySelector('.cap-tab[data-key="descriptive"]').classList.add("active");

  // Helper to render pills
  const renderPills = (container, items, sectionId) => {
    container.innerHTML = "";
    if (items && items.length > 0) {
      items.forEach((item, i) => {
        const el = document.createElement("span");
        el.className = "tag";
        el.textContent = item;
        el.style.animationDelay = `${i * 50}ms`;
        container.appendChild(el);
      });
      document.getElementById(sectionId).classList.remove("hidden");
    } else {
      document.getElementById(sectionId).classList.add("hidden");
    }
  };

  // Render Hashtags & Tags
  renderPills(hashtagsContainer, hashtags, "hashtags-section");
  renderPills(tagsContainer, tags, "tags-section");

  // Cloud URL
  if (imageUrl) {
    cloudUrlText.textContent = "Stored in Google Cloud Storage ✓";
    cloudUrlText.title = imageUrl;
  }
}

function showError(message) {
  loadingState.classList.add("hidden");
  captionOutput.classList.add("hidden");
  errorState.classList.remove("hidden");
  errorMsg.textContent = message || "An unexpected error occurred. Please try again.";
}


// ────────────────────────────────────────────
// Loading Step Animator
// ────────────────────────────────────────────
let stepTimers = [];

function resetLoadingSteps() {
  stepTimers.forEach(clearTimeout);
  stepTimers = [];
  [stepUpload, stepVision, stepCaption].forEach(s => {
    s.classList.remove("active", "done");
  });
  stepUpload.classList.add("active");
}

function advanceStep(step) {
  switch (step) {
    case 1:
      stepUpload.classList.remove("active");
      stepUpload.classList.add("done");
      stepVision.classList.add("active");
      break;
    case 2:
      stepVision.classList.remove("active");
      stepVision.classList.add("done");
      stepCaption.classList.add("active");
      break;
    case 3:
      stepCaption.classList.remove("active");
      stepCaption.classList.add("done");
      break;
  }
}


// ────────────────────────────────────────────
// API Call — Cloud Function
// ────────────────────────────────────────────
async function generateCaption(base64Data, mimeType) {
  showLoading();

  // Simulate step progression while waiting
  const t1 = setTimeout(() => advanceStep(1), 800);
  const t2 = setTimeout(() => advanceStep(2), 2000);
  stepTimers = [t1, t2];

  try {
    const response = await fetch(CLOUD_FUNCTION_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image: base64Data,
        mimeType: mimeType || "image/jpeg",
      }),
    });

    stepTimers.forEach(clearTimeout);
    advanceStep(1);
    advanceStep(2);
    advanceStep(3);

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.error || `Server error: ${response.status}`);
    }

    const data = await response.json();

    // Short delay for UX polish
    await sleep(300);

    // ── SAFETY NET: Handle both old and new backend responses ──
    if (data.captions && data.captions.descriptive) {
      // It's the NEW backend format
      showOutput(data.captions, data.altText, data.hashtags, data.tags, data.imageUrl);
      
    } else if (data.caption) {
      // It's the OLD backend format! Wrap it nicely so the UI doesn't crash
      console.warn("Received old API format. Consider updating the Cloud Function.");
      
      const fallbackCaptions = {
        descriptive: data.caption,
        social: data.caption + " ✨",
        short: data.caption.split(".")[0] + "." // Just grab the first sentence
      };
      
      showOutput(
        fallbackCaptions, 
        "Image content.", 
        ["#photo", "#pixcaption"], 
        data.labels || [], 
        data.imageUrl
      );
      
    } else {
      throw new Error("Received an unrecognized response from the server.");
    }

  } catch (err) {
    stepTimers.forEach(clearTimeout);

    // Demo mode fallback updated to match new schema
    if (CLOUD_FUNCTION_URL.includes("YOUR_REGION") || err.message.includes("Failed to fetch")) {
      await sleep(2400);
      advanceStep(1); advanceStep(2); advanceStep(3);
      await sleep(300);
      showOutput(
        {
          descriptive: "A vivid photograph capturing a striking scene with rich detail.",
          social: "Absolutely loving the vibes in this shot! ✨📸",
          short: "Striking composition."
        },
        "A striking scene with rich detail.",
        ["#photography", "#nature", "#vibes"],
        ["Photography", "Nature", "Visual Arts", "Image", "Scene"],
        null
      );
      showToast("⚠ Demo mode — configure CLOUD_FUNCTION_URL in script.js");
      return;
    }

    showError(err.message);
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}


// ────────────────────────────────────────────
// Button Actions
// ────────────────────────────────────────────

// Copy caption
copyBtn.addEventListener("click", async () => {
  const text = captionText.textContent.replace(/^"|"$/g, ""); // strip quotes
  try {
    await navigator.clipboard.writeText(text);
    copyBtn.classList.add("copied");
    copyBtn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path d="M2 7l3.5 3.5L12 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      Copied!
    `;
    setTimeout(() => {
      copyBtn.classList.remove("copied");
      copyBtn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <rect x="1" y="4" width="9" height="9" rx="1.5" stroke="currentColor" stroke-width="1.3"/>
          <path d="M4 4V2.5A1.5 1.5 0 0 1 5.5 1H11.5A1.5 1.5 0 0 1 13 2.5V8.5A1.5 1.5 0 0 1 11.5 10H10" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
        </svg>
        Copy Caption
      `;
    }, 2000);
  } catch {
    showToast("Could not copy to clipboard.");
  }
});

// Regenerate (re-run on same image)
regenerateBtn.addEventListener("click", () => {
  if (currentBase64 && currentFile) {
    generateCaption(currentBase64, currentFile.type);
  }
});

// Caption Tab Switching
captionTabs.forEach(tab => {
  tab.addEventListener("click", (e) => {
    // 1. Remove the 'active' class from all tabs
    captionTabs.forEach(t => t.classList.remove("active"));
    
    // 2. Add the 'active' class to the specific tab that was clicked
    e.target.classList.add("active");
    
    // 3. Figure out which tab was clicked (descriptive, social, or short)
    const key = e.target.getAttribute("data-key");
    
    // 4. Update the text on the screen with the matching caption
    if (currentCaptions[key]) {
      captionText.textContent = `"${currentCaptions[key]}"`;
      
      // Small animation re-trigger for visual flair
      captionText.style.animation = 'none';
      captionText.offsetHeight; /* trigger reflow */
      captionText.style.animation = null; 
    }
  });
});

// Reset (new image)
resetBtn.addEventListener("click", showUploadCard);

// Retry on error
retryBtn.addEventListener("click", () => {
  if (currentBase64 && currentFile) {
    generateCaption(currentBase64, currentFile.type);
  } else {
    showUploadCard();
  }
});

// Paste image from clipboard
document.addEventListener("paste", (e) => {
  const items = e.clipboardData?.items;
  if (!items) return;
  for (const item of items) {
    if (item.type.startsWith("image/")) {
      const file = item.getAsFile();
      if (file) handleFile(file);
      break;
    }
  }
});


// ────────────────────────────────────────────
// About Modal
// ────────────────────────────────────────────
const aboutPill   = document.getElementById("about-pill");
const captionPill = document.querySelector(".pill.active");
const aboutModal  = document.getElementById("about-modal");
const modalClose  = document.getElementById("modal-close");

function openAbout() {
  aboutModal.classList.remove("hidden");
  document.body.style.overflow = "hidden";
  aboutPill.classList.add("active");
  document.querySelector('.pill:not(#about-pill)').classList.remove("active");
}

function closeAbout() {
  aboutModal.classList.add("hidden");
  document.body.style.overflow = "";
  aboutPill.classList.remove("active");
  document.querySelector('.pill:not(#about-pill)').classList.add("active");
}

aboutPill.addEventListener("click", openAbout);
modalClose.addEventListener("click", closeAbout);

// Close on backdrop click
aboutModal.addEventListener("click", (e) => {
  if (e.target === aboutModal) closeAbout();
});

// Close on Escape key
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !aboutModal.classList.contains("hidden")) closeAbout();
});


// ────────────────────────────────────────────
// Toast Notification
// ────────────────────────────────────────────
function showToast(message) {
  // Remove existing toast
  const existing = document.querySelector(".toast");
  if (existing) existing.remove();

  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  toast.style.cssText = `
    position: fixed;
    bottom: 32px;
    left: 50%;
    transform: translateX(-50%) translateY(16px);
    background: #1a1a1a;
    border: 1px solid rgba(212,166,80,0.3);
    color: #d4a650;
    font-family: 'DM Mono', monospace;
    font-size: 12px;
    font-weight: 300;
    padding: 10px 20px;
    border-radius: 100px;
    z-index: 9999;
    opacity: 0;
    transition: all 0.3s ease;
    white-space: nowrap;
    max-width: calc(100vw - 40px);
    text-align: center;
  `;
  document.body.appendChild(toast);

  requestAnimationFrame(() => {
    toast.style.opacity = "1";
    toast.style.transform = "translateX(-50%) translateY(0)";
  });

  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateX(-50%) translateY(8px)";
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}