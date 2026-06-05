/**
 * SendNowPanel — reusable "send on demand" panel for Diary and Sheets.
 *
 * Supports multiple recipients. Each person is shown as a pill; email goes
 * to all of them. WhatsApp opens one window per recipient that has a phone.
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
import { Mail, MessageCircle, Loader2, X, Search, UserPlus } from 'lucide-react';
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
  const [recipients,   setRecipients]   = useState([]); // [{ name, email, phone }]
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

  const addPerson = (person) => {
    const email = (person.email || '').toLowerCase();
    if (!email || recipients.find(r => r.email === email)) return;
    const phone = phoneByEmail.get(email)
      || person.businessPhones?.[0]
      || person.mobilePhone
      || '';
    setRecipients(prev => [...prev, { name: person.displayName || email, email, phone }]);
    setQuery('');
    setSuggestions([]);
  };

  const removeRecipient = (email) =>
    setRecipients(prev => prev.filter(r => r.email !== email));

  const handleEmailAll = async () => {
    if (!recipients.length) return;
    setEmailSending(true);
    try {
      const mod = await import('../../utils/emailNotifications');
      const fn  = isDiary ? mod.sendDiaryShareNow : mod.sendSheetShareNow;
      const senderName = user?.displayName || user?.email || 'Your colleague';
      const results = await Promise.allSettled(
        recipients.map(r => fn({
          toEmail:      r.email,
          toName:       r.name,
          diaryTitle:   title,
          sheetTitle:   title,
          senderName,
          personalNote: note,
        }))
      );
      const failed = results.filter(r => r.status === 'rejected' || r.value === false).length;
      if (failed === 0) {
        const names = recipients.map(r => r.name.split(' ')[0]).join(', ');
        showToast?.(`Email sent to ${names}.`, 'success');
        setRecipients([]);
        setNote('');
      } else if (failed < recipients.length) {
        showToast?.(`Sent to ${recipients.length - failed} of ${recipients.length} recipients.`, 'warning');
      } else {
        showToast?.('Could not send email. Please try again.', 'warning');
      }
    } catch {
      showToast?.('Could not send email. Please try again.', 'warning');
    }
    setEmailSending(false);
  };

  const handleWhatsApp = (recipient) => {
    const fn = isDiary ? sendDiaryWhatsApp : sendSheetWhatsApp;
    fn({
      title,
      phone:         recipient.phone,
      senderName:    user?.displayName || user?.email || 'Your colleague',
      recipientName: recipient.name,
      showToast,
    });
  };

  const recipientsWithPhone = recipients.filter(r => r.phone);

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
          {emoji} Send {isDiary ? 'Diary Entry' : 'Sheet'}
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

      {/* Recipient pills */}
      {recipients.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 8 }}>
          {recipients.map(r => (
            <span key={r.email} style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              background: '#fff', border: `1px solid ${accent}55`,
              borderRadius: 20, padding: '3px 8px 3px 10px',
              fontSize: 12, fontWeight: 600, color: accent,
            }}>
              {r.name.split(' ')[0]}
              {r.phone && (
                <button
                  onClick={() => handleWhatsApp(r)}
                  title={`WhatsApp ${r.name}`}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: '#25D366', padding: '0 2px', display: 'flex', alignItems: 'center',
                  }}
                >
                  <MessageCircle size={11} />
                </button>
              )}
              <button
                type="button"
                onClick={() => removeRecipient(r.email)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', padding: 0, fontSize: 14, lineHeight: 1, display: 'flex' }}
              >
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Person search — always visible so more people can be added */}
      <div style={{ position: 'relative', marginBottom: 8 }}>
        <Search size={13} color="#94a3b8" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
        <input
          type="text"
          value={query}
          onChange={e => handleSearch(e.target.value)}
          onBlur={() => setTimeout(() => setSuggestions([]), 150)}
          placeholder={recipients.length ? 'Add another recipient…' : 'Search name or email…'}
          autoComplete="off"
          style={{
            width: '100%', padding: '8px 10px 8px 30px',
            border: `1px solid ${recipients.length ? accent + '44' : '#e2e8f0'}`,
            borderRadius: 8,
            fontSize: 13, fontFamily: 'var(--font-body)',
            background: '#fff', color: '#0f172a', outline: 'none',
            boxSizing: 'border-box',
          }}
        />
        {suggestions.length > 0 && (
          <div style={{
            position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 300,
            background: '#fff', border: '1px solid #cbd5e1', borderRadius: 8,
            boxShadow: '0 4px 16px rgba(0,0,0,0.12)', marginTop: 2, overflow: 'hidden',
          }}>
            {suggestions.map(p => {
              const already = recipients.find(r => r.email === p.email?.toLowerCase());
              return (
                <div
                  key={p.id || p.email}
                  onMouseDown={() => !already && addPerson(p)}
                  style={{ padding: '8px 12px', cursor: already ? 'default' : 'pointer', borderBottom: '1px solid #f1f5f9', opacity: already ? 0.5 : 1 }}
                  onMouseEnter={e => { if (!already) e.currentTarget.style.background = '#f1f5f9'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = '#fff'; }}
                >
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>
                    {p.displayName}
                    {already && <span style={{ fontSize: 11, color: accent, marginLeft: 6 }}>✓ added</span>}
                  </div>
                  <div style={{ fontSize: 11, color: '#475569' }}>{p.email}{p.jobTitle ? ` · ${p.jobTitle}` : ''}</div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Only show send controls once at least one recipient is picked */}
      {recipients.length > 0 && (
        <>
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
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <button
              onClick={handleEmailAll}
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
              {emailSending
                ? 'Sending…'
                : recipients.length === 1
                  ? 'Email Now'
                  : `Email All ${recipients.length}`}
            </button>

            {recipientsWithPhone.length > 0 && (
              recipientsWithPhone.length === 1 ? (
                <button
                  onClick={() => handleWhatsApp(recipientsWithPhone[0])}
                  title={`Send WhatsApp to ${recipientsWithPhone[0].name}`}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    padding: '7px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600,
                    cursor: 'pointer', border: 'none', background: '#25D366', color: '#fff',
                  }}
                >
                  <MessageCircle size={13} /> WhatsApp
                </button>
              ) : (
                <span style={{ fontSize: 11, color: '#475569', alignSelf: 'center' }}>
                  <MessageCircle size={11} style={{ display: 'inline', verticalAlign: 'middle', color: '#25D366', marginRight: 3 }} />
                  WhatsApp — tap 💬 on each name above
                </span>
              )
            )}

            {recipientsWithPhone.length === 0 && recipients.length > 0 && (
              <span style={{ fontSize: 11, color: '#94a3b8', alignSelf: 'center' }}>
                No phones saved — add in Settings → Contacts
              </span>
            )}
          </div>
        </>
      )}

      {recipients.length === 0 && (
        <div style={{ fontSize: 12, color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 5, marginTop: 2 }}>
          <UserPlus size={12} /> Search above to add one or more recipients
        </div>
      )}
    </div>
  );
}
