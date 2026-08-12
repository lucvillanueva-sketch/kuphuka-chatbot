// Telegram operator channel — notifies about live chats and lets the
// operator reply straight into the customer's widget.

const { linkTelegramMessage } = require('./store');

// Same quote-stripping as lib/store.js — pasted credentials often carry quotes
function cleanEnv(value) {
  return value ? String(value).trim().replace(/^['"]|['"]$/g, '').trim() : value;
}

const TOKEN = cleanEnv(process.env.TELEGRAM_BOT_TOKEN);
const CHAT_ID = cleanEnv(process.env.TELEGRAM_CHAT_ID);

function telegramEnabled() {
  return Boolean(TOKEN && CHAT_ID);
}

function esc(text) {
  return String(text).replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/&/g, '&amp;');
}

// Send a message to the operator. Returns the Telegram message_id so the
// caller can thread replies under it and map it back to a session.
async function sendToOperator(text, { sessionId, replyTo } = {}) {
  if (!telegramEnabled()) return null;
  try {
    const body = {
      chat_id: CHAT_ID,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    };
    if (replyTo) body.reply_to_message_id = replyTo;

    const res = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!data.ok) {
      console.error('Telegram send failed:', JSON.stringify(data));
      return null;
    }
    const messageId = data.result.message_id;
    if (sessionId) await linkTelegramMessage(messageId, sessionId);
    return messageId;
  } catch (err) {
    console.error('Telegram exception:', err.message);
    return null;
  }
}

// Opens the thread the operator replies into. Deliberately carries no
// customer text — each exchange is posted separately underneath it.
async function notifyNewSession(sessionId) {
  return sendToOperator(
    `💬 <b>Nueva conversación</b>\n` +
    `<code>${esc(sessionId)}</code>\n\n` +
    `<i>Responde a cualquier mensaje del hilo para escribirle al cliente.</i>`,
    { sessionId }
  );
}

// A completed bot exchange — operator can reply to jump in
async function notifyExchange(sessionId, customerMessage, botReply, rootMsgId) {
  return sendToOperator(
    `👤 ${esc(customerMessage)}\n` +
    `🤖 ${esc(botReply)}`,
    { sessionId, replyTo: rootMsgId }
  );
}

// Customer wrote while a human is in control — no bot reply is coming
async function notifyAwaitingHuman(sessionId, customerMessage, rootMsgId) {
  return sendToOperator(
    `👤 ${esc(customerMessage)}\n\n` +
    `⏳ <i>Esperando tu respuesta</i>`,
    { sessionId, replyTo: rootMsgId }
  );
}

module.exports = {
  telegramEnabled,
  sendToOperator,
  notifyNewSession,
  notifyExchange,
  notifyAwaitingHuman,
};
