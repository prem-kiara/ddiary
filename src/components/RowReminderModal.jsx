/**
 * RowReminderModal — configure or stop a daily email reminder for one sheet row.
 * Opens from the 🔔 bell icon in the row number area of SpreadsheetGrid.
 */
import { useState } from 'react';
import { X, Bell, BellOff, Users } from 'lucide-react';
import { createRowReminder, stopRowReminder } from '../utils/sheetReminders';

const LETTERS = Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i));

export default function RowReminderModal({
  rowIndex,           // 0-based row index
  rowData,            // { 'A1': {v,b,i}, ... } — current row snapshot
  cols,               // number of columns
  sheetId,            // personal sheet id
  sharedSheetId,      // shared sheet id (may be null)
  sheetTitle,
  memberEmails,       // string[] — all sheet member emails
  currentUser,
  existingReminder,   // reminder doc if already set (or null)
  onClose,
  showToast,
}) {
  const rowNum = rowIndex + 1;

  // Derive column headers from row 0 (caller passes rowData of the actual row;
  // headers are in the same grid data under row 0)
  const [remarks,      setRemarks]      = useState(existingReminder?.remarks      || '');
  const [assigneeName, setAssigneeName] = useState(existingReminder?.assigneeName || '');
  const [assigneeEmail,setAssigneeEmail]= useState(existingReminder?.assigneeEmail|| '');
  const [notifyEmails, setNotifyEmails] = useState(() =>
    existingReminder?.notifyEmails ?? memberEmails ?? []
  );
  const [busy, setBusy] = useState(false);

  // Build a readable summary of the row data
  const rowSummary = LETTERS.slice(0, cols).map(letter => {
    const cell = rowData[letter]; // rowData is { A: 'value', B: 'value', ... }
    return { col: letter, val: cell ?? '' };
  }).filter(x => String(x.val).trim());

  const toggleEmail = (email) => {
    setNotifyEmails(prev =>
      prev.includes(email) ? prev.filter(e => e !== email) : [...prev, email]
    );
  };

  const handleSave = async () => {
    if (notifyEmails.length === 0) { showToast?.('Select at least one recipient.', 'warning'); return; }
    setBusy(true);
    try {
      const sid = sharedSheetId || sheetId;
      await createRowReminder({
        sheetId:       sid,
        sharedSheetId: sharedSheetId || null,
        sheetTitle,
        rowIndex,
        rowData:        Object.fromEntries(rowSummary.map(x => [x.col, x.val])),
        columnHeaders:  {},   // grid passes column header row separately; we store col letters
        assigneeEmail,
        assigneeName,
        remarks,
        notifyEmails,
        createdBy:      currentUser.uid,
        createdByEmail: currentUser.email,
      });
      showToast?.(`Daily reminder set for Row ${rowNum}`, 'success');
      onClose();
    } catch (err) {
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
      <div style={{ background: '#fff', borderRadius: 16, width: '100%', maxWidth: 520,
        boxShadow: '0 24px 60px rgba(0,0,0,0.2)', display: 'flex', flexDirection: 'column',
        maxHeight: '90vh', overflow: 'hidden' }}>

        {/* Header */}
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

          {/* Row data preview */}
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
                  <span style={{ fontWeight: 600, color: '#7c3aed', minWidth: 20 }}>{col}</span>
                  <span style={{ color: 'var(--ink)', flex: 1, overflow: 'hidden',
                    textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{String(val)}</span>
                </div>
              ))}
            </div>
          )}

          {/* Assignee */}
          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-light)',
              display: 'block', marginBottom: 4 }}>Assigned To (optional)</label>
            <input
              className="input"
              value={assigneeName}
              onChange={e => setAssigneeName(e.target.value)}
              placeholder="e.g. Eashwar Ram"
              style={{ marginBottom: 0 }}
              disabled={!!existingReminder}
            />
          </div>

          {/* Remarks */}
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

          {/* Notify list */}
          <div style={{ marginBottom: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
              <Users size={13} style={{ color: '#0891b2' }} />
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-light)' }}>
                Email Daily To
              </span>
            </div>
            {memberEmails.length === 0 ? (
              <p style={{ fontSize: 12, color: 'var(--ink-lighter)', fontStyle: 'italic' }}>
                No sheet members found. Share the sheet first to add recipients.
              </p>
            ) : memberEmails.map(email => (
              <label key={email} style={{ display: 'flex', alignItems: 'center', gap: 10,
                padding: '8px 0', borderBottom: '1px solid var(--paper-line)',
                cursor: existingReminder ? 'default' : 'pointer', fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={notifyEmails.includes(email)}
                  onChange={() => !existingReminder && toggleEmail(email)}
                  style={{ width: 15, height: 15, accentColor: '#7c3aed' }}
                  disabled={!!existingReminder}
                />
                <span style={{ flex: 1, color: 'var(--ink)' }}>{email}</span>
              </label>
            ))}
          </div>

          <p style={{ fontSize: 12, color: '#94a3b8', margin: '0 0 16px', lineHeight: 1.5 }}>
            {existingReminder
              ? 'Reminder emails are sent once per day when any team member opens this sheet. Click Stop to cancel.'
              : 'A reminder email with this row\'s data will be sent once per day to all checked recipients until stopped.'}
          </p>

          {/* Buttons */}
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
