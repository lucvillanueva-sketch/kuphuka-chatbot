// TEMPORARY diagnostic — verifies the Upstash connection end to end.
// Delete once the takeover setup is confirmed working.

module.exports = async function handler(req, res) {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;

  const out = {
    urlPresent: Boolean(url),
    tokenPresent: Boolean(token),
    urlHost: url ? String(url).replace(/^https?:\/\//, '').split('/')[0] : null,
    urlHasScheme: url ? /^https?:\/\//.test(url) : null,
    tokenLength: token ? token.length : 0,
    telegramTokenPresent: Boolean(process.env.TELEGRAM_BOT_TOKEN),
    telegramChatIdPresent: Boolean(process.env.TELEGRAM_CHAT_ID),
    telegramSecretPresent: Boolean(process.env.TELEGRAM_WEBHOOK_SECRET),
  };

  if (!url || !token) {
    return res.status(200).json({ ...out, verdict: 'Missing KV env vars' });
  }

  // Round-trip: SET then GET
  try {
    const setRes = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(['SET', 'probe:test', 'hello', 'EX', 60]),
    });
    out.setStatus = setRes.status;
    out.setBody = (await setRes.text()).slice(0, 300);

    const getRes = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(['GET', 'probe:test']),
    });
    out.getStatus = getRes.status;
    out.getBody = (await getRes.text()).slice(0, 300);

    out.verdict = out.getBody.includes('hello')
      ? 'OK — Upstash read/write working'
      : 'FAIL — see setBody/getBody';
  } catch (err) {
    out.verdict = 'EXCEPTION';
    out.error = err.message;
  }

  return res.status(200).json(out);
};
