"""TTS quota errors must retain safe actionable codes through transport."""

import asyncio
import io
import json
import urllib.error

import pytest
from fastapi.testclient import TestClient
from ishop.tts.base import TtsProviderError
from ishop.tts.elevenlabs import ElevenLabsHttpTtsProvider
from test_audio_completion import make_app, send_turn
from test_voice_transport import ORIGIN, SHOP, signed_grant


@pytest.mark.parametrize(
    ("status", "detail", "code", "retryable"),
    [
        (
            401,
            {"status": "quota_exceeded", "message": "private account details"},
            "tts_insufficient_credits",
            False,
        ),
        (
            401,
            {"code": "quota_exceeded", "type": "invalid_request"},
            "tts_insufficient_credits",
            False,
        ),
        (402, {}, "tts_insufficient_credits", False),
        (401, {"code": "invalid_api_key"}, "tts_auth_failed", False),
        (403, {"code": "voice_not_allowed"}, "tts_voice_unavailable", False),
        (429, {}, "tts_rate_limited", True),
        (503, {}, "tts_provider_unavailable", True),
    ],
)
def test_http_error_classification_prefers_provider_code(status, detail, code, retryable):
    def opener(request, timeout):
        raise urllib.error.HTTPError(
            request.full_url,
            status,
            "Provider error",
            {},
            io.BytesIO(json.dumps({"detail": detail}).encode()),
        )

    provider = ElevenLabsHttpTtsProvider(api_key="test-key", opener=opener)
    with pytest.raises(TtsProviderError) as caught:
        asyncio.run(provider.synthesize("Hello", 1))
    assert caught.value.code == code
    assert caught.value.retryable is retryable
    assert "private account" not in str(caught.value)


def test_quota_failure_is_exposed_without_replacing_text_reply():
    def opener(request, timeout):
        raise urllib.error.HTTPError(
            request.full_url,
            401,
            "Quota",
            {},
            io.BytesIO(b'{"detail":{"status":"quota_exceeded"}}'),
        )

    provider = ElevenLabsHttpTtsProvider(api_key="test-key", opener=opener)

    async def tts(text, revision, grant):
        return await provider.synthesize(text, revision)

    with TestClient(make_app(tts)).websocket_connect(
        f"/ws/voice/{SHOP}", headers={"origin": ORIGIN}
    ) as ws:
        ws.send_json({"type": "authenticate", "grant": signed_grant()})
        ws.receive_json()
        send_turn(ws, 1)
        assert ws.receive_json()["spoken_response"] == "A test reply."
        error = ws.receive_json()
        assert error["type"] == "tts_unavailable"
        assert error["failure_code"] == "tts_insufficient_credits"
        assert error["retryable"] is False
        send_turn(ws, 2)
        assert ws.receive_json()["type"] == "shopping_result"
