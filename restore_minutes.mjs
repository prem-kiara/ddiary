/**
 * restore_minutes.mjs
 *
 * Restores the "Minutes" diary entry in the owner's personal collection
 * from the sharedDiaries document (which has Hema's edits).
 *
 * Run from ~/tools/ddiary:
 *   node restore_minutes.mjs
 *
 * Requires: npm install firebase-admin (already in ec2/package.json,
 * but run: npm install firebase-admin dotenv  if needed locally)
 */

import { readFileSync } from 'fs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

// ── Load firebase-admin ──────────────────────────────────────────────────────
// Try local node_modules first, then fall back to a temp install path
let admin;
try {
  admin = require('firebase-admin');
} catch {
  console.error('firebase-admin not found. Run: npm install firebase-admin');
  process.exit(1);
}

// ── Service account — download from EC2 first ────────────────────────────────
// scp -i ~/tools/dhanam-finops.pem ubuntu@15.206.55.165:~/ddiary-server/service-account.json ~/tools/ddiary/sa.json
const SA_PATH = new URL('./sa.json', import.meta.url).pathname;
let sa;
try {
  sa = JSON.parse(readFileSync(SA_PATH, 'utf8'));
} catch {
  console.error(`\nService account not found at: ${SA_PATH}`);
  console.error('Download it from EC2 first:');
  console.error('  scp -i ~/tools/dhanam-finops.pem ubuntu@15.206.55.165:~/ddiary-server/service-account.json ~/tools/ddiary/sa.json\n');
  process.exit(1);
}

admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();

