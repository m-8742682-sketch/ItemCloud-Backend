// api/send-verify.js
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

// Allow dev + prod origins to call this API
const ALLOWED = [
  'http://localhost:5173',
  'https://itemcloud-backend-zeta.vercel.app',
  'https://itemcloud-9a47f.web.app',
  'https://itemcloud-9a47f.firebaseapp.com',
];

// Optional: two redirect bases (prod + alt/dev)
const APP_URL_MAIN = process.env.APP_URL_MAIN || process.env.APP_URL || 'http://localhost:5173';
const APP_URL_ALT  = process.env.APP_URL_ALT  || 'http://localhost:5173';

// Small helper: choose redirect base
function pickRedirectBase({ origin, bodyApp }) {
  // 1) if client asked explicitly
  if (bodyApp === 'main') return APP_URL_MAIN;
  if (bodyApp === 'alt')  return APP_URL_ALT;

  // 2) otherwise, trust the Origin if it is allowed
  if (origin && ALLOWED.includes(origin)) {
    return origin;
  }

  // 3) fallback to MAIN
  return APP_URL_MAIN;
}

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
    // Basic env sanity check
    const envOk = {
      FIREBASE_PROJECT_ID: !!process.env.FIREBASE_PROJECT_ID,
      FIREBASE_CLIENT_EMAIL: !!process.env.FIREBASE_CLIENT_EMAIL,
      FIREBASE_PRIVATE_KEY: !!process.env.FIREBASE_PRIVATE_KEY,
      APP_URL_MAIN: !!APP_URL_MAIN,
      APP_URL_ALT:  !!APP_URL_ALT,
    };
    if (Object.values(envOk).some(v => !v)) {
      return res.status(500).json({ error: 'Missing env', envOk });
    }

    // Verify caller ID token
    const authHeader = req.headers.authorization || '';
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!idToken) return res.status(401).json({ error: 'Missing auth token' });

    const decoded = await admin.auth().verifyIdToken(idToken);
    const user = await admin.auth().getUser(decoded.uid);
    if (!user.email) return res.status(400).json({ error: 'User has no email' });

    // Parse body (may be empty)
    let body = {};
    try { body = req.body && typeof req.body === 'object' ? req.body : JSON.parse(req.body || '{}'); }
    catch { body = {}; }

    // Choose redirect base (Origin or explicit)
    const redirectBase = pickRedirectBase({ origin, bodyApp: body.app });

    const actionCodeSettings = {
      url: `${redirectBase.replace(/\/+$/, '')}/login`, // ensure no trailing slash dupes
      handleCodeInApp: false,
    };

    const link = await admin.auth().generateEmailVerificationLink(user.email, actionCodeSettings);

    // Return details for client-side mailer (EmailJS etc.)
    return res.status(200).json({
      ok: true,
      link,
      to: user.email,
      to_name: user.displayName || 'there',
      redirectBase,
    });
  } catch (e) {
    console.error('[send-verify] error:', e);
    // Normalize Firebase rate limit to something readable if you ever add throttling again
    const msg = String(e?.message || '');
    if (msg.includes('TOO_MANY_ATTEMPTS_TRY_LATER')) {
      return res.status(429).json({ error: 'RATE_LIMIT', message: 'Too many attempts. Try again later.' });
    }
    return res.status(500).json({ error: e?.message || 'Internal error' });
  }
}
