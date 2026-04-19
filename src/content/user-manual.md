# Digital Diary — User Manual

> **Last updated:** 2026-04-19 · **App version:** 1.0.0
>
> This manual is bundled with the app and lives in `src/content/user-manual.md`.
> Any time you ship a user-facing change, update this file in the same pull
> request. The **Update Log** at the bottom tracks what changed and when.

---

## 1. What is Digital Diary?

Digital Diary is a private journaling and collaboration workspace built for
Dhanam. It combines three things in one place:

- **Diary** — personal, formatted entries with tags, archive, and trash.
- **Tasks** — personal to-dos organised into categories and sub-categories.
- **Team Board** — shared workspaces where you can assign tasks to colleagues,
  comment on them, track status and activity, and hand tasks off.

Everything syncs in real time across iPad, Mac, iPhone, and Android via
Firebase. You can install it as a home-screen app (PWA) for an offline-capable,
app-like experience.

---

## 2. Getting started

### Sign in

Open the app and sign in with your Dhanam email. If it's your first time, your
account is created automatically and your default timezone is set to your
device's timezone (editable in Settings).

### Install as an app (optional)

- **iPhone / iPad (Safari):** tap Share → Add to Home Screen.
- **Android (Chrome):** tap the three-dot menu → Install app.
- **Desktop (Chrome/Edge):** click the install icon in the address bar.

### Navigate

The top nav bar has four tabs:

- **Diary** — your entries.
- **Write** — start a new entry.
- **Tasks** — personal and team tasks.
- **Settings** — preferences, reminders, and this manual.

The bell icon shows notifications (comments, assignments, status changes).
Your avatar (top right) lets you sign out and shows your initials.

---

## 3. Diary

### Write a new entry

1. Click **New Entry** on the Diary page, or the **Write** tab.
2. Type a title and body. Supported formatting:
   - Numbered lists (`1.` / `1)` at the start of a line)
   - Bulleted lists (`-`, `*`, or `•`)
   - Plain paragraphs (one per line)
3. Optionally pick a **Tag** — tags color-code the entry in the list.
4. Click **Save** to commit. The entry appears immediately in the list.

### View, edit, archive, delete

- Click an entry to open it. You'll see the title, tag, created timestamp, and
  the body. If the entry has been edited, an `(edited …)` note appears below
  the created time.
- **Edit** — reopens the entry in the editor.
- **Archive** — hides the entry from the main list but keeps it searchable in
  the **Archived** section at the bottom of Diary.
- **Delete** — moves the entry to **Trash**. Trashed entries can be restored
  or permanently purged from the Trash section.

### Drawings (legacy)

Entries created before 2026 may contain attached sketches. They render
inline when you open the entry. New entries no longer attach drawings.

---

## 4. Tasks

The Tasks tab has two segments:

- **My Tasks** — your personal list, flat or grouped by category.
- **Team Board** — shared workspaces.

### My Tasks

Click **New Task**. You'll be asked for:

- Title (required)
- Category and Sub-category (optional, editable later)
- Priority — Low / Medium / High
- Status — Open, In Progress, Blocked, Done, etc.
- Due date (optional)

Tasks can be reorganised by editing the category/sub-category on the task row.
**Done** tasks move to a compact strip at the bottom of the list.

### Task card layout

Each task row shows, in a single header line:

- Priority color strip on the left
- Title
- Status badge
- Priority
- Created timestamp + "X minutes open" elapsed counter
- Optional due-date chip
- Assignee avatar (if someone else is involved)

---

## 5. Team Board (workspaces)

### Create a workspace

On the Team Board tab, click **New Workspace**, give it a name, and invite
members by email. Invited members see the board appear under **Team Board**
automatically the next time they open the app.

### Categories and sub-categories

Every workspace starts with an **Uncategorized** bucket. Click **+ Category**
to add more (e.g. "Marketing", "Operations"). Inside a category, click
**+ Sub-category** for a second level (e.g. "Marketing → Campaigns"). Both
are collapsible.

### Add a task to a workspace

Click **New Task** inside a category. The modal asks for:

- Title, priority, status, due date
- **Assignee** — required. Defaults to the board owner if not set. Pick any
  member of the workspace from the directory autocomplete.

### The workspace task card

Click a task card anywhere in the Team Board to open the **Task Detail popup**.
From the popup you can:

- Move the task to a different category or sub-category
- Add and edit **Notes**
- Change **Status** (Open, In Progress, Blocked, Done, …)
- **Reassign** to another workspace member
- Read the **Comments** thread
- Read the **Activity** log (status changes, reassignments, comments)

Changes trigger in-app notifications (bell icon) and optional email
notifications if the recipient has email reminders enabled.

### Assigned to Me

Below your personal tasks you'll see **Assigned to Me** — tasks that other
people have handed to you personally (not via a shared board). Each card is
expandable:

- Header shows title, status, due date, "from X", and created timestamp.
- Expanded body shows:
  - **Reassign** — hand the task to someone else.
  - **Send to Team Board** — promote the task to a shared workspace.
  - A full Comments + Activity panel with status controls.

When you reassign or mark done, the original sender is notified.

---

## 6. Notifications

The bell icon in the top bar shows unread events:

- Someone assigned a task to you
- Someone commented on a task you're involved with
- A task you own had its status changed
- A task was reassigned

Click a notification to jump straight to the relevant task. The red badge
clears once you've read the list.

---

## 7. Settings

In **Settings** you can configure:

- **Reminder email** — where daily pending-task reminders are sent.
- **Daily reminder time** — when the daily email goes out.
- **Timezone** — used by reminders and to render dates.
- **Email reminders on/off** — master toggle for daily emails.
- **Export All Data** — download a JSON copy of your diary and tasks.
- **User Manual** — you're reading it. Click **Download PDF** to grab a
  print-ready copy of this document.
- **Sign Out** — end the session on this device.

---

## 8. Update Log

When a user-facing change ships, append a short entry here. Keep it short and
oriented to what the user will notice.

- **2026-04-19** — Fixed "Invalid Date · Invalid Date" on the Diary entry
  page. Added this User Manual to Settings with a **Download PDF** button.
  Manual trimmed to the core sections (intro → update log).
- **2026-04-18** — Team Board workspace cards now show a one-line summary and
  open a full-detail popup on click.
- **2026-04-17** — Two-tone created/elapsed timestamp across all task views;
  silent retry on transient permission races.
- **2026-04-15** — Kanban card inline-collapsible; consistent chevron
  placement on all collapsible sections.
- **2026-04-12** — "Assigned to Me" scoped to personal assignments; Team
  Board no longer duplicates that section.
- **2026-04-08** — My Tasks flattened to a single list with a Done strip;
  Move-to-Board assignee is now mandatory.

---

*Questions or corrections? Raise them in the Dhanam workspace and we'll update
this manual in the next release.*
