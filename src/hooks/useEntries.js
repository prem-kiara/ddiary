import { useState, useEffect, useCallback } from 'react';
import {
  collection, doc, addDoc, updateDoc, deleteDoc,
  query, orderBy, onSnapshot, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { createLogger } from '../utils/errorLogger';

// ─── SharePoint upload (Dhanam Repository → DDiary folder) ───────────────
const SP_DRIVE_ID = import.meta.env.VITE_SHAREPOINT_DRIVE_ID;
const MS_TOKEN_KEY = 'ddiary_ms_access_token';

/** Sentinel error thrown when the MS Graph token is expired or revoked. */
export class MsTokenExpiredError extends Error {
  constructor() {
    super('Microsoft token expired — please sign in again');
    this.name = 'MsTokenExpiredError';
  }
}

/**
 * Upload a data URL (base64 image) to SharePoint.
 * Files go to: Dhanam Repository / Shared Documents / DDiary / drawings / {userEmail} /
 * Returns the SharePoint web URL for the uploaded file.
 * Throws MsTokenExpiredError on HTTP 401 so callers can refresh the token and retry.
 */
async function uploadToSharePoint(dataUrl, userEmail) {
  const msToken = sessionStorage.getItem(MS_TOKEN_KEY);
  if (!msToken) throw new MsTokenExpiredError();
  if (!SP_DRIVE_ID) throw new Error('SharePoint Drive ID not configured');

  // Convert data URL to Blob
  const response = await fetch(dataUrl);
  const blob = await response.blob();

  // Build a unique filename
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const randomId = Math.random().toString(36).slice(2, 8);
  const ext = blob.type === 'image/png' ? 'png' : 'jpg';
  const safeEmail = (userEmail || 'unknown').replace(/[^a-zA-Z0-9@._-]/g, '_');
  const filePath = `DDiary/drawings/${safeEmail}/drawing_${timestamp}_${randomId}.${ext}`;

  // Upload via Graph API — PUT /drives/{driveId}/root:/{path}:/content
  const uploadRes = await fetch(
    `https://graph.microsoft.com/v1.0/drives/${SP_DRIVE_ID}/root:/${filePath}:/content`,
    {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${msToken}`,
        'Content-Type': blob.type,
      },
      body: blob,
    }
  );

  if (uploadRes.status === 401) {
    throw new MsTokenExpiredError();
  }
  if (!uploadRes.ok) {
    const errData = await uploadRes.json().catch(() => ({}));
    throw new Error(`SharePoint upload failed: ${uploadRes.status} — ${errData?.error?.message || 'Unknown error'}`);
  }

  const data = await uploadRes.json();

  // Create a sharing link so the image is viewable without auth
  try {
    const shareRes = await fetch(
      `https://graph.microsoft.com/v1.0/drives/${SP_DRIVE_ID}/items/${data.id}/createLink`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${msToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ type: 'view', scope: 'organization' }),
      }
    );
    if (shareRes.ok) {
      const shareData = await shareRes.json();
      return shareData.link?.webUrl || data.webUrl;
    }
  } catch {
    // Fall back to direct webUrl if sharing link fails
  }

  return data.webUrl;
}

