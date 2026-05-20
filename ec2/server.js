'use strict';

/**
 * ddiary-server — Express API server for Dhanam DDiary on EC2
 *
 * Listens on 127.0.0.1:3002 (localhost only — nginx proxies /api/* here).
 * Authenticates every request using Firebase ID tokens (Bearer header).
 * Sends email via Amazon SES — uses EC2 IAM role automatically if attached,
 * or falls back to AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY in .env.
 *
 * Start:  pm2 start ecosystem.config.js --only ddiary-server
 * Logs:   pm2 logs ddiary-server
 */

const express = require('express');
const admin   = require('firebase-admin');
const { SESClient, SendEmailCommand } = require('@aws-sdk/client-ses');
require('dotenv').config();

// ── Firebase Admin Init ────────────────────────────────────────────────────────
// service-account.json must be chmod 600 and never committed to git
const serviceAccount = require('./service-account.json');
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });

// ── SES Client ────────────────────────────────────────────────────────────────
// If the EC2 instance has an IAM role with ses:SendEmail, no extra config needed.
// Otherwise set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY in .env
const ses  = new SESClient({ region: process.env.AWS_REGION || 'ap-south-1' });
const FROM = process.env.SENDER_EMAIL || 'tech@dhanam.finance';
const PORT = parseInt(process.env.PORT || '3002', 10);

// ── Express Setup ─────────────────────────────────────────────────────────────
const app = express();
app.use(express.json({ limit: '2mb' }));

// ── Firebase token middleware ─────────────────────────────────────────────────
async function verifyToken(req, res, next) {
  const header = req.headers.authorization || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing Authorization header' });
  try {
    req.firebaseUser = await admin.auth().verifyIdToken(token);
    next();
  } catch (err) {
    console.warn('[auth] Token rejected:', err.message);
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// ── SES send helper ───────────────────────────────────────────────────────────
async function sendViaSES({ to, subject, html }) {
  const toAddresses = Array.isArray(to) ? to : [to];
  await ses.send(new SendEmailCommand({
    Source:      FROM,
    Destination: { ToAddresses: toAddresses },
    Message: {
      Subject: { Data: subject,  Charset: 'UTF-8' },
      Body:    { Html: { Data: html, Charset: 'UTF-8' } },
    },
  }));
  return toAddresses;
}

// ── POST /api/notify ──────────────────────────────────────────────────────────
// Called by the frontend (emailNotifications.js) for all task notifications.
// Body: { to: string | string[], subject: string, html: string }
app.post('/api/notify', verifyToken, async (req, res) => {
  const { to, subject, html } = req.body || {};

  if (!to || !subject || !html) {
    return res.status(400).json({ error: 'Request body must include to, subject, and html' });
  }

  try {
    const recipients = await sendViaSES({ to, subject, html });
    console.log(`[notify] ✓ "${subject}" → ${recipients.join(', ')} (uid: ${req.firebaseUser.uid})`);
    res.json({ ok: true });
  } catch (err) {
    console.error('[notify] SES error:', err.message);
    res.status(500).json({ error: 'Failed to send email. Check SES configuration.' });
  }
});

// ── GET /api/health ───────────────────────────────────────────────────────────
// Used by nginx health checks and monitoring scripts.
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', ts: new Date().toISOString() });
});

// ── Start ─────────────────────────────────────────────────────────────────────
// IMPORTANT: bind to 127.0.0.1, not 0.0.0.0 — port 3002 must not be internet-accessible
app.listen(PORT, '127.0.0.1', () => {
  console.log(`[ddiary-server] Listening on 127.0.0.1:${PORT} — ${new Date().toISOString()}`);
});
