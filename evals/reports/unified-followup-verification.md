# Unified Drake reasoning and Vision follow-ups

## What changed

One merchant-selected **Drake model** now handles contextual goal routing, image interpretation, normal conversation, shopping intent, tool proposals, basket planning, research, and grounded replies. ElevenLabs remains the voice provider. The separate ordinary-chat and Vision/Missions selectors were replaced with one model selector. The storefront has a photo attachment control and no separate Chat/Missions mode buttons.

A bounded model router uses retained workflow requirements, displayed product identities, recent conversation, selected product context, and page context. It routes a new multi-product goal to coordinated research, an existing goal's constraint change to refinement, and conversation or product/cart actions to the existing commerce controller. That controller now wraps the same multimodal client rather than switching back to another provider. Server workflow context is available to follow-up reasoning through a session-scoped callback; it is never shared as mutable state between shoppers. Context is reference data, not cart authorization. Existing browser controls and explicit proposal approval remain deterministic.

The existing signed grant/profile storage is retained for compatibility; no SQLite migration or hosting change was introduced. Legacy chat claims no longer cause an independent model handoff. Existing sessions must reconnect after a runtime restart to load the updated implementation.

## Recommendation and variant corrections

- **Choose options** selects a concrete product and opens its option controls; it no longer fills the input with a bare product title.
- Every returned variant is listed. Multiple variants require an explicit choice; no first-option default is assumed.
- Quantity is an integer from 1 to 5. **Review addition** refreshes the product and creates an exact variant/quantity proposal without writing the cart.
- Explicit approval uses the existing fresh-evidence checks, serial cart tools, command journal, and read-back verifier. Unknown variants, stale/cross-store evidence, changed prices, unavailable quantities, and repeated approval fail closed.
- The product link includes the selected variant ID. Existing cart lines are preserved.
- Recommendation cards follow the request/answer that produced them. Product headings have explicit dark-theme contrast, with readable option controls.
- Singular/plural summaries are corrected. Long internal verification wording was replaced with concise approximate-match guidance.
- Displayed Vision identities are retained in server session context for subsequent goal decisions. Image bytes are not retained there.

A live probe exposed a further schema issue: the model sometimes placed `max_price` inside `required_options`. That made the catalogue look for a nonexistent variant option and return no matches. Budget/quantity/currency keys are now rejected in variant options. The existing one-attempt repair receives validation feedback with raw input values removed. An invalid output cannot silently turn a budget into a catalogue filter.

## Executed checks

The following commands completed successfully unless an explicit qualification is given. Real model calls and synthetic boundaries are distinguished below.

- Python regression suite: **367 passed**, including 15 new unified workflow tests.
- Shopify server/settings tests: **25 passed**.
- Widget unit/contract tests: **35 passed**.
- Connected headless Chrome: **63/63 assertions passed** through the production widget, FastAPI workflow, browser bridge, proposal approval, and cart verification, with **synthetic model and Shopify boundaries**.
- TypeScript generation/check and production Shopify build passed. The combined typecheck script's Prisma generation initially hit a DLL lock from the user's running preview. Type generation and `tsc --noEmit` were therefore run separately against the existing generated client, without stopping the user's app or changing the schema.
- Ruff and Git whitespace checks passed; secret-exclusion checks passed.

The expanded Chrome journey covers photo upload, image refinement, card ordering/contrast, choosing Dawn instead of the first Ice variant, reviewing quantity two with no write, approving, verifying Dawn quantity two while preserving Ice quantity one, following the variant-specific product URL, automatic multi-product planning, rejection, voice-final routing, and serialized basket approval. A signed WebSocket integration test proves Vision and a follow-up use the identical client even when a legacy grant contains a Gemini chat-profile label.

## Real Groq verification and limitations

The opt-in `scripts/check-unified-followup.py` uses the actual selected provider and Google's public croissant fixture with a synthetic catalogue. Successful runs exercised image interpretation, contextual follow-up routing, named-product navigation intent, qualified `get_product` selection, and exact quantity-two review. A successful run also detected a new keyboard-and-mouse goal and produced two research tasks without a mode button. These are not live Shopify/cart results.

Repeated provider probes also encountered HTTP 429 and, before the semantic validation fix, an empty synthetic match caused by a budget key in variant options. These failures are not represented as successful runs. The diagnostic accepts `--pause-before-goal 65` to separate its extra goal-planning check from the preceding model calls on a limited account. An earlier plumbing-only assertion also failed to detect a hallucinated gadget category in the pastry image. Groq sampling is now explicitly temperature zero, visual instructions require the literal object category rather than imagined replicas, and the public-fixture probe separately checks the expected food category before accepting a catalogue result. This reduces variability but does not prove general visual accuracy. Free capacity and deterministic model output are not guaranteed. The application does not silently switch models or repeat cart writes to recover.

Live Shopify verification of the updated release, actual microphone capture, and audible playback remain separate manual/connected checks. No live Shopify cart was modified during this work. Local SQLite, the development tunnels, and the exclusive ElevenLabs voice integration were preserved.

## Retest in the development preview

1. Restart FastAPI from the repository root. Leave the existing Cloudflare and Shopify preview processes running.
2. Refresh the iShop-plus admin page. Under **Drake model**, select Groq Qwen and save. Open a fresh storefront preview session.
3. Upload a snowboard photo and request available alternatives. Refine the budget conversationally.
4. Click **Choose options**, select the desired variant and quantity, then **Review addition**. Confirm the cart has not changed.
5. Approve the exact proposal once. Verify the selected variant/quantity in Shopify's cart and preservation of earlier lines.
6. Ask a multi-product goal directly in the same chat. There is no Missions button to enable.
7. If a rate-limit response occurs, inspect the cart before repeating a mutation, then wait for provider capacity to recover.
