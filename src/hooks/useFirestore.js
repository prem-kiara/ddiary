import { useState, useEffect, useCallback } from 'react';
import {
  collection, collectionGroup, doc, addDoc, updateDoc, deleteDoc, setDoc, getDoc,
  query, orderBy, where, onSnapshot, serverTimestamp,
  writeBatch
} from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { createLogger } from '../utils/errorLogger';
import {
  notifyInApp_TaskAssigned,
  notifyInApp_StatusChanged,
  notifyInApp_Comment,
  notifyInApp_Reassigned,
} from '../utils/writeNotification';

// ─── SharePoint upload (Dhanam Repository → DDiary folder) ───────────────
const SP_DRIVE_ID = import.meta.env.VITE_SHAREPOINT_DRIVE_ID;
const MS_TOKEN_KEY = 'ddiary_ms_access_token';

/**
 * Upload a data URL (base64 image) to SharePoint.
 * Files go to: Dhanam Repository / Shared Documents / DDiary / drawings / {userEmail} /
 * Returns the SharePoint web URL for the uploaded file.
 */
async function uploadToSharePoint(dataUrl, userEmail) {
  const msToken = sessionStorage.getItem(MS_TOKEN_KEY);
  if (!msToken) throw new Error('Microsoft token not available — please sign in again');
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
    throw new Error('Microsoft token expired — please sign out and sign in again');
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
  const { user } = useAuth();
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

  const addEntry = useCallback(async (entry) => {
    if (!user) return;
    const log = createLogger('useEntries', user.uid);
    const col = collection(db, 'users', user.uid, 'entries');
    const drawingUrls = [];
    if (entry.drawings?.length) {
      for (let i = 0; i < entry.drawings.length; i++) {
        try { drawingUrls.push(await uploadToSharePoint(entry.drawings[i], user.email)); }
        catch (err) { log(err, { action: 'uploadDrawing', index: i }); }
      }
    }
    return addDoc(col, { ...entry, drawings: drawingUrls, deletedAt: null, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  }, [user]);

  const updateEntry = useCallback(async (id, updates) => {
    if (!user) return;
    const log = createLogger('useEntries', user.uid);
    const docRef = doc(db, 'users', user.uid, 'entries', id);
    if (updates.drawings) {
      const drawingUrls = [];
      for (const drawing of updates.drawings) {
        if (drawing.startsWith('data:')) {
          try { drawingUrls.push(await uploadToSharePoint(drawing, user.email)); }
          catch (err) { log(err, { action: 'uploadDrawing' }); }
        } else { drawingUrls.push(drawing); }
      }
      updates.drawings = drawingUrls;
    }
    return updateDoc(docRef, { ...updates, updatedAt: serverTimestamp() });
  }, [user]);

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
        }).catch(() => {});
      });

      notifyInApp_TaskAssigned({
        assigneeEmail,
        assigneeName,
        taskText: task.text?.trim() || '',
        ownerName: user.displayName || user.email,
        ownerUid: user.uid,
        taskId: ref.id,
      }).catch(() => {});
    }

    return ref;
  }, [user]);

  const updateTask = useCallback(async (id, updates) => {
    if (!user) return;
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
        }).catch(() => {});
      });

      notifyInApp_Reassigned({
        assigneeEmail: newAssignee,
        assigneeName:  sanitized.assigneeName || null,
        taskText:      sanitized.text || '',
        ownerName:     user.displayName || user.email,
        ownerUid:      user.uid,
        taskId:        id,
      }).catch(() => {});
    }
  }, [user]);

  const toggleTask = useCallback(async (id, currentState) => {
    if (!user) return;
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

    // Notify assignee when owner toggles their task (fire-and-forget)
    try {
      const snap = await getDoc(doc(db, 'users', user.uid, 'tasks', id));
      if (snap.exists()) {
        const task = snap.data();
        if (task.assigneeEmail) {
          const notifStatus = newCompleted ? 'done' : 'open';
          import('../utils/emailNotifications').then(({ notifyStatusChanged }) => {
            notifyStatusChanged({
              ownerEmail: task.assigneeEmail,
              ownerName: task.assigneeName || task.assigneeEmail,
              assigneeName: user.displayName || user.email,
              taskText: task.text || 'A task',
              newStatus: notifStatus,
            }).catch(() => {});
          });

          notifyInApp_StatusChanged({
            recipientEmail: task.assigneeEmail,
            recipientName: task.assigneeName,
            assigneeName: user.displayName || user.email,
            taskText: task.text || 'A task',
            newStatus: notifStatus,
            taskId: id,
            ownerUid: user.uid,
          }).catch(() => {});
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
    const batch = writeBatch(db);
    tasks.filter(t => t.completed).forEach(t => {
      batch.delete(doc(db, 'users', user.uid, 'tasks', t.id));
    });
    return batch.commit();
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
        ...d.data(),
      }));
      // Exclude tasks the current user created (those show in their own task list)
      setTasks(data.filter(t => t.ownerId !== user.uid));
      setLoading(false);
      setError(null);
    }, (err) => {
      console.error('useAssignedTasks error:', err);
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
    const unsub = onSnapshot(q, (snap) => {
      setActivity(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });

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
      }).catch(() => {});
    });

    notifyInApp_Comment({
      recipientEmail,
      commenterName: authorName,
      taskText: taskText || 'A task',
      commentText: text,
      taskId,
      ownerUid,
    }).catch(() => {});
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
        }).catch(() => {});
      });
    } else {
      import('../utils/emailNotifications').then(({ notifyStatusChanged }) => {
        notifyStatusChanged({
          ownerEmail,
          ownerName: ownerName || '',
          assigneeName: assigneeName || actorName,
          taskText: taskText || 'A task',
          newStatus: status,
        }).catch(() => {});
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
    }).catch(() => {});
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
      (err) => { console.error('teamMembers snapshot error:', err); setLoading(false); }
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
