import { useState } from 'react';
import { Table2, CheckCircle, X } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { usePendingSheetInvites, acceptSheetInvite, rejectSheetInvite } from '../hooks/useSharedSheets';

export default function SheetInviteBanner({ showToast }) {
  const { user } = useAuth();
  const { invites, loading } = usePendingSheetInvites(user?.email);
  const [processing, setProcessing] = useState({});

  if (loading || !invites.length) return null;

  const setStatus = (id, status) => setProcessing(p => ({ ...p, [id]: status }));

  const handleAccept = async (invite) => {
    setStatus(invite.id, 'accepting');
    try {
      await acceptSheetInvite(invite, user);
      showToast?.(`You now have access to "${invite.sheetTitle}"`, 'success');
    } catch {
      showToast?.('Failed to accept invite — please try again.', 'warning');
      setStatus(invite.id, undefined);
    }
  };

  const handleDecline = async (invite) => {
    setStatus(invite.id, 'rejecting');
    try {
      await rejectSheetInvite(invite);
      showToast?.('Invite declined.', 'info');
    } catch {
      showToast?.('Failed to decline invite.', 'warning');
      setStatus(invite.id, undefined);
    }
  };

  return (
    <div style={{ marginBottom: 20 }}>
      {invites.map(invite => {
        const busy = processing[invite.id];
        return (
          <div key={invite.id} style={{
            background: 'linear-gradient(135deg, #f0fdf4 0%, #ecfdf5 100%)',
            border: '1px solid #16a34a55', borderRadius: 12,
            padding: '14px 18px', marginBottom: 10,
            display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
            animation: 'fadeIn 0.25s ease',
          }}>
            <div style={{ width: 40, height: 40, borderRadius: '50%', background: '#16a34a22',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <Table2 size={20} color="#16a34a" />
            </div>
            <div style={{ flex: 1, minWidth: 180 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#0f172a', marginBottom: 2 }}>
                <span style={{ color: '#16a34a' }}>{invite.inviterName}</span>
                {' '}invited you to collaborate on{' '}
                <span style={{ color: '#7c3aed' }}>{invite.sheetTitle}</span>
              </div>
              <div style={{ fontSize: 12, color: '#475569' }}>
                Accept to view and edit this sheet in real-time
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
              <button onClick={() => handleDecline(invite)} disabled={!!busy}
                style={{ padding: '7px 16px', borderRadius: 8, border: '1px solid #cbd5e1',
                  background: busy === 'rejecting' ? '#f1f5f9' : '#fff',
                  color: '#475569', fontSize: 13, fontWeight: 600,
                  cursor: busy ? 'not-allowed' : 'pointer', opacity: busy && busy !== 'rejecting' ? 0.5 : 1 }}>
                {busy === 'rejecting' ? '…' : <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><X size={13} /> Decline</span>}
              </button>
              <button onClick={() => handleAccept(invite)} disabled={!!busy}
                style={{ padding: '7px 20px', borderRadius: 8, border: 'none',
                  background: busy === 'accepting' ? '#15803d' : '#16a34a',
                  color: '#fff', fontSize: 13, fontWeight: 700,
                  cursor: busy ? 'not-allowed' : 'pointer', opacity: busy && busy !== 'accepting' ? 0.5 : 1,
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
