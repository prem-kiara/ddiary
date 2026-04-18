import { useState, useEffect, useCallback } from 'react';
import {
  collection, collectionGroup, doc, addDoc, updateDoc, deleteDoc, setDoc, getDoc,
  query, orderBy, where, onSnapshot, serverTimestamp,
  writeBatch
} from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { createLogger, logError } from '../utils/errorLogger';
import {
  writeNotification,
  notifyInApp_TaskAssigned,
  notifyInApp_StatusChanged,
  notifyInApp_Comment,
  notifyInApp_Reassigned,
} from '../utils/writeNotification';

// ─── SharePoint upload (Dhanam Repository → DDiary folder) ───────────────
const SP_DRIVE_ID = import.meta.env.VITE_SHAREPOINT_DRIVE_ID;
const MS_TOKEN_KEY = 'ddiary_ms_access_token';

/** Sentinel error thrown when the MS Graph token is expired or revoked. */
export class MsTokenExpiredError extends Error {
  constructor() {
    super('Microsoft token expired — please sign in again');
    this.name = 'MsTokenExpiredError';
  }
}

/**
 * Upload a data URL (base64 image) to SharePoint.
 * Files go to: Dhanam Repository / Shared Documents / DDiary / drawings / {userEmail} /
 * Returns the SharePoint web URL for the uploaded file.
 * Throws MsTokenExpiredError on HTTP 401 so callers can refresh the token and retry.
 */
async function uploadToSharePoint(dataUrl, userEmail) {
  const msToken = sessionStorage.getItem(MS_TOKEN_KEY);
  if (!msToken) throw new MsTokenExpiredError();
  if (!SP_DRIVE_ID) throw new Error('SharePoint Drive ID not configured');

  // Convert data URL to Blob
  const response = await fetch(dataUrl);
  const blob = await response.blob();

  // Build a unique filename
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const randomId = Math.random().toString(36).slice(2, 8);
  const ext = blob.type === 'image/png' ? 'png' : 'jpg';
  const safeEmail = (userEmail || 'unknown').replace(/[^a-zA-Z0-9@._-]/g, '_');
  const filePath = `DDiary/drawings/${safeEmail}/drawing_${timestamp}_${randomId}.${ext}`;

  // Upload via Graph API — PUT /drives/{driveId}/root:/{path}:/content
  const uploadRes = await fetch(
    `https://graph.microsoft.com/v1.0/drives/${SP_DRIVE_ID}/root:/${filePath}:/content`,
    {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${msToken}`,
        'Content-Type': blob.type,
      },
      body: blob,
    }
  );

  if (uploadRes.status === 401) {
    throw new MsTokenExpiredError();
  }
  if (!uploadRes.ok) {
    const errData = await uploadRes.json().catch(() => ({}));
    throw new Error(`SharePoint upload failed: ${uploadRes.status} — ${errData?.error?.message || 'Unknown error'}`);
  }

  const data = await uploadRes.json();

  // Create a sharing link so the image is viewable without auth
  try {
    const shareRes = await fetch(
      `https://graph.microsoft.com/v1.0/drives/${SP_DRIVE_ID}/items/${data.id}/createLink`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${msToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ type: 'view', scope: 'organization' }),
      }
    );
    if (shareRes.ok) {
      const shareData = await shareRes.json();
      return shareData.link?.webUrl || data.webUrl;
    }
  } catch {
    // Fall back to direct webUrl if sharing link fails
  }

  return data.webUrl;
}

