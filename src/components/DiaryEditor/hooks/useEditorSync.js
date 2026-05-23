import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../../../firebase';

/**
 * useEditorSync
 *
 * Subscribes to real-time Firestore onSnapshot updates for shared diary entries.
 * When a remote collaborator makes a change, the editor content and title are
 * updated, provided the local user has not typed in the last 5 seconds.
 *
 * @param {object} opts
 * @param {string|undefined}  opts.entryId             - the Firestore document id
 * @param {boolean}           opts.isShared            - derived from state/props; true when entry is shared.
 *                                                       Must be a state value (not a ref) so the effect
 *                                                       re-runs when a personal entry is converted to shared
 *                                                       mid-session, re-attaching the Firestore listener.
 * @param {React.RefObject}   opts.isSharedEntryRef    - ref mirror of isShared (used by other hooks)
 * @param {React.RefObject}   opts.pendingFirstSnapRef - ref: true until first snapshot is consumed
 * @param {React.RefObject}   opts.lastLocalEditRef    - ref: timestamp of last local keystroke
 * @param {React.RefObject}   opts.titleRef            - ref to the current title string
 * @param {React.RefObject}   opts.editorRef           - ref to the contentEditable element
 * @param {React.RefObject}   opts.prevBlockCountRef   - ref to child-element count tracker
 * @param {function}          opts.setTitle            - setState setter for title
 * @param {function}          opts.setIsEmpty          - setState setter for isEmpty flag
 *
 * @returns {{ remoteUpdateInfo: { name: string } | null }}
 */
export function useEditorSync({
  entryId,
  isShared,
  isSharedEntryRef,
  pendingFirstSnapRef,
  lastLocalEditRef,
  titleRef,
  editorRef,
  prevBlockCountRef,
  setTitle,
  setIsEmpty,
}) {
  const [remoteUpdateInfo, setRemoteUpdateInfo] = useState(null);

  useEffect(() => {
    if (!entryId || entryId === 'new') return;
    if (!isShared) return;

    const unsub = onSnapshot(doc(db, 'sharedDiaries', entryId), (snap) => {
      if (!snap.exists() || snap.metadata.hasPendingWrites) {
        pendingFirstSnapRef.current = false;
        return;
      }

      const d = snap.data();
      const isFirstSnap = pendingFirstSnapRef.current;
      pendingFirstSnapRef.current = false;

      if (isFirstSnap) {
        // On the very first snapshot, sharedDiaries is the canonical source for shared
        // entries. Apply the content if it differs from what the personal entry loaded —
        // a collaborator may have saved changes that haven't propagated back to the
        // owner's personal entry yet (e.g. after a recovery or sync gap).
        const sharedContent = d.content;
        const sharedTitle   = d.title;
        if (sharedContent && editorRef.current && sharedContent !== editorRef.current.innerHTML) {
          editorRef.current.innerHTML = sharedContent;
          prevBlockCountRef.current = editorRef.current.childElementCount;
          setIsEmpty(!sharedContent.replace(/<[^>]+>/g, '').trim());
        }
        if (sharedTitle !== undefined && sharedTitle !== titleRef.current) {
          setTitle(sharedTitle);
          titleRef.current = sharedTitle;
        }
        // Treat this initial load as a "local edit" so the 5-second guard doesn't
        // immediately overwrite whatever the user is about to type.
        lastLocalEditRef.current = Date.now();
        return;
      }

      // Don't overwrite if the user typed in the last 5 seconds
      if (Date.now() - lastLocalEditRef.current < 5000) return;

      // Apply remote title
      if (d.title !== undefined && d.title !== titleRef.current) {
        setTitle(d.title);
        titleRef.current = d.title;
      }

      // Apply remote content
      if (d.content && editorRef.current) {
        const remote = d.content;
        if (remote !== editorRef.current.innerHTML) {
          editorRef.current.innerHTML = remote;
          prevBlockCountRef.current = editorRef.current.childElementCount;
          setIsEmpty(!remote.replace(/<[^>]+>/g, '').trim());
          const name = d.updaterName || d.ownerName || 'A collaborator';
          setRemoteUpdateInfo({ name });
          setTimeout(() => setRemoteUpdateInfo(null), 4000);
        }
      }
    });

    return () => unsub();
  // isShared is a state-derived value: when it flips from false to true
  // (personal entry converted to shared mid-session) the effect re-runs and
  // attaches the Firestore listener so collaborator changes become visible
  // without a page refresh.
  }, [entryId, isShared]); // eslint-disable-line react-hooks/exhaustive-deps

  return { remoteUpdateInfo };
}
