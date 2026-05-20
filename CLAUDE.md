# DDiary — Dhanam Workspace

## What This App Is

Internal workspace tool for Dhanam Investment and Finance. Combines a personal diary/journal, a collaborative task management system (personal tasks + shared kanban boards), and collaborative spreadsheets. Accessed at `https://dhanamdiary.web.app`.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + Vite, React Router v6, Tailwind CSS, @dnd-kit |
| Database | Firebase Firestore (NoSQL, real-time) |
| Auth | Firebase Auth with "Sign in with Microsoft" (M365 OAuth) |
| Hosting | Firebase Hosting (serves `dist/`) |
| Server-side functions | Firebase Cloud Functions v2 (Node.js) |
| Client-side email | Microsoft Graph API (uses user's M365 session token) |
| Server-side email | SendGrid (used by Cloud Functions for scheduled reminders) |
| File storage | SharePoint (Dhanam Legal Repository, via MS Graph) |
| People search | Microsoft Graph API (`/v1.0/users`) |

---

## Firebase Services in Use

**Firebase Hosting** — serves the Vite-built static SPA (`dist/`). Configured in `firebase.json` with SPA rewrite (`**` → `/index.html`), cache headers for assets.

**Firebase Firestore** — the entire data layer. Key collections:
- `users/{uid}/entries` — diary entries
- `users/{uid}/tasks/{taskId}` — personal tasks
- `users/{uid}/tasks/{taskId}/comments` — task comments
- `users/{uid}/tasks/{taskId}/activity` — task activity log
- `users/{uid}/tasks/{taskId}/reminders` — reminder schedules
- `users/{uid}/notifications` — in-app notification bell items
- `users/{uid}/sheets` — personal spreadsheets
- `workspaces/{wsId}` — shared kanban workspaces
- `workspaces/{wsId}/tasks/{taskId}` — workspace tasks
- `workspaces/{wsId}/members` — workspace members
- `workspaces/{wsId}/invites` — pending workspace invites
- `sharedDiaries/{shareId}` — shared diary sessions
- `sharedSheets/{shareId}` — shared spreadsheet sessions
- `teamMembers/{uid}` — org-wide user directory (for task assignment)

**Firebase Auth** — "Sign in with Microsoft" only (no email/password). The Microsoft OAuth flow is brokered by Firebase Auth, which is what yields the M365 access token (stored in `sessionStorage` as `ddiary_ms_access_token`) used for Graph API calls.

**Firebase Cloud Functions** (in `functions/index.js`):
- `sendTaskReminders` — runs every 5 minutes, checks tasks with `reminder.enabled=true` and `reminder.nextSendAt <= now`, sends via SendGrid
- `sendSheetRowReminders` — runs hourly, sends sheet row reminders via SendGrid
- `sendDailyReminders` — runs hourly, sends daily digest reminders via SendGrid
- `sendReminderNow` — callable function, sends a reminder immediately on demand
- `deleteWorkspace` — callable, hard-deletes a workspace and all subcollections
- `runDataMigration` — callable, admin utility for data migrations
- `resetReminders` — callable, admin utility
- `testEmail` — callable, tests SendGrid delivery

---

## Email Architecture (Two Systems)

### System 1: Client-side via Microsoft Graph API
Used for: task assignments, status changes, completions, comments, reassignments, "Email Now" button on task cards.

**How it works:** The signed-in user's M365 OAuth token (from Firebase Auth's Microsoft sign-in) is stored in `sessionStorage`. `emailNotifications.js` calls `https://graph.microsoft.com/v1.0/me/sendMail` directly from the browser using that token. Emails appear to come "from" the logged-in user's mailbox (e.g. `suren@dhanam.finance`).

**Token refresh:** `msTokenRefresh.js` handles silent refresh on 401 responses so long browser sessions don't fail.

**File:** `src/utils/emailNotifications.js` — exports: `notifyTaskAssigned`, `notifyStatusChanged`, `notifyTaskCompleted`, `notifyNewComment`, `notifyTaskReassigned`, `notifyTaskReminder`, `sendTaskEmailNow`, `notifyWorkspaceInvite`, `notifyShareDiary`, `notifyShareSheet`.