// ─── Diary Entries Hook ───────────────────────────────────────────────────
export function useEntries() {
  const { user, refreshMsToken } = useAuth();
  const [entries, setEntries]               = useState([]);
  const [trashedEntries, setTrashedEntries] = useState([]);
  const [archivedEntries, setArchivedEntries] = useState([]);
  const [loading, setLoading]               = useState(true);

  useEffect(() => {
    if (!user) { setEntries([]); setTrashedEntries([]); setLoading(false); return; }

    const log = createLogger('useEntries', user.uid);
    const q   = query(
      collection(db, 'users', user.uid, 'entries'),
      orderBy('createdAt', 'desc')
    );

    const unsub = onSnapshot(q, (snap) => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setEntries(data.filter(e => !e.deletedAt && !e.archived));
      setArchivedEntries(data.filter(e => !e.deletedAt && !!e.archived));
      setTrashedEntries(data.filter(e => !!e.deletedAt));
      setLoading(false);
    }, (err) => { log(err, { action: 'onSnapshot' }); setLoading(false); });

    return unsub;
  }, [user]);

  /**
   * Upload a drawing, retrying once after a token refresh on 401.
   * Returns the SharePoint URL on success, or null on failure.
   */
  const uploadDrawingSafe = useCallback(async (dataUrl, logCtx) => {
    try {
      return await uploadToSharePoint(dataUrl, user.email);
    } catch (err) {
      if (err instanceof MsTokenExpiredError) {
        // Try refreshing the MS token, then retry the upload once
        const newToken = await refreshMsToken().catch(() => null);
        if (newToken) {
          try { return await uploadToSharePoint(dataUrl, user.email); }
          catch (retryErr) { logCtx(retryErr, { action: 'uploadDrawing:retry' }); }
        } else {
          logCtx(err, { action: 'uploadDrawing:tokenExpired' });
        }
      } else {
        logCtx(err, { action: 'uploadDrawing' });
      }
      return null;
    }
  }, [user, refreshMsToken]);

  const addEntry = useCallback(async (entry) => {
    if (!user) return;
    const log = createLogger('useEntries:addEntry', user.uid);
    const col = collection(db, 'users', user.uid, 'entries');
    const drawingUrls = [];
    if (entry.drawings?.length) {
      for (let i = 0; i < entry.drawings.length; i++) {
        const url = await uploadDrawingSafe(entry.drawings[i], log);
        if (url) drawingUrls.push(url);
      }
    }
    return addDoc(col, { ...entry, drawings: drawingUrls, deletedAt: null, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  }, [user, uploadDrawingSafe]);

  const updateEntry = useCallback(async (id, updates) => {
    if (!user) return;
    const log = createLogger('useEntries:updateEntry', user.uid);
    const docRef = doc(db, 'users', user.uid, 'entries', id);
    if (updates.drawings) {
      const drawingUrls = [];
      for (const drawing of updates.drawings) {
        if (drawing.startsWith('data:')) {
          const url = await uploadDrawingSafe(drawing, log);
          if (url) drawingUrls.push(url);
        } else {
          drawingUrls.push(drawing);
        }
      }
      updates.drawings = drawingUrls;
    }
    return updateDoc(docRef, { ...updates, updatedAt: serverTimestamp() });
  }, [user, uploadDrawingSafe]);

  const deleteEntry = useCallback(async (id) => {
    if (!user) return;
    return updateDoc(doc(db, 'users', user.uid, 'entries', id), { deletedAt: new Date().toISOString(), updatedAt: serverTimestamp() });
  }, [user]);

  const restoreEntry = useCallback(async (id) => {
    if (!user) return;
    return updateDoc(doc(db, 'users', user.uid, 'entries', id), { deletedAt: null, updatedAt: serverTimestamp() });
  }, [user]);

  const purgeEntry = useCallback(async (id) => {
    if (!user) return;
    return deleteDoc(doc(db, 'users', user.uid, 'entries', id));
  }, [user]);

  const archiveEntry = useCallback(async (id) => {
    if (!user) return;
    return updateDoc(doc(db, 'users', user.uid, 'entries', id), { archived: true, archivedAt: new Date().toISOString(), updatedAt: serverTimestamp() });
  }, [user]);

  const unarchiveEntry = useCallback(async (id) => {
    if (!user) return;
    return updateDoc(doc(db, 'users', user.uid, 'entries', id), { archived: false, archivedAt: null, updatedAt: serverTimestamp() });
  }, [user]);

  return {
    entries, trashedEntries, archivedEntries, loading,
    addEntry, updateEntry, deleteEntry, restoreEntry, purgeEntry, archiveEntry, unarchiveEntry,
  };
}

// ─── Tasks Hook (owner) ───────────────────────────────────────────────────
export function useTasks() {
  const { user } = useAuth();
  const [tasks, setTasks]   = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) { setTasks([]); setLoading(false); return; }

    const log = createLogger('useTasks', user.uid);
    const q   = query(collection(db, 'users', user.uid, 'tasks'), orderBy('createdAt', 'desc'));

    const unsub = onSnapshot(q, (snap) => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      data.sort((a, b) => {
        if (a.completed !== b.completed) return a.completed ? 1 : -1;
        const aDate = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
        const bDate = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
        return aDate - bDate;
      });
      setTasks(data);
      setLoading(false);
    }, (err) => { log(err, { action: 'onSnapshot' }); setLoading(false); });

    return unsub;
  }, [user]);

  const addTask = useCallback(async (task) => {
    if (!user) return;
    const log = createLogger('useTasks:addTask', user.uid);
    // Always lowercase the email so Firestore where-equality queries match reliably
    const assigneeEmail = task.assigneeEmail?.trim().toLowerCase() || null;
    const assigneeName  = task.assigneeName?.trim() || null;
    const ref = await addDoc(collection(db, 'users', user.uid, 'tasks'), {
      text:          task.text?.trim() || '',
      dueDate:       task.dueDate || null,
      priority:      task.priority || 'medium',
      reminder:      true,
      assigneeEmail,
      assigneeName,
      assigneePhone: task.assigneePhone?.trim() || null,
      assigneeUid:   null,
      ownerId:       user.uid,
      ownerName:     user.displayName || user.email,
      status:        'open',
      completed:     false,
      createdAt:     serverTimestamp(),
      updatedAt:     serverTimestamp(),
    });
    await _logActivity(user.uid, ref.id, {
      actorUid:  user.uid,
      actorName: user.displayName || user.email,
      action:    'created',
      detail:    assigneeName
        ? `Task created and assigned to ${assigneeName}`
        : 'Task created',
    });

    // Send email + in-app notification to assignee (fire-and-forget)
    if (assigneeEmail) {
      import('../utils/emailNotifications').then(({ notifyTaskAssigned }) => {
        notifyTaskAssigned({
          assigneeEmail,
          assigneeName,
          taskText: task.text?.trim() || '',
          dueDate: task.dueDate || null,
          priority: task.priority || 'medium',
          ownerName: user.displayName || user.email,
          ownerUid: user.uid,
        }).catch(err => log(err, { action: 'notifyTaskAssigned' }));
      });

      notifyInApp_TaskAssigned({
        assigneeEmail,
        assigneeName,
        taskText: task.text?.trim() || '',
        ownerName: user.displayName || user.email,
        ownerUid: user.uid,
        taskId: ref.id,
      }).catch(err => log(err, { action: 'notifyInApp_TaskAssigned' }));
    }

    return ref;
  }, [user]);

  const updateTask = useCallback(async (id, updates) => {
    if (!user) return;
    const log = createLogger('useTasks:updateTask', user.uid);
    const sanitized = { ...updates };
    // Ensure assigneeEmail is always lowercase so queries match
    if (sanitized.assigneeEmail !== undefined) {
      sanitized.assigneeEmail = sanitized.assigneeEmail?.trim().toLowerCase() || null;
    }

    // Check if the assignee changed so we can send a notification
    let previousAssigneeEmail = null;
    if (sanitized.assigneeEmail) {
      try {
        const snap = await getDoc(doc(db, 'users', user.uid, 'tasks', id));
        if (snap.exists()) {
          previousAssigneeEmail = snap.data().assigneeEmail || null;
        }
      } catch { /* non-fatal */ }
    }

    await updateDoc(doc(db, 'users', user.uid, 'tasks', id), {
      ...sanitized,
      updatedAt: serverTimestamp(),
    });

    // If assignee was set or changed, email the new assignee (fire-and-forget)
    const newAssignee = sanitized.assigneeEmail;
    if (newAssignee && newAssignee !== previousAssigneeEmail) {
      await _logActivity(user.uid, id, {
        actorUid:  user.uid,
        actorName: user.displayName || user.email,
        action:    'reassigned',
        detail:    `Task assigned to ${sanitized.assigneeName || newAssignee}`,
      });

      import('../utils/emailNotifications').then(({ notifyTaskAssigned }) => {
        notifyTaskAssigned({
          assigneeEmail: newAssignee,
          assigneeName:  sanitized.assigneeName || null,
          taskText:      sanitized.text || '',
          dueDate:       sanitized.dueDate || null,
          priority:      sanitized.priority || 'medium',
          ownerName:     user.displayName || user.email,
          ownerUid:      user.uid,
        }).catch(err => log(err, { action: 'notifyTaskAssigned' }));
      });

      notifyInApp_Reassigned({
        assigneeEmail: newAssignee,
        assigneeName:  sanitized.assigneeName || null,
        taskText:      sanitized.text || '',
        ownerName:     user.displayName || user.email,
        ownerUid:      user.uid,
        taskId:        id,
      }).catch(err => log(err, { action: 'notifyInApp_Reassigned' }));
    }
  }, [user]);

  const toggleTask = useCallback(async (id, currentState) => {
    if (!user) return;
    const log = createLogger('useTasks:toggleTask', user.uid);
    const newCompleted = !currentState;
    const completedAt = newCompleted ? new Date().toISOString() : null;
    await updateDoc(doc(db, 'users', user.uid, 'tasks', id), {
      completed:   newCompleted,
      status:      newCompleted ? 'done' : 'open',
      completedAt,
      updatedAt:   serverTimestamp(),
    });
    await _logActivity(user.uid, id, {
      actorUid:  user.uid,
      actorName: user.displayName || user.email,
      action:    newCompleted ? 'completed' : 'reopened',
      detail:    newCompleted ? 'Marked as done' : 'Reopened',
    });

    // Notify assignee when owner toggles their task (fire-and-forget).
    // When completing: use notifyTaskCompleted for a richer email.
    // When reopening:  use notifyStatusChanged to inform the assignee.
    try {
      const snap = await getDoc(doc(db, 'users', user.uid, 'tasks', id));
      if (snap.exists()) {
        const task = snap.data();
        if (task.assigneeEmail) {
          if (newCompleted) {
            import('../utils/emailNotifications').then(({ notifyTaskCompleted }) => {
              notifyTaskCompleted({
                ownerEmail:    task.assigneeEmail,
                ownerName:     task.assigneeName || task.assigneeEmail,
                assigneeName:  user.displayName  || user.email,
                taskText:      task.text         || 'A task',
                completedAt,
              }).catch(err => log(err, { action: 'notifyTaskCompleted' }));
            });
          } else {
            import('../utils/emailNotifications').then(({ notifyStatusChanged }) => {
              notifyStatusChanged({
                ownerEmail:   task.assigneeEmail,
                ownerName:    task.assigneeName || task.assigneeEmail,
                assigneeName: user.displayName  || user.email,
                taskText:     task.text         || 'A task',
                newStatus:    'open',
              }).catch(err => log(err, { action: 'notifyStatusChanged' }));
            });
          }

          notifyInApp_StatusChanged({
            recipientEmail: task.assigneeEmail,
            recipientName:  task.assigneeName,
            assigneeName:   user.displayName || user.email,
            taskText:       task.text        || 'A task',
            newStatus:      newCompleted ? 'done' : 'open',
            taskId: id,
            ownerUid: user.uid,
          }).catch(err => log(err, { action: 'notifyInApp_StatusChanged' }));
        }
      }
    } catch { /* non-fatal */ }
  }, [user]);

  const deleteTask = useCallback(async (id) => {
    if (!user) return;
    return deleteDoc(doc(db, 'users', user.uid, 'tasks', id));
  }, [user]);

  const clearCompleted = useCallback(async () => {
    if (!user) return;
    const completedTasks = tasks.filter(t => t.completed);
    if (!completedTasks.length) return;
    const batch = writeBatch(db);
    completedTasks.forEach(t => {
      batch.delete(doc(db, 'users', user.uid, 'tasks', t.id));
    });
    try {
      await batch.commit();
    } catch (err) {
      logError(err, { location: 'useTasks:clearCompleted', action: 'batchCommit' });
      // Re-throw so callers can show a toast
      throw err;
    }
  }, [user, tasks]);

  return { tasks, loading, addTask, updateTask, toggleTask, deleteTask, clearCompleted };
}

