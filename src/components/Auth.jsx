import { useState, useEffect } from 'react';
import { BookOpen, Mail, Lock, User, Users } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

export default function Auth() {
  const { login, signup, signupAsMember, linkToTeam, resetPassword, error, setError } = useAuth();

  // Detect ?join=OWNER_UID in the URL — if present this is a team-member signup
  // Keep joinParam in state so it survives the URL cleanup
  const [joinParam] = useState(() => new URLSearchParams(window.location.search).get('join'));
  const isMemberSignup = !!joinParam;

  const [mode,       setMode]       = useState(isMemberSignup ? 'signup' : 'login');
  const [email,      setEmail]      = useState('');
  const [password,   setPassword]   = useState('');
  const [name,       setName]       = useState('');
  const [loading,    setLoading]    = useState(false);
  const [resetSent,  setResetSent]  = useState(false);

  // Keep URL clean after reading the param
  useEffect(() => {
    if (joinParam) {
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [joinParam]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      if (mode === 'login') {
        await login(email, password);
        // If logging in via a join link, patch their profile to link them to the team
        if (joinParam) {
          await linkToTeam(joinParam);
        }
      } else if (mode === 'signup') {
        if (isMemberSignup) {
          await signupAsMember(email, password, name, joinParam);
        } else {
          await signup(email, password, name);
        }
      } else {
        await resetPassword(email);
        setResetSent(true);
      }
    } catch {
      // error is set in context
    }
    setLoading(false);
  };

  const switchMode = (newMode) => {
    setMode(newMode);
    setError(null);
    setResetSent(false);
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
          {mode === 'login'  && 'Welcome back. Sign in to continue.'}
          {mode === 'signup' && (isMemberSignup
            ? "You've been invited to collaborate on tasks. Create your account below."
            : 'Create your personal diary account.')}
          {mode === 'reset'  && 'Reset your password.'}
        </p>

        {error && <div className="auth-error">{error}</div>}
        {resetSent && (
          <div className="card" style={{ background: '#d4edda', color: '#27ae60', textAlign: 'center', marginBottom: 16 }}>
            Password reset email sent! Check your inbox.
          </div>
        )}

        <form onSubmit={handleSubmit}>
          {mode === 'signup' && (
            <div className="form-group">
              <label className="label">Your Name</label>
              <div style={{ position: 'relative' }}>
                <User size={18} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: '#b5a898' }} />
                <input
                  className="input" style={{ paddingLeft: 42 }}
                  type="text" placeholder="Jane Doe"
                  value={name} onChange={e => setName(e.target.value)} required
                />
              </div>
            </div>
          )}

          <div className="form-group">
            <label className="label">Email Address</label>
            <div style={{ position: 'relative' }}>
              <Mail size={18} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: '#b5a898' }} />
              <input
                className="input" style={{ paddingLeft: 42 }}
                type="email" placeholder="you@example.com"
                value={email} onChange={e => setEmail(e.target.value)} required
              />
            </div>
          </div>

          {mode !== 'reset' && (
            <div className="form-group">
              <label className="label">Password</label>
              <div style={{ position: 'relative' }}>
                <Lock size={18} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: '#b5a898' }} />
                <input
                  className="input" style={{ paddingLeft: 42 }}
                  type="password" placeholder="••••••••"
                  value={password} onChange={e => setPassword(e.target.value)}
                  required minLength={6}
                />
              </div>
            </div>
          )}

          <button
            className={`btn ${isMemberSignup ? 'btn-teal' : 'btn-gold'}`}
            type="submit" disabled={loading}
            style={{ width: '100%', justifyContent: 'center', marginTop: 8, fontSize: 16, padding: 14 }}
          >
            {loading
              ? 'Please wait...'
              : mode === 'login'  ? 'Sign In'
              : mode === 'signup' ? (isMemberSignup ? 'Create Team Account' : 'Create Account')
              : 'Send Reset Link'}
          </button>
        </form>

        {mode === 'login' && (
          <>
            <div style={{ textAlign: 'right', marginTop: 10 }}>
              <button className="auth-link" onClick={() => switchMode('reset')} style={{ fontSize: 13 }}>
                Forgot password?
              </button>
            </div>
            {!isMemberSignup && (
              <>
                <div className="auth-divider">Don't have an account?</div>
                <button className="btn btn-outline" onClick={() => switchMode('signup')} style={{ width: '100%', justifyContent: 'center' }}>
                  Create Account
                </button>
              </>
            )}
          </>
        )}

        {mode === 'signup' && (
          <div className="auth-divider">
            Already have an account?{' '}
            <button className="auth-link" onClick={() => switchMode('login')}>
              {isMemberSignup ? 'Sign in to link your account' : 'Sign In'}
            </button>
          </div>
        )}

        {mode === 'reset' && (
          <div className="auth-divider">
            <button className="auth-link" onClick={() => switchMode('login')}>Back to Sign In</button>
          </div>
        )}
      </div>
    </div>
  );
}
