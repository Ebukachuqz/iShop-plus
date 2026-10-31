# Local application verification

Verified 1 November 2026. Scope: local SQLite, FastAPI and Shopify storefront integration.
No hosting changes, database migration, or remote deployment were performed in this pass.

## Executed checks

| Command or probe | Actual result | External boundary |
| --- | --- | --- |
| `pnpm test:unit` | Passed: 98 JavaScript, 19 Shopify, 319 Python tests | Offline fixtures |
| `pnpm check:ci` | Passed, including TypeScript, privacy and architecture checks | Local |
| `pnpm --filter @ishop/shopify-app build` | Client and SSR production build passed | Local |
| `pnpm test:e2e` | Passed: 53 Chrome journey assertions plus browser contract suites | Synthetic commerce and model responses |
| Focused widget suite | 35 passed; included in JavaScript total | Local fixtures |
| Focused Plus Python suite | 19 passed; included in Python total | Local fixtures |
| Real Gemma mission coordinator and two category researchers | Returned approval proposal, subtotal 50 USD, no authorized command | Real Gemma; synthetic catalogue |
| ElevenLabs synthesis/transcription, preceding focused live probe | 129,288 PCM bytes; exact expected transcript | Real ElevenLabs; generated speech |
| Gemma image understanding | Blocked, HTTP 400 | Real Google API and owner-supplied AI Studio screenshots |
| Local runtime through Cloudflare to real Shopify | Awaiting running preview/tunnel URLs | Not executed in this pass |

The unit total is 436 across languages. Browser contract checks overlap those suites and
are not added again to inflate a unique-test total. Dependency deprecation and React Router
future-flag warnings remain; no failed check is being reported as passed.

## Integrated journeys exercised

The Chrome fixture uses the actual storefront assets, signed WebSocket transport, Plus
workflow, journal, commerce bridge, and read-back validation. Only external model/provider
and Shopify responses are synthetic. It now covers:

1. A real browser File/preview sent through Vision, catalogue retrieval and ranking, with
   cards exposing only the matching variant and no automatic cart modification.
2. Three independently scoped mission research calls, a factual basket, rejection with
   zero writes, then a fresh proposal and explicit approval.
3. Sequential verified additions of three basket lines while preserving the shopper's
   preexisting quantity, followed by ordinary shopping and checkout-handoff regressions.
4. A committed-transcript event initiating Missions through the same frontend route as
   typed input. This event is injected: it is not proof of microphone capture or real STT.

Separate widget tests cover exact spoken approval of the displayed basket and ensure
qualified responses such as "Yes, but make it cheaper" refine rather than authorize.
Plus tests cover bounded secondary Vision queries, stale/replayed approvals, price/stock
changes, cancellation, draft recovery, cross-store rejection and failed catalogue reads.

## Changes and remaining limits

Added bounded Vision query deduplication and factual researcher timing/price trace metadata.
Clarified optional budgets in the coordinator prompt. Enabled unambiguous voice/text
approval of the current proposal; ambiguous or qualified approval remains a refinement.
The browser fixture uses ElevenLabs profile identifiers without pretending its stub is an
actual provider. Fixed its Send selector to target the chat form rather than a hidden
proposal control with the same CSS class.

Vision remains blocked by a hosted Gemma image failure. The owner's screenshots reproduce
it in both AI Studio Gemma models; Google Search grounding is enabled in those screenshots,
so they are additional evidence rather than identical tool-free reproductions. Our native
API/SDK image probes fail without tools too. See [provider verification](vision-provider-verification.md).
No fallback model is silently substituted and no provider-side cause is asserted as fact.

Real browser microphone permissions/playback, live theme-specific catalogue behavior,
and the authorized test-basket add/remove on the real store remain unverified. They require
the local runtime, current Cloudflare tunnel, unlocked Shopify preview and microphone/speaker
interaction. All three development processes must remain running. No live cart changes
were made in this pass.

Local SQLite and existing architecture are retained. Mission proposals are in memory:
a runtime restart requires fresh planning and approval. PostgreSQL, production persistence,
headless refactoring and deployment are outside this verification scope.
