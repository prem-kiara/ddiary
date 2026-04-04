import { useState, useRef } from 'react';
import { Users, Plus, Trash2, Upload, Phone, Mail, User, Edit2, Check, X } from 'lucide-react';

/** Parse CSV text → array of { name, email, phone } objects */
function parseCSV(text) {
  const lines = text.trim().split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];

  // Detect header row
  const header = lines[0].toLowerCase().split(',').map(h => h.trim().replace(/"/g, ''));
  const nameIdx = header.findIndex(h => h.includes('name'));
  const emailIdx = header.findIndex(h => h.includes('email') || h.includes('mail'));
  const phoneIdx = header.findIndex(h => h.includes('phone') || h.includes('mobile') || h.includes('contact'));

  const members = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map(c => c.trim().replace(/"/g, ''));
    const name = nameIdx >= 0 ? cols[nameIdx] : cols[0];
    const email = emailIdx >= 0 ? cols[emailIdx] : cols[1];
    const phone = phoneIdx >= 0 ? cols[phoneIdx] : cols[2];
    if (name) members.push({ name: name || '', email: email || '', phone: phone || '' });
  }
  return members;
}

export default function TeamMembers({ members, loading, onAdd, onAddBulk, onUpdate, onDelete, showToast }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [adding, setAdding] = useState(false);

  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editPhone, setEditPhone] = useState('');

  const fileRef = useRef();

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
    const text = await file.text();
    const parsed = parseCSV(text);
    if (!parsed.length) {
      showToast('No valid rows found. Check your CSV format.', 'warning');
      return;
    }
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

  return (
    <div className="fade-in">
      <h2 className="section-title">Team Members</h2>

      {/* Add individual member */}
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
            <label className="label"><Phone size={12} style={{ display: 'inline', marginRight: 4 }} />Phone / WhatsApp</label>
            <input className="input" placeholder="e.g. 917305013582" value={phone} onChange={e => setPhone(e.target.value)} />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button className="btn btn-gold" onClick={handleAdd} disabled={adding}>
            <Plus size={16} /> {adding ? 'Adding...' : 'Add Member'}
          </button>
        </div>
      </div>

      {/* Bulk CSV upload */}
      <div className="card" style={{ background: '#f5f0e5', border: '1px dashed #c9a96e' }}>
        <h3 style={{ marginBottom: 8, color: '#4a3728', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Upload size={18} /> Bulk Upload via CSV
        </h3>
        <p style={{ fontSize: 14, color: '#8a7a6a', marginBottom: 12, lineHeight: 1.6 }}>
          Upload a CSV file with columns: <strong>name, email, phone</strong>. The first row should be a header row.
          Example: <code style={{ background: '#e8d5b7', padding: '1px 6px', borderRadius: 4, fontSize: 12 }}>name,email,phone</code>
        </p>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          style={{ display: 'none' }}
          onChange={handleCSV}
        />
        <button className="btn btn-leather" onClick={() => fileRef.current.click()}>
          <Upload size={16} /> Choose CSV File
        </button>
      </div>

      {/* Members list */}
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
                  <input className="input" style={{ padding: '8px 10px', fontSize: 14 }} value={editName} onChange={e => setEditName(e.target.value)} placeholder="Name" />
                  <input className="input" style={{ padding: '8px 10px', fontSize: 14 }} value={editEmail} onChange={e => setEditEmail(e.target.value)} placeholder="Email" />
                  <input className="input" style={{ padding: '8px 10px', fontSize: 14 }} value={editPhone} onChange={e => setEditPhone(e.target.value)} placeholder="Phone" />
                </div>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button className="btn btn-sm btn-outline" onClick={() => setEditingId(null)}><X size={13} /> Cancel</button>
                  <button className="btn btn-sm btn-teal" onClick={() => saveEdit(m.id)}><Check size={13} /> Save</button>
                </div>
              </div>
            ) : (
              <div className="task-row" style={{ borderBottom: 'none' }}>
                <div style={{
                  width: 36, height: 36, borderRadius: '50%',
                  background: 'var(--gold-pale)', border: '1px solid var(--paper-line)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontFamily: 'var(--font-handwriting)', fontSize: 18, color: 'var(--gold)',
                  flexShrink: 0,
                }}>
                  {m.name.charAt(0).toUpperCase()}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 15 }}>{m.name}</div>
                  <div style={{ fontSize: 13, color: '#8a7a6a', display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 2 }}>
                    {m.email && <span><Mail size={11} style={{ display: 'inline', marginRight: 3 }} />{m.email}</span>}
                    {m.phone && <span><Phone size={11} style={{ display: 'inline', marginRight: 3 }} />{m.phone}</span>}
                  </div>
                </div>
                <button className="btn-icon" onClick={() => startEdit(m)} title="Edit"><Edit2 size={15} /></button>
                <button className="btn-icon" onClick={() => {
                  if (window.confirm(`Remove ${m.name} from your team?`)) onDelete(m.id);
                }} title="Remove"><Trash2 size={15} color="#c0392b" /></button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
