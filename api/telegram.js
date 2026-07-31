// Telegram webhook — receives the operator's replies and routes them
// into the live customer chat.
//
// Reply to any message in a session thread to write to that customer.
// Reply with /release (or /bot) to hand the conversation back to the bot.

const {
  getSession, saveSession, appendMessage, setHumanActive,
  sessionForTelegramMessage,
} = require('../lib/store');
const { sendToOperator } = require('../lib/telegram');

const SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  // Reject anything not signed with our webhook secret
  if (SECRET && req.headers['x-telegram-bot-api-secret-token'] !== SECRET) {
    console.warn('Telegram webhook: bad secret token');
    return res.status(401).end();
  }

  // Always 200 quickly — Telegram retries on non-2xx
  try {
    const msg = req.body?.message;
    const text = msg?.text?.trim();
    const repliedTo = msg?.reply_to_message?.message_id;

    if (!text) return res.status(200).json({ ok: true });

    if (!repliedTo) {
      await sendToOperator('ℹ️ Responde <i>a un mensaje</i> de la conversación para escribirle al cliente.');
      return res.status(200).json({ ok: true });
    }

    const sessionId = await sessionForTelegramMessage(repliedTo);
    if (!sessionId) {
      await sendToOperator('⚠️ No encuentro esa conversación (puede haber caducado tras 24h).');
      return res.status(200).json({ ok: true });
    }

    // Hand control back to the bot
    if (/^\/(release|bot|fin)\b/i.test(text)) {
      const sess = await setHumanActive(sessionId, false);
      sess.messages.push({
        role: 'system-notice',
        content: 'El asistente virtual continúa la conversación.',
        at: Date.now(),
      });
      await saveSession(sessionId, sess);
      await sendToOperator('🤖 Devuelto al bot. Seguirá respondiendo automáticamente.');
      return res.status(200).json({ ok: true });
    }

    // Normal reply — take over and deliver the message to the customer
    const sess = await getSession(sessionId);
    const wasBot = !sess.humanActive;
    sess.humanActive = true;
    sess.messages.push({ role: 'human', content: text, at: Date.now() });
    await saveSession(sessionId, sess);

    await sendToOperator(
      wasBot
        ? '✅ Enviado. Has tomado el control — el bot ya no responderá. Usa /release para devolvérselo.'
        : '✅ Enviado.'
    );
  } catch (err) {
    console.error('Telegram webhook error:', err);
  }

  return res.status(200).json({ ok: true });
};
