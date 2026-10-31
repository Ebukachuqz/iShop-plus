# Multimodal provider switching and Groq verification

This report records an earlier implementation. Its separate reasoning selectors are superseded by [unified Drake reasoning](unified-followup-verification.md).

## Implementation

Vision and Missions now accept a common typed `MultimodalClient` interface. Groq uses `qwen/qwen3.8-27b` through its documented HTTPS chat-completions endpoint, base64 image messages, JSON mode, disabled reasoning, and a bounded 768-token output. Existing Gemma providers remain available: Google, NVIDIA, and OpenRouter. There is no automatic provider/model fallback.

The Shopify admin **Drake provider settings** screen has an independent **Vision and Missions model** selector. Ordinary shopping chat and ElevenLabs voice remain separate. Selection eligibility checks server-side credential presence, not successful inference; quotas and provider outages can still prevent use. Groq Qwen is currently a preview model, not a guarantee of long-term production availability.

No database migration was added. The existing revisioned `llmProfileId` stores a recognized `<chat-profile>|plus=<provider>` identifier. That whole value is covered by the existing HMAC grant signature. The runtime explicitly allowlists combinations, resolves ordinary chat separately, and keeps workflow state in provider-specific coordinators. Unsupported combinations are rejected. Legacy profile IDs retain the runtime default, controlled by the backward-compatible `ISHOP_PLUS_GEMMA_PROVIDER` variable. New merchant choices apply to new signed shopper sessions, not in-flight missions.

During development, a server-only loader reads missing provider credentials from the existing root `.env`; explicitly set environment values take precedence and unrelated secrets are not loaded. Production still requires explicit environment configuration. The settings screen receives only safe identifiers, labels, and availability booleans. Keys remain server-side. SQLite, cart authorization, signed browser sessions, and ElevenLabs voice are preserved.

## Real external tests — 2026-11-01

Using the saved Groq credential and Google's public croissant photo:

| Test | Result | Boundary |
| --- | --- | --- |
| Authenticated model inventory | Qwen model listed | Actual Groq API |
| Image interpretation, one-candidate recommendation, price refinement | Two repeated runs passed, 2.7 seconds each | Actual Groq, synthetic catalogue |
| Image interpretation, two-candidate model ranking, recommendation, price refinement | Two repeated runs passed, 3.2 and 3.1 seconds | Actual Groq, synthetic catalogue |
| Mission coordinator, two independently scoped research calls, deterministic subtotal, rejection | Passed, 1.7 seconds; subtotal USD 35 | Actual Groq, synthetic catalogue |

The repeated Vision runs used a 65-second cooldown. Refinement excluded products exceeding USD 0.50. The model could only recommend supplied product identities. No cart command was issued by these probes.

Initial requests exposed two real issues. Python's default urllib User-Agent was rejected by the edge firewall with HTTP 403/error 1010; an explicit application User-Agent resolved it. A 2,300-token output allowance exceeded the account's reported 1,000 output-token limit; reducing it to 768 allowed the flows to complete. Rapid repeated runs also encountered HTTP 429. These free-account limits remain real; the application reports failure rather than silently switching models or automatically repeating shopping actions. Longer model output may require fewer requirements; truncated output is rejected, never treated as a complete plan.

## Executed regression checks

- Python: **352 passed**, two dependency deprecation warnings.
- Shopify settings/server tests: **24 passed**.
- Shopify TypeScript check: passed.
- Shopify production build: passed after separating browser-safe identifiers from server-only credential checks.
- Connected headless Chrome journey: **53/53 assertions passed** using actual FastAPI/controller and synthetic model/Shopify boundaries.
- Browser contract suite: passed via `pnpm test:e2e`.
- Ruff for the touched provider/probe tests: passed.
- Secret exclusion checks and Git whitespace check: passed.

Signed-session tests route independent sessions to Groq, OpenRouter, then Groq without leaking selection across them. Wire tests verify image data, Groq-specific parameters, output limits, the application header, and fail-closed HTTP handling. Persistence tests verify both the current setting and revision record retain the combined choice.

## Use and reproduce

1. Keep `GROQ_API_KEY` in ignored server environment configuration. The Shopify app server needs credential availability for its selector, and FastAPI needs the actual credential for inference.
2. Restart local FastAPI and Shopify app processes. Local `.env` now selects `ISHOP_PLUS_GEMMA_PROVIDER=groq` as the fallback.
3. In Shopify admin, open iShop-plus, choose **Groq — Qwen 3.8 27B** under **Vision and Missions model**, and save. Refresh/open a new shopper session. Choose a Gemma route there to switch back; no environment edit is needed for explicit merchant choices.
4. With the runtime package installed, run `python -m uv run --package ishop-runtime python scripts/check-vision-workflow.py --pause-seconds 65` from the repository root. This is an opt-in external-provider test against a synthetic catalogue; it never writes a cart.

Run metadata remains private under ignored `artifacts/runs/`. The report does not include keys, account identifiers, or private provider responses.

## Remaining verification

The unlocked Shopify development preview and current Cloudflare runtime URL are still required to verify this provider through the real storefront catalogue and authorized cart changes. The local browser fixture is not evidence of those external operations. Actual microphone capture, audible playback, and live voice-to-Vision/Missions were not retested here; the ElevenLabs implementation is unchanged. Free provider rate limits can interrupt sustained testing. Gemma endpoint failures and OpenRouter's upstream rate limit remain documented separately.

## Official sources

- [Groq vision: supported model, image messages, JSON mode](https://console.groq.com/docs/vision)
- [Groq supported models and preview-model policy](https://console.groq.com/docs/models)
