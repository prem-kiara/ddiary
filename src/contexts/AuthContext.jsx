import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  getAdditionalUserInfo,
  OAuthProvider,
} from 'firebase/auth';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import { auth, db, microsoftProvider } from '../firebase';
import { writeUserDirectory } from '../hooks/useFirestore';
import { addWorkspaceMember } from '../hooks/useWorkspace';

const AuthContext = createContext(null);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

// ─── Key for persisting the Microsoft access token across page reloads ───────
const MS_TOKEN_KEY = 'ddiary_ms_access_token';

export function AuthProvider({ children }) {
  const [user,    setUser]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  // Microsoft access token for Graph API (SharePoint uploads)
  const [msToken, setMsToken] = useState(() => sessionStorage.getItem(MS_TOKEN_KEY));

  const saveMsToken = useCallback((token) => {
    setMsToken(token);
    if (token) sessionStorage.setItem(MS_TOKEN_KEY, token);
    else       sessionStorage.removeItem(MS_TOKEN_KEY);
  }, []);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        const profileRef  = doc(db, 'users', firebaseUser.uid);
        const profileSnap = await getDoc(profileRef).catch(() => null);
        setUser({
          uid:         firebaseUser.uid,
          email:       firebaseUser.email,
          displayName: firebaseUser.displayName,
          ...(profileSnap?.exists() ? profileSnap.data() : {}),
        });
      } else {
        setUser(null);
        saveMsToken(null);
      }
      setLoading(false);
    });
    return unsub;
  }, [saveMsToken]);

  // ── Sign in with Microsoft (works for both owner & member) ────────────────
  const loginWithMicrosoft = async (ownerUid = null) => {
    setError(null);
    try {
      const result = await signInWithPopup(auth, microsoftProvider);
      const credential = OAuthProvider.credentialFromResult(result);

      // Persist the Microsoft access token for Graph API calls (SharePoint)
      const accessToken = result._tokenResponse?.oauthAccessToken
                       || credential?.accessToken;
      if (accessToken) saveMsToken(accessToken);

      const firebaseUser = result.user;
      const additionalInfo = getAdditionalUserInfo(result);
      const isNewUser = additionalInfo?.isNewUser;

      if (isNewUser) {
        // First time this Microsoft user signs in — create their Firestore profile
        // Everyone gets full 'owner' access (their own diary, tasks, etc.)
        const role = 'owner';
        const profileData = {
          email:       firebaseUser.email,
          displayName: firebaseUser.displayName,
          role,
          ...(ownerUid ? { invitedBy: ownerUid } : {}),
          createdAt:   new Date().toISOString(),
          settings: {
            reminderEmail:         firebaseUser.email,
            reminderTime:          '09:00',
            timezone:              Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
            emailRemindersEnabled: role === 'owner',
            theme:                 'warm',
          },
        };

        await setDoc(doc(db, 'users', firebaseUser.uid), profileData);

        // If joining as member, write to userDirectory so owner can discover them
        if (ownerUid) {
          await writeUserDirectory(firebaseUser.uid, {
            email:       firebaseUser.email,
            displayName: firebaseUser.displayName,
            invitedBy:   ownerUid,
          });
        }
      }

      return firebaseUser;
    } catch (err) {
      setError(err.message);
      throw err;
    }
  };

  const logout = async () => {
    saveMsToken(null);
    await signOut(auth);
  };

  const updateSettings = async (settings) => {
    if (!user) return;
    const ref = doc(db, 'users', user.uid);
    await setDoc(ref, { settings }, { merge: true });
    setUser(prev => ({ ...prev, settings }));
  };

  // Existing user joins a workspace via ?workspace= link
  const joinWorkspace = async (workspaceId) => {
    if (!auth.currentUser) return;
    const { uid, email, displayName } = auth.currentUser;
    await addWorkspaceMember(workspaceId, { uid, email, displayName, role: 'member' });
  };

  // Called after owner creates a workspace (kept for backward compat)
  const setWorkspaceId = async (workspaceId) => {
    // No-op now — workspaces are discovered via collection-group query on members
    // The creator is already added as a member in createWorkspace()
  };

  // Convenience booleans derived from role
  const isOwner        = !user?.role || user.role === 'owner';
  const isMember       = user?.role === 'member';
  const isCollaborator = user?.role === 'collaborator';

  return (
    <AuthContext.Provider value={{
      user, loading, error, msToken,
      loginWithMicrosoft, logout, updateSettings,
      joinWorkspace, setWorkspaceId,
      setError, isOwner, isMember, isCollaborator,
    }}>
      {children}
    </AuthContext.Provider>
  );
}
