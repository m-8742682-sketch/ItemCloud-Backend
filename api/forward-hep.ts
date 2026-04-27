// /api/forward-hep.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import admin from 'firebase-admin';
import { google } from 'googleapis';

type HepReport = {
  reportId: string;
  itemId?: string;
  itemID?: string;   // accept either
  box?: string;
  boxId?: string;    // accept either
  uid?: string;
  name?: string;
  studentId?: string;
  contact?: string;
  email?: string;
  message?: string;
};

let app: admin.app.App | null = null;
function initAdmin() {
  if (app) return app;
  const { FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY } = process.env;
  if (!FIREBASE_PROJECT_ID || !FIREBASE_CLIENT_EMAIL || !FIREBASE_PRIVATE_KEY) {
    throw new Error('Missing Firebase Admin env');
  }
  app = admin.initializeApp({
    credential: admin.credential.cert({
      projectId: FIREBASE_PROJECT_ID,
      clientEmail: FIREBASE_CLIENT_EMAIL,
      privateKey: FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    }),
  });
  return app;
}

function b64url(s: string) {
  return Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function html(r: Partial<HepReport>) {
  const ItemID = r.itemId ?? r.itemID ?? '—';
  const Box = r.box ?? r.boxId ?? '—';
  const dash = '—';
  return `
  <div style="font-family:system-ui,Segoe UI,Arial,sans-serif;line-height:1.5">
    <h2 style="margin:0 0 16px">New HEP report from ${r.name || dash}</h2>

    <h3 style="margin:24px 0 8px">Item Details</h3>
    <table cellpadding="6" style="border-collapse:collapse">
      <tr><td><strong>Item ID</strong></td><td>${ItemID}</td></tr>
      <tr><td><strong>Box</strong></td><td>${Box}</td></tr>
    </table>

    <h3 style="margin:24px 0 8px">Reporter</h3>
    <table cellpadding="6" style="border-collapse:collapse">
      <tr><td><strong>Name</strong></td><td>${r.name || dash}</td></tr>
      <tr><td><strong>Student ID</strong></td><td>${r.studentId || dash}</td></tr>
      <tr><td><strong>Contact</strong></td><td>${r.contact || dash}</td></tr>
      <tr><td><strong>Email</strong></td><td>${r.email || dash}</td></tr>
      <tr><td><strong>UID</strong></td><td>${r.uid || dash}</td></tr>
    </table>

    <h3 style="margin:24px 0 8px">Message</h3>
    <p>${(r.message || dash).toString().replace(/\n/g,'<br/>')}</p>

    ${r.reportId ? `<p style="margin-top:24px;color:#555">ItemCloud report ID: <strong>${r.reportId}</strong></p>` : ''}
  </div>`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // --- CORS ---
  const allow = (process.env.CORS_ORIGINS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  const origin = (req.headers.origin as string) || '';
  if (origin && allow.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET,
      GMAIL_REFRESH_TOKEN,
      GMAIL_SENDER,
      HEP_TO_EMAIL,
    } = process.env;
    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GMAIL_REFRESH_TOKEN || !GMAIL_SENDER || !HEP_TO_EMAIL) {
      return res.status(500).json({ error: 'Server misconfigured: missing Gmail env' });
    }

    initAdmin();

    const auth = req.headers.authorization || '';
    const idToken = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!idToken) return res.status(401).json({ error: 'Missing Authorization' });
    const decoded = await admin.auth().verifyIdToken(idToken);

    const {
      subject = 'HEP report',
      report = {} as Partial<HepReport>,
      html: htmlOverride = '',
    } = (req.body ?? {}) as { subject?: string; report?: Partial<HepReport>; html?: string };

    // Email
    const bodyHtml = htmlOverride || html(report);
    const mime = `From: ${GMAIL_SENDER}
To: ${HEP_TO_EMAIL}
Subject: ${subject}
MIME-Version: 1.0
Content-Type: text/html; charset=UTF-8

${bodyHtml}
`;
    const oAuth2 = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
    oAuth2.setCredentials({ refresh_token: GMAIL_REFRESH_TOKEN });
    const gmail = google.gmail({ version: 'v1', auth: oAuth2 });
    const sent = await gmail.users.messages.send({ userId: 'me', requestBody: { raw: b64url(mime) } });

    // Notify admins
    const db = admin.firestore();
    const admins = await db.collection('Users').where('role', '==', 'admin').get();
    const batch = db.batch();
    const title = 'HEP forward';
    const message = `Report ${report.reportId || ''} forwarded to HEP successfully.`;
    const link = report.reportId ? `/admin/hep-reports/${report.reportId}` : '';
    admins.forEach(doc => {
      const ref = db.collection('Notifications').doc(doc.id).collection('items').doc();
      batch.set(ref, {
        title,
        message,
        link,
        read: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        fromUid: decoded.uid,
      });
    });
    await batch.commit();

    return res.status(200).json({ ok: true, gmailId: sent.data.id, notifiedAdmins: admins.size });
  } catch (e: any) {
    console.error('forward-hep error:', e?.response?.data || e?.message || e);
    const http = e?.response?.status || 500;
    const msg = e?.response?.data?.error?.message || e?.message || 'Unknown error';
    return res.status(http >= 400 && http < 600 ? http : 500).json({ error: msg });
  }
}
