/**
 * DiaryHistoryModal
 *
 * Shows a list of version snapshots for a diary entry and lets the user
 * restore any of them.  The restore does NOT auto-save — it loads the
 * content into the editor and the user must click "Save Entry" to confirm.
 */
import { useState, useEffect } from 'react';
import { X, Clock, RotateCcw, ChevronDown, ChevronUp } from 'lucide-react';
import { loadSnapshots } from '../utils/diaryHistory';
import { useAuth } from '../contexts/AuthContext';

export default function DiaryHistoryModal({ entryId, isShared, onRestore, onClose }) {
  const { user } = useAuth();
  const [snapshots,  setSnapshots]  = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState(null);
  const [expanded,   setExpanded]   = useState(null);   // id of expanded row
  const [confirming, setConfirming] = useState(null);   // snapshot to confirm restore

  useEffect(() => {
    setLoading(true);
    loadSnapshots({ uid: user?.uid, entryId, isShared })
      .then(snaps => { setSnapshots(snaps); setLoading(false); })
      .catch(err  => { setError(err.message || 'Failed to load history'); setLoading(false); });
  }, [user, entryId, isShared]);

  const fmt = (date) => {
    if (!date || date.getTime() === 0) return '—';
    return date.toLocaleString(undefined, {
      day:    '2-digit', month: 'short', year:   'numeric',
      hour:   '2-digit', minute: '2-digit',
    });
  };

  const wordCount = (html) => {
    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    return text ? text.split(' ').length : 0;
  };

  const typeLabel = (type) => type === 'periodic' ? 'Auto' : 'Manual save';

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9000,
        background: 'rgba(0,0,0,0.45)', display: 'flex',
        alignItems: 'center', justifyContent: 'center',
        padding: 16,
      }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: 'var(--paper)', borderRadius: 12,
        boxShadow: '0 8px 40px rgba(0,0,0,0.22)',
        width: '100%', maxWidth: 620,
        maxHeight: '80vh', display: 'flex', flexDirection: 'column',
        fontFamily: 'var(--font-body)',
      }}>

        {/* ── Header ── */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '16px 20px 14px',
          borderBottom: '1px solid var(--paper-line)',
          flexShrink: 0,
        }}>
          <Clock size={18} style={{ color: 'var(--gold)', flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--ink)' }}>
              Version History
            </div>
            <div style={{ fontSize: 12, color: 'var(--ink-lighter)', marginTop: 1 }}>
              Last {snapshots.length} saved versions · Restore restores to editor (then click Save to confirm)
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer',
              padding: 4, color: 'var(--ink-lighter)', borderRadius: 6 }}
          >
            <X size={16} />
          </button>
        </div>

        {/* ── Body ── */}
        <div style={{ overflowY: 'auto', flex: 1, padding: '8px 0' }}>

          {loading && (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--ink-lighter)', fontSize: 14 }}>
              Loading history…
            </div>
          )}

          {error && (
            <div style={{ padding: 20, color: '#dc2626', fontSize: 13, textAlign: 'center' }}>
              {error}
            </div>
          )}

          {!loading && !error && snapshots.length === 0 && (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--ink-lighter)', fontSize: 14 }}>
              No saved versions yet.<br/>
              <span style={{ fontSize: 12 }}>Versions are created each time you click Save Entry.</span>
            </div>
          )}

          {!loading && snapshots.map((snap, idx) => {
            const isExp = expanded === snap.id;
            const isCfm = confirming?.id === snap.id;

            return (
              <div key={snap.id} style={{
                borderBottom: '1px solid var(--paper-line)',
                padding: '10px 20px',
                background: isExp ? 'var(--paper-dark)' : 'transparent',
                transition: 'background 0.12s',
              }}>

                {/* Row header */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>
                      {idx === 0 ? '⭐ Latest — ' : ''}{fmt(snap.savedAt)}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--ink-lighter)', marginTop: 2, display: 'flex', gap: 10 }}>
                      <span>{typeLabel(snap.type)}</span>
                      {snap.savedBy && <span>by {snap.savedBy}</span>}
                      <span>{wordCount(snap.content).toLocaleString()} words</span>
                    </div>
                  </div>

                  {/* Expand preview */}
                  <button
                    onClick={() => setExpanded(isExp ? null : snap.id)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer',
                      color: 'var(--ink-lighter)', padding: 4, borderRadius: 4 }}
                    title="Preview content"
                  >
                    {isExp ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </button>

                  {/* Restore button */}
                  {!isCfm ? (
                    <button
                      onClick={() => setConfirming(snap)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 5,
                        padding: '5px 12px', borderRadius: 6,
                        background: 'none',
                        border: '1px solid var(--paper-line)',
                        cursor: 'pointer', fontSize: 12,
                        color: 'var(--ink)',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.background = 'var(--paper-dark)'; e.currentTarget.style.borderColor = 'var(--gold)'; }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.borderColor = 'var(--paper-line)'; }}
                    >
                      <RotateCcw size={12} /> Restore
                    </button>
                  ) : (
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <span style={{ fontSize: 11, color: '#d97706' }}>Restore this version?</span>
                      <button
                        onClick={() => { onRestore(snap.content, snap.title); onClose(); }}
                        style={{
                          padding: '4px 10px', borderRadius: 5, fontSize: 12,
                          background: 'var(--gold)', color: '#fff',
                          border: 'none', cursor: 'pointer', fontWeight: 600,
                        }}
                      >
                        Yes
                      </button>
                      <button
                        onClick={() => setConfirming(null)}
                        style={{
                          padding: '4px 8px', borderRadius: 5, fontSize: 12,
                          background: 'none', border: '1px solid var(--paper-line)',
                          cursor: 'pointer', color: 'var(--ink-lighter)',
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>

                {/* Inline content preview */}
                {isExp && (
                  <div
                    style={{
                      marginTop: 10,
                      padding: '10px 12px',
                      background: 'var(--paper)',
                      border: '1px solid var(--paper-line)',
                      borderRadius: 6,
                      fontSize: 12,
                      color: 'var(--ink)',
                      maxHeight: 200,
                      overflowY: 'auto',
                      lineHeight: 1.5,
                    }}
                    dangerouslySetInnerHTML={{ __html: snap.content }}
                  />
                )}
              </div>
            );
          })}
        </div>

        {/* ── Footer ── */}
        <div style={{
          padding: '12px 20px',
          borderTop: '1px solid var(--paper-line)',
          fontSize: 12, color: 'var(--ink-lighter)',
          flexShrink: 0,
          background: 'var(--paper-dark)',
          borderRadius: '0 0 12px 12px',
        }}>
          Up to 20 versions are kept. Older versions are pruned automatically.
        </div>
      </div>
    </div>
  );
}
