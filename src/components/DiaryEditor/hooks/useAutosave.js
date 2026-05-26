import { useCallback, useRef } from 'react';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../../firebase';
import { saveSnapshot } from '../../../utils/diaryHistory';

// Minimum gap between periodic auto-snapshots for shared entries (5 minutes).
// This ensures that even if a user never clicks "Save Entry", there is always
// a recent Firestore snapshot to fall back on if something is accidentally deleted.
const PERIODIC_SNAPSHOT_INTERVAL_MS = 5 * 60 * 1000;

/**
 * useAutosave
 *
 * Debounced save to localStorage and, for shared entries, Firestore live-sync.
 *
 * @param {object} opts
 * @param {React.RefObject} opts.editorRef        - ref to the contentEditable element
 * @param {React.RefObject} opts.titleRef         - ref to the current title string
 * @param {React.RefObject} opts.entryIdRef       - ref to the current entry id
 * @param {React.RefObject} opts.isSharedEntryRef - ref: true when editing a shared diary
 * @param {React.RefObject} opts.userRef          - ref to the current Firebase user
 * @param {React.RefObject} opts.lastLocalEditRef - ref: timestamp of last local keystroke
 * @param {function}        opts.setDraftStatus   - setState setter for draft status indicator
 *
 * @returns {{ scheduleAutosave: function, autoSaveTimerRef: React.RefObject, liveShareTimerRef: React.RefObject }}
 */
export function useAutosave({
  editorRef,
  titleRef,
  entryIdRef,
  isSharedEntryRef,
  userRef,
  lastLocalEditRef,
  setDraftStatus,
}) {
  const autoSaveTimerRef       = useRef(null);
  const liveShareTimerRef      = useRef(null);
  const lastSnapshotTimeRef    = useRef(0);  // tracks when we last took a periodic snapshot
  // skipFirstSaveRef is managed externally (in index.jsx) because the load
  // effect resets it; we receive it as a ref so reads/writes here stay in sync.
  const skipFirstSaveRef  = useRef(true);

  const scheduleAutosave = useCallback(() => {
    if (skipFirstSaveRef.current) {
      skipFirstSaveRef.current = false;
      return;
    }
    lastLocalEditRef.current = Date.now();
    setDraftStatus('saving');
    clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(() => {
      const html = editorRef.current?.innerHTML || '';
      const ttl  = titleRef.current;

      // Always save to localStorage as a draft
      try {
        const key = `ddiary_draft_${entryIdRef.current}`;
        localStorage.setItem(key, JSON.stringify({ title: ttl, content: html, savedAt: Date.now() }));
        setDraftStatus('saved');
      } catch { /* storage full */ }

      // For shared entries, also push to Firestore so collaborators see changes live
      if (isSharedEntryRef.current && entryIdRef.current && entryIdRef.current !== 'new') {
        clearTimeout(liveShareTimerRef.current);
        liveShareTimerRef.current = setTimeout(() => {
          updateDoc(doc(db, 'sharedDiaries', entryIdRef.current), {
            content:     html,
            title:       ttl,
            updaterName: userRef.current?.displayName || userRef.current?.email || 'Someone',
            updatedAt:   serverTimestamp(),
          }).catch(() => {});
        }, 500); // small extra delay so we batch rapid edits

        // Periodic snapshot — at most every 5 minutes for shared entries.
        // Personal entries snapshot only on manual save (handled in index.jsx).
        // This ensures there is always a recent Firestore version to restore from,
        // even if the user never clicks "Save Entry".
        const now = Date.now();
        if (now - lastSnapshotTimeRef.current >= PERIODIC_SNAPSHOT_INTERVAL_MS) {
          lastSnapshotTimeRef.current = now;
          saveSnapshot({
            uid:      userRef.current?.uid,
            entryId:  entryIdRef.current,
            isShared: true,
            title:    ttl,
            content:  html,
            savedBy:  userRef.current?.displayName || userRef.current?.email || '',
            type:     'periodic',
          }).catch(() => {}); // best-effort, never block the UI
        }
      }
    }, 500);
  }, [editorRef, titleRef, entryIdRef, isSharedEntryRef, userRef, lastLocalEditRef, setDraftStatus]);

  return { scheduleAutosave, autoSaveTimerRef, liveShareTimerRef, skipFirstSaveRef };
}
