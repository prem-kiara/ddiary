/**
 * Email notifications via Microsoft Graph API (Mail.Send)
 * Sends from the signed-in user's M365 mailbox — no third-party service needed.
 */

import { tryRefreshMsToken } from './msTokenRefresh';

const MS_TOKEN_KEY = 'ddiary_ms_access_token';
const APP_URL = 'https://dhanamdiary.web.app';

// SharePoint drive ID — same one used for drawing uploads (kept duplicated here
// so this module has no cross-import on useFirestore). If the env var changes,
// update useFirestore.js and here together.
const SP_DRIVE_ID = import.meta.env.VITE_SHAREPOINT_DRIVE_ID || '';

// ─── HTML escaping (used by the diary-share template) ───────────────────────
function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ─── Core send function ─────────────────────────────────────────────────────
// Auto-refreshes the Microsoft access token on 401 (token expired during a
// long browser session). Without this, every email failure required a manual
// log-out / log-in. See src/utils/msTokenRefresh.js for the refresh bridge.
async function sendEmail({ to, subject, htmlBody }) {
  const payload = JSON.stringify({
    message: {
      subject,
      body: { contentType: 'HTML', content: htmlBody },
      toRecipients: to.split(',').map(email => ({
        emailAddress: { address: email.trim() },
      })),
    },
  });

  const doSend = (token) => fetch('https://graph.microsoft.com/v1.0/me/sendMail', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: payload,
  });

  let token = sessionStorage.getItem(MS_TOKEN_KEY);
  if (!token) {
    token = await tryRefreshMsToken();
    if (!token) {
      console.warn('Email not sent — no Microsoft token available');
      return false;
    }
  }

  try {
    let res = await doSend(token);
    if (res.status === 401) {
      // Token expired mid-session — refresh and retry once
      const newToken = await tryRefreshMsToken();
      if (!newToken) {
        console.warn('Email not sent — token expired and refresh failed');
        return false;
      }
      res = await doSend(newToken);
    }

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

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// DIARY ENTRY SHARING
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Best-effort upgrade of an organization-scoped SharePoint share link to an
 * anonymous "anyone with the link" link, so embedded <img> tags render in
 * external recipients' inboxes (Gmail, non-tenant Outlook, etc).
 *
 * Resolves the SharePoint item by its existing webUrl, then calls Graph
 * createLink with scope:'anonymous'. If the tenant disallows anonymous
 * sharing (admin policy), the call returns 403 and we keep the original URL.
 *
 * Returns: { url: string, isAnonymous: boolean }
 */
async function upgradeDrawingLink(orgUrl) {
  const msToken = sessionStorage.getItem(MS_TOKEN_KEY);
  if (!msToken || !SP_DRIVE_ID || !orgUrl) {
    return { url: orgUrl, isAnonymous: false };
  }
  try {
    // 1. Resolve the item via shares endpoint — encode the URL as Graph expects
    //    (base64url, prefixed with "u!"). See:
    //    https://learn.microsoft.com/graph/api/shares-get
    const encoded = btoa(orgUrl).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
    const itemRes = await fetch(`https://graph.microsoft.com/v1.0/shares/u!${encoded}/driveItem`, {
      headers: { Authorization: `Bearer ${msToken}` },
    });
    if (!itemRes.ok) return { url: orgUrl, isAnonymous: false };
    const item = await itemRes.json();

    // 2. Ask for an anonymous link
    const linkRes = await fetch(
      `https://graph.microsoft.com/v1.0/drives/${SP_DRIVE_ID}/items/${item.id}/createLink`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${msToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'view', scope: 'anonymous' }),
      }
    );
    if (!linkRes.ok) return { url: orgUrl, isAnonymous: false };
    const data = await linkRes.json();
    const newUrl = data?.link?.webUrl;
    if (!newUrl) return { url: orgUrl, isAnonymous: false };
    // SharePoint anonymous "view" links open a viewer page rather than the raw
    // image. Append ?download=1 so an <img src=...> resolves to the file bytes.
    const directUrl = newUrl.includes('?') ? `${newUrl}&download=1` : `${newUrl}?download=1`;
    return { url: directUrl, isAnonymous: true };
  } catch {
    return { url: orgUrl, isAnonymous: false };
  }
}

/** Render plain-text content (with auto-detected lists) into safe HTML. */
function entryContentToHtml(content) {
  if (!content) return '';
  const paragraphs = String(content).split(/\n\n+/);

  return paragraphs.map((para) => {
    const lines = para.split('\n').filter(l => l.length > 0);
    if (lines.length === 0) return '';

    const isNumbered = lines.every(l => /^\d+[.)]\s/.test(l.trim()));
    const isBulleted = lines.every(l => /^[-*•]\s/.test(l.trim()));

    if (isNumbered) {
      const items = lines.map(l => `<li style="margin: 0 0 6px;">${escapeHtml(l.replace(/^\d+[.)]\s/, '').trim())}</li>`).join('');
      return `<ol style="padding-left: 24px; margin: 0 0 14px;">${items}</ol>`;
    }
    if (isBulleted) {
      const items = lines.map(l => `<li style="margin: 0 0 6px;">${escapeHtml(l.replace(/^[-*•]\s/, '').trim())}</li>`).join('');
      return `<ul style="padding-left: 24px; margin: 0 0 14px;">${items}</ul>`;
    }
    return lines.map(l => `<p style="margin: 0 0 6px;">${escapeHtml(l)}</p>`).join('');
  }).join('');
}

