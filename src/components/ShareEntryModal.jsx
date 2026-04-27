import { useState, useMemo, useEffect } from 'react';
import { X, Send, Search, Check, AlertCircle } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useTeamMembers } from '../hooks/useFirestore';
import { useMyWorkspaces, useWorkspace } from '../hooks/useWorkspace';
import { shareDiaryEntry } from '../utils/emailNotifications';

const MS_TOKEN_KEY = 'ddiary_ms_access_token';

/**
 * ShareEntryModal — pick recipients (workspace members + saved contacts) and
 * email a diary entry via Outlook (Microsoft Graph). Designed for the
 * "share meeting minutes" use case: multiple recipients in a single To: line,
 * optional personal note, optional self-copy.
 */
export default function ShareEntryModal({ entry, onClose, showToast }) {
  const { user } = useAuth();
  const { members: contacts } = useTeamMembers();
  const { workspaces } = useMyWorkspaces();
  // Use the first workspace by convention (same as the rest of the app).
  const activeWsId = workspaces[0]?.id || null;
  const { members: wsMembers } = useWorkspace(activeWsId);

  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState([]); // [{ email, name }]
  const [personalNote, setPersonalNote] = useState('');
  const [copyToSelf, setCopyToSelf] = useState(true);
  const [sending, setSending] = useState(false);
  const [hasMsToken, setHasMsToken] = useState(true);

  // ESC to close + initial token check
  useEffect(() => {
    setHasMsToken(!!sessionStorage.getItem(MS_TOKEN_KEY));
    const onKey = (e) => { if (e.key === 'Escape' && !sending) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, sending]);

  // ── Build the picker pool: workspace members + saved contacts, deduped ────
  const pool = useMemo(() => {
    const map = new Map(); // email → { email, name, source }
    const myEmail = user?.email?.toLowerCase();
    wsMembers.forEach((m) => {
      const e = m.email?.toLowerCase();
      if (!e || e === myEmail) return;
      if (!map.has(e)) map.set(e, { email: e, name: m.displayName || m.name || e, source: 'Workspace' });
    });
    contacts.forEach((c) => {
      const e = c.email?.toLowerCase();
      if (!e || e === myEmail) return;
      if (!map.has(e)) map.set(e, { email: e, name: c.name || e, source: 'Contacts' });
    });
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [wsMembers, contacts, user?.email]);

  // ── Filter by query, hide already-selected ────────────────────────────────
  const filtered = useMemo(() => {
    const selectedEmails = new Set(selected.map(s => s.email));
    const q = query.trim().toLowerCase();
    return pool.filter(p =>
      !selectedEmails.has(p.email) &&
      (!q || p.name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q))
    );
  }, [pool, query, selected]);

  // Allow adding a typed email that isn't in the directory
  const typedEmailValid = /^\S+@\S+\.\S+$/.test(query.trim());
  const typedEmailNew = typedEmailValid &&
    !selected.some(s => s.email === query.trim().toLowerCase()) &&
    !pool.some(p => p.email === query.trim().toLowerCase());

  const addRecipient = (r) => {
    setSelected(prev => prev.some(s => s.email === r.email) ? prev : [...prev, r]);
    setQuery('');
  };
  const removeRecipient = (email) =>
    setSelected(prev => prev.filter(s => s.email !== email));

  const addTyped = () => {
    const e = query.trim().toLowerCase();
    if (!typedEmailNew) return;
    addRecipient({ email: e, name: e, source: 'Typed' });
  };

  // ── Send ──────────────────────────────────────────────────────────────────
  const handleSend = async () => {
    if (selected.length === 0) { showToast('Add at least one recipient.', 'warning'); return; }
    if (!hasMsToken) { showToast('Sign in with Microsoft first to send email.', 'warning'); return; }
    setSending(true);
    try {
      const ok = await shareDiaryEntry({
        entry,
        recipients: selected.map(s => s.email),
        senderName: user?.displayName || user?.email?.split('@')[0] || 'A colleague',
        personalNote,
        copyToSelf,
        selfEmail: user?.email,
      });
      if (ok) {
        showToast(`Entry shared with ${selected.length} recipient${selected.length === 1 ? '' : 's'}.`, 'success');
        onClose();
      } else {
        showToast('Could not send email — your Microsoft session may have expired.', 'warning');
      }
    } catch (err) {
      console.error('Share send error:', err);
      showToast('Something went wrong sending the email.', 'warning');
    } finally {
      setSending(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  const overlayStyle = {
    position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.55)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: 16, zIndex: 1000,
  };
  const cardStyle = {
    background: '#fff', borderRadius: 12, width: '100%', maxWidth: 540,
    maxHeight: '90vh', display: 'flex', flexDirection: 'column',
    boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
  };

  return (
    <div style={overlayStyle} onClick={(e) => { if (e.target === e.currentTarget && !sending) onClose(); }}>
      <div style={cardStyle}>
        {/* Header */}
        <div style={{
          padding: '16px 20px', borderBottom: '1px solid #e2e8f0',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ minWidth: 0 }}>
            <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: '#0f172a' }}>Share entry</h3>
            <p style={{ margin: '2px 0 0', fontSize: 13, color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {entry.title || 'Untitled'} · via Outlook
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={sending}
            style={{ background: 'none', border: 'none', padding: 6, cursor: sending ? 'not-allowed' : 'pointer', color: '#64748b' }}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body (scrollable) */}
        <div style={{ padding: 20, overflowY: 'auto', flex: 1 }}>
          {!hasMsToken && (
            <div style={{
              display: 'flex', gap: 8, alignItems: 'flex-start',
              background: '#fef3c7', border: '1px solid #fcd34d',
              borderRadius: 8, padding: '10px 12px', marginBottom: 14,
              fontSize: 13, color: '#92400e',
            }}>
              <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>Sign in with Microsoft (Settings → Connect Outlook) to enable email sending.</span>
            </div>
          )}

          {/* Personal note */}
          <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#475569', marginBottom: 6 }}>
            Personal note <span style={{ fontWeight: 400, color: '#94a3b8' }}>(optional)</span>
          </label>
          <textarea
            value={personalNote}
            onChange={(e) => setPersonalNote(e.target.value)}
            placeholder="Add a short message above the entry — e.g. 'Minutes from today's meeting.'"
            rows={2}
            style={{
              width: '100%', boxSizing: 'border-box', padding: '8px 10px',
              border: '1px solid #cbd5e1', borderRadius: 8, fontSize: 14,
              fontFamily: 'inherit', resize: 'vertical', outline: 'none',
              marginBottom: 16,
            }}
          />

          {/* Recipients label */}
          <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#475569', marginBottom: 6 }}>
            Recipients
          </label>

          {/* Selected chips */}
          {selected.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
              {selected.map(s => (
                <span key={s.email} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  background: '#ede9fe', color: '#5b21b6',
                  fontSize: 13, fontWeight: 500,
                  padding: '4px 6px 4px 10px', borderRadius: 999,
                }}>
                  {s.name}
                  <button
                    onClick={() => removeRecipient(s.email)}
                    style={{ background: 'none', border: 'none', padding: 2, cursor: 'pointer', color: '#5b21b6', display: 'flex' }}
                    aria-label={`Remove ${s.name}`}
                  >
                    <X size={13} />
                  </button>
                </span>
              ))}
            </div>
          )}

          {/* Search */}
          <div style={{ position: 'relative', marginBottom: 8 }}>
            <Search size={15} style={{ position: 'absolute', left: 10, top: 12, color: '#94a3b8' }} />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && typedEmailNew) { e.preventDefault(); addTyped(); }
              }}
              placeholder="Search by name or email…"
              style={{
                width: '100%', boxSizing: 'border-box',
                padding: '9px 10px 9px 32px',
                border: '1px solid #cbd5e1', borderRadius: 8,
                fontSize: 14, outline: 'none',
              }}
            />
          </div>

          {/* Typed-email "Add" row */}
          {typedEmailNew && (
            <button
              onClick={addTyped}
              style={{
                width: '100%', textAlign: 'left',
                padding: '10px 12px', marginBottom: 6,
                background: '#f0fdf4', border: '1px solid #86efac',
                borderRadius: 8, cursor: 'pointer',
                fontSize: 13, color: '#15803d', fontWeight: 500,
              }}
            >
              + Add <strong>{query.trim().toLowerCase()}</strong>
            </button>
          )}

          {/* Filtered list */}
          <div style={{
            border: '1px solid #e2e8f0', borderRadius: 8,
            maxHeight: 220, overflowY: 'auto',
          }}>
            {filtered.length === 0 ? (
              <p style={{ margin: 0, padding: '14px 12px', fontSize: 13, color: '#94a3b8', textAlign: 'center' }}>
                {pool.length === 0
                  ? 'No workspace members or saved contacts yet.'
                  : query ? 'No matches. Type a full email and press Enter to add.' : 'Search to find recipients.'}
              </p>
            ) : (
              filtered.map(p => (
                <button
                  key={p.email}
                  onClick={() => addRecipient(p)}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                    padding: '9px 12px', background: 'transparent', border: 'none',
                    borderBottom: '1px solid #f1f5f9', cursor: 'pointer', textAlign: 'left',
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = '#f8fafc'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                >
                  <div style={{
                    width: 30, height: 30, borderRadius: '50%',
                    background: '#ede9fe', color: '#6d28d9',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 12, fontWeight: 700, flexShrink: 0,
                  }}>
                    {p.name.charAt(0).toUpperCase()}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 500, color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {p.name}
                    </div>
                    <div style={{ fontSize: 12, color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {p.email}
                    </div>
                  </div>
                  <span style={{
                    fontSize: 10, fontWeight: 600, color: '#7c3aed',
                    background: '#f5f3ff', padding: '2px 8px', borderRadius: 999,
                    flexShrink: 0,
                  }}>{p.source}</span>
                </button>
              ))
            )}
          </div>

          {/* Self-copy */}
          <label style={{
            display: 'flex', alignItems: 'center', gap: 8,
            marginTop: 14, fontSize: 13, color: '#475569', cursor: 'pointer',
          }}>
            <input
              type="checkbox"
              checked={copyToSelf}
              onChange={(e) => setCopyToSelf(e.target.checked)}
              style={{ width: 15, height: 15, accentColor: '#6d28d9' }}
            />
            Send a copy to me ({user?.email})
          </label>

          {/* Drawing notice */}
          {entry.drawings?.length > 0 && (
            <p style={{ margin: '12px 0 0', fontSize: 12, color: '#64748b' }}>
              {entry.drawings.length} drawing{entry.drawings.length === 1 ? '' : 's'} will be embedded in the email.
              External recipients may need a Dhanam sign-in if anonymous sharing is disabled in your tenant.
            </p>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '12px 20px', borderTop: '1px solid #e2e8f0',
          display: 'flex', justifyContent: 'flex-end', gap: 8,
        }}>
          <button
            onClick={onClose}
            disabled={sending}
            className="btn btn-sm btn-outline"
          >
            Cancel
          </button>
          <button
            onClick={handleSend}
            disabled={sending || selected.length === 0 || !hasMsToken}
            className="btn btn-sm"
            style={{
              background: '#6d28d9', color: '#fff', border: 'none',
              opacity: (sending || selected.length === 0 || !hasMsToken) ? 0.5 : 1,
              cursor:  (sending || selected.length === 0 || !hasMsToken) ? 'not-allowed' : 'pointer',
            }}
          >
            {sending
              ? <>Sending…</>
              : <><Send size={13} /> Send email{selected.length > 1 ? ` (${selected.length})` : ''}</>}
          </button>
        </div>
      </div>
    </div>
  );
}
