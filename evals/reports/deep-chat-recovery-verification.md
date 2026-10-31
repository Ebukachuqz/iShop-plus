# Deep Chat and voice failure recovery verification

## Implementation

Drake now renders shopper and assistant messages with Deep Chat 2.5.1, pinned in the lockfile and self-hosted as a Shopify extension asset. `pnpm vendor:chat` reproduces the asset and license from the installed package. No runtime CDN, browser-side provider keys, alternative speech engine, or new commerce transport is introduced. The existing audio timeline, authenticated WebSocket, signed commands, proposal approval, and authoritative cart read-back remain in place.

- Submitted photos become message attachments. Only a small JPEG thumbnail (maximum dimension 384 pixels and bounded encoded size) is retained in per-tab session history. Full-resolution image input remains transient. Recent text, thumbnails, and recommendation blocks restore in chronological order after navigation.
- Every recommendation response gets its own block; refinements no longer overwrite older cards. Latest or explicitly selected card positions carry ordered product IDs separately from enrichment order. The backend rejects unknown/duplicate IDs. Picking a visible recommendation is deterministic; it never authorizes a cart mutation. Variant review still refreshes catalog data and requires basket approval.
- The recording controls are **Record request**, **Finish recording**, **Live conversation**, and **End conversation**. Local microphone cleanup happens even when socket sends fail. Cancellation also covers pending microphone startup. Older socket close callbacks cannot reset a newer connection.
- ElevenLabs billing failures, documented provider error events, provider disconnects, and startup exceptions become safe error codes. They stop capture without terminating text shopping. Already queued audio after failure is discarded without repeated errors. UI errors remain until explicitly dismissed rather than disappearing on a status change.
- Workflow request slots are released before terminal responses are exposed to the browser, preventing a fast follow-up from being rejected while the previous task finishes delivery.
- Model/shopper text is rendered with raw HTML disabled. Interactive cards contain application-created DOM nodes and validated store links, not model-supplied HTML. Transcript display and block retention are bounded.

## Executed checks

- Full configured Python suite: **377 passed**, two existing dependency deprecation warnings.
- JavaScript contracts/unit tests: **115 passed**. Includes existing audio continuity/interruption/autoplay tests and new disconnected recording, sticky billing-error, deterministic second-result selection, image-message, and vendored-dependency integrity checks.
- Shopify app: **25 tests passed**; production build and React Router/TypeScript checks passed.
- Chrome connected storefront fixture: **84 assertions passed**, including the final raw-HTML safety assertion. The fixture uses the actual renderer, widget, transport, orchestration, approval, and cart verifier, with synthetic provider/catalog boundaries. It verifies native Web Audio continuity/recovery, photo display, variant selection, chronological card retention, approved baskets, error persistence, actual Finish recording button cleanup, text recovery, and mobile control bounds.
- Changed widget/voice/chat files pass ESLint; the speech adapter and new recovery test pass Ruff; widget/voice/chat scripts pass syntax checks. Public Markdown, whitespace, and secret checks are recorded with the completed commit.

The Shopify lint command previously referenced a missing ignore file; it now uses the existing `.eslintignore`, excluding generated types and the vendor bundle. A subsequent lint-cleanup pass resolved all 15 remaining violations without suppressing rules: bootstrap tests now construct complete typed loader arguments, the admin JSX escapes its apostrophe, unused bridge bookkeeping was removed, ESLint recognizes the supported ES2020 globals, and catalog fallback catches explain their intentional recovery. Full-app ESLint now passes. The follow-up reran all 115 JavaScript tests, all 25 Shopify tests, TypeScript checks, and the production build successfully. The earlier Python and Chrome results above belong to the renderer/recovery verification; Python and live/browser workflows were not rerun for this lint-only change.

## Limits and manual verification

No external ElevenLabs credit-consuming request or live Shopify cart write was made in this verification. Browser physical audio is muted; scheduling/PCM rendering checks do not prove that a human heard a live reply. Existing live account billing failures require available ElevenLabs credits/permissions. Local tunnel failures remain dependent on the user's network; the README provides an HTTP/2 alternative for QUIC/UDP failures.

Restart FastAPI and refresh the Shopify development preview to load both sides of the displayed-result protocol and the locally hosted component. Test one image followed by “pick the second one,” choose a variant, review and approve the basket, then test both recording modes. Historical cards are context, not proof of current stock or price; cart review refreshes current evidence.

## Official references

- [Deep Chat installation](https://deepchat.dev/docs/installation/)
- [Deep Chat messages and media](https://deepchat.dev/docs/messages/)
- [Deep Chat programmatic methods](https://deepchat.dev/docs/methods/)
- [Deep Chat connection handlers](https://deepchat.dev/docs/connect/)
- [ElevenLabs realtime event reference](https://elevenlabs.io/docs/eleven-api/guides/how-to/speech-to-text/realtime/event-reference)
- [ElevenLabs realtime API](https://elevenlabs.io/docs/api-reference/speech-to-text/v-1-speech-to-text-realtime)

## Shopify extension packaging follow-up

Shopify preview rejected the vendor license notice because `.txt` is not an accepted theme-extension asset format. The notice now ships verbatim inside `deep-chat-license.json`; `pnpm vendor:chat` regenerates that accepted format. The Liquid schema now references a small `drake-entry.js` loader, keeping the automatically loaded entry below the 10 KB theme-check threshold while loading the existing voice, chat, and bootstrap scripts in order.

Executed verification: Shopify CLI theme check inspected three files with **no offenses**; all **116 JavaScript tests** and full-app ESLint passed; the **84-assertion Chrome journey** passed through the new entrypoint. Packaging tests reject unsupported asset suffixes, verify the schema entry size, and check the complete vendor notice against the pinned dependency. No live preview publishing or live cart mutation was performed by this check.

## Live ElevenLabs synthesis diagnosis

A direct request using the configured local credentials, Sarah voice, Flash v2.5 model, and PCM 16 kHz output was rejected with `quota_exceeded`. A separate read-only subscription check confirmed no remaining allowance. No successful audio generation is claimed. Restoring ElevenLabs account credits is required before audible live testing can pass; no billing or account changes were made.

The HTTP adapter previously wrapped the structured error without a code, causing the generic `provider_error` message. It now prioritizes the provider error code over HTTP status (the observed quota rejection used HTTP 401), reports non-retryable `tts_insufficient_credits`, omits private response details, and separately categorizes authentication, unavailable voice/model, rate-limit, and connection failures. The widget says "Voice credits exhausted," and safe runtime logs include the actionable code.

Verification: a second direct provider request produced the corrected safe quota code; **385 Python tests**, **117 JavaScript tests**, and full-app ESLint passed. The new provider-to-WebSocket regression confirms text replies remain usable after TTS quota rejection. Provider metadata was inspected locally; credentials and raw account payloads were not committed. Successful synthesis and audible playback remain blocked by the account allowance.
