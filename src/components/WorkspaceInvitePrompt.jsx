import { useState } from 'react';
import { Users, CheckCircle, X } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { usePendingInvites, acceptWorkspaceInvite, rejectWorkspaceInvite } from '../hooks/useWorkspace';

/**
 * WorkspaceInvitePrompt
 *
 * Shows a dismissible card for every pending workspace invite the signed-in
 * user has received.  Each card lets them Accept or Decline:
 *   Accept  → creates real member doc, workspace appears instantly in list
 *   Decline → marks invite rejected, notifies the inviter, card disappears
 */
export default function WorkspaceInvitePrompt({ showToast }) {
  const { user } = useAuth();
  const { invites, loading } = usePendingInvites(user?.email);
  // Per-invite processing state: { [inviteId]: 'accepting' | 'rejecting' | undefined }
  const [processing, setProcessing] = useState({});

  if (loading || !invites.length) return null;

  const setStatus = (id, status) =>
    setProcessing(p => ({ ...p, [id]: status }));

  const handleAccept = async (invite) => {
    setStatus(invite.id, 'accepting');
    try {
      await acceptWorkspaceInvite(invite, user);
      if (showToast) showToast(`You've joined "${invite.workspaceName}"!`, 'success');
      // Card disappears automatically because the real-time query no longer returns
      // this invite (status is now 'accepted', not 'pending').
    } catch {
      if (showToast) showToast('Failed to accept invite — please try again.', 'warning');
      setStatus(invite.id, undefined);
    }
  };

  const handleDecline = async (invite) => {
    setStatus(invite.id, 'rejecting');
    try {
      await rejectWorkspaceInvite(invite, user.email);
      if (showToast) showToast('Invite declined.', 'info');
    } catch {
      if (showToast) showToast('Failed to decline invite — please try again.', 'warning');
      setStatus(invite.id, undefined);
    }
  };

  return (
    <div style={{ marginBottom: 20 }}>
      {invites.map(invite => {
        const busy = processing[invite.id];
        return (
          <div
            key={invite.id}
            style={{
              background:    'linear-gradient(135deg, #eaf4fb 0%, #f0f7ff 100%)',
              border:        '1px solid #2980b955',
              borderRadius:  12,
              padding:       '14px 18px',
              marginBottom:  10,
              display:       'flex',
              alignItems:    'center',
              gap:           14,
              flexWrap:      'wrap',
              animation:     'fadeIn 0.25s ease',
            }}
          >
            {/* Icon */}
            <div style={{
              width: 40, height: 40, borderRadius: '50%',
              background: '#2980b922',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}>
              <Users size={20} color="#2980b9" />
            </div>

            {/* Text */}
            <div style={{ flex: 1, minWidth: 180 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#4a3728', marginBottom: 2 }}>
                <span style={{ color: '#2980b9' }}>{invite.inviterName}</span>
                {' '}invited you to join{' '}
                <span style={{ color: '#2a9d8f' }}>{invite.workspaceName}</span>
              </div>
              <div style={{ fontSize: 12, color: '#8a7a6a' }}>
                Accept to start collaborating on shared tasks
              </div>
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
              <button
                onClick={() => handleDecline(invite)}
                disabled={!!busy}
                style={{
                  padding:      '7px 16px',
                  borderRadius: 8,
                  border:       '1px solid #d4c5a9',
                  background:   busy === 'rejecting' ? '#f5f0e5' : '#fff',
                  color:        '#8a7a6a',
                  fontSize:     13,
                  fontWeight:   600,
                  cursor:       busy ? 'not-allowed' : 'pointer',
                  opacity:      busy && busy !== 'rejecting' ? 0.5 : 1,
                  transition:   'all 0.15s',
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  {busy === 'rejecting' ? (
                    '…'
                  ) : (
                    <><X size={13} /> Decline</>
                  )}
                </span>
              </button>

              <button
                onClick={() => handleAccept(invite)}
                disabled={!!busy}
                style={{
                  padding:      '7px 20px',
                  borderRadius: 8,
                  border:       'none',
                  background:   busy === 'accepting' ? '#1f8a7c' : '#2a9d8f',
                  color:        '#fff',
                  fontSize:     13,
                  fontWeight:   700,
                  cursor:       busy ? 'not-allowed' : 'pointer',
                  opacity:      busy && busy !== 'accepting' ? 0.5 : 1,
                  display:      'flex',
                  alignItems:   'center',
                  gap:          6,
                  transition:   'all 0.15s',
                }}
              >
                {busy === 'accepting' ? (
                  '…'
                ) : (
                  <><CheckCircle size={14} /> Accept</>
                )}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
