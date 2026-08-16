// LLM provider abstraction.
//
// Groq decommissioned llama-3.3-70b-versatile and llama-3.1-8b-instant with no
// warning, taking the bot down entirely because both the primary and the
// fallback were Groq models. Providers are now declared in a list and tried in
// order, so losing one is a degraded service rather than an outage.
//
// Every provider normalises to the same interface: given messages, return an
// async iterator of text tokens. Callers never see provider-specific formats.

function cleanEnv(value) {
  return value ? String(value).trim().replace(/^['"]|['"]$/g, '').trim() : value;
}

// ---------------------------------------------------------------------------
// Provider definitions
// ---------------------------------------------------------------------------

// Ollama Cloud — native NDJSON streaming (one JSON object per line).
// Note: ollama.com does NOT serve the OpenAI-compatible /v1 route; only
// /api/chat is available on the hosted API.
const ollama = {
  name: 'ollama',
  get key() { return cleanEnv(process.env.OLLAMA_API_KEY); },
  // kimi-k3 and deepseek-v4-pro are excluded: they bill as "extra usage"
  // outside the Pro plan and return 402 when that balance is empty.
  models: (cleanEnv(process.env.OLLAMA_MODELS) || 'glm-5.2,qwen3.5:397b,gemma4:31b').split(','),
  async call(model, messages, maxTokens) {
    return fetch('https://ollama.com/api/chat', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model.trim(),
        messages,
        stream: true,
        // MUST stay false. These are reasoning models: with thinking enabled
        // GLM 5.2 emits hundreds of chars of `thinking` and NO `content`,
        // i.e. the customer gets an empty reply. Verified against the live API.
        think: false,
        options: { temperature: 0.7, num_predict: maxTokens },
      }),
    });
  },
  // NDJSON: {"message":{"content":"..."},"done":false}
  parse(buffer) {
    const tokens = [];
    let rest = buffer;
    let nl;
    while ((nl = rest.indexOf('\n')) !== -1) {
      const line = rest.slice(0, nl).trim();
      rest = rest.slice(nl + 1);
      if (!line) continue;
      try {
        const obj = JSON.parse(line);
        if (obj.message?.content) tokens.push(obj.message.content);
      } catch { /* partial line, will retry with more data */ }
    }
    return { tokens, rest };
  },
};

// Groq — OpenAI-compatible SSE. Kept as fallback; models configurable so a
// future decommission is an env-var change, not a deploy.
const groq = {
  name: 'groq',
  get key() { return cleanEnv(process.env.GROQ_API_KEY); },
  models: (cleanEnv(process.env.GROQ_MODELS) || 'llama-3.3-70b-versatile').split(','),
  async call(model, messages, maxTokens) {
    return fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model.trim(),
        messages,
        stream: true,
        max_tokens: maxTokens,
        temperature: 0.7,
      }),
    });
  },
  // SSE: "data: {...}\n\n" with choices[0].delta.content
  parse(buffer) {
    const tokens = [];
    let rest = buffer;
    let sep;
    while ((sep = rest.indexOf('\n\n')) !== -1) {
      const chunk = rest.slice(0, sep).trim();
      rest = rest.slice(sep + 2);
      if (!chunk.startsWith('data:')) continue;
      const raw = chunk.replace(/^data:\s*/, '');
      if (raw === '[DONE]') return { tokens, rest, done: true };
      try {
        const obj = JSON.parse(raw);
        const t = obj.choices?.[0]?.delta?.content;
        if (t) tokens.push(t);
      } catch { /* ignore malformed chunk */ }
    }
    return { tokens, rest };
  },
};

// Order matters: first configured provider wins.
const PROVIDERS = [ollama, groq];

function activeProviders() {
  return PROVIDERS.filter(p => p.key);
}

/**
 * Stream a completion, trying each configured provider and model in turn.
 * Yields text tokens. Throws only if every provider/model combination fails.
 */
async function* streamCompletion(messages, { maxTokens = 200 } = {}) {
  const available = activeProviders();
  if (!available.length) throw new Error('No LLM provider configured');

  const failures = [];

  for (const provider of available) {
    for (const model of provider.models) {
      let res;
      try {
        res = await provider.call(model, messages, maxTokens);
      } catch (err) {
        failures.push(`${provider.name}/${model}: ${err.message}`);
        continue;
      }

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        failures.push(`${provider.name}/${model}: HTTP ${res.status} ${body.slice(0, 120)}`);
        continue;
      }

      console.log(`LLM: streaming via ${provider.name}/${model.trim()}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const out = provider.parse(buffer);
          buffer = out.rest;
          for (const t of out.tokens) yield t;
          if (out.done) return;
        }
      } finally {
        reader.releaseLock();
      }
      return; // completed successfully
    }
  }

  throw new Error(`All LLM providers failed — ${failures.join(' | ')}`);
}

module.exports = { streamCompletion, activeProviders };
