import { useEffect, useState } from 'react';
import { doc, onSnapshot, collection as fsCollection } from 'firebase/firestore';
import { db } from '../../../firebase';
import { logSheetOpen } from '../../../hooks/useSharedSheets';

/**
 * Subscribes to real-time Firestore sync for a shared sheet.
 * Calls the provided setter callbacks whenever remote data arrives.
 *
 * Returns { membersCount, sheetMemberEmails } live state.
 */
export function useSharedSheet({
  effectiveSharedId,
  isShared,
  sharedSheetId,
  user,
  editCell,
  commentRow,
  setData,
  setTitle,
  setCols,
  setRows,
  setColWidths,
  setRowHeights,
  setRowComments,
  setMembersCount,
  setSheetMemberEmails,
}) {
  // Real-time sync — runs for BOTH collaborators (isShared=true) and the owner
  // when the sheet has been shared (sheet.isShared=true).
  useEffect(() => {
    if (!effectiveSharedId || !user) return;
    if (isShared) logSheetOpen(effectiveSharedId, user).catch(() => {});
    const unsub = onSnapshot(doc(db, 'sharedSheets', effectiveSharedId), snap => {
      if (!snap.exists() || snap.metadata.hasPendingWrites) return;
      const d = snap.data();
      if (!editCell) setData(d.data || {});
      if (d.title)              setTitle(d.title);
      if (d.cols)               setCols(d.cols);
      if (d.rows)               setRows(d.rows);
      if (d.colWidths?.length)  setColWidths(d.colWidths);
      if (d.rowHeights?.length) setRowHeights(d.rowHeights);
      if (d.rowComments && !commentRow) setRowComments(d.rowComments);
    });
    return unsub;
  }, [effectiveSharedId, isShared]); // eslint-disable-line react-hooks/exhaustive-deps

  // Members count for header badge + email list for reminder dispatch
  useEffect(() => {
    if (!isShared || !sharedSheetId) return;
    const unsub = onSnapshot(
      fsCollection(db, 'sharedSheets', sharedSheetId, 'members'),
      snap => {
        setMembersCount(snap.size);
        setSheetMemberEmails(snap.docs.map(d => d.data().email).filter(Boolean));
      },
      () => {},
    );
    return unsub;
  }, [isShared, sharedSheetId]); // eslint-disable-line
}
