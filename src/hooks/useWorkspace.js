import { useState, useEffect, useRef } from 'react';
import {
  collection, collectionGroup, doc, addDoc, updateDoc, deleteDoc, setDoc, getDoc,
  query, where, orderBy, onSnapshot, serverTimestamp, getDocs,
} from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { logError } from '../utils/errorLogger';

// ─── All workspaces where the current user is a member (real-time) ──────────
//
// Two parallel real-time listeners merge into one workspaces array:
//   1. collectionGroup('members') where uid == me  — workspaces I'm a member of
//   2. collection('workspaces')   where createdBy == me — workspaces I created
//
// Each listener updates state immediately when it resolves, so the UI never
// waits for both. Listener 2 acts as an instant fallback while the
// collection-group index builds (takes a few minutes after first deploy).
export function useMyWorkspaces() {
  const { user } = useAuth();
  const [workspaces, setWorkspaces] = useState([]);
  const [loading,    setLoading]    = useState(true);

  // wsMapRef is shared between both listeners so merging doesn't cause races.
  const wsMapRef       = useRef(new Map());
  const innerUnsubsRef = useRef([]);

  useEffect(() => {
    if (!user?.uid) { setWorkspaces([]); setLoading(false); return; }

    wsMapRef.current = new Map();

    const flush = () => {
      setWorkspaces(
        Array.from(wsMapRef.current.values())
          .sort((a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0))
      );
      setLoading(false);
    };

    const cleanupInner = () => {
      innerUnsubsRef.current.forEach(fn => fn());
      innerUnsubsRef.current = [];
    };

    // ── Listener 1: workspaces where I am a member (via collection-group) ────
    const membersQuery = query(
      collectionGroup(db, 'members'),
      where('uid', '==', user.uid)
    );

    const unsubMembers = onSnapshot(membersQuery, (snap) => {
      cleanupInner();

      const memberDocs = snap.docs
        .map(d => ({ workspaceId: d.ref.parent.parent?.id, role: d.data().role }))
        .filter(d => d.workspaceId);

      if (memberDocs.length === 0) {
        flush();
        return;
      }

      let loaded = 0;
      innerUnsubsRef.current = memberDocs.map(({ workspaceId, role }) =>
        onSnapshot(doc(db, 'workspaces', workspaceId), (wsSnap) => {
          if (wsSnap.exists()) {
            wsMapRef.current.set(workspaceId, { id: workspaceId, role, ...wsSnap.data() });
          } else {
            wsMapRef.current.delete(workspaceId);
          }
          loaded++;
          // Flush as soon as all inner doc listeners have fired at least once
          if (loaded >= memberDocs.length) flush();
        }, (err) => {
          logError(err, { location: 'useMyWorkspaces', action: 'workspaceDocSnapshot', workspaceId });
          loaded++;
          if (loaded >= memberDocs.length) flush();
        })
      );
    }, (err) => {
      logError(err, { location: 'useMyWorkspaces', action: 'membersCollectionGroupQuery' });
      flush(); // show whatever createdBy query has already populated
    });

    // ── Listener 2: workspaces I created (instant fallback, always works) ────
    const createdByQuery = query(
      collection(db, 'workspaces'),
      where('createdBy', '==', user.uid)
    );

    const unsubCreated = onSnapshot(createdByQuery, (snap) => {
      snap.docs.forEach(d => {
        // Member query is authoritative for role; don't overwrite if already present
        if (!wsMapRef.current.has(d.id)) {
          wsMapRef.current.set(d.id, { id: d.id, role: 'admin', ...d.data() });
        }
      });
      // Remove workspace from map if it was only here and has now been deleted
      wsMapRef.current.forEach((_, id) => {
        const inThisSnap   = snap.docs.some(d => d.id === id);
        const inMemberSnap = innerUnsubsRef.current.length > 0 &&
                             Array.from(wsMapRef.current.keys()).includes(id);
        if (!inThisSnap && !inMemberSnap) wsMapRef.current.delete(id);
      });
      flush(); // update immediately — don't wait for member query
    }, (err) => {
      logError(err, { location: 'useMyWorkspaces', action: 'createdByQuery' });
      flush();
    });

    return () => {
      unsubMembers();
      unsubCreated();
      cleanupInner();
    };
  }, [user?.uid]);

  return { workspaces, loading };
}