/**
 * Share a diary entry with one or more recipients via Outlook/Graph email.
 * Drawings (if any) are embedded as <img> with best-effort anonymous-link
 * upgrade; if upgrade fails, they fall back to a clickable "View drawing" link
 * with a one-line note about sign-in.
 *
 * Returns true on success. Multiple recipients go in the same To: header so
 * everyone sees the full distribution list (standard for meeting minutes).
 */
export async function shareDiaryEntry({ entry, recipients, senderName, personalNote, copyToSelf, selfEmail }) {
  if (!entry || !recipients || recipients.length === 0) return false;

  const title    = entry.title?.trim() || 'Untitled diary entry';
  const dateStr  = entry.createdAt
    ? new Date(typeof entry.createdAt.toDate === 'function' ? entry.createdAt.toDate() : entry.createdAt)
        .toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
    : '';

  // Upgrade drawing URLs in parallel (best-effort)
  const drawings = Array.isArray(entry.drawings) ? entry.drawings : [];
  const upgraded = await Promise.all(drawings.map(upgradeDrawingLink));
  const allAnonymous = upgraded.length > 0 && upgraded.every(u => u.isAnonymous);
  const anyOrgScoped = upgraded.some(u => !u.isAnonymous);

  const drawingsBlock = drawings.length === 0 ? '' : `
    <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;" />
    <p style="font-size: 13px; font-weight: 600; color: #475569; margin: 0 0 10px; text-transform: uppercase; letter-spacing: 0.04em;">
      Attached Drawings
    </p>
    <div>
      ${upgraded.map((u, i) => u.isAnonymous
        ? `<img src="${u.url}" alt="Drawing ${i + 1}" style="max-width: 100%; border-radius: 8px; border: 1px solid #e2e8f0; margin: 0 0 10px; display: block;" />`
        : `<p style="margin: 0 0 8px;"><a href="${u.url}" style="color: #6d28d9; font-weight: 600;">📎 View drawing ${i + 1}</a></p>`
      ).join('')}
    </div>
    ${anyOrgScoped && !allAnonymous ? `
      <p style="font-size: 12px; color: #94a3b8; margin: 6px 0 0; font-style: italic;">
        Some drawings require a Dhanam sign-in to view.
      </p>` : ''}
  `;

  const noteBlock = personalNote?.trim() ? `
    <div style="background: #f5f3ff; border-left: 4px solid #7c3aed; padding: 12px 16px; border-radius: 0 8px 8px 0; margin: 0 0 18px;">
      <p style="font-size: 14px; color: #0f172a; margin: 0; line-height: 1.6; white-space: pre-wrap;">${escapeHtml(personalNote.trim())}</p>
    </div>
  ` : '';

  const tagBlock = entry.tag ? `
    <span style="display: inline-block; background: #ede9fe; color: #6d28d9; font-size: 11px; font-weight: 700; padding: 3px 10px; border-radius: 12px; letter-spacing: 0.04em; text-transform: uppercase;">${escapeHtml(entry.tag)}</span>
  ` : '';

  const body = `
    <p style="font-size: 15px; color: #0f172a; margin: 0 0 6px;">
      <strong>${escapeHtml(senderName || 'A colleague')}</strong> shared a diary entry with you${dateStr ? ` from ${escapeHtml(dateStr)}` : ''}.
    </p>
    ${noteBlock}
    <div style="margin: 16px 0 8px; display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
      <h2 style="font-size: 20px; font-weight: 700; color: #0f172a; margin: 0;">${escapeHtml(title)}</h2>
      ${tagBlock}
    </div>
    ${dateStr ? `<p style="font-size: 13px; color: #64748b; margin: 0 0 16px;">${escapeHtml(dateStr)}</p>` : ''}
    <div style="font-size: 15px; color: #1e293b; line-height: 1.7; margin: 14px 0 0;">
      ${entryContentToHtml(entry.content)}
    </div>
    ${drawingsBlock}
  `;

  const recipientList = recipients.map(r => r.trim()).filter(Boolean);
  const toLine = copyToSelf && selfEmail
    ? Array.from(new Set([...recipientList, selfEmail.trim().toLowerCase()])).join(',')
    : recipientList.join(',');

  return sendEmail({
    to: toLine,
    subject: title,
    htmlBody: wrapHtml('Diary Entry Shared', body),
  });
}
