// Subscription inference from Shopify order history
// Appstle doesn't expose subscription contracts via Shopify's native API,
// so we infer next order date from the pattern of recurring orders.

// Infer subscription info from a list of Shopify orders
function inferSubscriptionFromOrders(orders) {
  if (!orders || !orders.length) return null;

  // Filter to subscription orders only (tagged by Appstle)
  const subOrders = orders
    .filter(o => (o.tags || '').toLowerCase().includes('appstle_subscription'))
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at)); // newest first

  if (!subOrders.length) return null;

  const lastOrder = subOrders[0];
  const lastDate = new Date(lastOrder.created_at);

  // Calculate interval from last two subscription orders if available
  let intervalDays = 30; // default assumption
  if (subOrders.length >= 2) {
    const prev = new Date(subOrders[1].created_at);
    const diffMs = lastDate - prev;
    const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays > 0 && diffDays <= 365) intervalDays = diffDays;
  }

  // Project next order date
  const nextDate = new Date(lastDate);
  nextDate.setDate(nextDate.getDate() + intervalDays);

  const lastDateStr = lastDate.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
  const nextDateStr = nextDate.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });

  const lines = [
    `Tipo de compra: Suscripción activa (pedidos recurrentes cada ~${intervalDays} días)`,
    `Último pedido de suscripción: ${lastDateStr}`,
    `Próximo pedido estimado: ${nextDateStr} (estimación basada en historial)`,
  ];

  return `SUSCRIPCIÓN DEL CLIENTE (inferida del historial):\n${lines.join('\n')}`;
}


module.exports = { inferSubscriptionFromOrders };