// ─── Single workspace metadata + members (for active workspace view) ────────
export function useWorkspace(workspaceId) {
  const [workspace, setWorkspace] = useState(null);
  const [members,   setMembers]   = useState([]);
  const [loading,   setLoading]   = useState(true);

  useEffect(() => {
    if (!workspaceId) { setWorkspace(null); setMembers([]); setLoading(false); return; }

    let loaded = { ws: false, mem: false };
    const done = () => { if (loaded.ws && loaded.mem) setLoading(false); };

    const unsubWs = onSnapshot(doc(db, 'workspaces', workspaceId), (snap) => {
      setWorkspace(snap.exists() ? { id: snap.id, ...snap.data() } : null);
      loaded.ws = true; done();
    }, () => { loaded.ws = true; done(); });

    const unsubMem = onSnapshot(
      collection(db, 'workspaces', workspaceId, 'members'),
      (snap) => {
        setMembers(snap.docs.map(d => ({ uid: d.id, ...d.data() })));
        loaded.mem = true; done();
      },
      () => { loaded.mem = true; done(); }
    );

    return () => { unsubWs(); unsubMem(); };
  }, [workspaceId]);

  return { workspace, members, loading };
}

// ─── Active-workspace selection ─────────────────────────────────────────────
// Persisted in localStorage so refresh (and cross-tab) keep the user on the
// workspace they last picked. A custom event keeps every consumer in sync
// without a page reload when the user clicks the workspace switcher.
const ACTIVE_WS_KEY    = 'ddiary_active_workspace_id';
const ACTIVE_WS_EVENT  = 'ddiary:active-ws-changed';

export function setActiveWorkspaceId(id) {
  if (id) localStorage.setItem(ACTIVE_WS_KEY, id);
  else    localStorage.removeItem(ACTIVE_WS_KEY);
  window.dispatchEvent(new CustomEvent(ACTIVE_WS_EVENT));
}

