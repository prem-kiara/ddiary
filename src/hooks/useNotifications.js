/**
 * Real-time in-app notifications via Firestore onSnapshot.
 * Listens for docs in the top-level `notifications` collection
 * where recipientEmail matches the current user.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import {
  collection, query, where, orderBy, onSnapshot,
  doc, updateDoc, writeBatch, limit,
} from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';

export function useNotifications({ onNewNotification } = {}) {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const seenIdsRef = useRef(new Set());
  const initialLoadDone = useRef(false);

  useEffect(() => {
    if (!user?.email) {
      setNotifications([]);
      setLoading(false);
      return;
    }

    const q = query(
      collection(db, 'notifications'),
      where('recipientEmail', '==', user.email.toLowerCase()),
      orderBy('createdAt', 'desc'),
      limit(50)
    );

    const unsub = onSnapshot(q, (snap) => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setNotifications(data);
      setLoading(false);

      // After initial load, detect genuinely NEW notifications and fire callback
      if (initialLoadDone.current && onNewNotification) {
        data.forEach(n => {
          if (!seenIdsRef.current.has(n.id) && !n.read) {
            onNewNotification(n);
          }
        });
      }

      // Track all seen IDs
      seenIdsRef.current = new Set(data.map(n => n.id));
      initialLoadDone.current = true;
    }, (err) => {
      console.error('Notifications listener error:', err);
      setLoading(false);
    });

    return unsub;
  }, [user?.email]);

  const unreadCount = notifications.filter(n => !n.read).length;

  const markRead = useCallback(async (notifId) => {
    try {
      await updateDoc(doc(db, 'notifications', notifId), { read: true });
    } catch { /* non-fatal */ }
  }, []);

  const markAllRead = useCallback(async () => {
    const unread = notifications.filter(n => !n.read);
    if (!unread.length) return;
    const batch = writeBatch(db);
    unread.forEach(n => {
      batch.update(doc(db, 'notifications', n.id), { read: true });
    });
    try {
      await batch.commit();
    } catch { /* non-fatal */ }
  }, [notifications]);

  return { notifications, unreadCount, loading, markRead, markAllRead };
}
