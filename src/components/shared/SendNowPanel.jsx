/**
 * SendNowPanel — reusable "send on demand" panel for Diary and Sheets.
 *
 * Lets the current user search the org directory, pick a recipient, add an
 * optional personal note, and then fire an Email or WhatsApp to that person
 * referencing the current diary entry / sheet.
 *
 * Usage:
 *   <SendNowPanel
 *     type="diary"        // 'diary' | 'sheet'
 *     title="Board Minutes"
 *     showToast={showToast}
 *     user={user}
 *     onClose={() => setShowSend(false)}
 *   />
 */
import { useState, useMemo } from 'react';
import { Mail, MessageCircle, Loader2, X, Search, CheckCircle } from 'lucide-react';
import { searchOrgPeopleDebounced } from '../../utils/graphPeopleSearch';
import { useTeamMembers } from '../../hooks/useFirestore';
import { sendDiaryWhatsApp, sendSheetWhatsApp } from '../../utils/whatsapp';

export default function SendNowPanel({ type, title, showToast, user, onClose }) {
  const { members } = useTeamMembers();

  // Build a fast email → phone lookup from the saved contacts book
  const phoneByEmail = useMemo(() => {
    const m = new Map();
    for (const mem of members || []) {
      if (mem.email && mem.phone) m.set(mem.email.toLowerCase(), mem.phone);
    }
    return m;
  }, [members]);

  const [query,        setQuery]        = useState('');
  const [suggestions,  setSuggestions]  = useState([]);
  const [selected,     setSelected]     = useState(null);   // { name, email, phone }
  const [note,         setNote]         = useState('');
  const [emailSending, setEmailSending] = useState(false);

  const isDiary = type === 'diary';
  const accent  = isDiary ? '#7c3aed' : '#15803d';
  const bgLight = isDiary ? '#f5f3ff' : '#f0fdf4';
  const emoji   = isDiary ? '📖'       : '📊';

  const handleSearch = (val) => {
    setQuery(val);
    if (val.trim().length >= 2) {
      searchOrgPeopleDebounced(val.trim()).then(r => setSuggestions(r || []));
    } else {
      setSuggestions([]);
    }
  };

  const selectPerson = (person) => {
    const email = (person.email || '').toLowerCase();
    const phone = phoneByEmail.get(email)
      || person.businessPhones?.[0]
      || person.mobilePhone
      || '';
    setSelected({ name: person.displayName || email, email, phone });
    setQuery('');
    setSuggestions([]);
  };

  const handleEmail = async () => {
    if (!selected?.email) return;
    setEmailSending(true);
    try {
      const mod = await import('../../utils/emailNotifications');
      const fn  = isDiary ? mod.sendDiaryShareNow : mod.sendSheetShareNow;
      const ok  = await fn({
        toEmail:      selected.email,
        toName:       selected.name,
        diaryTitle:   title,  // sendDiaryShareNow reads this
        sheetTitle:   title,  // sendSheetShareNow reads this
        senderName:   user?.displayName || user?.email || 'Your colleague',
        personalNote: note,
      });
      if (ok !== false) {
        showToast?.(`Email sent to ${selected.name}.`, 'success');
        setSelected(null);
        setNote('');
      } else {
        showToast?.('Could not send email. Please try again.', 'warning');
      }
    } catch {
      showToast?.('Could not send email. Please try again.', 'warning');
    }
    setEmailSending(false);
  };

  const handleWhatsApp = () => {
    if (!selected) return;
    const fn = isDiary ? sendDiaryWhatsApp : sendSheetWhatsApp;
    fn({
      title,
      phone:         selected.phone,
      senderName:    user?.displayName || user?.email || 'Your colleague',
      recipientName: selected.name,
      showToast,
    });
  };

  return (
    <div style={{
      background: bgLight,
      border: `1px solid ${accent}33`,
      borderRadius: 10,
      padding: '14px 16px',
      marginTop: 8,
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: accent, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          {emoji} Send {isDiary ? 'Diary Entry' : 'Sheet'} to Someone
        </span>
        <button
          onClick={onClose}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', padding: 2, display: 'flex' }}
        >
          <X size={14} />
        </button>
      </div>

      {/* Title preview */}
      <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a', marginBottom: 10, padding: '6px 10px', background: '#fff', borderRadius: 6, border: '1px solid #e2e8f0' }}>
        {title || 'Untitled'}
      </div>

      {/* Person search */}
      {!selected ? (
        <div style={{ position: 'relative' }}>
          <div style={{ position: 'relative' }}>
            <Search size={13} color="#94a3b8" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
            <input
              type="text"
              value={query}
              onChange={e => handleSearch(e.target.value)}
              onBlur={() => setTimeout(() => setSuggestions([]), 150)}
              placeholder="Search name or email…"
              autoComplete="off"
              style={{
                width: '100%', padding: '8px 10px 8px 30px',
                border: '1px solid #e2e8f0', borderRadius: 8,
                fontSize: 13, fontFamily: 'var(--font-body)',
                background: '#fff', color: '#0f172a', outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>
          {suggestions.length > 0 && (
            <div style={{
              position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 300,
              background: '#fff', border: '1px solid #cbd5e1', borderRadius: 8,
              boxShadow: '0 4px 16px rgba(0,0,0,0.12)', marginTop: 2, overflow: 'hidden',
            }}>
              {suggestions.map(p => (
                <div
                  key={p.id || p.email}
                  onMouseDown={() => selectPerson(p)}
                  style={{ padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid #f1f5f9' }}
                  onMouseEnter={e => { e.currentTarget.style.background = '#f1f5f9'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = '#fff'; }}
                >
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>{p.displayName}</div>
                  <div style={{ fontSize: 11, color: '#475569' }}>{p.email}{p.jobTitle ? ` · ${p.jobTitle}` : ''}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        /* Selected person + action buttons */
        <div>
          {/* Person pill */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', background: '#fff', borderRadius: 8, border: `1px solid ${accent}44`, marginBottom: 10 }}>
            <CheckCircle size={14} color={accent} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {selected.name}
              </div>
              <div style={{ fontSize: 11, color: '#64748b' }}>{selected.email}</div>
            </div>
            <button
              onClick={() => setSelected(null)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', padding: 2, flexShrink: 0 }}
              title="Change recipient"
            >
              <X size={12} />
            </button>
          </div>

          {/* Optional personal note */}
          <textarea
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="Add a personal note (optional)…"
            rows={2}
            style={{
              width: '100%', padding: '8px 10px',
              border: '1px solid #e2e8f0', borderRadius: 8,
              fontSize: 13, fontFamily: 'var(--font-body)',
              background: '#fff', color: '#0f172a',
              resize: 'none', outline: 'none',
              boxSizing: 'border-box', lineHeight: 1.5, marginBottom: 10,
            }}
          />

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              onClick={handleEmail}
              disabled={emailSending}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '7px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600,
                cursor: emailSending ? 'not-allowed' : 'pointer',
                border: 'none', background: '#2563eb', color: '#fff',
                opacity: emailSending ? 0.6 : 1, transition: 'opacity 0.15s',
              }}
            >
              {emailSending ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Mail size={13} />}
              {emailSending ? 'Sending…' : 'Email Now'}
            </button>

            <button
              onClick={handleWhatsApp}
              disabled={!selected.phone}
              title={!selected.phone ? 'No phone number saved for this contact. Add it in Settings → Contacts.' : `Send WhatsApp to ${selected.phone}`}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '7px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600,
                cursor: !selected.phone ? 'not-allowed' : 'pointer',
                border: 'none',
                background: selected.phone ? '#25D366' : '#e2e8f0',
                color: selected.phone ? '#fff' : '#94a3b8',
                transition: 'opacity 0.15s',
              }}
            >
              <MessageCircle size={13} />
              WhatsApp
            </button>

            {!selected.phone && (
              <span style={{ fontSize: 11, color: '#94a3b8', alignSelf: 'center' }}>
                No phone — add in Settings → Contacts
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
