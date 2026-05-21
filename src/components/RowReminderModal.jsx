/**
 * RowReminderModal — configure or stop a daily email reminder for one sheet row.
 * Opens from the 🔔 bell icon in the row number area of SpreadsheetGrid.
 *
 * Enhancements:
 *  - Shows existing row comments for context
 *  - Auto-detects "Assigned To" from header row
 *  - Org-search autocomplete to add extra recipients beyond sheet members
 *  - Time picker to choose when the daily email is delivered
 */
import { useState, useEffect, useRef } from 'react';
import { X, Bell, BellOff, Users, MessageSquare, Clock, UserPlus } from 'lucide-react';
import { createRowReminder, stopRowReminder } from '../utils/sheetReminders';
import { searchOrgPeopleDebounced } from '../utils/graphPeopleSearch';

const LETTERS = Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i));

export default function RowReminderModal({
  rowIndex,           // 0-based row index
  rowData,            // { 'A': displayVal, 'B': displayVal, ... } — current row snapshot
  cols,               // number of columns
  sheetId,            // personal sheet id
  sharedSheetId,      // shared sheet id (may be null)
  sheetTitle,
  memberEmails,       // string[] — all sheet member emails
  currentUser,
  existingReminder,   // reminder doc if already set (or null)
  onClose,
  showToast,
  rowCommentsData,    // [{text, authorEmail, authorName, ts}] — existing row comments
  headerData,         // { 'A': 'Account Name', 'B': 'Status', ... } — row-0 headers
}) {
  const rowNum = rowIndex + 1;

  // ── Auto-detect assignee column from headers ──────────────────────────────
  const assigneeColLetter = headerData
    ? (Object.entries(headerData).find(([, v]) => /assign/i.test(String(v)))?.[0] ?? null)
    : null;
  const detectedAssignee = assigneeColLetter ? (rowData[assigneeColLetter] || '') : '';

  // ── Core state ─────────────────────────────────────────────────────────────
  const [remarks,       setRemarks]       = useState(existingReminder?.remarks       || '');
  const [assigneeName,  setAssigneeName]  = useState(existingReminder?.assigneeName  || detectedAssignee);
  const [assigneeEmail, setAssigneeEmail] = useState(existingReminder?.assigneeEmail || '');
  const [notifyEmails,  setNotifyEmails]  = useState(() =>
    existingReminder?.notifyEmails ?? memberEmails ?? []
  );
  const [reminderTime,  setReminderTime]  = useState(existingReminder?.sendAtTime    || '09:00');
  const [busy,          setBusy]          = useState(false);

  // ── Add-user search state ──────────────────────────────────────────────────
  const [showAddUser,      setShowAddUser]      = useState(false);
  const [addUserQuery,     setAddUserQuery]     = useState('');
  const [addUserResults,   setAddUserResults]   = useState([]);
  const [addUserSearching, setAddUserSearching] = useState(false);
  const addUserInputRef = useRef(null);

  useEffect(() => {
    if (showAddUser) setTimeout(() => addUserInputRef.current?.focus(), 80);
  }, [showAddUser]);

  const handleAddUserSearch = async (q) => {
    setAddUserQuery(q);
    if (q.trim().length < 2) { setAddUserResults([]); return; }
    setAddUserSearching(true);
    const results = await searchOrgPeopleDebounced(q);
    setAddUserResults(results);
    setAddUserSearching(false);
  };

  const addEmailFromSearch = (email) => {
    if (email && !notifyEmails.includes(email)) {
      setNotifyEmails(prev => [...prev, email]);
    }
    setAddUserQuery('');
    setAddUserResults([]);
    setShowAddUser(false);
  };

  const removeNotifyEmail = (email) => {
    setNotifyEmails(prev => prev.filter(e => e !== email));
  };

  // ── Row summary (non-empty cells) ─────────────────────────────────────────
  const rowSummary = LETTERS.slice(0, cols).map(letter => {
    const val = rowData[letter];
    return { col: letter, val: val ?? '' };
  }).filter(x => String(x.val).trim());

  // ── Save / Stop ───────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (notifyEmails.length === 0) {
      showToast?.('Select at least one recipient.', 'warning');
      return;
    }
    setBusy(true);
    try {
      const sid = sharedSheetId || sheetId;
      await createRowReminder({
        sheetId:        sid,
        sharedSheetId:  sharedSheetId || null,
        sheetTitle,
        rowIndex,
        rowData:        Object.fromEntries(rowSummary.map(x => [x.col, x.val])),
        columnHeaders:  headerData || {},
        assigneeEmail,
        assigneeName,
        remarks,
        notifyEmails,
        sendAtTime:     reminderTime || null,
        createdBy:      currentUser.uid,
        createdByEmail: currentUser.email,
      });
      showToast?.(`Daily reminder set for Row ${rowNum}`, 'success');
      onClose();
    } catch {
      showToast?.('Failed to set reminder — please try again.', 'warning');
    }
    setBusy(false);
  };

  const handleStop = async () => {
    if (!existingReminder?.id) return;
    setBusy(true);
    try {
      await stopRowReminder(existingReminder.id);
      showToast?.(`Reminder for Row ${rowNum} stopped.`, 'info');
      onClose();
    } catch {
      showToast?.('Failed to stop reminder.', 'warning');
    }
    setBusy(false);
  };

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1200,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ background: '#fff', borderRadius: 16, width: '100%', maxWidth: 560,
        boxShadow: '0 24px 60px rgba(0,0,0,0.2)', display: 'flex', flexDirection: 'column',
        maxHeight: '90vh', overflow: 'hidden' }}>

        {/* ── Header ── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10,
          padding: '16px 20px', borderBottom: '1px solid var(--paper-line)' }}>
          <Bell size={17} style={{ color: '#f59e0b', flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--ink)' }}>
              {existingReminder ? 'Daily Reminder Active' : 'Set Daily Reminder'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--ink-lighter)', marginTop: 1 }}>
              Row {rowNum} · {sheetTitle}
            </div>
          </div>
          <button onClick={onClose} className="btn-icon"><X size={15} /></button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '18px 20px 20px' }}>

          {/* ── Row data preview ── */}
          {rowSummary.length > 0 && (
            <div style={{ background: '#f8fafc', borderRadius: 10, padding: '10px 14px',
              border: '1px solid var(--paper-line)', marginBottom: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-lighter)',
                textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 8 }}>
                Row Data Preview
              </div>
              {rowSummary.map(({ col, val }) => (
                <div key={col} style={{ display: 'flex', gap: 10, padding: '3px 0',
                  borderBottom: '1px solid #f1f5f9', fontSize: 13 }}>
                  <span style={{ fontWeight: 600, color: '#7c3aed', minWidth: 24 }}>
                    {headerData?.[col] || col}
                  </span>
                  <span style={{ color: 'var(--ink)', flex: 1, overflow: 'hidden',
                    textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{String(val)}</span>
                </div>
              ))}
            </div>
          )}

          {/* ── Existing row comments ── */}
          {rowCommentsData?.length > 0 && (
            <div style={{ background: '#f0f9ff', borderRadius: 10, padding: '10px 14px',
              border: '1px solid #bae6fd', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                <MessageSquare size={13} style={{ color: '#0891b2' }} />
                <span style={{ fontSize: 11, fontWeight: 700, color: '#0891b2',
                  textTransform: 'uppercase', letterSpacing: '.05em' }}>
                  Row Comments ({rowCommentsData.length})
                </span>
              </div>
              {rowCommentsData.map((cmt, i) => (
                <div key={i} style={{ padding: '6px 0',
                  borderBottom: i < rowCommentsData.length - 1 ? '1px solid #e0f2fe' : 'none' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                    <div style={{ width: 22, height: 22, borderRadius: '50%', background: '#e0f2fe',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontWeight: 700, fontSize: 11, color: '#0891b2', flexShrink: 0 }}>
                      {(cmt.authorName || cmt.authorEmail || '?')[0].toUpperCase()}
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink)' }}>
                      {cmt.authorName || cmt.authorEmail}
                    </span>
                    <span style={{ fontSize: 10, color: 'var(--ink-lighter)', marginLeft: 'auto' }}>
                      {cmt.ts ? new Date(cmt.ts).toLocaleDateString() : ''}
                    </span>
                  </div>
                  <p style={{ margin: '0 0 0 28px', fontSize: 12, color: 'var(--ink)',
                    lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{cmt.text}</p>
                </div>
              ))}
            </div>
          )}

          {/* ── Assignee ── */}
          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-light)',
              display: 'block', marginBottom: 4 }}>
              Assigned To (optional)
              {detectedAssignee && !existingReminder && (
                <span style={{ fontWeight: 400, color: '#7c3aed', marginLeft: 6, fontSize: 11 }}>
                  ✓ auto-detected
                </span>
              )}
            </label>
            <input
              className="input"
              value={assigneeName}
              onChange={e => setAssigneeName(e.target.value)}
              placeholder="e.g. Eashwar Ram"
              style={{ marginBottom: 0 }}
              disabled={!!existingReminder}
            />
          </div>

          {/* ── Remarks ── */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-light)',
              display: 'block', marginBottom: 4 }}>Remarks (optional)</label>
            <textarea
              className="input"
              value={remarks}
              onChange={e => setRemarks(e.target.value)}
              placeholder="Any context about this row for the email recipients…"
              rows={3}
              style={{ marginBottom: 0, resize: 'vertical', fontFamily: 'var(--font-body)', fontSize: 13 }}
              disabled={!!existingReminder}
            />
          </div>

          {/* ── Delivery time ── */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-light)',
              display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
              <Clock size={13} style={{ color: '#7c3aed' }} />
              Send reminder email at
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <input
                type="time"
                value={reminderTime}
                onChange={e => setReminderTime(e.target.value)}
                disabled={!!existingReminder}
                style={{ fontSize: 14, padding: '6px 10px', borderRadius: 8, border: '1px solid var(--paper-line)',
                  background: existingReminder ? '#f8fafc' : '#fff', color: 'var(--ink)',
                  fontFamily: 'var(--font-body)', cursor: existingReminder ? 'default' : 'pointer',
                  outline: 'none' }}
              />
              <span style={{ fontSize: 12, color: 'var(--ink-lighter)' }}>
                local time · email fires within 30 min of this time
              </span>
            </div>
          </div>

          {/* ── Notify list ── */}
          <div style={{ marginBottom: 4 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
              <Users size={13} style={{ color: '#0891b2' }} />
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-light)' }}>
                Email Daily To
              </span>
              {!existingReminder && (
                <button
                  onClick={() => setShowAddUser(v => !v)}
                  style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4,
                    fontSize: 11, fontWeight: 600, color: '#7c3aed', background: '#f5f3ff',
                    border: '1px solid #ddd6fe', borderRadius: 6, padding: '3px 8px', cursor: 'pointer' }}>
                  <UserPlus size={11} /> Add user
                </button>
              )}
            </div>

            {/* Org search box */}
            {showAddUser && !existingReminder && (
              <div style={{ position: 'relative', marginBottom: 10 }}>
                <input
                  ref={addUserInputRef}
                  value={addUserQuery}
                  onChange={e => handleAddUserSearch(e.target.value)}
                  placeholder="Search by name or email…"
                  style={{ width: '100%', boxSizing: 'border-box', fontSize: 13, padding: '7px 10px',
                    border: '1px solid #a78bfa', borderRadius: 8, outline: 'none',
                    fontFamily: 'var(--font-body)', background: '#faf5ff' }}
                />
                {addUserSearching && (
                  <div style={{ fontSize: 11, color: 'var(--ink-lighter)', padding: '4px 10px' }}>
                    Searching…
                  </div>
                )}
                {addUserResults.length > 0 && (
                  <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 100,
                    background: '#fff', border: '1px solid var(--paper-line)', borderRadius: 8,
                    boxShadow: '0 8px 24px rgba(0,0,0,0.12)', overflow: 'hidden', marginTop: 2 }}>
                    {addUserResults.map(person => (
                      <div key={person.id || person.email}
                        onClick={() => addEmailFromSearch(person.email)}
                        style={{ padding: '9px 14px', cursor: 'pointer', borderBottom: '1px solid #f1f5f9',
                          display: 'flex', alignItems: 'center', gap: 10 }}
                        onMouseEnter={e => e.currentTarget.style.background = '#f5f3ff'}
                        onMouseLeave={e => e.currentTarget.style.background = ''}
                      >
                        <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#ede9fe',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontWeight: 700, fontSize: 12, color: '#7c3aed', flexShrink: 0 }}>
                          {(person.displayName || person.email || '?')[0].toUpperCase()}
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>
                            {person.displayName}
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--ink-lighter)', overflow: 'hidden',
                            textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {person.email}
                            {person.jobTitle && ` · ${person.jobTitle}`}
                          </div>
                        </div>
                        {notifyEmails.includes(person.email) && (
                          <span style={{ marginLeft: 'auto', fontSize: 10, color: '#16a34a', fontWeight: 700 }}>✓ Added</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Recipient list */}
            {notifyEmails.length === 0 ? (
              <p style={{ fontSize: 12, color: 'var(--ink-lighter)', fontStyle: 'italic' }}>
                No recipients yet. Use the checkboxes below or "Add user" to add.
              </p>
            ) : notifyEmails.map(email => (
              <div key={email} style={{ display: 'flex', alignItems: 'center', gap: 10,
                padding: '6px 0', borderBottom: '1px solid var(--paper-line)', fontSize: 13 }}>
                <div style={{ width: 22, height: 22, borderRadius: '50%', background: '#f5f3ff',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontWeight: 700, fontSize: 11, color: '#7c3aed', flexShrink: 0 }}>
                  {email[0].toUpperCase()}
                </div>
                <span style={{ flex: 1, color: 'var(--ink)', overflow: 'hidden',
                  textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{email}</span>
                {!existingReminder && (
                  <button onClick={() => removeNotifyEmail(email)}
                    style={{ padding: 2, border: 'none', background: 'none', cursor: 'pointer',
                      color: '#94a3b8', display: 'flex', alignItems: 'center' }}>
                    <X size={12} />
                  </button>
                )}
              </div>
            ))}

            {/* Add sheet members that aren't in the list yet */}
            {!existingReminder && memberEmails.filter(e => !notifyEmails.includes(e)).length > 0 && (
              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 11, color: 'var(--ink-lighter)', marginBottom: 6, fontWeight: 600 }}>
                  Sheet members not yet added:
                </div>
                {memberEmails.filter(e => !notifyEmails.includes(e)).map(email => (
                  <label key={email} style={{ display: 'flex', alignItems: 'center', gap: 10,
                    padding: '6px 0', borderBottom: '1px solid var(--paper-line)',
                    cursor: 'pointer', fontSize: 13 }}>
                    <input
                      type="checkbox"
                      checked={false}
                      onChange={() => setNotifyEmails(prev => [...prev, email])}
                      style={{ width: 15, height: 15, accentColor: '#7c3aed' }}
                    />
                    <span style={{ flex: 1, color: 'var(--ink)' }}>{email}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          <p style={{ fontSize: 12, color: '#94a3b8', margin: '12px 0 16px', lineHeight: 1.5 }}>
            {existingReminder
              ? `Reminder emails are sent daily at ${existingReminder.sendAtTime || 'any time sheet is opened'}. Click Stop to cancel.`
              : `A reminder email with this row's data will be sent daily at ${reminderTime} to all recipients until stopped.`}
          </p>

          {/* ── Action buttons ── */}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button className="btn btn-ghost btn-sm" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            {existingReminder ? (
              <button
                className="btn btn-sm"
                style={{ background: '#dc2626', color: '#fff', border: 'none' }}
                onClick={handleStop}
                disabled={busy}
              >
                <BellOff size={13} style={{ marginRight: 4 }} />
                {busy ? 'Stopping…' : 'Stop Reminder'}
              </button>
            ) : (
              <button
                className="btn btn-gold btn-sm"
                onClick={handleSave}
                disabled={busy || notifyEmails.length === 0}
              >
                <Bell size={13} style={{ marginRight: 4 }} />
                {busy ? 'Setting…' : 'Set Daily Reminder'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
