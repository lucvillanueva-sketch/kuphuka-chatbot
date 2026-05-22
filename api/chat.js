const { SYSTEM_PROMPT } = require('../knowledge');
const { lookupOrders, buildCustomerContext, extractCredentials } = require('../lib/shopify');
const { detectSubscriptionFromOrders } = require('../lib/appstle');

const ALLOWED_ORIGINS = [
  'https://kuphuka.com',
  'https://kuphuka.myshopify.com',
];

const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60 * 60 * 1000;
const ipMap = new Map();

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
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
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
    if (!res.ok) {
      console.error('Airtable HTTP error:', res.status, JSON.stringify(data));
    } else {
      console.log('Airtable logged OK, id:', data.id);
    }
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
    </tr>`)
    .join('');

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Kuphuka Chatbot <onboarding@resend.dev>',
        to: ['lucvillanueva@gmail.com'],
        subject: '⚠️ Cliente necesita ayuda humana — Kuphuka Chat',
        html: `
          <h2 style="color:#2a7d4f">Un cliente necesita atención humana</h2>
          <p><strong>Fecha:</strong> ${new Date().toLocaleString('es-ES', { timeZone: 'Europe/Madrid' })}</p>
          <h3>Conversación completa:</h3>
          <table style="border-collapse:collapse;width:100%;font-family:sans-serif;font-size:14px">
            ${transcript}
          </table>
          <br>
          <p style="color:#888;font-size:12px">Responde al cliente en info@kuphuka.com</p>
        `,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      console.error('Resend HTTP error:', res.status, JSON.stringify(data));
    } else {
      console.log('Resend email sent OK, id:', data.id);
    }
  } catch (err) {
    console.error('Resend exception:', err.message);
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

  const groqApiKey = process.env.GROQ_API_KEY;

  // Auto-inject customer order + subscription data if email found in conversation
  let customerContext = '';
  try {
    const { email, orderNumber } = extractCredentials(messages);
    if (email) {
      // Fetch last 10 orders for this customer (used for both order details and subscription inference)
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
  }

  const systemContent = SYSTEM_PROMPT + customerContext +
    '\n\nIMPORTANTE: Responde siempre en máximo 2 frases cortas y directas. Sin listas, sin puntos, sin explicaciones largas. Ve al punto.' +
    (customerContext ? '\n\nREGLA ABSOLUTA: Para cualquier dato del pedido (precio, transportista, tipo de pedido, estado) usa EXCLUSIVAMENTE los valores exactos del bloque DATOS DEL CLIENTE de arriba. Si el dato no está ahí, di que no tienes esa información. Está prohibido inventar o suponer valores.' : '');

  const groqPayload = {
    messages: [
      { role: 'system', content: systemContent },
      ...messages.slice(-10),
    ],
    max_tokens: 200,
    temperature: 0.7,
  };

  // Try 70b for quality; fall back to 8b if rate-limited or unavailable
  async function callGroq(model) {
    return fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${groqApiKey}` },
      body: JSON.stringify({ ...groqPayload, model }),
    });
  }

  try {
    let response = await callGroq('llama-3.3-70b-versatile');

    // Fall back to fast 8b model on rate-limit or server error
    if (!response.ok && (response.status === 429 || response.status >= 500)) {
      console.warn(`Groq 70b failed (${response.status}), falling back to 8b`);
      response = await callGroq('llama-3.1-8b-instant');
    }

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Groq API error:', response.status, errorText);
      return res.status(502).json({ error: 'Model unavailable' });
    }

    const data = await response.json();
    const reply = data.choices?.[0]?.message?.content || 'Lo siento, no pude generar una respuesta en este momento.';

    function cleanForTTS(text) {
      return text
        .replace(/https?:\/\/[^\s]+/g, '')                        // remove URLs
        .replace(/([a-zA-Z0-9._%+\-]+)@([a-zA-Z0-9.\-]+)\.([a-zA-Z]{2,})/g,
          (_, user, domain, tld) => `${user} arroba ${domain} punto ${tld}`) // info@kuphuka.com → info arroba kuphuka punto com
        .replace(/€\s*([\d,.]+)/g, '$1 euros')                    // €39 → 39 euros
        .replace(/([\d,.]+)\s*€/g, '$1 euros')                    // 39€ → 39 euros
        .replace(/(\d+)\s*h\b/g, '$1 horas')                      // 24h → 24 horas
        .replace(/(\d+)-(\d+)\s*h\b/g, '$1 a $2 horas')           // 24-48h → 24 a 48 horas
        .replace(/(\d+)\s*min\b/gi, '$1 minutos')                  // 30min → 30 minutos
        .replace(/(\d+)\s*s\b/g, '$1 segundos')                   // 10s → 10 segundos
        .replace(/1-click/gi, 'un clic')                          // 1-click → un clic
        // Acronyms & units
        .replace(/\bEE\.?UU\.?/gi, 'Estados Unidos')              // EEUU / EE.UU.
        .replace(/\bmcg\b/gi, 'microgramos')                      // mcg → microgramos
        .replace(/\bμg\b/g, 'microgramos')                        // μg → microgramos
        .replace(/\bkcal\b/gi, 'kilocalorías')                    // kcal → kilocalorías
        .replace(/(\d+)\s*mg\b/gi, '$1 miligramos')               // 50mg → 50 miligramos
        .replace(/(\d+)\s*ml\b/gi, '$1 mililitros')               // 200ml → 200 mililitros
        .replace(/(\d+)\s*kg\b/gi, '$1 kilogramos')               // 2kg → 2 kilogramos
        .replace(/(\d+)\s*gr?\b/gi, '$1 gramos')                  // 13g / 13gr → 13 gramos
        .replace(/\bUI\b/g, 'unidades internacionales')           // UI → unidades internacionales
        .replace(/\bCoQ\s*10\b/gi, 'Coenzima Q diez')             // CoQ10 → Coenzima Q diez
        .replace(/\betc\./gi, 'etcétera')                         // etc. → etcétera
        .replace(/\bvs\.?\b/gi, 'versus')                         // vs / vs. → versus
        .replace(/\baprox\.?\b/gi, 'aproximadamente')             // aprox → aproximadamente
        .replace(/\bnº\b/gi, 'número')                            // nº → número
        // Brand & markdown
        .replace(/Kuphuka/gi, 'Kufuka')                           // fix brand pronunciation
        .replace(/\*\*(.*?)\*\*/g, '$1')                          // strip bold markdown
        .replace(/\*(.*?)\*/g, '$1')                              // strip italic markdown
        .replace(/#(\d+)/g, 'número $1')                          // #1042 → número 1042
        .replace(/[#•]/g, '')                                     // strip remaining markdown symbols
        .replace(/\s{2,}/g, ' ')                                  // collapse extra spaces
        .trim();
    }

    const lastUserMessage = messages[messages.length - 1]?.content || '';
    const escalated = detectEscalation(reply, lastUserMessage);

    // Run logging and TTS in parallel
    const elevenLabsKey = process.env.ELEVENLABS_API_KEY;
    const VOICE_ID = 'PksrhvpHrGUgesnsmLTX';

    const tasks = [logToAirtable(lastUserMessage, reply, escalated, sessionId)];
    if (escalated) tasks.push(sendEscalationEmail(messages, reply));

    let audioBase64 = null;
    if (elevenLabsKey) {
      const [logResult, ttsResult] = await Promise.allSettled([
        Promise.allSettled(tasks),
        fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`, {
          method: 'POST',
          headers: {
            'xi-api-key': elevenLabsKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            text: cleanForTTS(reply).slice(0, 1000),
            model_id: 'eleven_turbo_v2_5',
            voice_settings: { stability: 0.5, similarity_boost: 0.8, speed: 1.2 },
          }),
        }),
      ]);

      if (ttsResult.status === 'fulfilled' && ttsResult.value.ok) {
        const audioBuffer = await ttsResult.value.arrayBuffer();
        audioBase64 = Buffer.from(audioBuffer).toString('base64');
        console.log(`TTS OK — ${reply.length} chars, ${audioBuffer.byteLength} bytes`);
      } else {
        console.error('TTS failed:', ttsResult.reason || ttsResult.value?.status);
        await Promise.allSettled(tasks);
      }
    } else {
      await Promise.allSettled(tasks);
    }

    res.status(200).json({ message: reply, audio: audioBase64 });
  } catch (err) {
    console.error('Handler error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};
