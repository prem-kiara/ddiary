import { useCallback, useRef } from 'react';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../../firebase';

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
  const autoSaveTimerRef  = useRef(null);
  const liveShareTimerRef = useRef(null);
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
      }
    }, 1500);
  }, [editorRef, titleRef, entryIdRef, isSharedEntryRef, userRef, lastLocalEditRef, setDraftStatus]);

  return { scheduleAutosave, autoSaveTimerRef, liveShareTimerRef, skipFirstSaveRef };
}
