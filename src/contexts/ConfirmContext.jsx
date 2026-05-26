/**
 * ConfirmContext
 *
 * Provides a Promise-based `confirm(message, options?)` function that renders
 * a branded in-app modal instead of the browser's `window.confirm()`.
 *
 * Usage:
 *   const confirm = useConfirm();
 *   if (await confirm('Delete this item?', { danger: true })) { ... }
 *
 * Options:
 *   title   {string}  — optional heading (defaults to "Are you sure?")
 *   danger  {boolean} — red confirm button for destructive actions
 *   okText  {string}  — label for the confirm button (default: "OK")
 */
import { createContext, useCallback, useContext, useRef, useState } from 'react';

const ConfirmCtx = createContext(null);

export function ConfirmProvider({ children }) {
  const [dialog, setDialog] = useState({
    open:    false,
    message: '',
    title:   '',
    danger:  false,
    okText:  'OK',
  });
  const resolveRef = useRef(null);

  const confirm = useCallback((message, { title = '', danger = false, okText = 'OK' } = {}) => {
    return new Promise((resolve) => {
      resolveRef.current = resolve;
      setDialog({ open: true, message, title, danger, okText });
    });
  }, []);

  const close = (result) => {
    setDialog(d => ({ ...d, open: false }));
    resolveRef.current?.(result);
    resolveRef.current = null;
  };

  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      {dialog.open && (
        <ConfirmModal
          title={dialog.title}
          message={dialog.message}
          danger={dialog.danger}
          okText={dialog.okText}
          onOk={()    => close(true)}
          onCancel={() => close(false)}
        />
      )}
    </ConfirmCtx.Provider>
  );
}

export function useConfirm() {
  const ctx = useContext(ConfirmCtx);
  if (!ctx) throw new Error('useConfirm must be used inside <ConfirmProvider>');
  return ctx;
}

// ─── Modal UI ────────────────────────────────────────────────────────────────
function ConfirmModal({ title, message, danger, okText, onOk, onCancel }) {
  // Split message on \n so multi-line strings render correctly
  const lines = (message || '').split('\n');

  return (
    <div
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.45)',
        zIndex: 2000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onMouseDown={e => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div
        style={{
          background: 'var(--paper)',
          borderRadius: 14,
          boxShadow: '0 8px 40px rgba(0,0,0,0.22)',
          width: '90%', maxWidth: 420,
          overflow: 'hidden',
          fontFamily: 'var(--font-body)',
        }}
        onMouseDown={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ padding: '20px 24px 0' }}>
          {danger ? (
            <div style={{
              width: 40, height: 40, borderRadius: '50%',
              background: '#fee2e2',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              marginBottom: 12,
            }}>
              <span style={{ fontSize: 20 }}>⚠️</span>
            </div>
          ) : (
            <div style={{
              width: 40, height: 40, borderRadius: '50%',
              background: '#ede9fe',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              marginBottom: 12,
            }}>
              <span style={{ fontSize: 20 }}>💬</span>
            </div>
          )}
          <div style={{
            fontWeight: 700, fontSize: 15,
            color: 'var(--ink)', marginBottom: 8,
          }}>
            {title || (danger ? 'Confirm action' : 'Are you sure?')}
          </div>
          <div style={{ fontSize: 13, color: 'var(--ink-light)', lineHeight: 1.6 }}>
            {lines.map((l, i) => (
              <span key={i}>{l}{i < lines.length - 1 && <br />}</span>
            ))}
          </div>
        </div>

        {/* Footer buttons */}
        <div style={{
          display: 'flex', gap: 10, justifyContent: 'flex-end',
          padding: '20px 24px',
        }}>
          <button
            onClick={onCancel}
            style={{
              padding: '8px 18px', borderRadius: 8, cursor: 'pointer',
              border: '1px solid var(--paper-line)',
              background: 'none', color: 'var(--ink)',
              fontSize: 13, fontFamily: 'var(--font-body)', fontWeight: 500,
            }}
          >
            Cancel
          </button>
          <button
            autoFocus
            onClick={onOk}
            style={{
              padding: '8px 18px', borderRadius: 8, cursor: 'pointer',
              border: 'none',
              background: danger ? '#dc2626' : '#7c3aed',
              color: '#fff',
              fontSize: 13, fontFamily: 'var(--font-body)', fontWeight: 600,
            }}
          >
            {okText}
          </button>
        </div>
      </div>
    </div>
  );
}
