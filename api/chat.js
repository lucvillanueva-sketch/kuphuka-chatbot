const { SYSTEM_PROMPT } = require('../knowledge');
const { lookupOrders, buildCustomerContext, extractCredentials } = require('../lib/shopify');
const { detectSubscriptionFromOrders } = require('../lib/appstle');
const { kvEnabled, getSession, saveSession } = require('../lib/store');
const { notifyNewSession, notifyExchange, notifyAwaitingHuman } = require('../lib/telegram');

const ALLOWED_ORIGINS = [
  'https://kuphuka.com',
  'https://kuphuka.myshopify.com',
];

const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60 * 60 * 1000;
const ipMap = new Map();

// Track sessions seen by this instance — fires a new-session email on first contact
const seenSessions = new Set();

function isRateLimited(ip) {
  const now = Date.now();
  const entry = ipMap.get(ip);
  if (!entry || now > entry.resetTime) {
    ipMap.set(ip, { count: 1, resetTime: now + RATE_WINDOW_MS });
    return false;
  }
  if (entry.count >= RATE_LIMIT) return true;
  entry.count++;
  return false;
}

const ESCALATION_PHRASES = [
  'info@kuphuka.com',
  'no tengo esa información',
  'el equipo lo revisará',
  'escribirnos a',
  'soporte humano',
];

const USER_ESCALATION_PHRASES = [
  'hablar con humano', 'hablar con persona', 'agente humano',
  'persona real', 'speak to human', 'talk to someone', 'hablar con alguien',
];

function detectEscalation(reply, lastUserMessage) {
  const r = reply.toLowerCase();
  const u = lastUserMessage.toLowerCase();
  return ESCALATION_PHRASES.some(p => r.includes(p)) ||
    USER_ESCALATION_PHRASES.some(p => u.includes(p));
}