// ─── Assigned Tasks Hook (tasks assigned to me by ANYONE) ────────────────
// Uses a collection-group query across all users' task collections.
// Finds every task where assigneeEmail matches the current user's email,
// then filters out tasks the user created themselves (those are in useTasks).
export function useAssignedTasks() {
  const { user } = useAuth();
  const [tasks,   setTasks]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  useEffect(() => {
    if (!user?.email) { setTasks([]); setLoading(false); return; }

    const q = query(
      collectionGroup(db, 'tasks'),
      where('assigneeEmail', '==', user.email.toLowerCase()),
      orderBy('createdAt', 'desc')
    );

    const unsub = onSnapshot(q, (snap) => {
      const data = snap.docs.map(d => ({
        id:        d.id,
        _ownerUid: d.ref.parent.parent?.id || null,
        // Top-level collection: "users" for personal tasks, "workspaces" for shared ones
        _parentCollection: d.ref.parent.parent?.parent?.id || null,
        ...d.data(),
      }));
      // Keep only personal tasks (in someone else's users/{uid}/tasks).
      // Workspace tasks are shown inside the workspace itself, not in "Assigned to Me".
      // Also hide any task that I've already pushed to a Team Board via
      // "Send to Team Board" — it lives as a workspace card now; no point
      // showing it in my assigned list too. The original owner still sees
      // it in their personal tasks (with a "moved to X" badge).
      setTasks(data.filter(t =>
        t._parentCollection === 'users' &&
        t.ownerId !== user.uid &&
        !t.movedToWorkspace
      ));
      setLoading(false);
      setError(null);
    }, (err) => {
      logError(err, { location: 'useAssignedTasks', action: 'onSnapshot' });
      setError(err.message);
      setLoading(false);
    });

    return unsub;
  }, [user?.email, user?.uid]);

  return { tasks, loading, error };
}

