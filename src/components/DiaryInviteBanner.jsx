import { useState, useEffect, useRef } from 'react';
import { BookOpen, CheckCircle, X } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { usePendingDiaryInvites, acceptDiaryInvite, rejectDiaryInvite } from '../hooks/useSharedDiaries';

export default function DiaryInviteBanner({ showToast, highlightInviteId }) {
  const { user } = useAuth();
  const { invites, loading } = usePendingDiaryInvites(user?.email);
  const [processing, setProcessing] = useState({});
  const highlightRef = useRef(null);

  useEffect(() => {
    if (!highlightInviteId || !highlightRef.current) return;
    highlightRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [highlightInviteId, invites]);

  if (loading || !invites.length) return null;

  const setStatus = (id, status) => setProcessing(p => ({ ...p, [id]: status }));

  const handleAccept = async (invite) => {
    setStatus(invite.id, 'accepting');
    try {
      await acceptDiaryInvite(invite, user);
      showToast?.(`You now have access to "${invite.diaryTitle}"`, 'success');
    } catch {
      showToast?.('Failed to accept invite — please try again.', 'warning');
      setStatus(invite.id, undefined);
    }
  };

  const handleDecline = async (invite) => {
    setStatus(invite.id, 'rejecting');
    try {
      await rejectDiaryInvite(invite);
      showToast?.('Invite declined.', 'info');
    } catch {
      showToast?.('Failed to decline invite.', 'warning');
      setStatus(invite.id, undefined);
    }
  };

  return (
    <div style={{ marginBottom: 20 }}>
      <style>{`
        @keyframes diaryInvitePulse {
          0%, 100% { box-shadow: 0 0 0 4px #7c3aed22; }
          50%       { box-shadow: 0 0 0 8px #7c3aed44; }
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(-6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
      {invites.map(invite => {
        const busy = processing[invite.id];
        const isHighlighted = highlightInviteId && invite.id === highlightInviteId;
        return (
          <div
            key={invite.id}
            ref={isHighlighted ? highlightRef : null}
            style={{
              background: isHighlighted
                ? 'linear-gradient(135deg, #faf5ff 0%, #ede9fe 100%)'
                : 'linear-gradient(135deg, #faf5ff 0%, #f5f3ff 100%)',
              border: isHighlighted ? '2px solid #7c3aed' : '1px solid #7c3aed55',
              borderRadius: 12,
              padding: '14px 18px', marginBottom: 10,
              display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
              animation: isHighlighted
                ? 'diaryInvitePulse 1.8s ease 3, fadeIn 0.25s ease'
                : 'fadeIn 0.25s ease',
              boxShadow: isHighlighted ? '0 0 0 4px #7c3aed22' : 'none',
            }}
          >
            <div style={{ width: 40, height: 40, borderRadius: '50%', background: '#7c3aed22',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <BookOpen size={20} color="#7c3aed" />
            </div>
            <div style={{ flex: 1, minWidth: 180 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#0f172a', marginBottom: 2 }}>
                <span style={{ color: '#7c3aed' }}>{invite.inviterName}</span>
                {' '}invited you to co-edit{' '}
                <span style={{ color: '#7c3aed', fontStyle: 'italic' }}>{invite.diaryTitle || 'a diary entry'}</span>
              </div>
              <div style={{ fontSize: 12, color: '#475569' }}>
                Accept to view and edit this diary entry in real-time
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
              <button onClick={() => handleDecline(invite)} disabled={!!busy}
                style={{ padding: '7px 16px', borderRadius: 8, border: '1px solid #cbd5e1',
                  background: busy === 'rejecting' ? '#f1f5f9' : '#fff',
                  color: '#475569', fontSize: 13, fontWeight: 600,
                  cursor: busy ? 'not-allowed' : 'pointer',
                  opacity: busy && busy !== 'rejecting' ? 0.5 : 1 }}>
                {busy === 'rejecting' ? '…' : (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <X size={13} /> Decline
                  </span>
                )}
              </button>
              <button onClick={() => handleAccept(invite)} disabled={!!busy}
                style={{ padding: '7px 20px', borderRadius: 8, border: 'none',
                  background: busy === 'accepting' ? '#6d28d9' : '#7c3aed',
                  color: '#fff', fontSize: 13, fontWeight: 700,
                  cursor: busy ? 'not-allowed' : 'pointer',
                  opacity: busy && busy !== 'accepting' ? 0.5 : 1,
                  display: 'flex', alignItems: 'center', gap: 6 }}>
                {busy === 'accepting' ? '…' : <><CheckCircle size={14} /> Accept</>}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
