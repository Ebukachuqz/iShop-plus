# iShop-plus demo and verification

## Before recording

- [ ] Configure matching signing secret, exact store origin, current WSS tunnel, and the installed theme embed.
- [ ] Confirm actual Gemma 4 access using the configured Google API key/model.
- [ ] Confirm ElevenLabs Scribe v2 Realtime and the selected TTS voice are available on the account.
- [ ] Choose Groq GPT OSS 120B for ordinary shopping chat with `GROQ_API_KEY` configured; the Gemini 3.8 ordinary-chat probe returned HTTP 503. Vision/Missions still use Gemma 4.
- [ ] Open the development storefront manually and pass its password gate in the normal browser. Connected catalogue/cart verification is to be completed after handoff.
- [ ] Choose two genuinely distinct, in-stock product categories from this store. Note actual names, variants, currency, prices, and a feasible combined budget. Do not use invented sample products.
- [ ] Prepare a non-sensitive photo/screenshot of an actual catalogue product.
- [ ] Note preexisting cart lines and quantities; preserve them during the demonstration.
- [ ] Confirm the owner has chosen a license before describing this public source as licensed open source. No license has been guessed or added.

## Short recording sequence

1. **Introduce iShop-plus and Drake.** Open the widget and show the luminous orb, text input, Photo, Missions, and voice controls.
2. **Speak one request.** Start a conversation, request a product, and let Drake answer aloud. Capture the actual transcript and reply. If provider or playback access fails, show text fallback and disclose the failed live check.
3. **Show Vision.** Attach the prepared photo and request an available attribute or realistic price cap in the actual store currency. Show Gemma analysis and current-store results. Refine once; use a lower budget for an honest no-match result if appropriate.
4. **Show Missions.** Request one item from each verified category with a feasible budget. Show independent research activity and the actual product basket. Explain the subtotal excludes shipping/tax.
5. **Check approval.** Say/type “don't add anything yet,” or use Reject. Show the cart stays unchanged. Replan if necessary and approve only the displayed proposal.
6. **Verify the cart.** Wait for serialized updates, open Shopify's cart, and compare actual contents with the proposal and preexisting lines. If the bridge blocks execution, show the real proposal and state the specific limitation; do not report a successful add.
7. **Finish.** Explain the shopper controls checkout. Show the repository and summarize what was actually demonstrated.

Use a screen recorder already available on the computer. No video is claimed as captured by this checklist. Keep API keys, browser credentials, private shopper data, and provider dashboards out of the recording.

## Negative and accessibility checks

- [ ] Invalid/oversized image gives an actionable error and is not persisted.
- [ ] No matching product gives an honest no-match result.
- [ ] Missing category/budget asks for clarification without a cart write.
- [ ] Reject/no approval causes zero writes; duplicate approval does not add twice.
- [ ] Changed price/stock invalidates approval.
- [ ] Existing cart lines survive; failed read-back never becomes success.
- [ ] Listening, working, and speaking correspond to real events.
- [ ] Mobile controls remain usable; reduced-motion stops orb animation.

## Test results

| Check | Result | Evidence |
| --- | --- | --- |
| Voice/profile/runtime tests | PASS, 25/25 | `.venv/Scripts/python.exe -m pytest services/runtime/tests/test_plus_voice_profiles.py services/runtime/tests/test_voice_provider_expansion.py services/runtime/tests/test_runtime_app.py -q` |
| Shopify app tests | PASS, 19/19 | `pnpm --filter @ishop/shopify-app test` |
| Combined final verification | PASS, 425 total | 97 JavaScript + 19 Shopify + 309 Python tests |
| Latest full Python rerun | PASS, 309/309; includes 270 runtime tests | `.venv/Scripts/python.exe -m pytest services/runtime/tests tests evals/tests -q`; completed 19:48 UTC, 31 October 2026 |
| Plus Vision/Missions and approval tests | PASS, 11/11 | `.venv/Scripts/python.exe -m pytest services/runtime/tests/test_plus.py -q` |
| Frontend widget/bridge regression tests | PASS as part of 97 JavaScript tests | `pnpm test:unit` |
| CI validation | PASS | `pnpm check:ci`; also Shopify TypeScript validation and new-file Ruff checks |
| Actual Gemma mission coordinator | PASS | Real request produced schema-validated tasks and a catalogue request |
| Actual Gemma image invocation | PASS, generated image fixture | Real Gemma 4 request interpreted generated PNG; this is not live catalogue matching |
| Actual ElevenLabs synthesis | PASS, Sarah voice | Account voice discovery followed by actual synthesis returned 138,206 PCM bytes. The former Rachel voice returned HTTP 402 and is no longer the default |
| Actual ElevenLabs realtime transcription | PASS, generated speech | Scribe returned exactly “Your shopping list is ready. Please review your basket before approving.” from actual generated audio; not a microphone/browser capture test |
| Audible browser playback | NOT VERIFIED | Confirm speaker output manually in the storefront |
| Connected Shopify Vision/mission approval | NOT VERIFIED; manual demo after handoff | Direct public-store API redirected to `/password`; owner will verify inside the normal authenticated shopper browser |
| Ordinary shopping-chat model | Groq greeting PASS; Gemini probe HTTP 503 | Select Groq GPT OSS 120B in merchant settings for this demo; Gemma 4 remains independent for new features |
| Recorded video | Not captured by automation | Add public/unlisted video URL after recording |

Fixture checks are separate from live integration verification.

## Submission handoff

- Repository: <https://github.com/Ebukachuqz/iShop-plus>
- Product: visual discovery and coordinated, approval-based shopping missions for Shopify.
- Models: hosted Gemma 4 for new workflows; ElevenLabs recognition and speech synthesis.
- New contribution: safe image ingress, interpretation and catalogue ranking; scoped mission research workers; deterministic basket/approval orchestration; event-driven animated Drake widget. Existing Shopify commerce and voice transport are inherited from iShop.
- Add the actual demo URL, confirmed live outcomes, and owner-selected license before final submission.
