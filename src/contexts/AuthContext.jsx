import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  getAdditionalUserInfo,
  OAuthProvider,
} from 'firebase/auth';
import { doc, setDoc, getDoc, deleteDoc, collectionGroup, query, where, getDocs } from 'firebase/firestore';
import { auth, db, microsoftProvider } from '../firebase';
import { writeUserDirectory } from '../hooks/useFirestore';
import { addWorkspaceMember } from '../hooks/useWorkspace';

const AuthContext = createContext(null);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

// ─── Keys for persisting the Microsoft access token across page reloads ──────
const MS_TOKEN_KEY        = 'ddiary_ms_access_token';
const MS_TOKEN_EXPIRY_KEY = 'ddiary_ms_token_expiry';
// MS Graph tokens last ~60 min; we treat them as valid for 55 min to allow headroom
const MS_TOKEN_TTL_MS = 55 * 60 * 1000;

/** Read the stored token only if it has not yet expired. */
function readStoredMsToken() {
  const token  = sessionStorage.getItem(MS_TOKEN_KEY);
  const expiry = sessionStorage.getItem(MS_TOKEN_EXPIRY_KEY);
  if (!token || !expiry) return null;
  return Date.now() < parseInt(expiry, 10) ? token : null;
}

export function AuthProvider({ children }) {
  const [user,    setUser]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  // Microsoft access token for Graph API (SharePoint uploads, email)
  const [msToken,       setMsToken]       = useState(() => readStoredMsToken());
  const [msTokenExpiry, setMsTokenExpiry] = useState(() => {
    const expiry = sessionStorage.getItem(MS_TOKEN_EXPIRY_KEY);
    return expiry ? parseInt(expiry, 10) : null;
  });
  const [msRefreshing, setMsRefreshing] = useState(false);

  // ── Persist token + expiry ────────────────────────────────────────────────
  const saveMsToken = useCallback((token) => {
    setMsToken(token);
    if (token) {
      const expiry = Date.now() + MS_TOKEN_TTL_MS;
      setMsTokenExpiry(expiry);
      sessionStorage.setItem(MS_TOKEN_KEY,        token);
      sessionStorage.setItem(MS_TOKEN_EXPIRY_KEY, String(expiry));
    } else {
      setMsTokenExpiry(null);
      sessionStorage.removeItem(MS_TOKEN_KEY);
      sessionStorage.removeItem(MS_TOKEN_EXPIRY_KEY);
    }
  }, []);

  // ── Proactive expiry check every minute ──────────────────────────────────
  // Clears the stored token once it expires so callers get a clean null rather
  // than a stale token that will 401 on the server side.
  useEffect(() => {
    if (!msToken) return;
    const id = setInterval(() => {
      const expiry = sessionStorage.getItem(MS_TOKEN_EXPIRY_KEY);
      if (!expiry || Date.now() >= parseInt(expiry, 10)) {
        saveMsToken(null);
      }
    }, 60_000);
    return () => clearInterval(id);
  }, [msToken, saveMsToken]);

  // ── Derived: is the stored token currently valid? ─────────────────────────
  const isMsTokenValid = useCallback(() => {
    if (!msToken || !msTokenExpiry) return false;
    return Date.now() < msTokenExpiry;
  }, [msToken, msTokenExpiry]);

  // ── Minutes remaining before token expires (for UI warnings) ─────────────
  const msTokenMinutesRemaining = msTokenExpiry
    ? Math.max(0, Math.floor((msTokenExpiry - Date.now()) / 60_000))
    : 0;

  // ── Silent token refresh via Microsoft SSO ────────────────────────────────
  // Microsoft's SSO means signInWithPopup completes instantly (no visible UI)
  // when the user already has an active Azure AD / M365 session in the browser.
  const refreshMsToken = useCallback(async () => {
    if (msRefreshing) return msToken; // already in flight
    setMsRefreshing(true);
    try {
      const result     = await signInWithPopup(auth, microsoftProvider);
      const credential = OAuthProvider.credentialFromResult(result);
      const newToken   = result._tokenResponse?.oauthAccessToken || credential?.accessToken;
      if (newToken) {
        saveMsToken(newToken);
        return newToken;
      }
      return null;
    } catch (err) {
      console.warn('[AuthContext] MS token refresh failed:', err.message);
      return null;
    } finally {
      setMsRefreshing(false);
    }
  }, [msToken, msRefreshing, saveMsToken]);

  // ── Claim any pending_* workspace memberships for this user ─────────────
  // When an admin adds someone from the org directory BEFORE they sign in,
  // a placeholder doc is created: workspaces/{wsId}/members/pending_{email}.
  // On every sign-in we scan for these placeholders and replace them with the
  // user's real Firebase UID so useMyWorkspaces can find them immediately —
  // even if the user never clicked the invite link.
  const claimPendingMemberships = useCallback(async (firebaseUser) => {
    const { uid, email, displayName } = firebaseUser;
    if (!email) return;
    const placeholderUid = `pending_${email.replace(/[^a-zA-Z0-9]/g, '_')}`;
    try {
      const snap = await getDocs(
        query(collectionGroup(db, 'members'), where('uid', '==', placeholderUid))
      );
      await Promise.all(snap.docs.map(async (memberDoc) => {
        const workspaceId = memberDoc.ref.parent.parent?.id;
        if (!workspaceId) return;
        // Write real-UID doc, then remove placeholder
        await addWorkspaceMember(workspaceId, {
          uid, email, displayName: displayName || email,
          role: memberDoc.data().role || 'member',
        });
        await deleteDoc(memberDoc.ref);
      }));
    } catch { /* non-fatal — indexes may not exist yet on first deploy */ }
  }, []);

  // ── Firebase auth state listener ─────────────────────────────────────────
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        // Claim any pending workspace memberships first, then load profile
        await claimPendingMemberships(firebaseUser);

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
  }, [saveMsToken, claimPendingMemberships]);

  // ── Sign in with Microsoft (works for both owner & member) ───────────────
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

  // Join a workspace via ?workspace= link (works for both new & already-signed-in users).
  //
  // Before adding the real UID, we clean up any "pending_*" placeholder doc that was
  // created when an admin added this person from the org directory.  If we didn't do
  // this, the same person would appear twice in the members list and the Assign-to
  // dropdown (once as pending_*, once as their real Firebase UID).
  const joinWorkspace = async (workspaceId) => {
    if (!auth.currentUser) return;
    const { uid, email, displayName } = auth.currentUser;

    // Add real member doc FIRST — this makes isWorkspaceMember() return true so
    // the subsequent placeholder delete (which requires being a member) succeeds.
    await addWorkspaceMember(workspaceId, { uid, email, displayName, role: 'member' });

    // Now clean up the pending_* placeholder (if it exists).
    // We're a member now so the delete is allowed by Firestore rules.
    const placeholderUid = `pending_${email.replace(/[^a-zA-Z0-9]/g, '_')}`;
    try {
      await deleteDoc(doc(db, 'workspaces', workspaceId, 'members', placeholderUid));
    } catch { /* non-fatal */ }
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
      user, loading, error,
      // Token state & helpers
      msToken, msTokenExpiry, msTokenMinutesRemaining, msRefreshing,
      isMsTokenValid, refreshMsToken,
      // Auth actions
      loginWithMicrosoft, logout, updateSettings,
      joinWorkspace, setWorkspaceId,
      setError, isOwner, isMember, isCollaborator,
    }}>
      {children}
    </AuthContext.Provider>
  );
}
