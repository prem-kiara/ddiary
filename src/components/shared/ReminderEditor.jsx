import { useMemo } from 'react';
import { Bell, BellOff, Calendar, Clock, Globe, PauseCircle, PlayCircle } from 'lucide-react';
import {
  FREQUENCIES, DAY_LABELS,
  blankReminder, normalizeReminder,
  computeNextSendAt, describeSchedule, describeNextSend, validateReminder,
} from '../../utils/reminders';

/**
 * ReminderEditor — a reusable form for configuring per-task email reminders.
 *
 * Pure controlled component: the parent owns the reminder object and receives
 * updates via `onChange`. Renders a collapsible card so it plays nicely inside
 * the already-busy AddTaskModal / edit panel.
 *
 * Props
 *   value          : reminder object (normalized) — may be null/undefined → treated as disabled
 *   onChange(next) : called with the new reminder object (always normalized)
 *   timezone       : default IANA timezone to seed new reminders with (user's setting)
 *   creatorEmail   : snapshot used on enable — recipient list
 *   creatorName    : snapshot used on enable — recipient list
 *   compact        : optional (not used yet but reserved for tight spaces)
 */
export default function ReminderEditor({
  value,
  onChange,
  timezone = 'Asia/Kolkata',
  creatorEmail,
  creatorName,
}) {
  // Always work against a normalized object — even when `value` is null.
  const reminder = useMemo(
    () => value
      ? normalizeReminder(value, { timezone, creatorEmail, creatorName })
      : blankReminder({ timezone, creatorEmail, creatorName }),
    [value, timezone, creatorEmail, creatorName]
  );

  const emit = (patch) => {
    const next = normalizeReminder({ ...reminder, ...patch }, { timezone, creatorEmail, creatorName });
    // Recompute the next send time whenever schedule-relevant fields change.
    // Only compute when enabled+unpaused so nextSendAt reflects reality.
    next.nextSendAt = computeNextSendAt(next) || null;
    onChange(next);
  };

  const err = reminder.enabled ? validateReminder(reminder) : null;
  const nextLabel = reminder.enabled && !reminder.paused && reminder.nextSendAt
    ? describeNextSend(reminder.nextSendAt, reminder.timezone)
    : null;

  const toggleDay = (dow) => {
    const set = new Set(reminder.daysOfWeek || []);
    if (set.has(dow)) set.delete(dow); else set.add(dow);
    emit({ daysOfWeek: [...set].sort((a, b) => a - b) });
  };

  // Inline styles match the other modal sub-forms in AddTaskModal.
  const inputStyle = {
    width: '100%', padding: '10px 12px', border: '1px solid #cbd5e1', borderRadius: 8,
    fontSize: 14, fontFamily: 'var(--font-body)', background: '#ffffff', color: '#0f172a',
    boxSizing: 'border-box', outline: 'none', minHeight: 44,
  };
  const labelStyle = {
    fontSize: 12, fontWeight: 700, color: '#475569',
    textTransform: 'uppercase', letterSpacing: '0.05em',
    display: 'block', marginBottom: 6,
  };

  return (
    <div style={{ background: '#f5f3ff', border: '1px solid #c4b5fd55', borderRadius: 10, padding: '14px 16px' }}>
      {/* Header — enable toggle + status */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: reminder.enabled ? 12 : 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 180 }}>
          {reminder.enabled ? <Bell size={16} color="#7c3aed" /> : <BellOff size={16} color="#94a3b8" />}
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontWeight: 700, fontSize: 13, color: '#6d28d9' }}>
              Email Reminders
            </span>
            <span style={{ fontSize: 11, color: '#64748b' }}>
              {reminder.enabled ? describeSchedule(reminder) : 'Off'}
            </span>
          </div>
        </div>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600, color: '#0f172a' }}>
          <input
            type="checkbox"
            checked={reminder.enabled}
            onChange={e => emit({ enabled: e.target.checked, paused: false })}
            style={{ width: 18, height: 18, accentColor: '#7c3aed' }}
          />
          <span>{reminder.enabled ? 'Enabled' : 'Enable'}</span>
        </label>
      </div>

      {/* Body — shown only when enabled */}
      {reminder.enabled && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Frequency + interval (if applicable) */}
          <div>
            <label style={labelStyle}>Frequency</label>
            <select
              value={reminder.frequency}
              onChange={e => emit({ frequency: e.target.value })}
              style={inputStyle}
            >
              {FREQUENCIES.map(f => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </select>
          </div>

          {/* "Every N days" input */}
          {reminder.frequency === 'every_n_days' && (
            <div>
              <label style={labelStyle}>Interval (days)</label>
              <input
                type="number" min={1} max={90}
                value={reminder.intervalDays}
                onChange={e => emit({ intervalDays: Math.max(1, Math.min(90, Number(e.target.value) || 1)) })}
                style={{ ...inputStyle, maxWidth: 160 }}
              />
            </div>
          )}

          {/* Day-of-week chips for 'custom' and 'weekly' */}
          {(reminder.frequency === 'custom' || reminder.frequency === 'weekly') && (
            <div>
              <label style={labelStyle}>
                {reminder.frequency === 'weekly' ? 'Day of the week' : 'Days of the week'}
              </label>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {DAY_LABELS.map((lbl, i) => {
                  const active = (reminder.daysOfWeek || []).includes(i);
                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={() => {
                        if (reminder.frequency === 'weekly') {
                          // exactly one day allowed
                          emit({ daysOfWeek: active ? [] : [i] });
                        } else {
                          toggleDay(i);
                        }
                      }}
                      style={{
                        padding: '8px 12px',
                        minWidth: 44, minHeight: 40,
                        borderRadius: 20,
                        border: active ? '2px solid #7c3aed' : '1px solid #cbd5e1',
                        background: active ? '#ede9fe' : '#ffffff',
                        color: active ? '#6d28d9' : '#475569',
                        fontWeight: active ? 700 : 500, fontSize: 12,
                        cursor: 'pointer',
                        transition: 'all 0.15s',
                      }}
                    >
                      {lbl}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Time of day */}
          <div>
            <label style={labelStyle}><Clock size={11} style={{ verticalAlign: 'middle', marginRight: 4 }} />Time of day</label>
            <input
              type="time"
              value={reminder.time}
              onChange={e => emit({ time: e.target.value })}
              style={{ ...inputStyle, maxWidth: 220 }}
            />
            <p style={{ fontSize: 11, color: '#64748b', marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
              <Globe size={10} /> {reminder.timezone}
            </p>
          </div>

          {/* Start + End dates */}
          <div className="form-grid-2">
            <div>
              <label style={labelStyle}>
                <Calendar size={11} style={{ verticalAlign: 'middle', marginRight: 4 }} />Start date
              </label>
              <input
                type="date"
                value={reminder.startDate}
                onChange={e => emit({ startDate: e.target.value })}
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>
                End date <span style={{ fontWeight: 400, color: '#94a3b8' }}>(optional)</span>
              </label>
              <input
                type="date"
                value={reminder.endDate || ''}
                min={reminder.startDate || undefined}
                onChange={e => emit({ endDate: e.target.value || null })}
                style={inputStyle}
              />
            </div>
          </div>

          {/* Pause + Recipients summary */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => emit({ paused: !reminder.paused })}
              className="btn btn-sm btn-outline"
              style={{ color: reminder.paused ? '#15803d' : '#d97706', borderColor: reminder.paused ? '#15803d55' : '#d9770655' }}
            >
              {reminder.paused
                ? <><PlayCircle size={13} /> Resume</>
                : <><PauseCircle size={13} /> Pause</>
              }
            </button>
            <span style={{ fontSize: 11, color: '#64748b', flex: 1, minWidth: 120 }}>
              Sends to <strong style={{ color: '#0f172a' }}>creator + assignee</strong>.
              Auto-stops when the task is done, archived, or deleted.
            </span>
          </div>

          {/* Validation error */}
          {err && (
            <div style={{ fontSize: 12, color: '#dc2626', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '8px 12px' }}>
              {err}
            </div>
          )}

          {/* Preview of next send */}
          {!err && (
            <div style={{ fontSize: 12, color: reminder.paused ? '#d97706' : '#15803d', background: reminder.paused ? '#fffbeb' : '#f0fdf4', border: `1px solid ${reminder.paused ? '#fde68a' : '#bbf7d0'}`, borderRadius: 8, padding: '8px 12px' }}>
              {reminder.paused
                ? '⏸ Paused — no emails will be sent.'
                : nextLabel
                  ? <>✓ Next reminder {nextLabel} · {describeSchedule(reminder)}</>
                  : '✓ Reminder configured. No upcoming sends (end date passed, or schedule empty).'
              }
            </div>
          )}
        </div>
      )}
    </div>
  );
}