// ─── Diary Entries Hook ───────────────────────────────────────────────────
export function useEntries() {
  const { user, refreshMsToken } = useAuth();
  const [entries, setEntries]               = useState([]);
  const [trashedEntries, setTrashedEntries] = useState([]);
  const [archivedEntries, setArchivedEntries] = useState([]);
  const [loading, setLoading]               = useState(true);

  useEffect(() => {
    if (!user) { setEntries([]); setTrashedEntries([]); setLoading(false); return; }

    const log = createLogger('useEntries', user.uid);
    const q   = query(
      collection(db, 'users', user.uid, 'entries'),
      orderBy('createdAt', 'desc')
    );

    const unsub = onSnapshot(q, (snap) => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setEntries(data.filter(e => !e.deletedAt && !e.archived));
      setArchivedEntries(data.filter(e => !e.deletedAt && !!e.archived));
      setTrashedEntries(data.filter(e => !!e.deletedAt));
      setLoading(false);
    }, (err) => { log(err, { action: 'onSnapshot' }); setLoading(false); });

    return unsub;
  }, [user]);

  /**
   * Upload a drawing, retrying once after a token refresh on 401.
   * Returns the SharePoint URL on success, or null on failure.
   */
  const uploadDrawingSafe = useCallback(async (dataUrl, logCtx) => {
    try {
      return await uploadToSharePoint(dataUrl, user.email);
    } catch (err) {
      if (err instanceof MsTokenExpiredError) {
        // Try refreshing the MS token, then retry the upload once
        const newToken = await refreshMsToken().catch(() => null);
        if (newToken) {
          try { return await uploadToSharePoint(dataUrl, user.email); }
          catch (retryErr) { logCtx(retryErr, { action: 'uploadDrawing:retry' }); }
        } else {
          logCtx(err, { action: 'uploadDrawing:tokenExpired' });
        }
      } else {
        logCtx(err, { action: 'uploadDrawing' });
      }
      return null;
    }
  }, [user, refreshMsToken]);

  const addEntry = useCallback(async (entry) => {
    if (!user) return;
    const log = createLogger('useEntries:addEntry', user.uid);
    const col = collection(db, 'users', user.uid, 'entries');
    const drawingUrls = [];
    if (entry.drawings?.length) {
      for (let i = 0; i < entry.drawings.length; i++) {
        const url = await uploadDrawingSafe(entry.drawings[i], log);
        if (url) drawingUrls.push(url);
      }
    }
    return addDoc(col, { ...entry, drawings: drawingUrls, deletedAt: null, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  }, [user, uploadDrawingSafe]);

  const updateEntry = useCallback(async (id, updates) => {
    if (!user) return;
    const log = createLogger('useEntries:updateEntry', user.uid);
    const docRef = doc(db, 'users', user.uid, 'entries', id);
    if (updates.drawings) {
      const drawingUrls = [];
      for (const drawing of updates.drawings) {
        if (drawing.startsWith('data:')) {
          const url = await uploadDrawingSafe(drawing, log);
          if (url) drawingUrls.push(url);
        } else {
          drawingUrls.push(drawing);
        }
      }
      updates.drawings = drawingUrls;
    }
    return updateDoc(docRef, { ...updates, updatedAt: serverTimestamp() });
  }, [user, uploadDrawingSafe]);

  const deleteEntry = useCallback(async (id) => {
    if (!user) return;
    return updateDoc(doc(db, 'users', user.uid, 'entries', id), { deletedAt: new Date().toISOString(), updatedAt: serverTimestamp() });
  }, [user]);

  const restoreEntry = useCallback(async (id) => {
    if (!user) return;
    return updateDoc(doc(db, 'users', user.uid, 'entries', id), { deletedAt: null, updatedAt: serverTimestamp() });
  }, [user]);

  const purgeEntry = useCallback(async (id) => {
    if (!user) return;
    return deleteDoc(doc(db, 'users', user.uid, 'entries', id));
  }, [user]);

  const archiveEntry = useCallback(async (id) => {
    if (!user) return;
    return updateDoc(doc(db, 'users', user.uid, 'entries', id), { archived: true, archivedAt: new Date().toISOString(), updatedAt: serverTimestamp() });
  }, [user]);

  const unarchiveEntry = useCallback(async (id) => {
    if (!user) return;
    return updateDoc(doc(db, 'users', user.uid, 'entries', id), { archived: false, archivedAt: null, updatedAt: serverTimestamp() });
  }, [user]);

  return {
    entries, trashedEntries, archivedEntries, loading,
    addEntry, updateEntry, deleteEntry, restoreEntry, purgeEntry, archiveEntry, unarchiveEntry,
  };
}