function useActiveWorkspaceId() {
  const [id, setId] = useState(() => {
    try { return localStorage.getItem(ACTIVE_WS_KEY); } catch { return null; }
  });
  useEffect(() => {
    const sync = () => {
      try { setId(localStorage.getItem(ACTIVE_WS_KEY)); } catch {}
    };
    window.addEventListener(ACTIVE_WS_EVENT, sync);
    window.addEventListener('storage', sync); // cross-tab
    return () => {
      window.removeEventListener(ACTIVE_WS_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);
  return id;
}

// ─── Single-workspace hook ──────────────────────────────────────────────────
// Returns the active workspace (user-chosen via switcher) or, falling back,
// the first workspace by createdAt. Single-workspace users see no behavior
// change because workspaces[0] is identical to the active selection when
// nothing has been chosen yet.
export function useMyWorkspace() {
  const { workspaces, loading } = useMyWorkspaces();
  const activeId = useActiveWorkspaceId();
  const activeWs = workspaces.find(w => w.id === activeId) || workspaces[0] || null;
  const [members, setMembers] = useState([]);

  useEffect(() => {
    if (!activeWs?.id) { setMembers([]); return; }
    const unsub = onSnapshot(
      collection(db, 'workspaces', activeWs.id, 'members'),
      (snap) => setMembers(snap.docs.map(d => ({ uid: d.id, ...d.data() }))),
      () => {}
    );
    return unsub;
  }, [activeWs?.id]);

  return { workspace: activeWs, members, loading };
}

// ─── Workspace tasks (real-time) ─────────────────────────────────────────────
//
// IMPORTANT — transient permission errors must NEVER surface in the UI.
//
// Firestore `onSnapshot` evaluates rules against the current auth state the
// moment it attaches. On a freshly joined workspace (invite accepted seconds
// ago, pending_* placeholder just swapped, or another user just wrote a new
// task while our member-doc is still replicating) the rule check for
// `isWorkspaceMember()` can return false even though the user IS a member.
// Firestore tears the listener down on `permission-denied`, and we used to
// surface `err.message` as a red banner — it stuck there forever because the
// dead listener never fires another success callback to clear it.
//
// Fix: on permission-denied we silently back off and re-attach the listener
// (up to a small number of retries). Only non-transient errors bubble to UI.
export function useWorkspaceTasks(workspaceId) {
  const [tasks,   setTasks]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  useEffect(() => {
    if (!workspaceId) { setTasks([]); setLoading(false); setError(null); return; }

    // NOTE: we intentionally don't `orderBy('createdAt', 'desc')` here.
    //
    // Firestore orderBy on a field that uses `serverTimestamp()` can hide a
    // just-created doc from the local snapshot while the server round-trip is
    // pending — the local copy has `createdAt: null` until resolved, and an
    // orderBy on that field briefly drops the doc. This is the root cause of
    // the "new sub-category task doesn't show up until I navigate away and
    // come back" glitch.
    //
    // Instead we fetch unordered and sort client-side, using `serverTimestamps:
    // 'estimate'` so pending writes show up with a plausible timestamp right
    // away.
    const q = query(collection(db, 'workspaces', workspaceId, 'tasks'));

    const toDate = (ts) => {
      if (!ts) return 0;
      if (typeof ts === 'number') return ts;
      if (typeof ts === 'string') return new Date(ts).getTime() || 0;
      if (typeof ts.toMillis === 'function') return ts.toMillis();
      if (typeof ts.toDate   === 'function') return ts.toDate().getTime();
      return 0;
    };

    let cancelled = false;
    let unsub = null;
    let retryTimer = null;
    let attempts = 0;
    const MAX_ATTEMPTS = 6;                // ~total wait: 12s worst case
    const backoff = (n) => Math.min(500 * Math.pow(1.6, n), 4000);

    const attach = () => {
      if (cancelled) return;
      unsub = onSnapshot(q,
        (snap) => {
          if (cancelled) return;
          attempts = 0;                    // any success resets retry budget
          const rows = snap.docs.map(d => ({
            id: d.id,
            // `estimate` → pending server timestamps are filled in with the
            // local estimated time, so just-added tasks render immediately.
            ...d.data({ serverTimestamps: 'estimate' }),
          }));
          rows.sort((a, b) => toDate(b.createdAt) - toDate(a.createdAt));
          setTasks(rows);
          setLoading(false);
          setError(null);
        },
        (err) => {
          if (cancelled) return;
          try { unsub?.(); } catch {}      // Firestore already tore this down; be safe

          // permission-denied is almost always a replication race. Back off
          // silently and re-attach instead of screaming at the user.
          if (err?.code === 'permission-denied' && attempts < MAX_ATTEMPTS) {
            const delay = backoff(attempts++);
            logError(err, {
              location: 'useWorkspaceTasks',
              action:   'onSnapshot.permission-denied.retry',
              workspaceId, attempts, delay,
            });
            setLoading(false);             // don't hold a spinner forever
            retryTimer = setTimeout(attach, delay);
            return;                        // IMPORTANT: do NOT setError here
          }

          // Any other error (or out of retries): surface it.
          setError(err?.message || 'Failed to load tasks.');
          setLoading(false);
        }
      );
    };

    attach();

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      try { unsub?.(); } catch {}
    };
  }, [workspaceId]);

  return { tasks, loading, error };
}

// ─── Workspace task comments (real-time) ─────────────────────────────────────
export function useWorkspaceComments(workspaceId, taskId) {
  const [comments, setComments] = useState([]);
  const [loading,  setLoading]  = useState(true);

  useEffect(() => {
    if (!workspaceId || !taskId) { setComments([]); setLoading(false); return; }
    const q = query(collection(db, 'workspaces', workspaceId, 'tasks', taskId, 'comments'), orderBy('createdAt', 'asc'));
    const unsub = onSnapshot(q, snap => { setComments(snap.docs.map(d => ({ id: d.id, ...d.data() }))); setLoading(false); }, () => setLoading(false));
    return unsub;
  }, [workspaceId, taskId]);

  return { comments, loading };
}

// ─── Workspace task activity (real-time) ─────────────────────────────────────
export function useWorkspaceActivity(workspaceId, taskId) {
  const [activity, setActivity] = useState([]);

  useEffect(() => {
    if (!workspaceId || !taskId) return;
    const q = query(collection(db, 'workspaces', workspaceId, 'tasks', taskId, 'activity'), orderBy('createdAt', 'asc'));
    // Error callback cleans up the listener — dangling listeners drain quota.
    const unsub = onSnapshot(
      q,
      snap => setActivity(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      err  => {
        logError(err, { location: 'useWorkspaceActivity', workspaceId, taskId });
        unsub?.(); // stop listening after an error
      }
    );
    return unsub;
  }, [workspaceId, taskId]);

  return { activity };
}

// ─── Mutations ────────────────────────────────────────────────────────────────

/**
 * Create a workspace.
 *
 * `initialCategory` is optional. When supplied as { name, subcategoryName } it
 * seeds the workspace's categories array with one category (and one optional
 * sub-category) so the board opens with a real bucket from day one. Empty /
 * whitespace-only names are ignored so the caller can pass blanks safely.
 *
 * `description` is optional. When supplied (non-empty string) it's stored as
 * a free-text description on the workspace doc. This is shown as context in
 * the workspace header for all members.
 */
export async function createWorkspace(uid, email, displayName, name, initialCategory = null, description = null) {
  const payload = {
    name,
    createdBy: uid,
    createdAt: serverTimestamp(),
  };

  const desc = typeof description === 'string' ? description.trim() : '';
  if (desc) payload.description = desc;

  const catName = initialCategory?.name?.trim();
  if (catName) {
    const subName = initialCategory?.subcategoryName?.trim();
    payload.categories = [{
      id:   _newId('cat'),
      name: catName,
      subcategories: subName ? [{ id: _newId('sub'), name: subName }] : [],
    }];
  }

  const ref = await addDoc(collection(db, 'workspaces'), payload);
  await setDoc(doc(db, 'workspaces', ref.id, 'members', uid), {
    uid, email, displayName,
    role: 'admin',
    joinedAt: serverTimestamp(),
  });
  return ref.id;
}

export async function renameWorkspace(workspaceId, name) {
  await updateDoc(doc(db, 'workspaces', workspaceId), { name });
}

/**
 * Self-heal: make sure `actor` is a member of the workspace. Used before any
 * write so a legacy workspace (or a failed initial member write) doesn't leave
 * the creator locked out. No-op if the member doc already exists.
 */
export async function ensureWorkspaceMember(workspaceId, actor, role = 'admin') {
  if (!actor?.uid) return;
  const ref = doc(db, 'workspaces', workspaceId, 'members', actor.uid);
  const snap = await getDoc(ref);
  if (snap.exists()) return;
  await setDoc(ref, {
    uid:         actor.uid,
    email:       actor.email || null,
    displayName: actor.displayName || actor.email || 'Member',
    role,
    joinedAt:    serverTimestamp(),
  });
}

// ─── Categories & Subcategories ──────────────────────────────────────────────
// Categories live as an array on the workspace document:
//   categories: [{ id, name, subcategories: [{ id, name }] }, ...]
// Tasks reference them via categoryId and subcategoryId (both optional).

function _newId(prefix = 'c') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

async function _readCategories(workspaceId) {
  const snap = await getDoc(doc(db, 'workspaces', workspaceId));
  if (!snap.exists()) return [];
  return Array.isArray(snap.data().categories) ? snap.data().categories : [];
}

export async function addWorkspaceCategory(workspaceId, name) {
  const categories = await _readCategories(workspaceId);
  const newId = _newId('cat');
  const next = [...categories, { id: newId, name: name.trim(), subcategories: [] }];
  await updateDoc(doc(db, 'workspaces', workspaceId), { categories: next });
  return newId;
}

/**
 * Converts the virtual "Uncategorized" bucket into a real category:
 *   1. Adds a new category with `name`
 *   2. Moves every task that has no categoryId into it (optionally into a
 *      specific subcategory if `subcategoryName` is provided, which is also
 *      created under the new category)
 * Returns { categoryId, subcategoryId }.
 */
export async function promoteUncategorizedToCategory(workspaceId, name, subcategoryName = null) {
  const categories = await _readCategories(workspaceId);
  const categoryId = _newId('cat');
  const subcategoryId = subcategoryName ? _newId('sub') : null;
  const newCat = {
    id: categoryId,
    name: name.trim(),
    subcategories: subcategoryName
      ? [{ id: subcategoryId, name: subcategoryName.trim() }]
      : [],
  };
  await updateDoc(doc(db, 'workspaces', workspaceId), { categories: [...categories, newCat] });

  // Best-effort: move every uncategorized task into the new category/sub.
  try {
    const tasksSnap = await getDocs(collection(db, 'workspaces', workspaceId, 'tasks'));
    const uncat = tasksSnap.docs.filter(d => !d.data().categoryId);
    await Promise.all(uncat.map(d =>
      updateDoc(d.ref, { categoryId, subcategoryId, updatedAt: serverTimestamp() }).catch(() => {})
    ));
  } catch { /* non-fatal */ }

  return { categoryId, subcategoryId };
}

export async function renameWorkspaceCategory(workspaceId, categoryId, name) {
  const categories = await _readCategories(workspaceId);
  const next = categories.map(c => c.id === categoryId ? { ...c, name: name.trim() } : c);
  await updateDoc(doc(db, 'workspaces', workspaceId), { categories: next });
}

export async function deleteWorkspaceCategory(workspaceId, categoryId) {
  const categories = await _readCategories(workspaceId);
  const next = categories.filter(c => c.id !== categoryId);
  await updateDoc(doc(db, 'workspaces', workspaceId), { categories: next });
  // Unassign tasks that referenced this category (best-effort)
  try {
    const tasksSnap = await getDocs(
      query(collection(db, 'workspaces', workspaceId, 'tasks'), where('categoryId', '==', categoryId))
    );
    await Promise.all(
      tasksSnap.docs.map(d =>
        updateDoc(d.ref, { categoryId: null, subcategoryId: null }).catch(() => {})
      )
    );
  } catch { /* non-fatal */ }
}

export async function addWorkspaceSubcategory(workspaceId, categoryId, name) {
  const categories = await _readCategories(workspaceId);
  const newId = _newId('sub');
  const next = categories.map(c => c.id === categoryId
    ? { ...c, subcategories: [...(c.subcategories || []), { id: newId, name: name.trim() }] }
    : c
  );
  await updateDoc(doc(db, 'workspaces', workspaceId), { categories: next });
  return newId;
}

export async function renameWorkspaceSubcategory(workspaceId, categoryId, subcategoryId, name) {
  const categories = await _readCategories(workspaceId);
  const next = categories.map(c => c.id === categoryId
    ? { ...c, subcategories: (c.subcategories || []).map(s => s.id === subcategoryId ? { ...s, name: name.trim() } : s) }
    : c
  );
  await updateDoc(doc(db, 'workspaces', workspaceId), { categories: next });
}

export async function deleteWorkspaceSubcategory(workspaceId, categoryId, subcategoryId) {
  const categories = await _readCategories(workspaceId);
  const next = categories.map(c => c.id === categoryId
    ? { ...c, subcategories: (c.subcategories || []).filter(s => s.id !== subcategoryId) }
    : c
  );
  await updateDoc(doc(db, 'workspaces', workspaceId), { categories: next });
  // Unassign tasks that referenced this subcategory (best-effort)
  try {
    const tasksSnap = await getDocs(
      query(collection(db, 'workspaces', workspaceId, 'tasks'), where('subcategoryId', '==', subcategoryId))
    );
    await Promise.all(
      tasksSnap.docs.map(d => updateDoc(d.ref, { subcategoryId: null }).catch(() => {}))
    );
  } catch { /* non-fatal */ }
}

export async function addWorkspaceMember(workspaceId, { uid, email, displayName, role = 'member' }) {
  await setDoc(doc(db, 'workspaces', workspaceId, 'members', uid), {
    uid, email, displayName, role,
    joinedAt: serverTimestamp(),
  });
}

export async function removeWorkspaceMember(workspaceId, uid) {
  await deleteDoc(doc(db, 'workspaces', workspaceId, 'members', uid));
}

/**
 * Delete a workspace and ALL its subcollections (tasks, members, comments, activity).
 * Done entirely client-side in batches — compatible with Firebase Spark (free) plan.
 *
 * Deletion order:
 *   1. For each task → delete its 'comments' and 'activity' subcollections
 *   2. Delete all tasks
 *   3. Delete all members
 *   4. Delete the workspace doc
 */
export async function deleteWorkspace(workspaceId) {
  const wsRef = doc(db, 'workspaces', workspaceId);

  // IMPORTANT ORDER: delete the workspace doc FIRST while the user is still a
  // member. isWorkspaceMember() checks for the member subdoc — if we deleted
  // member docs first the workspace-doc delete would be denied.
  // Subcollections can exist without their parent doc in Firestore, so we clean
  // them up afterwards.

  // 1. Delete workspace doc — user is still a member (or creator) at this point.
  //    This is the ONLY step that must succeed; everything after is best-effort cleanup.
  await deleteDoc(wsRef);

  // 2. Delete every task's subcollections, then the task itself (best-effort)
  try {
    const tasksSnap = await getDocs(collection(db, 'workspaces', workspaceId, 'tasks'));
    for (const taskDoc of tasksSnap.docs) {
      try {
        const taskId = taskDoc.id;
        const [commentsSnap, activitySnap] = await Promise.all([
          getDocs(collection(db, 'workspaces', workspaceId, 'tasks', taskId, 'comments')).catch(() => ({ docs: [] })),
          getDocs(collection(db, 'workspaces', workspaceId, 'tasks', taskId, 'activity')).catch(() => ({ docs: [] })),
        ]);
        await Promise.all([
          ...commentsSnap.docs.map(d => deleteDoc(d.ref).catch(() => {})),
          ...activitySnap.docs.map(d => deleteDoc(d.ref).catch(() => {})),
        ]);
        await deleteDoc(taskDoc.ref).catch(() => {});
      } catch { /* individual task cleanup failure is non-fatal */ }
    }
  } catch { /* tasks collection read failure is non-fatal after workspace doc is deleted */ }

  // 3. Delete all members (best-effort — rules may deny after workspace doc is gone)
  try {
    const membersSnap = await getDocs(collection(db, 'workspaces', workspaceId, 'members'));
    await Promise.all(membersSnap.docs.map(d => deleteDoc(d.ref).catch(() => {})));
  } catch { /* non-fatal */ }

  // 4. Delete all pending/active invites so invited users don't see a stale prompt
  try {
    const invitesSnap = await getDocs(
      query(collection(db, 'workspaceInvites'), where('workspaceId', '==', workspaceId))
    );
    await Promise.all(invitesSnap.docs.map(d => deleteDoc(d.ref).catch(() => {})));
  } catch { /* non-fatal */ }
}

export async function addWorkspaceTask(workspaceId, task, actor) {
  // Self-heal: if the actor was silently dropped from members (or the doc was
  // never written), fix it before the task create so rules don't reject us.
  try { await ensureWorkspaceMember(workspaceId, actor); } catch { /* non-fatal */ }
  const assigneeEmail = task.assigneeEmail?.toLowerCase() || null;
  // Reminder: caller should pass a fully-normalized object with nextSendAt
  // pre-computed. We only validate type here — null means "no reminder".
  const reminder = task.reminder && typeof task.reminder === 'object' ? task.reminder : null;
  const ref = await addDoc(collection(db, 'workspaces', workspaceId, 'tasks'), {
    text:           task.text?.trim() || '',
    notes:          task.notes?.trim() || null,
    status:         task.status   || 'open',
    priority:       task.priority || 'medium',
    dueDate:        task.dueDate  || null,
    assigneeUid:    task.assigneeUid   || null,
    assigneeEmail,
    assigneeName:   task.assigneeName  || null,
    categoryId:     task.categoryId     || null,
    subcategoryId:  task.subcategoryId  || null,
    createdBy:      actor.uid,
    createdByEmail: actor.email,
    createdByName:  actor.displayName || actor.email,
    reminder,
    createdAt:      serverTimestamp(),
    updatedAt:      serverTimestamp(),
  });
  // Activity log is best-effort — if rules reject it (e.g. stale rules, race on
  // just-written member doc), the task create itself must still count as success.
  try {
    await _logWorkspaceActivity(workspaceId, ref.id, {
      actorUid: actor.uid, actorName: actor.displayName || actor.email,
      action: 'created', detail: task.text,
    });
  } catch { /* non-fatal */ }
  return ref;
}

export async function updateWorkspaceTask(workspaceId, taskId, updates, actor, task = null) {
  await updateDoc(doc(db, 'workspaces', workspaceId, 'tasks', taskId), {
    ...updates, updatedAt: serverTimestamp(),
  });
  if (!actor) return;
  const actorName = actor.displayName || actor.email;
  if (updates.status) {
    const labels = { open: 'Open', in_progress: 'In Progress', review: 'Review', done: 'Done' };
    await _logWorkspaceActivity(workspaceId, taskId, {
      actorUid: actor.uid, actorName,
      action: 'status_changed', detail: `→ ${labels[updates.status] || updates.status}`,
    });
  }
  if (updates.assigneeEmail !== undefined && updates.assigneeName !== undefined) {
    await _logWorkspaceActivity(workspaceId, taskId, {
      actorUid: actor.uid, actorName,
      action: 'reassigned', detail: `→ ${updates.assigneeName || updates.assigneeEmail}`,
    });
  }
}

/**
 * Moves a task into a (category, subcategory) pair and records an activity
 * entry like "→ Credit & Underwriting / Retail" or "→ Uncategorized".
 *
 * Unlike updateWorkspaceTask this helper needs the human-readable *names* for
 * the activity log (tasks only store IDs). The caller is expected to look them
 * up from the workspace's categories array.
 *
 * Either `categoryId` or `subcategoryId` can be null/undefined:
 *   - null categoryId   → task becomes uncategorized (and subcategoryId is cleared)
 *   - null subcategoryId → task sits directly under the category
 */
export async function moveWorkspaceTaskCategory(
  workspaceId,
  taskId,
  { categoryId, subcategoryId, categoryName, subcategoryName },
  actor
) {
  await updateDoc(doc(db, 'workspaces', workspaceId, 'tasks', taskId), {
    categoryId:    categoryId    || null,
    subcategoryId: categoryId ? (subcategoryId || null) : null,
    updatedAt:     serverTimestamp(),
  });

  if (!actor) return;
  const actorName = actor.displayName || actor.email;
  let detail;
  if (!categoryId) {
    detail = '→ Uncategorized';
  } else if (subcategoryId && subcategoryName) {
    detail = `→ ${categoryName || 'category'} / ${subcategoryName}`;
  } else {
    detail = `→ ${categoryName || 'category'}`;
  }
  try {
    await _logWorkspaceActivity(workspaceId, taskId, {
      actorUid: actor.uid, actorName,
      action: 'moved', detail,
    });
  } catch { /* activity log is non-fatal — the move itself already succeeded */ }
}

export async function deleteWorkspaceTask(workspaceId, taskId) {
  await deleteDoc(doc(db, 'workspaces', workspaceId, 'tasks', taskId));
}

export async function addWorkspaceComment(workspaceId, taskId, { authorUid, authorName, authorEmail, text }, task = null) {
  await addDoc(collection(db, 'workspaces', workspaceId, 'tasks', taskId, 'comments'), {
    authorUid, authorName, text,
    createdAt: serverTimestamp(),
  });
  await _logWorkspaceActivity(workspaceId, taskId, {
    actorUid: authorUid, actorName: authorName,
    action: 'commented', detail: text,
  });
}

async function _logWorkspaceActivity(workspaceId, taskId, { actorUid, actorName, action, detail }) {
  await addDoc(collection(db, 'workspaces', workspaceId, 'tasks', taskId, 'activity'), {
    actorUid, actorName, action, detail: detail || '',
    createdAt: serverTimestamp(),
  });
}

// ─── Workspace invites ────────────────────────────────────────────────────────
//
// Invite lifecycle:
//   Inviter sends → status:'pending'  (invitee sees Accept / Decline prompt)
//   Invitee accepts → status:'accepted', real member doc created
//   Invitee declines → status:'rejected', notification sent to inviter
//   Inviter can re-invite after rejection (overwrites the old doc via same ID)
//
// Document ID is deterministic: {workspaceId}_{sanitised_inviteeEmail}
// This ensures idempotency and makes single-doc reads possible without queries.

function _inviteId(workspaceId, inviteeEmail) {
  return `${workspaceId}_${inviteeEmail.toLowerCase().replace(/[^a-zA-Z0-9]/g, '_')}`;
}

/** Real-time listener: pending invites for the signed-in user */
export function usePendingInvites(userEmail) {
  const [invites, setInvites] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userEmail) { setInvites([]); setLoading(false); return; }
    const q = query(
      collection(db, 'workspaceInvites'),
      where('inviteeEmail', '==', userEmail.toLowerCase()),
      where('status',       '==', 'pending'),
      orderBy('createdAt',  'desc')
    );
    const unsub = onSnapshot(q,
      snap => { setInvites(snap.docs.map(d => ({ id: d.id, ...d.data() }))); setLoading(false); },
      ()   => setLoading(false)
    );
    return unsub;
  }, [userEmail]);

  return { invites, loading };
}