### System 2: Server-side via SendGrid (Cloud Functions)
Used for: scheduled/recurring task reminders — fires even when no user has the app open.

**How it works:** Firebase Cloud Functions query Firestore directly (admin SDK), compute which reminders are due, and send via SendGrid. SENDGRID_API_KEY is stored in Firebase Secret Manager.

**Important:** There is also a client-side fallback `useReminderDispatcher.js` that duplicates some of this logic for redundancy. The Cloud Function wins any race via a Firestore transaction lock (`reminder.nextSendAt`).

---

## Deep Link System

Email notification links use URL params to open the app at the right task:

- Personal task: `https://dhanamdiary.web.app/tasks?task=<taskId>`
- Workspace task: `https://dhanamdiary.web.app/tasks?task=<taskId>&wsId=<workspaceId>`

**Flow:** URL params → `TasksPage.jsx` reads and stores in `useState` → clears URL (no refresh loop) → routes to list view (personal) or board view (workspace) → passes `highlightTaskId` + `highlightWorkspaceId` down → matching `TaskCard` auto-expands + scrolls into view with purple glow ring → `onHighlightConsumed` clears state.

For workspace tasks, `KanbanBoard` accepts `highlightTaskId` and `highlightWorkspaceId` props, which feed into `DeepLinkContext`. `WorkspaceItem` reads `openWorkspaceId` from context and auto-expands.

In-app notification bell also navigates to `/tasks?task=<id>` (or with `&wsId=`) using `useNavigate`.

---

## Authentication Flow

1. User clicks "Sign in with Microsoft" → Firebase Auth triggers `microsoft.com` OAuth provider
2. Firebase Auth receives M365 tokens → stores Firebase session
3. App extracts the M365 access token from the Firebase credential result → stores in `sessionStorage` as `ddiary_ms_access_token`
4. That token is used for: Graph API email sending, SharePoint file access, people search
5. `msTokenRefresh.js` silently refreshes the token on 401

**Scopes requested:** `openid`, `profile`, `email`, `Sites.ReadWrite.All`, `User.Read.All`, `Mail.Send`, `ChannelMessage.Send`

---

## Key Source Files

```
src/
  firebase.js                    — Firebase + Microsoft OAuth provider init
  App.jsx                        — Router, auth gate, global state, notification listener
  components/
    Layout.jsx                   — Header, top nav, bottom mobile tabs, notification bell
    TasksPage.jsx                — Unified tasks page (Team Board + My Tasks toggle, deep link consumer)
    TaskManager/
      index.jsx                  — Personal task list with sections
      TaskCard.jsx               — Individual task card (highlight support, Email Now button)
      MoveToBoard.jsx            — Move personal task to a workspace
    KanbanBoard/
      index.jsx                  — Team Board (DnD, deep link via DeepLinkContext)
      WorkspaceItem.jsx          — Collapsible workspace card (auto-expand on deep link)
      WorkspaceBoardContent.jsx  — Kanban columns for one workspace
      CategoryBoard.jsx          — Category/subcategory grouping within a workspace
    TeamTaskView.jsx             — "Assigned to Me" list (tasks assigned by others)
    Dashboard.jsx                — Analytics dashboard + inline task add
    WorkspaceCollabPanel.jsx     — Task detail panel for workspace tasks (status, reassign, comments)
    NotificationBell.jsx         — In-app notification dropdown
    DiaryEditor/                 — Rich text diary editor (contentEditable, formatting toolbar)
    SpreadsheetGrid/             — Spreadsheet with formulas, sort, DnD reorder
  hooks/
    useTasks.js                  — Personal task CRUD + notifications + comments
    useWorkspace.js              — Workspace CRUD + task CRUD for workspace tasks
    useNotifications.js          — Firestore listener for notification bell
    useReminderDispatcher.js     — Client-side reminder send fallback (pairs with Cloud Functions)
    useTeamMembers.js            — Org user directory for task assignment autocomplete
  utils/
    emailNotifications.js        — All email templates + MS Graph sendMail calls
    msTokenRefresh.js            — Silent M365 token refresh on 401
    writeNotification.js         — Writes in-app notifications to Firestore
    graphPeopleSearch.js         — Searches org users via MS Graph /v1.0/users
    exportUtils.js               — Export to Excel (.xlsx) and PDF
    errorLogger.js               — Firestore error logging
  contexts/
    AuthContext.jsx              — useAuth hook, wraps Firebase Auth
    DeepLinkContext.jsx          — Passes openWorkspaceId/openTaskId through KanbanBoard tree
functions/
  index.js                       — All Cloud Functions (schedulers + callables)
```

