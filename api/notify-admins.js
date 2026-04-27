// api/notify-admins.js
import admin from "firebase-admin";

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId:   process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey:  process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    }),
  });
}

const ALLOWED_ORIGINS = [
  "http://localhost:5173",
  "https://itemcloud-9a47f.web.app",
  "https://itemcloud-9a47f.firebaseapp.com",
];

export default async function handler(req, res) {
  const origin = req.headers.origin || "";
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Firebase-AppCheck"
  );
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")  return res.status(405).json({ error: "Method not allowed" });

  try {
    const authHeader = req.headers.authorization || "";
    const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!idToken) return res.status(401).json({ error: "Missing auth token" });

    // Verify the Firebase ID token
    const decoded = await admin.auth().verifyIdToken(idToken);

    const { title = "Update", message = "", link = "" } = req.body || {};

    const db = admin.firestore();
    // find admins
    const adminsSnap = await db.collection("Users").where("role", "==", "admin").get();

    const batch = db.batch();
    adminsSnap.forEach((doc) => {
      const ref = db.collection("Notifications").doc(doc.id).collection("items").doc();
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

    return res.status(200).json({ ok: true, sent: adminsSnap.size });
  } catch (e) {
    console.error("[notify-admins] error:", e);
    return res.status(500).json({ error: e?.message || "Internal error" });
  }
}