/**
 * Create (or overwrite-after-rejection) a workspace invite.
 * Returns the invite doc ID.
 */
export async function createWorkspaceInvite({
  workspaceId, workspaceName, inviterUid, inviterEmail, inviterName, inviteeEmail,
}) {
  const email    = inviteeEmail.toLowerCase();
  const inviteId = _inviteId(workspaceId, email);
  await setDoc(doc(db, 'workspaceInvites', inviteId), {
    workspaceId, workspaceName,
    inviterUid, inviterEmail, inviterName,
    inviteeEmail: email,
    status:    'pending',
    createdAt: serverTimestamp(),
  });
  return inviteId;
}

/**
 * Fetch a single invite doc without a query (uses deterministic ID).
 * Returns the invite object or null.
 */
export async function getExistingInvite(workspaceId, inviteeEmail) {
  const snap = await getDoc(doc(db, 'workspaceInvites', _inviteId(workspaceId, inviteeEmail)));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

/**
 * Invitee accepts → adds them as a real workspace member + cleans up pending placeholder.
 */
export async function acceptWorkspaceInvite(invite, user) {
  const { id: inviteId, workspaceId } = invite;

  // 1. Add real member doc
  await addWorkspaceMember(workspaceId, {
    uid: user.uid, email: user.email,
    displayName: user.displayName || user.email,
    role: 'member',
  });

  // 2. Remove any pending_* placeholder (silently OK if not present)
  const placeholder = `pending_${user.email.replace(/[^a-zA-Z0-9]/g, '_')}`;
  try { await deleteDoc(doc(db, 'workspaces', workspaceId, 'members', placeholder)); } catch {}

  // 3. Mark invite accepted
  await updateDoc(doc(db, 'workspaceInvites', inviteId), {
    status: 'accepted', respondedAt: serverTimestamp(),
  });
}

/**
 * Invitee declines → marks invite rejected + notifies inviter.
 */
export async function rejectWorkspaceInvite(invite, userEmail) {
  const { id: inviteId, inviterEmail, workspaceName } = invite;

  // 1. Mark invite rejected
  await updateDoc(doc(db, 'workspaceInvites', inviteId), {
    status: 'rejected', respondedAt: serverTimestamp(),
  });

  // 2. Send in-app notification to the inviter
  await addDoc(collection(db, 'notifications'), {
    recipientEmail: inviterEmail,
    type:           'invite_rejected',
    title:          'Workspace invite declined',
    body:           `${userEmail} declined your invite to "${workspaceName}"`,
    senderEmail:    userEmail,
    createdAt:      serverTimestamp(),
    read:           false,
  });
}

// ─── Leave-workspace request flow ─────────────────────────────────────────────
//
// Members cannot leave immediately — they submit a request which the workspace
// owner must approve.  On approval the member doc is deleted and the workspace
// disappears from the leaver's list.  On denial the member stays and receives
// an in-app notification.

/** Real-time listener: pending leave requests for a workspace (owner view) */
export function usePendingLeaveRequests(workspaceId) {
  const [requests, setRequests] = useState([]);
  const [loading,  setLoading]  = useState(true);

  useEffect(() => {
    if (!workspaceId) { setRequests([]); setLoading(false); return; }
    const q = query(
      collection(db, 'workspaceLeaveRequests'),
      where('workspaceId', '==', workspaceId),
      where('status',      '==', 'pending'),
      orderBy('createdAt', 'desc')
    );
    const unsub = onSnapshot(q,
      snap => { setRequests(snap.docs.map(d => ({ id: d.id, ...d.data() }))); setLoading(false); },
      ()   => setLoading(false)
    );
    return unsub;
  }, [workspaceId]);

  return { requests, loading };
}

/** Member submits a leave request */
export async function requestLeave(workspaceId, workspaceName, user, ownerEmail) {
  // Deterministic ID prevents duplicate requests
  const reqId = `${workspaceId}_${user.uid}`;
  await setDoc(doc(db, 'workspaceLeaveRequests', reqId), {
    workspaceId, workspaceName,
    memberUid:    user.uid,
    memberEmail:  user.email,
    memberName:   user.displayName || user.email,
    ownerEmail,
    status:       'pending',
    createdAt:    serverTimestamp(),
  });
  // Notify the owner in-app
  await addDoc(collection(db, 'notifications'), {
    recipientEmail: ownerEmail,
    type:           'leave_request',
    title:          'Leave request',
    body:           `${user.displayName || user.email} wants to leave "${workspaceName}"`,
    senderEmail:    user.email,
    createdAt:      serverTimestamp(),
    read:           false,
  });
}

/** Owner approves the leave request — removes the member */
export async function approveLeave(request) {
  const { id: reqId, workspaceId, memberUid, memberEmail, memberName, workspaceName } = request;
  // Remove member doc
  await removeWorkspaceMember(workspaceId, memberUid);
  // Delete request doc
  await deleteDoc(doc(db, 'workspaceLeaveRequests', reqId));
  // Notify the member
  await addDoc(collection(db, 'notifications'), {
    recipientEmail: memberEmail,
    type:           'leave_approved',
    title:          'Leave request approved',
    body:           `You have been removed from "${workspaceName}"`,
    senderEmail:    null,
    createdAt:      serverTimestamp(),
    read:           false,
  });
}

/** Owner denies the leave request — member stays */
export async function denyLeave(request) {
  const { id: reqId, memberEmail, memberName, workspaceName, ownerEmail } = request;
  // Delete request doc
  await deleteDoc(doc(db, 'workspaceLeaveRequests', reqId));
  // Notify the member that they were denied
  await addDoc(collection(db, 'notifications'), {
    recipientEmail: memberEmail,
    type:           'leave_denied',
    title:          'Leave request denied',
    body:           `Your request to leave "${workspaceName}" was denied by the workspace admin`,
    senderEmail:    ownerEmail,
    createdAt:      serverTimestamp(),
    read:           false,
  });
}
