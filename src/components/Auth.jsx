import { useState, useEffect } from 'react';
import { BookOpen, Users } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

export default function Auth() {
  const { loginWithMicrosoft, error, setError } = useAuth();

  // Detect ?join=OWNER_UID in the URL — if present this is a team-member signup
  const joinParam = new URLSearchParams(window.location.search).get('join');
  const isMemberSignup = !!joinParam;

  const [loading, setLoading] = useState(false);

  // Keep URL clean after reading the param
  useEffect(() => {
    if (joinParam) {
      const clean = window.location.pathname;
      window.history.replaceState({}, '', clean);
    }
  }, [joinParam]);

  const handleMicrosoftLogin = async () => {
    setLoading(true);
    setError(null);
    try {
      await loginWithMicrosoft(isMemberSignup ? joinParam : null);
    } catch {
      // error is set in context
    }
    setLoading(false);
  };

  return (
    <div className="auth-container">
      <div className="auth-card fade-in">
        <div style={{ textAlign: 'center', marginBottom: 8 }}>
          {isMemberSignup
            ? <Users size={40} color="#2a9d8f" />
            : <BookOpen size={40} color="#8B6914" />}
        </div>

        <h1 className="auth-title">
          {isMemberSignup ? 'Join the Team' : 'My Digital Diary'}
        </h1>

        <p className="auth-subtitle">
          {isMemberSignup
            ? "You've been invited to collaborate on tasks. Sign in with your Microsoft account."
            : 'Sign in with your organization Microsoft account.'}
        </p>

        {error && <div className="auth-error">{error}</div>}

        <button
          className={`btn ${isMemberSignup ? 'btn-teal' : 'btn-gold'}`}
          onClick={handleMicrosoftLogin}
          disabled={loading}
          style={{
            width: '100%',
            justifyContent: 'center',
            marginTop: 16,
            fontSize: 16,
            padding: 14,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <svg width="20" height="20" viewBox="0 0 21 21" fill="none">
            <rect x="1" y="1" width="9" height="9" fill="#F25022"/>
            <rect x="11" y="1" width="9" height="9" fill="#7FBA00"/>
            <rect x="1" y="11" width="9" height="9" fill="#00A4EF"/>
            <rect x="11" y="11" width="9" height="9" fill="#FFB900"/>
          </svg>
          {loading ? 'Signing in...' : 'Sign in with Microsoft'}
        </button>

        <p style={{ textAlign: 'center', marginTop: 20, fontSize: 13, color: '#999' }}>
          Uses your organization's Microsoft 365 account
        </p>
      </div>
    </div>
  );
}
