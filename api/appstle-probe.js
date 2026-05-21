// Temporary diagnostic endpoint — remove after Appstle integration is confirmed working
// Usage: POST /api/appstle-probe with { "email": "customer@email.com" }

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: 'email required' });

  const key = process.env.APPSTLE_API_KEY;
  const shop = process.env.SHOPIFY_STORE_DOMAIN || 'kuphuka.myshopify.com';

  if (!key) return res.status(500).json({ error: 'APPSTLE_API_KEY not set' });

  // Try multiple endpoint variants to find what works
  const variants = [
    `https://subscription-admin.appstle.com/api/external/v2/subscriptionContracts?customerEmail=${encodeURIComponent(email)}&shopName=${shop}`,
    `https://subscription-admin.appstle.com/api/external/v2/subscriptionContracts?email=${encodeURIComponent(email)}&shopName=${shop}`,
    `https://subscription-admin.appstle.com/api/external/v2/subscriptionContracts?customerEmail=${encodeURIComponent(email)}`,
    `https://subscription-admin.appstle.com/api/external/v2/subscription-contracts?customerEmail=${encodeURIComponent(email)}&shopName=${shop}`,
  ];

  const results = [];
  for (const url of variants) {
    try {
      const r = await fetch(url, { headers: { 'X-API-Key': key, 'Content-Type': 'application/json' } });
      const text = await r.text();
      results.push({ url, status: r.status, body: text.slice(0, 300) });
      if (r.ok) break; // stop at first success
    } catch (err) {
      results.push({ url, error: err.message });
    }
  }

  res.status(200).json({ results });
};
