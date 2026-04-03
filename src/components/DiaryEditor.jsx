import { useState, useEffect } from 'react';
import { PenTool, Upload, Save, X } from 'lucide-react';
import DrawingCanvas from './DrawingCanvas';
import ImageOCR from './ImageOCR';

const MOODS = {
  happy: '😊', sad: '😢', neutral: '😐',
  excited: '🤩', thoughtful: '🤔', tired: '😴',
  grateful: '🙏', anxious: '😰', calm: '🧘',
};

export default function DiaryEditor({ editingEntry, onSave, onCancel, showToast }) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [mood, setMood] = useState('neutral');
  const [drawings, setDrawings] = useState([]);
  const [showDrawing, setShowDrawing] = useState(false);
  const [showOCR, setShowOCR] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (editingEntry) {
      setTitle(editingEntry.title || '');
      setContent(editingEntry.content || '');
      setMood(editingEntry.mood || 'neutral');
      setDrawings(editingEntry.drawings || []);
    } else {
      setTitle('');
      setContent('');
      setMood('neutral');
      setDrawings([]);
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
        mood,
        drawings,
      });
      showToast('Entry saved!', 'success');
    } catch (err) {
      showToast('Failed to save entry. Please try again.', 'warning');
    }
    setSaving(false);
  };

  const handleDrawingSave = (dataUrl) => {
    setDrawings(prev => [...prev, dataUrl]);
    setShowDrawing(false);
    showToast('Drawing added!', 'success');
  };

  const handleOCRText = (text) => {
    setContent(prev => prev ? prev + '\n\n' + text : text);
    showToast('Text extracted and added!', 'success');
  };

  const removeDrawing = (index) => {
    setDrawings(prev => prev.filter((_, i) => i !== index));
  };

  return (
    <div className="fade-in">
      {showDrawing && <DrawingCanvas onSave={handleDrawingSave} onClose={() => setShowDrawing(false)} />}
      {showOCR && <ImageOCR onTextExtracted={handleOCRText} onClose={() => setShowOCR(false)} />}

      <h2 className="section-title">
        {editingEntry ? 'Edit Entry' : 'New Entry'}
      </h2>

      <div className="card">
        {/* Mood Selector */}
        <div style={{ marginBottom: 16 }}>
          <label className="label">How are you feeling?</label>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {Object.entries(MOODS).map(([key, emoji]) => (
              <button
                key={key}
                className={`mood-btn ${mood === key ? 'active' : ''}`}
                onClick={() => setMood(key)}
              >
                {emoji} <span className="mood-label">{key}</span>
              </button>
            ))}
          </div>
        </div>

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
        />

        {/* Drawing Thumbnails */}
        {drawings.length > 0 && (
          <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {drawings.map((d, i) => (
              <div key={i} style={{ position: 'relative' }}>
                <img
                  src={d}
                  alt={`Drawing ${i + 1}`}
                  style={{ width: 80, height: 80, borderRadius: 8, objectFit: 'cover', border: '1px solid #e8d5b7' }}
                />
                <button
                  onClick={() => removeDrawing(i)}
                  style={{
                    position: 'absolute', top: -6, right: -6,
                    width: 22, height: 22, borderRadius: '50%',
                    background: '#c0392b', color: '#fff',
                    border: 'none', cursor: 'pointer', fontSize: 13,
                    display: 'flex', alignItems: 'center', justifyContent: 'center'
                  }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Action Buttons */}
        <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
          <button className="btn btn-leather" onClick={() => setShowDrawing(true)}>
            <PenTool size={16} /> Draw / Handwrite
          </button>
          <button className="btn btn-blue" onClick={() => setShowOCR(true)}>
            <Upload size={16} /> Upload Notes (OCR)
          </button>
          <div style={{ flex: 1 }} />
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
