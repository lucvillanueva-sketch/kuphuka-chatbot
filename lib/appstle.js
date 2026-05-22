// Detect whether a customer has an active subscription based on Appstle order tags.
// We do NOT infer next order date — subscription frequency can be changed by the customer
// and inferring from history would give wrong dates. Direct to portal instead.

function detectSubscriptionFromOrders(orders) {
  if (!orders || !orders.length) return null;

  const subOrders = orders
    .filter(o => (o.tags || '').toLowerCase().includes('appstle_subscription'))
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  if (!subOrders.length) return null;

  const lastDate = new Date(subOrders[0].created_at).toLocaleDateString('es-ES', {
    day: 'numeric', month: 'long', year: 'numeric',
  });

  return `SUSCRIPCIÓN DEL CLIENTE:\nTiene una suscripción activa. Último pedido de suscripción: ${lastDate}.\nNOTA: La fecha exacta del próximo pedido y la frecuencia actual no están disponibles en este sistema — el cliente debe consultarlas en su portal: https://kuphuka.com/account/login`;
}

module.exports = { detectSubscriptionFromOrders };
