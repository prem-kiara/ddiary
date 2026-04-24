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
const LOGO_URL = `${APP_URL}/logo-email.png`;

function wrapHtml(title, bodyContent) {
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px;">
      <div style="background: linear-gradient(135deg, #6d28d9 0%, #a78bfa 100%); padding: 20px 24px; border-radius: 12px 12px 0 0; display: flex; align-items: center; gap: 12px;">
        <img src="${LOGO_URL}" alt="Dhanam" width="40" height="40" style="display: inline-block; vertical-align: middle; background: #ffffff; border-radius: 8px; padding: 4px; margin-right: 10px;" />
        <h2 style="margin: 0; color: #fff; font-size: 18px; display: inline-block; vertical-align: middle;">${title}</h2>
      </div>
      <div style="background: #ffffff; padding: 24px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 12px 12px;">
        ${bodyContent}
        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0 16px;" />
        <div style="display: flex; align-items: center; gap: 8px;">
          <img src="${LOGO_URL}" alt="Dhanam" width="20" height="20" style="display: inline-block; vertical-align: middle; margin-right: 6px;" />
          <p style="font-size: 12px; color: #475569; margin: 0; display: inline-block; vertical-align: middle;">
            Sent from <a href="${APP_URL}" style="color: #6d28d9;">Dhanam Workspace</a> — Dhanam Investment and Finance
          </p>
        </div>
      </div>
    </div>
  `;
}

// ─── Priority badge ─────────────────────────────────────────────────────────
function priorityBadge(priority) {
  const colors = { high: '#dc2626', medium: '#d97706', low: '#15803d' };
  const color = colors[priority] || '#475569';
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
    <p style="font-size: 15px; color: #0f172a; margin: 0 0 16px;">
      Hi${assigneeName ? ' <strong>' + assigneeName + '</strong>' : ''},
    </p>
    <p style="font-size: 15px; color: #0f172a; margin: 0 0 16px;">
      <strong>${ownerName}</strong> has assigned you a new task:
    </p>
    <div style="background: #f5f3ff; border-left: 4px solid #6d28d9; padding: 16px; border-radius: 0 8px 8px 0; margin: 0 0 16px;">
      <p style="font-size: 16px; font-weight: 600; color: #0f172a; margin: 0 0 8px;">${taskText}</p>
      <p style="font-size: 13px; color: #475569; margin: 0;">
        ${priorityBadge(priority)} &nbsp; Due: ${formatDue(dueDate)}
      </p>
    </div>
    <p style="font-size: 14px; color: #0f172a; margin: 0 0 16px;">
      Open DDiary to view and update your task:
    </p>
    <a href="${joinLink}" style="display: inline-block; background: #6d28d9; color: #fff; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px;">
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
  const statusColors = { open: '#475569', in_progress: '#2563eb', review: '#d97706', done: '#15803d' };
  const label = statusLabels[newStatus] || newStatus;
  const color = statusColors[newStatus] || '#475569';

  const body = `
    <p style="font-size: 15px; color: #0f172a; margin: 0 0 16px;">
      Hi${ownerName ? ' <strong>' + ownerName + '</strong>' : ''},
    </p>
    <p style="font-size: 15px; color: #0f172a; margin: 0 0 16px;">
      <strong>${assigneeName || 'A team member'}</strong> updated the status of a task:
    </p>
    <div style="background: #f5f3ff; border-left: 4px solid ${color}; padding: 16px; border-radius: 0 8px 8px 0; margin: 0 0 16px;">
      <p style="font-size: 16px; font-weight: 600; color: #0f172a; margin: 0 0 8px;">${taskText}</p>
      <p style="font-size: 14px; color: #0f172a; margin: 0;">
        Status: <span style="display: inline-block; padding: 2px 10px; border-radius: 4px; font-size: 13px; font-weight: 600; color: #fff; background: ${color};">${label}</span>
      </p>
    </div>
    <a href="${APP_URL}" style="display: inline-block; background: #6d28d9; color: #fff; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px;">
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
    <p style="font-size: 15px; color: #0f172a; margin: 0 0 16px;">
      Hi${ownerName ? ' <strong>' + ownerName + '</strong>' : ''},
    </p>
    <p style="font-size: 15px; color: #0f172a; margin: 0 0 16px;">
      Great news! <strong>${assigneeName || 'A team member'}</strong> has completed a task:
    </p>
    <div style="background: #f0fdf4; border-left: 4px solid #15803d; padding: 16px; border-radius: 0 8px 8px 0; margin: 0 0 16px;">
      <p style="font-size: 16px; font-weight: 600; color: #0f172a; margin: 0 0 8px; text-decoration: line-through;">${taskText}</p>
      <p style="font-size: 13px; color: #15803d; font-weight: 600; margin: 0;">
        ✓ Completed — ${completedDate}
      </p>
    </div>
    <a href="${APP_URL}" style="display: inline-block; background: #15803d; color: #fff; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px;">
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
 * 4. Workspace Invite — sent to a new member when they are added to a workspace.
 */
export async function notifyWorkspaceInvite({ inviteeEmail, inviteeName, inviterName, workspaceName, inviteUrl }) {
  if (!inviteeEmail) return false;

  const body = `
    <p style="font-size: 15px; color: #0f172a; margin: 0 0 16px;">
      Hi${inviteeName ? ' <strong>' + inviteeName + '</strong>' : ''},
    </p>
    <p style="font-size: 15px; color: #0f172a; margin: 0 0 16px;">
      <strong>${inviterName}</strong> has invited you to join a workspace on DDiary:
    </p>
    <div style="background: #f5f3ff; border-left: 4px solid #7c3aed; padding: 16px; border-radius: 0 8px 8px 0; margin: 0 0 20px;">
      <p style="font-size: 18px; font-weight: 700; color: #0f172a; margin: 0;">
        🗂 ${workspaceName}
      </p>
    </div>
    <p style="font-size: 14px; color: #0f172a; margin: 0 0 20px; line-height: 1.6;">
      Click the button below to open DDiary and access the shared workspace board.
      You'll be able to view tasks, update statuses, and collaborate with the team.
    </p>
    <a href="${inviteUrl}" style="display: inline-block; background: #7c3aed; color: #fff; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px;">
      Open Workspace
    </a>
  `;

  return sendEmail({
    to: inviteeEmail,
    subject: `You've been invited to "${workspaceName}" on DDiary`,
    htmlBody: wrapHtml('Workspace Invitation', body),
  });
}

/**
 * 5. Task Reassigned — sent to the new assignee when a task is reassigned to them.
 */
export async function notifyTaskReassigned({
  assigneeEmail, assigneeName, taskText, dueDate, priority,
  reassignedByName, latestComment, workspaceUrl,
}) {
  if (!assigneeEmail) return false;

  const commentBlock = latestComment
    ? `<div style="background: #eff6ff; border-left: 4px solid #7c3aed; padding: 12px 16px; border-radius: 0 8px 8px 0; margin: 16px 0;">
        <p style="font-size: 12px; font-weight: 600; color: #7c3aed; margin: 0 0 6px; text-transform: uppercase; letter-spacing: 0.04em;">Latest comment</p>
        <p style="font-size: 14px; color: #0f172a; margin: 0; font-style: italic; line-height: 1.5;">"${latestComment}"</p>
      </div>`
    : '';

  const body = `
    <p style="font-size: 15px; color: #0f172a; margin: 0 0 16px;">
      Hi${assigneeName ? ' <strong>' + assigneeName + '</strong>' : ''},
    </p>
    <p style="font-size: 15px; color: #0f172a; margin: 0 0 16px;">
      <strong>${reassignedByName}</strong> has reassigned a task to you:
    </p>
    <div style="background: #f5f3ff; border-left: 4px solid #6d28d9; padding: 16px; border-radius: 0 8px 8px 0; margin: 0 0 16px;">
      <p style="font-size: 16px; font-weight: 600; color: #0f172a; margin: 0 0 8px;">${taskText}</p>
      <p style="font-size: 13px; color: #475569; margin: 0;">
        ${priorityBadge(priority)} &nbsp; Due: ${formatDue(dueDate)}
      </p>
    </div>
    ${commentBlock}
    <p style="font-size: 14px; color: #0f172a; margin: 0 0 16px;">
      Open DDiary to view your task, add comments, and update the status:
    </p>
    <a href="${workspaceUrl || 'https://dhanamdiary.web.app'}" style="display: inline-block; background: #7c3aed; color: #fff; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px;">
      Open in DDiary
    </a>
  `;

  return sendEmail({
    to: assigneeEmail,
    subject: `Task reassigned to you: ${taskText.slice(0, 55)}`,
    htmlBody: wrapHtml('Task Assigned to You', body),
  });
}

/**
 * 7. Recurring Task Reminder — fired by the client-side dispatcher
 *    (useReminderDispatcher) when a task's reminder.nextSendAt elapses.
 *
 *    Sent from the dispatching user's M365 mailbox via Graph sendMail.
 *    Normally the dispatcher is the task creator, so "from = creator" lines
 *    up naturally; recipients default to creator + assignee, de-duped.
 */
export async function notifyTaskReminder({
  recipients,       // array of email strings (already de-duped + lowercased)
  taskText,
  dueDate,
  priority,
  assigneeName,
  ownerName,
  notes,
  scheduleLabel,    // e.g. "Mon/Wed/Fri at 09:00"
  taskUrl,          // optional deep link back to the task
}) {
  if (!recipients || !recipients.length) return false;

  const dueBlock = dueDate
    ? `<p style="font-size: 13px; color: #475569; margin: 8px 0 0;">${priorityBadge(priority)} &nbsp; Due: ${formatDue(dueDate)}</p>`
    : `<p style="font-size: 13px; color: #475569; margin: 8px 0 0;">${priorityBadge(priority)}</p>`;

  const assigneeLine = assigneeName
    ? `<p style="font-size: 13px; color: #64748b; margin: 4px 0 0;">Assigned to: <strong style="color: #0f172a;">${assigneeName}</strong></p>`
    : '';

  const notesBlock = notes
    ? `<div style="background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 14px; margin: 16px 0;">
         <p style="font-size: 12px; font-weight: 600; color: #475569; margin: 0 0 6px; text-transform: uppercase; letter-spacing: 0.04em;">Notes</p>
         <p style="font-size: 14px; color: #0f172a; margin: 0; line-height: 1.6; white-space: pre-wrap;">${notes}</p>
       </div>`
    : '';

  const scheduleBlock = scheduleLabel
    ? `<p style="font-size: 12px; color: #94a3b8; margin: 16px 0 0; text-align: center;">
         ⏰ ${scheduleLabel}${ownerName ? ` · set by ${ownerName}` : ''}
       </p>`
    : '';

  const body = `
    <p style="font-size: 15px; color: #0f172a; margin: 0 0 16px;">
      This is your recurring reminder for the following task:
    </p>
    <div style="background: #f5f3ff; border-left: 4px solid #6d28d9; padding: 16px; border-radius: 0 8px 8px 0; margin: 0 0 16px;">
      <p style="font-size: 16px; font-weight: 600; color: #0f172a; margin: 0;">${taskText}</p>
      ${dueBlock}
      ${assigneeLine}
    </div>
    ${notesBlock}
    <a href="${taskUrl || APP_URL}" style="display: inline-block; background: #6d28d9; color: #fff; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px;">
      Open in DDiary
    </a>
    ${scheduleBlock}
  `;

  return sendEmail({
    to: recipients.join(','),
    subject: `⏰ Reminder: ${String(taskText).slice(0, 55)}`,
    htmlBody: wrapHtml('Task Reminder', body),
  });
}

/**
 * 6. New Comment — sent to the other party when someone comments on a task.
 */
export async function notifyNewComment({ recipientEmail, recipientName, commenterName, taskText, commentText }) {
  if (!recipientEmail) return false;

  const body = `
    <p style="font-size: 15px; color: #0f172a; margin: 0 0 16px;">
      Hi${recipientName ? ' <strong>' + recipientName + '</strong>' : ''},
    </p>
    <p style="font-size: 15px; color: #0f172a; margin: 0 0 16px;">
      <strong>${commenterName}</strong> commented on a task:
    </p>
    <div style="background: #f5f3ff; border-left: 4px solid #7c3aed; padding: 16px; border-radius: 0 8px 8px 0; margin: 0 0 16px;">
      <p style="font-size: 14px; font-weight: 600; color: #0f172a; margin: 0 0 8px;">${taskText}</p>
      <div style="background: #fff; padding: 12px; border-radius: 6px; margin-top: 8px;">
        <p style="font-size: 14px; color: #0f172a; margin: 0; font-style: italic;">"${commentText}"</p>
      </div>
    </div>
    <a href="${APP_URL}" style="display: inline-block; background: #6d28d9; color: #fff; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px;">
      Reply in DDiary
    </a>
  `;

  return sendEmail({
    to: recipientEmail,
    subject: `New comment on: ${taskText.slice(0, 50)}`,
    htmlBody: wrapHtml('New Comment', body),
  });
}
