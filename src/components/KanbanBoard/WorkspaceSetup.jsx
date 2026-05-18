import { useState } from 'react';
import { Plus, X, Briefcase } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { createWorkspace, addWorkspaceTask } from '../../hooks/useWorkspace';
import { logError } from '../../utils/errorLogger';

// ── Workspace Setup (first workspace creation) ────────────────────────────────
function WorkspaceSetup({ onCreated, onCancel, showToast, title }) {
  const { user } = useAuth();
  const [name,       setName]       = useState('');
  const [catName,    setCatName]    = useState('');
  const [subCatName, setSubCatName] = useState('');
  const [taskText,   setTaskText]   = useState('');
  const [creating,   setCreating]   = useState(false);
  const [errorMsg,   setErrorMsg]   = useState('');
  const [step,       setStep]       = useState(1);

  const handleCreate = async () => {
    if (!name.trim()) return;
    setCreating(true);
    setErrorMsg('');
    try {
      const id = await createWorkspace(
        user.uid, user.email, user.displayName || user.email, name.trim(),
        catName.trim() ? { name: catName.trim(), subcategoryName: subCatName.trim() || null } : null,
      );
      if (taskText.trim()) {
        await addWorkspaceTask(id, {
          text: taskText.trim(), status: 'open', priority: 'high',
          dueDate: null, assigneeUid: null, assigneeEmail: null, assigneeName: null,
        }, { uid: user.uid, displayName: user.displayName || user.email, email: user.email });
      }
      if (showToast) showToast(`Workspace "${name.trim()}" created!`, 'success');
      await onCreated(id);
    } catch (e) {
      logError(e, { location: 'KanbanBoard:WorkspaceSetup', action: 'createWorkspace' }, user.uid);
      const msg = e.message || 'Failed to create workspace. Please try again.';
      setErrorMsg(msg);
      if (showToast) showToast(msg, 'warning');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="card" style={{ padding: 32, maxWidth: 480, marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Briefcase size={18} color="#7c3aed" />
          <span style={{ fontWeight: 700, fontSize: 16, color: '#0f172a' }}>{title || 'New Workspace'}</span>
        </div>
        {onCancel && (
          <button onClick={onCancel} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#475569' }}>
            <X size={18} />
          </button>
        )}
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 20, alignItems: 'center', flexWrap: 'wrap' }}>
        {[
          { n: 1, label: 'Name workspace' },
          { n: 2, label: 'Category (optional)' },
          { n: 3, label: 'First task (optional)' },
        ].map(({ n, label }) => (
          <div key={n} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{
              width: 22, height: 22, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 11, fontWeight: 700,
              background: step >= n ? '#7c3aed' : '#e2e8f0',
              color: step >= n ? '#fff' : '#475569',
            }}>{n}</div>
            <span style={{ fontSize: 12, color: step >= n ? '#7c3aed' : '#94a3b8', fontWeight: step === n ? 700 : 400 }}>{label}</span>
            {n < 3 && <div style={{ width: 20, height: 1, background: step > n ? '#7c3aed' : '#e2e8f0', margin: '0 2px' }} />}
          </div>
        ))}
      </div>

      {step === 1 && (
        <>
          <input className="input" placeholder="e.g. KMCL Operations, Collections Team…"
            value={name} onChange={e => { setName(e.target.value); setErrorMsg(''); }}
            onKeyDown={e => e.key === 'Enter' && name.trim() && setStep(2)}
            autoFocus style={{ marginBottom: 12 }}
          />
          {errorMsg && (
            <div style={{ background: '#fdf0f0', border: '1px solid #f5c6c6', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#dc2626', marginBottom: 10, display: 'flex', gap: 8 }}>
              <span>⚠️</span><span>{errorMsg}</span>
            </div>
          )}
          <button className="btn btn-teal" onClick={() => name.trim() && setStep(2)} disabled={!name.trim()} style={{ justifyContent: 'center', width: '100%' }}>
            Continue →
          </button>
        </>
      )}

      {step === 2 && (
        <>
          <label className="label" style={{ marginTop: 0 }}>Category (optional)</label>
          <input className="input" placeholder="e.g. Credit & Underwriting"
            value={catName} onChange={e => setCatName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && setStep(3)}
            autoFocus style={{ marginBottom: 12 }}
          />
          <label className="label">Sub-category (optional)</label>
          <input className="input" placeholder="e.g. Retail"
            value={subCatName} onChange={e => setSubCatName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && setStep(3)}
            disabled={!catName.trim()}
            style={{ marginBottom: 16 }}
          />
          <p style={{ fontSize: 11, color: '#94a3b8', marginTop: -8, marginBottom: 16 }}>
            You can add more categories and sub-categories later from the board.
          </p>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-outline" onClick={() => setStep(1)} style={{ flex: 1, justifyContent: 'center' }}>← Back</button>
            <button className="btn btn-teal" onClick={() => setStep(3)} style={{ flex: 2, justifyContent: 'center' }}>
              Continue →
            </button>
          </div>
        </>
      )}

      {step === 3 && (
        <>
          <textarea className="input" placeholder="e.g. Review pending loan applications… (optional)"
            value={taskText} onChange={e => setTaskText(e.target.value)}
            rows={3} autoFocus style={{ marginBottom: 16, resize: 'vertical', lineHeight: 1.6 }}
          />
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-outline" onClick={() => setStep(2)} style={{ flex: 1, justifyContent: 'center' }}>← Back</button>
            <button className="btn btn-teal" onClick={handleCreate} disabled={creating} style={{ flex: 2, justifyContent: 'center' }}>
              {creating ? 'Creating…' : <><Plus size={15} /> {taskText.trim() ? 'Create & Add Task' : 'Create Workspace'}</>}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export default WorkspaceSetup;