// ── The correct HTML content from sharedDiaries (Hema's version) ─────────────
const HEMA_CONTENT = `<p><b>1. RS Puram Branch</b></p><table style="border-collapse: collapse; width: auto; margin: 8px 0px; table-layout: fixed;"><tbody><tr style="height: 12px;"><td style="border: 1px solid rgb(226, 232, 240); padding: 6px 8px; vertical-align: top; width: 28px;"><b>#</b></td><td style="border: 1px solid rgb(226, 232, 240); padding: 6px 8px; vertical-align: top; width: 338.483px;"><b>Action Item</b></td><td style="border: 1px solid rgb(226, 232, 240); padding: 6px 8px; vertical-align: top; width: 135.667px;"><b>Owner</b></td><td style="border: 1px solid rgb(226, 232, 240); padding: 6px 8px; vertical-align: top; width: 118.333px;"><b>Assigned To</b></td><td style="border: 1px solid rgb(226, 232, 240); padding: 6px 8px; vertical-align: top; width: 115.867px;"><b>Target</b></td><td style="border: 1px solid rgb(226, 232, 240); padding: 6px 8px; vertical-align: top; width: 404.65px;"><b>Remarks</b></td></tr><tr style="height: 24px;"><td style="border: 1px solid rgb(226, 232, 240); padding: 6px 8px; vertical-align: top; width: 28px;">1</td><td style="border: 1px solid rgb(226, 232, 240); padding: 6px 8px; vertical-align: top; width: 338.483px;">NCD</td><td style="border: 1px solid rgb(226, 232, 240); padding: 6px 8px; vertical-align: top; width: 135.667px;">Nambi/ Suren</td><td style="border: 1px solid rgb(226, 232, 240); padding: 6px 8px; vertical-align: top; width: 118.333px;">Bindu</td><td style="border: 1px solid rgb(226, 232, 240); padding: 6px 8px; vertical-align: top; width: 115.867px;">3 crores</td><td style="border: 1px solid rgb(226, 232, 240); padding: 6px 8px; vertical-align: top; width: 404.65px;">Need plan from Bindu/ Ashok</td></tr><tr style="height: 24px;"><td style="border: 1px solid rgb(226, 232, 240); padding: 6px 8px; vertical-align: top; width: 28px;">2</td><td style="border: 1px solid rgb(226, 232, 240); padding: 6px 8px; vertical-align: top; width: 338.483px;">2 Lakhs NCD - Selvam</td><td style="border: 1px solid rgb(226, 232, 240); padding: 6px 8px; vertical-align: top; width: 135.667px;">Nambi/ Suren</td><td style="border: 1px solid rgb(226, 232, 240); padding: 6px 8px; vertical-align: top; width: 118.333px;">Bindu</td><td style="border: 1px solid rgb(226, 232, 240); padding: 6px 8px; vertical-align: top; width: 115.867px;">2 Lakhs</td><td style="border: 1px solid rgb(226, 232, 240); padding: 6px 8px; vertical-align: top; width: 404.65px;">Colected the amount already</td></tr><tr><td style="border: 1px solid rgb(226, 232, 240); padding: 4px 6px; vertical-align: top; width: 28px;">3</td><td style="border: 1px solid rgb(226, 232, 240); padding: 4px 6px; vertical-align: top; width: 338.483px;">1 Lakh NCD - Nirmala Karthikeyan</td><td style="border: 1px solid rgb(226, 232, 240); padding: 4px 6px; vertical-align: top; width: 135.667px;">Nambi/ Suren</td><td style="border: 1px solid rgb(226, 232, 240); padding: 4px 6px; vertical-align: top; width: 118.333px;">Bindu</td><td style="border: 1px solid rgb(226, 232, 240); padding: 4px 6px; vertical-align: top; width: 115.867px;">1 Lakh </td><td style="border: 1px solid rgb(226, 232, 240); padding: 4px 6px; vertical-align: top; width: 404.65px;">Will receive the NEFT today</td></tr><tr><td style="border: 1px solid rgb(226, 232, 240); padding: 4px 6px; vertical-align: top; width: 28px;">4</td><td style="border: 1px solid rgb(226, 232, 240); padding: 4px 6px; vertical-align: top; width: 338.483px;">NCD target from Bindu</td><td style="border: 1px solid rgb(226, 232, 240); padding: 4px 6px; vertical-align: top; width: 135.667px;">Nambi/ Suren</td><td style="border: 1px solid rgb(226, 232, 240); padding: 4px 6px; vertical-align: top; width: 118.333px;">Bindu</td><td style="border: 1px solid rgb(226, 232, 240); padding: 4px 6px; vertical-align: top; width: 115.867px;">20 Lakhs</td><td style="border: 1px solid rgb(226, 232, 240); padding: 4px 6px; vertical-align: top; width: 404.65px;">20 Lakhs in May 2026</td></tr><tr><td style="border: 1px solid rgb(226, 232, 240); padding: 4px 6px; vertical-align: top; width: 28px;">5</td><td style="border: 1px solid rgb(226, 232, 240); padding: 4px 6px; vertical-align: top; width: 338.483px;">Coimbatore Club - ₹5900</td><td style="border: 1px solid rgb(226, 232, 240); padding: 4px 6px; vertical-align: top; width: 135.667px;">Nambi/ Suren</td><td style="border: 1px solid rgb(226, 232, 240); padding: 4px 6px; vertical-align: top; width: 118.333px;">Sujith</td><td style="border: 1px solid rgb(226, 232, 240); padding: 4px 6px; vertical-align: top; width: 115.867px;">2 crores</td><td style="border: 1px solid rgb(226, 232, 240); padding: 4px 6px; vertical-align: top; width: 404.65px;">Have approved budget for advertisement</td></tr><tr><td style="border: 1px solid rgb(226, 232, 240); padding: 4px 6px; vertical-align: top; width: 28px;">6.</td><td style="border: 1px solid rgb(226, 232, 240); padding: 4px 6px; vertical-align: top; width: 338.483px;">Lions Club - Governer - Approx ₹10000</td><td style="border: 1px solid rgb(226, 232, 240); padding: 4px 6px; vertical-align: top; width: 135.667px;">Nambi/ Suren</td><td style="border: 1px solid rgb(226, 232, 240); padding: 4px 6px; vertical-align: top; width: 118.333px;">Sujith</td><td style="border: 1px solid rgb(226, 232, 240); padding: 4px 6px; vertical-align: top; width: 115.867px;">5 crores</td><td style="border: 1px solid rgb(226, 232, 240); padding: 4px 6px; vertical-align: top; width: 404.65px;">Need to review budget for advertisement</td></tr><tr><td style="border:1px solid #e2e8f0;padding:4px 6px;min-width:0;vertical-align:top">7</td><td style="border:1px solid #e2e8f0;padding:4px 6px;min-width:0;vertical-align:top">5 Lakhs NCD </td><td style="border:1px solid #e2e8f0;padding:4px 6px;min-width:0;vertical-align:top">Nambi/ Suren</td><td style="border:1px solid #e2e8f0;padding:4px 6px;min-width:0;vertical-align:top">Ashok</td><td style="border:1px solid #e2e8f0;padding:4px 6px;min-width:0;vertical-align:top">5 Lakhs</td><td style="border:1px solid #e2e8f0;padding:4px 6px;min-width:0;vertical-align:top">Received cheque today</td></tr></tbody></table><p><b>2. Salem Branch</b></p><table style="border-collapse: collapse; width: auto; margin: 8px 0px; table-layout: fixed;"><tbody><tr style="height: 12px;"><td style="border: 1px solid rgb(226, 232, 240); padding: 6px 8px; vertical-align: top; width: 27.3833px;"><b>#</b></td><td style="border: 1px solid rgb(226, 232, 240); padding: 6px 8px; vertical-align: top; width: 344.867px;"><b>Action Item</b></td><td style="border: 1px solid rgb(226, 232, 240); padding: 6px 8px; vertical-align: top; width: 135.767px;"><b>Owner</b></td><td style="border: 1px solid rgb(226, 232, 240); padding: 6px 8px; vertical-align: top; width: 118.433px;"><b>Assigned To</b></td><td style="border: 1px solid rgb(226, 232, 240); padding: 6px 8px; vertical-align: top; width: 113.967px;"><b>Target</b></td><td style="border: 1px solid rgb(226, 232, 240); padding: 6px 8px; vertical-align: top; width: 401.967px;"><b>Remarks</b></td></tr><tr style="height: 24px;"><td style="border: 1px solid rgb(226, 232, 240); padding: 6px 8px; vertical-align: top; width: 27.3833px;">1</td><td style="border: 1px solid rgb(226, 232, 240); padding: 6px 8px; vertical-align: top; width: 344.867px;">NCD</td><td style="border: 1px solid rgb(226, 232, 240); padding: 6px 8px; vertical-align: top; width: 135.767px;">Nambi</td><td style="border: 1px solid rgb(226, 232, 240); padding: 6px 8px; vertical-align: top; width: 118.433px;">Ashok</td><td style="border: 1px solid rgb(226, 232, 240); padding: 6px 8px; vertical-align: top; width: 113.967px;">3 crores</td><td style="border: 1px solid rgb(226, 232, 240); padding: 6px 8px; vertical-align: top; width: 401.967px;">8L committed from Namakkal through Ashok</td></tr></tbody></table><p><b>3. Tirupur Branch</b></p><table style="border-collapse: collapse; width: auto; margin: 8px 0px; table-layout: fixed;"><tbody><tr style="height: 12px;"><td style="border: 1px solid rgb(226, 232, 240); padding: 6px 8px; vertical-align: top; width: 27.1333px;"><b>#</b></td><td style="border: 1px solid rgb(226, 232, 240); padding: 6px 8px; vertical-align: top; width: 348.867px;"><b>Action Item</b></td><td style="border: 1px solid rgb(226, 232, 240); padding: 6px 8px; vertical-align: top; width: 135.767px;"><b>Owner</b></td><td style="border: 1px solid rgb(226, 232, 240); padding: 6px 8px; vertical-align: top; width: 118.433px;"><b>Assigned To</b></td><td style="border: 1px solid rgb(226, 232, 240); padding: 6px 8px; vertical-align: top; width: 113.967px;"><b>Target</b></td><td style="border: 1px solid rgb(226, 232, 240); padding: 6px 8px; vertical-align: top; width: 396.967px;"><b>Remarks</b></td></tr><tr style="height: 24px;"><td style="border: 1px solid rgb(226, 232, 240); padding: 6px 8px; vertical-align: top; width: 27.1333px;">1</td><td style="border: 1px solid rgb(226, 232, 240); padding: 6px 8px; vertical-align: top; width: 348.867px;">NCD</td><td style="border: 1px solid rgb(226, 232, 240); padding: 6px 8px; vertical-align: top; width: 135.767px;">Nambi</td><td style="border: 1px solid rgb(226, 232, 240); padding: 6px 8px; vertical-align: top; width: 118.433px;">Ashok</td><td style="border: 1px solid rgb(226, 232, 240); padding: 6px 8px; vertical-align: top; width: 113.967px;">3 crores</td><td style="border: 1px solid rgb(226, 232, 240); padding: 6px 8px; vertical-align: top; width: 396.967px;"></td></tr></tbody></table>`;

