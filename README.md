# iShop-plus

iShop-plus extends [iShop](https://github.com/Ebukachuqz/iShop) with visual product discovery and shopping missions. Its storefront assistant, **Drake**, accepts a photo, a typed request, or speech and works with the current Shopify store's real catalogue. **Gemma 4** interprets images and coordinates product research; **ElevenLabs** handles live transcription and spoken replies.

iShop is designed for shoppers who may not be comfortable navigating online stores, shoppers with accessibility needs, and anyone who finds it easier to describe what they want than to work through menus and filters. Drake supports English and Nigerian Pidgin interactions, including code-switched requests.

## New in iShop-plus

- **Vision:** attach a JPEG, PNG, or WebP product photo and add preferences to find up to five available catalogue alternatives. Refine with “only black” or a price cap. Results are approximate alternatives, never a claim of exact visual identity.
- **Missions:** request two or three product categories and a subtotal budget. A Gemma coordinator creates separate scopes; independently invoked, read-only Gemma workers assess each category against actual catalogue candidates. A deterministic composer checks price, quantity, availability, and currency before proposing a basket.
- **Approval and verification:** review, edit, reject, or explicitly approve the exact mission proposal. Approval rechecks products and the existing cart. Writes run serially through the established Shopify browser bridge and are verified afterward; existing cart items are preserved.
- **Animated Drake:** a navy/violet/cyan orb shows listening, working, and speaking states. Its activity line follows real workflow/audio events, with a static reduced-motion fallback.
- **Three input modes:** text, images, and ElevenLabs Scribe v2 Realtime speech. ElevenLabs streaming TTS supplies Drake's replies. Text and image inputs remain available if voice is unavailable.

The existing Shopify app, signed sessions, FastAPI WebSocket runtime, browser commerce tools, and cart read-back verifier are retained. The new `ishop.plus` module adds bounded Vision/Missions orchestration; the existing widget adds photo ingress, proposals, and activity display. No broad platform rewrite is required. Product and variant identities come from store evidence, never model-created records. The original iShop repository is maintained separately.

```text
Drake photo/text/voice -> signed WebSocket -> Gemma 4 Plus workflow
  -> current-store browser catalogue -> verified alternatives / basket proposal
  -> explicit approval -> serial Shopify cart tools -> fresh cart read-back
```

## What Drake can do

- Search the store and display results on Shopify's native search page.
- Resolve follow-ups such as “open the second one” against the results the shopper saw.
- Open a named product or selected variant.
- Compare products and answer product questions using current storefront evidence.
- Add products, change quantities, remove lines, and show the cart.
- Open supported cart drawers, navigate home or back, and scroll incrementally.
- Hand the shopper over to Shopify checkout without entering payment details or placing the order.
- Support manual recording and continuous voice conversations using ElevenLabs, with independently selected ordinary-chat reasoning.

Product, price, availability, variant, and cart claims come from Shopify evidence. Cart mutations are checked against the current cart and verified after execution before Drake reports success.

## Repository structure

```text
apps/shopify/       Embedded Shopify app and Drake theme extension
services/runtime/   FastAPI voice, reasoning, and shopping runtime
packages/contracts/ Shared browser contracts and JavaScript tests
evals/              Speech and downstream evaluation tooling
scripts/            Workspace commands and validation utilities
```

## Evaluation

Public benchmark results are available in [Evaluation reports](evals/reports/README.md). The current report compares Sahara, Groq Whisper Large v3, AssemblyAI Universal-2, and ElevenLabs Scribe v2 across English, Nigerian Pidgin, Yoruba, and code-switched speech, including WER, CER, coverage, latency, and downstream shopping-task recoverability.

Raw recordings, private manifests, and provider responses are excluded from Git.

## Prerequisites

Install the following before starting:

- Node.js 22.12 through 22.x
- pnpm 9.15.4
- Python 3.11 or newer
- [uv](https://docs.astral.sh/uv/)
- A Shopify Partner account and development store
- [Shopify CLI](https://shopify.dev/docs/api/shopify-cli)
- [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) or another HTTPS/WSS tunnel for the local voice runtime
- Credentials for the providers you intend to enable

ElevenLabs is the only active iShop-plus speech provider. Legacy adapters and published evaluation reports remain for historical evaluation. Vision and Missions always use Gemma 4; the existing merchant reasoning choice applies to ordinary shopping chat. Voice availability depends on account credentials and its capability flags.

## Install dependencies

```bash
git clone https://github.com/Ebukachuqz/iShop-plus.git
cd iShop-plus
corepack enable
corepack prepare pnpm@9.15.4 --activate
pnpm install
python -m uv sync --all-packages --group dev --frozen
```

Alternatively, after pnpm and uv are installed:

```bash
pnpm bootstrap
```

## Configure the environment

Copy the example file at the repository root:

```powershell
Copy-Item .env.example .env
```

On macOS or Linux:

```bash
cp .env.example .env
```

At minimum, configure:

- `SHOPIFY_APP_CLIENT_ID` and `SHOPIFY_APP_CLIENT_SECRET`
- `DEV_ALLOWED_SHOP_DOMAINS`
- `DEV_ALLOWED_ORIGINS`
- `SESSION_SIGNING_SECRET` with at least 32 random characters
- `NVIDIA_API_KEY` and `ISHOP_PLUS_GEMMA_PROVIDER=nvidia` for hosted `google/gemma-4-31b-it`
- Optional `OPENROUTER_API_KEY` and `ISHOP_PLUS_GEMMA_PROVIDER=openrouter` select `google/gemma-4-31b-it:free` exclusively. Free availability is rate-limited; authenticated image tests currently fail with an upstream HTTP 429; successful image processing remains unverified.
- Alternatively `ISHOP_PLUS_GEMMA_PROVIDER=google`, `GEMINI_API_KEY`, and `ISHOP_PLUS_GEMMA_MODEL` select the original Google route; its image requests failed in the tested account
- `ISHOP_PLUS_VISION_ENABLED=true` and `ISHOP_PLUS_MISSIONS_ENABLED=true`
- `ELEVENLABS_API_KEY`, `ISHOP_ENABLE_ELEVENLABS_REALTIME_STT=true`, and `ISHOP_ENABLE_ELEVENLABS_HTTP_TTS=true` for voice
- Optionally `ELEVENLABS_VOICE_ID` for an account-accessible voice (Sarah is the verified default) and `ELEVENLABS_TTS_MODEL` (defaults to `eleven_flash_v2_5`)
- Existing `GEMINI_MODEL` or `GROQ_API_KEY` configuration for the ordinary shopping-chat reasoning profile

Keep `.env` private. Provider credentials are server-side and must never be added to the theme extension or committed to Git.

The runtime loads the repository-root `.env`; make the same relevant values available to the Shopify app process, using its own `.env` if your CLI configuration requires it. Use the exact current store origin. The supported interface is a Shopify Online Store theme with the Drake embed and browser commerce bridge; there is no cross-store search or WooCommerce adapter.

Vision/Missions use the selected Gemma provider. NVIDIA calls `https://integrate.api.nvidia.com/v1/chat/completions` with server-side bearer authentication, compact JPEG image parts and SSE output. Typed validation allows one bounded schema correction; no automatic model/provider fallback occurs. The NVIDIA adapter limits output to 768 tokens and each attempt to approximately three minutes, since cold/queued requests were slow. Its image input is downscaled to at most 512 pixels per side: fine print and small visual details may be lost. Google remains an explicit alternative. See [NVIDIA's image API](https://docs.api.nvidia.com/nim/reference/google-gemma-4-31b-it-infer). ElevenLabs remains the exclusive live speech provider.

## Link and run the Shopify app

Authenticate Shopify CLI if needed, then link this checkout to your Shopify app:

```bash
pnpm --filter @ishop/shopify-app config:link
pnpm --filter @ishop/shopify-app setup
```

Start the voice runtime in the first terminal:

```bash
pnpm dev:runtime
```

It listens on `http://127.0.0.1:8000` by default.

Expose the runtime through a secure tunnel in a second terminal:

```bash
cloudflared tunnel --url http://127.0.0.1:8000
```

Copy the generated `https://...trycloudflare.com` hostname. Its WebSocket base URL is:

```text
wss://<generated-hostname>/ws
```

Start the Shopify application in a third terminal:

```bash
pnpm --filter @ishop/shopify-app dev
```

Follow Shopify CLI's prompts to select the development store and install or update the app. Shopify CLI supplies the app's development tunnel automatically.

## Enable Drake on the storefront

1. In Shopify Admin, open **Online Store → Themes → Customize**.
2. Open **App embeds**.
3. Enable **Drake voice shopping**.
4. Set **Voice runtime WebSocket URL** to the secure runtime URL from the previous step, ending in `/ws`.
5. Save the theme.
6. Open the installed iShop-plus app in Shopify Admin and review ElevenLabs speech/voice and the ordinary-chat reasoning profile.
7. Open the storefront in a fresh tab and allow microphone access when testing voice.

Provider-setting changes apply to new shopper sessions. Refresh the storefront after changing a profile or restarting either development service.

Choose **＋ Photo** to attach an image or **Missions** to enter a multi-item goal. Voice transcripts follow the selected feature mode. Review the factual basket before using its explicit approval button. A missing speech credential leaves text/image shopping available and reports voice failure honestly.

## Verification and demonstration

Final verification completed at **19:48 UTC on 31 October 2026**: **425 tests passed** across **97 JavaScript, 19 Shopify, and 309 Python tests**. The Python total includes 270 runtime tests; the focused Plus suite passed **11/11**. `pnpm check:ci`, Shopify TypeScript validation, and new-file Ruff checks passed. These checks cover signed selection, retired-provider rejection, optional voice readiness, streaming plumbing, independent research, basket constraints, and approval/read-back safety with isolated fixtures.

Current live-provider verification supersedes the earlier Google-only result: **NVIDIA Gemma 4 31B successfully interpreted the public test image and returned validated Vision JSON.** The original Google route still returned HTTP 400; see [the historical Google report](evals/reports/vision-provider-verification.md) and [current NVIDIA verification](evals/reports/nvidia-gemma-verification.md). No Gemini fallback was enabled. Real-store matching/cart execution, microphone capture and audible browser playback remain separate live checks.

```bash
python -m uv run --frozen --all-packages pytest services/runtime/tests/test_plus_voice_profiles.py services/runtime/tests/test_voice_provider_expansion.py services/runtime/tests/test_runtime_app.py
python -m uv run --frozen --all-packages pytest services/runtime/tests tests evals/tests -q
pnpm --filter @ishop/shopify-app test
```

Use [the demo checklist](DEMO_CHECKLIST.md) for the current Plus workflow/frontend results, live-provider checks, and a recording sequence. Fixture passes are not a claim of live Gemma, audible browser playback, or connected-store success.

[Submission summary](SUBMISSION.md) describes the new contribution and the remaining video, license, and connected-demo fields.

## Current limitations

- Vision is attribute-based discovery, not an image-similarity index. JPEG/PNG/WebP uploads are limited to 4 MB and 16 million decoded pixels. Images are validated and not persisted as files or retained image bytes.
- Missions support two to four research scopes and one store currency. The budget covers the proposed basket subtotal before unverified tax, shipping, duties, and discounts.
- Approval is tied to an exact, short-lived proposal. Material price/availability changes require a new proposal and approval. Multiple cart writes are serialized, not atomic; inspect actual cart state after any partial or uncertain outcome.
- Plus session state is single-process memory; restarting clears pending interpretations and proposals. Durable Plus workflows and broader platform separation are future work.
- Full page navigation can interrupt audio and uses the existing reconnection lifecycle. Browser microphone and autoplay permissions still apply.
- Demonstrate products that actually exist and are available in the configured store; no sample catalogue is silently substituted.

## Local development commands

```bash
pnpm dev:runtime       # Start the FastAPI voice runtime
pnpm test:unit         # Run JavaScript, Shopify, and Python unit tests
pnpm test:integration  # Run storefront bridge and commerce integration tests
pnpm test:e2e          # Run connected storefront contract checks
pnpm check             # Run validation, privacy, boundary, and type checks
```

To run only the browser contract tests:

```bash
node --test packages/contracts/tests/*.test.js
```

To run the runtime tests directly:

```bash
python -m uv run --frozen --package ishop-runtime pytest services/runtime/tests
```

## Troubleshooting

### The embedded app refuses to connect

Shopify development URLs change between sessions. Start the app through Shopify CLI and do not force an old development URL into the process.

### Drake cannot connect to the voice runtime

Confirm that the runtime and tunnel are both running and that the theme app embed contains the current `wss://.../ws` URL. Temporary Cloudflare hostnames change whenever the tunnel restarts.

### A provider is unavailable in merchant settings

Confirm that its API key and corresponding `ISHOP_ENABLE_*` capability flag are configured. Restart the Shopify app and runtime, then begin a new shopper session.

### ElevenLabs voice is unavailable

Verify the ElevenLabs key has transcription and synthesis permissions, the capability flags are enabled, and `ELEVENLABS_VOICE_ID` identifies a voice accessible to that account. Sarah is the live-verified default. The former Rachel voice returned HTTP 402 on the tested account; a key alone does not guarantee access to every voice. Text/image input stays available when speech fails.

### Ordinary chat reports that reasoning is unavailable

The ordinary-chat Gemini 3.8 probe returned HTTP 503 during verification. Groq GPT OSS 120B handled the corresponding greeting successfully. For the current demonstration, select **Groq GPT OSS 120B** for ordinary shopping chat with a configured `GROQ_API_KEY`. Vision and Missions continue to use **Gemma 4** independently; the source ordinary-chat default has not been changed.

### Product or cart data appears stale

Refresh the storefront after restarting development services. Drake deliberately rejects stale page, result-set, and cart evidence rather than acting on it.

## Privacy and safety

- Microphone capture starts only after shopper interaction and can be stopped at any time.
- Audio recording is disabled by default.
- Provider credentials remain on the server.
- Store content is treated as untrusted evidence, never executable instruction.
- Cart changes require current Shopify evidence and verified read-back.
- Checkout is a human-controlled handoff; Drake does not enter payment information or place orders.
- Private benchmark recordings and evaluation outputs are excluded from Git.

## License

No open-source license has been granted for this repository. Unless a license file is added, the source remains subject to the repository owner's rights.
