import { useState, useRef, useEffect } from 'react';
import { X } from 'lucide-react';

const COLORS = ['#1a1a2e', '#dc2626', '#2563eb', '#15803d', '#d97706', '#7c3aed'];
const SIZES = [
  { label: 'Fine', value: 1 },
  { label: 'Medium', value: 2 },
  { label: 'Thick', value: 4 },
  { label: 'Bold', value: 8 },
];

export default function DrawingCanvas({ onSave, onClose, initialData }) {
  const canvasRef = useRef(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [penColor, setPenColor] = useState(COLORS[0]);
  const [penSize, setPenSize] = useState(2);
  const [erasing, setErasing] = useState(false);
  const lastPos = useRef(null);
  const history = useRef([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    // High-DPI support
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    canvas.style.width = rect.width + 'px';
    canvas.style.height = rect.height + 'px';

    drawBackground(ctx, rect.width, rect.height);

    if (initialData) {
      const img = new Image();
      img.onload = () => {
        ctx.drawImage(img, 0, 0, rect.width, rect.height);
        saveHistory();
      };
      img.src = initialData;
    } else {
      saveHistory();
    }
  }, []);

  const drawBackground = (ctx, w, h) => {
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, w, h);
    // Ruled lines
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 0.5;
    for (let y = 40; y < h; y += 32) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    // Left margin
    ctx.strokeStyle = '#f0c8c8';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(60, 0);
    ctx.lineTo(60, h);
    ctx.stroke();
  };

  const saveHistory = () => {
    const canvas = canvasRef.current;
    history.current.push(canvas.toDataURL());
    if (history.current.length > 30) history.current.shift();
  };

  const undo = () => {
    if (history.current.length < 2) return;
    history.current.pop();
    const last = history.current[history.current.length - 1];
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const img = new Image();
    img.onload = () => {
      ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
      ctx.drawImage(img, 0, 0, canvas.width / dpr, canvas.height / dpr);
    };
    img.src = last;
  };

  const getPos = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const touch = e.touches ? e.touches[0] : e;
    return { x: touch.clientX - rect.left, y: touch.clientY - rect.top };
  };

  const startDraw = (e) => {
    e.preventDefault();
    setIsDrawing(true);
    lastPos.current = getPos(e);
  };

  const draw = (e) => {
    if (!isDrawing) return;
    e.preventDefault();
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const pos = getPos(e);

    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // reset transform for drawing

    if (erasing) {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.lineWidth = penSize * 4;
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.lineWidth = penSize;
    }

    ctx.beginPath();
    ctx.moveTo(lastPos.current.x, lastPos.current.y);
    ctx.lineTo(pos.x, pos.y);
    ctx.strokeStyle = penColor;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.restore();

    lastPos.current = pos;
  };

  const stopDraw = () => {
    if (isDrawing) {
      setIsDrawing(false);
      saveHistory();
    }
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawBackground(ctx, w, h);
    ctx.restore();
    saveHistory();
  };

  const handleSave = () => {
    const canvas = canvasRef.current;
    onSave(canvas.toDataURL('image/png'));
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <div className="canvas-toolbar">
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            {COLORS.map(c => (
              <button
                key={c}
                className={`color-dot ${penColor === c && !erasing ? 'active' : ''}`}
                style={{ background: c }}
                onClick={() => { setPenColor(c); setErasing(false); }}
              />
            ))}
            <select
              value={penSize}
              onChange={e => setPenSize(Number(e.target.value))}
              className="select"
              style={{ width: 'auto', padding: '6px 10px', marginLeft: 8 }}
            >
              {SIZES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
            <button
              className={`btn btn-sm ${erasing ? 'btn-red' : 'btn-outline'}`}
              onClick={() => setErasing(!erasing)}
            >
              {erasing ? 'Erasing' : 'Eraser'}
            </button>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn btn-sm btn-outline" onClick={undo}>Undo</button>
            <button className="btn btn-sm btn-outline" onClick={clearCanvas}>Clear</button>
            <button className="btn btn-sm btn-gold" onClick={handleSave}>Save</button>
            <button className="btn-icon" onClick={onClose}><X size={20} /></button>
          </div>
        </div>
        <canvas
          ref={canvasRef}
          style={{ flex: 1, minHeight: 400, cursor: erasing ? 'cell' : 'crosshair', touchAction: 'none', display: 'block' }}
          onMouseDown={startDraw} onMouseMove={draw} onMouseUp={stopDraw} onMouseLeave={stopDraw}
          onTouchStart={startDraw} onTouchMove={draw} onTouchEnd={stopDraw}
        />
      </div>
    </div>
  );
}
