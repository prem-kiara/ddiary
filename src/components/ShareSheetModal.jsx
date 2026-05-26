import { useState, useRef, useEffect } from 'react';
import { useConfirm } from '../contexts/ConfirmContext';
import { X, UserPlus, UserMinus, Users, Clock, CheckCircle2 } from 'lucide-react';
import { useSharedSheetLive, useSheetPendingInvites, inviteToSheet, rejectSheetInvite, removeSheetMember, syncMemberAccess } from '../hooks/useSharedSheets';

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

const isValidEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((e || '').trim());

export default function ShareSheetModal({ sheetId, sheetTitle, currentUser, onClose }) {
  const [tab, setTab] = useState('members');
  const [removing, setRemoving] = useState(null);
  const [syncing,  setSyncing]  = useState(null); // uid being synced

  // Multi-invite queue
  const [inviteInput,   setInviteInput]   = useState('');
  const [inviteQueue,   setInviteQueue]   = useState([]);   // [{ email, name }]
  const [inviting,      setInviting]      = useState(false);
  const [inviteResults, setInviteResults] = useState([]);   // [{ email, ok, msg }]

  // Autocomplete
  const [acSuggestions, setAcSuggestions] = useState([]);
  const [acSearching,   setAcSearching]   = useState(false);
  const [acOpen,        setAcOpen]        = useState(false);
  const acWrapRef = useRef();
  const acTimer   = useRef();
  const inputRef  = useRef();

  const confirm = useConfirm();
  const { sheet, members, auditLog, loading } = useSharedSheetLive(sheetId);
  const pendingInvites = useSheetPendingInvites(sheetId);
  const isOwner = members.find(m => m.uid === currentUser?.uid)?.role === 'owner';

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e) => {
      if (acWrapRef.current && !acWrapRef.current.contains(e.target)) setAcOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Debounced org search
  const searchOrg = (val) => {
    if (acTimer.current) clearTimeout(acTimer.current);
    if (!val || val.trim().length < 2) { setAcSuggestions([]); setAcSearching(false); return; }
    setAcSearching(true);
    acTimer.current = setTimeout(async () => {
      try {
        const { searchOrgPeople } = await import('../utils/graphPeopleSearch');
        const results = await searchOrgPeople(val.trim());
        const taken = new Set([
          ...members.map(m => m.email?.toLowerCase()),
          ...inviteQueue.map(q => q.email.toLowerCase()),
        ]);
        setAcSuggestions(results.filter(r => !taken.has(r.email?.toLowerCase())));
      } catch { setAcSuggestions([]); }
      setAcSearching(false);
    }, 300);
  };

  const handleInputChange = (val) => {
    setInviteInput(val);
    setAcOpen(true);
    setInviteResults([]);
    searchOrg(val);
  };

  const addToQueue = (email, name) => {
    const e = (email || '').trim().toLowerCase();
    if (!e) return;
    if (inviteQueue.find(q => q.email.toLowerCase() === e)) return;
    if (members.find(m => m.email?.toLowerCase() === e)) return;
    setInviteQueue(q => [...q, { email: e, name: name || e }]);
    setInviteInput('');
    setAcSuggestions([]);
    setAcOpen(false);
    setInviteResults([]);
    inputRef.current?.focus();
  };

  const handleInputKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      if (inviteInput.trim() && isValidEmail(inviteInput)) addToQueue(inviteInput.trim());
    }
    if (e.key === 'Backspace' && !inviteInput && inviteQueue.length > 0) {
      setInviteQueue(q => q.slice(0, -1));
    }
    if (e.key === 'Escape') { setAcOpen(false); }
  };

  const removeFromQueue = (email) => setInviteQueue(q => q.filter(p => p.email !== email));

  const handleSendAll = async (extraEmail) => {
    const queue = extraEmail
      ? [...inviteQueue, { email: extraEmail.trim().toLowerCase(), name: extraEmail.trim() }]
      : inviteQueue;
    if (queue.length === 0) return;
    setInviting(true);
    setInviteResults([]);
    const results = await Promise.all(
      queue.map(async ({ email }) => {
        try {
          await inviteToSheet(sheetId, sheetTitle, currentUser, email);
          return { email, ok: true, msg: 'Invite sent' };
        } catch (err) {
          return { email, ok: false, msg: err.message || 'Failed' };
        }
      })
    );
    setInviteResults(results);
    const failedEmails = new Set(results.filter(r => !r.ok).map(r => r.email));
    setInviteQueue(queue.filter(q => failedEmails.has(q.email)));
    setInviteInput('');
    setInviting(false);
  };

  const handleRemove = async (uid) => {
    if (!await confirm('Remove this person from the sheet?', { danger: true, okText: 'Remove' })) return;
    setRemoving(uid);
    try { await removeSheetMember(sheetId, uid, currentUser?.email); } catch {}
    setRemoving(null);
  };

  const handleSync = async (uid) => {
    setSyncing(uid);
    try { await syncMemberAccess(sheetId, uid); } catch {}
    setSyncing(null);
  };

  const canSend = !inviting && (inviteQueue.length > 0 || (inviteInput.trim() && isValidEmail(inviteInput)));

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Modal shell — flex column, fixed height */}
      <div style={{
        background: '#fff', borderRadius: 18, width: '100%', maxWidth: 700,
        height: '90vh', maxHeight: 860,
        display: 'flex', flexDirection: 'column',
        boxShadow: '0 28px 70px rgba(0,0,0,0.22)',
      }}>

        {/* ── Header ── (never scrolls) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12,
          padding: '18px 24px', borderBottom: '1px solid var(--paper-line)', flexShrink: 0 }}>
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

        {/* ── Tabs ── (never scrolls) */}
        <div style={{ display: 'flex', padding: '0 24px',
          borderBottom: '1px solid var(--paper-line)', flexShrink: 0 }}>
          {['members', 'auditLog'].map(t => (
            <button key={t} onClick={() => setTab(t)}
              style={{ padding: '11px 16px', border: 'none', background: 'none', cursor: 'pointer',
                fontSize: 13, fontWeight: 600,
                color: tab === t ? '#7c3aed' : 'var(--ink-lighter)',
                borderBottom: tab === t ? '2px solid #7c3aed' : '2px solid transparent',
                transition: 'color 0.15s' }}>
              {t === 'members' ? `Members (${members.length})` : 'Audit Log'}
            </button>
          ))}
        </div>

        {loading ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <p style={{ color: 'var(--ink-lighter)', fontSize: 13 }}>Loading…</p>
          </div>
        ) : tab === 'members' ? (
          <>
            {/* ── Invite section — NOT inside scroll, so dropdown is never clipped ── */}
            {isOwner && (
              <div style={{
                flexShrink: 0, padding: '18px 24px 0',
                // overflow visible so absolute dropdown escapes
              }}>
                <div style={{ padding: 16, background: '#f8fafc',
                  borderRadius: 12, border: '1px solid var(--paper-line)' }}>

                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12,
                    display: 'flex', alignItems: 'center', gap: 6, color: 'var(--ink)' }}>
                    <UserPlus size={14} style={{ color: '#7c3aed' }} />
                    Invite people
                  </div>

                  {/* Tag chip input */}
                  <div ref={acWrapRef} style={{ position: 'relative' }}>
                    <div
                      onClick={() => inputRef.current?.focus()}
                      style={{
                        display: 'flex', flexWrap: 'wrap', gap: 6, padding: '8px 10px',
                        minHeight: 46, border: '1px solid #cbd5e1', borderRadius: 8,
                        background: '#fff', cursor: 'text', alignItems: 'center',
                        boxSizing: 'border-box',
                      }}
                    >
                      {inviteQueue.map(p => (
                        <span key={p.email} style={{
                          display: 'inline-flex', alignItems: 'center', gap: 4,
                          padding: '4px 8px 4px 10px', borderRadius: 20,
                          background: '#ede9fe', color: '#7c3aed',
                          fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap',
                        }}>
                          {p.name !== p.email ? p.name : p.email}
                          <button
                            onMouseDown={e => { e.preventDefault(); removeFromQueue(p.email); }}
                            style={{ background: 'none', border: 'none', cursor: 'pointer',
                              padding: 0, lineHeight: 1, color: '#7c3aed', opacity: 0.65,
                              display: 'flex', alignItems: 'center' }}
                          >
                            <X size={11} />
                          </button>
                        </span>
                      ))}
                      <input
                        ref={inputRef}
                        value={inviteInput}
                        onChange={e => handleInputChange(e.target.value)}
                        onFocus={() => inviteInput.trim().length >= 2 && setAcOpen(true)}
                        onKeyDown={handleInputKeyDown}
                        placeholder={inviteQueue.length === 0
                          ? 'Type name or email, press Enter to add…'
                          : 'Add another…'}
                        autoComplete="off"
                        style={{ flex: 1, minWidth: 180, border: 'none', outline: 'none',
                          fontSize: 13, background: 'transparent', padding: '2px 4px' }}
                      />
                    </div>

                    {/* Dropdown — position: absolute, z-index high enough to float over modal content */}
                    {acOpen && (acSuggestions.length > 0 || acSearching) && (
                      <div style={{
                        position: 'absolute', top: 'calc(100% + 3px)', left: 0, right: 0,
                        zIndex: 9999,
                        background: '#fff', border: '1px solid #cbd5e1', borderRadius: 10,
                        boxShadow: '0 8px 24px rgba(0,0,0,0.14)', maxHeight: 220, overflowY: 'auto',
                      }}>
                        {acSearching && acSuggestions.length === 0 && (
                          <div style={{ padding: '12px 16px', fontSize: 13,
                            color: '#64748b', textAlign: 'center' }}>
                            Searching organisation…
                          </div>
                        )}
                        {acSuggestions.length > 0 && (
                          <>
                            <div style={{ padding: '6px 14px', fontSize: 11, fontWeight: 700,
                              color: '#2563eb', background: '#eff6ff',
                              textTransform: 'uppercase', letterSpacing: 0.5 }}>
                              Organisation
                            </div>
                            {acSuggestions.map(p => (
                              <div
                                key={p.id || p.email}
                                onMouseDown={e => { e.preventDefault(); addToQueue(p.email, p.displayName); }}
                                style={{ padding: '10px 16px', cursor: 'pointer',
                                  borderBottom: '1px solid #f1f5f9' }}
                                onMouseEnter={e => e.currentTarget.style.background = '#eff6ff'}
                                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                              >
                                <div style={{ fontWeight: 600, fontSize: 13, color: '#0f172a' }}>
                                  {p.displayName}
                                </div>
                                {p.email && (
                                  <div style={{ fontSize: 12, color: '#2563eb' }}>{p.email}</div>
                                )}
                                {p.jobTitle && (
                                  <div style={{ fontSize: 11, color: '#64748b', fontStyle: 'italic' }}>
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

                  <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 6 }}>
                    Press{' '}
                    <kbd style={{ background: '#e2e8f0', padding: '1px 4px', borderRadius: 3,
                      fontSize: 10, fontFamily: 'monospace' }}>Enter</kbd>
                    {' '}or{' '}
                    <kbd style={{ background: '#e2e8f0', padding: '1px 4px', borderRadius: 3,
                      fontSize: 10, fontFamily: 'monospace' }}>,</kbd>
                    {' '}to add each person, then click Send Invites.
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between',
                    alignItems: 'center', marginTop: 14 }}>
                    <span style={{ fontSize: 12, color: '#64748b' }}>
                      {inviteQueue.length > 0
                        ? `${inviteQueue.length} ${inviteQueue.length === 1 ? 'person' : 'people'} queued`
                        : ''}
                    </span>
                    <button
                      className="btn btn-gold"
                      disabled={!canSend}
                      onClick={() => {
                        if (inviteInput.trim() && isValidEmail(inviteInput)) {
                          handleSendAll(inviteInput.trim());
                        } else {
                          handleSendAll();
                        }
                      }}
                      style={{ fontSize: 13, minWidth: 120 }}
                    >
                      {inviting
                        ? 'Sending…'
                        : inviteQueue.length > 1
                          ? `Send ${inviteQueue.length} Invites`
                          : 'Send Invite'}
                    </button>
                  </div>

                  {/* Per-person results */}
                  {inviteResults.length > 0 && (
                    <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {inviteResults.map(r => (
                        <div key={r.email} style={{ display: 'flex', alignItems: 'center', gap: 8,
                          fontSize: 12, color: r.ok ? '#16a34a' : '#dc2626' }}>
                          {r.ok ? <CheckCircle2 size={13} /> : <X size={13} />}
                          <span style={{ fontWeight: 600 }}>{r.email}</span>
                          <span>— {r.msg}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ── Scrollable: members + pending invites ── */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px 24px' }}>

              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-lighter)',
                textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
                Current Members
              </div>

              {members.length === 0 ? (
                <p style={{ color: 'var(--ink-lighter)', fontSize: 13 }}>No members yet.</p>
              ) : members.map(m => {
                // Stuck = member doc exists but UID not yet in memberUids array
                // (happens when Phase 2 of acceptSheetInvite was blocked by old rules)
                const isStuck = sheet?.memberUids && !sheet.memberUids.includes(m.uid);
                return (
                <div key={m.uid} style={{ display: 'flex', alignItems: 'center', gap: 12,
                  padding: '11px 0', borderBottom: '1px solid var(--paper-line)' }}>
                  <div style={{ width: 38, height: 38, borderRadius: '50%', flexShrink: 0,
                    background: m.role === 'owner' ? '#7c3aed22' : '#06b6d422',
                    color: m.role === 'owner' ? '#7c3aed' : '#0891b2',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontWeight: 700, fontSize: 15 }}>
                    {(m.name || m.email || '?')[0].toUpperCase()}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)',
                      display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      {m.name || m.email}
                      {m.uid === currentUser?.uid && (
                        <span style={{ fontSize: 11, color: 'var(--ink-lighter)' }}>(You)</span>
                      )}
                      {isStuck && (
                        <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px',
                          borderRadius: 6, background: '#fef3c7', color: '#d97706',
                          border: '1px solid #fde68a' }}>
                          ⚠ No access yet
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--ink-lighter)' }}>{m.email}</div>
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 10,
                    background: m.role === 'owner' ? '#ede9fe' : '#e0f2fe',
                    color: m.role === 'owner' ? '#7c3aed' : '#0284c7', flexShrink: 0 }}>
                    {m.role === 'owner' ? '👑 Owner' : 'Editor'}
                  </span>
                  {isOwner && isStuck && (
                    <button
                      className="btn btn-sm"
                      style={{ fontSize: 11, flexShrink: 0, background: '#16a34a', color: '#fff',
                        border: 'none', borderRadius: 6, padding: '4px 10px', cursor: 'pointer',
                        opacity: syncing === m.uid ? 0.7 : 1 }}
                      title="Grant access — syncs this member so they can see the sheet"
                      disabled={syncing === m.uid}
                      onClick={() => handleSync(m.uid)}
                    >
                      {syncing === m.uid ? '…' : 'Fix Access'}
                    </button>
                  )}
                  {isOwner && m.uid !== currentUser?.uid && m.role !== 'owner' && (
                    <button className="btn-icon" style={{ color: '#dc2626', flexShrink: 0 }}
                      title="Remove from sheet" disabled={removing === m.uid}
                      onClick={() => handleRemove(m.uid)}>
                      <UserMinus size={15} />
                    </button>
                  )}
                </div>
                );
              })}

              {/* Pending invites */}
              {pendingInvites.length > 0 && (
                <div style={{ marginTop: 22 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-lighter)',
                    textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
                    Pending Invites ({pendingInvites.length})
                  </div>
                  {pendingInvites.map(inv => (
                    <div key={inv.id} style={{ display: 'flex', alignItems: 'center', gap: 10,
                      padding: '9px 0', borderBottom: '1px solid var(--paper-line)' }}>
                      <Clock size={14} style={{ color: '#d97706', flexShrink: 0 }} />
                      <span style={{ flex: 1, fontSize: 13, color: 'var(--ink)' }}>
                        {inv.inviteeEmail}
                      </span>
                      <span style={{ fontSize: 11, color: '#d97706',
                        fontWeight: 600, flexShrink: 0 }}>
                        Pending
                      </span>
                      {isOwner && (
                        <button className="btn btn-sm btn-outline"
                          style={{ fontSize: 11, flexShrink: 0 }}
                          onClick={() => rejectSheetInvite(inv)}>
                          Revoke
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>

        ) : (
          /* ── Audit Log tab — fully scrollable ── */
          <div style={{ flex: 1, overflowY: 'auto', padding: '18px 24px 24px' }}>
            {auditLog.length === 0 ? (
              <p style={{ color: 'var(--ink-lighter)', fontSize: 13 }}>No audit events yet.</p>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: 'var(--paper-dark)', position: 'sticky', top: 0 }}>
                    {['Timestamp', 'User', 'Action', 'Details'].map(h => (
                      <th key={h} style={{ padding: '9px 10px', textAlign: 'left',
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
                        <span style={{ padding: '2px 7px', borderRadius: 6,
                          fontSize: 11, fontWeight: 600,
                          background: ev.action === 'cell_edit'    ? '#f0fdf4' :
                                      ev.action === 'sheet_opened' ? '#eff6ff' :
                                      ev.action.includes('access') ? '#fefce8' : '#f5f3ff',
                          color:      ev.action === 'cell_edit'    ? '#15803d' :
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
  );
}
