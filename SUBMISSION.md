# iShop-plus submission summary

## Product

**Title:** iShop-plus — Show it, say it, shop with Drake

iShop-plus helps shoppers describe what they want through a photo, speech, or text. Vision interprets a product image with Gemma 4 and searches the current Shopify store for available alternatives. Missions turns a multi-item goal and budget into independently researched product choices and a price-checked basket. The shopper reviews and explicitly approves before cart tools execute; actual cart read-back determines success. Drake's animated orb and activity summaries show real progress, while ElevenLabs supplies transcription and spoken replies.

## New contribution and existing foundation

This repository extends [iShop](https://github.com/Ebukachuqz/iShop), developed by the same owner. Existing Shopify app installation, signed shopper sessions, voice transport, browser commerce tools, and cart verification are reused. New work adds:

- Validated image ingress and Gemma 4 interpretation with typed visible attributes, requirements, uncertainty, and catalogue-grounded alternatives.
- A Gemma mission coordinator and independently invoked, separately scoped category research workers with read-only authority.
- Deterministic quantity, budget, stock, and currency checks; versioned proposal approval; fresh evidence checks; serialized verified cart execution.
- Photo/Missions controls in the existing Drake widget, an animated luminous orb, and activity text tied to real workflow/audio events.
- ElevenLabs-only live speech routing, account-configurable voice/model, and missing-provider fallbacks that preserve typed/image interaction.

The original repository remains separate. The new code is concentrated in `ishop.plus`, existing transport wiring, storefront widget assets, provider settings, and focused regression tests.

## Technical stack

Shopify theme app extension and embedded React app; existing FastAPI/Python runtime; authenticated WebSockets; Google Gemma 4 26B A4B IT through the official Gemini `generateContent` REST API; ElevenLabs Scribe v2 Realtime and streaming TTS; existing browser-side Shopify commerce bridge; deterministic Decimal-based basket validation; pytest, Node tests, Vitest, and TypeScript checks.

Ordinary shopping chat has an independent model selection. The current demo should use Groq GPT OSS 120B, whose greeting probe passed; the ordinary-chat Gemini 3.8 probe returned HTTP 503. Vision and Missions continue using Gemma 4, with no substitute model.

## Evidence and honest limits

- Final verification passed **425 tests**: 97 JavaScript, 19 Shopify, and 309 Python (including 270 runtime tests). The focused Plus suite passed 11/11. The full Python run completed at 19:48 UTC on 31 October 2026; see [the verification checklist](DEMO_CHECKLIST.md) for commands.
- CI checks, Shopify TypeScript validation, and new-file Ruff checks passed.
- Real Gemma 4 image interpretation passed using a generated PNG fixture; a real mission-coordinator request produced validated research tasks. These checks do not establish connected catalogue accuracy.
- Real ElevenLabs Sarah synthesis returned 138,206 PCM bytes. Real Scribe realtime transcription of that generated audio returned the expected sentence exactly. Audible browser playback and microphone capture remain manual checks.
- Public Shopify API probing redirected to `/password`. Connected-store Vision, mission approval, and actual live cart verification are reserved for the owner's authenticated storefront demo after handoff.
- No video has been captured by automation, and no generated fixture is presented as a live catalogue/cart demonstration.

Vision finds approximate attribute-based alternatives; there is no image embedding similarity index. Missions cover two or three research scopes and one store currency. Budget applies to basket subtotal before unverified tax/shipping. Multi-item writes are serial and can partially complete; the app reports observed outcomes and never automatically places an order. New workflow state is single-process memory. Shopify is the only implemented commerce platform.

Provider keys stay server-side. Uploaded images are validated and are not persisted as files or retained image bytes. Read-only researchers cannot change a cart, model output cannot invent catalogue identities, and no approval means no mission cart writes.

## Links and owner fields

- **Repository:** <https://github.com/Ebukachuqz/iShop-plus>
- **Setup:** [README](README.md)
- **Demo sequence and verification:** [DEMO_CHECKLIST.md](DEMO_CHECKLIST.md)
- **Demo video URL:** Pending owner recording/upload. Add the actual public or unlisted URL.
- **Hosted demo/store URL:** Pending owner confirmation and connected verification. No fabricated public endpoint is supplied.
- **License:** Pending owner selection. Public source visibility does not itself grant an open-source license; no license has been guessed or added.
