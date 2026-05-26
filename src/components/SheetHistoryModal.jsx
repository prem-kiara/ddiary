/**
 * SheetHistoryModal
 *
 * Displays up to 20 version snapshots for a spreadsheet and lets the user
 * restore any of them.  The restore is two-step: click "Restore" → confirm
 * inline.  A mini read-only grid preview (first 6 rows × 6 cols) is shown
 * when a snapshot is expanded.
 *
 * Props
 *   isShared   {boolean}        - whether this is a sharedSheets entry
 *   sharedId   {string|null}    - sharedSheets doc ID (isShared only)
 *   sheetId    {string}         - personal sheet doc ID
 *   uid        {string}         - owner Firebase UID
 *   onRestore  {function}       - called with (snapshot) when the user confirms
 *   onClose    {function}       - dismiss the modal
 */
import { useState, useEffect } from 'react';
import { loadSheetSnapshots } from '../utils/sheetHistory';

const PREVIEW_ROWS = 6;
const PREVIEW_COLS = 6;

function fmt(date) {
  if (!date || !(date instanceof Date) || isNaN(date)) return '—';
  const now  = new Date();
  const diff = now - date;
  if (diff < 60_000)        return 'Just now';
  if (diff < 3_600_000)     return `${Math.round(diff / 60_000)} min ago`;
  if (diff < 86_400_000)    return `${Math.round(diff / 3_600_000)} hr ago`;
  if (diff < 7 * 86_400_000)return `${Math.round(diff / 86_400_000)} days ago`;
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function cellCount(data) {
  return Object.values(data || {}).filter(c => c?.v != null && c.v !== '').length;
}

/** Tiny read-only grid preview (first PREVIEW_ROWS × PREVIEW_COLS cells) */
function MiniGrid({ data, cols, rows }) {
  const LETTERS = Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i));
  const showCols = Math.min(cols, PREVIEW_COLS);
  const showRows = Math.min(rows, PREVIEW_ROWS);

  return (
    <div style={{
      overflowX: 'auto', marginTop: 8, borderRadius: 6,
      border: '1px solid var(--paper-line)', fontSize: 11,
      fontFamily: 'var(--font-body)',
    }}>
      <table style={{ borderCollapse: 'collapse', minWidth: showCols * 70 }}>
        <thead>
          <tr>
            <th style={{
              width: 24, background: 'var(--paper-dark)',
              border: '1px solid var(--paper-line)', padding: '2px 4px',
              fontSize: 10, color: 'var(--ink-lighter)',
            }}></th>
            {Array.from({ length: showCols }, (_, c) => (
              <th key={c} style={{
                background: 'var(--paper-dark)', border: '1px solid var(--paper-line)',
                padding: '2px 6px', color: 'var(--ink-light)',
                minWidth: 70, textAlign: 'center',
              }}>
                {LETTERS[c]}
              </th>
            ))}
            {cols > PREVIEW_COLS && (
              <th style={{
                background: 'var(--paper-dark)', border: '1px solid var(--paper-line)',
                padding: '2px 6px', color: 'var(--ink-lighter)', fontStyle: 'italic',
              }}>…</th>
            )}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: showRows }, (_, r) => (
            <tr key={r}>
              <td style={{
                background: 'var(--paper-dark)', border: '1px solid var(--paper-line)',
                padding: '2px 4px', textAlign: 'center',
                color: 'var(--ink-lighter)', fontSize: 10,
              }}>{r + 1}</td>
              {Array.from({ length: showCols }, (_, c) => {
                const key  = `${LETTERS[c]}${r + 1}`;
                const cell = data?.[key];
                return (
                  <td key={c} style={{
                    border: '1px solid var(--paper-line)',
                    padding: '2px 6px',
                    maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    background: cell?.bg || 'transparent',
                    fontWeight: cell?.b ? 700 : 400,
                    fontStyle:  cell?.i ? 'italic' : 'normal',
                    color: 'var(--ink)',
                  }}>
                    {cell?.v ?? ''}
                  </td>
                );
              })}
              {cols > PREVIEW_COLS && (
                <td style={{ border: '1px solid var(--paper-line)', padding: '2px 6px', color: 'var(--ink-lighter)' }}>…</td>
              )}
            </tr>
          ))}
          {rows > PREVIEW_ROWS && (
            <tr>
              <td colSpan={showCols + 1 + (cols > PREVIEW_COLS ? 1 : 0)} style={{
                border: '1px solid var(--paper-line)', padding: '4px 8px',
                textAlign: 'center', color: 'var(--ink-lighter)', fontStyle: 'italic', fontSize: 10,
              }}>
                … {rows - PREVIEW_ROWS} more rows
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export default function SheetHistoryModal({ isShared, sharedId, sheetId, uid, onRestore, onClose }) {
  const [snapshots,   setSnapshots]   = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [expandedId,  setExpandedId]  = useState(null);
  const [confirmId,   setConfirmId]   = useState(null);

  useEffect(() => {
    setLoading(true);
    loadSheetSnapshots({ uid, sheetId, isShared, sharedId })
      .then(snaps => setSnapshots(snaps))
      .catch(() => setSnapshots([]))
      .finally(() => setLoading(false));
  }, [uid, sheetId, isShared, sharedId]);

  const handleRestore = (snap) => {
    onRestore(snap);
    onClose();
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
        zIndex: 1200, display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: 'var(--paper)', borderRadius: 14,
        boxShadow: '0 8px 40px rgba(0,0,0,0.22)',
        width: '90%', maxWidth: 680,
        maxHeight: '82vh', display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
      }}>

        {/* Header */}
        <div style={{
          padding: '18px 24px 14px', borderBottom: '1px solid var(--paper-line)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--ink)' }}>
              Version History
            </div>
            <div style={{ fontSize: 12, color: 'var(--ink-lighter)', marginTop: 2 }}>
              Up to 20 versions are kept. Restoring replaces the current grid — save first if needed.
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              border: 'none', background: 'none', cursor: 'pointer',
              fontSize: 20, color: 'var(--ink-lighter)', lineHeight: 1, padding: 4,
            }}
          >×</button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 16px 16px' }}>
          {loading ? (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--ink-lighter)', fontSize: 13 }}>
              Loading history…
            </div>
          ) : snapshots.length === 0 ? (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--ink-lighter)', fontSize: 13 }}>
              No saved versions yet. Versions are created automatically every 5 minutes
              while editing, and whenever you close the sheet.
            </div>
          ) : snapshots.map((snap, idx) => {
            const isExpanded = expandedId === snap.id;
            const isConfirm  = confirmId  === snap.id;

            return (
              <div
                key={snap.id}
                style={{
                  borderRadius: 10, border: '1px solid var(--paper-line)',
                  marginBottom: 8, overflow: 'hidden',
                  background: isExpanded ? 'var(--paper-dark)' : 'var(--paper)',
                  transition: 'background 0.15s',
                }}
              >
                {/* Row summary */}
                <div
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '10px 14px', cursor: 'pointer',
                  }}
                  onClick={() => setExpandedId(p => p === snap.id ? null : snap.id)}
                >
                  {/* Type badge */}
                  <span style={{
                    fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 20,
                    background: snap.type === 'manual' ? '#e0e7ff' : '#f3f4f6',
                    color:      snap.type === 'manual' ? '#4338ca' : '#6b7280',
                    flexShrink: 0,
                  }}>
                    {snap.type === 'manual' ? 'Manual' : 'Auto'}
                  </span>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontWeight: 600, fontSize: 13, color: 'var(--ink)',
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>
                      {snap.title || 'Untitled Sheet'}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--ink-lighter)', marginTop: 2 }}>
                      {fmt(snap.savedAt)}
                      {snap.savedBy ? ` · ${snap.savedBy}` : ''}
                      {' · '}
                      {snap.cols}×{snap.rows} grid
                      {' · '}
                      {cellCount(snap.data)} cells
                    </div>
                  </div>

                  {/* Latest badge */}
                  {idx === 0 && (
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 20,
                      background: '#dcfce7', color: '#16a34a', flexShrink: 0,
                    }}>Latest</span>
                  )}

                  {/* Expand chevron */}
                  <span style={{ fontSize: 12, color: 'var(--ink-lighter)', flexShrink: 0 }}>
                    {isExpanded ? '▲' : '▼'}
                  </span>
                </div>

                {/* Expanded preview + actions */}
                {isExpanded && (
                  <div style={{ padding: '0 14px 14px', borderTop: '1px solid var(--paper-line)' }}>
                    <MiniGrid data={snap.data} cols={snap.cols} rows={snap.rows} />

                    <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
                      {isConfirm ? (
                        <>
                          <span style={{ fontSize: 12, color: 'var(--ink)', marginRight: 4 }}>
                            Replace current sheet with this version?
                          </span>
                          <button
                            onClick={() => handleRestore(snap)}
                            style={{
                              padding: '5px 14px', borderRadius: 7,
                              background: '#7c3aed', color: '#fff',
                              border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600,
                            }}
                          >Yes, restore</button>
                          <button
                            onClick={() => setConfirmId(null)}
                            style={{
                              padding: '5px 14px', borderRadius: 7,
                              background: 'none', color: 'var(--ink)',
                              border: '1px solid var(--paper-line)',
                              cursor: 'pointer', fontSize: 13,
                            }}
                          >Cancel</button>
                        </>
                      ) : (
                        <button
                          onClick={() => setConfirmId(snap.id)}
                          style={{
                            padding: '5px 14px', borderRadius: 7,
                            background: '#7c3aed', color: '#fff',
                            border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600,
                          }}
                        >Restore this version</button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div style={{
          padding: '10px 24px', borderTop: '1px solid var(--paper-line)',
          fontSize: 11, color: 'var(--ink-lighter)', textAlign: 'center',
        }}>
          Up to {20} versions are kept · Older versions are removed automatically
        </div>
      </div>
    </div>
  );
}
