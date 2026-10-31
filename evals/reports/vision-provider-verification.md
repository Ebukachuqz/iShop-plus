# Gemma image-provider verification

Observed on 1 November 2026. These are actual external API results, not mocked tests.

| Check | Result |
| --- | --- |
| Gemma 4 26B A4B text request, configured account | Passed |
| Gemma 4 26B A4B inline public JPEG | HTTP 400 INVALID_ARGUMENT |
| Gemma 4 31B inline public JPEG | HTTP 400 INVALID_ARGUMENT |
| Official google-genai SDK: Files upload, then Gemma image generation | Upload ACTIVE; inference HTTP 400; uploaded file deleted |
| Gemma image generation without optional generation settings | HTTP 400 |
| Gemma Interactions API, stable/beta, stateless | HTTP 400 |
| Gemma Google OpenAI-compatible image endpoint | HTTP 400 |
| Gemma streamGenerateContent image endpoint | HTTP 400 |
| Gemini 3.8 Flash diagnostic control: same key and public JPEG | Passed: correctly captioned croissants |

The image fixture was Google's public croissant photograph. Earlier generated PNG/JPEG
probes also failed. No shopper photos or cart data were used. API keys, provider thought
output, uploaded file identifiers and raw images are excluded from this report.

The controls indicate a Gemma-specific hosted image failure on the tested account/path.
They do not establish the underlying provider cause or prove a global outage. Image
encoding, general account authentication, and the ability to process the fixture through
Google's service were validated by the successful control. No alternate model was enabled
in the application and no unverified transport workaround was retained.

Vision is **not live-ready** on this configured route. The application now gives an
actionable image-specific failure instead of an endless retry suggestion. Existing text
shopping remains separate. Reproduce with:

```sh
python -m uv run --frozen --package ishop-runtime python scripts/check-gemma-vision.py
```

The diagnostic exits nonzero on failure and records only safe metadata under the ignored
artifacts/runs directory. A schema-valid response still needs checking against the image;
it does not prove connected-store retrieval or cart execution.

Next external check: reproduce an image request in Google AI Studio with the same project
and Gemma model, then seek provider clarification on image access/availability. Do not
rotate credentials blindly, retry HTTP 400 indefinitely, or call a Gemini fallback Gemma.

Official references:

- [Gemma hosted API and image example](https://ai.google.dev/gemma/docs/core/gemma_on_gemini_api)
- [Interactions request reference](https://ai.google.dev/api/interactions-api)
- [Google compatibility image format](https://ai.google.dev/gemini-api/docs/openai)
