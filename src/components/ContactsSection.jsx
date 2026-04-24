import { useState, useEffect, useMemo } from 'react';
import {
  Phone, Search, RefreshCw, Check, X, Edit2, Trash2, AlertCircle,
} from 'lucide-react';
import { useTeamMembers } from '../hooks/useFirestore';
import { fetchAllOrgUsers } from '../utils/graphPeopleSearch';
import Avatar from './shared/Avatar';

/**
 * ContactsSection — Settings page widget for manually overriding saved
 * WhatsApp / phone numbers.
 *
 * Flow:
 *   1. Merges org users from M365 Graph (source of truth: businessPhones[0]
 *      with mobilePhone as fallback) with any user-saved overrides from
 *      users/{uid}/teamMembers (keyed by email).
 *   2. Lets the user edit any row inline. Saves commit to teamMembers via
 *      saveContactPhone(email, name, phone). Clearing a number deletes the
 *      override so we fall back to Graph next time.
 *   3. When a new task is assigned, the assign flow consults this same
 *      overrides map first — so the "saved number" is what gets used.
 *
 * Notes:
 *   - We don't push the override back onto existing task snapshots. If an
 *     already-assigned task has a stale phone, the user must re-save that
 *     task from its Assign panel (explicit action).
 *   - This editor is scoped to the current user's personal contact book.
 *     Each team member maintains their own.
 */
