# DDiary — Dhanam Workspace

## What This App Is

Internal workspace tool for Dhanam Investment and Finance. Combines a personal diary/journal, a collaborative task management system (personal tasks + shared kanban boards), and collaborative spreadsheets. Accessed at `https://diary.dhanamfinance.com` (EC2-hosted since 2026-05-19; legacy Firebase Hosting URL `https://dhanamdiary.web.app` still works as fallback).

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + Vite, React Router v6, Tailwind CSS, @dnd-kit |
| Database | Firebase Firestore (NoSQL, real-time) |
| Auth | Firebase Auth with "Sign in with Microsoft" (M365 OAuth) |
| Hosting | nginx on AWS EC2 (serves `dist/`) |
| Server-side functions | node-cron on EC2 (PM2) + Firebase Cloud Functions v2 (kept as fallback) |
| Client-side email | EC2 Express `/api/notify` → Amazon SES |
| Server-side email | EC2 crons → Amazon SES (replaces Firebase Cloud Functions + SendGrid) |
| File storage | SharePoint (Dhanam Legal Repository, via MS Graph) |
| People search | Microsoft Graph API (`/v1.0/users`) |

---

## Firebase Services in Use

**Firebase Hosting** — legacy; frontend now served by nginx on EC2. Firebase Hosting config kept in `firebase.json` as fallback only.

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

- Personal task: `https://diary.dhanamfinance.com/tasks?task=<taskId>`
- Workspace task: `https://diary.dhanamfinance.com/tasks?task=<taskId>&wsId=<workspaceId>`

**Flow:** URL params → `App.jsx` intercepts on load → calls `tabCoordinator.tryHandOff()` → if an existing tab with no unsaved work responds, that tab navigates and the new tab closes; otherwise the current tab handles it → `TasksPage.jsx` reads URL params, clears URL (no refresh loop), routes to list view (personal) or board view (workspace) → passes `highlightTaskId` + `highlightWorkspaceId` down → matching `TaskCard` auto-expands + scrolls into view with purple glow ring → `onHighlightConsumed` clears state.

For workspace tasks, `KanbanBoard` accepts `highlightTaskId` and `highlightWorkspaceId` props, which feed into `DeepLinkContext`. `WorkspaceItem` reads `openWorkspaceId` from context and auto-expands.

In-app notification bell also navigates to `/tasks?task=<id>` (or with `&wsId=`) using `useNavigate`.

### Tab Reuse (BroadcastChannel Handshake)

When a deep link URL is opened in a new tab, `tabCoordinator.tryHandOff(taskId, wsId)` broadcasts a `CLAIM_REQUEST` to all open tabs. Each tab responds with `CLAIM_RESPONSE{canHandle: bool}` based on `unsavedState.hasUnsaved()`. If any tab responds `canHandle: true`, the new tab sends `NAVIGATE{targetTabId}` to the winning tab, waits 150 ms for it to navigate, then closes itself. If no tabs respond or all are busy, the new tab handles the deep link locally.

- `src/utils/tabCoordinator.js` — BroadcastChannel coordinator; exports `init`, `tryHandOff`, `destroy`, `_reset`
- `src/utils/unsavedState.js` — module-level lock registry (Set); exports `register`, `unregister`, `hasUnsaved`, `_reset`
- Per-tab identity stored in `sessionStorage` under `ddiary_tab_id`
- Handshake timeout: 300 ms; post-navigate close grace: 150 ms

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
    emailNotifications.js        — All email templates + EC2 /api/notify calls (SES)
    msTokenRefresh.js            — Silent M365 token refresh on 401 (still used for SharePoint/people search)
    writeNotification.js         — Writes in-app notifications to Firestore
    graphPeopleSearch.js         — Searches org users via MS Graph /v1.0/users
    exportUtils.js               — Export to Excel (.xlsx) and PDF
    errorLogger.js               — Firestore error logging
    unsavedState.js              — Module-level unsaved-work lock registry (Set); register/unregister/hasUnsaved
    tabCoordinator.js            — BroadcastChannel handshake for deep link tab reuse
    __tests__/
      unsavedState.test.js       — Vitest unit tests for unsavedState
      tabCoordinator.test.js     — Vitest integration tests for tabCoordinator (MockBroadcastChannel)
  contexts/
    AuthContext.jsx              — useAuth hook, wraps Firebase Auth
    DeepLinkContext.jsx          — Passes openWorkspaceId/openTaskId through KanbanBoard tree