function cleanForTTS(text) {
  return text
    .replace(/[:\s]*https?:\/\/[^\s]+/g, '')
    .replace(/([a-zA-Z0-9._%+\-]+)@([a-zA-Z0-9.\-]+)\.([a-zA-Z]{2,})/g,
      (_, user, domain, tld) => `${user} arroba ${domain} punto ${tld}`)
    .replace(/€\s*([\d,.]+)/g, '$1 euros')
    .replace(/([\d,.]+)\s*€/g, '$1 euros')
    .replace(/(\d+)\s*h\b/g, '$1 horas')
    .replace(/(\d+)-(\d+)\s*h\b/g, '$1 a $2 horas')
    .replace(/(\d+)\s*min\b/gi, '$1 minutos')
    .replace(/(\d+)\s*s\b/g, '$1 segundos')
    .replace(/1-click/gi, 'un clic')
    .replace(/\bEE\.?UU\.?/gi, 'Estados Unidos')
    .replace(/\bmcg\b/gi, 'microgramos')
    .replace(/\bμg\b/g, 'microgramos')
    .replace(/\bkcal\b/gi, 'kilocalorías')
    .replace(/(\d+)\s*mg\b/gi, '$1 miligramos')
    .replace(/(\d+)\s*ml\b/gi, '$1 mililitros')
    .replace(/(\d+)\s*kg\b/gi, '$1 kilogramos')
    .replace(/(\d+)\s*gr?\b/gi, '$1 gramos')
    .replace(/\bUI\b/g, 'unidades internacionales')
    .replace(/\bCoQ\s*10\b/gi, 'Coenzima Q diez')
    .replace(/\betc\./gi, 'etcétera')
    .replace(/\bvs\.?\b/gi, 'versus')
    .replace(/\baprox\.?\b/gi, 'aproximadamente')
    .replace(/\bnº\b/gi, 'número')
    .replace(/Kuphuka/gi, 'Kufuka')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/#(\d+)/g, 'número $1')
    .replace(/[#•]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

async function logToAirtable(userMessage, botReply, escalated, sessionId) {
  const apiKey = process.env.AIRTABLE_API_KEY;
  const baseId = process.env.AIRTABLE_BASE_ID;
  if (!apiKey || !baseId) {
    console.error('Airtable: missing env vars - apiKey:', !!apiKey, 'baseId:', !!baseId);
    return;
  }
  const tableId = process.env.AIRTABLE_TABLE_ID || 'tbl5Aoa78BZ2kANnz';
  try {
    const res = await fetch(`https://api.airtable.com/v0/${baseId}/${tableId}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fields: {
          Date: new Date().toISOString(),
          'Customer Message': userMessage,
          'Bot Reply': botReply,
          Escalated: escalated,
          'Session ID': sessionId || '',
        },
      }),
    });
    const data = await res.json();
    if (!res.ok) console.error('Airtable HTTP error:', res.status, JSON.stringify(data));
    else console.log('Airtable logged OK, id:', data.id);
  } catch (err) {
    console.error('Airtable exception:', err.message);
  }
}

async function sendEscalationEmail(messages, botReply) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return;
  const transcript = [...messages, { role: 'assistant', content: botReply }]
    .map(m => `<tr>
      <td style="padding:6px 10px;color:#888;white-space:nowrap">${m.role === 'user' ? 'Cliente' : 'Bot'}</td>
      <td style="padding:6px 10px">${m.content.replace(/</g, '&lt;')}</td>
    </tr>`).join('');
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Kuphuka Chatbot <onboarding@resend.dev>',
        to: ['lucvillanueva@gmail.com'],
        subject: '⚠️ Cliente necesita ayuda humana — Kuphuka Chat',
        html: `
          <h2 style="color:#2a7d4f">Un cliente necesita atención humana</h2>
          <p><strong>Fecha:</strong> ${new Date().toLocaleString('es-ES', { timeZone: 'Europe/Madrid' })}</p>
          <h3>Conversación completa:</h3>
          <table style="border-collapse:collapse;width:100%;font-family:sans-serif;font-size:14px">${transcript}</table>
          <br><p style="color:#888;font-size:12px">Responde al cliente en info@kuphuka.com</p>
        `,
      }),
    });
    const data = await res.json();
    if (!res.ok) console.error('Resend HTTP error:', res.status, JSON.stringify(data));
    else console.log('Resend email sent OK, id:', data.id);
  } catch (err) {
    console.error('Resend exception:', err.message);
  }
}

async function sendNewSessionEmail(sessionId, firstMessage) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Kuphuka Chatbot <onboarding@resend.dev>',
        to: ['lucvillanueva@gmail.com'],
        subject: '💬 Nueva conversación — Kuphuka Chat',
        html: `
          <h2 style="color:#2a7d4f">Nueva conversación iniciada</h2>
          <p><strong>Fecha:</strong> ${new Date().toLocaleString('es-ES', { timeZone: 'Europe/Madrid' })}</p>
          <p><strong>Primer mensaje:</strong> ${firstMessage.replace(/</g, '&lt;')}</p>
          <p style="color:#aaa;font-size:11px">Session: ${sessionId}</p>
        `,
      }),
    });
    const data = await res.json();
    if (!res.ok) console.error('New session email error:', res.status, JSON.stringify(data));
    else console.log('New session email sent, id:', data.id);
  } catch (err) {
    console.error('New session email exception:', err.message);
  }
}

async function sendShopifyAlertEmail(errorMessage) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return;
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Kuphuka Chatbot <onboarding@resend.dev>',
        to: ['lucvillanueva@gmail.com'],
        subject: '🚨 Shopify Auth Error — Kuphuka Chatbot',
        html: `
          <h2 style="color:#e53e3e">Error de autenticación con Shopify</h2>
          <p><strong>Fecha:</strong> ${new Date().toLocaleString('es-ES', { timeZone: 'Europe/Madrid' })}</p>
          <p><strong>Error:</strong> ${String(errorMessage).replace(/</g, '&lt;')}</p>
          <p>El chatbot no puede acceder a datos de pedidos. Revisa las credenciales en Vercel (SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET).</p>
        `,
      }),
    });
  } catch (err) {
    console.error('Shopify alert email exception:', err.message);
  }
}

module.exports = async function handler(req, res) {
  const origin = req.headers.origin || '';

  res.setHeader(
    'Access-Control-Allow-Origin',
    ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]
  );
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';
  if (isRateLimited(ip)) {
    return res.status(429).json({ error: 'Too many requests. Please try again later.' });
  }

  const { messages, sessionId } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'Invalid messages' });
  }

  // Fire new-session email on first message of each unique session (non-blocking)
  if (sessionId && !seenSessions.has(sessionId) && messages.length === 1) {
    seenSessions.add(sessionId);
    sendNewSessionEmail(sessionId, messages[0]?.content || '').catch(() => {});
  } else if (sessionId) {
    seenSessions.add(sessionId);
  }

  const lastUserMessage = messages[messages.length - 1]?.content || '';

  // --- Live session: mirror to Telegram, honour operator takeover ---
  let liveSession = null;
  if (sessionId && kvEnabled()) {
    try {
      liveSession = await getSession(sessionId);

      // First contact — open the Telegram thread for this conversation
      if (!liveSession.rootMsgId) {
        liveSession.rootMsgId = await notifyNewSession(sessionId);
      }

      liveSession.messages.push({ role: 'user', content: lastUserMessage, at: Date.now() });
      await saveSession(sessionId, liveSession);

      // Operator is in control — stay silent and let them answer
      if (liveSession.humanActive) {
        await notifyAwaitingHuman(sessionId, lastUserMessage, liveSession.rootMsgId);
        return res.status(200).json({ humanMode: true });
      }
    } catch (err) {
      console.error('Live session error (non-fatal):', err.message);
      liveSession = null;
    }
  }

  const groqApiKey = process.env.GROQ_API_KEY;

  // Auto-inject customer order + subscription data if email found in conversation
  let customerContext = '';
  try {
    const { email, orderNumber } = extractCredentials(messages);
    if (email) {
      const allOrders = await lookupOrders(email.toLowerCase(), orderNumber, 10);
      const matchedOrders = orderNumber ? allOrders : allOrders.slice(0, 1);
      const orderCtx = matchedOrders.length ? buildCustomerContext(matchedOrders) : null;
      const subCtx = detectSubscriptionFromOrders(allOrders);
      if (orderCtx || subCtx) {
        customerContext = '\n\n' + [orderCtx, subCtx].filter(Boolean).join('\n\n') +
          '\n\nNOTA DEL SISTEMA: Los datos del cliente ya están verificados y cargados. NO vuelvas a pedir email ni número de pedido en esta conversación. Si aparece "Nombre del cliente", salúdale por su nombre de pila en este primer mensaje con sus datos y úsalo a lo largo de la conversación. Responde directamente usando los datos de arriba.';
        console.log(`Customer context: ${email} → orders:${allOrders.length} subCtx:${!!subCtx}`);
      }
    }
  } catch (err) {
    console.error('Customer context error (non-fatal):', err.message);
    if (/401|403|auth|token|credential/i.test(err.message)) {
      sendShopifyAlertEmail(err.message).catch(() => {});
    }
  }

  const systemContent = SYSTEM_PROMPT + customerContext +
    '\n\nIMPORTANTE: Responde siempre en máximo 2 frases cortas y directas. Sin listas, sin puntos, sin explicaciones largas. Ve al punto.' +
    (customerContext ? '\n\nREGLA ABSOLUTA: Para cualquier dato del pedido (precio, transportista, tipo de pedido, estado) usa EXCLUSIVAMENTE los valores exactos del bloque DATOS DEL CLIENTE de arriba. Si el dato no está ahí, di que no tienes esa información. Está prohibido inventar o suponer valores.' : '');

  const groqPayload = {
    messages: [{ role: 'system', content: systemContent }, ...messages.slice(-10)],
    max_tokens: 200,
    temperature: 0.7,
  };

  // Try 70b for quality; fall back to 8b if rate-limited or unavailable
  async function callGroq(model) {
    return fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${groqApiKey}` },
      body: JSON.stringify({ ...groqPayload, model, stream: true }),
    });
  }

  try {
    let groqRes = await callGroq('llama-3.3-70b-versatile');
    if (!groqRes.ok && (groqRes.status === 429 || groqRes.status >= 500)) {
      console.warn(`Groq 70b failed (${groqRes.status}), falling back to 8b`);
      groqRes = await callGroq('llama-3.1-8b-instant');
    }
    if (!groqRes.ok) {
      const errorText = await groqRes.text();
      console.error('Groq API error:', groqRes.status, errorText);
      return res.status(502).json({ error: 'Model unavailable' });
    }

    // Switch to Server-Sent Events streaming
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('X-Accel-Buffering', 'no');

    function sse(obj) {
      res.write('data: ' + JSON.stringify(obj) + '\n\n');
    }

    const elevenLabsKey = process.env.ELEVENLABS_API_KEY;
    const VOICE_ID = 'PksrhvpHrGUgesnsmLTX';

    // TTS a single sentence chunk; returns base64 audio or null
    async function ttsChunk(text) {
      if (!elevenLabsKey) return null;
      const cleaned = cleanForTTS(text).slice(0, 500);
      if (!cleaned.trim()) return null;
      try {
        const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`, {
          method: 'POST',
          headers: { 'xi-api-key': elevenLabsKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: cleaned,
            model_id: 'eleven_turbo_v2_5',
            voice_settings: { stability: 0.5, similarity_boost: 0.8, speed: 1.2 },
          }),
        });
        if (!r.ok) { console.error('TTS chunk failed:', r.status); return null; }
        const buf = await r.arrayBuffer();
        console.log(`TTS chunk OK — ${text.length} chars, ${buf.byteLength} bytes`);
        return Buffer.from(buf).toString('base64');
      } catch (e) { console.error('TTS chunk exception:', e.message); return null; }
    }

    // Read Groq SSE stream, buffer tokens, flush complete sentences to TTS
    const reader = groqRes.body.getReader();
    const decoder = new TextDecoder();
    let pending = '';   // raw bytes waiting to be parsed as SSE events
    let textBuf = '';   // tokens waiting for a sentence boundary
    let fullText = '';  // entire response accumulated for logging
    const MIN_SPLIT = 25; // minimum chars before splitting on punctuation

    try {
      outer: while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        pending += decoder.decode(value, { stream: true });

        let sep;
        while ((sep = pending.indexOf('\n\n')) !== -1) {
          const line = pending.slice(0, sep).trim();
          pending = pending.slice(sep + 2);

          if (!line.startsWith('data:')) continue;
          const raw = line.replace(/^data:\s*/, '');
          if (raw === '[DONE]') break outer;

          let token;
          try { token = JSON.parse(raw).choices?.[0]?.delta?.content || ''; }
          catch { continue; }
          if (!token) continue;

          textBuf += token;
          fullText += token;
          sse({ type: 'token', content: token }); // text appears in real time

          // Flush a complete sentence to TTS as soon as one is ready
          let m;
          while (textBuf.length >= MIN_SPLIT &&
                 (m = textBuf.match(/^(.{15,}?[.!?])(?:\s+|$)/s))) {
            const sentence = m[1].trim();
            textBuf = textBuf.slice(m[0].length);
            const audio = await ttsChunk(sentence);
            sse({ type: 'audio', data: audio });
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    // Flush any remaining text after stream ends
    if (textBuf.trim()) {
      const audio = await ttsChunk(textBuf.trim());
      sse({ type: 'audio', data: audio });
    }

    // Post-response: log + escalation (after streaming so it doesn't delay the client)
    const escalated = detectEscalation(fullText, lastUserMessage);
    const tasks = [logToAirtable(lastUserMessage, fullText, escalated, sessionId)];
    if (escalated) tasks.push(sendEscalationEmail(messages, fullText));

    // Mirror the exchange to Telegram so the operator can jump in
    if (liveSession) {
      liveSession.messages.push({ role: 'assistant', content: fullText, at: Date.now() });
      tasks.push(saveSession(sessionId, liveSession));
      tasks.push(notifyExchange(sessionId, lastUserMessage, fullText, liveSession.rootMsgId));
    }

    await Promise.allSettled(tasks);

    sse({ type: 'done', escalated });
    res.end();

  } catch (err) {
    console.error('Handler error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error' });
    } else {
      try {
        res.write('data: ' + JSON.stringify({ type: 'error', message: 'Internal server error' }) + '\n\n');
        res.end();
      } catch {}
    }
  }
};
