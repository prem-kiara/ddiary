/**
 * sendSheetRowReminders.js
 *
 * Queries the sheetRowReminders Firestore collection and sends daily reminder
 * emails via SendGrid for any row reminder whose delivery window has arrived.
 *
 * Runs every hour via GitHub Actions (.github/workflows/sheet-reminders.yml).
 * No Firebase Blaze plan required — uses the Firebase Admin SDK over HTTPS.
 *
 * Required environment variables (set as GitHub Actions secrets):
 *   FIREBASE_SERVICE_ACCOUNT_B64  — base64-encoded service account JSON
 *   SENDGRID_API_KEY              — SendGrid API key
 *   SENDGRID_FROM                 — sender address (default: noreply@dhanam.finance)
 */

'use strict';

const admin  = require('firebase-admin');
const sgMail = require('@sendgrid/mail');

// ── Bootstrap ─────────────────────────────────────────────────────────────────

if (!process.env.FIREBASE_SERVICE_ACCOUNT_B64) {
  console.error('Missing FIREBASE_SERVICE_ACCOUNT_B64 environment variable');
  process.exit(1);
}
if (!process.env.SENDGRID_API_KEY) {
  console.error('Missing SENDGRID_API_KEY environment variable');
  process.exit(1);
}

const serviceAccount = JSON.parse(
  Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_B64, 'base64').toString('utf8')
);

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });

const db        = admin.firestore();
const FROM      = process.env.SENDGRID_FROM || 'noreply@dhanam.finance';
const COOLDOWN  = 23 * 60 * 60 * 1000; // 23 h

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const snap = await db.collection('sheetRowReminders')
    .where('active', '==', true)
    .get();

  if (snap.empty) {
    console.log('No active reminders — nothing to send.');
    return;
  }

  // Current time in IST (UTC+5:30) — all Dhanam users are assumed IST
  const nowUtc      = new Date();
  const nowIST      = new Date(nowUtc.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const nowTotalMin = nowIST.getHours() * 60 + nowIST.getMinutes();
  const cutoff      = new Date(Date.now() - COOLDOWN);

  console.log(`[${nowIST.toISOString()}] Checking ${snap.size} active reminder(s)…`);

  let sent = 0;

  for (const d of snap.docs) {
    const rem = d.data();

    // ── 23-hour cooldown ─────────────────────────────────────────────────────
    const lastSent = rem.lastSentAt?.toDate?.() ?? null;
    if (lastSent && lastSent > cutoff) {
      console.log(`  skip ${d.id} — sent ${Math.round((Date.now() - lastSent) / 3600000)}h ago`);
      continue;
    }

    // ── Delivery-time window (±30 min around sendAtTime IST) ────────────────
    if (rem.sendAtTime) {
      const [hh, mm] = rem.sendAtTime.split(':').map(Number);
      if (!isNaN(hh) && !isNaN(mm)) {
        const target = hh * 60 + mm;
        const diff   = Math.min(
          Math.abs(nowTotalMin - target),
          1440 - Math.abs(nowTotalMin - target),
        );
        if (diff > 30) {
          console.log(`  skip ${d.id} — outside window (now ${nowIST.getHours()}:${String(nowIST.getMinutes()).padStart(2,'0')} IST, target ${rem.sendAtTime})`);
          continue;
        }
      }
    }

    // ── Atomically claim this send slot ──────────────────────────────────────
    let shouldSend = false;
    try {
      await db.runTransaction(async (tx) => {
        const fresh = await tx.get(d.ref);
        if (!fresh.exists) return;
        const fd        = fresh.data();
        if (!fd.active) return;
        const freshLast = fd.lastSentAt?.toDate?.() ?? null;
        if (freshLast && freshLast > cutoff) return; // another process beat us
        tx.update(d.ref, { lastSentAt: admin.firestore.FieldValue.serverTimestamp() });
        shouldSend = true;
      });
    } catch (txErr) {
      console.warn(`  transaction failed for ${d.id}:`, txErr.message);
      continue;
    }

    if (!shouldSend) continue;

    // ── Build recipient list ──────────────────────────────────────────────────
    const toEmails = Array.isArray(rem.notifyEmails) && rem.notifyEmails.length
      ? rem.notifyEmails
      : (rem.createdByEmail ? [rem.createdByEmail] : []);

    if (!toEmails.length) {
      console.warn(`  skip ${d.id} — no recipients`);
      continue;
    }

    // ── Build email ───────────────────────────────────────────────────────────
    const rowLabel   = `Row ${(rem.rowIndex ?? 0) + 1}`;
    const sheetTitle = rem.sheetTitle || 'Untitled Sheet';
    const dateStr    = nowIST.toLocaleDateString('en-IN', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    });

    const tableRows = Object.entries(rem.rowData || {})
      .filter(([, v]) => String(v ?? '').trim())
      .map(([col, val]) => `
        <tr>
          <td style="padding:6px 12px;font-weight:600;color:#7c3aed;background:#f5f3ff;border:1px solid #e2e8f0;white-space:nowrap">${col}</td>
          <td style="padding:6px 12px;color:#1e293b;border:1px solid #e2e8f0">${String(val)}</td>
        </tr>`)
      .join('');

    const html = `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;background:#f8fafc;padding:32px;border-radius:12px;">
        <div style="background:#7c3aed;padding:20px 24px;border-radius:10px 10px 0 0">
          <h1 style="margin:0;color:#fff;font-size:20px;font-weight:700">🔔 Daily Row Reminder</h1>
          <p style="margin:4px 0 0;color:#ddd6fe;font-size:13px">${dateStr}</p>
        </div>
        <div style="background:#fff;padding:24px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 10px 10px">
          <p style="margin:0 0 16px;color:#334155;font-size:15px">
            Reminder for <strong>${rowLabel}</strong> in sheet <strong>${sheetTitle}</strong>:
          </p>
          ${tableRows ? `<table style="border-collapse:collapse;width:100%;margin-bottom:16px;font-size:14px">${tableRows}</table>` : ''}
          ${rem.assigneeName ? `<p style="margin:0 0 8px;font-size:14px;color:#475569"><strong>Assigned to:</strong> ${rem.assigneeName}</p>` : ''}
          ${rem.remarks ? `
            <div style="background:#fef9c3;border:1px solid #fde68a;border-radius:8px;padding:12px 14px;margin-top:12px;font-size:14px;color:#713f12">
              <strong>Remarks:</strong> ${rem.remarks}
            </div>` : ''}
          <p style="margin:20px 0 0;font-size:12px;color:#94a3b8;text-align:center">
            Automated daily reminder from Dhanam Diary.
            To stop, open the sheet and click the 🔔 bell icon for this row.
          </p>
        </div>
      </div>`;

    // ── Send ──────────────────────────────────────────────────────────────────
    try {
      await sgMail.send({
        to:      toEmails,
        from:    FROM,
        subject: `🔔 Reminder: ${sheetTitle} — ${rowLabel}${rem.assigneeName ? ` (${rem.assigneeName})` : ''}`,
        html,
      });
      sent++;
      console.log(`  ✓ sent ${d.id} → ${toEmails.join(', ')}`);
    } catch (emailErr) {
      console.error(`  ✗ email failed for ${d.id}:`, emailErr.message);
      // Roll back lastSentAt so it retries next hour
      await d.ref.update({ lastSentAt: null }).catch(() => {});
    }
  }

  console.log(`Done — ${sent} email(s) sent.`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
