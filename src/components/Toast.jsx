import { useEffect } from 'react';
import { Bell, X, CheckCircle, AlertTriangle } from 'lucide-react';

export default function Toast({ message, type = 'info', onClose }) {
  useEffect(() => {
    const t = setTimeout(onClose, 4000);
    return () => clearTimeout(t);
  }, [onClose]);

  const icons = {
    info:    <Bell           size={18} className="text-violet-300" />,
    success: <CheckCircle    size={18} className="text-emerald-300" />,
    warning: <AlertTriangle  size={18} className="text-amber-300" />,
  };

  return (
    <div className="toast">
      {icons[type] || icons.info}
      <span style={{ flex: 1 }}>{message}</span>
      <button className="btn-icon" onClick={onClose} style={{ color: 'rgba(255,255,255,0.7)' }}>
        <X size={16} />
      </button>
    </div>
  );
}
