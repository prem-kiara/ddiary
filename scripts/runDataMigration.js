/**
 * One-time data migration — runs from your local machine using the Firebase Admin SDK.
 * Does NOT require the Firebase Blaze plan or Cloud Functions.
 *
 * What it does:
 *   1. Normalises task assigneeEmails to lowercase across all users
 *   2. Links assigneeUid by matching assigneeEmail against the userDirectory collection
 *
 * Prerequisites:
 *   npm install firebase-admin   (run once in the project root)
 *
 * Setup:
 *   1. Go to Firebase Console → Project Settings → Service Accounts
 *   2. Click "Generate new private key" → save as scripts/serviceAccountKey.json
 *      (this file is gitignored — never commit it)
 *   3. Run:  node scripts/runDataMigration.js
 */

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore }         from 'firebase-admin/firestore';
import { createRequire }        from 'module';

const require = createRequire(import.meta.url);
const serviceAccount = require('./serviceAccountKey.json');

initializeApp({ credential: cert(serviceAccount) });

const db = getFirestore();
const BATCH_SIZE = 400;

// ─── Step 1: Build uid lookup from userDirectory ──────────────────────────────
async function buildUidLookup() {
  const snap = await db.collection('userDirectory').get();
  const map = new Map();
  snap.docs.forEach(d => {
    const data = d.data();
    if (data.email) map.set(data.email.toLowerCase(), { uid: d.id, displayName: data.displayName });
  });
  console.log(`[migration] userDirectory loaded: ${map.size} entries`);
  return map;
}

// ─── Step 2: Migrate tasks for all users ─────────────────────────────────────
async function migrateTasks(uidLookup) {
  const usersSnap = await db.collection('users').get();
  let totalPatched = 0;
  let batch = db.batch();
  let batchCount = 0;

  const flush = async () => {
    if (batchCount === 0) return;
    await batch.commit();
    console.log(`  [batch] committed ${batchCount} writes`);
    batch = db.batch();
    batchCount = 0;
  };

  for (const userDoc of usersSnap.docs) {
    const tasksSnap = await db.collection('users').doc(userDoc.id).collection('tasks').get();

    for (const taskDoc of tasksSnap.docs) {
      const data = taskDoc.data();
      const updates = {};

      // Normalise email to lowercase
      if (data.assigneeEmail && data.assigneeEmail !== data.assigneeEmail.toLowerCase()) {
        updates.assigneeEmail = data.assigneeEmail.toLowerCase();
      }

      const normalizedEmail = (updates.assigneeEmail || data.assigneeEmail || '').toLowerCase();

      // Link assigneeUid if missing
      if (normalizedEmail && !data.assigneeUid) {
        const match = uidLookup.get(normalizedEmail);
        if (match) {
          updates.assigneeUid   = match.uid;
          updates.assigneeName  = updates.assigneeName || data.assigneeName || match.displayName;
        }
      }

      if (Object.keys(updates).length > 0) {
        batch.update(taskDoc.ref, updates);
        batchCount++;
        totalPatched++;
        if (batchCount >= BATCH_SIZE) await flush();
      }
    }
  }

  await flush();
  return totalPatched;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
(async () => {
  try {
    console.log('[migration] Starting…');
    const uidLookup = await buildUidLookup();
    const patched   = await migrateTasks(uidLookup);
    console.log(`[migration] Done. ${patched} task(s) patched.`);
  } catch (err) {
    console.error('[migration] FAILED:', err);
    process.exit(1);
  }
})();
