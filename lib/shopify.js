// Shared Shopify helpers — token + order lookup

const DOMAIN = process.env.SHOPIFY_STORE_DOMAIN || 'kuphuka.myshopify.com';

function getShopifyToken() {
  // Use static access token (atkn_ format from Dev Dashboard)
  const token = process.env.SHOPIFY_ACCESS_TOKEN;
  if (!token) throw new Error('SHOPIFY_ACCESS_TOKEN env var not set');
  return token;
}

async function lookupOrders(email, orderNumber) {
  const token = getShopifyToken();

  // Query by email only (Shopify REST doesn't support filtering by order name)
  // We fetch up to 20 orders and filter by number client-side
  const params = new URLSearchParams({ status: 'any', limit: '20', email });

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
  let orders = data.orders || [];

  // Filter by order number if provided (order.name = "#1484", order.order_number = 1484)
  if (orderNumber) {
    const num = String(orderNumber).replace(/^#/, '');
    const matches = orders.filter(o =>
      String(o.order_number) === num || o.name === '#' + num
    );
    // Return matching order if found; otherwise return most recent 2 for context
    if (matches.length > 0) return matches;
  }

  return orders.slice(0, 2);
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
