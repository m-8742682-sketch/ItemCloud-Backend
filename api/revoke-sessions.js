// api/revoke-sessions.js
import admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  });
}

const ALLOWED = [
  'http://localhost:5173',
  'https://itemcloud-backend-zeta.vercel.app',
  'https://itemcloud-9a47f.web.app',
  'https://itemcloud-9a47f.firebaseapp.com',
];

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  if (ALLOWED.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const authHeader = req.headers.authorization || '';
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!idToken) return res.status(401).json({ error: 'Missing auth token' });

    const decoded = await admin.auth().verifyIdToken(idToken);
    await admin.auth().revokeRefreshTokens(decoded.uid);

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('[revoke-sessions] error:', e);
    return res.status(500).json({ error: e?.message || 'Internal error' });
  }
}
