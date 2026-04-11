import { useState, useRef, useEffect } from 'react';
import { Bell, Mail, Calendar, CheckCircle, Clock, UserPlus, Send, X, Edit2, MessageCircle, ChevronDown, ChevronRight, Link } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useUserDirectory } from '../hooks/useFirestore';
import { StatusBadge } from './TaskCollabPanel';

const formatDate = (d) => {
  if (!d) return '';
  const date = typeof d === 'string' ? new Date(d) : d.toDate ? d.toDate() : new Date(d);
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
};

const isOverdue = (dueDate) => {
  if (!dueDate) return false;
  const date = typeof dueDate === 'string' ? new Date(dueDate) : dueDate.toDate ? dueDate.toDate() : new Date(dueDate);
  return date < new Date() && date.toDateString() !== new Date().toDateString();
};

function formatWhatsAppPhone(phone) {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10 && /^[6-9]/.test(digits)) return '91' + digits;
  return digits;
}

function MemberAutocomplete({ value, onChange, onSelect, members, placeholder }) {
  const [open, setOpen] = useState(false);
  const [orgResults, setOrgResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const ref = useRef();
  const searchTimer = useRef();

  // Local team members filter
  const localFiltered = value.trim().length > 0
    ? members.filter(m => m.name.toLowerCase().includes(value.toLowerCase()))
    : [];

  // Search M365 org directory (debounced)
  const searchOrg = (query) => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (!query || query.trim().length < 2) { setOrgResults([]); return; }
    setSearching(true);
    searchTimer.current = setTimeout(async () => {
      try {
        const { searchOrgPeople } = await import('../utils/graphPeopleSearch');
        const results = await searchOrgPeople(query);
        // Filter out people already in local team members to avoid duplicates
        const localEmails = new Set(members.map(m => m.email?.toLowerCase()));
        setOrgResults(results.filter(r => !localEmails.has(r.email?.toLowerCase())));
      } catch { setOrgResults([]); }
      setSearching(false);
    }, 300);
  };

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleChange = (val) => {
    onChange(val);
    setOpen(true);
    searchOrg(val);
  };

  const hasResults = localFiltered.length > 0 || orgResults.length > 0 || searching;

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <input
        className="input"
        style={{ padding: '10px 12px', fontSize: 14 }}
        placeholder={placeholder}
        value={value}
        onChange={e => handleChange(e.target.value)}
        onFocus={() => setOpen(true)}
        autoComplete="off"
      />
      {open && hasResults && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50,
          background: '#fffdf5', border: '1px solid #d4c5a9', borderRadius: 8,
          boxShadow: '0 4px 16px rgba(0,0,0,0.12)', maxHeight: 260, overflowY: 'auto', marginTop: 2,
        }}>
          {/* Local team members first */}
          {localFiltered.length > 0 && (
            <>
              <div style={{ padding: '6px 14px', fontSize: 11, fontWeight: 700, color: '#8a7a6a', background: '#f5f0e5', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Team Members
              </div>
              {localFiltered.map(m => (
                <div
                  key={m.id}
                  onClick={() => { onSelect(m); setOpen(false); setOrgResults([]); }}
                  style={{ padding: '10px 14px', cursor: 'pointer', borderBottom: '1px solid #f0e6d2' }}
                  onMouseEnter={e => e.currentTarget.style.background = '#f5f0e5'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{m.name}{m.uid ? ' ✓' : ''}</div>
                  {m.email && <div style={{ fontSize: 12, color: '#8a7a6a' }}>{m.email}</div>}
                  {m.phone && <div style={{ fontSize: 12, color: '#8a7a6a' }}>{m.phone}</div>}
                </div>
              ))}
            </>
          )}

          {/* M365 org directory results */}
          {orgResults.length > 0 && (
            <>
              <div style={{ padding: '6px 14px', fontSize: 11, fontWeight: 700, color: '#2a6cb8', background: '#e8f0fe', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Organization Directory
              </div>
              {orgResults.map(p => (
                <div
                  key={p.id}
                  onClick={() => {
                    onSelect({ name: p.displayName, email: p.email, phone: p.phone, id: p.id });
                    setOpen(false);
                    setOrgResults([]);
                  }}
                  style={{ padding: '10px 14px', cursor: 'pointer', borderBottom: '1px solid #f0e6d2' }}
                  onMouseEnter={e => e.currentTarget.style.background = '#e8f0fe'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{p.displayName}</div>
                  {p.email && <div style={{ fontSize: 12, color: '#2a6cb8' }}>{p.email}</div>}
                  {p.jobTitle && <div style={{ fontSize: 11, color: '#8a7a6a', fontStyle: 'italic' }}>{p.jobTitle}</div>}
                </div>
              ))}
            </>
          )}

          {/* Loading indicator */}
          {searching && orgResults.length === 0 && localFiltered.length === 0 && (
            <div style={{ padding: '12px 14px', fontSize: 13, color: '#8a7a6a', textAlign: 'center' }}>
              Searching organization...
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Collapse-section header — matches the DiaryList archived/deleted toggle style
function SectionHeader({ open, onToggle, icon, label, count, color }) {
  return (
    <button
      onClick={onToggle}
      style={{
        background: 'none', border: 'none', cursor: 'pointer',
        display: 'flex', alignItems: 'center', gap: 8, width: '100%',
        padding: '10px 16px', borderRadius: 0,
      }}
    >
      <span style={{ color: color || '#c9a96e', display: 'flex', alignItems: 'center' }}>{icon}</span>
      <span style={{ fontWeight: 600, fontSize: 15, color: color || '#4a3728', flex: 1, textAlign: 'left' }}>
        {label}
        {count !== undefined && (
          <span style={{ fontWeight: 400, fontSize: 13, color: '#8a7a6a', marginLeft: 6 }}>
            ({count})
          </span>
        )}
      </span>
      <span style={{ color: '#8a7a6a' }}>
        {open ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
      </span>
    </button>
  );
}

export default function Reminders({ tasks, teamMembers = [], onToggle, onUpdate, showToast }) {
  const { user } = useAuth();
  // userDirectory gives us the real Firebase UIDs for anyone who has signed up,
  // even if the auto-link in TeamMembers hasn't run yet.
  const { directory } = useUserDirectory(user?.uid);
  const [assigningTaskId, setAssigningTaskId] = useState(null);
  const [assigneeName, setAssigneeName] = useState('');
  const [assigneeEmail, setAssigneeEmail] = useState('');
  const [assigneePhone, setAssigneePhone] = useState('');
  const [scheduleTime, setScheduleTime] = useState('');

  // Collapsible section state — overdue starts open (urgent), others also open by default
  const [overdueOpen, setOverdueOpen] = useState(true);
  const [pendingOpen, setPendingOpen] = useState(true);
  const [helpOpen, setHelpOpen] = useState(false);

  // Per-task expand/collapse — stores a Set of expanded task IDs
  const [expandedTaskIds, setExpandedTaskIds] = useState(new Set());
  const toggleTask = (id) => setExpandedTaskIds(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const pendingTasks = tasks.filter(t => !t.completed);
  const overdueTasks = pendingTasks.filter(t => isOverdue(t.dueDate));
  const upcomingTasks = pendingTasks.filter(t => !isOverdue(t.dueDate));

  const openAssignForm = (task) => {
    setAssigningTaskId(task.id);
    setAssigneeName(task.assigneeName || '');
    setAssigneeEmail(task.assigneeEmail || '');
    setAssigneePhone(task.assigneePhone || '');
    setScheduleTime(task.scheduledEmailTime || '');
  };

  const closeAssignForm = () => {
    setAssigningTaskId(null);
    setAssigneeName(''); setAssigneeEmail(''); setAssigneePhone(''); setScheduleTime('');
    setSelectedMember(null);
  };

  // Track which team member object was selected (to get their uid if linked)
  const [selectedMember, setSelectedMember] = useState(null);

  const handleMemberSelect = (member) => {
    setSelectedMember(member);
    setAssigneeName(member.name);
    setAssigneeEmail(member.email || '');
    setAssigneePhone(member.phone || '');
  };

  const handleSaveAssignment = async (taskId) => {
    if (!assigneeEmail.trim() && !assigneePhone.trim()) {
      showToast('Please enter an email or phone number.', 'warning');
      return;
    }
    // Resolve the assignee's Firebase UID. Check in order:
    //   1. The member object explicitly selected from the autocomplete
    //   2. The teamMembers list (may already have uid if auto-linked)
    //   3. The userDirectory (real-time, has uid the moment they sign up — no tab-visit required)
    const emailKey = assigneeEmail.trim().toLowerCase();
    const linkedMember = selectedMember
      || teamMembers.find(m => m.email && m.email.toLowerCase() === emailKey);
    const dirEntry = directory.find(d => d.email && d.email.toLowerCase() === emailKey);
    const assigneeUid = linkedMember?.uid || dirEntry?.uid || null;

    try {
      await onUpdate(taskId, {
        assigneeName:       assigneeName.trim(),
        assigneeEmail:      assigneeEmail.trim().toLowerCase(),   // always lowercase
        assigneePhone:      assigneePhone.trim(),
        scheduledEmailTime: scheduleTime || null,
        assigneeUid,
      });
      showToast(
        assigneeUid
          ? 'Assignment saved! Task is now collaborative — your team member will see it in their dashboard.'
          : 'Assignment saved!',
        'success',
      );
      closeAssignForm();
      setSelectedMember(null);
    } catch {
      showToast('Failed to save assignment.', 'warning');
    }
  };

  // Opens Outlook if available, falls back to the device's default email app
  const sendEmailNow = (task) => {
    const recipient = task.assigneeEmail;
    if (!recipient) { showToast('No email set for this task.', 'warning'); return; }

    const greeting = task.assigneeName ? `Hi ${task.assigneeName},` : 'Hi,';
    const due = task.dueDate ? `\nDue: ${formatDate(task.dueDate)}` : '';
    const priority = task.priority ? `\nPriority: ${task.priority.charAt(0).toUpperCase() + task.priority.slice(1)}` : '';
    const from = user?.displayName || 'Suren';
    const subject = `Task: ${task.text}`;
    const body = `${greeting}\n\nYou have been assigned the following task:\n\n📋 ${task.text}${due}${priority}\n\nPlease action this at your earliest convenience.\n\nRegards,\n${from}`;

    const mailtoUrl = `mailto:${recipient}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    // ms-outlook:// is the registered URL scheme for Microsoft Outlook on Windows/Mac
    const outlookUrl = `ms-outlook://compose?to=${encodeURIComponent(recipient)}&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

    // Detect if Outlook opened by listening for the window losing focus
    let outlookHandled = false;
    const onBlur = () => { outlookHandled = true; };
    window.addEventListener('blur', onBlur, { once: true });

    // Trigger Outlook via a hidden link (silently ignored if scheme not registered)
    const a = document.createElement('a');
    a.href = outlookUrl;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    // After a short window, if Outlook didn't open, fall back to mailto:
    setTimeout(() => {
      window.removeEventListener('blur', onBlur);
      if (!outlookHandled) {
        window.location.href = mailtoUrl;
        showToast('Opening your email app...', 'success');
      }
    }, 750);

    showToast('Opening Outlook...', 'success');
  };

  const sendWhatsApp = (task) => {
    const rawPhone = task.assigneePhone;
    if (!rawPhone) { showToast('No phone number set for this task.', 'warning'); return; }
    const phone = formatWhatsAppPhone(rawPhone);
    const greeting = task.assigneeName ? `Hi ${task.assigneeName},` : 'Hi,';
    const due = task.dueDate ? `\n📅 Due: ${formatDate(task.dueDate)}` : '';
    const priority = task.priority ? `\n⚡ Priority: ${task.priority.charAt(0).toUpperCase() + task.priority.slice(1)}` : '';
    const from = user?.displayName || 'Suren';
    const msg = `${greeting}\n\nYou have been assigned a task:\n\n📋 *${task.text}*${due}${priority}\n\nPlease action this at your earliest convenience.\n\n— ${from}`;
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, '_blank');
  };

  const renderTask = (task) => {
    const overdue = !task.completed && isOverdue(task.dueDate);
    const isAssigning = assigningTaskId === task.id;
    const hasAssignee = task.assigneeEmail || task.assigneePhone;
    const isExpanded = expandedTaskIds.has(task.id);

    return (
      <div key={task.id} style={{
        borderBottom: '1px solid #f0e6d2',
        marginBottom: 8,
        borderRadius: 8,
        overflow: 'hidden',
        border: '1px solid #f0e6d2',
      }}>
        {/* ── Collapsed header row (always visible, clickable) ── */}
        <div
          onClick={() => toggleTask(task.id)}
          style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '11px 12px', cursor: 'pointer',
            background: isExpanded ? '#fffdf5' : 'transparent',
            userSelect: 'none',
          }}
        >
          <Bell size={15} color={overdue ? '#c0392b' : '#c9a96e'} style={{ flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 600, fontSize: 14, lineHeight: 1.4, color: overdue ? '#c0392b' : '#4a3728' }}>
                {task.text}
              </span>
              {task.status && task.status !== 'open' && <StatusBadge status={task.status} />}
              {task.assigneeUid && (
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: 3,
                  background: '#e8f8f5', color: '#2a9d8f',
                  fontSize: 10, fontWeight: 700,
                  padding: '2px 7px', borderRadius: 10,
                  border: '1px solid #2a9d8f44',
                }}>
                  <Link size={9} /> Collaborative
                </span>
              )}
            </div>
            {/* Compact summary line — due date + assignee name when collapsed */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 2 }}>
              {task.dueDate && (
                <span className={`task-due ${overdue ? 'overdue' : ''}`} style={{ fontSize: 12, margin: 0 }}>
                  <Calendar size={11} /> {overdue ? 'Was due:' : 'Due:'} {formatDate(task.dueDate)}
                </span>
              )}
              {hasAssignee && task.assigneeName && (
                <span style={{ fontSize: 12, color: '#2a9d8f', display: 'flex', alignItems: 'center', gap: 3 }}>
                  <UserPlus size={11} /> {task.assigneeName}
                </span>
              )}
            </div>
          </div>
          {/* Chevron */}
          <span style={{ color: '#8B6914', flexShrink: 0 }}>
            {isExpanded ? <ChevronDown size={17} /> : <ChevronRight size={17} />}
          </span>
        </div>

        {/* ── Expanded detail section ── */}
        {isExpanded && (
          <div style={{ borderTop: '1px solid #f0e6d2', padding: '12px 12px 14px', background: '#fffdf8' }}>
            {/* Full assignee details */}
            {hasAssignee && (
              <div style={{ fontSize: 12, color: '#2a9d8f', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                <UserPlus size={11} />
                {task.assigneeName && <span style={{ fontWeight: 600 }}>{task.assigneeName}</span>}
                {task.assigneeEmail && <span style={{ color: '#8a7a6a' }}>· {task.assigneeEmail}</span>}
                {task.assigneePhone && <span style={{ color: '#8a7a6a' }}>· {task.assigneePhone}</span>}
                {task.scheduledEmailTime && (
                  <span style={{ color: '#8a7a6a' }}>· Scheduled: {new Date(task.scheduledEmailTime).toLocaleString()}</span>
                )}
              </div>
            )}

            {/* Action buttons */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {hasAssignee && task.assigneeEmail && (
                <button className="btn btn-sm btn-blue" onClick={e => { e.stopPropagation(); sendEmailNow(task); }}>
                  <Mail size={13} /> Email Now
                </button>
              )}
              {hasAssignee && task.assigneePhone && (
                <button
                  className="btn btn-sm"
                  style={{ background: '#25D366', color: '#fff' }}
                  onClick={e => { e.stopPropagation(); sendWhatsApp(task); }}
                >
                  <MessageCircle size={13} /> WhatsApp
                </button>
              )}
              <button
                className="btn btn-sm btn-outline"
                onClick={e => { e.stopPropagation(); isAssigning ? closeAssignForm() : openAssignForm(task); }}
              >
                {hasAssignee ? <Edit2 size={13} /> : <UserPlus size={13} />}
                {hasAssignee ? 'Edit Assign' : 'Assign'}
              </button>
              <button
                className="btn btn-sm btn-teal"
                onClick={e => { e.stopPropagation(); onToggle(task.id, false); }}
              >
                <CheckCircle size={13} /> Done
              </button>
            </div>

            {/* Inline assign form */}
            {isAssigning && (
              <div style={{
                background: '#f5f0e5', borderRadius: 8, padding: 16,
                marginTop: 12, border: '1px solid #e8d5b7',
              }}>
                <div style={{ fontWeight: 600, fontSize: 14, color: '#4a3728', marginBottom: 12 }}>
                  Assign Task — type a name to search your team
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 10 }}>
                  <div>
                    <label className="label">Name</label>
                    <MemberAutocomplete
                      value={assigneeName}
                      onChange={setAssigneeName}
                      onSelect={handleMemberSelect}
                      members={teamMembers}
                      placeholder="Type to search..."
                    />
                  </div>
                  <div>
                    <label className="label">Email</label>
                    <input
                      className="input"
                      style={{ padding: '10px 12px', fontSize: 14 }}
                      type="email"
                      placeholder="email@company.com"
                      value={assigneeEmail}
                      onChange={e => setAssigneeEmail(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="label">WhatsApp</label>
                    <input
                      className="input"
                      style={{ padding: '10px 12px', fontSize: 14 }}
                      placeholder="e.g. 7305013582"
                      value={assigneePhone}
                      onChange={e => setAssigneePhone(e.target.value)}
                    />
                  </div>
                </div>
                <div style={{ marginBottom: 12 }}>
                  <label className="label">Schedule Send Time (optional)</label>
                  <input
                    type="datetime-local"
                    value={scheduleTime}
                    onChange={e => setScheduleTime(e.target.value)}
                    style={{
                      WebkitAppearance: 'none', appearance: 'none',
                      width: '100%', boxSizing: 'border-box', height: 44,
                      padding: '0 12px', border: '1px solid #d4c5a9', borderRadius: 8,
                      fontSize: 14, fontFamily: 'var(--font-body)', background: '#fffdf5',
                      color: '#4a3728', outline: 'none',
                    }}
                  />
                  <p style={{ fontSize: 12, color: '#8a7a6a', marginTop: 4 }}>
                    Save a scheduled time and use the Email Now / WhatsApp buttons to send when the time comes.
                  </p>
                </div>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                  <button className="btn btn-sm btn-outline" onClick={closeAssignForm}>
                    <X size={13} /> Cancel
                  </button>
                  <button className="btn btn-sm btn-teal" onClick={() => handleSaveAssignment(assigningTaskId)}>
                    Save Assignment
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="fade-in">
      <h2 className="section-title">Reminders</h2>

      {/* ── Overdue Tasks ─────────────────────────────────────────────── */}
      {overdueTasks.length > 0 && (
        <div className="card" style={{ padding: 0, overflow: 'hidden', borderLeft: '4px solid #c0392b' }}>
          <SectionHeader
            open={overdueOpen}
            onToggle={() => setOverdueOpen(o => !o)}
            icon={<Clock size={18} />}
            label="Overdue Tasks"
            count={overdueTasks.length}
            color="#c0392b"
          />
          {overdueOpen && (
            <div style={{ padding: '0 16px 16px', borderTop: '1px solid #f0e6d2' }}>
              <div style={{ marginTop: 14 }}>
                {overdueTasks.map(renderTask)}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Pending Tasks ─────────────────────────────────────────────── */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <SectionHeader
          open={pendingOpen}
          onToggle={() => setPendingOpen(o => !o)}
          icon={<Bell size={18} />}
          label="Pending Tasks"
          count={pendingTasks.length}
        />
        {pendingOpen && (
          <div style={{ padding: '0 16px 16px', borderTop: '1px solid #f0e6d2' }}>
            {pendingTasks.length === 0 ? (
              <div className="empty-state" style={{ padding: 24 }}>
                <CheckCircle size={36} color="#27ae60" />
                <p>All caught up! No pending tasks.</p>
              </div>
            ) : (
              <div style={{ marginTop: 14 }}>
                {upcomingTasks.map(renderTask)}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── How Notifications Work ────────────────────────────────────── */}
      <div className="card" style={{ padding: 0, overflow: 'hidden', background: '#f5f0e5', border: '1px dashed #c9a96e' }}>
        <SectionHeader
          open={helpOpen}
          onToggle={() => setHelpOpen(o => !o)}
          icon={<Send size={16} />}
          label="How Notifications Work"
        />
        {helpOpen && (
          <div style={{ padding: '0 16px 16px', borderTop: '1px solid #e8d5b7' }}>
            <p style={{ color: '#8a7a6a', lineHeight: 1.7, fontSize: 13, marginTop: 12 }}>
              Click <strong>Assign</strong> on any task, type a name to search team members, and their email/phone fills automatically.
              <strong> Email Now</strong> opens Outlook (or your device mail app if Outlook isn't installed) pre-filled and ready to send.
              <strong> WhatsApp</strong> opens a pre-written message in WhatsApp. Add team members via the <strong>Team</strong> tab.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
