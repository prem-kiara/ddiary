/**
 * Write in-app notification docs to Firestore.
 * Uses a top-level `notifications` collection so any user can receive them,
 * and onSnapshot listeners deliver them in real time — no refresh needed.
 *
 * Security note: the Firestore rule requires senderEmail == the calling user's
 * token email.  Always pass senderEmail so the write is accepted.
 */
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { auth } from '../firebase';

/**
 * Core write function.
 * @param {Object} opts
 * @param {string} opts.recipientEmail  — who should see this notification
 * @param {string} opts.type            — notification type key
 * @param {string} opts.title           — short headline
 * @param {string} opts.body            — descriptive text
 * @param {string} opts.senderName      — human-readable sender name
 * @param {string} [opts.taskId]        — optional task reference
 * @param {string} [opts.ownerUid]      — task owner UID (for navigation)
 * @param {string} [opts.workspaceId]   — workspace reference
 */
export async function writeNotification({ recipientEmail, type, title, body, senderName, taskId, ownerUid, workspaceId }) {
  if (!recipientEmail) return;
  try {
    // Stamp senderEmail from the current Firebase Auth user so the Firestore
    // security rule (senderEmail == request.auth.token.email) passes.
    const senderEmail = auth.currentUser?.email?.toLowerCase() || null;

    await addDoc(collection(db, 'notifications'), {
      recipientEmail: recipientEmail.toLowerCase().trim(),
      senderEmail,                    // required by security rule
      type,
      title,
      body,
      senderName: senderName || 'Someone',
      taskId:      taskId      || null,
      ownerUid:    ownerUid    || null,
      workspaceId: workspaceId || null,
      read: false,
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    console.warn('Failed to write notification:', err);
  }
}

// ─── Convenience helpers ────────────────────────────────────────────────────

export function notifyInApp_TaskAssigned({ assigneeEmail, assigneeName, taskText, ownerName, ownerUid, taskId }) {
  return writeNotification({
    recipientEmail: assigneeEmail,
    type: 'task_assigned',
    title: 'New task assigned to you',
    body: `${ownerName} assigned you: "${taskText}"`,
    senderName: ownerName,
    taskId,
    ownerUid,
  });
}

export function notifyInApp_StatusChanged({ recipientEmail, recipientName, assigneeName, taskText, newStatus, taskId, ownerUid }) {
  const statusLabels = { open: 'Open', in_progress: 'In Progress', review: 'Review', done: 'Done' };
  return writeNotification({
    recipientEmail,
    type: newStatus === 'done' ? 'task_completed' : 'status_changed',
    title: newStatus === 'done' ? 'Task completed!' : 'Task status updated',
    body: `${assigneeName} changed "${taskText}" to ${statusLabels[newStatus] || newStatus}`,
    senderName: assigneeName,
    taskId,
    ownerUid,
  });
}

export function notifyInApp_Comment({ recipientEmail, commenterName, taskText, commentText, taskId, ownerUid }) {
  return writeNotification({
    recipientEmail,
    type: 'comment',
    title: 'New comment on a task',
    body: `${commenterName} on "${taskText}": "${commentText.slice(0, 100)}"`,
    senderName: commenterName,
    taskId,
    ownerUid,
  });
}

export function notifyInApp_Reassigned({ assigneeEmail, assigneeName, taskText, ownerName, ownerUid, taskId }) {
  return writeNotification({
    recipientEmail: assigneeEmail,
    type: 'reassigned',
    title: 'Task assigned to you',
    body: `${ownerName} assigned you: "${taskText}"`,
    senderName: ownerName,
    taskId,
    ownerUid,
  });
}

export function notifyInApp_WorkspaceInvite({ recipientEmail, workspaceName, inviterName, workspaceId }) {
  return writeNotification({
    recipientEmail,
    type: 'workspace_invite',
    title: 'You\'ve been invited to a workspace',
    body: `${inviterName} invited you to "${workspaceName}"`,
    senderName: inviterName,
    workspaceId: workspaceId || null,
  });
}
