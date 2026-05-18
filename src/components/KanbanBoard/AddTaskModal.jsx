import { useState, useEffect, useMemo } from 'react';
import { Plus, X, ChevronDown, Folder, Briefcase } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { createWorkspace } from '../../hooks/useWorkspace';
import { logError } from '../../utils/errorLogger';
import ReminderEditor from '../shared/ReminderEditor';
import { fetchAllOrgUsers } from '../../utils/graphPeopleSearch';
import { normalizeReminder, computeNextSendAt } from '../../utils/reminders';
import { STATUSES } from './constants';

export function AddTaskModal({
  onClose, onAdd, members, workspaces, currentWorkspaceId, showToast,
  categories = [],  // categories of the CURRENT workspace, for the picker
  initialCategoryId = null, initialSubcategoryId = null, categoryContextLabel = null,
  hideWorkspacePicker = false, // true when opened from inside a workspace
}) {
  const [text,          setText]          = useState('');
  const [notes,         setNotes]         = useState('');
  const [status,        setStatus]        = useState('open');
  const [priority,      setPriority]      = useState('high');
  const [dueDate,         setDueDate]         = useState('');
  const [assigneeEmails,  setAssigneeEmails]  = useState([]);   // multi-assignee
  const [assigneePicker,  setAssigneePicker]  = useState(false);
  const [assigneeSearch,  setAssigneeSearch]  = useState('');
  const [saving,          setSaving]          = useState(false);
  const [categoryId,    setCategoryId]    = useState(initialCategoryId || '');
  const [subcategoryId, setSubcategoryId] = useState(initialSubcategoryId || '');
  const [reminder,      setReminder]      = useState(null);   // null = off
  const { user: currentUser } = useAuth();
  const userTz = currentUser?.settings?.timezone
    || (typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'Asia/Kolkata')
    || 'Asia/Kolkata';
  const userReminderTime = currentUser?.settings?.reminderTime || '09:00';

  const [wsMode,        setWsMode]        = useState(workspaces.length ? 'existing' : 'new');
  const [selectedWsId,  setSelectedWsId]  = useState(currentWorkspaceId || workspaces[0]?.id || '');
  const [newWsName,     setNewWsName]     = useState('');
  // Optional seed category/sub-category for a brand-new workspace (wsMode==='new')
  const [newWsCatName,  setNewWsCatName]  = useState('');
  const [newWsSubName,  setNewWsSubName]  = useState('');

  // Close assignee picker on outside click
  useEffect(() => {
    if (!assigneePicker) return;
    const close = () => { setAssigneePicker(false); setAssigneeSearch(''); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [assigneePicker]);

  // ── Fetch M365 org users ────────────────────────────────────────────────
  const [orgUsers, setOrgUsers] = useState([]);
  useEffect(() => {
    fetchAllOrgUsers().then(u => setOrgUsers(u || [])).catch(() => {});
  }, []);

  // Merged assignee list: workspace members (have UIDs) first, then org users, deduped by email.
  // Phone overrides from the personal Contacts book are layered on top — see
  // Settings → Contacts & WhatsApp Numbers. Keys are lowercased emails.
  const assigneeOptions = useMemo(() => {
    const seen = new Set();
    const list = [];
    for (const m of members) {
      const key = m.email?.toLowerCase();
      if (key && !seen.has(key)) {
        seen.add(key);
        list.push({ email: m.email, name: m.displayName || m.email, uid: m.uid || null, phone: m.phone || null });
      }
    }
    for (const u of orgUsers) {
      const key = u.email?.toLowerCase();
      if (key && !seen.has(key)) {
        seen.add(key);
        list.push({ email: u.email, name: u.displayName || u.email, uid: null, phone: u.phone || null });
      }
    }
    return list;
  }, [members, orgUsers]);

  const switchToNewWsMode = () => {
    setWsMode('new');
    setNewWsName(prev => prev.trim() ? prev : text.trim().slice(0, 60));
  };

  const handleAdd = async () => {
    if (!text.trim()) return;
    if (wsMode === 'new' && !newWsName.trim()) return;
    setSaving(true);
    try {
      const allPersons = assigneeEmails.map(e => assigneeOptions.find(p => p.email?.toLowerCase() === e.toLowerCase())).filter(Boolean);
      const person = allPersons[0] || null;
      const coAssignees = allPersons.slice(1).map(p => ({ uid: p.uid || null, email: p.email?.toLowerCase() || null, name: p.name || null }));
      // Hard timeout so the button can never freeze forever. If Firestore is
      // slow or the write is stuck behind an offline queue, we surface it.
      const ADD_TIMEOUT_MS = 25000;
      const timeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Timed out after 25s. Check your connection or Firestore rules and try again.')), ADD_TIMEOUT_MS)
      );
      // If a reminder was configured, stamp it with the creator's snapshot so
      // the Cloud Function can email them without re-reading the user doc.
      const reminderPayload = reminder && reminder.enabled
        ? (() => {
            const stamped = normalizeReminder(
              { ...reminder, creatorEmail: currentUser?.email?.toLowerCase() || null,
                creatorName: currentUser?.displayName || currentUser?.email || null },
              { timezone: userTz, creatorEmail: currentUser?.email, creatorName: currentUser?.displayName }
            );
            stamped.nextSendAt = computeNextSendAt(stamped);
            return stamped;
          })()
        : null;

      await Promise.race([
        onAdd(
          {
            text: text.trim(),
            notes: notes.trim() || null,
            status,
            priority,
            dueDate:       dueDate ? new Date(dueDate).toISOString() : null,
            assigneeUid:   person?.uid   || null,
            assigneeEmail: person?.email?.toLowerCase() || null,
            assigneeName:  person?.name  || null,
            coAssignees:   coAssignees.length ? coAssignees : null,
            categoryId:    categoryId    || null,
            subcategoryId: subcategoryId || null,
            reminder:      reminderPayload,
          },
          {
            targetWorkspaceId: wsMode === 'existing' ? selectedWsId : null,
            newWorkspaceName:  wsMode === 'new'      ? newWsName.trim() : null,
            // Optional seed category/sub-category when creating a brand-new workspace.
            // Ignored by the caller when targeting an existing workspace.
            newWorkspaceCategory: wsMode === 'new' && newWsCatName.trim()
              ? { name: newWsCatName.trim(), subcategoryName: newWsSubName.trim() || null }
              : null,
          }
        ),
        timeout,
      ]);
      onClose();
    } catch (e) {
      logError(e, { location: 'KanbanBoard:AddTaskModal', action: 'addTask' });
      const detail = e?.code === 'permission-denied'
        ? 'Permission denied — Firestore rules may be out of date. Redeploy with `firebase deploy --only firestore:rules`.'
        : (e?.message || 'Unknown error');
      if (showToast) showToast(`Failed to add task. ${detail}`, 'warning');
    } finally {
      setSaving(false);
    }
  };

  const inputStyle = {
    width: '100%', padding: '10px 12px', border: '1px solid #cbd5e1', borderRadius: 8,
    fontSize: 14, fontFamily: 'var(--font-body)', background: '#ffffff', color: '#0f172a',
    boxSizing: 'border-box', outline: 'none',
  };
  const labelStyle = { fontSize: 12, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 };

  return (
    <div className="sheet-modal-overlay" onClick={onClose}>
      <div className="sheet-modal" onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <h3 style={{ margin: 0, color: '#0f172a', fontSize: 17, fontWeight: 700 }}>New Task</h3>
            {categoryContextLabel && (
              <span style={{ fontSize: 12, color: '#7c3aed', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <Folder size={11} /> Adding to <strong style={{ marginLeft: 2 }}>{categoryContextLabel}</strong>
              </span>
            )}
          </div>
          <button className="btn-icon" onClick={onClose}><X size={20} /></button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Task description */}
          <div>
            <label style={labelStyle}>Task *</label>
            <textarea value={text} onChange={e => setText(e.target.value)} placeholder="Describe the task…" rows={3} autoFocus style={{ ...inputStyle, resize: 'vertical' }} />
          </div>

          {/* Workspace picker — hidden when opened from inside a workspace */}
          {!hideWorkspacePicker && (
          <div style={{ background: '#f1f5f9', borderRadius: 10, padding: '12px 14px' }}>
            <label style={{ ...labelStyle, marginBottom: 8 }}>
              <Briefcase size={11} style={{ marginRight: 4, verticalAlign: 'middle' }} />Workspace
            </label>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: wsMode === 'new' ? 10 : 0 }}>
              {workspaces.map(ws => (
                <button key={ws.id} type="button"
                  onClick={() => { setWsMode('existing'); setSelectedWsId(ws.id); }}
                  style={{
                    padding: '5px 14px', borderRadius: 20, fontSize: 12, fontWeight: 700, cursor: 'pointer', border: 'none',
                    background: wsMode === 'existing' && selectedWsId === ws.id ? '#7c3aed' : '#e2e8f0',
                    color:      wsMode === 'existing' && selectedWsId === ws.id ? '#fff'     : '#0f172a',
                    transition: 'all 0.15s',
                  }}
                >{ws.name}</button>
              ))}
              <button type="button" onClick={switchToNewWsMode}
                style={{
                  padding: '5px 14px', borderRadius: 20, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                  border: `1px dashed ${wsMode === 'new' ? '#7c3aed' : '#7c3aed'}`,
                  background: wsMode === 'new' ? '#7c3aed' : 'transparent',
                  color:      wsMode === 'new' ? '#fff'     : '#7c3aed',
                  transition: 'all 0.15s',
                }}
              >+ New workspace</button>
            </div>
            {wsMode === 'new' && (
              <>
                <input value={newWsName} onChange={e => setNewWsName(e.target.value)}
                  placeholder="Workspace name…" style={{ ...inputStyle, fontSize: 13, marginTop: 2 }} autoFocus={workspaces.length === 0} />
                {/* Optional seed category + sub-category for the new workspace */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 8 }}>
                  <input value={newWsCatName} onChange={e => setNewWsCatName(e.target.value)}
                    placeholder="Category (optional)"
                    style={{ ...inputStyle, fontSize: 13 }} />
                  <input value={newWsSubName} onChange={e => setNewWsSubName(e.target.value)}
                    placeholder="Sub-category (optional)"
                    disabled={!newWsCatName.trim()}
                    style={{ ...inputStyle, fontSize: 13 }} />
                </div>
                <p style={{ fontSize: 11, color: '#94a3b8', marginTop: 6, marginBottom: 0 }}>
                  You can add more categories later from the board.
                </p>
              </>
            )}
          </div>
          )}

          {/* Category + Sub-category — always shown for existing workspaces */}
          {(() => {
            const activeCats = wsMode === 'existing'
              ? (workspaces.find(w => w.id === selectedWsId)?.categories || categories || [])
              : [];
            if (wsMode !== 'existing') return null;
            const activeSubs = activeCats.find(c => c.id === categoryId)?.subcategories || [];
            return (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <label style={labelStyle}>Category</label>
                <select
                  value={categoryId}
                  onChange={e => { setCategoryId(e.target.value); setSubcategoryId(''); }}
                  style={inputStyle}
                >
                  <option value="">Uncategorized</option>
                  {activeCats.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Sub-category</label>
                <select
                  value={subcategoryId}
                  onChange={e => setSubcategoryId(e.target.value)}
                  style={inputStyle}
                  disabled={!categoryId || activeSubs.length === 0}
                >
                  <option value="">—</option>
                  {activeSubs.map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
            </div>
            );
          })()}

          {/* Status + Priority */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={labelStyle}>Status</label>
              <select value={status} onChange={e => setStatus(e.target.value)} style={inputStyle}>
                {STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Priority</label>
              <select value={priority} onChange={e => setPriority(e.target.value)} style={inputStyle}>
                <option value="high">🔴 High</option>
                <option value="medium">🟡 Medium</option>
                <option value="low">🟢 Low</option>
              </select>
            </div>
          </div>

          {/* Assign to + Due Date */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div style={{ position: 'relative' }}>
              <label style={labelStyle}>Assign to</label>
              {/* Pill display / trigger */}
              <div
                onClick={() => setAssigneePicker(o => !o)}
                style={{
                  ...inputStyle, cursor: 'pointer', display: 'flex', flexWrap: 'wrap',
                  gap: 4, alignItems: 'center', minHeight: 44, padding: '6px 10px',
                }}
              >
                {assigneeEmails.length === 0
                  ? <span style={{ color: '#94a3b8', fontSize: 13, flex: 1 }}>Unassigned</span>
                  : assigneeEmails.map(email => {
                      const p = assigneeOptions.find(x => x.email?.toLowerCase() === email.toLowerCase());
                      return (
                        <span key={email} style={{
                          background: '#ede9fe', color: '#6d28d9', borderRadius: 12,
                          padding: '2px 8px 2px 10px', fontSize: 12, fontWeight: 600,
                          display: 'inline-flex', alignItems: 'center', gap: 4,
                        }}>
                          {p?.name || email}
                          <button
                            type="button"
                            onMouseDown={e => { e.stopPropagation(); setAssigneeEmails(prev => prev.filter(x => x !== email)); }}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#7c3aed', padding: 0, fontSize: 14, lineHeight: 1 }}
                          >×</button>
                        </span>
                      );
                    })
                }
                <ChevronDown size={12} style={{ marginLeft: 'auto', color: '#94a3b8', flexShrink: 0 }} />
              </div>
              {/* Dropdown checklist */}
              {assigneePicker && (
                <div
                  onMouseDown={e => e.stopPropagation()}
                  style={{
                    position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0,
                    zIndex: 200, background: '#fff', border: '1px solid #cbd5e1',
                    borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
                  }}
                >
                  <div style={{ padding: '8px 10px', borderBottom: '1px solid #f1f5f9' }}>
                    <input
                      autoFocus
                      type="text"
                      value={assigneeSearch}
                      onChange={e => setAssigneeSearch(e.target.value)}
                      placeholder="Search people…"
                      style={{
                        width: '100%', padding: '6px 10px', fontSize: 13,
                        border: '1px solid #e2e8f0', borderRadius: 6, outline: 'none',
                        fontFamily: 'var(--font-body)', boxSizing: 'border-box',
                      }}
                    />
                  </div>
                  <div style={{ maxHeight: 180, overflowY: 'auto' }}>
                    {assigneeOptions.length === 0 && (
                      <div style={{ padding: '10px 14px', fontSize: 13, color: '#94a3b8' }}>No members yet</div>
                    )}
                    {assigneeOptions
                      .filter(p => !assigneeSearch || p.name?.toLowerCase().includes(assigneeSearch.toLowerCase()) || p.email?.toLowerCase().includes(assigneeSearch.toLowerCase()))
                      .map(p => {
                        const selected = assigneeEmails.includes(p.email?.toLowerCase());
                        return (
                          <label key={p.email} style={{
                            display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px',
                            cursor: 'pointer', background: selected ? '#f5f3ff' : 'transparent',
                            transition: 'background 0.1s',
                          }}
                            onMouseEnter={e => e.currentTarget.style.background = selected ? '#ede9fe' : '#f8fafc'}
                            onMouseLeave={e => e.currentTarget.style.background = selected ? '#f5f3ff' : 'transparent'}
                          >
                            <input
                              type="checkbox"
                              checked={selected}
                              onChange={ev => setAssigneeEmails(prev =>
                                ev.target.checked
                                  ? [...prev, p.email?.toLowerCase()]
                                  : prev.filter(x => x !== p.email?.toLowerCase())
                              )}
                              style={{ accentColor: '#7c3aed', width: 15, height: 15 }}
                            />
                            <span style={{ fontSize: 13, color: '#0f172a', fontWeight: selected ? 600 : 400 }}>
                              {p.name}
                            </span>
                            {selected && <span style={{ marginLeft: 'auto', color: '#7c3aed', fontSize: 12 }}>✓</span>}
                          </label>
                        );
                      })}
                  </div>
                </div>
              )}
            </div>
            <div>
              <label style={labelStyle}>Due Date</label>
              <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} style={inputStyle} />
            </div>
          </div>

          {/* Notes */}
          <div>
            <label style={labelStyle}>Notes</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Additional context, links, or details…"
              rows={3}
              style={{ ...inputStyle, resize: 'vertical' }}
            />
          </div>

          {/* Per-task email reminder scheduler */}
          <ReminderEditor
            value={reminder}
            onChange={setReminder}
            timezone={userTz}
            creatorEmail={currentUser?.email}
            creatorName={currentUser?.displayName || currentUser?.email}
          />
        </div>

        {/* Buttons */}
        <div style={{ display: 'flex', gap: 10, marginTop: 20, flexWrap: 'wrap' }}>
          <button className="btn btn-outline btn-sm" onClick={onClose} style={{ flex: 1, justifyContent: 'center', minWidth: 100 }}>Cancel</button>
          <button className="btn btn-teal" onClick={handleAdd}
            disabled={saving || !text.trim() || (wsMode === 'new' && !newWsName.trim())}
            style={{ flex: 2, justifyContent: 'center', minWidth: 160 }}
          >
            {saving
              ? (wsMode === 'new' ? 'Creating workspace…' : 'Adding…')
              : <><Plus size={15} /> {wsMode === 'new' ? 'Create Workspace & Add Task' : 'Add Task'}</>
            }
          </button>
        </div>
      </div>
    </div>
  );
}

export default AddTaskModal;
