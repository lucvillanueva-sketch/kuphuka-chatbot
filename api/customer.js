const { lookupOrders, buildCustomerContext } = require('../lib/shopify');

const ALLOWED_ORIGINS = [
  'https://kuphuka.com',
  'https://kuphuka.myshopify.com',
];

module.exports = async function handler(req, res) {
  const origin = req.headers.origin || '';
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { email, orderNumber } = req.body || {};

  if (!email || typeof email !== 'string') {
    return res.status(400).json({ error: 'Email requerido' });
  }

  try {
    const orders = await lookupOrders(email.trim().toLowerCase(), orderNumber);
    const context = buildCustomerContext(orders);
    res.status(200).json({ found: orders.length > 0, context });
  } catch (err) {
    console.error('Customer lookup error:', err.message);
    res.status(500).json({ error: 'No se pudo consultar el pedido. Por favor intenta de nuevo.' });
  }
};
