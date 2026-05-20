const ALLOWED_ORIGINS = [
  'https://kuphuka.com',
  'https://kuphuka.myshopify.com',
];

const VOICE_ID = 'PksrhvpHrGUgesnsmLTX';

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

  const { text } = req.body || {};
  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    return res.status(400).json({ error: 'No text provided' });
  }

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'TTS not configured' });
  }

  try {
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: text.slice(0, 1000), // cap at 1000 chars to control cost
          model_id: 'eleven_turbo_v2_5',
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.8,
            speed: 1.1,
          },
        }),
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      console.error('ElevenLabs error:', response.status, errText);
      return res.status(502).json({ error: 'TTS failed' });
    }

    const audioBuffer = await response.arrayBuffer();
    const base64Audio = Buffer.from(audioBuffer).toString('base64');
    console.log(`TTS OK — ${text.length} chars, ${audioBuffer.byteLength} bytes audio`);
    res.status(200).json({ audio: base64Audio });

  } catch (err) {
    console.error('TTS exception:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
};
