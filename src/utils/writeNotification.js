/**
 * Write in-app notification docs to Firestore.
 * Uses a top-level `notifications` collection so any user can receive them,
 * and onSnapshot listeners deliver them in real time — no refresh needed.
 */
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';

/**
 * Core write function.
 * @param {Object} opts
 * @param {string} opts.recipientEmail — who should see this notification
 * @param {string} opts.type — 'task_assigned' | 'status_changed' | 'task_completed' | 'comment' | 'reassigned'
 * @param {string} opts.title — short headline
 * @param {string} opts.body — descriptive text
 * @param {string} opts.senderName — who triggered the notification
 * @param {string} [opts.taskId] — optional task reference
 * @param {string} [opts.ownerUid] — task owner UID (for navigation)
 */
export async function writeNotification({ recipientEmail, type, title, body, senderName, taskId, ownerUid }) {
  if (!recipientEmail) return;
  try {
    await addDoc(collection(db, 'notifications'), {
      recipientEmail: recipientEmail.toLowerCase().trim(),
      type,
      title,
      body,
      senderName: senderName || 'Someone',
      taskId: taskId || null,
      ownerUid: ownerUid || null,
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
