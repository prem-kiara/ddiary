/**
 * Email notifications via Microsoft Graph API (Mail.Send)
 * Sends from the signed-in user's M365 mailbox — no third-party service needed.
 */

const MS_TOKEN_KEY = 'ddiary_ms_access_token';
const APP_URL = 'https://dhanamdiary.web.app';

// ─── Core send function ─────────────────────────────────────────────────────
async function sendEmail({ to, subject, htmlBody }) {
  const msToken = sessionStorage.getItem(MS_TOKEN_KEY);
  if (!msToken) {
    console.warn('Email not sent — no Microsoft token available');
    return false;
  }

  try {
    const res = await fetch('https://graph.microsoft.com/v1.0/me/sendMail', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${msToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: {
          subject,
          body: { contentType: 'HTML', content: htmlBody },
          toRecipients: to.split(',').map(email => ({
            emailAddress: { address: email.trim() },
          })),
        },
      }),
    });

    if (res.status === 202 || res.ok) return true;

    const err = await res.json().catch(() => ({}));
    console.error('Email send failed:', res.status, err?.error?.message);
    return false;
  } catch (err) {
    console.error('Email send error:', err);
    return false;
  }
}

// ─── Email wrapper (styled) ─────────────────────────────────────────────────
function wrapHtml(title, bodyContent) {
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px;">
      <div style="background: linear-gradient(135deg, #8B6914 0%, #b8941f 100%); padding: 20px 24px; border-radius: 12px 12px 0 0;">
        <h2 style="margin: 0; color: #fff; font-size: 18px;">${title}</h2>
      </div>
      <div style="background: #fffdf5; padding: 24px; border: 1px solid #e8dcc8; border-top: none; border-radius: 0 0 12px 12px;">
        ${bodyContent}
        <hr style="border: none; border-top: 1px solid #e8dcc8; margin: 24px 0 16px;" />
        <p style="font-size: 12px; color: #8a7a6a; margin: 0;">
          Sent from <a href="${APP_URL}" style="color: #8B6914;">DDiary</a> — Dhanam Digital Diary
        </p>
      </div>
    </div>
  `;
}

// ─── Priority badge ─────────────────────────────────────────────────────────
function priorityBadge(priority) {
  const colors = { high: '#c0392b', medium: '#e67e22', low: '#27ae60' };
  const color = colors[priority] || '#8a7a6a';
  return `<span style="display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: 600; color: #fff; background: ${color};">${(priority || 'medium').toUpperCase()}</span>`;
}

// ─── Format due date ────────────────────────────────────────────────────────
function formatDue(dueDate) {
  if (!dueDate) return 'No due date';
  const d = new Date(dueDate);
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// NOTIFICATION TYPES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * 1. Task Assigned — sent to the assignee when a task is assigned to them.
 */
export async function notifyTaskAssigned({ assigneeEmail, assigneeName, taskText, dueDate, priority, ownerName, ownerUid }) {
  if (!assigneeEmail) return false;

  const joinLink = `${APP_URL}?join=${ownerUid}`;
  const body = `
    <p style="font-size: 15px; color: #4a3728; margin: 0 0 16px;">
      Hi${assigneeName ? ' <strong>' + assigneeName + '</strong>' : ''},
    </p>
    <p style="font-size: 15px; color: #4a3728; margin: 0 0 16px;">
      <strong>${ownerName}</strong> has assigned you a new task:
    </p>
    <div style="background: #f9f5ec; border-left: 4px solid #8B6914; padding: 16px; border-radius: 0 8px 8px 0; margin: 0 0 16px;">
      <p style="font-size: 16px; font-weight: 600; color: #4a3728; margin: 0 0 8px;">${taskText}</p>
      <p style="font-size: 13px; color: #8a7a6a; margin: 0;">
        ${priorityBadge(priority)} &nbsp; Due: ${formatDue(dueDate)}
      </p>
    </div>
    <p style="font-size: 14px; color: #4a3728; margin: 0 0 16px;">
      Open DDiary to view and update your task:
    </p>
    <a href="${joinLink}" style="display: inline-block; background: #8B6914; color: #fff; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px;">
      Open DDiary
    </a>
  `;

  return sendEmail({
    to: assigneeEmail,
    subject: `New task assigned: ${taskText.slice(0, 60)}`,
    htmlBody: wrapHtml('New Task Assigned', body),
  });
}

/**
 * 2. Status Changed — sent to the task owner when assignee updates status.
 */
export async function notifyStatusChanged({ ownerEmail, ownerName, assigneeName, taskText, newStatus, oldStatus }) {
  if (!ownerEmail) return false;

  const statusLabels = { open: 'Open', in_progress: 'In Progress', review: 'Review', done: 'Done' };
  const statusColors = { open: '#8a7a6a', in_progress: '#2a6cb8', review: '#e67e22', done: '#27ae60' };
  const label = statusLabels[newStatus] || newStatus;
  const color = statusColors[newStatus] || '#8a7a6a';

  const body = `
    <p style="font-size: 15px; color: #4a3728; margin: 0 0 16px;">
      Hi${ownerName ? ' <strong>' + ownerName + '</strong>' : ''},
    </p>
    <p style="font-size: 15px; color: #4a3728; margin: 0 0 16px;">
      <strong>${assigneeName || 'A team member'}</strong> updated the status of a task:
    </p>
    <div style="background: #f9f5ec; border-left: 4px solid ${color}; padding: 16px; border-radius: 0 8px 8px 0; margin: 0 0 16px;">
      <p style="font-size: 16px; font-weight: 600; color: #4a3728; margin: 0 0 8px;">${taskText}</p>
      <p style="font-size: 14px; color: #4a3728; margin: 0;">
        Status: <span style="display: inline-block; padding: 2px 10px; border-radius: 4px; font-size: 13px; font-weight: 600; color: #fff; background: ${color};">${label}</span>
      </p>
    </div>
    <a href="${APP_URL}" style="display: inline-block; background: #8B6914; color: #fff; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px;">
      View in DDiary
    </a>
  `;

  return sendEmail({
    to: ownerEmail,
    subject: `Task update: "${taskText.slice(0, 50)}" → ${label}`,
    htmlBody: wrapHtml('Task Status Updated', body),
  });
}

/**
 * 3. Task Completed — sent to the task owner when a task is marked done.
 */
export async function notifyTaskCompleted({ ownerEmail, ownerName, assigneeName, taskText, completedAt }) {
  if (!ownerEmail) return false;

  const completedDate = completedAt
    ? new Date(completedAt).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : 'Just now';

  const body = `
    <p style="font-size: 15px; color: #4a3728; margin: 0 0 16px;">
      Hi${ownerName ? ' <strong>' + ownerName + '</strong>' : ''},
    </p>
    <p style="font-size: 15px; color: #4a3728; margin: 0 0 16px;">
      Great news! <strong>${assigneeName || 'A team member'}</strong> has completed a task:
    </p>
    <div style="background: #e8f8f0; border-left: 4px solid #27ae60; padding: 16px; border-radius: 0 8px 8px 0; margin: 0 0 16px;">
      <p style="font-size: 16px; font-weight: 600; color: #4a3728; margin: 0 0 8px; text-decoration: line-through;">${taskText}</p>
      <p style="font-size: 13px; color: #27ae60; font-weight: 600; margin: 0;">
        ✓ Completed — ${completedDate}
      </p>
    </div>
    <a href="${APP_URL}" style="display: inline-block; background: #27ae60; color: #fff; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px;">
      View in DDiary
    </a>
  `;

  return sendEmail({
    to: ownerEmail,
    subject: `Task completed: ${taskText.slice(0, 60)}`,
    htmlBody: wrapHtml('Task Completed ✓', body),
  });
}

/**
 * 4. New Comment — sent to the other party when someone comments on a task.
 */
export async function notifyNewComment({ recipientEmail, recipientName, commenterName, taskText, commentText }) {
  if (!recipientEmail) return false;

  const body = `
    <p style="font-size: 15px; color: #4a3728; margin: 0 0 16px;">
      Hi${recipientName ? ' <strong>' + recipientName + '</strong>' : ''},
    </p>
    <p style="font-size: 15px; color: #4a3728; margin: 0 0 16px;">
      <strong>${commenterName}</strong> commented on a task:
    </p>
    <div style="background: #f9f5ec; border-left: 4px solid #8e44ad; padding: 16px; border-radius: 0 8px 8px 0; margin: 0 0 16px;">
      <p style="font-size: 14px; font-weight: 600; color: #4a3728; margin: 0 0 8px;">${taskText}</p>
      <div style="background: #fff; padding: 12px; border-radius: 6px; margin-top: 8px;">
        <p style="font-size: 14px; color: #4a3728; margin: 0; font-style: italic;">"${commentText}"</p>
      </div>
    </div>
    <a href="${APP_URL}" style="display: inline-block; background: #8B6914; color: #fff; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px;">
      Reply in DDiary
    </a>
  `;

  return sendEmail({
    to: recipientEmail,
    subject: `New comment on: ${taskText.slice(0, 50)}`,
    htmlBody: wrapHtml('New Comment', body),
  });
}
