
// api/ocr-card.js
import { createWorker } from 'tesseract.js';

// --- Configuration ---
// Adjust the allowed origins based on your .env.local:
const ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'https://itemcloud-9a47f.web.app',
  'https://itemcloud-9a47f.firebaseapp.com',
  // You might need to add other Vercel preview URLs if applicable
];

// --- Helper Functions ---

// Simple function to process and extract relevant data from the raw OCR text.
// This is highly dependent on the layout of your matric card.
function extractMatricCardInfo(ocrText) {
  const info = {};
  const lines = ocrText.split('\n').map(line => line.trim()).filter(line => line.length > 0);

  // Example logic:
  // 1. Look for a common label like "Student ID" or just a number pattern
  //    (e.g., 8-10 digit number)
  const idMatch = lines.join(' ').match(/(\d{8,10})/);
  if (idMatch) {
    info.studentId = idMatch[1];
  }

  // 2. Simple name extraction (often the first or second line)
  //    This is tricky without more context on your card layout.
  //    A better approach would involve template matching, but for a simple case:
  const nameLabel = lines.find(line => line.toLowerCase().includes('name'));
  if (nameLabel) {
    info.name = nameLabel.replace(/name\s*:\s*/i, '').trim();
  } else if (lines.length > 0) {
    // Fallback: assume the first non-ID, non-date line is the name
    const potentialName = lines.find(line => !/\d{8,10}/.test(line) && !/date|exp/i.test(line));
    if (potentialName) {
         info.name = potentialName.slice(0, 50); // Take a max of 50 characters
    }
  }

  return info;
}


// --- API Handler ---

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  } else {
    // Consider returning a 403 or just allowing the default Vercel CORS handling
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed. Use POST.' });

  try {
    const { imageUrl } = req.body;
    if (!imageUrl) {
      return res.status(400).json({ error: 'Missing imageUrl in request body.' });
    }
    
    // 1. Create Tesseract Worker
    const worker = await createWorker('eng'); // 'eng' for English, or use specific language if needed

    // 2. Run OCR on the image URL
    // Tesseract.js can directly fetch the image from a URL (e.g., Cloudinary URL)
    const { data: { text } } = await worker.recognize(imageUrl);

    // 3. Terminate worker to free up memory (important for serverless functions)
    await worker.terminate();

    // 4. Extract structured data from the raw text
    const extractedData = extractMatricCardInfo(text);

    // 5. Send the result back
    return res.status(200).json({ 
      ok: true,
      data: extractedData,
      rawOcrText: text, // Useful for debugging the extraction logic
    });

  } catch (e) {
    console.error('[ocr-card] error:', e);
    return res.status(500).json({ error: 'OCR processing failed', details: e.message });
  }
}