---

## Environment Variables

Set in `.env` (frontend, never committed):
```
VITE_FIREBASE_API_KEY
VITE_FIREBASE_AUTH_DOMAIN
VITE_FIREBASE_PROJECT_ID
VITE_FIREBASE_STORAGE_BUCKET
VITE_FIREBASE_MESSAGING_SENDER_ID
VITE_FIREBASE_APP_ID
VITE_AZURE_TENANT_ID              # Microsoft tenant for Sign in with Microsoft
VITE_SHAREPOINT_DRIVE_ID          # SharePoint drive ID for file uploads
```

Cloud Functions secret (in Firebase Secret Manager, not in source):
```
SENDGRID_API_KEY                  # Set with: firebase functions:secrets:set SENDGRID_API_KEY
```

Cloud Functions env file (`functions/.env`):
```
SENDER_EMAIL=tech@dhanam.finance
```

---

## Development Workflow

```bash
# Install
npm install

# Dev server (localhost:5173)
npm run dev

# Production build (output to dist/)
npm run build

# Deploy hosting only (most common)
firebase deploy --only hosting

# Deploy Cloud Functions only
firebase deploy --only functions

# Deploy everything
firebase deploy
```

The Firebase project is `ddiary-a72ca`. Hosting target is `prod` (set in `.firebaserc`).

---

## User Roles

| Role | Access |
|---|---|
| Owner | Full app: Diary, Sheets, Tasks (personal + team board), Dashboard, Settings |
| Team Member (subordinate) | My Tasks only (tasks assigned to them by owner) |
| Collaborator (peer) | Shared workspace kanban only |
| Super Admin | Dashboard with global view across all users |

Role is determined by Firestore document fields checked in `App.jsx` on login.

---

## Notification System

Two parallel systems:
1. **In-app bell** — written to `users/{uid}/notifications` by `writeNotification.js` whenever a task is assigned/updated/commented. `useNotifications.js` listens in real time. `NotificationBell.jsx` renders the dropdown. Clicking navigates to `/tasks?task=<id>&wsId=<wsId>` if workspace task.
2. **Email** — sent via MS Graph (client-side) or SendGrid (Cloud Functions). All email functions are in `emailNotifications.js`. Every notification email includes a "View Task" deep link.

---

## Task Deep Link Reference

| Event | Email link format |
|---|---|
| Personal task assigned | `/tasks?task=<taskId>` |
| Workspace task assigned | `/tasks?task=<taskId>&wsId=<workspaceId>` |
| Task reassigned | `/tasks?task=<taskId>&wsId=<workspaceId>` |
| Status changed | `/tasks?task=<taskId>` |
| Task completed | `/tasks?task=<taskId>` |
| New comment | `/tasks?task=<taskId>` |
| Reminder | `/tasks?task=<taskId>` or `/tasks?task=<taskId>&wsId=<wsId>` (if workspace) |
| Notification bell click | same format, via `useNavigate` |

---

## Known Constraints / Watch Out For

