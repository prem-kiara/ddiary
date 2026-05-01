# Efficiency audit — ddiary
**Date:** 2026-04-30
**Scope:** read-only analysis. Nothing was changed.
**Stack confirmed:** Vite 7 + React 18 + Firebase 12 (modular SDK) + Tailwind 3 + lucide-react + tesseract.js + vite-plugin-pwa. Hosting only on Firebase (Functions and Storage are intentionally disabled in `firebase.json`; reminders run client-side via `useReminderDispatcher`).

Findings are grouped by **impact** vs **effort**. Each item names the file(s) involved so you can verify before acting. Per your project instructions, nothing here has been assumed beyond what the code shows — items I'm uncertain about are flagged as "verify".

---

## Tier 1 — Quick wins (low risk, do these first)

### 1. Drop the unused 3.7 MB `Logo.png` at the repo root
- `Logo.png` (3.7 MB) lives at the repo root and is tracked by git, but the runtime asset used by the app is `public/Logo.png` (143 KB). The root copy isn't referenced by any source file or `index.html`.
- Action: `git rm Logo.png` and confirm nothing breaks. Cuts clone size noticeably.

### 2. Remove leftover FUSE temp files from the repo
- `.fuse_hidden0000043500000001`, `.fuse_hidden00000fe000000001`, `.fuse_hidden00000ffd00000001`, `.fuse_hidden0000108d00000001` are tracked. Their contents are stray Firebase CLI debug logs — leftover from a deploy that ran inside a FUSE mount.
- Action: `git rm .fuse_hidden*` and add `.fuse_hidden*` to `.gitignore`.

### 3. Resolve the `.firebaserc` / `.gitignore` contradiction
- `.firebaserc` is **both** committed and listed in `.gitignore`. The ignore line is silent (git keeps tracking already-tracked files), but it's confusing and risks `git rm --cached` flushing it later.
- Action: either remove `.firebaserc` from `.gitignore` (you almost certainly want to track it — it pins the Firebase project), or untrack the file deliberately. Pick one.

### 4. Remove `src/.DS_Store` and add it to `.gitignore` higher up
- `.DS_Store` is in `.gitignore` but `src/.DS_Store` was committed before that. Untrack it.

### 5. Tesseract.js is dead code — and so is `ImageOCR.jsx`
- `src/components/ImageOCR.jsx` is the only file that references `tesseract.js`, and **nothing imports `ImageOCR`**. The "Upload handwritten notes / OCR" feature listed as ✅ in `SETUP-GUIDE.md` is currently unreachable from the UI.
- Two valid responses:
  - **Remove**: drop `tesseract.js` from `package.json`, delete `ImageOCR.jsx`, fix the setup guide. Saves ~30 MB on disk in `node_modules` and shrinks the lockfile.
  - **Re-wire**: lazy-import `ImageOCR` from `DiaryEditor.jsx` so the feature actually works. Tesseract's WASM is large (multi-MB), so keep the dynamic `import('tesseract.js')` inside `ImageOCR` so it only loads on first OCR use.
- Verify before deleting: search your design notes / sprint board to confirm OCR isn't a planned-but-unfinished feature.

### 6. Fix `location.reload(true)` in `index.html`
- Line 42 calls `location.reload(true)`. The `true` argument has been a no-op in modern browsers for years. Use `location.reload()`.

### 7. Pick one cache-bust strategy in `index.html`
- You currently have **three** layers fighting each other on every release: workbox `skipWaiting + clientsClaim` (vite.config.js), the manual `serviceWorker.getRegistrations().unregister()` loop in `index.html`, and the `localStorage` version-pin reload. The combination forces a hard reload on each version bump and means the cache control headers on `sw.js` (no-cache) duplicate workbox's own behavior.
- Action: keep workbox's auto-update + a single soft prompt to refresh. Drop the manual unregister loop. Less surprise reloads for users mid-edit.

---

## Tier 2 — Medium-effort wins (real perf impact)

### 8. Code-split the routes — your bundle is one 1.1 MB blob
- `dist/assets/index-DxyeE-W2.js` is 1.1 MB uncompressed (single chunk). `App.jsx` eagerly imports `KanbanBoard` (2,685 LOC), `TasksPage` → `TeamTaskView`, `DiaryEditor`, `SettingsPage`, etc.
- Action: convert each route element to `React.lazy(() => import('./components/X'))` and wrap the `<Routes>` in a `<Suspense fallback={…}>`. Realistic outcome: initial bundle drops to ~400–500 KB; Kanban and Tasks become on-demand.
- Bonus: in `vite.config.js` add `build.rollupOptions.output.manualChunks` to split `firebase` and `lucide-react` into stable chunks so they cache across deploys.

### 9. `useEntries` over-fetches and over-iterates
- `src/hooks/useFirestore.js:107-125` subscribes to **all** entries (active + trashed + archived) every time, then runs three separate `.filter()` passes over the same array. Heavy users will pay reads they don't need, and trash/archive lists are populated even when the user never opens those tabs.
- Action: split into three queries. Active entries listen continuously; archive and trash queries fire only when the user navigates into those tabs. At minimum, replace the three filters with one pass.

### 10. Remove the duplicate `tasks` index
- `firestore.indexes.json` defines both a `COLLECTION` and a `COLLECTION_GROUP` index on `tasks(assigneeEmail, createdAt)` (lines 36-49). The collection-group form covers both query scopes; the per-collection one is redundant unless you actually issue a non-collection-group query — `useAssignedTasks` uses `collectionGroup`, so it's the only consumer I see.
- Action: drop the COLLECTION-scope duplicate. Smaller index footprint and cheaper writes on every task create/update.

