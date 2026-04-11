import { useState, useRef, useEffect } from 'react';
import { Users, Plus, Trash2, Upload, Phone, Mail, User, Edit2, Check, X, Link, Copy, CheckCircle, Building2, RefreshCw, Briefcase } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useUserDirectory } from '../hooks/useFirestore';

/** Parse CSV text → array of { name, email, phone } objects */
function parseCSV(text) {
  const lines = text.trim().split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];
  const header   = lines[0].toLowerCase().split(',').map(h => h.trim().replace(/"/g, ''));
  const nameIdx  = header.findIndex(h => h.includes('name'));
  const emailIdx = header.findIndex(h => h.includes('email') || h.includes('mail'));
  const phoneIdx = header.findIndex(h => h.includes('phone') || h.includes('mobile') || h.includes('contact'));
  const members  = [];
  for (let i = 1; i < lines.length; i++) {
    const cols  = lines[i].split(',').map(c => c.trim().replace(/"/g, ''));
    const name  = nameIdx  >= 0 ? cols[nameIdx]  : cols[0];
    const email = emailIdx >= 0 ? cols[emailIdx] : cols[1];
    const phone = phoneIdx >= 0 ? cols[phoneIdx] : cols[2];
    if (name) members.push({ name: name || '', email: email || '', phone: phone || '' });
  }
  return members;
}

export default function TeamMembers({ members, loading, onAdd, onAddBulk, onUpdate, onDelete, showToast }) {
  const { user } = useAuth();
  const { directory } = useUserDirectory(user?.uid);

  const [name,    setName]    = useState('');
  const [email,   setEmail]   = useState('');
  const [phone,   setPhone]   = useState('');
  const [adding,  setAdding]  = useState(false);
  const [copied,  setCopied]  = useState(false);

  const [editingId,    setEditingId]    = useState(null);
  const [editName,     setEditName]     = useState('');
  const [editEmail,    setEditEmail]    = useState('');
  const [editPhone,    setEditPhone]    = useState('');

  // ── M365 Org Directory ─────────────────────────────────────────────────
  const [orgUsers, setOrgUsers]       = useState([]);
  const [orgLoading, setOrgLoading]   = useState(false);
  const [orgError, setOrgError]       = useState(null);

  useEffect(() => {
    loadOrgUsers();
  }, []);

  const loadOrgUsers = async () => {
    setOrgLoading(true);
    setOrgError(null);
    try {
      const { fetchAllOrgUsers } = await import('../utils/graphPeopleSearch');
      const users = await fetchAllOrgUsers();
      setOrgUsers(users);
      if (users.length === 0) setOrgError('No users found — you may need to sign in again to refresh your Microsoft token.');
    } catch {
      setOrgError('Failed to load organization directory');
    }
    setOrgLoading(false);
  };

  // Quick-add an org user as a team member
  const handleAddFromOrg = async (orgUser) => {
    // Check if already in team
    if (members.find(m => m.email?.toLowerCase() === orgUser.email?.toLowerCase())) {
      showToast(`${orgUser.displayName} is already on your team`, 'info');
      return;
    }
    try {
      await onAdd({ name: orgUser.displayName, email: orgUser.email, phone: orgUser.phone || '' });
      showToast(`${orgUser.displayName} added to team!`, 'success');
    } catch {
      showToast('Failed to add member', 'warning');
    }
  };

  // Add all org users at once
  const handleAddAllFromOrg = async () => {
    const existingEmails = new Set(members.map(m => m.email?.toLowerCase()));
    const newUsers = orgUsers.filter(u => u.email && !existingEmails.has(u.email.toLowerCase()));
    if (newUsers.length === 0) { showToast('All org members are already on your team!', 'info'); return; }
    try {
      await onAddBulk(newUsers.map(u => ({ name: u.displayName, email: u.email, phone: u.phone || '' })));
      showToast(`${newUsers.length} members added from organization!`, 'success');
    } catch {
      showToast('Failed to add members', 'warning');
    }
  };

  const fileRef = useRef();

  // Auto-link: when a new member appears in userDirectory, update the matching
  // teamMembers record with their Firebase UID (matched by email).
  useEffect(() => {
    if (!directory.length || !members.length) return;
    directory.forEach(async (dirEntry) => {
      const match = members.find(
        m => m.email && m.email.toLowerCase() === dirEntry.email.toLowerCase() && !m.uid
      );
      if (match) {
        try {
          await onUpdate(match.id, { uid: dirEntry.uid });
        } catch {
          // non-fatal
        }
      }
    });
  }, [directory, members]);

  const handleAdd = async () => {
    if (!name.trim()) { showToast('Name is required', 'warning'); return; }
    setAdding(true);
    try {
      await onAdd({ name: name.trim(), email: email.trim(), phone: phone.trim() });
      setName(''); setEmail(''); setPhone('');
      showToast('Team member added!', 'success');
    } catch {
      showToast('Failed to add member', 'warning');
    }
    setAdding(false);
  };

  const handleCSV = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const text   = await file.text();
    const parsed = parseCSV(text);
    if (!parsed.length) { showToast('No valid rows found. Check your CSV format.', 'warning'); return; }
    try {
      await onAddBulk(parsed);
      showToast(`${parsed.length} team members imported!`, 'success');
    } catch {
      showToast('Bulk import failed', 'warning');
    }
    e.target.value = '';
  };

  const startEdit = (m) => {
    setEditingId(m.id);
    setEditName(m.name);
    setEditEmail(m.email || '');
    setEditPhone(m.phone || '');
  };

  const saveEdit = async (id) => {
    try {
      await onUpdate(id, { name: editName.trim(), email: editEmail.trim(), phone: editPhone.trim() });
      showToast('Member updated!', 'success');
      setEditingId(null);
    } catch {
      showToast('Failed to update member', 'warning');
    }
  };

  // Generate and copy the join link — team members open this to sign up
  const copyJoinLink = () => {
    const link = `${window.location.origin}${window.location.pathname}?join=${user.uid}`;
    navigator.clipboard.writeText(link).then(() => {
      setCopied(true);
      showToast('Join link copied! Share it with your team.', 'success');
      setTimeout(() => setCopied(false), 3000);
    }).catch(() => {
      // Fallback for browsers without clipboard API
      prompt('Copy this join link and share it:', link);
    });
  };

  return (
    <div className="fade-in">
      <h2 className="section-title">Team Members</h2>

      {/* ── Invite Banner ─────────────────────────────────────────────── */}
      <div className="card" style={{ background: '#f0faf8', border: '1px solid #2a9d8f44', padding: '16px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <Link size={20} color="#2a9d8f" style={{ flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: 14, color: '#2a9d8f' }}>Invite Team Members</div>
            <div style={{ fontSize: 13, color: '#8a7a6a', marginTop: 2 }}>
              Share your unique join link. Team members sign up once and can then see and update tasks assigned to them.
            </div>
          </div>
          <button
            className="btn btn-teal btn-sm"
            onClick={copyJoinLink}
            style={{ flexShrink: 0 }}
          >
            {copied ? <CheckCircle size={14} /> : <Copy size={14} />}
            {copied ? 'Copied!' : 'Copy Join Link'}
          </button>
        </div>
      </div>

      {/* ── M365 Organization Directory ─────────────────────────────────── */}
      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <h3 style={{ color: '#4a3728', display: 'flex', alignItems: 'center', gap: 8, margin: 0 }}>
            <Building2 size={18} color="#2a6cb8" /> Organization Directory
          </h3>
          <div style={{ display: 'flex', gap: 8 }}>
            {orgUsers.length > 0 && (
              <button className="btn btn-sm btn-teal" onClick={handleAddAllFromOrg}>
                <Plus size={13} /> Add All to Team
              </button>
            )}
            <button className="btn btn-sm btn-outline" onClick={loadOrgUsers} disabled={orgLoading}>
              <RefreshCw size={13} className={orgLoading ? 'spin' : ''} /> Refresh
            </button>
          </div>
        </div>

        {orgLoading && (
          <p style={{ color: '#8a7a6a', fontSize: 13, textAlign: 'center', padding: '16px 0' }}>
            Loading organization directory...
          </p>
        )}

        {orgError && !orgLoading && (
          <p style={{ color: '#c0392b', fontSize: 13, textAlign: 'center', padding: '12px 0' }}>
            {orgError}
          </p>
        )}

        {!orgLoading && orgUsers.length > 0 && (
          <div style={{ maxHeight: 360, overflowY: 'auto' }}>
            {orgUsers.map(u => {
              const alreadyAdded = members.some(m => m.email?.toLowerCase() === u.email?.toLowerCase());
              return (
                <div key={u.id} style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px',
                  borderBottom: '1px solid #f0e6d2',
                }}>
                  {/* Avatar */}
                  <div style={{
                    width: 36, height: 36, borderRadius: '50%',
                    background: alreadyAdded ? '#e8f8f5' : '#e8f0fe',
                    border: `1px solid ${alreadyAdded ? '#2a9d8f55' : '#2a6cb844'}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontFamily: 'var(--font-handwriting)', fontSize: 18,
                    color: alreadyAdded ? '#2a9d8f' : '#2a6cb8',
                    flexShrink: 0,
                  }}>
                    {(u.displayName || '?').charAt(0).toUpperCase()}
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 600, fontSize: 14, color: '#4a3728' }}>{u.displayName}</span>
                      {alreadyAdded && (
                        <span style={{
                          background: '#e8f8f5', color: '#2a9d8f', fontSize: 11, fontWeight: 600,
                          padding: '2px 8px', borderRadius: 10, border: '1px solid #2a9d8f44',
                          display: 'flex', alignItems: 'center', gap: 3,
                        }}>
                          <CheckCircle size={10} /> On Team
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: '#8a7a6a', display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 2 }}>
                      {u.email && <span><Mail size={11} style={{ display: 'inline', marginRight: 3 }} />{u.email}</span>}
                      {u.jobTitle && <span><Briefcase size={11} style={{ display: 'inline', marginRight: 3 }} />{u.jobTitle}</span>}
                    </div>
                  </div>

                  {!alreadyAdded && (
                    <button
                      className="btn btn-sm btn-gold"
                      onClick={() => handleAddFromOrg(u)}
                      title="Add to team"
                      style={{ flexShrink: 0 }}
                    >
                      <Plus size={13} /> Add
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Add individual member ──────────────────────────────────────── */}
      <div className="card">
        <h3 style={{ marginBottom: 14, color: '#4a3728', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Plus size={18} /> Add Team Member
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 12 }}>
          <div>
            <label className="label"><User size={12} style={{ display: 'inline', marginRight: 4 }} />Name *</label>
            <input className="input" placeholder="Full name" value={name} onChange={e => setName(e.target.value)} />
          </div>
          <div>
            <label className="label"><Mail size={12} style={{ display: 'inline', marginRight: 4 }} />Email</label>
            <input className="input" type="email" placeholder="email@company.com" value={email} onChange={e => setEmail(e.target.value)} />
          </div>
          <div>
            <label className="label"><Phone size={12} style={{ display: 'inline', marginRight: 4 }} />WhatsApp</label>
            <input className="input" placeholder="e.g. 917305013582" value={phone} onChange={e => setPhone(e.target.value)} />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button className="btn btn-gold" onClick={handleAdd} disabled={adding}>
            <Plus size={16} /> {adding ? 'Adding...' : 'Add Member'}
          </button>
        </div>
      </div>

      {/* ── Bulk CSV upload ────────────────────────────────────────────── */}
      <div className="card" style={{ background: '#f5f0e5', border: '1px dashed #c9a96e' }}>
        <h3 style={{ marginBottom: 8, color: '#4a3728', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Upload size={18} /> Bulk Upload via CSV
        </h3>
        <p style={{ fontSize: 14, color: '#8a7a6a', marginBottom: 12, lineHeight: 1.6 }}>
          Upload a CSV file with columns: <strong>name, email, phone</strong>. First row should be a header.
          Example: <code style={{ background: '#e8d5b7', padding: '1px 6px', borderRadius: 4, fontSize: 12 }}>name,email,phone</code>
        </p>
        <input ref={fileRef} type="file" accept=".csv,text/csv" style={{ display: 'none' }} onChange={handleCSV} />
        <button className="btn btn-leather" onClick={() => fileRef.current.click()}>
          <Upload size={16} /> Choose CSV File
        </button>
      </div>

      {/* ── Members list ──────────────────────────────────────────────── */}
      <div className="card">
        <h3 style={{ marginBottom: 14, color: '#4a3728', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Users size={18} /> Your Team ({members.length})
        </h3>

        {loading && <p style={{ color: '#8a7a6a' }}>Loading...</p>}

        {!loading && members.length === 0 && (
          <div className="empty-state" style={{ padding: 24 }}>
            <Users size={36} color="#c9a96e" />
            <p>No team members yet. Add someone above!</p>
          </div>
        )}

        {members.map(m => (
          <div key={m.id} style={{ borderBottom: '1px solid #f0e6d2' }}>
            {editingId === m.id ? (
              <div style={{ padding: '12px 0' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 8 }}>
                  <input className="input" style={{ padding: '8px 10px', fontSize: 14 }} value={editName}  onChange={e => setEditName(e.target.value)}  placeholder="Name" />
                  <input className="input" style={{ padding: '8px 10px', fontSize: 14 }} value={editEmail} onChange={e => setEditEmail(e.target.value)} placeholder="Email" />
                  <input className="input" style={{ padding: '8px 10px', fontSize: 14 }} value={editPhone} onChange={e => setEditPhone(e.target.value)} placeholder="Phone" />
                </div>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button className="btn btn-sm btn-outline" onClick={() => setEditingId(null)}><X size={13} /> Cancel</button>
                  <button className="btn btn-sm btn-teal"    onClick={() => saveEdit(m.id)}><Check size={13} /> Save</button>
                </div>
              </div>
            ) : (
              <div className="task-row" style={{ borderBottom: 'none' }}>
                {/* Avatar */}
                <div style={{
                  width: 36, height: 36, borderRadius: '50%',
                  background: m.uid ? '#e8f8f5' : 'var(--gold-pale)',
                  border: `1px solid ${m.uid ? '#2a9d8f55' : 'var(--paper-line)'}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontFamily: 'var(--font-handwriting)', fontSize: 18,
                  color: m.uid ? '#2a9d8f' : 'var(--gold)',
                  flexShrink: 0,
                }}>
                  {(m.name || '?').charAt(0).toUpperCase()}
                </div>

                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 600, fontSize: 15 }}>{m.name}</span>
                    {/* Linked badge */}
                    {m.uid && (
                      <span style={{
                        background: '#e8f8f5', color: '#2a9d8f',
                        fontSize: 11, fontWeight: 600,
                        padding: '2px 8px', borderRadius: 10,
                        border: '1px solid #2a9d8f44',
                        display: 'flex', alignItems: 'center', gap: 3,
                      }}>
                        <CheckCircle size={10} /> Linked
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 13, color: '#8a7a6a', display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 2 }}>
                    {m.email && <span><Mail  size={11} style={{ display: 'inline', marginRight: 3 }} />{m.email}</span>}
                    {m.phone && <span><Phone size={11} style={{ display: 'inline', marginRight: 3 }} />{m.phone}</span>}
                  </div>
                </div>

                <button className="btn-icon" onClick={() => startEdit(m)} title="Edit"><Edit2 size={15} /></button>
                <button className="btn-icon" onClick={() => {
                  if (window.confirm(`Remove ${m.name || 'this member'} from your team?`)) onDelete(m.id);
                }} title="Remove"><Trash2 size={15} color="#c0392b" /></button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
