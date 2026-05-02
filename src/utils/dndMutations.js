/**
 * Mutations powering drag-and-drop between workspaces.
 *
 * Two operations:
 *
 *   moveTaskAcrossWorkspaces — relocate a single task doc to another workspace
 *   convertWorkspaceToTask   — turn an entire workspace into a single task in
 *                              another workspace (three modes for handling its
 *                              existing tasks)
 *
 * Both write activity entries on the destination so the audit log makes sense
 * after the move. Comments and activity history of the source are NOT migrated
 * (they're context-bound; preserving them makes the destination noisier than
 * useful).
 */

import {
  collection, getDocs, addDoc, deleteDoc, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../firebase';
import {
  addWorkspaceTask, deleteWorkspaceTask, deleteWorkspace, ensureWorkspaceMember,
  addWorkspaceCategory, addWorkspaceSubcategory,
} from '../hooks/useWorkspace';

// ─── Move ONE task to another workspace ───────────────────────────────────────
export async function moveTaskAcrossWorkspaces({
  srcWorkspaceId, taskId, task,
  destWorkspaceId, destCategoryId = null, destSubcategoryId = null,
  actor,
}) {
  if (!srcWorkspaceId || !taskId || !destWorkspaceId || !actor?.uid) {
    throw new Error('moveTaskAcrossWorkspaces: missing required args');
  }
  if (srcWorkspaceId === destWorkspaceId) {
    throw new Error('Source and destination workspaces are the same.');
  }

  // Self-heal membership in destination so addWorkspaceTask passes the rules.
  try { await ensureWorkspaceMember(destWorkspaceId, actor); } catch { /* non-fatal */ }

  // Build payload — addWorkspaceTask sets createdAt/createdBy/updatedAt fresh.
  const next = {
    text:           task.text || '',
    notes:          task.notes || null,
    status:         task.status || 'open',
    priority:       task.priority || 'medium',
    dueDate:        task.dueDate || null,
    assigneeUid:    task.assigneeUid   || null,
    assigneeEmail:  task.assigneeEmail || null,
    assigneeName:   task.assigneeName  || null,
    categoryId:     destCategoryId    || null,
    subcategoryId:  destCategoryId ? (destSubcategoryId || null) : null,
    reminder:       task.reminder || null,
  };

  const newRef = await addWorkspaceTask(destWorkspaceId, next, actor);

  // Activity entry on destination
  try {
    await addDoc(
      collection(db, 'workspaces', destWorkspaceId, 'tasks', newRef.id, 'activity'),
      {
        actorUid:  actor.uid,
        actorName: actor.displayName || actor.email,
        action:    'moved_in',
        detail:    'Moved here from another workspace',
        createdAt: serverTimestamp(),
      }
    );
  } catch { /* non-fatal */ }

  // Cleanup source — comments, activity, then the task itself
  try {
    const [commentsSnap, activitySnap] = await Promise.all([
      getDocs(collection(db, 'workspaces', srcWorkspaceId, 'tasks', taskId, 'comments'))
        .catch(() => ({ docs: [] })),
      getDocs(collection(db, 'workspaces', srcWorkspaceId, 'tasks', taskId, 'activity'))
        .catch(() => ({ docs: [] })),
    ]);
    await Promise.all([
      ...commentsSnap.docs.map(d => deleteDoc(d.ref).catch(() => {})),
      ...activitySnap.docs.map(d => deleteDoc(d.ref).catch(() => {})),
    ]);
  } catch { /* non-fatal */ }
  await deleteWorkspaceTask(srcWorkspaceId, taskId);

  return newRef;
}

// ─── Convert an entire workspace into a category (or sub-category) ───────────
//
// Flow:
//   1. Create a new category in destination (or new sub-category under an
//      existing parent category) named after the source workspace
//   2. Copy every task from source into destination, all parented under the
//      new bucket — original categoryId/subcategoryId on source tasks is
//      dropped, since those IDs are scoped to the source workspace
//   3. Delete the source workspace (which also cleans up its now-orphan tasks,
//      members, and pending invites)
//
// Returns { newCategoryId, newSubcategoryId, taskCount } so the caller can
// surface a useful toast.
export async function convertWorkspaceToCategory({
  srcWorkspace,
  destWorkspaceId,
  asSubcategory = false,    // false → top-level category; true → sub-category
  parentCategoryId = null,  // required when asSubcategory=true
  bucketName,               // human-editable; defaults to srcWorkspace.name
  actor,
}) {
  if (!srcWorkspace?.id || !destWorkspaceId || !actor?.uid) {
    throw new Error('convertWorkspaceToCategory: missing required args');
  }
  if (srcWorkspace.id === destWorkspaceId) {
    throw new Error('Source and destination workspaces are the same.');
  }
  const name = (bucketName || srcWorkspace.name || '').trim();
  if (!name) {
    throw new Error('Bucket name cannot be empty.');
  }
  if (asSubcategory && !parentCategoryId) {
    throw new Error('Pick a parent category to nest the sub-category under.');
  }

  try { await ensureWorkspaceMember(destWorkspaceId, actor); } catch { /* non-fatal */ }

  // 1. Create the new bucket in destination
  let newCategoryId, newSubcategoryId;
  if (asSubcategory) {
    newSubcategoryId = await addWorkspaceSubcategory(destWorkspaceId, parentCategoryId, name, actor);
    newCategoryId    = parentCategoryId;
  } else {
    newCategoryId    = await addWorkspaceCategory(destWorkspaceId, name, actor);
    newSubcategoryId = null;
  }

  // 2. Read source tasks and copy them under the new bucket
  const srcTasksSnap = await getDocs(collection(db, 'workspaces', srcWorkspace.id, 'tasks'))
    .catch(() => ({ docs: [] }));
  const srcTasks = srcTasksSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  for (const t of srcTasks) {
    try {
      await addWorkspaceTask(destWorkspaceId, {
        text:          t.text || '',
        notes:         t.notes || null,
        status:        t.status   || 'open',
        priority:      t.priority || 'medium',
        dueDate:       t.dueDate  || null,
        assigneeUid:   t.assigneeUid   || null,
        assigneeEmail: t.assigneeEmail || null,
        assigneeName:  t.assigneeName  || null,
        categoryId:    newCategoryId,
        subcategoryId: newSubcategoryId,
        reminder:      t.reminder || null,
      }, actor);
    } catch { /* one failure shouldn't block the rest */ }
  }

  // 3. Delete the source workspace entirely
  await deleteWorkspace(srcWorkspace.id);

  return { newCategoryId, newSubcategoryId, taskCount: srcTasks.length };
}

// ─── Helper: count tasks in a workspace (used by the Convert modal preview) ──
export async function countWorkspaceTasks(workspaceId) {
  if (!workspaceId) return 0;
  try {
    const snap = await getDocs(collection(db, 'workspaces', workspaceId, 'tasks'));
    return snap.docs.length;
  } catch {
    return 0;
  }
}
