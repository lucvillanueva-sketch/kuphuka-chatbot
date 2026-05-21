// Shared Shopify helpers — token exchange + order lookup

const DOMAIN = process.env.SHOPIFY_STORE_DOMAIN || 'kuphuka.myshopify.com';

// In-memory token cache (per serverless instance)
let _tokenCache = { token: null, expiresAt: 0 };

async function getShopifyToken() {
  const now = Date.now();
  // Reuse cached token if still valid with a 5-min safety buffer
  if (_tokenCache.token && now < _tokenCache.expiresAt - 5 * 60 * 1000) {
    return _tokenCache.token;
  }

  const res = await fetch(`https://${DOMAIN}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.SHOPIFY_CLIENT_ID,
      client_secret: process.env.SHOPIFY_CLIENT_SECRET,
      grant_type: 'client_credentials',
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Shopify token exchange failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  _tokenCache = {
    token: data.access_token,
    expiresAt: now + (data.expires_in || 86399) * 1000,
  };
  return _tokenCache.token;
}

async function lookupOrders(email, orderNumber) {
  const token = await getShopifyToken();

  // Build REST query — filter by email; optionally narrow by order name
  const params = new URLSearchParams({
    status: 'any',
    limit: '5',
    email,
  });
  if (orderNumber) {
    // Shopify stores order names as "#1001" etc.
    params.set('name', '#' + String(orderNumber).replace(/^#/, ''));
  }

  const res = await fetch(
    `https://${DOMAIN}/admin/api/2024-01/orders.json?${params}`,
    {
      headers: {
        'X-Shopify-Access-Token': token,
        'Content-Type': 'application/json',
      },
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Shopify orders query failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  return data.orders || [];
}

function formatOrder(order) {
  const FULFILLMENT = {
    fulfilled: 'Enviado ✅',
    unfulfilled: 'Preparando pedido ⏳',
    partial: 'Enviado parcialmente',
    restocked: 'Devuelto',
  };
  const FINANCIAL = {
    paid: 'Pagado',
    pending: 'Pendiente de pago',
    refunded: 'Reembolsado',
    partially_refunded: 'Parcialmente reembolsado',
    voided: 'Cancelado',
  };
  const SHIPMENT = {
    in_transit: 'En tránsito 🚚',
    delivered: 'Entregado ✅',
    out_for_delivery: 'En reparto hoy 📦',
    attempted_delivery: 'Intento de entrega fallido',
    ready_for_pickup: 'Listo para recoger',
    label_printed: 'Etiqueta creada',
    label_purchased: 'Etiqueta creada',
    confirmed: 'Confirmado',
  };

  const date = new Date(order.created_at).toLocaleDateString('es-ES', {
    day: 'numeric', month: 'long', year: 'numeric',
  });

  const fulfillmentLabel = FULFILLMENT[order.fulfillment_status] || 'Preparando pedido ⏳';
  const financialLabel = FINANCIAL[order.financial_status] || order.financial_status;

  let lines = [
    `Pedido ${order.name} — ${date}`,
    `Estado: ${fulfillmentLabel} | Pago: ${financialLabel}`,
  ];

  // Add line items
  if (order.line_items && order.line_items.length > 0) {
    const items = order.line_items.map(i => `${i.name} x${i.quantity}`).join(', ');
    lines.push(`Productos: ${items}`);
  }

  // Add tracking if available
  if (order.fulfillments && order.fulfillments.length > 0) {
    const f = order.fulfillments[0];
    if (f.shipment_status) {
      lines.push(`Seguimiento: ${SHIPMENT[f.shipment_status] || f.shipment_status}`);
    }
    if (f.tracking_number) {
      lines.push(`Nº seguimiento: ${f.tracking_number}`);
    }
    if (f.tracking_url) {
      lines.push(`Link seguimiento: ${f.tracking_url}`);
    }
  }

  return lines.join('\n');
}

function buildCustomerContext(orders) {
  if (!orders.length) {
    return 'No se encontró ningún pedido con los datos proporcionados. Verifica el email y el número de pedido.';
  }
  const summaries = orders.slice(0, 3).map(formatOrder);
  return `DATOS DEL CLIENTE (obtenidos de Shopify):\n${summaries.join('\n\n')}`;
}

// Detect email + order number in recent messages
const EMAIL_RE = /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/;
const ORDER_RE = /\b#?(\d{3,6})\b/;

function extractCredentials(messages) {
  let email = null;
  let orderNumber = null;
  const recent = messages.slice(-8);
  for (const msg of recent) {
    if (msg.role !== 'user') continue;
    const em = msg.content.match(EMAIL_RE);
    const on = msg.content.match(ORDER_RE);
    if (em) email = em[0];
    if (on) orderNumber = on[1];
  }
  return { email, orderNumber };
}

module.exports = { getShopifyToken, lookupOrders, buildCustomerContext, extractCredentials };
