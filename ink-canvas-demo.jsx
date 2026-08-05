/**
 * Dev harness for the full-page handwritten note (InkCanvasPage).
 *
 * The component takes plain props and touches no Firebase, so it can be
 * mounted standalone — which lets the multi-page save/reload round trip be
 * verified without a Microsoft sign-in.
 */
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import InkCanvasPage from './src/components/InkCanvasPage';
import { ConfirmProvider } from './src/contexts/ConfirmContext';
import { AuthProvider } from './src/contexts/AuthContext';
import './src/styles/diary.css';

function Harness() {
  const [saved, setSaved] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [entry, setEntry] = useState(null);

  const showToast = (msg, kind) => {
    window.__toasts = [...(window.__toasts || []), { msg, kind }];
    // eslint-disable-next-line no-console
    console.log('[toast]', kind, msg);
  };

  const onSave = async (data) => {
    setSaved(data);
    window.__saved = data;
    return true;
  };

  return (
    <div style={{ padding: 12 }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 10, alignItems: 'center' }}>
        <strong style={{ fontSize: 13 }}>Canvas harness</strong>
        <button
          className="btn btn-sm btn-outline"
          onClick={() => { setEntry(saved); setReloadKey(k => k + 1); }}
          disabled={!saved}
        >
          Reload from saved content (simulates reopening the note)
        </button>
        <span style={{ fontSize: 12, color: '#475569' }}>
          {saved ? `saved: ${saved.content.length} bytes · kind=${saved.kind}` : 'not saved yet'}
        </span>
      </div>

      <InkCanvasPage
        key={reloadKey}
        editingEntry={entry}
        onSave={onSave}
        onCancel={() => console.log('cancel')}
        showToast={showToast}
      />
    </div>
  );
}

// Real providers — the canvas uses useConfirm (page delete) and useAuth
// (snapshot authorship). Firebase has placeholder config here, which is fine:
// nothing in this harness signs in or writes.
createRoot(document.getElementById('root')).render(
  <AuthProvider>
    <ConfirmProvider>
      <Harness />
    </ConfirmProvider>
  </AuthProvider>
);
