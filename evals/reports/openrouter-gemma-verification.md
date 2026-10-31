# OpenRouter Gemma verification

## Scope and status

OpenRouter is an explicitly selected alternative for Vision and Missions. It keeps Gemma 4 and uses only `google/gemma-4-31b-it:free`; no paid or cross-model fallback is configured. Local SQLite, voice, commerce, and deployment remain unchanged.

Authenticated OpenRouter testing is pending the locally saved `OPENROUTER_API_KEY`. No external success is claimed. The free model listing currently identifies Google AI Studio as its provider, so it may reproduce the direct Google image failure.

The latest full NVIDIA workflow stopped during image analysis with HTTP 504 after 122.9 seconds. It did not reach catalogue matching. HTTP 202 polling cannot repair a provider HTTP 504. No cart writes occurred.

## Reproduction

Save the key in ignored `.env`, set `ISHOP_PLUS_GEMMA_PROVIDER=openrouter`, and restart the runtime. Run `python -m uv run --package ishop-runtime python scripts/check-vision-workflow.py` from the repository root. This runs two real model image-analysis/refinement journeys against a **synthetic catalogue**, verifies budget exclusion, and writes provider-specific results under ignored `artifacts/runs/`. It is not a live Shopify or cart test. The unlocked Shopify preview and runtime tunnel are still required for browser-to-store verification.

## Behaviour

Images use base64 image_url messages over HTTPS with bearer authentication. Credentials and raw provider errors are excluded from shopper messages. Replies undergo existing Pydantic validation and at most one schema repair; HTTP failures do not trigger duplicate generation. Unexpected tool calls, filtering, incomplete responses, and oversized output fail closed. Only final content is read; reasoning fields are excluded.

## Official references

- [Gemma 4 free model and providers](https://openrouter.ai/google/gemma-4-31b-it:free)
- [Official image input documentation](https://github.com/OpenRouterTeam/docs/blob/main/guides/overview/multimodal/image-understanding.mdx)

Offline wire tests are separate from authenticated provider tests.

## Executed offline checks

Full Python suite: **343 passed**, with two dependency deprecation warnings. This includes nine new OpenRouter wire/error tests and fifteen NVIDIA adapter tests. Ruff passed for the touched provider and probe files. These tests mock provider responses and do not establish external image availability.
