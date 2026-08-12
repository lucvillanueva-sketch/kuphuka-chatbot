// Live-session store backed by Vercel KV (Upstash Redis REST API).
// Degrades to a no-op when KV env vars are absent, so the bot keeps
// working exactly as before if the store is unconfigured.

// Credentials copied from Upstash's .env-style panel often arrive wrapped in
// quotes; strip them (and stray whitespace) so the value is usable as-is.
function cleanEnv(value) {
  return value ? String(value).trim().replace(/^['"]|['"]$/g, '').trim() : value;
}

const KV_URL = cleanEnv(process.env.KV_REST_API_URL);
const KV_TOKEN = cleanEnv(process.env.KV_REST_API_TOKEN);
const TTL = 86400; // sessions expire after 24h

function kvEnabled() {
  return Boolean(KV_URL && KV_TOKEN);
}

async function kv(command) {
  if (!kvEnabled()) return null;
  try {
    const res = await fetch(KV_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(command),
    });
    if (!res.ok) {
      console.error('KV error:', res.status, await res.text());
      return null;
    }
    const data = await res.json();
    return data.result;
  } catch (err) {
    console.error('KV exception:', err.message);
    return null;
  }
}

const EMPTY = { messages: [], humanActive: false, rootMsgId: null };

async function getSession(sessionId) {
  const raw = await kv(['GET', `sess:${sessionId}`]);
  if (!raw) return { ...EMPTY };
  try { return { ...EMPTY, ...JSON.parse(raw) }; } catch { return { ...EMPTY }; }
}

async function saveSession(sessionId, data) {
  // Cap stored transcript so a long chat can't grow without bound
  const trimmed = { ...data, messages: (data.messages || []).slice(-60) };
  return kv(['SET', `sess:${sessionId}`, JSON.stringify(trimmed), 'EX', TTL]);
}

// Append a message and return the updated session
async function appendMessage(sessionId, role, content) {
  const sess = await getSession(sessionId);
  sess.messages.push({ role, content, at: Date.now() });
  await saveSession(sessionId, sess);
  return sess;
}

async function setHumanActive(sessionId, active) {
  const sess = await getSession(sessionId);
  sess.humanActive = active;
  await saveSession(sessionId, sess);
  return sess;
}

// Map a Telegram message id back to its session, so replying to any
// message in the thread routes to the right customer
async function linkTelegramMessage(messageId, sessionId) {
  return kv(['SET', `tg:${messageId}`, sessionId, 'EX', TTL]);
}

async function sessionForTelegramMessage(messageId) {
  return kv(['GET', `tg:${messageId}`]);
}

module.exports = {
  kvEnabled,
  getSession,
  saveSession,
  appendMessage,
  setHumanActive,
  linkTelegramMessage,
  sessionForTelegramMessage,
};
