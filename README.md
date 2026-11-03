# iShop-plus

iShop-plus extends [iShop](https://github.com/Ebukachuqz/iShop) with visual product discovery and coordinated shopping missions. **Drake** is the AI shopping assistant: shoppers can type, speak, or upload a photo to browse a Shopify store and prepare a basket using real catalogue data. It supports English and Nigerian Pidgin interactions, including code-switched requests.

## Contents

- [Features](#features)
- [How it works](#how-it-works)
- [Repository structure](#repository-structure)
- [Complete local setup](#complete-local-setup)
- [Run the three development services](#run-the-three-development-services)
- [Enable and configure Drake](#enable-and-configure-drake)
- [First-run checklist](#first-run-checklist)
- [Everyday development](#everyday-development)
- [Tests and evaluation](#tests-and-evaluation)
- [Troubleshooting](#troubleshooting)
- [Privacy and safety](#privacy-and-safety)
- [Current limitations](#current-limitations)
- [License](#license)

**New to the repository?** Start with [Complete local setup](#complete-local-setup). Cloning alone does not install the app in Shopify: you need your own Shopify development app/store, a reasoning-provider credential, and an enabled theme embed.

## Features

- **Conversational shopping:** search the native storefront, compare products, inspect options, and open product pages using current store evidence.
- **Vision:** upload JPEG, PNG, or WebP images, receive up to five available catalogue alternatives, and refine preferences conversationally. Similarity is approximate, not a guarantee of an exact match.
- **Missions:** request two to four independently scoped items, including different products in the same category. Drake researches each scope, checks the subtotal budget, and proposes a basket for review.
- **Approved commerce:** add items, change quantities, remove lines, and show supported cart drawers. Basket approval rechecks facts, executes writes serially, and verifies the resulting cart.
- **Voice:** ElevenLabs supplies transcription and spoken replies. **Record request** captures one message; **Live conversation** listens for successive requests until ended.
- **Store navigation:** native search results, product/variant navigation, home/back actions, and incremental scrolling.
- **Drake interface:** a self-hosted Deep Chat transcript, uploaded-photo previews, product cards, basket controls, and an animated orb driven by actual workflow and audio events.
- **Checkout handoff:** open Shopify checkout for the shopper to complete payment themselves.

## How it works

```text
Shopify theme embed: text / photo / microphone
  -> authenticated Shopify app proxy issues a signed shopper grant
  -> FastAPI WebSocket runtime validates the grant
  -> selected model interprets the objective and coordinates research
  -> storefront browser bridge retrieves actual Shopify evidence
  -> grounded reply, recommendations, or proposed basket
  -> shopper authorizes cart changes
  -> commerce tools execute and verify fresh cart state
  -> ElevenLabs audio and text response
```

One merchant-selected model handles conversation, image interpretation, and shopping goals. Available adapters are Groq Qwen and Gemma 4 through Google, NVIDIA, or OpenRouter. There is no separate Missions button: describe the goal in the conversation. ElevenLabs is the active speech provider; other speech adapters remain for historical evaluation.

The local setup uses SQLite. The Shopify app stores installation sessions and merchant configuration through Prisma; the runtime stores shopping sessions and command records separately. Pending Vision/Missions workflow state remains in runtime memory. No PostgreSQL server is needed.

Signed grants normally last five minutes from issuance. Before a request near expiry, the widget obtains a fresh grant through the app proxy and resumes the same shopper identity when permitted. A grant authenticates the session; it does not replace cart approval or verification.

## Repository structure

```text
apps/shopify/         Embedded Shopify app, Prisma database, and Drake theme extension
services/runtime/    FastAPI runtime, providers, workflows, and commerce verification
packages/contracts/ Shared browser contracts and JavaScript tests
tests/e2e/           Connected browser/storefront fixtures
evals/               Evaluation tooling and public Markdown reports
scripts/             Development commands, validation, and opt-in provider probes
```

## Complete local setup

Setup steps: [Prerequisites](#prerequisites) · [Clone](#clone-and-install-dependencies) · [Shopify app](#link-your-own-shopify-app) · [Environment](#configure-environment-files) · [SQLite](#initialize-the-shopify-database)

### Prerequisites

| Requirement | Version or purpose |
| --- | --- |
| Git | Clone the repository. |
| [Node.js](https://nodejs.org/en/download) | Node 22.12 or newer within the 22.x series. |
| pnpm | Use **9.15.4**, as pinned in `package.json`. |
| [Python](https://www.python.org/downloads/) | Python 3.11 or newer. |
| [uv](https://docs.astral.sh/uv/getting-started/installation/) | Install and run the locked Python workspace. |
| [Shopify development access](https://shopify.dev/docs/apps/build/cli-for-apps/test-apps-locally) | Your own developer account, development app, and development store with an Online Store theme. |
| [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) | Expose the local runtime over HTTPS/WSS. |
| Reasoning-provider account | At least one supported model credential. |
| ElevenLabs account | Required for voice; text/image inputs remain available without speech. |

Install uv using its official installer. If installing it through Python instead, run `python -m pip install --user uv` with your base interpreter, then reopen your terminal if necessary. macOS/Linux installations may use `python3` instead of `python`.

Install the pinned pnpm version in the Node environment you will use for this project:

```bash
npm install --global pnpm@9.15.4
node --version
pnpm --version
python --version
uv --version
cloudflared --version
```

Confirm pnpm prints `9.15.4`. If you use a Node version manager, select Node 22 before installing pnpm and use that same Node environment in each terminal. Shopify CLI is already a project dependency; a separate global Shopify CLI installation is unnecessary.

### Clone and install dependencies

```bash
git clone https://github.com/Ebukachuqz/iShop-plus.git
cd iShop-plus
pnpm install --frozen-lockfile
uv sync --all-packages --group dev --frozen
```

These commands install the JavaScript workspace and create the Python `.venv` from the committed lockfiles. You do not need to activate `.venv` when using the uv commands below.

### Link your own Shopify app

The committed Shopify configuration contains the original development app's identity. Link your checkout to **your own app**, rather than trying to use that identity or someone else's credentials.

```bash
cd apps/shopify
pnpm exec shopify app config link --path .
```

Follow the browser authentication and CLI prompts. Create a development app or select an existing app you own. If prompted for a configuration name, use something such as `development`. The linked configuration becomes the CLI default; inspect it to confirm its `client_id` belongs to your app. See [Shopify's configuration guide](https://shopify.dev/docs/apps/build/cli-for-apps/manage-app-config-files).

In the linked `shopify.app*.toml`, retain this project's app-proxy routing and automatic development URL updates. If your newly linked app has no proxy configuration, add:

```toml
[access_scopes]
scopes = "write_app_proxy"

[app_proxy]
url = "/proxy"
prefix = "apps"
subpath = "ishop"

[build]
automatically_update_urls_on_dev = true
include_config_on_deploy = true
```

Merge these values into existing sections; do not create duplicate TOML sections. Add `write_app_proxy` to any existing required scopes rather than deleting other permissions your app needs. Shopify documents this scope for [app-proxy configuration](https://shopify.dev/docs/apps/build/online-store/app-proxies). Keep the repository's authentication/webhook configuration. The theme embed calls `/apps/ishop/bootstrap`, so the proxy prefix/subpath must match. Accept the corresponding permission update when installing the development app.

Obtain your app's client ID and client secret from its Shopify developer settings. Select an app development store when starting the preview later. Add published, available products with images and variants to that store; the application does not populate a demo catalogue automatically.

Return to the repository root:

```bash
cd ../..
```

### Configure environment files

Copy the root example:

```powershell
# Windows PowerShell
Copy-Item .env.example .env
```

```bash
# macOS / Linux
cp .env.example .env
```

Generate a signing secret locally:

```bash
python -c "import secrets; print(secrets.token_hex(32))"
```

Set the following in the root `.env`, replacing placeholders with your own values. Use bare values without surrounding quotes; the runtime's lightweight environment loader does not remove quotes.

```dotenv
SHOPIFY_APP_CLIENT_ID=your_own_app_client_id
SHOPIFY_APP_CLIENT_SECRET=your_own_app_client_secret
SHOPIFY_SCOPES=write_app_proxy
DEV_ALLOWED_SHOP_DOMAINS=your-store.myshopify.com
DEV_ALLOWED_ORIGINS=https://your-store.myshopify.com
SESSION_SIGNING_SECRET=your_generated_secret

RUNTIME_HOST=127.0.0.1
RUNTIME_PORT=8000
RUNTIME_DATABASE_PATH=services/runtime/data/ishop_runtime.sqlite

ISHOP_PLUS_GEMMA_PROVIDER=groq
GROQ_API_KEY=your_real_groq_key
ISHOP_PLUS_VISION_ENABLED=true
ISHOP_PLUS_MISSIONS_ENABLED=true

ELEVENLABS_API_KEY=your_real_elevenlabs_key
ISHOP_ENABLE_ELEVENLABS_REALTIME_STT=true
ISHOP_ENABLE_ELEVENLABS_HTTP_TTS=true
ISHOP_ENABLE_ELEVENLABS_WS_TTS=false
ELEVENLABS_VOICE_ID=EXAVITQu4vr4xnSDxMaL
ELEVENLABS_TTS_MODEL=eleven_flash_v2_5

RECORD_AUDIO_ENABLED=false
```

For text/image-only testing, leave `ELEVENLABS_API_KEY` blank and set its STT/TTS capability flags to `false`. For voice, the key must have the necessary permissions and credits, and the configured voice must be accessible to your account.

Blank unused provider credentials instead of leaving example keys that look configured. Replace the optional `RUNTIME_CONTROL_SECRET` with a different secure value or leave it unset to use the runtime's signing-secret fallback. The example's `SESSION_TTL_SECONDS` is not a control for the five-minute signed grant lifetime.

Also create **`apps/shopify/.env`** with the Shopify server's required values:

```dotenv
SHOPIFY_APP_CLIENT_ID=your_own_app_client_id
SHOPIFY_APP_CLIENT_SECRET=your_own_app_client_secret
SHOPIFY_SCOPES=write_app_proxy
DEV_ALLOWED_SHOP_DOMAINS=your-store.myshopify.com
DEV_ALLOWED_ORIGINS=https://your-store.myshopify.com
SESSION_SIGNING_SECRET=the_same_generated_secret_as_the_root_file
```

The runtime reads the root `.env` when started from the repository root. During development, the Shopify app also loads provider credentials/availability flags from that root file; it does not use that helper to load every Shopify setting. Keep the signing secret and origins consistent in both processes. Existing process environment variables take precedence over file values.

Origins are exact browser origins, without paths. If using a custom storefront domain or the CLI's local preview, add its actual origin to **both** `DEV_ALLOWED_ORIGINS` lists, comma-separated. For example, a preview opened at `http://127.0.0.1:9293` needs that origin allowed; the store's permanent `.myshopify.com` identity remains unchanged.

Do not put keys, signing secrets, or storefront passwords into theme settings or commit them. A store password is entered in the storefront when prompted; do not send it to the runtime as a provider credential.

#### Other reasoning providers

Configure only the provider you intend to use, then choose it in merchant settings:

| Provider value | Required credential | Model configuration |
| --- | --- | --- |
| `groq` | `GROQ_API_KEY` | Adapter selects `qwen/qwen3.8-27b`. |
| `google` | `GEMINI_API_KEY` | Set `ISHOP_PLUS_GEMMA_MODEL=gemma-4-26b-a4b-it` or `gemma-4-31b-it`. |
| `nvidia` | `NVIDIA_API_KEY` | Adapter selects `google/gemma-4-31b-it`. |
| `openrouter` | `OPENROUTER_API_KEY` | Adapter selects `google/gemma-4-31b-it:free`; availability depends on upstream capacity and account limits. |

`ISHOP_PLUS_GEMMA_PROVIDER` sets the runtime fallback/default. The merchant's saved **Drake model** choice is carried in signed shopper sessions and takes precedence for those sessions. One selected model handles text, images, and missions; no second reasoning key is required. There is no automatic cross-provider fallback.

Google Gemma 4 26B has completed a real-provider Vision probe with a synthetic catalogue/cart, but intermittent HTTP 500s remain. The Google adapter uses image-first input, bounded deadlines, and one transient-server retry. This does not guarantee Google availability. Groq and other accounts can also hit quota limits; credentials alone do not guarantee capacity or free usage.

### Initialize the Shopify database

```bash
cd apps/shopify
pnpm run setup
cd ../..
```

This generates Prisma Client and applies the repository's existing SQLite migrations. It creates the Shopify app database at `apps/shopify/prisma/dev.sqlite`. The runtime creates its own SQLite database at `RUNTIME_DATABASE_PATH` when started. No separate database service is required. Do not delete either database to troubleshoot a routine connection failure; doing so removes local session/configuration or command history.

## Run the three development services

Keep each service running in its own terminal. Commands in terminals 1 and 2 start from the repository root; terminal 3 runs inside `apps/shopify`.

### Terminal 1: FastAPI runtime

```bash
uv run --frozen --package ishop-runtime python -m ishop.app
```

Expect `Application startup complete` and `Uvicorn running on http://127.0.0.1:8000`. Check [local runtime health](http://127.0.0.1:8000/health) in your browser. `status: ok` confirms startup, not a successful paid-provider call or working voice credits.

Using `python -m ishop.app` also avoids relying on the generated `ishop-runtime` executable on Windows systems where application-control policy blocks that launcher.

### Terminal 2: runtime HTTPS tunnel

```bash
cloudflared tunnel --protocol http2 --url http://127.0.0.1:8000
```

Copy the generated `https://...trycloudflare.com` address. Opening its `/health` path should return the same runtime health response. The widget's WebSocket base URL is:

```text
wss://YOUR-RUNTIME-TUNNEL.trycloudflare.com/ws
```

The widget appends the store-specific voice path automatically. A temporary tunnel's hostname changes after a restart, so update the theme setting whenever that happens. Keep the runtime bound to localhost for this local setup.

### Terminal 3: Shopify app and extension preview

From the repository root:

```bash
cd apps/shopify
pnpm exec shopify app dev --path .
```

Follow the CLI prompts to select your development store and install the app. Wait until its development preview is ready. The CLI runs the embedded app, applies existing local Prisma migrations, syncs the theme extension, and creates a **separate app tunnel**. Use the CLI-provided preview/editor links for this development session.

The two tunnels serve different purposes:

| Tunnel | Used for |
| --- | --- |
| Shopify CLI's tunnel | Embedded app, authentication, app proxy, development preview. |
| Manually started runtime tunnel | Drake's FastAPI WebSocket and runtime health. |

Do not paste Shopify CLI's app-tunnel hostname into the runtime WebSocket setting. Let the CLI update the development app URL rather than pinning a previous temporary hostname in your environment.

## Enable and configure Drake

1. Open the development theme/editor linked by Shopify CLI. In Shopify Admin this is under **Online Store → Themes → Customize/Edit theme**; ensure you are editing the theme used by your preview.
2. Open **App embeds**, enable **Drake voice shopping**, and set **Voice runtime WebSocket URL** to your runtime `wss://.../ws` base URL.
3. Save the theme. Open the storefront through the current development preview and unlock its password page if prompted.
4. Open the installed app in Shopify Admin. Under **Drake provider settings**, select the configured **Drake model**, ElevenLabs speech recognition, and ElevenLabs voice, then save. The embedded app may still display the original name **iShop** depending on the app record you linked.
5. Open a fresh shopper tab after provider-setting changes. Hard-refresh the storefront after an extension update.
6. Allow microphone access when you first use voice. Browser autoplay restrictions may require a click before a spoken reply plays.

Environment flags describe which integrations your server has configured; merchant settings choose among those available integrations. Setting a flag does not provide a missing credential, credit balance, or provider entitlement.

Use the normal text input for missions and follow-ups. Use **＋ Photo** for Vision. **Record request → Finish recording** sends one utterance. **Live conversation → End conversation** controls successive voice requests. Navigation can interrupt capture/playback; use **Resume conversation** when offered.

## First-run checklist

Use a development store and note any preexisting cart items. Wait for each request to finish before the next.

| Check | Try | Expected result |
| --- | --- | --- |
| Text | “How are you, Drake?” | One visible reply. |
| Voice | Record a greeting and finish recording. | Transcript plus audible reply when ElevenLabs is configured. |
| Search | “Find snowboards under 750 USD.” | Native store results or a focused clarification. Use your store's currency and actual catalogue. |
| Product | “Open the Complete Snowboard.” | The requested product page, if it exists and is unambiguous. |
| Vision | Upload a product image and ask for similar available items. | Submitted image, grounded recommendations, and available variant controls. |
| Mission | “Find one Complete Snowboard in Ice and one Multi-location Snowboard. Budget 2,000 USD. Prepare a basket for review; do not add anything yet.” | A proposal with quantities, variants, and subtotal; no cart write. Replace names with products in your own store. |
| Approval | Review the proposal and approve it once. | Verified cart quantities and one final basket summary. |
| Drawer | Open the cart drawer without refreshing. | Updated contents on supported themes; cart-page fallback when the drawer cannot be refreshed safely. |
| Quantity | Ask to add one more of an item already present. | Its quantity increases by one; other lines stay unchanged. |
| Checkout | “Take me to checkout.” | Shopify checkout handoff. Complete payment yourself only if intended. |

If an update is uncertain, inspect the actual cart before repeating it. Product prices and availability must come from your store; no demo subtotal is guaranteed.

## Everyday development

| Change | What to restart or refresh |
| --- | --- |
| Python runtime code or root runtime environment | Restart terminal 1; it does not use automatic reload. |
| Shopify server environment | Restart Shopify CLI/app in terminal 3. |
| Widget JavaScript, CSS, or Liquid | Wait for CLI extension sync, then hard-refresh the storefront. |
| Runtime tunnel hostname | Save the new WSS base URL in the theme embed. |
| Merchant provider selection | Save settings, then start a fresh shopper session. |

Stop services with Ctrl+C in their respective terminals. Restarting FastAPI preserves its SQLite records but clears pending in-memory Vision/Missions state. Recreate and review pending proposals after a restart; do not blindly reapprove an uncertain old write.

## Tests and evaluation

After installing dependencies, run these from the repository root:

```bash
uv run --frozen --all-packages pytest -q
pnpm test:unit
pnpm test:integration
pnpm --filter @ishop/shopify-app test
pnpm --filter @ishop/shopify-app lint
pnpm --filter @ishop/shopify-app build
```

For TypeScript validation without regenerating Prisma Client while a live preview holds its files open:

```bash
cd apps/shopify
pnpm exec react-router typegen
pnpm exec tsc --noEmit
cd ../..
```

`pnpm check:ci` runs the repository's broader validation, including Prisma generation; stop the preview first if Windows reports a locked Prisma file.

The connected browser fixture currently assumes **Windows**, the workspace `.venv`, and Chrome in its standard installation location. With Chrome installed and ports 8765/9225 free:

```bash
pnpm test:e2e
```

It runs an isolated synthetic storefront/cart with production transport/controller/browser code. It does not change your real store. Its launcher paths need adapting for macOS/Linux; the standard unit suites do not establish that browser-launcher portability.

Opt-in real-provider probe, using the provider selected by the root environment:

```bash
uv run --frozen --package ishop-runtime python scripts/check-vision-workflow.py --runs 1
```

This sends a public sample image to the configured provider and tests recommendations, variant review, explicit approval, synthetic cart receipt verification, and budget refinement. It uses provider quota and **does not write to a live Shopify cart**. Mocked tests and synthetic cart checks are not proof of a connected live-store journey.

Public benchmark methodology and results are in [Evaluation reports](evals/reports/README.md), including WER/CER and downstream shopping-task recoverability. Historical speech benchmarks include providers that are not active widget options. Raw recordings, private manifests, credentials, and provider responses are excluded from Git.

To rebuild the pinned, self-hosted Deep Chat asset after dependency installation, run `pnpm vendor:chat`.

## Troubleshooting

### pnpm version mismatch or a broken Windows shim

Select the intended Node 22 environment, run `npm install --global pnpm@9.15.4`, reopen the terminal if necessary, and check `pnpm --version`. On PowerShell, use `pnpm.cmd` if the `.ps1` launcher is blocked. Avoid mixing a globally installed pnpm version with a different Corepack-selected version: Shopify CLI spawns `pnpm install` as a child process too.

### No module named uv or a blocked runtime launcher

Use the standalone `uv` command from PATH rather than expecting uv inside `.venv`. Do not activate the project environment merely to launch uv. Run the runtime through `uv run --frozen --package ishop-runtime python -m ishop.app`. If an application-control policy blocks Python or uv itself, use an installation permitted by your machine administrator.

### Shopify cannot find its TOML file or CLI command

Run `pnpm exec shopify app dev --path .` from **`apps/shopify`**, not the repository root. Ensure `pnpm install` completed and your linked configuration exists there. Use `pnpm exec shopify app dev --path . --verbose` to identify the blocking stage; redact sensitive values before sharing logs.

### Embedded app refuses to connect

Keep Shopify CLI running and use its current preview. Confirm that you linked your own app. Old app-tunnel hostnames stop working after restarts. If a globally set `SHOPIFY_APP_URL` points at an old tunnel, remove that stale override and restart through the CLI.

### Bootstrap fails or the session cannot renew

Check the `/apps/ishop/bootstrap` request in browser Network tools. Verify installation, matching signing secrets, exact storefront origins, and the linked app-proxy configuration. The five-minute grant is renewed through that endpoint. Expired resume references or configuration changes can require a new shopper session; a page refresh cannot repair an unavailable app proxy.

### Drake cannot connect to FastAPI

Check local `/health`, tunnel `/health`, and the saved WSS URL in that order. Confirm both tunnels are running, the runtime tunnel targets port 8000, and the browser origin is allowed. HTTP/2 is already used in the tunnel command above to avoid QUIC/UDP-specific connection issues.

### A model or voice option is unavailable

Check real credentials, capability flags, merchant selection, account permissions, and credits. Restart the affected processes after environment changes. The Google credential is named `GEMINI_API_KEY` even when the selected model is Gemma. Legacy benchmark-provider keys do not enable those providers as current live voice options.

### Text works but Drake does not speak

Check ElevenLabs synthesis access, credits, the selected voice ID, browser audio/autoplay permissions, and any **Play reply** recovery control. Speech recognition and synthesis are separate operations: a successful transcript does not prove TTS access. Text/image shopping remains available if voice fails.

### Too many requests or Google HTTP 500

HTTP 429 indicates provider-side rate/quota limits. The client imposes a cooldown; repeated clicks and server restarts do not increase external quota. Check the provider's usage dashboard and wait for its applicable limit window. Google HTTP 500s can remain intermittent even with valid requests. No provider is silently substituted.

### Cart icon changes but drawer contents are stale

Hard-refresh once after updating the extension. Supported drawers are refreshed from section HTML, with a same-theme cart HTML fallback; variants/quantities are checked where available. Third-party drawers can require theme-specific integration. Inspect the actual cart page before repeating an add; UI staleness does not mean the mutation failed.

### Navigation reaches the step limit

This means the bounded execution could not finish, not that the request needs unlimited retries. Try the exact product name alone and confirm the current displayed order. Some unresolved name/ordinal and repeated-lookup cases remain under investigation; report the transcript and redacted runtime/browser errors.

## Privacy and safety

- Microphone capture starts after shopper interaction and can be stopped. Audio recording is disabled by default.
- Provider credentials and signing secrets stay server-side; do not commit `.env`, local databases, or private recordings.
- Store content and model output are untrusted proposals. Product identity, variants, prices, availability, and cart state come from Shopify evidence.
- Basket changes require explicit approval and verified read-back. A grant authenticates a session, not permission for arbitrary mutations.
- Checkout remains a human-controlled handoff; Drake does not enter payment information or place orders.
- Uploaded image bytes are not persisted by the runtime. The widget stores small thumbnails and recent conversation/cards in per-tab session storage to survive navigation.

## Current limitations

- Shopify Online Store themes are the supported integration; no WooCommerce adapter or cross-store search.
- Vision performs attribute-based discovery, not a visual-similarity index. Upload limits are 4 MB and 16 million decoded pixels. NVIDIA downscales image input to at most 512 pixels per side, which can lose fine detail.
- Missions support two to four item scopes in one store currency. Budgets cover the proposed subtotal, excluding unverified tax, shipping, duties, and discounts.
- Cart writes are serial, not atomic. Price/stock changes can invalidate a proposal; uncertain or partial outcomes require inspecting the actual cart.
- Pending Plus workflow state is single-process memory. Horizontal scaling and durable workflow recovery are not implemented.
- Full navigation interrupts the page's audio connection; reconnection/resume, microphone permission, and autoplay restrictions still apply.
- Native search ordering, pagination/infinite-scroll support, and cart drawers depend on theme markup. Test your own theme; unsupported or ambiguous references must not be treated as verified.
- Provider availability, quota, latency, and account entitlements can prevent live requests despite passing offline tests.

## License

No project-wide open-source license has been granted. Unless a license file is added, the source remains subject to the repository owner's rights. Bundled dependencies retain their own licenses; the self-hosted Deep Chat component is MIT-licensed.