async function main() {
  console.log('Connecting to Firestore...');

  // Find the sharedDiaries document (the one you saw in Firebase console)
  const sharedSnap = await db.collection('sharedDiaries').get();
  if (sharedSnap.empty) {
    console.error('No sharedDiaries documents found.');
    process.exit(1);
  }

  // Use the first (and only) sharedDiary doc as the entry ID
  const sharedDoc  = sharedSnap.docs[0];
  const entryId    = sharedDoc.id;
  const ownerId    = sharedDoc.data().ownerId;

  console.log(`Found shared diary: ${entryId}  (owner: ${ownerId})`);

  if (!ownerId) {
    console.error('ownerId missing from sharedDiaries document. Cannot locate personal entry.');
    process.exit(1);
  }

  // Update the owner's personal entry with Hema's content
  const personalRef = db.collection('users').doc(ownerId).collection('entries').doc(entryId);
  const personalDoc = await personalRef.get();

  if (!personalDoc.exists) {
    console.error(`Personal entry not found at users/${ownerId}/entries/${entryId}`);
    process.exit(1);
  }

  console.log('Current entry title:', personalDoc.data().title);
  console.log('Restoring Hema\'s content...');

  await personalRef.update({
    content:   HEMA_CONTENT,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // Also keep sharedDiaries in sync
  await db.collection('sharedDiaries').doc(entryId).update({
    content:   HEMA_CONTENT,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  console.log('\n✅ Done! Refresh the diary in your browser — the entry now shows Hema\'s version.');
  console.log('   RS Puram Branch now has all 7 rows including Lions Club, Coimbatore Club, and 5 Lakhs NCD.');
  process.exit(0);
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
