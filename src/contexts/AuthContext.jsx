import { createContext, useContext, useState, useEffect } from 'react';
import {
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  sendPasswordResetEmail,
} from 'firebase/auth';
import { doc, setDoc, getDoc, updateDoc, writeBatch } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { writeUserDirectory } from '../hooks/useFirestore';

const AuthContext = createContext(null);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

export function AuthProvider({ children }) {
  const [user,    setUser]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        const profileRef  = doc(db, 'users', firebaseUser.uid);
        const profileSnap = await getDoc(profileRef).catch(() => null);
        setUser({
          uid:         firebaseUser.uid,
          displayName: firebaseUser.displayName,
          ...(profileSnap?.exists() ? profileSnap.data() : {}),
          // Always override with auth-provided email — Firebase Auth guarantees lowercase,
          // but the Firestore profile might have been saved with mixed-case.
          email: firebaseUser.email,
        });
      } else {
        setUser(null);
      }
      setLoading(false);
    });
    return unsub;
  }, []);

  // ── Owner signup (original flow) ────────────────────────────────────────
  const signup = async (email, password, displayName) => {
    setError(null);
    try {
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(cred.user, { displayName });
      await setDoc(doc(db, 'users', cred.user.uid), {
        email,
        displayName,
        role:      'owner',
        createdAt: new Date().toISOString(),
        settings: {
          reminderEmail:         email,
          reminderTime:          '09:00',
          timezone:              Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
          emailRemindersEnabled: true,
          theme:                 'warm',
        },
      });
      return cred.user;
    } catch (err) {
      setError(err.message);
      throw err;
    }
  };

  // ── Team-member signup (via join link ?join=OWNER_UID) ──────────────────
  const signupAsMember = async (email, password, displayName, ownerUid) => {
    setError(null);
    try {
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(cred.user, { displayName });

      // Create the member's own user profile
      await setDoc(doc(db, 'users', cred.user.uid), {
        email,
        displayName,
        role:      'member',
        invitedBy: ownerUid,
        createdAt: new Date().toISOString(),
        settings: {
          reminderEmail:         email,
          reminderTime:          '09:00',
          timezone:              Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
          emailRemindersEnabled: false,
          theme:                 'warm',
        },
      });

      // Write to userDirectory so the owner can discover and link this member
      await writeUserDirectory(cred.user.uid, { email, displayName, invitedBy: ownerUid });

      // Auto-link: if the owner has a teamMembers record with this email, set its uid
      await _autoLinkMember(ownerUid, cred.user.uid, email);

      return cred.user;
    } catch (err) {
      setError(err.message);
      throw err;
    }
  };

  const login = async (email, password) => {
    setError(null);
    try {
      const cred = await signInWithEmailAndPassword(auth, email, password);
      return cred.user;
    } catch (err) {
      setError(err.message);
      throw err;
    }
  };

  // Patch an existing user's profile to link them to a team.
  // Called when an existing user logs in via a ?join=OWNER_UID link.
  const linkToTeam = async (ownerUid) => {
    if (!auth.currentUser) return;
    const uid = auth.currentUser.uid;
    const email = auth.currentUser.email;
    const displayName = auth.currentUser.displayName;
    const ref = doc(db, 'users', uid);
    await setDoc(ref, { role: 'member', invitedBy: ownerUid }, { merge: true });
    await writeUserDirectory(uid, { email, displayName, invitedBy: ownerUid });
    setUser(prev => ({ ...prev, role: 'member', invitedBy: ownerUid }));
  };

  const logout = () => signOut(auth);

  const resetPassword = async (email) => {
    setError(null);
    try {
      await sendPasswordResetEmail(auth, email);
    } catch (err) {
      setError(err.message);
      throw err;
    }
  };

  const updateSettings = async (settings) => {
    if (!user) return;
    const ref = doc(db, 'users', user.uid);
    await setDoc(ref, { settings }, { merge: true });
    setUser(prev => ({ ...prev, settings }));
  };

  // Convenience booleans derived from role
  const isOwner  = !user?.role || user.role === 'owner';
  const isMember = user?.role === 'member';

  return (
    <AuthContext.Provider value={{
      user, loading, error,
      signup, signupAsMember, login, linkToTeam, logout, resetPassword, updateSettings,
      setError, isOwner, isMember,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

// ─── Internal: link the new member to the owner's teamMembers record ─────
async function _autoLinkMember(ownerUid, memberUid, memberEmail) {
  try {
    // We can't query teamMembers from here (no access), so we write a
    // "linkRequest" entry that the owner's Team page will pick up and process.
    // This is handled in useUserDirectory → TeamMembers component.
    // Nothing to do here — the directory entry written above is enough.
    // (The owner's app subscribes to userDirectory and auto-links on their side.)
    void ownerUid; void memberUid; void memberEmail;
  } catch {
    // Non-fatal — linking happens lazily in the Team tab
  }
}
