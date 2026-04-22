// ─── Batch workspace invite helper ───────────────────────────────────────────
//
// Shared between every invite UI (Team Board workspace header, Workspaces page
// member panel, New-Workspace modal) so they all have identical semantics:
//
//   - Silently skip emails that are already members (reason: 'already_member')
//   - Silently skip emails with a pending invite (reason: 'pending')
//   - Silently skip the inviter's own email                 (reason: 'self')
//   - Silently skip malformed / empty emails                (reason: 'invalid')
//   - For the rest: create the invite doc, a pending_* member doc (fallback
//     for claimPendingMemberships), and fire the Outlook notification email
//     (non-fatal if it fails).
//
// Returns { sent:   [{email,name}],
//           skipped:[{email, reason}],
//           failed: [{email, err}] }
//
// Callers use the return value to render a short human summary. The function
// never throws for partial failures — it aggregates them so a single bad row
// can't block the batch.

import { createWorkspaceInvite, getExistingInvite, addWorkspaceMember } from '../hooks/useWorkspace';
import { notifyWorkspaceInvite } from './emailNotifications';

const EMAIL_RE = /^\S+@\S+\.\S+$/;

/**
 * @param {Object} args
 * @param {string} args.workspaceId
 * @param {string} args.workspaceName
 * @param {{uid:string,email:string,displayName?:string}} args.inviter
 * @param {Array<{email:string,name?:string,role?:string}>} args.invitees
 * @param {Array<{uid?:string,email?:string}>} args.existingMembers   // for already-member check
 * @param {string} args.inviteUrl
 */
export async function sendBatchInvites({
  workspaceId,
  workspaceName,
  inviter,
  invitees,
  existingMembers = [],
  inviteUrl,
}) {
  const sent    = [];
  const skipped = [];
  const failed  = [];

  // Precompute member email set for O(1) checks
  const memberEmails = new Set(
    (existingMembers || [])
      .map(m => (m.email || '').toLowerCase())
      .filter(Boolean),
  );
  const inviterEmail = (inviter?.email || '').toLowerCase();

  // Dedupe input (case-insensitive) so if the same email appears twice in the
  // chip list we don't send a duplicate invite.
  const seen = new Set();

  for (const raw of (invitees || [])) {
    const email = (raw?.email || '').trim().toLowerCase();
    const name  = (raw?.name  || '').trim() || email.split('@')[0] || 'Member';

    if (!email || !EMAIL_RE.test(email)) {
      skipped.push({ email: email || '(blank)', reason: 'invalid' });
      continue;
    }
    if (email === inviterEmail) {
      skipped.push({ email, reason: 'self' });
      continue;
    }
    if (seen.has(email)) {
      skipped.push({ email, reason: 'duplicate' });
      continue;
    }
    seen.add(email);

    if (memberEmails.has(email)) {
      skipped.push({ email, reason: 'already_member' });
      continue;
    }

    try {
      const existing = await getExistingInvite(workspaceId, email);
      if (existing?.status === 'pending') {
        skipped.push({ email, reason: 'pending' });
        continue;
      }

      await createWorkspaceInvite({
        workspaceId,
        workspaceName,
        inviterUid:   inviter.uid,
        inviterEmail: inviter.email,
        inviterName:  inviter.displayName || inviter.email,
        inviteeEmail: email,
      });

      // Pre-create pending member doc so claimPendingMemberships can upgrade
      // the doc to a real member entry when the invitee signs in.
      await addWorkspaceMember(workspaceId, {
        uid:         `pending_${email.replace(/[^a-zA-Z0-9]/g, '_')}`,
        email,
        displayName: name,
        role:        raw.role || 'member',
      });

      // Outlook notification — best effort; workspace invite doc has already
      // been written so accept/reject still works even if the email fails.
      try {
        await notifyWorkspaceInvite({
          inviteeEmail: email,
          inviteeName:  name,
          inviterName:  inviter.displayName || inviter.email,
          workspaceName,
          inviteUrl,
        });
      } catch { /* non-fatal */ }

      sent.push({ email, name });
    } catch (err) {
      failed.push({ email, err });
    }
  }

  return { sent, skipped, failed };
}

// ── Human-readable summary for toasts / inline banners ───────────────────────
//
// Example outputs:
//   "3 invites sent."
//   "2 sent · 1 already a member, 1 pending."
//   "No invites sent — everyone is already a member."
export function summariseInviteResult({ sent, skipped, failed }) {
  const parts = [];
  if (sent.length) parts.push(`${sent.length} invite${sent.length === 1 ? '' : 's'} sent`);

  const reasonLabels = {
    already_member: 'already a member',
    pending:        'already invited',
    self:           'you',
    duplicate:      'duplicate',
    invalid:        'invalid',
  };
  const skipCounts = skipped.reduce((acc, s) => {
    acc[s.reason] = (acc[s.reason] || 0) + 1;
    return acc;
  }, {});
  for (const [reason, count] of Object.entries(skipCounts)) {
    parts.push(`${count} ${reasonLabels[reason] || 'skipped'}`);
  }

  if (failed.length) parts.push(`${failed.length} failed`);

  if (parts.length === 0) return 'No invites sent.';
  return parts.join(' · ');
}
