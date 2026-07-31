// Widget polls this to pick up operator messages and takeover state.

const { getSession, kvEnabled } = require('../lib/store');

const ALLOWED_ORIGINS = [
  'https://kuphuka.com',
  'https://kuphuka.myshopify.com',
];

module.exports = async function handler(req, res) {
  const origin = req.headers.origin || '';
  res.setHeader(
    'Access-Control-Allow-Origin',
    ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]
  );
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).end();

  // Store not configured — tell the widget to stop polling
  if (!kvEnabled()) {
    return res.status(200).json({ enabled: false, messages: [], humanActive: false, cursor: 0 });
  }

  const sessionId = req.query?.sessionId;
  const since = parseInt(req.query?.since, 10) || 0;
  if (!sessionId) return res.status(400).json({ error: 'Missing sessionId' });

  try {
    const sess = await getSession(sessionId);
    const all = sess.messages || [];

    // Only operator messages and takeover notices are pushed to the widget;
    // customer/bot turns are already rendered client-side.
    const fresh = all
      .slice(since)
      .filter(m => m.role === 'human' || m.role === 'system-notice')
      .map(m => ({ role: m.role, content: m.content }));

    return res.status(200).json({
      enabled: true,
      messages: fresh,
      humanActive: Boolean(sess.humanActive),
      cursor: all.length,
    });
  } catch (err) {
    console.error('Poll error:', err.message);
    return res.status(200).json({ enabled: true, messages: [], humanActive: false, cursor: since });
  }
};
