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

  // Per-flow tint. Default is violet (workspace); invites use indigo/emerald so
  // users visually notice they're joining someone else's space.
  const flow = isWorkspaceInvite
    ? { icon: Layout,   iconBg: 'bg-indigo-100',  iconColor: 'text-indigo-600',  btn: 'btn-blue', title: 'Join Workspace',   subtitle: "You've been invited to a shared workspace. Sign in with your Microsoft account to start collaborating." }
    : isMemberSignup
    ? { icon: Users,    iconBg: 'bg-emerald-100', iconColor: 'text-emerald-600', btn: 'btn-gold', title: 'Join the Team',    subtitle: "You've been invited to collaborate on tasks. Sign in with your Microsoft account." }
    : { icon: BookOpen, iconBg: 'bg-violet-100',  iconColor: 'text-violet-600',  btn: 'btn-gold', title: 'Dhanam Workspace', subtitle: "Sign in with your organization Microsoft account." };

  const Icon = flow.icon;

  return (
    <div className="auth-container">
      <div className="auth-card fade-in">
        <div className="flex justify-center mb-3">
          <div className={`w-14 h-14 rounded-2xl ${flow.iconBg} ${flow.iconColor} flex items-center justify-center`}>
            <Icon size={28} strokeWidth={2} />
          </div>
        </div>

        <h1 className="auth-title">{flow.title}</h1>
        <p className="auth-subtitle">{flow.subtitle}</p>

        {error && <div className="auth-error">{error}</div>}

        <button
          className={`btn ${flow.btn}`}
          onClick={handleMicrosoftLogin}
          disabled={loading}
          style={{
            width: '100%',
            justifyContent: 'center',
            marginTop: 8,
            fontSize: 15,
            padding: 12,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <svg width="18" height="18" viewBox="0 0 21 21" fill="none">
            <rect x="1" y="1" width="9" height="9" fill="#F25022"/>
            <rect x="11" y="1" width="9" height="9" fill="#7FBA00"/>
            <rect x="1" y="11" width="9" height="9" fill="#00A4EF"/>
            <rect x="11" y="11" width="9" height="9" fill="#FFB900"/>
          </svg>
          {loading ? 'Signing in...' : 'Sign in with Microsoft'}
        </button>

        <p className="text-center mt-5 text-xs text-slate-400">
          Uses your organization's Microsoft 365 account
        </p>
      </div>
    </div>
  );
}