### 11. `useMyWorkspaces` opens N parallel listeners per user
- `src/hooks/useWorkspace.js:79-107`: outer listener finds member docs, then attaches one `onSnapshot` per workspace doc. A user in 20 workspaces means 21 simultaneous listeners. Works fine today; will become a connection-count and read-cost issue as people accumulate workspaces.
- Action: batch-fetch the workspace docs once on member-list change, and only open listeners for the **active** workspace. Fall back to a periodic refresh for the list.

### 12. Cloud Function `sendDailyReminders` reads every user every hour
- `functions/index.js:38` does `db.collection('users').get()` hourly, then filters in code. With 1,000 users that's 24,000 reads/day for nothing.
- Action: change to `where('settings.emailRemindersEnabled', '==', true)` and add a Firestore index. (Currently moot since `firebase.json` has Functions disabled, but worth fixing before you re-enable.)

### 13. `useTasks` sorts twice
- `src/hooks/useFirestore.js:225-234`: query already has `orderBy('createdAt', 'desc')`, then the snapshot handler re-sorts client-side by `(completed, dueDate)`. Either drop the `orderBy` (sort cost is identical client-side and you save the index dependency) or do one consolidated comparator.

### 14. Tighten over-permissive rules on `workspaceInvites` and `userDirectory`
- `firestore.rules:214-216` allows any authenticated user to **read all invites**. The comment justifies it as "obscure ID", but a determined user can scan. Tighten to `inviteeEmail == request.auth.token.email || inviterUid == request.auth.uid`.
- `firestore.rules:84-88` exposes the entire `userDirectory` (every signed-up user's email) to every signed-in user. Acceptable in a single-tenant company app; not in a B2B context. Decide deliberately.

### 15. Console noise + dual error sinks
- 24 `console.log/warn/error` calls in `src/`, plus an `errorLogger` writing to Firestore on most error paths. Some errors are written to both. Pick one sink for production; gate `console.*` behind `import.meta.env.DEV`.

---

## Tier 3 — Larger refactors (high upside, plan deliberately)

### 16. Break up `KanbanBoard.jsx` (2,685 LOC)
- Single file holds the board, columns, cards, modals, workspace setup wizard, member management — all in one render tree. This kills your ability to memoize anything and makes drag-drop refactors painful.
- Action: split into `KanbanBoard`, `WorkspaceSetup`, `BoardColumn`, `TaskCard`, `AddTaskModal`, `MemberPicker`. Same for `TaskManager.jsx` (1,121 LOC).

### 17. Move membership checks out of Firestore rules `get()` calls
- `firestore.rules:124-145` evaluates `exists(...)` and `get(...)` per task read/write. Each `get()` inside a rule **counts as a billed read**. For a busy workspace, every task action costs 2 extra reads beyond the actual data read.
- Action: mirror workspace membership into custom claims via a Cloud Functions auth/membership trigger, then check `request.auth.token.workspaces` instead. Faster (no I/O) and free.

### 18. Migrate Cloud Functions to Gen 2 / Node 20+
- `functions/package.json` pins `firebase-functions ^4` and Node 18. Both are deprecated (Google retired Node 18 for Cloud Functions in early 2025; `functions.config()` is removed in v5+). When you re-enable Functions, plan a Gen 2 migration with `defineSecret` and `onSchedule`.

### 19. De-duplicate `deleteWorkspace`
- A client-side `deleteWorkspace` lives in `src/hooks/useWorkspace.js:549` AND a server-side `exports.deleteWorkspace` in `functions/index.js:311`. Two sources of truth for the same destructive op. Pick one — the server version is safer (single round trip, no risk of partial deletion if the user closes the tab mid-cascade).

### 20. Add ESLint, a PR-time test, and CI
- No `eslintrc`, no tests, no CI workflow. Even a minimal `eslint:recommended + react-hooks/exhaustive-deps` config would catch the explicit suppressions in `App.jsx:101` (intentional) vs the rest. Your codebase already has the discipline; tooling would prevent drift.

### 21. Sourcemaps in prod
- `vite.config.js` sets `sourcemap: false`. Your `errorLogger` writes errors to Firestore with stack traces that are unreadable without maps. Switch to `sourcemap: 'hidden'` — files exist for local debugging but aren't referenced by the deployed bundle.

---

## Things I checked and they're fine

- Firebase imports are modular (`firebase/auth`, `firebase/firestore`) — already tree-shaken.
- `lucide-react` uses named imports — tree-shaken.
- `tesseract.js` is gated behind a dynamic `import()` (would be safe even if `ImageOCR` were used).
- `useNotifications` correctly caps with `limit(50)`.
- `useReminderDispatcher` uses a Firestore transaction as a multi-tab dispatch lock — correct design for a free-tier dispatcher.
- `clearCompleted`, `addMembersBulk`, `markAllRead` all use `writeBatch` — good.
- `firebase.json` cache headers are correct (immutable for hashed assets, no-cache for the entry HTML and SW files).

---

## Suggested order of attack

1. Tier 1 items 1-7 in one PR (all repo hygiene, ~30 minutes).
2. Decide OCR fate (item 5) before doing item 8, since it changes what to lazy-load.
3. Item 8 (route splitting) — biggest user-facing perf win.
4. Items 9, 10, 13 — small, related, do in one Firestore-perf PR.
5. Items 11, 12, 17 only if you're seeing actual cost or scale pressure — they're not bugs today.

Tell me which item(s) you want me to start on and I'll do the work and verify it.
