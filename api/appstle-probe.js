// Temporary diagnostic endpoint — tests Shopify GraphQL subscription contracts
// Usage: POST /api/appstle-probe with { "email": "customer@email.com" }

const DOMAIN = process.env.SHOPIFY_STORE_DOMAIN || 'kuphuka.myshopify.com';

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: 'email required' });

  const token = process.env.SHOPIFY_ACCESS_TOKEN;
  if (!token) return res.status(500).json({ error: 'SHOPIFY_ACCESS_TOKEN not set' });

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

  try {
    const r = await fetch(`https://${DOMAIN}/admin/api/2024-01/graphql.json`, {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables: { query: `email:${email}` } }),
    });

    const data = await r.json();
    res.status(200).json({ status: r.status, data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
