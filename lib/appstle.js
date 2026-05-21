// Appstle Subscriptions API helpers
// Base URL confirmed: https://subscription-admin.appstle.com/api/external/v2/
// Auth: X-API-Key header

const BASE_URL = 'https://subscription-admin.appstle.com/api/external/v2';
const SHOP = process.env.SHOPIFY_STORE_DOMAIN || 'kuphuka.myshopify.com';

function getAppstleKey() {
  const key = process.env.APPSTLE_API_KEY;
  if (!key) throw new Error('APPSTLE_API_KEY env var not set');
  return key;
}

function headers() {
  return {
    'X-API-Key': getAppstleKey(),
    'Content-Type': 'application/json',
  };
}

// Fetch subscriptions for a customer by email
async function lookupSubscriptions(email) {
  const params = new URLSearchParams({ customerEmail: email, shopName: SHOP });
  const url = `${BASE_URL}/subscriptionContracts?${params}`;
  console.log('Appstle lookup URL:', url);

  const res = await fetch(url, { headers: headers() });
  const text = await res.text();
  console.log('Appstle response status:', res.status);
  console.log('Appstle response body:', text.slice(0, 500));

  if (!res.ok) {
    throw new Error(`Appstle lookup failed (${res.status}): ${text}`);
  }

  let data;
  try { data = JSON.parse(text); } catch { throw new Error('Appstle returned non-JSON: ' + text.slice(0, 200)); }

  // Handle both array response and { content: [...] } paginated response
  const contracts = Array.isArray(data) ? data : (data.content || data.subscriptionContracts || data.data || []);
  return contracts;
}

const STATUS_LABEL = {
  ACTIVE: 'Activa ✅',
  PAUSED: 'Pausada ⏸',
  CANCELLED: 'Cancelada ❌',
  EXPIRED: 'Expirada',
  FAILED: 'Error de pago ⚠️',
};

function formatSubscription(contract) {
  const status = STATUS_LABEL[contract.status] || contract.status;
  const nextDate = contract.nextBillingDate || contract.nextOrderDate || contract.next_billing_date;
  const frequency = contract.billingIntervalCount && contract.billingInterval
    ? `cada ${contract.billingIntervalCount} ${contract.billingInterval.toLowerCase()}`
    : null;

  const productTitle = contract.subscriptionContractProductDtos?.[0]?.productTitle
    || contract.lineItems?.[0]?.title
    || contract.products?.[0]?.title
    || null;

  let lines = [`Suscripción ID: ${contract.id}`];
  lines.push(`Estado suscripción: ${status}`);
  if (nextDate) lines.push(`Próximo pedido: ${new Date(nextDate).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })}`);
  if (frequency) lines.push(`Frecuencia: ${frequency}`);
  if (productTitle) lines.push(`Producto suscrito: ${productTitle}`);

  return lines.join('\n');
}

function buildSubscriptionContext(contracts) {
  const active = contracts.filter(c => c.status === 'ACTIVE' || c.status === 'PAUSED');
  if (!active.length) return null;
  const summaries = active.slice(0, 2).map(formatSubscription);
  return `SUSCRIPCIÓN DEL CLIENTE:\n${summaries.join('\n\n')}`;
}

// --- Write actions (Phase 2) ---

async function skipNextOrder(contractId) {
  const url = `${BASE_URL}/subscriptionContracts/${contractId}/skipNextOrder`;
  const res = await fetch(url, { method: 'POST', headers: headers() });
  const text = await res.text();
  if (!res.ok) throw new Error(`Skip failed (${res.status}): ${text}`);
  return JSON.parse(text);
}

async function pauseSubscription(contractId) {
  const url = `${BASE_URL}/subscriptionContracts/${contractId}/pauseContract`;
  const res = await fetch(url, { method: 'POST', headers: headers() });
  const text = await res.text();
  if (!res.ok) throw new Error(`Pause failed (${res.status}): ${text}`);
  return JSON.parse(text);
}

async function resumeSubscription(contractId) {
  const url = `${BASE_URL}/subscriptionContracts/${contractId}/activateContract`;
  const res = await fetch(url, { method: 'POST', headers: headers() });
  const text = await res.text();
  if (!res.ok) throw new Error(`Resume failed (${res.status}): ${text}`);
  return JSON.parse(text);
}

async function changeNextBillingDate(contractId, newDate) {
  // newDate: ISO string or YYYY-MM-DD
  const url = `${BASE_URL}/subscriptionContracts/${contractId}`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: headers(),
    body: JSON.stringify({ nextBillingDate: newDate }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Date change failed (${res.status}): ${text}`);
  return JSON.parse(text);
}

module.exports = {
  lookupSubscriptions,
  buildSubscriptionContext,
  skipNextOrder,
  pauseSubscription,
  resumeSubscription,
  changeNextBillingDate,
};
