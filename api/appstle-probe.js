// Temporary diagnostic endpoint — tests Shopify GraphQL subscription contracts
// Usage: POST /api/appstle-probe with { "email": "customer@email.com" }

const DOMAIN = process.env.SHOPIFY_STORE_DOMAIN || 'kuphuka.myshopify.com';

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: 'email required' });

  const token = process.env.SHOPIFY_ACCESS_TOKEN;
  const clientId = process.env.SHOPIFY_CLIENT_ID || process.env.SHOPIFY_API_KEY;
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET || process.env.SHOPIFY_API_SECRET;
  if (!token && !clientId) return res.status(500).json({ error: 'No Shopify credentials found' });
  const tokenDebug = token ? `${token.slice(0, 8)}... (${token.length} chars)` : 'not set';
  const credsDebug = { clientId: clientId ? clientId.slice(0, 8) + '...' : 'not set', clientSecret: clientSecret ? clientSecret.slice(0, 8) + '...' : 'not set' };
  const domainDebug = DOMAIN;

  const query = `
    query GetCustomerSubscriptions($query: String!) {
      customers(first: 1, query: $query) {
        edges {
          node {
            id
            firstName
            lastName
            email
            subscriptionContracts(first: 5) {
              edges {
                node {
                  id
                  status
                  nextBillingDate
                  billingPolicy {
                    interval
                    intervalCount
                  }
                  lines(first: 5) {
                    edges {
                      node {
                        title
                        quantity
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  `;

  const results = {};

  // Test 0: OAuth client_credentials exchange to get an access token
  let exchangedToken = null;
  if (clientId && clientSecret) {
    try {
      const r0 = await fetch(`https://${DOMAIN}/admin/oauth/access_token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, grant_type: 'client_credentials' }),
      });
      const d0 = await r0.json();
      results.oauth_exchange = { status: r0.status, data: d0 };
      if (r0.ok && d0.access_token) exchangedToken = d0.access_token;
    } catch (err) { results.oauth_exchange = { error: err.message }; }
  }

  // Use exchanged token if available, else fall back to stored token
  const activeToken = exchangedToken || token;

  // Test 1: REST API with X-Shopify-Access-Token (this worked before)
  try {
    const r1 = await fetch(`https://${DOMAIN}/admin/api/2024-01/shop.json`, {
      headers: { 'X-Shopify-Access-Token': activeToken },
    });
    results.rest_header = { status: r1.status, ok: r1.ok };
  } catch (err) { results.rest_header = { error: err.message }; }

  // Test 2: GraphQL with X-Shopify-Access-Token
  try {
    const r2 = await fetch(`https://${DOMAIN}/admin/api/2024-01/graphql.json`, {
      method: 'POST',
      headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables: { query: `email:${email}` } }),
    });
    const d2 = await r2.json();
    results.graphql_header = { status: r2.status, data: d2 };
  } catch (err) { results.graphql_header = { error: err.message }; }

  // Test 3: GraphQL with Authorization: Bearer
  try {
    const r3 = await fetch(`https://${DOMAIN}/admin/api/2024-01/graphql.json`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables: { query: `email:${email}` } }),
    });
    const d3 = await r3.json();
    results.graphql_bearer = { status: r3.status, data: d3 };
  } catch (err) { results.graphql_bearer = { error: err.message }; }

  res.status(200).json({ tokenDebug, credsDebug, domainDebug, exchangedToken: exchangedToken ? exchangedToken.slice(0,8)+'...' : null, results });
};
