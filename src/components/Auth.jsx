import { useState, useEffect } from 'react';
import { BookOpen, Users, Layout } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

export default function Auth() {
  const { loginWithMicrosoft, joinWorkspace, error, setError } = useAuth();

  // Detect invite params from URL
  const [joinParam]      = useState(() => new URLSearchParams(window.location.search).get('join'));
  const [workspaceParam] = useState(() => new URLSearchParams(window.location.search).get('workspace'));

  const isMemberSignup      = !!joinParam;
  const isWorkspaceInvite   = !!workspaceParam;
  const isInviteFlow        = isMemberSignup || isWorkspaceInvite;

  const [loading, setLoading] = useState(false);

  // Keep URL clean after reading the params
  useEffect(() => {
    if (isInviteFlow) {
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [isInviteFlow]);

  const handleMicrosoftLogin = async () => {
    setLoading(true);
    setError(null);
    try {
      await loginWithMicrosoft(isMemberSignup ? joinParam : null);
      // After login, if workspace invite, join that workspace
      if (workspaceParam) {
        await joinWorkspace(workspaceParam);
      }
    } catch {
      // error is set in context
    }
    setLoading(false);
  };

  return (
    <div className="auth-container">
      <div className="auth-card fade-in">
        <div style={{ textAlign: 'center', marginBottom: 8 }}>
          {isWorkspaceInvite
            ? <Layout size={40} color="#8e44ad" />
            : isMemberSignup
              ? <Users size={40} color="#2a9d8f" />
              : <BookOpen size={40} color="#8B6914" />}
        </div>

        <h1 className="auth-title">
          {isWorkspaceInvite ? 'Join Workspace' : isMemberSignup ? 'Join the Team' : 'My Digital Diary'}
        </h1>

        <p className="auth-subtitle">
          {isWorkspaceInvite
            ? "You've been invited to a shared workspace. Sign in with your Microsoft account to start collaborating."
            : isMemberSignup
              ? "You've been invited to collaborate on tasks. Sign in with your Microsoft account."
              : 'Sign in with your organization Microsoft account.'}
        </p>

        {error && <div className="auth-error">{error}</div>}

        <button
          className={`btn ${isWorkspaceInvite ? 'btn-purple' : isMemberSignup ? 'btn-teal' : 'btn-gold'}`}
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
