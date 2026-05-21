// Temporary diagnostic endpoint — remove after Appstle integration is confirmed working
// Usage: POST /api/appstle-probe with { "email": "customer@email.com" }

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: 'email required' });

  const key = process.env.APPSTLE_API_KEY;
  const shop = process.env.SHOPIFY_STORE_DOMAIN || 'kuphuka.myshopify.com';

  if (!key) return res.status(500).json({ error: 'APPSTLE_API_KEY not set' });

  const BASE = 'https://subscription-admin.appstle.com/api/external/v2';
  const url = `${BASE}/subscriptionContracts?customerEmail=${encodeURIComponent(email)}&shopName=${shop}`;

  // Try different auth header formats
  const authVariants = [
    { 'X-API-Key': key },
    { 'x-api-key': key },
    { 'Authorization': `Bearer ${key}` },
    { 'Authorization': `Basic ${Buffer.from(key + ':').toString('base64')}` },
    { 'Authorization': key },
  ];

  const results = [];
  for (const authHeaders of authVariants) {
    try {
      const r = await fetch(url, { headers: { ...authHeaders, 'Content-Type': 'application/json' } });
      const text = await r.text();
      results.push({ auth: Object.keys(authHeaders)[0], status: r.status, body: text.slice(0, 400) });
      if (r.ok) break;
    } catch (err) {
      results.push({ auth: Object.keys(authHeaders)[0], error: err.message });
    }
  }

  res.status(200).json({ results });
};
