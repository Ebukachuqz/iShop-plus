# NVIDIA Gemma integration verification

Verified 1 November 2026 against NVIDIA's hosted endpoint. No hosting or SQLite changes.

## Integration

Set the server-side environment values:

```dotenv
ISHOP_PLUS_GEMMA_PROVIDER=nvidia
NVIDIA_API_KEY=your_nvidia_api_key
```

Restart the local runtime after changing its environment. Vision and Missions use
`google/gemma-4-31b-it` at `https://integrate.api.nvidia.com/v1/chat/completions`.
Ordinary chat retains its existing merchant-selected reasoning profile. Google remains
an explicit alternative via `ISHOP_PLUS_GEMMA_PROVIDER=google`; there is no silent fallback.
Health identifies `plus_provider`, `plus_model` and credential presence, never the key.

The NVIDIA adapter uses user-message image parts with base64 JPEG data URIs, disables
thinking with the documented chat-template flag, and consumes SSE output. Only answer
content reaches Pydantic validation; reasoning fields and tool calls cannot authorize actions.
Input is normalized to a maximum 512 pixels per side and JPEG quality 80. This reduces
payload size but can lose fine print or small visual detail. Do not claim exact visual identity.

Output is bounded to 768 tokens, with a 180-second socket allowance and an outer timeout.
Interrupted streams, token truncation, failed requests and unexpected tool calls fail closed.
Malformed structured output gets at most one schema correction. An HTTP error is not
repeated as a schema repair. HTTP 202 is reported as pending rather than a fabricated answer.

## Actual external results

- NVIDIA model listing returned HTTP 200 and included the selected model.
- A compact public croissant JPEG through SSE returned HTTP 200 and correctly identified
  a basket of golden-brown croissants. This request took approximately 85 seconds.
- The production adapter's real image request returned schema-valid Vision JSON with
  query `croissants` and currency `USD`.
- Earlier non-streaming requests and a shorter structured-request timeout failed. A minimal
  text control also encountered a gateway timeout. Availability/latency is not consistently
  established; the free endpoint must not be presented as a production latency guarantee.
- A full Vision workflow probe with synthetic catalogue facts timed out during image analysis.
  A second bounded retry after removing a redundant single-candidate comparison also
  timed out during image interpretation. A successful standalone image call is not proof
  of a stable complete journey. No complete live Vision workflow pass is claimed.
- No real Shopify catalogue retrieval, cart write or browser microphone/playback pass is
  established by these image probes. Google's public photo was used; no shopper image
  or cart data was submitted.

Reproduce the selected provider's image interpretation with:

```sh
python -m uv run --frozen --package ishop-runtime python scripts/check-gemma-vision.py
```

The script exits nonzero on failure and saves safe metadata in the ignored artifacts/runs
directory. Schema validity is distinct from semantic accuracy and connected-store success.

## Local regression evidence

- 333 Python tests passed, including 14 NVIDIA adapter tests.
- JavaScript and Shopify unit suites passed in the full unit command.
- CI validation/type checks passed.
- The local Chrome/FastAPI journey passed 53 assertions with explicitly synthetic
  model and Shopify boundaries; those are not live NVIDIA/store tests.
- Ruff and staged secret checks passed for the integration phase.

When exactly one eligible variant remains, Vision now selects it deterministically instead
of spending an additional model call comparing it to nothing. Focused regressions and the
53-assertion local browser journey passed after this change.

The existing signed-session, fresh catalogue, exact-money, proposal approval and cart
read-back controls are reused. An image response cannot create a cart command.

Official references:

- [Hosted Gemma 4 model](https://build.nvidia.com/google/gemma-4-31b-it)
- [Image request and streaming parameters](https://docs.api.nvidia.com/nim/reference/google-gemma-4-31b-it-infer)
- [Pending invocation status](https://docs.api.nvidia.com/nim/reference/google-gemma-4-31b-it-statuspolling)
