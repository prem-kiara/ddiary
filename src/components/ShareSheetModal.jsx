import { useState, useRef, useEffect } from 'react';
import { X, UserPlus, UserMinus, Users, Clock, Shield } from 'lucide-react';
import { useSharedSheetLive, useSheetPendingInvites, inviteToSheet, rejectSheetInvite, removeSheetMember } from '../hooks/useSharedSheets';

const ACTION_LABELS = {
  cell_edit:         'Cell Edit',
  sheet_opened:      'Opened',
  sheet_shared:      'Sheet Shared',
  access_granted:    'Access Granted',
  access_revoked:    'Access Revoked',
  structure_changed: 'Structure Changed',
};

function fmtTs(ts) {
  if (!ts) return '—';
  const ms = ts?.seconds ? ts.seconds * 1000 : ts?.toMillis?.() ?? new Date(ts).getTime();
  if (isNaN(ms)) return '—';
  return new Date(ms).toLocaleString();
}

function AuditDetail({ action, details }) {
  if (!details) return null;
  if (action === 'cell_edit') {
    return <span style={{ fontFamily: 'monospace', fontSize: 11 }}>
      {details.cell}: "{details.oldValue}" → "{details.newValue}"
    </span>;
  }
  if (action === 'access_granted') return <span>{details.grantedTo}</span>;
  if (action === 'access_revoked') return <span>{details.targetEmail}</span>;
  if (action === 'structure_changed') {
    const parts = [];
    if (details.cols) parts.push(`cols: ${details.cols}`);
    if (details.rows) parts.push(`rows: ${details.rows}`);
    if (details.colWidthsChanged) parts.push('col widths');
    if (details.rowHeightsChanged) parts.push('row heights');
    return <span>{parts.join(', ') || '—'}</span>;
  }
  if (action === 'sheet_shared') return <span>{details.sheetTitle}</span>;
  return null;
}