- **Email requires M365 session** — client-side email only works when the user is logged in and has an active Microsoft token. If the token expires, `msTokenRefresh.js` silently refreshes; if that fails, the email is silently dropped (logged to console as a warning). Cloud Functions email (SendGrid) has no such constraint.
- **Firestore rules** — `firestore.rules` controls read/write access. Any new collection needs rules before it works in production.
- **`addWorkspaceTask` return value** — always returns the new task `DocumentReference`. Callers must capture it (`const newTaskRef = await addWorkspaceTask(...)`) to get `newTaskRef.id` for deep links in notification emails.
- **SPA routing** — Firebase Hosting has `"**" → "/index.html"` rewrite. Any static host replacement must also handle this or React Router 404s on direct URL access.
- **Cloud Functions service account** — uses `firebase-adminsdk-fbsvc@ddiary-a72ca.iam.gserviceaccount.com` explicitly. If the project changes, update the `SA` constant in `functions/index.js`.
- **`localStorage` key prefix** — `ddiary_*` is used throughout for persisted UI state (view toggles, expanded workspace state, etc.).

---

## Migration Plan: Firebase Hosting + SendGrid → AWS EC2 + SES

**Status: COMPLETE (2026-05-19).** Migration guide DOCX saved at `AWS_Migration_Guide.docx` in repo root.

### Decision

Moving from Firebase Hosting + Cloud Functions to Amazon EC2 to consolidate with existing Dhanam infrastructure. **Firebase Firestore and Firebase Auth are kept permanently** — only hosting and email delivery change.

### What Changes

| Component | Before | After |
|---|---|---|
| Static hosting | Firebase Hosting | nginx on EC2 |
| Scheduled reminders | Firebase Cloud Functions (scheduled) | node-cron on EC2 (PM2) |
| Task notification emails | MS Graph API (client-side, browser) | EC2 Express `/api/notify` endpoint → Amazon SES |
| Sheet row reminders | GitHub Actions + SendGrid | EC2 cron → Amazon SES |
| Admin callable functions | Firebase Cloud Functions | Kept or moved to EC2 admin scripts |

### What Stays Unchanged

- Firebase Firestore (all data)
- Firebase Auth + "Sign in with Microsoft" (M365 OAuth)
- MS Graph API for SharePoint file access and people search
- `msTokenRefresh.js` — still needed for SharePoint/people search tokens
- All React frontend code except `emailNotifications.js` `sendEmail()` internal function

### Architecture After Migration

```
Browser → nginx (EC2, port 443) → serves dist/ (SPA)
                                 → /api/* proxied to Express (port 3001, localhost only)
Express server:
  - POST /api/notify  — receives email payloads, sends via Amazon SES
  - Verifies Firebase ID token (Bearer) on every request
  - Firestore Admin SDK for reading data
node-cron jobs (same process or separate):
  - Every 5 min: task reminders (port of sendTaskReminders Cloud Function)
  - Every hour: sheet row reminders (port of sendSheetRowReminders)
  - Every hour: daily digest reminders (port of sendDailyReminders)
```

### Security Constraints (Non-Negotiable)

- Service account JSON: `chmod 600`, never committed to Git, never shared
- `.env` files: `chmod 600`, never committed
- Express port 3001: **localhost only**, never exposed to internet directly
- **IAM role on EC2 preferred** over static AWS access keys (avoids hardcoded credentials)
- `diary.dhanamfinance.com` must be added to Firebase Auth → Authorized Domains

### SES Pre-requisites Before Starting

1. Request SES production access (exits sandbox mode — sandbox only sends to verified addresses)
2. Verify `dhanam.finance` domain in SES: add DKIM CNAME records, SPF TXT record, DMARC TXT record
3. Add `diary.dhanamfinance.com` to Firebase Auth Authorized Domains (new hosting domain)

### Phase Summary

1. SES setup + domain verification
2. EC2 prep (Node, PM2, nginx, firewall)
3. Express server (`server.js`) with `/api/notify` + Firebase token auth
4. Port Cloud Function schedulers to `crons.js` (node-cron + SES)
5. Port GitHub Actions sheet reminders to `crons.js`
6. Frontend changes: `emailNotifications.js` → call `/api/notify` instead of MS Graph
7. Build `dist/`, copy to EC2, configure nginx SPA rewrite
8. Update `.firebaserc` / `firebase.json` (hosting only, keep Firestore rules deploy)
9. DNS cutover: `diary.dhanamfinance.com` → EC2 IP
10. Smoke test, then turn off Cloud Functions and GitHub Actions workflow

