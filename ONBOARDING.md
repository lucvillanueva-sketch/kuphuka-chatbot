# Kuphuka Chatbot — Project Onboarding

## What this is
A custom AI chatbot for **kuphuka.com** (Spanish supplement brand). Replaces the Dondy subscription. Built on Vercel serverless functions.

## Live URLs
- **Widget** — embedded on every Shopify page via `theme.liquid`
- **Standalone page** — https://kuphuka.com/pages/asistente
- **API** — https://kuphuka-chatbot.vercel.app

## Repo
`C:\Users\Lucas Villanueva\kuphuka-chatbot`  
GitHub: lucvillanueva-sketch/kuphuka-chatbot  
Vercel project: kuphuka-chatbot (auto-deploys on push to main)

## Stack
| Layer | Tech |
|---|---|
| LLM | Groq — `llama-3.1-8b-instant` (~300ms) |
| TTS | ElevenLabs — voice `PksrhvpHrGUgesnsmLTX`, model `eleven_turbo_v2_5`, speed 1.2 |
| STT | Web Speech API (`webkitSpeechRecognition`, `es-ES`) |
| Logging | Airtable (base env var `AIRTABLE_BASE_ID`) |
| Escalation | Resend email → lucvillanueva@gmail.com |
| Hosting | Vercel (Node 24.x) |

## Key files
| File | Purpose |
|---|---|
| `api/chat.js` | Main handler — Groq LLM + ElevenLabs TTS in parallel |
| `api/tts.js` | Standalone TTS endpoint (used for greeting audio) |
| `knowledge.js` | System prompt — pricing, product info, FAQs |
| `shopify-widget.html` | Widget code — paste into Shopify `theme.liquid` just before `</body>` |
| `standalone-preview.html` | Local preview of the /pages/asistente page |

## Shopify setup
- **Widget**: pasted directly in `theme.liquid` (before `</body>`)
- **Standalone page**: uses custom Shopify template
  - Layout: `layout/chatbot.liquid` (on unpublished theme copy)
  - Template: `templates/page.asistente.liquid`
  - Page: handle `asistente`, templateSuffix `asistente`
  - Theme ID: `gid://shopify/OnlineStoreTheme/200134689099` (unpublished copy)

## Pricing (critical — LLM must not hallucinate a 3rd option)
- Compra única: **59€** (30 dosis, envío gratis, 24h)
- Suscripción: **39€** primer mes, luego **49€/mes**
- Active promo: código **PRUEBA KUPHUKA** = 2x1

## iOS-specific fixes in widget
- `await audioCtx.resume()` before decoding audio (iOS Safari)
- `fixBrandName()` function corrects STT mis-hearings of "Kuphuka":
  - "Kung Fu Uca/Ka/Ca", "KFK", "CFCA", "ku fu ka", etc.

## Widget appearance (current)
- Header: dark green gradient + Playfair Display font + circular product image avatar
- User bubbles: green gradient
- Bot bubbles: light green background
- Fonts: Playfair Display (header) + Inter (body)

## Environment variables (in Vercel)
- `GROQ_API_KEY`
- `ELEVENLABS_API_KEY`
- `AIRTABLE_API_KEY`
- `AIRTABLE_BASE_ID`
- `AIRTABLE_TABLE_ID` (default: `tbl5Aoa78BZ2kANnz`)
- `RESEND_API_KEY`

## Klaviyo flows (live)
| ID | Name |
|---|---|
| WeRRNS | Welcome Flow - 39€ |
| VJrTpm | Thank You Flow |
| URqaBp | Abandoned Checkout Flow |
| T92aDp | Abandoned Cart Flow 2 |
| UvDxAA | OTP - suscription emails |
| TGTJbL | Retención Suscripción |
| XbMS6Z | Cancelled Subscriber Win-back Flow |
| SJbSvr | Review request |
| T6SQAk | New Referr a friend |

## Pending tasks
1. **Klaviyo**: Add chatbot CTA block to all live flow email templates
2. **Customer orders**: New `/api/customer` endpoint — look up Shopify orders by email so customers can ask "when is my next shipment?"
3. **Klaviyo**: Add chatbot link to order confirmation emails (Shopify native)

## How to continue a session
1. Open claude.ai (browser or phone)
2. Start a new chat, attach or paste this file
3. Say: "Continue the Kuphuka chatbot project" — Claude will have full context

## Owner
Lucas Villanueva — lucas@kuphuka.com
