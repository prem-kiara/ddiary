import { useState, useEffect } from 'react';
import { Save, X } from 'lucide-react';

export default function DiaryEditor({ editingEntry, onSave, onCancel, showToast }) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (editingEntry) {
      setTitle(editingEntry.title || '');
      setContent(editingEntry.content || '');
    } else {
      setTitle('');
      setContent('');
    }
  }, [editingEntry]);

  const handleSave = async () => {
    if (!title.trim() && !content.trim()) {
      showToast('Please add a title or some content.', 'warning');
      return;
    }
    setSaving(true);
    try {
      await onSave({
        title: title.trim(),
        content: content.trim(),
      });
      showToast('Entry saved!', 'success');
    } catch (err) {
      showToast('Failed to save entry. Please try again.', 'warning');
    }
    setSaving(false);
  };

  return (
    <div className="fade-in">
      <h2 className="section-title">
        {editingEntry ? 'Edit Entry' : 'New Entry'}
      </h2>

      <div className="card">
        {/* Title */}
        <input
          className="input input-title"
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="Give your entry a title..."
          style={{ marginBottom: 16 }}
        />

        {/* Content */}
        <textarea
          className="textarea"
          value={content}
          onChange={e => setContent(e.target.value)}
          placeholder="Write your thoughts here..."
          style={{
            minHeight: 330,
            fontFamily: 'var(--font-body)',
            fontSize: 15,
          }}
        />

        {/* Action Buttons */}
        <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <button className="btn btn-outline" onClick={onCancel}>
            <X size={16} /> Cancel
          </button>
          <button className="btn btn-teal" onClick={handleSave} disabled={saving}>
            <Save size={16} /> {saving ? 'Saving...' : 'Save Entry'}
          </button>
        </div>
      </div>
    </div>
  );
}
