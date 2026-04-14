import { useState, useRef, useEffect } from 'react';

export default function MemberAutocomplete({ value, onChange, onSelect, members, placeholder }) {
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
        const { searchOrgPeople } = await import('../../utils/graphPeopleSearch');
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
