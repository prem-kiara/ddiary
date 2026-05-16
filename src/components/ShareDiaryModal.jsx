import { useState, useRef, useEffect } from 'react';
import { X, UserPlus, UserMinus, Users, Clock, CheckCircle2 } from 'lucide-react';
import {
  useSharedDiaryLive, useDiaryPendingInvites,
  inviteToDiary, rejectDiaryInvite, removeSharedDiaryMember,
} from '../hooks/useSharedDiaries';

const isValidEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((e || '').trim());

export default function ShareDiaryModal({ diaryId, diaryTitle, currentUser, onClose }) {
  const [removing,      setRemoving]      = useState(null);
  const [inviteInput,   setInviteInput]   = useState('');
  const [inviteQueue,   setInviteQueue]   = useState([]);
  const [inviting,      setInviting]      = useState(false);
  const [inviteResults, setInviteResults] = useState([]);

  // Autocomplete
  const [acSuggestions, setAcSuggestions] = useState([]);
  const [acSearching,   setAcSearching]   = useState(false);
  const [acOpen,        setAcOpen]        = useState(false);
  const acWrapRef = useRef();
  const acTimer   = useRef();
  const inputRef  = useRef();

  const { diary, members, loading } = useSharedDiaryLive(diaryId);
  const pendingInvites = useDiaryPendingInvites(diaryId);
  const isOwner = members.find(m => m.uid === currentUser?.uid)?.role === 'owner';

  // Close autocomplete on outside click
  useEffect(() => {
    const handler = (e) => {
      if (acWrapRef.current && !acWrapRef.current.contains(e.target)) setAcOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

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
    if (e.key === 'Escape') setAcOpen(false);
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
          await inviteToDiary(diaryId, diaryTitle, currentUser, email);
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
    if (!window.confirm('Remove this person from the diary entry?')) return;
    setRemoving(uid);
    try { await removeSharedDiaryMember(diaryId, uid); } catch {}
    setRemoving(null);
  };

  const canSend = !inviting && (inviteQueue.length > 0 || (inviteInput.trim() && isValidEmail(inviteInput)));

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: '#fff', borderRadius: 18, width: '100%', maxWidth: 620,
        maxHeight: '88vh', display: 'flex', flexDirection: 'column',
        boxShadow: '0 28px 70px rgba(0,0,0,0.22)',
      }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12,
          padding: '18px 24px', borderBottom: '1px solid var(--paper-line)', flexShrink: 0 }}>
          <Users size={18} style={{ color: '#7c3aed', flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--ink)' }}>Collaborate on Entry</div>
            <div style={{ fontSize: 12, color: 'var(--ink-lighter)', marginTop: 1,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {diaryTitle || 'Untitled Entry'}
            </div>
          </div>
          <button onClick={onClose} className="btn-icon"><X size={16} /></button>
        </div>

        {loading ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <p style={{ color: 'var(--ink-lighter)', fontSize: 13 }}>Loading…</p>
          </div>
        ) : (
          <>
            {/* Invite section (owner only) */}
            {isOwner && (
              <div style={{ flexShrink: 0, padding: '18px 24px 0' }}>
                <div style={{ padding: 16, background: '#f8fafc',
                  borderRadius: 12, border: '1px solid var(--paper-line)' }}>
                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12,
                    display: 'flex', alignItems: 'center', gap: 6, color: 'var(--ink)' }}>
                    <UserPlus size={14} style={{ color: '#7c3aed' }} />
                    Invite people to co-edit
                  </div>

                  <div ref={acWrapRef} style={{ position: 'relative' }}>
                    <div
                      onClick={() => inputRef.current?.focus()}
                      style={{
                        display: 'flex', flexWrap: 'wrap', gap: 6, padding: '8px 10px',
                        minHeight: 46, border: '1px solid #cbd5e1', borderRadius: 8,
                        background: '#fff', cursor: 'text', alignItems: 'center',
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
                          ><X size={11} /></button>
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

                    {acOpen && (acSuggestions.length > 0 || acSearching) && (
                      <div style={{
                        position: 'absolute', top: 'calc(100% + 3px)', left: 0, right: 0,
                        zIndex: 9999,
                        background: '#fff', border: '1px solid #cbd5e1', borderRadius: 10,
                        boxShadow: '0 8px 24px rgba(0,0,0,0.14)', maxHeight: 200, overflowY: 'auto',
                      }}>
                        {acSearching && acSuggestions.length === 0 && (
                          <div style={{ padding: '12px 16px', fontSize: 13, color: '#64748b', textAlign: 'center' }}>
                            Searching organisation…
                          </div>
                        )}
                        {acSuggestions.map(p => (
                          <div
                            key={p.id || p.email}
                            onMouseDown={e => { e.preventDefault(); addToQueue(p.email, p.displayName); }}
                            style={{ padding: '10px 16px', cursor: 'pointer', borderBottom: '1px solid #f1f5f9' }}
                            onMouseEnter={e => e.currentTarget.style.background = '#f5f3ff'}
                            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                          >
                            <div style={{ fontWeight: 600, fontSize: 13, color: '#0f172a' }}>{p.displayName}</div>
                            {p.email && <div style={{ fontSize: 12, color: '#7c3aed' }}>{p.email}</div>}
                            {p.jobTitle && <div style={{ fontSize: 11, color: '#64748b', fontStyle: 'italic' }}>{p.jobTitle}</div>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 6 }}>
                    Press{' '}
                    <kbd style={{ background: '#e2e8f0', padding: '1px 4px', borderRadius: 3, fontSize: 10, fontFamily: 'monospace' }}>Enter</kbd>
                    {' '}or{' '}
                    <kbd style={{ background: '#e2e8f0', padding: '1px 4px', borderRadius: 3, fontSize: 10, fontFamily: 'monospace' }}>,</kbd>
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
                      {inviting ? 'Sending…' : inviteQueue.length > 1
                        ? `Send ${inviteQueue.length} Invites`
                        : 'Send Invite'}
                    </button>
                  </div>

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

            {/* Members list */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px 24px' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-lighter)',
                textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
                Members ({members.length})
              </div>

              {members.length === 0 ? (
                <p style={{ color: 'var(--ink-lighter)', fontSize: 13 }}>No members yet.</p>
              ) : members.map(m => (
                <div key={m.uid} style={{ display: 'flex', alignItems: 'center', gap: 12,
                  padding: '11px 0', borderBottom: '1px solid var(--paper-line)' }}>
                  <div style={{ width: 38, height: 38, borderRadius: '50%', flexShrink: 0,
                    background: m.role === 'owner' ? '#7c3aed22' : '#a78bfa22',
                    color: m.role === 'owner' ? '#7c3aed' : '#6d28d9',
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
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--ink-lighter)' }}>{m.email}</div>
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 10,
                    background: m.role === 'owner' ? '#ede9fe' : '#f5f3ff',
                    color: '#7c3aed', flexShrink: 0 }}>
                    {m.role === 'owner' ? '👑 Owner' : 'Editor'}
                  </span>
                  {isOwner && m.uid !== currentUser?.uid && m.role !== 'owner' && (
                    <button className="btn-icon" style={{ color: '#dc2626', flexShrink: 0 }}
                      title="Remove from diary" disabled={removing === m.uid}
                      onClick={() => handleRemove(m.uid)}>
                      <UserMinus size={15} />
                    </button>
                  )}
                </div>
              ))}

              {pendingInvites.length > 0 && (
                <div style={{ marginTop: 20 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-lighter)',
                    textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
                    Pending Invites ({pendingInvites.length})
                  </div>
                  {pendingInvites.map(inv => (
                    <div key={inv.id} style={{ display: 'flex', alignItems: 'center', gap: 10,
                      padding: '9px 0', borderBottom: '1px solid var(--paper-line)' }}>
                      <Clock size={14} style={{ color: '#d97706', flexShrink: 0 }} />
                      <span style={{ flex: 1, fontSize: 13, color: 'var(--ink)' }}>{inv.inviteeEmail}</span>
                      <span style={{ fontSize: 11, color: '#d97706', fontWeight: 600, flexShrink: 0 }}>Pending</span>
                      {isOwner && (
                        <button className="btn btn-sm btn-outline"
                          style={{ fontSize: 11, flexShrink: 0 }}
                          onClick={() => rejectDiaryInvite(inv)}>
                          Revoke
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
