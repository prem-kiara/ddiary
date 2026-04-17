import { useState, useEffect } from 'react';
import { Save, Mail, Clock, Cloud, Shield, Download, Globe } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

// Common timezones for the selector
const TIMEZONES = [
  { label: 'UTC',                       value: 'UTC' },
  { label: 'London (GMT/BST)',           value: 'Europe/London' },
  { label: 'Paris / Berlin (CET)',       value: 'Europe/Paris' },
  { label: 'Moscow (MSK)',               value: 'Europe/Moscow' },
  { label: 'Dubai (GST)',                value: 'Asia/Dubai' },
  { label: 'Karachi (PKT)',              value: 'Asia/Karachi' },
  { label: 'Mumbai / Delhi (IST)',       value: 'Asia/Kolkata' },
  { label: 'Dhaka (BST)',                value: 'Asia/Dhaka' },
  { label: 'Bangkok (ICT)',              value: 'Asia/Bangkok' },
  { label: 'Singapore / KL (SGT)',       value: 'Asia/Singapore' },
  { label: 'Tokyo / Seoul (JST/KST)',   value: 'Asia/Tokyo' },
  { label: 'Sydney (AEST)',              value: 'Australia/Sydney' },
  { label: 'New Zealand (NZST)',         value: 'Pacific/Auckland' },
  { label: 'Hawaii (HST)',               value: 'Pacific/Honolulu' },
  { label: 'Los Angeles (PT)',           value: 'America/Los_Angeles' },
  { label: 'Denver (MT)',                value: 'America/Denver' },
  { label: 'Chicago (CT)',               value: 'America/Chicago' },
  { label: 'New York (ET)',              value: 'America/New_York' },
  { label: 'São Paulo (BRT)',            value: 'America/Sao_Paulo' },
  { label: 'Buenos Aires (ART)',         value: 'America/Argentina/Buenos_Aires' },
];

export default function SettingsPage({ showToast }) {
  const { user, updateSettings, logout } = useAuth();
  const [email, setEmail] = useState('');
  const [reminderTime, setReminderTime] = useState('09:00');
  const [timezone, setTimezone] = useState('Asia/Kolkata');
  const [emailReminders, setEmailReminders] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (user?.settings) {
      setEmail(user.settings.reminderEmail || user.email || '');
      setReminderTime(user.settings.reminderTime || '09:00');
      setTimezone(user.settings.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
      setEmailReminders(user.settings.emailRemindersEnabled ?? true);
    }
  }, [user]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateSettings({
        reminderEmail: email,
        reminderTime,
        timezone,
        emailRemindersEnabled: emailReminders,
      });
      showToast('Settings saved!', 'success');
    } catch (err) {
      showToast('Failed to save settings', 'warning');
    }
    setSaving(false);
  };

  const exportData = () => {
    // This would export all user data as JSON
    showToast('Export feature: connect to your Firebase to enable data export.', 'info');
  };

  return (
    <div className="fade-in">
      <h2 className="section-title">Settings</h2>

      {/* Account Info */}
      <div className="card">
        <h3 style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Shield size={20} color="#6d28d9" /> Account
        </h3>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
          <div style={{
            width: 48, height: 48, borderRadius: '50%',
            background: 'linear-gradient(135deg, #6d28d9, #7c3aed)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', fontSize: 20, fontWeight: 700
          }}>
            {(user?.displayName || user?.email || '?')[0].toUpperCase()}
          </div>
          <div>
            <div style={{ fontWeight: 600, fontSize: 16 }}>{user?.displayName || 'User'}</div>
            <div style={{ color: '#475569', fontSize: 14 }}>{user?.email}</div>
          </div>
        </div>
      </div>

      {/* Email & Notifications */}
      <div className="card">
        <h3 style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Mail size={20} color="#6d28d9" /> Email & Notifications
        </h3>

        <div className="form-group">
          <label className="label">Reminder Email Address</label>
          <input
            className="input"
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="you@example.com"
          />
          <p style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>
            Pending task reminders will be sent to this address
          </p>
        </div>

        <div className="form-group">
          <label className="label">Daily Reminder Time</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Clock size={18} color="#475569" />
            <input
              className="input"
              type="time"
              value={reminderTime}
              onChange={e => setReminderTime(e.target.value)}
              style={{ maxWidth: 200 }}
            />
          </div>
        </div>

        <div className="form-group">
          <label className="label">Your Timezone</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Globe size={18} color="#475569" />
            <select
              className="select"
              value={timezone}
              onChange={e => setTimezone(e.target.value)}
              style={{ flex: 1 }}
            >
              {TIMEZONES.map(tz => (
                <option key={tz.value} value={tz.value}>{tz.label}</option>
              ))}
            </select>
          </div>
          <p style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>
            Reminders are sent at your chosen time in this timezone
          </p>
        </div>

        <div className="form-group">
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={emailReminders}
              onChange={e => setEmailReminders(e.target.checked)}
              style={{ width: 20, height: 20, accentColor: '#6d28d9' }}
            />
            <span style={{ fontSize: 15 }}>Enable automatic daily email reminders</span>
          </label>
        </div>

        <button className="btn btn-gold" onClick={handleSave} disabled={saving}>
          <Save size={16} /> {saving ? 'Saving...' : 'Save Settings'}
        </button>
      </div>

      {/* Cloud Sync */}
      <div className="card">
        <h3 style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Cloud size={20} color="#6d28d9" /> Cloud Sync
        </h3>
        <p style={{ color: '#475569', marginBottom: 16, lineHeight: 1.6 }}>
          Your diary is synced across all your devices — iPad, Mac, iPhone, and Android —
          in real-time through Firebase. Any changes you make on one device will appear
          instantly on all others.
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', background: '#d4edda', borderRadius: 8 }}>
          <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#15803d' }} />
          <span style={{ color: '#15803d', fontWeight: 600, fontSize: 14 }}>Sync Active</span>
        </div>
      </div>

      {/* Data Management */}
      <div className="card">
        <h3 style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Download size={20} color="#6d28d9" /> Data Management
        </h3>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button className="btn btn-outline" onClick={exportData}>
            <Download size={16} /> Export All Data
          </button>
        </div>
      </div>

      {/* About */}
      <div className="card" style={{ background: '#f1f5f9' }}>
        <h3 style={{ marginBottom: 8, fontSize: 16 }}>About Digital Diary</h3>
        <p style={{ color: '#475569', lineHeight: 1.6, fontSize: 14 }}>
          Version 1.0.0 — Your personal space for thoughts, tasks, and creativity.
          Works on all devices through your web browser. Install as an app on your
          home screen for the best experience. Supports Apple Pencil, stylus, and touch input.
        </p>
      </div>

      {/* Sign Out */}
      <div style={{ textAlign: 'center', marginTop: 8 }}>
        <button className="btn btn-outline" onClick={logout} style={{ color: '#dc2626', borderColor: '#dc2626' }}>
          Sign Out
        </button>
      </div>
    </div>
  );
}
