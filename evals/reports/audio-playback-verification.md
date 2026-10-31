# Streaming playback and widget stability verification

## Changes

Raw PCM speech now uses one Web Audio timeline instead of restarting an HTML audio element for every packet. A small startup buffer (240 ms of audio or a 180 ms timer) absorbs packet jitter; adjacent buffers are scheduled contiguously. Explicit reply identifiers, sequence numbers, and end-of-stream events keep playback state stable until the final buffer finishes.

Interruption stops scheduled sources, clears buffered audio, and rejects late packets from cancelled turns. Suspended playback retains its queue for a user-gesture Play reply recovery. The speaking orb animates halo opacity instead of scaling its container; reserved status space and anchored playback controls prevent layout shifts. Short viewports retain accessible controls.

## Executed verification

- JavaScript contract/unit suite: 110 passed, zero failed. Includes continuous scheduling, odd-byte packet boundaries, interruption, late resume cancellation, autoplay rejection/retry, and mid-reply suspension without duplicate playback.
- Python runtime suite: 370 passed, with two dependency deprecation warnings. Three new authenticated WebSocket tests verify reply metadata, stream completion, cancellation, and partial-provider failure.
- Native Chrome fixture journey: 74 assertions passed on the final rerun outside the filesystem sandbox (Chrome could not launch inside it). Uses the real widget, Web Audio, FastAPI transport, and synthetic catalog/provider fixtures. Checks contiguous scheduled buffers, OfflineAudioContext sample continuity, gesture resume after explicit context suspension, interruption, and stable composer layout alongside existing Vision/Missions/cart journeys.
- Syntax, whitespace, and secret checks executed successfully before final review.

## Scope and limits

Native browser tests mute physical output. They demonstrate scheduling and rendered PCM continuity, not a human listening to ElevenLabs output. Explicit native context suspension exercises recovery; fresh-profile autoplay denial is covered by isolated tests rather than claimed as a native-policy result. Network starvation can still cause a gap; this change removes artificial packet-by-packet restarts, not upstream outages.

Restart FastAPI and refresh the Shopify preview together to load the paired end-of-stream protocol and player. Final manual check: listen to a long reply, interrupt it with a new request, and use Play reply if browser playback is blocked. No live Shopify cart writes or external synthesis calls were made for this verification.