// ─── Task Comments Hook ───────────────────────────────────────────────────
export function useTaskComments(ownerUid, taskId) {
  const [comments, setComments] = useState([]);
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    if (!ownerUid || !taskId) { setComments([]); setLoading(false); return; }

    const q = query(
      collection(db, 'users', ownerUid, 'tasks', taskId, 'comments'),
      orderBy('createdAt', 'asc')
    );
    const unsub = onSnapshot(q, (snap) => {
      setComments(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setLoading(false);
    }, () => setLoading(false));

    return unsub;
  }, [ownerUid, taskId]);

  return { comments, loading };
}

// ─── Task Activity Hook ───────────────────────────────────────────────────
export function useTaskActivity(ownerUid, taskId) {
  const [activity, setActivity] = useState([]);

  useEffect(() => {
    if (!ownerUid || !taskId) { setActivity([]); return; }

    const q = query(
      collection(db, 'users', ownerUid, 'tasks', taskId, 'activity'),
      orderBy('createdAt', 'asc')
    );
    const unsub = onSnapshot(
      q,
      (snap) => setActivity(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      (err)  => {
        logError(err, { location: 'useTaskActivity', ownerUid, taskId });
        // Stop listening so the dead listener doesn't accumulate
        unsub?.();
      }
    );

    return unsub;
  }, [ownerUid, taskId]);

  return { activity };
}

// ─── User Directory Hook (owner sees who has joined) ─────────────────────
// Reads /userDirectory where invitedBy == ownerUid, then auto-links
// to teamMembers by email if not already linked.
export function useUserDirectory(ownerUid) {
  const [directory, setDirectory] = useState([]);

  useEffect(() => {
    if (!ownerUid) { setDirectory([]); return; }

    const q = query(
      collection(db, 'userDirectory'),
      where('invitedBy', '==', ownerUid)
    );
    const unsub = onSnapshot(q, (snap) => {
      setDirectory(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, () => {});

    return unsub;
  }, [ownerUid]);

  return { directory };
}

// ─── Standalone helpers (callable outside hooks) ─────────────────────────

/** Add a comment to a task. Also emails the other party. */
export async function addComment(ownerUid, taskId, { authorUid, authorName, text, taskText, recipientEmail, recipientName }) {
  await addDoc(
    collection(db, 'users', ownerUid, 'tasks', taskId, 'comments'),
    { authorUid, authorName, text, createdAt: serverTimestamp() }
  );
  // Mirror as an activity entry
  await _logActivity(ownerUid, taskId, {
    actorUid: authorUid, actorName: authorName,
    action: 'commented', detail: text,
  });

  // Email + in-app notification for new comment (fire-and-forget)
  if (recipientEmail) {
    import('../utils/emailNotifications').then(({ notifyNewComment }) => {
      notifyNewComment({
        recipientEmail,
        recipientName: recipientName || '',
        commenterName: authorName,
        taskText: taskText || 'A task',
        commentText: text,
      }).catch(err => logError(err, { location: 'addComment', action: 'notify' }));
    });

    notifyInApp_Comment({
      recipientEmail,
      commenterName: authorName,
      taskText: taskText || 'A task',
      commentText: text,
      taskId,
      ownerUid,
    }).catch(err => logError(err, { location: 'addComment', action: 'notify' }));
  }
}

/** Update a task's status and log the change. Also sends email notifications. */
export async function updateTaskStatus(ownerUid, taskId, { status, actorUid, actorName, taskText, ownerEmail, ownerName, assigneeName }) {
  const label = { open: 'Open', in_progress: 'In Progress', review: 'Review', done: 'Done' };
  const completedAt = status === 'done' ? new Date().toISOString() : null;
  await updateDoc(doc(db, 'users', ownerUid, 'tasks', taskId), {
    status,
    completed:   status === 'done',
    completedAt,
    updatedAt:   serverTimestamp(),
  });
  await _logActivity(ownerUid, taskId, {
    actorUid, actorName,
    action: 'status_changed',
    detail: `Status → ${label[status] || status}`,
  });

  // Email + in-app notification to task owner (fire-and-forget)
  if (ownerEmail && actorUid !== ownerUid) {
    if (status === 'done') {
      import('../utils/emailNotifications').then(({ notifyTaskCompleted }) => {
        notifyTaskCompleted({
          ownerEmail,
          ownerName: ownerName || '',
          assigneeName: assigneeName || actorName,
          taskText: taskText || 'A task',
          completedAt,
        }).catch(err => logError(err, { location: 'updateTaskStatus', action: 'notify' }));
      });
    } else {
      import('../utils/emailNotifications').then(({ notifyStatusChanged }) => {
        notifyStatusChanged({
          ownerEmail,
          ownerName: ownerName || '',
          assigneeName: assigneeName || actorName,
          taskText: taskText || 'A task',
          newStatus: status,
        }).catch(err => logError(err, { location: 'updateTaskStatus', action: 'notify' }));
      });
    }

    notifyInApp_StatusChanged({
      recipientEmail: ownerEmail,
      recipientName: ownerName,
      assigneeName: assigneeName || actorName,
      taskText: taskText || 'A task',
      newStatus: status,
      taskId,
      ownerUid,
    }).catch(err => logError(err, { location: 'updateTaskStatus', action: 'notify' }));
  }
}

/**
 * Reassign a task that was assigned to me onto someone else.
 *
 * The task lives in the ORIGINAL OWNER'S tasks collection
 * (users/{ownerUid}/tasks/{taskId}) — I'm only allowed to update it because
 * Firestore rules let any current assignee update. We write the new
 * assignee fields, log a "reassigned" activity entry, and fire:
 *   - in-app + email notification to the NEW assignee (so they see it)
 *   - in-app notification to the ORIGINAL OWNER (so they know I handed it off)
 *
 * After the update, the task naturally disappears from my "Assigned to Me"
 * (because the collection-group query filters by assigneeEmail == my email).
 */
export async function reassignAssignedTask(ownerUid, taskId, {
  newAssigneeEmail, newAssigneeName, newAssigneeUid,
  actor,             // { uid, email, displayName } — the current user (me)
  ownerEmail,        // original owner's email (for notification) — auto-looked-up if absent
  ownerName,         // original owner's display name
  taskText,          // for the notification body
}) {
  const emailLower = newAssigneeEmail?.trim().toLowerCase() || null;
  if (!emailLower) throw new Error('reassignAssignedTask: newAssigneeEmail is required');

  // Best-effort owner-email lookup so in-app notification actually lands.
  if (!ownerEmail && ownerUid && ownerUid !== actor?.uid) {
    try {
      const snap = await getDoc(doc(db, 'users', ownerUid));
      if (snap.exists()) ownerEmail = snap.data().email || null;
    } catch { /* non-fatal */ }
  }

  await updateDoc(doc(db, 'users', ownerUid, 'tasks', taskId), {
    assigneeEmail: emailLower,
    assigneeName:  newAssigneeName || null,
    assigneeUid:   newAssigneeUid  || null,
    updatedAt:     serverTimestamp(),
  });

  // Activity log — best-effort
  try {
    await _logActivity(ownerUid, taskId, {
      actorUid:  actor.uid,
      actorName: actor.displayName || actor.email,
      action:    'reassigned',
      detail:    `Reassigned to ${newAssigneeName || emailLower}`,
    });
  } catch { /* non-fatal */ }

  // Notify the NEW assignee (email + in-app)
  try {
    const { notifyTaskAssigned } = await import('../utils/emailNotifications');
    notifyTaskAssigned({
      assigneeEmail: emailLower,
      assigneeName:  newAssigneeName || null,
      taskText:      taskText || 'A task',
      ownerName:     actor.displayName || actor.email,
      ownerUid,
    }).catch(err => console.warn('reassignAssignedTask:notifyTaskAssigned', err));
  } catch { /* non-fatal */ }

  notifyInApp_Reassigned({
    assigneeEmail: emailLower,
    assigneeName:  newAssigneeName || null,
    taskText:      taskText || 'A task',
    ownerName:     actor.displayName || actor.email,
    ownerUid,
    taskId,
  }).catch(err => console.warn('reassignAssignedTask:notifyInApp_Reassigned', err));

  // Notify the ORIGINAL OWNER in-app so they know I handed it off.
  // (Only notify if we know their email and it's not the same person.)
  if (ownerEmail && ownerEmail.toLowerCase() !== actor.email?.toLowerCase()) {
    writeNotification({
      recipientEmail: ownerEmail,
      type:           'reassigned_by_assignee',
      title:          'Task reassigned',
      body:           `${actor.displayName || actor.email} reassigned "${taskText || 'a task'}" to ${newAssigneeName || emailLower}`,
      senderName:     actor.displayName || actor.email,
      taskId,
      ownerUid,
    }).catch(err => console.warn('reassignAssignedTask:notifyOwner', err));
  }
}

/**
 * Mark a task (that lives in someone else's collection) as having been
 * pushed to a Team Board. The original owner still sees it in their
 * personal list with a "Moved to X Board" badge; it's hidden from the
 * assignee's "Assigned to Me" via the useAssignedTasks filter.
 */
export async function markTaskMovedToWorkspace(ownerUid, taskId, {
  workspaceId, workspaceName, workspaceTaskId,
  actor,   // { uid, email, displayName } — the current user (me)
  ownerEmail, ownerName, taskText,
}) {
  // Best-effort owner-email lookup so in-app notification actually lands.
  if (!ownerEmail && ownerUid && ownerUid !== actor?.uid) {
    try {
      const snap = await getDoc(doc(db, 'users', ownerUid));
      if (snap.exists()) ownerEmail = snap.data().email || null;
    } catch { /* non-fatal */ }
  }

  await updateDoc(doc(db, 'users', ownerUid, 'tasks', taskId), {
    movedToWorkspace: {
      workspaceId,
      workspaceName:    workspaceName || null,
      workspaceTaskId:  workspaceTaskId || null,
      movedAt:          new Date().toISOString(),
      movedByUid:       actor.uid,
      movedByName:      actor.displayName || actor.email,
    },
    updatedAt: serverTimestamp(),
  });

  // Activity log — best-effort
  try {
    await _logActivity(ownerUid, taskId, {
      actorUid:  actor.uid,
      actorName: actor.displayName || actor.email,
      action:    'moved',
      detail:    `→ ${workspaceName || 'Team Board'}`,
    });
  } catch { /* non-fatal */ }

  // Notify the original owner in-app so they know the task moved.
  if (ownerEmail && ownerEmail.toLowerCase() !== actor.email?.toLowerCase()) {
    writeNotification({
      recipientEmail: ownerEmail,
      type:           'moved_to_workspace',
      title:          'Task moved to Team Board',
      body:           `${actor.displayName || actor.email} moved "${taskText || 'a task'}" to "${workspaceName || 'a Team Board'}"`,
      senderName:     actor.displayName || actor.email,
      taskId,
      ownerUid,
      workspaceId,
    }).catch(err => console.warn('markTaskMovedToWorkspace:notifyOwner', err));
  }
}

/** Log an activity event (internal helper, also exported for external use). */
export async function _logActivity(ownerUid, taskId, { actorUid, actorName, action, detail }) {
  await addDoc(
    collection(db, 'users', ownerUid, 'tasks', taskId, 'activity'),
    { actorUid, actorName, action, detail, createdAt: serverTimestamp() }
  );
}

/** Write a user-directory entry so the owner can discover this member. */
export async function writeUserDirectory(uid, { email, displayName, invitedBy }) {
  await setDoc(doc(db, 'userDirectory', uid), {
    uid, email, displayName, invitedBy, createdAt: new Date().toISOString(),
  });
}

/** Fetch a single task doc (used when syncing status from team member side). */
export async function getTask(ownerUid, taskId) {
  const snap = await getDoc(doc(db, 'users', ownerUid, 'tasks', taskId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

// ─── Team Members Hook ────────────────────────────────────────────────────
export function useTeamMembers() {
  const { user } = useAuth();
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) { setMembers([]); setLoading(false); return; }

    const unsub = onSnapshot(
      collection(db, 'users', user.uid, 'teamMembers'),
      (snap) => {
        const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        data.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        setMembers(data);
        setLoading(false);
      },
      (err) => { logError(err, { location: 'useTeamMembers', action: 'onSnapshot' }); setLoading(false); }
    );

    return unsub;
  }, [user]);

  const addMember = useCallback(async (member) => {
    if (!user) return;
    return addDoc(collection(db, 'users', user.uid, 'teamMembers'), {
      ...member, uid: null, createdAt: serverTimestamp(),
    });
  }, [user]);

  const addMembersBulk = useCallback(async (newMembers) => {
    if (!user || !newMembers.length) return;
    const batch = writeBatch(db);
    newMembers.forEach(m => {
      const ref = doc(collection(db, 'users', user.uid, 'teamMembers'));
      batch.set(ref, { ...m, uid: null, createdAt: serverTimestamp() });
    });
    return batch.commit();
  }, [user]);

  const updateMember = useCallback(async (id, updates) => {
    if (!user) return;
    return updateDoc(doc(db, 'users', user.uid, 'teamMembers', id), updates);
  }, [user]);

  const deleteMember = useCallback(async (id) => {
    if (!user) return;
    return deleteDoc(doc(db, 'users', user.uid, 'teamMembers', id));
  }, [user]);

  return { members, loading, addMember, addMembersBulk, updateMember, deleteMember };
}