export default function ContactsSection({ showToast }) {
  const { members, saveContactPhone } = useTeamMembers();

  // Overrides map: email (lowercase) → { email, name, phone }
  const overrides = useMemo(() => {
    const m = new Map();
    for (const mem of members || []) {
      if (mem.email) m.set(mem.email.toLowerCase(), mem);
    }
    return m;
  }, [members]);

  // Org users fetched from Graph (source of truth for "directory" rows)
  const [orgUsers, setOrgUsers]     = useState([]);
  const [orgLoading, setOrgLoading] = useState(false);
  const [orgError, setOrgError]     = useState('');

  // UI state
  const [search, setSearch]     = useState('');
  const [editingEmail, setEditingEmail] = useState(null);
  const [editPhone, setEditPhone]       = useState('');
  const [saving, setSaving]             = useState(false);

  // Load org users on mount (also refresh when user hits the refresh button)
  const loadOrg = async () => {
    setOrgLoading(true);
    setOrgError('');
    try {
      const users = await fetchAllOrgUsers();
      setOrgUsers(users || []);
      if (!users || users.length === 0) {
        setOrgError("No directory results. Your Microsoft token may have expired — sign out and back in.");
      }
    } catch (err) {
      setOrgError("Couldn't reach the Microsoft directory. Check your connection.");
    }
    setOrgLoading(false);
  };
  useEffect(() => { loadOrg(); /* eslint-disable-next-line */ }, []);

  // Merge org users + overrides into one list, de-duped by email.
  // Each row: { email, name, phoneGraph, phoneOverride, effectivePhone, source }
  const rows = useMemo(() => {
    const byEmail = new Map();

    // 1. Seed from org directory
    for (const u of orgUsers) {
      const email = (u.email || '').toLowerCase();
      if (!email) continue;
      byEmail.set(email, {
        email,
        name:          u.displayName || email,
        jobTitle:      u.jobTitle || '',
        phoneGraph:    u.phone || '',
        phoneOverride: '',
      });
    }

    // 2. Layer overrides on top (add new entries for contacts not in org)
    for (const [email, mem] of overrides.entries()) {
      const existing = byEmail.get(email) || {
        email,
        name:       mem.name || email,
        jobTitle:   '',
        phoneGraph: '',
      };
      existing.phoneOverride = mem.phone || '';
      // Prefer the stored name if org directory didn't have one.
      if (mem.name && (!existing.name || existing.name === existing.email)) {
        existing.name = mem.name;
      }
      byEmail.set(email, existing);
    }

    // Finalise effective phone + source label
    const arr = [...byEmail.values()].map(r => ({
      ...r,
      effectivePhone: r.phoneOverride || r.phoneGraph || '',
      source: r.phoneOverride
        ? 'saved'
        : r.phoneGraph
          ? 'directory'
          : 'none',
    }));

    // Sort: overrides first (they're the ones the user cares about), then alphabetical
    arr.sort((a, b) => {
      if (!!a.phoneOverride !== !!b.phoneOverride) return a.phoneOverride ? -1 : 1;
      return (a.name || '').localeCompare(b.name || '');
    });
    return arr;
  }, [orgUsers, overrides]);

  // Apply search filter
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(r =>
      (r.name || '').toLowerCase().includes(q) ||
      (r.email || '').toLowerCase().includes(q) ||
      (r.effectivePhone || '').toLowerCase().includes(q) ||
      (r.jobTitle || '').toLowerCase().includes(q)
    );
  }, [rows, search]);

  const startEdit = (row) => {
    setEditingEmail(row.email);
    setEditPhone(row.effectivePhone || '');
  };
  const cancelEdit = () => { setEditingEmail(null); setEditPhone(''); };

  const saveEdit = async (row) => {
    setSaving(true);
    try {
      await saveContactPhone(row.email, row.name, editPhone);
      if (showToast) {
        const trimmed = editPhone.trim();
        showToast(
          trimmed ? `Saved phone for ${row.name}.` : `Phone cleared for ${row.name} — will use directory value.`,
          'success'
        );
      }
      setEditingEmail(null);
      setEditPhone('');
    } catch {
      if (showToast) showToast('Failed to save phone. Try again.', 'warning');
    }
    setSaving(false);
  };

  const clearOverride = async (row) => {
    if (!row.phoneOverride) return;
    if (!window.confirm(`Clear the saved phone for ${row.name}? Future assignments will use the directory value ("${row.phoneGraph || 'none'}").`)) return;
    setSaving(true);
    try {
      await saveContactPhone(row.email, row.name, '');
      if (showToast) showToast(`Cleared saved phone for ${row.name}.`, 'success');
    } catch {
      if (showToast) showToast('Failed to clear.', 'warning');
    }
    setSaving(false);
  };

  const overrideCount = overrides.size;

  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <h3 style={{ display: 'flex', alignItems: 'center', gap: 8, margin: 0 }}>
          <Phone size={20} color="#6d28d9" /> Contacts & WhatsApp Numbers
        </h3>
        <button
          className="btn btn-sm btn-outline"
          onClick={loadOrg}
          disabled={orgLoading}
          title="Re-fetch the org directory from Microsoft"
        >
          <RefreshCw size={13} style={{ animation: orgLoading ? 'spin 1s linear infinite' : 'none' }} />
          {orgLoading ? 'Refreshing…' : 'Reload directory'}
        </button>
      </div>

      <p style={{ fontSize: 13, color: '#475569', lineHeight: 1.6, marginBottom: 12 }}>
        If a user's WhatsApp number is wrong, edit it here. Saved numbers override
        the Microsoft directory and are used automatically when you assign tasks.
        {overrideCount > 0 && (
          <span style={{ color: '#7c3aed', fontWeight: 600 }}> You have {overrideCount} saved override{overrideCount > 1 ? 's' : ''}.</span>
        )}
      </p>

      {orgError && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', background: '#fff1f2', border: '1px solid #fecdd3', borderRadius: 8, color: '#9f1239', fontSize: 13, marginBottom: 12 }}>
          <AlertCircle size={14} /> {orgError}
        </div>
      )}

      {/* Search */}
      <div style={{ position: 'relative', marginBottom: 10 }}>
        <Search size={15} color="#94a3b8" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
        <input
          className="input"
          placeholder="Search by name, email, or phone…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ paddingLeft: 36, fontSize: 14 }}
        />
      </div>

      {/* List */}
      <div style={{ maxHeight: 500, overflowY: 'auto', WebkitOverflowScrolling: 'touch', border: '1px solid #e2e8f0', borderRadius: 10 }}>
        {orgLoading && rows.length === 0 && (
          <div style={{ padding: 24, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>
            Loading directory…
          </div>
        )}
        {!orgLoading && filtered.length === 0 && (
          <div style={{ padding: 24, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>
            {search ? 'No matches.' : 'No contacts yet.'}
          </div>
        )}
        {filtered.map(row => {
          const isEditing = editingEmail === row.email;
          const hasOverride = !!row.phoneOverride;
          return (
            <div
              key={row.email}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '10px 12px', borderBottom: '1px solid #f1f5f9',
                background: hasOverride ? '#faf7ff' : '#ffffff',
              }}
            >
              <Avatar id={row.email} name={row.name} email={row.email} size="sm" />

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14, color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {row.name}
                  {hasOverride && (
                    <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, color: '#7c3aed', background: '#ede9fe', padding: '1px 6px', borderRadius: 8, border: '1px solid #c4b5fd55' }}>SAVED</span>
                  )}
                </div>
                <div style={{ fontSize: 11, color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {row.email}{row.jobTitle ? ` · ${row.jobTitle}` : ''}
                </div>
                {/* Show both values when the override differs from the directory */}
                {hasOverride && row.phoneGraph && row.phoneGraph !== row.phoneOverride && (
                  <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
                    Directory: <span style={{ textDecoration: 'line-through' }}>{row.phoneGraph}</span>
                  </div>
                )}
              </div>

              {/* Phone cell — editable inline */}
              {isEditing ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flexShrink: 0 }}>
                  <input
                    type="tel"
                    autoFocus
                    value={editPhone}
                    onChange={e => setEditPhone(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') saveEdit(row); if (e.key === 'Escape') cancelEdit(); }}
                    placeholder="e.g. 7305013582"
                    style={{
                      width: 160,
                      padding: '8px 10px', fontSize: 14,
                      border: '1px solid #7c3aed', borderRadius: 6,
                      outline: 'none', background: '#fff',
                    }}
                  />
                  <button
                    className="btn-icon"
                    onClick={() => saveEdit(row)}
                    disabled={saving}
                    title="Save"
                    style={{ color: '#15803d' }}
                  >
                    <Check size={16} />
                  </button>
                  <button
                    className="btn-icon"
                    onClick={cancelEdit}
                    disabled={saving}
                    title="Cancel"
                  >
                    <X size={16} />
                  </button>
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                  <span style={{
                    fontSize: 13, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                    color: row.effectivePhone ? '#0f172a' : '#94a3b8',
                    minWidth: 120, textAlign: 'right',
                  }}>
                    {row.effectivePhone || '—'}
                  </span>
                  <button
                    className="btn-icon"
                    onClick={() => startEdit(row)}
                    title={hasOverride ? 'Edit saved phone' : 'Save a phone override'}
                  >
                    <Edit2 size={14} />
                  </button>
                  {hasOverride && (
                    <button
                      className="btn-icon"
                      onClick={() => clearOverride(row)}
                      title="Clear saved phone (revert to directory)"
                      style={{ color: '#dc2626' }}
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <p style={{ fontSize: 11, color: '#94a3b8', marginTop: 10, lineHeight: 1.6 }}>
        Changes apply to future task assignments. To update the phone on a task that's
        already assigned, open it and re-save its Assign panel.
      </p>
    </div>
  );
}