export default function ShareSheetModal({ sheetId, sheetTitle, currentUser, onClose }) {
  const [tab, setTab] = useState('members');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviting, setInviting] = useState(false);
  const [inviteMsg, setInviteMsg] = useState(null); // {type:'ok'|'err', text}
  const [removing, setRemoving] = useState(null); // uid being removed

  // Autocomplete state
  const [acSuggestions, setAcSuggestions] = useState([]);
  const [acSearching, setAcSearching] = useState(false);
  const [acOpen, setAcOpen] = useState(false);
  const acRef = useRef();
  const acTimer = useRef();

  // Close dropdown when clicking outside
  useEffect(() => {
    const handler = (e) => { if (acRef.current && !acRef.current.contains(e.target)) setAcOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleInviteEmailChange = (val) => {
    setInviteEmail(val);
    setInviteMsg(null);
    setAcOpen(true);
    if (acTimer.current) clearTimeout(acTimer.current);
    if (!val || val.trim().length < 2) { setAcSuggestions([]); setAcSearching(false); return; }
    setAcSearching(true);
    acTimer.current = setTimeout(async () => {
      try {
        const { searchOrgPeople } = await import('../utils/graphPeopleSearch');
        const results = await searchOrgPeople(val.trim());
        // Filter out people already members
        const existingEmails = new Set(members.map(m => m.email?.toLowerCase()));
        setAcSuggestions(results.filter(r => !existingEmails.has(r.email?.toLowerCase())));
      } catch { setAcSuggestions([]); }
      setAcSearching(false);
    }, 300);
  };

  const handleAcSelect = (person) => {
    setInviteEmail(person.email || person.displayName || '');
    setAcOpen(false);
    setAcSuggestions([]);
  };

  const { members, auditLog, loading } = useSharedSheetLive(sheetId);
  const pendingInvites = useSheetPendingInvites(sheetId);

  const isOwner = members.find(m => m.uid === currentUser?.uid)?.role === 'owner';

  const handleInvite = async () => {
    if (!inviteEmail.trim()) return;
    setInviting(true);
    setInviteMsg(null);
    try {
      await inviteToSheet(sheetId, sheetTitle, currentUser, inviteEmail.trim());
      setInviteEmail('');
      setInviteMsg({ type: 'ok', text: `Invite sent to ${inviteEmail.trim()}` });
    } catch (err) {
      setInviteMsg({ type: 'err', text: err.message || 'Failed to send invite' });
    } finally {
      setInviting(false);
    }
  };

  const handleRemove = async (uid) => {
    if (!window.confirm('Remove this person from the sheet?')) return;
    setRemoving(uid);
    try {
      await removeSheetMember(sheetId, uid, currentUser?.email);
    } catch {}
    setRemoving(null);
  };

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ background: '#fff', borderRadius: 16, width: '100%', maxWidth: 640,
        maxHeight: '85vh', display: 'flex', flexDirection: 'column',
        boxShadow: '0 24px 60px rgba(0,0,0,0.2)' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px 20px',
          borderBottom: '1px solid var(--paper-line)' }}>
          <Users size={18} style={{ color: '#7c3aed', flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--ink)' }}>Share Sheet</div>
            <div style={{ fontSize: 12, color: 'var(--ink-lighter)', marginTop: 1,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {sheetTitle}
            </div>
          </div>
          <button onClick={onClose} className="btn-icon"><X size={16} /></button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 0, padding: '0 20px',
          borderBottom: '1px solid var(--paper-line)' }}>
          {['members', 'auditLog'].map(t => (
            <button key={t} onClick={() => setTab(t)}
              style={{ padding: '10px 16px', border: 'none', background: 'none', cursor: 'pointer',
                fontSize: 13, fontWeight: 600, color: tab === t ? '#7c3aed' : 'var(--ink-lighter)',
                borderBottom: tab === t ? '2px solid #7c3aed' : '2px solid transparent',
                transition: 'color 0.15s' }}>
              {t === 'members' ? `Members (${members.length})` : 'Audit Log'}
            </button>
          ))}
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflow: 'auto', padding: '16px 20px' }}>
          {loading ? (
            <p style={{ color: 'var(--ink-lighter)', fontSize: 13 }}>Loading…</p>
          ) : tab === 'members' ? (
            <div>
              {/* Member list */}
              {members.length === 0 ? (
                <p style={{ color: 'var(--ink-lighter)', fontSize: 13 }}>No members yet.</p>
              ) : members.map(m => (
                <div key={m.uid} style={{ display: 'flex', alignItems: 'center', gap: 12,
                  padding: '10px 0', borderBottom: '1px solid var(--paper-line)' }}>
                  {/* Avatar */}
                  <div style={{ width: 36, height: 36, borderRadius: '50%',
                    background: m.role === 'owner' ? '#7c3aed22' : '#06b6d422',
                    color: m.role === 'owner' ? '#7c3aed' : '#0891b2',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontWeight: 700, fontSize: 15, flexShrink: 0 }}>
                    {(m.name || m.email || '?')[0].toUpperCase()}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)',
                      display: 'flex', alignItems: 'center', gap: 6 }}>
                      {m.name || m.email}
                      {m.uid === currentUser?.uid && (
                        <span style={{ fontSize: 11, color: 'var(--ink-lighter)' }}>(You)</span>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--ink-lighter)' }}>{m.email}</div>
                  </div>
                  {/* Role badge */}
                  <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 10,
                    background: m.role === 'owner' ? '#ede9fe' : '#e0f2fe',
                    color: m.role === 'owner' ? '#7c3aed' : '#0284c7' }}>
                    {m.role === 'owner' ? '👑 Owner' : 'Editor'}
                  </span>
                  {/* Remove button — owner can remove editors */}
                  {isOwner && m.uid !== currentUser?.uid && m.role !== 'owner' && (
                    <button
                      className="btn-icon"
                      style={{ color: '#dc2626' }}
                      title="Remove from sheet"
                      disabled={removing === m.uid}
                      onClick={() => handleRemove(m.uid)}
                    >
                      <UserMinus size={15} />
                    </button>
                  )}
                </div>
              ))}

              {/* Pending invites */}
              {pendingInvites.length > 0 && (
                <div style={{ marginTop: 16 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-lighter)',
                    textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
                    Pending Invites
                  </div>
                  {pendingInvites.map(inv => (
                    <div key={inv.id} style={{ display: 'flex', alignItems: 'center', gap: 10,
                      padding: '8px 0', borderBottom: '1px solid var(--paper-line)' }}>
                      <Clock size={14} style={{ color: '#d97706', flexShrink: 0 }} />
                      <span style={{ flex: 1, fontSize: 13, color: 'var(--ink)' }}>
                        {inv.inviteeEmail}
                      </span>
                      <span style={{ fontSize: 11, color: '#d97706', fontWeight: 600 }}>Pending</span>
                      {isOwner && (
                        <button className="btn btn-sm btn-outline" style={{ fontSize: 11 }}
                          onClick={() => rejectSheetInvite(inv)}>
                          Revoke
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Invite input */}
              {isOwner && (
                <div style={{ marginTop: 20, padding: 16, background: '#f8fafc',
                  borderRadius: 10, border: '1px solid var(--paper-line)' }}>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10,
                    display: 'flex', alignItems: 'center', gap: 6, color: 'var(--ink)' }}>
                    <UserPlus size={14} style={{ color: '#7c3aed' }} />
                    Invite by email
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                    <div ref={acRef} style={{ flex: 1, position: 'relative' }}>
                      <input
                        className="input"
                        type="email"
                        value={inviteEmail}
                        onChange={e => handleInviteEmailChange(e.target.value)}
                        onFocus={() => inviteEmail.trim().length >= 2 && setAcOpen(true)}
                        onKeyDown={e => e.key === 'Enter' && handleInvite()}
                        placeholder="colleague@dhanam.finance"
                        style={{ marginBottom: 0, width: '100%' }}
                        autoComplete="off"
                      />
                      {acOpen && (acSuggestions.length > 0 || acSearching) && (
                        <div style={{
                          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 100,
                          background: '#fff', border: '1px solid #cbd5e1', borderRadius: 8,
                          boxShadow: '0 4px 16px rgba(0,0,0,0.12)', maxHeight: 220,
                          overflowY: 'auto', marginTop: 2,
                        }}>
                          {acSearching && acSuggestions.length === 0 && (
                            <div style={{ padding: '10px 14px', fontSize: 13, color: '#475569', textAlign: 'center' }}>
                              Searching…
                            </div>
                          )}
                          {acSuggestions.length > 0 && (
                            <>
                              <div style={{ padding: '5px 12px', fontSize: 11, fontWeight: 700,
                                color: '#2a6cb8', background: '#e8f0fe',
                                textTransform: 'uppercase', letterSpacing: 0.5 }}>
                                Organization
                              </div>
                              {acSuggestions.map(p => (
                                <div
                                  key={p.id || p.email}
                                  onMouseDown={e => { e.preventDefault(); handleAcSelect(p); }}
                                  style={{ padding: '9px 14px', cursor: 'pointer',
                                    borderBottom: '1px solid #e2e8f0' }}
                                  onMouseEnter={e => e.currentTarget.style.background = '#eff6ff'}
                                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                                >
                                  <div style={{ fontWeight: 600, fontSize: 13, color: '#0f172a' }}>
                                    {p.displayName}
                                  </div>
                                  {p.email && (
                                    <div style={{ fontSize: 12, color: '#2a6cb8' }}>{p.email}</div>
                                  )}
                                  {p.jobTitle && (
                                    <div style={{ fontSize: 11, color: '#475569', fontStyle: 'italic' }}>
                                      {p.jobTitle}
                                    </div>
                                  )}
                                </div>
                              ))}
                            </>
                          )}
                        </div>
                      )}
                    </div>
                    <button className="btn btn-gold btn-sm" onClick={handleInvite}
                      disabled={inviting || !inviteEmail.trim()}
                      style={{ flexShrink: 0 }}>
                      {inviting ? '…' : 'Send Invite'}
                    </button>
                  </div>
                  {inviteMsg && (
                    <p style={{ marginTop: 8, fontSize: 12, margin: '8px 0 0',
                      color: inviteMsg.type === 'ok' ? '#16a34a' : '#dc2626' }}>
                      {inviteMsg.text}
                    </p>
                  )}
                </div>
              )}
            </div>
          ) : (
            /* Audit Log tab */
            <div>
              {auditLog.length === 0 ? (
                <p style={{ color: 'var(--ink-lighter)', fontSize: 13 }}>No audit events yet.</p>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: 'var(--paper-dark)' }}>
                      {['Timestamp', 'User', 'Action', 'Details'].map(h => (
                        <th key={h} style={{ padding: '8px 10px', textAlign: 'left',
                          fontWeight: 600, color: 'var(--ink-light)',
                          borderBottom: '2px solid var(--paper-line)', whiteSpace: 'nowrap' }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {auditLog.map(ev => (
                      <tr key={ev.id} style={{ borderBottom: '1px solid var(--paper-line)' }}>
                        <td style={{ padding: '8px 10px', color: 'var(--ink-lighter)', whiteSpace: 'nowrap' }}>
                          {fmtTs(ev.timestamp)}
                        </td>
                        <td style={{ padding: '8px 10px', color: 'var(--ink)' }}>
                          <div style={{ fontWeight: 600 }}>{ev.userName}</div>
                          <div style={{ fontSize: 11, color: 'var(--ink-lighter)' }}>{ev.userEmail}</div>
                        </td>
                        <td style={{ padding: '8px 10px' }}>
                          <span style={{ padding: '2px 7px', borderRadius: 6, fontSize: 11, fontWeight: 600,
                            background: ev.action === 'cell_edit' ? '#f0fdf4' :
                                        ev.action === 'sheet_opened' ? '#eff6ff' :
                                        ev.action.includes('access') ? '#fefce8' : '#f5f3ff',
                            color: ev.action === 'cell_edit' ? '#15803d' :
                                   ev.action === 'sheet_opened' ? '#1d4ed8' :
                                   ev.action.includes('access') ? '#a16207' : '#7c3aed' }}>
                            {ACTION_LABELS[ev.action] || ev.action}
                          </span>
                        </td>
                        <td style={{ padding: '8px 10px', color: 'var(--ink)', maxWidth: 200,
                          overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          <AuditDetail action={ev.action} details={ev.details} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