functions/
  index.js                       — All Cloud Functions (schedulers + callables; kept as fallback)
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

# Dev server (localhost:3000)
npm run dev

# Run unit + integration tests (Vitest + jsdom)
npm test

# Production build (output to dist/)
npm run build

# Deploy frontend to EC2
npm run build
scp -i ~/tools/dhanam-finops.pem -r dist/* ubuntu@15.206.55.165:/var/www/ddiary/

# Deploy Firestore security rules (still on Firebase)
firebase deploy --only firestore:rules

# Deploy Cloud Functions (kept as fallback only — primary email path is EC2 crons + SES)
firebase deploy --only functions
```

The Firebase project is `ddiary-a72ca` (still used for Firestore + Auth). Frontend hosting now runs on EC2 (`ubuntu@15.206.55.165`); see "EC2 Server Layout" below.

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

- **Email requires Firebase ID token** — client-side email (`emailNotifications.js`) calls EC2 `/api/notify` with a Firebase ID token in the Authorization header. The server verifies it. If `auth.currentUser` is null (not signed in), the email is silently dropped.
- **`msTokenRefresh.js` still required** — even after EC2 migration, MS Graph tokens are still needed for SharePoint file access and people search. `msTokenRefresh.js` handles silent refresh of the `ddiary_ms_access_token` in `sessionStorage`.
- **Firestore rules** — `firestore.rules` controls read/write access. Any new collection needs rules before it works in production.
- **`addWorkspaceTask` return value** — always returns the new task `DocumentReference`. Callers must capture it (`const newTaskRef = await addWorkspaceTask(...)`) to get `newTaskRef.id` for deep links in notification emails.
- **SPA routing** — nginx on EC2 handles this via `try_files $uri $uri/ /index.html;` in `ec2/nginx-diary.dhanamfinance.com.conf`. Any future host replacement must also map unmatched paths to `index.html` or React Router 404s on direct URL access.
- **Cloud Functions service account** — uses `firebase-adminsdk-fbsvc@ddiary-a72ca.iam.gserviceaccount.com` explicitly. If the project changes, update the `SA` constant in `functions/index.js`.
- **`localStorage` key prefix** — `ddiary_*` is used throughout for persisted UI state (view toggles, expanded workspace state, etc.).
- **Tab coordinator does not URL-clean before handoff** — `App.jsx` intentionally does NOT call `window.history.replaceState` before `tryHandOff()` because if the handoff fails, `navigate(q)` is called with the full path and TasksPage needs the params intact via `useSearchParams`.
- **Vitest sandbox build** — `npm install` and `npm run build` must be run on the local Mac. The EC2 sandbox has no disk space for node_modules installation.
- **jsPDF font encoding** — `exportUtils.js` uses jsPDF's built-in `times` and `helvetica` fonts which are Windows-1252 encoded. Any Unicode character outside Latin-1 (e.g. `→` U+2192, smart quotes, `•`) must be normalised through `normPdf()` before rendering, or it renders as garbage and can overflow table cells. Always pass text through `normPdf()` before calling `doc.text()` or passing to autoTable.
- **Task email reminders and task completion** — email reminders are NOT automatically disabled when a task is completed or moved to "Done". Reminders continue firing until `reminder.enabled` is explicitly set to `false` in Firestore (or the user turns off the reminder toggle on the task card).

---

## Known Bugs (Identified 2026-05-22)

Bugs fixed in source (2026-05-26) but **not yet deployed to production** — deploy with `npm run build` + `scp` on Mac:

| Priority | File | Bug | Status |
|---|---|---|---|
| Critical | `emailNotifications.js` | `MS_TOKEN_KEY` constant referenced but never declared — ReferenceError crashes diary share | **Fixed 2026-05-26** — constant declared at top of file |
| Critical | `emailNotifications.js` | Share diary with multiple recipients — SES was receiving comma-joined string instead of array | **Fixed 2026-05-26** — `shareDiaryEntry` now builds `toArray` with `Array.from(new Set([...]))` |
| High | `TaskManager/TaskCard.jsx` | Edit task "Assign to" dropdown used `members` (Firestore contacts only) instead of `orgAssignees` (full M365 org directory) | **Fixed 2026-05-26** — dropdown and `memberByEmail` lookup both now prefer `orgAssignees` |
| High | `exportUtils.js` | Diary PDF export: Unicode characters (arrows `→`) outside Windows-1252 rendered as `!'` artifacts and caused table cell overflow; Helvetica font unprofessional | **Fixed 2026-05-26** — added `normPdf()` to replace Unicode with ASCII equivalents; switched to `times` font; rewrote `renderTable()` with proportional `columnStyles` and dark navy headers |
| High | `useWorkspace.js` `deleteWorkspace()` | Reads tasks subcollection after workspace doc is already deleted | Firestore permission-denied error; orphaned subcollections — **pending fix** |
| High | `ec2/crons.js` | Transaction `proceed = false` guard is inside the tx body | Reminder can send email without committing the "sent" lock — potential double-send — **pending fix** |
| High | `useNotifications.js` | `onNewNotification` callback captured in stale closure inside Firestore listener | Notification bell callback fires with stale state — **pending fix** |
| Medium | `useMyWorkspaces` hook | `inMemberSnap` check always returns true for removed docs | Deleted workspaces never disappear from UI without page refresh — **pending fix** |
| Medium | `useReminderDispatcher.js` | `user` captured at interval creation; stale after sign-out/sign-in | Reminder may fire against wrong user or fail silently — **pending fix** |
| Medium | `ec2/crons.js` `sendDailyReminders` | Assumes `reminder.nextSendAt` is an ISO string; Firestore stores Timestamps | `new Date(timestamp)` produces `Invalid Date`; daily reminders silently skipped — **pending fix** |
| Medium | `useEditorSync.js` | Firestore real-time listener not re-attached when a personal diary entry is converted to shared mid-session | Collaborator changes invisible until page refresh — **pending fix** |
| Low/Security | `ec2/server.js` `/api/notify` | No recipient domain restriction — any authenticated user can send email to any address | Domain allowlist code written, **pending deploy** |
| Low | `DiaryEditor/index.jsx` | `unregisterUnsaved('diary-editor')` called in both the `useEffect` body and its cleanup | Double unregister on every `draftStatus` change — **pending fix** |
| Low | `tabCoordinator.js` | `window.close()` fires even if the winning tab's navigate failed | Stray closed tab with no navigation — **pending fix** |

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
| 2026-05-22 | Tab reuse for email deep links — BroadcastChannel handshake routes to existing tab if no unsaved work | `unsavedState.js` (new), `tabCoordinator.js` (new), `App.jsx`, `DiaryEditor/index.jsx`, `TaskManager/index.jsx` |
| 2026-05-22 | DiaryEditor numbering fixes: empty-block Enter removes and renumbers; Enter at pos-0 inserts blank line not numbered item; right-click context menu on any block (not just numbered); "Continue numbering" after table now shows correct number (TABLE was not updating `preResetCounters` in `fixNumberedListsInDOM`); leading `<br>` stripped before inserting numbered prefix | `DiaryEditor/index.jsx`, `DiaryEditor/utils/listUtils.js` |
| 2026-05-22 | Vitest test suite added — unit tests for `unsavedState`, integration tests for `tabCoordinator` with MockBroadcastChannel | `unsavedState.test.js` (new), `tabCoordinator.test.js` (new), `vite.config.js`, `package.json` |
| 2026-05-22 | Full codebase bug audit — 11 bugs identified (see Known Bugs section); none yet patched | — |
| 2026-05-26 | Diary PDF export overhaul — added `normPdf()` for Unicode→ASCII normalization (fixes `!'` artifact from `→`); switched body font from `helvetica` to `times`; rewrote `renderTable()` with proportional `columnStyles` (last col gets ~50% for long-text), dark navy header `[30,58,95]`, grid theme | `src/utils/exportUtils.js` |
| 2026-05-26 | PDF header redesign — logo beside company name (not page-centred); top margin reduced from ~20mm to 8mm; color changed from purple to Dark Gold `[180,137,40]`; logo updated to `public/logo-header.png` (500×365 RGBA transparent version from `dist/Logo.png`) | `src/utils/exportUtils.js`, `public/logo-header.png` |
| 2026-05-26 | Fixed `MS_TOKEN_KEY` undeclared constant in `emailNotifications.js` — was crashing diary share with drawings (Critical bug) | `src/utils/emailNotifications.js` |
| 2026-05-26 | Fixed share-diary multi-recipient email — SES now receives array of addresses (`toArray`) instead of comma-joined string; updated stale error message in ShareEntryModal | `src/utils/emailNotifications.js`, `src/components/ShareEntryModal.jsx` |
| 2026-05-26 | Fixed task assignee dropdown — Edit panel now uses `orgAssignees` (merged M365 org + Firestore contacts) instead of `members`-only; `memberByEmail` lookup also prefers `orgAssignees` | `src/components/TaskManager/TaskCard.jsx` |
| 2026-05-26 | EC2 server domain allowlist written (pending deploy) — `/api/notify` now validates recipient domains against `ALLOWED_EMAIL_DOMAINS` env var (default: `dhanam.finance`) | `ec2/server.js` |
| 2026-05-26 | Version snapshot system — `saveSnapshot`/`loadSnapshots` in `diaryHistory.js`; periodic snapshots every 5 min in `useAutosave` for shared entries; manual save always snapshots; History toolbar button opens `DiaryHistoryModal` (20 versions, inline preview, confirm-before-restore); Firestore rules added for `history` subcollections on both personal entries and sharedDiaries | `src/utils/diaryHistory.js` (new), `src/components/DiaryHistoryModal.jsx` (new), `DiaryEditor/index.jsx`, `DiaryEditor/EditorToolbar.jsx`, `DiaryEditor/hooks/useAutosave.js`, `firestore.rules` |
| 2026-05-26 | Fixed DiaryEditor undo/redo for table operations — `handleTableMenuAction` now calls `pushUndo()` before every action (was missing, so column/table deletions were not undoable); editor re-focuses after menu action so Ctrl+Z works immediately; added Undo/Redo buttons (Undo2/Redo2 icons) to EditorToolbar; exported `undo` and `redo` from `useUndoStack`; `handleInsertTable` also calls `pushUndo()` now | `DiaryEditor/index.jsx`, `DiaryEditor/EditorToolbar.jsx`, `DiaryEditor/hooks/useUndoStack.js` |
| 2026-05-26 | Fixed diary PDF export column sizing — replaced hardcoded equal-width columns with content-aware sizing using `doc.getTextWidth()`; measures longest word (min width, prevents word-breaking) and longest full cell text (ideal width) per column, distributes remaining space proportionally; any column capped at 55% of page width | `src/utils/exportUtils.js` |
| 2026-05-26 | Sheet version history — `saveSheetSnapshot`/`loadSheetSnapshots` in `sheetHistory.js`; periodic snapshots every 5 min during autosave (all sheets); manual snapshot on unmount/close; History button in GridToolbar opens `SheetHistoryModal` (20 versions, mini grid preview, confirm-before-restore, restore pushes to undo stack); Firestore rules added for `history` subcollections on `users/{uid}/sheets/{sheetId}` and `sharedSheets/{sheetId}` | `src/utils/sheetHistory.js` (new), `src/components/SheetHistoryModal.jsx` (new), `SpreadsheetGrid/index.jsx`, `SpreadsheetGrid/GridToolbar.jsx`, `firestore.rules` |
| 2026-05-26 | Replaced all 15 `window.confirm()` browser pop-ups with branded in-app modal — created `ConfirmContext.jsx` (Promise-based `useConfirm()` hook + `ConfirmProvider`); wraps `App.jsx`; destructive actions show red OK button; supports `title`, `danger`, `okText` options; updated 8 files: `DiaryList.jsx`, `DiaryView.jsx`, `SpreadsheetList.jsx`, `TeamMembers.jsx`, `ShareDiaryModal.jsx`, `ShareSheetModal.jsx`, `CategoryBoard.jsx`, `WorkspaceBoardContent.jsx`, `ContactsSection.jsx` | `src/contexts/ConfirmContext.jsx` (new), `App.jsx`, above 8 component files |
| 2026-05-26 | Fixed PDF table column uniformity — `renderHtmlToPdf` now does a pre-pass over all tables before rendering; groups tables by column count; measures every cell across all tables in the group to compute global min/ideal widths; all tables with the same column count (e.g. every 6-column action-item table in a Minutes PDF) receive identical column proportions regardless of which table has more content | `src/utils/exportUtils.js` |
| 2026-05-26 | Fixed WhatsApp task link — `buildTaskAppLink` was returning bare `/tasks` (no task ID) for personal tasks and `?workspace=` (wrong param) for workspace tasks; now uses correct deep link format: `/tasks?task=<id>` and `/tasks?task=<id>&wsId=<wsId>`; also updated `APP_URL` from legacy `dhanamdiary.web.app` to `diary.dhanamfinance.com` | `src/utils/whatsapp.js` |
