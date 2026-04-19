# PixCaption — AI Photo Caption Generator

A full-stack web app that transforms any image into expressive, ready-to-use captions using Google Cloud Vision AI. Upload a photo and get three caption styles — descriptive, social, and minimal — along with hashtags, detected labels, and accessibility alt-text.

---

## Features

- **Three caption styles** — Descriptive, Social, and Short/Minimal
- **Auto hashtag generation** from detected image content
- **Accessibility alt-text** for screen reader support
- **Detected labels** powered by Google Cloud Vision AI
- **Cloud Storage upload** — images stored securely in GCS
- **Drag & drop + clipboard paste** support
- **Demo mode** — works without a backend configured

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | HTML, CSS, Vanilla JS |
| Hosting | Firebase Hosting |
| Backend | Google Cloud Functions (Python) |
| Image Analysis | Google Cloud Vision AI |
| File Storage | Google Cloud Storage |

---

## Project Structure

```
CCL_PROJECT/
├── backend/
│   ├── main.py               # Cloud Function entry point
│   └── requirements.txt      # Python dependencies
├── frontend/
│   ├── index.html            # Main app UI
│   ├── style.css             # Styles
│   ├── script.js             # Frontend logic
│   ├── 404.html              # Custom error page
└── README.md
```

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (for Firebase CLI)
- [Python 3.10+](https://www.python.org/)
- [Google Cloud SDK](https://cloud.google.com/sdk)
- A Google Cloud project with **Vision API**, **Cloud Storage**, and **Cloud Functions** enabled
- Firebase CLI: `npm install -g firebase-tools`

---

### 1. Clone the repository

```bash
git clone https://github.com/YOUR_USERNAME/CCL_Project.git
cd CCL_Project
```

### 2. Set up the backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

### 3. Deploy the Cloud Function

```bash
gcloud functions deploy generateCaption \
  --runtime python311 \
  --trigger-http \
  --allow-unauthenticated \
  --region asia-south1 \
  --set-env-vars BUCKET_NAME=your-bucket-name
```

Copy the deployed function URL from the output.

### 4. Configure the frontend

Open `frontend/script.js` and update the Cloud Function URL:

```js
const CLOUD_FUNCTION_URL = "https://YOUR_REGION-YOUR_PROJECT.cloudfunctions.net/generateCaption";
```

### 5. Deploy to Firebase

```bash
cd frontend
firebase login
firebase deploy
```

---

## Environment Variables

The Cloud Function requires one environment variable set at deploy time:

| Variable | Description |
|---|---|
| `BUCKET_NAME` | Name of your Google Cloud Storage bucket |

---

## How It Works

1. User uploads an image via drag & drop, file picker, or clipboard paste
2. The image is sent as base64 to the Cloud Function
3. The function simultaneously uploads to **Cloud Storage** and runs **Vision AI** analysis
4. Vision AI returns labels, objects, web entities, and color properties
5. The function generates three caption styles, hashtags, and alt-text from the results
6. The frontend displays everything with tab switching between caption styles

---

## Local Development

Since this is a static frontend, you can run it locally with any simple server:

```bash
cd frontend
npx serve .
# or
python -m http.server 8000
```

For backend local testing:

```bash
cd backend
functions-framework --target generateCaption --debug
```

---

## License

MIT License — feel free to use and modify for your own projects.