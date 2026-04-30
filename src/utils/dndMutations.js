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

// ─── Convert an entire workspace to a single task in another workspace ────────
export async function convertWorkspaceToTask({
  srcWorkspace, destWorkspaceId, destCategoryId = null, destSubcategoryId = null,
  mode, actor,
}) {
  if (!srcWorkspace?.id || !destWorkspaceId || !actor?.uid) {
    throw new Error('convertWorkspaceToTask: missing required args');
  }
  if (srcWorkspace.id === destWorkspaceId) {
    throw new Error('Source and destination workspaces are the same.');
  }
  if (!['block', 'checklist', 'siblings'].includes(mode)) {
    throw new Error(`convertWorkspaceToTask: invalid mode "${mode}"`);
  }

  try { await ensureWorkspaceMember(destWorkspaceId, actor); } catch { /* non-fatal */ }

  // Read source tasks once (we may need them depending on mode)
  const srcTasksSnap = await getDocs(collection(db, 'workspaces', srcWorkspace.id, 'tasks'))
    .catch(() => ({ docs: [] }));
  const srcTasks = srcTasksSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  if (mode === 'block' && srcTasks.length > 0) {
    throw new Error(
      `Workspace "${srcWorkspace.name}" has ${srcTasks.length} task(s). ` +
      `Choose a different mode or empty it first.`
    );
  }

  // Build the title task that represents the converted workspace
  const titleTask = {
    text:          srcWorkspace.name,
    status:        'open',
    priority:      'medium',
    categoryId:    destCategoryId || null,
    subcategoryId: destCategoryId ? (destSubcategoryId || null) : null,
  };

  if (mode === 'checklist') {
    const checklist = srcTasks.length === 0
      ? null
      : srcTasks
          .map(t => `- [${t.status === 'done' ? 'x' : ' '}] ${t.text || '(untitled)'}`)
          .join('\n');
    titleTask.notes = checklist
      ? `Converted from workspace "${srcWorkspace.name}":\n\n${checklist}`
      : `Converted from workspace "${srcWorkspace.name}".`;
  } else {
    titleTask.notes = `Converted from workspace "${srcWorkspace.name}".`;
  }

  const titleRef = await addWorkspaceTask(destWorkspaceId, titleTask, actor);

  if (mode === 'siblings') {
    // One new task per source task, alongside the title task
    for (const t of srcTasks) {
      try {
        await addWorkspaceTask(destWorkspaceId, {
          text:          t.text || '',
          notes:         t.notes || null,
          status:        t.status || 'open',
          priority:      t.priority || 'medium',
          dueDate:       t.dueDate || null,
          assigneeUid:   t.assigneeUid   || null,
          assigneeEmail: t.assigneeEmail || null,
          assigneeName:  t.assigneeName  || null,
          categoryId:    destCategoryId || null,
          subcategoryId: destCategoryId ? (destSubcategoryId || null) : null,
          reminder:      t.reminder || null,
        }, actor);
      } catch { /* one failure shouldn't block the rest */ }
    }
  }

  // Activity entry on destination
  try {
    await addDoc(
      collection(db, 'workspaces', destWorkspaceId, 'tasks', titleRef.id, 'activity'),
      {
        actorUid:  actor.uid,
        actorName: actor.displayName || actor.email,
        action:    'converted_from_workspace',
        detail:    `Workspace "${srcWorkspace.name}" converted to task (mode: ${mode})`,
        createdAt: serverTimestamp(),
      }
    );
  } catch { /* non-fatal */ }

  // Delete the source workspace (cleans up tasks + members + invites)
  await deleteWorkspace(srcWorkspace.id);

  return titleRef;
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
