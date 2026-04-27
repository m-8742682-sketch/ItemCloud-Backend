module.exports = (req, res) => {
  if (req.method === 'HEAD') return res.status(200).end();
  if (req.method !== 'GET')  return res.status(405).json({ error: 'Use GET' });
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ ok: true, ts: Date.now() });
};
