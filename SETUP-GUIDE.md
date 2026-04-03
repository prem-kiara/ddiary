# Digital Diary — Setup & Deployment Guide

A cross-platform digital diary with handwriting support, OCR, task management, cloud sync, and email reminders. Works on iPad, iPhone, Mac, and Android.

---

## Quick Start (Local Development)

```bash
# 1. Install dependencies
npm install

# 2. Copy env file and add your Firebase config
cp .env.example .env
# Edit .env with your Firebase project credentials

# 3. Start dev server
npm run dev
# Opens at http://localhost:3000
```

---

## Firebase Setup (Cloud Sync + Auth + Email)

### Step 1: Create Firebase Project

1. Go to [Firebase Console](https://console.firebase.google.com)
2. Click "Create a project" → name it (e.g., `my-digital-diary`)
3. Enable Google Analytics if you want (optional)

### Step 2: Enable Services

In the Firebase Console for your project:

**Authentication:**
- Go to Authentication → Sign-in method
- Enable "Email/Password"

**Firestore Database:**
- Go to Firestore Database → Create database
- Start in **production mode**
- Choose your closest region (e.g., `asia-south1` for India)

**Storage:**
- Go to Storage → Get started
- Start in production mode

### Step 3: Get Config Credentials

1. Go to Project Settings (gear icon) → General
2. Scroll to "Your apps" → Click "Web" (</> icon)
3. Register app (name: `Digital Diary`)
4. Copy the `firebaseConfig` values into your `.env` file:

```env
VITE_FIREBASE_API_KEY=AIzaSy...
VITE_FIREBASE_AUTH_DOMAIN=my-digital-diary.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=my-digital-diary
VITE_FIREBASE_STORAGE_BUCKET=my-digital-diary.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=123456789
VITE_FIREBASE_APP_ID=1:123456789:web:abc123
```

### Step 4: Deploy Security Rules

```bash
# Install Firebase CLI
npm install -g firebase-tools

# Login
firebase login

# Initialize (select your project)
firebase init
# Choose: Firestore, Storage, Hosting, Functions

# Deploy rules
firebase deploy --only firestore:rules,storage
```

### Step 5: Deploy the App

```bash
# Build the frontend
npm run build

# Deploy everything
firebase deploy
```

Your app will be live at: `https://your-project-id.web.app`

---

## Email Reminders Setup

### Using SendGrid (Free tier: 100 emails/day)

1. Sign up at [sendgrid.com](https://sendgrid.com)
2. Create an API key (Settings → API Keys)
3. Verify a sender email (Settings → Sender Authentication)
4. Configure Firebase Functions:

```bash
cd functions
npm install

firebase functions:config:set sendgrid.key="SG.your-api-key"
firebase functions:config:set sendgrid.from="your-verified@email.com"

firebase deploy --only functions
```

The daily reminder runs at 9:00 AM IST by default. Change the timezone and schedule in `functions/index.js`.

---

## Install as App (PWA)

### iPad / iPhone (Safari)
1. Open your deployed URL in Safari
2. Tap the Share button (box with arrow)
3. Tap "Add to Home Screen"
4. Tap "Add"

### Mac (Chrome or Edge)
1. Open the URL in Chrome
2. Click the install icon in the address bar (or ⋮ → "Install Digital Diary")

### Android (Chrome)
1. Open the URL in Chrome
2. Tap the "Add to Home Screen" banner (or ⋮ → "Install app")

---

## Project Structure

```
digital-diary/
├── index.html                  # Entry HTML
├── package.json                # Dependencies
├── vite.config.js              # Vite + PWA config
├── firebase.json               # Firebase hosting config
├── firestore.rules             # Database security rules
├── storage.rules               # File storage security rules
├── .env.example                # Environment variables template
│
├── src/
│   ├── main.jsx                # App entry point
│   ├── App.jsx                 # Main app with page routing
│   ├── firebase.js             # Firebase initialization
│   │
│   ├── contexts/
│   │   └── AuthContext.jsx     # Authentication state & methods
│   │
│   ├── hooks/
│   │   └── useFirestore.js     # Diary entries & tasks CRUD hooks
│   │
│   ├── components/
│   │   ├── Auth.jsx            # Login / Signup / Password reset
│   │   ├── Layout.jsx          # Header + Navigation shell
│   │   ├── DiaryList.jsx       # Entry list view
│   │   ├── DiaryView.jsx       # Single entry reader
│   │   ├── DiaryEditor.jsx     # Create / edit entries
│   │   ├── DrawingCanvas.jsx   # Freehand drawing (Apple Pencil)
│   │   ├── ImageOCR.jsx        # Upload + handwriting recognition
│   │   ├── TaskManager.jsx     # Tasks with priorities & sorting
│   │   ├── Reminders.jsx       # Pending tasks & email reminders
│   │   ├── SettingsPage.jsx    # User settings & account
│   │   └── Toast.jsx           # Notification toasts
│   │
│   └── styles/
│       └── diary.css           # Complete warm paper-like theme
│
├── functions/
│   ├── package.json            # Cloud Functions dependencies
│   └── index.js                # Daily email reminders + welcome email
│
└── public/
    └── icons/
        ├── favicon.svg
        ├── icon-192.png
        └── icon-512.png
```

---

## Features Summary

| Feature | Status |
|---------|--------|
| Diary entries with rich text | ✅ |
| Freehand drawing canvas | ✅ |
| Apple Pencil / stylus support | ✅ |
| Upload handwritten notes | ✅ |
| OCR handwriting-to-text | ✅ |
| Task management with checkboxes | ✅ |
| Auto-sort (pending first, completed to back) | ✅ |
| Task priorities (high/medium/low) | ✅ |
| Due dates + overdue detection | ✅ |
| Email reminders (manual) | ✅ |
| Daily automated email reminders | ✅ |
| Welcome email for new users | ✅ |
| User authentication | ✅ |
| Cloud sync (Firebase Firestore) | ✅ |
| Drawing storage (Firebase Storage) | ✅ |
| Security rules | ✅ |
| PWA (installable on all devices) | ✅ |
| Offline support (service worker) | ✅ |
| Responsive design (mobile + tablet + desktop) | ✅ |
| Warm paper-like diary theme | ✅ |
| Mood tracking per entry | ✅ |

---

## Tech Stack

- **Frontend:** React 18, Vite, CSS (no framework — custom diary theme)
- **Backend:** Firebase (Auth, Firestore, Storage, Cloud Functions)
- **OCR:** Tesseract.js (runs in-browser, no server needed)
- **Email:** SendGrid (via Cloud Functions)
- **PWA:** Vite PWA Plugin + Workbox