### Transition Safety

- Run EC2 crons and Cloud Functions **in parallel** for 1 week; Firestore transaction lock on `reminder.nextSendAt` prevents double-send
- Keep Cloud Functions deployed (just disabled) for 30 days as fallback
- Firebase Hosting can be kept live as backup until DNS fully propagates

### Frontend Change Required (Phase 6)

In `src/utils/emailNotifications.js`, replace the internal `sendEmail()` function:

```javascript
// BEFORE (MS Graph):
async function sendEmail({ to, subject, html }) {
  const token = sessionStorage.getItem('ddiary_ms_access_token');
  await fetch('https://graph.microsoft.com/v1.0/me/sendMail', {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: { subject, toRecipients: [...], body: { contentType: 'HTML', content: html } } })
  });
}

// AFTER (EC2 API):
async function sendEmail({ to, subject, html }) {
  const { auth } = await import('../firebase.js');
  const idToken = await auth.currentUser?.getIdToken();
  await fetch(`${EC2_API_URL}/api/notify`, {
    method: 'POST', headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ to, subject, html })
  });
}
```

Where `EC2_API_URL` = `https://diary.dhanamfinance.com` (same origin after migration, so just `''` or `window.location.origin`).

---

## EC2 Server Layout

All EC2 server files live in `~/ddiary-server/` on the instance and in `ec2/` in this repo:

```
ec2/
  server.js               — Express API on 127.0.0.1:3002, POST /api/notify → SES
  crons.js                — node-cron: task reminders (*/5), sheet reminders (hourly), daily digest (hourly)
  package.json            — dependencies: express, firebase-admin, @aws-sdk/client-ses, node-cron, dotenv
  ecosystem.config.js     — PM2 config for ddiary-server + ddiary-crons
  .env.template           — env var template (actual .env is on EC2, chmod 600, not committed)
  nginx-diary.dhanamfinance.com.conf — nginx server block (SPA + /api/ proxy)
```

**On EC2 (`ubuntu@15.206.55.165`):**
- App root: `/var/www/ddiary/` (React `dist/` deployed here)
- Server: `~/ddiary-server/` (server.js, crons.js, .env, service-account.json)
- nginx config: `/etc/nginx/sites-enabled/diary.dhanamfinance.com.conf`
- PM2 processes: `ddiary-server` (id 2), `ddiary-crons` (id 3)
- IAM role: `dhanam-finops-ses-role` (SES send permission, no hardcoded keys)
- SSL: Let's Encrypt via Certbot (auto-renews)

**Deploy new frontend build:**
```bash
npm run build
scp -i ~/tools/dhanam-finops.pem -r dist/* ubuntu@15.206.55.165:/var/www/ddiary/
```

**Restart server after changes:**
```bash
ssh -i ~/tools/dhanam-finops.pem ubuntu@15.206.55.165
pm2 restart ddiary-server   # or ddiary-crons
```

---

## Change History

| Date | Change | Files |
|---|---|---|
| 2026-05-19 | AWS EC2 migration complete — hosting moved to diary.dhanamfinance.com, email via SES, crons on EC2 | `ec2/server.js`, `ec2/crons.js`, `emailNotifications.js` |
| 2026-05-19 | Deep link fix: workspace task emails now include `&wsId=` param; `TasksPage` switches to board view when `wsId` present | `TasksPage.jsx`, `KanbanBoard/index.jsx`, `emailNotifications.js`, `WorkspaceBoardContent.jsx`, `WorkspaceCollabPanel.jsx`, `Dashboard.jsx`, `MoveToBoard.jsx`, `useTasks.js`, `useReminderDispatcher.js` |
| 2026-05-19 | Replaced all `noreply@dhanam.finance` with `tech@dhanam.finance` | `emailNotifications.js`, `functions/index.js`, `scripts/sendSheetRowReminders.js`, `.github/workflows/sheet-reminders.yml` |
| 2026-05-19 | AWS EC2 migration guide created | `AWS_Migration_Guide.docx` |
