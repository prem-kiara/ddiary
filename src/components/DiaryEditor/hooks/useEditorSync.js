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
 * @param {React.RefObject}   opts.isSharedEntryRef    - ref: true when entry is a shared diary
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
    if (!isSharedEntryRef.current) return;

    const unsub = onSnapshot(doc(db, 'sharedDiaries', entryId), (snap) => {
      // Skip the very first fire (that's our own data or the initial load)
      if (pendingFirstSnapRef.current) {
        pendingFirstSnapRef.current = false;
        return;
      }
      if (!snap.exists() || snap.metadata.hasPendingWrites) return;

      // Don't overwrite if the user typed in the last 5 seconds
      if (Date.now() - lastLocalEditRef.current < 5000) return;

      const d = snap.data();

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
  }, [entryId]); // eslint-disable-line react-hooks/exhaustive-deps

  return { remoteUpdateInfo };
}
