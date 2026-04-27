import { useState, useMemo, useEffect, useRef } from 'react';
import { X, Send, Search, Check, AlertCircle, Loader2 } from 'lucide-react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { useTeamMembers } from '../hooks/useFirestore';
import { useMyWorkspaces } from '../hooks/useWorkspace';
import { shareDiaryEntry } from '../utils/emailNotifications';
import { searchOrgPeople } from '../utils/graphPeopleSearch';

/**
 * ShareEntryModal — pick recipients (workspace members + saved contacts) and
 * email a diary entry via Outlook (Microsoft Graph). Designed for the
 * "share meeting minutes" use case: multiple recipients in a single To: line,
 * optional personal note, optional self-copy.
 */
export default function ShareEntryModal({ entry, onClose, showToast }) {
  // msToken is exposed by AuthContext as React state, so the disabled-Send
  // gate stays reactive — if the user signs in to Microsoft mid-session
  // (e.g. via another tab) the banner disappears and the button enables
  // automatically without the modal needing to be reopened.
  const { user, msToken } = useAuth();
  const hasMsToken = !!msToken;
  const { members: contacts } = useTeamMembers();
  const { workspaces } = useMyWorkspaces();

  // Members from EVERY workspace the user is in, deduped by email. Fetched
  // one-shot when the modal opens (not real-time) — adding a member to a
  // workspace is rare, and the Graph org-search below covers anyone we miss.
  // ~7 workspaces × ~10 members = ~70 reads on modal open: negligible.
  const [allWsMembers, setAllWsMembers] = useState([]);
  useEffect(() => {
    if (!workspaces || workspaces.length === 0) { setAllWsMembers([]); return; }
    let cancelled = false;
    (async () => {
      const map = new Map();
      await Promise.all(workspaces.map(async (ws) => {
        try {
          const snap = await getDocs(collection(db, 'workspaces', ws.id, 'members'));
          snap.docs.forEach(d => {
            const m = d.data();
            const e = m.email?.toLowerCase();
            if (!e) return;
            if (!map.has(e)) map.set(e, { email: e, displayName: m.displayName || e });
          });
        } catch { /* permission errors swallowed — that workspace just won't contribute */ }
      }));
      if (!cancelled) setAllWsMembers(Array.from(map.values()));
    })();
    return () => { cancelled = true; };
  }, [workspaces]);

  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState([]); // [{ email, name }]
  const [personalNote, setPersonalNote] = useState('');
  const [copyToSelf, setCopyToSelf] = useState(true);
  const [sending, setSending] = useState(false);

  // Org-directory search results (M365 via Graph). Local pool always renders
  // immediately; org results stream in 300ms after the user stops typing so
  // they can pick anyone in the company even if that person has never been
  // added to a workspace or saved as a contact.
  const [orgResults, setOrgResults] = useState([]);
  const [orgSearching, setOrgSearching] = useState(false);
  const orgSearchTimerRef = useRef(null);
  const orgSearchSeqRef = useRef(0); // race guard for stale responses

  // ESC to close
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !sending) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, sending]);

  // ── Debounced org-directory search ────────────────────────────────────────
  // Fires ~300ms after the user stops typing. seqRef prevents an older
  // in-flight response from overwriting a newer one (e.g. user types fast →
  // fast response from earlier query arrives after slow response from later
  // query); we only commit results whose sequence number is the latest.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2 || !hasMsToken) {
      setOrgResults([]);
      setOrgSearching(false);
      if (orgSearchTimerRef.current) clearTimeout(orgSearchTimerRef.current);
      return;
    }
    setOrgSearching(true);
    if (orgSearchTimerRef.current) clearTimeout(orgSearchTimerRef.current);
    const mySeq = ++orgSearchSeqRef.current;
    orgSearchTimerRef.current = setTimeout(async () => {
      const results = await searchOrgPeople(q);
      if (mySeq !== orgSearchSeqRef.current) return; // stale
      setOrgResults(results || []);
      setOrgSearching(false);
    }, 300);
    return () => {
      if (orgSearchTimerRef.current) clearTimeout(orgSearchTimerRef.current);
    };
  }, [query, hasMsToken]);

  // ── Build the picker pool: workspace members (across ALL workspaces) +
  //    saved contacts, deduped by email. Sorted alphabetically.
  const pool = useMemo(() => {
    const map = new Map(); // email → { email, name, source }
    const myEmail = user?.email?.toLowerCase();
    allWsMembers.forEach((m) => {
      const e = m.email?.toLowerCase();
      if (!e || e === myEmail) return;
      if (!map.has(e)) map.set(e, { email: e, name: m.displayName || e, source: 'Team' });
    });
    contacts.forEach((c) => {
      const e = c.email?.toLowerCase();
      if (!e || e === myEmail) return;
      if (!map.has(e)) map.set(e, { email: e, name: c.name || e, source: 'Contacts' });
    });
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [allWsMembers, contacts, user?.email]);

  // ── Filter pool + merge org-directory results, hide already-selected ──────
  // Local pool (workspace + contacts) is shown first because it matches faster
  // and is more relevant. Org-directory results are appended below, deduped
  // against everything already in the list (a workspace member who also exists
  // in the org directory only appears once, with the higher-priority source
  // label preserved).
  const filtered = useMemo(() => {
    const selectedEmails = new Set(selected.map(s => s.email));
    const q = query.trim().toLowerCase();
    const localMatches = pool.filter(p =>
      !selectedEmails.has(p.email) &&
      (!q || p.name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q))
    );
    const seen = new Set([...selectedEmails, ...localMatches.map(p => p.email)]);
    const orgMatches = (orgResults || [])
      .map(o => ({
        email: (o.email || '').toLowerCase(),
        name:  o.displayName || o.email || '',
        source: 'Organization',
      }))
      .filter(o => o.email && !seen.has(o.email));
    return [...localMatches, ...orgMatches];
  }, [pool, query, selected, orgResults]);

  // Allow adding a typed email that isn't in any directory
  const typedEmailValid = /^\S+@\S+\.\S+$/.test(query.trim());
  const typedEmailNew = typedEmailValid &&
    !selected.some(s => s.email === query.trim().toLowerCase()) &&
    !filtered.some(p => p.email === query.trim().toLowerCase());

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
              placeholder="Search anyone in your organization…"
              style={{
                width: '100%', boxSizing: 'border-box',
                padding: '9px 36px 9px 32px',
                border: '1px solid #cbd5e1', borderRadius: 8,
                fontSize: 14, outline: 'none',
              }}
            />
            {orgSearching && (
              <Loader2
                size={15}
                style={{
                  position: 'absolute', right: 10, top: 12,
                  color: '#7c3aed', animation: 'spin 0.9s linear infinite',
                }}
              />
            )}
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
                {!query
                  ? 'Type to search workspace members, contacts, or your organization.'
                  : query.trim().length < 2
                    ? 'Type at least 2 characters to search.'
                    : orgSearching
                      ? 'Searching organization…'
                      : 'No matches. Type a full email and press Enter to add.'}
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
