"""Completion and cancellation metadata for progressive browser TTS."""

import asyncio

from fastapi.testclient import TestClient
from ishop.transport.websocket import create_voice_app
from test_voice_transport import ORIGIN, SECRET, SHOP, signed_grant


def make_app(tts):
    async def turn(payload, grant):
        return {"status": "completed", "spoken_response": "A test reply."}

    return create_voice_app(
        signing_secret=SECRET,
        allowed_origins={ORIGIN},
        shopping_turn_handler=turn,
        shopping_tts_handler=tts,
    )


def send_turn(ws, revision):
    ws.send_json(
        {
            "type": "shopping_turn",
            "transcript": "Hi",
            "turn_id": f"turn_{revision}",
            "request_revision": revision,
            "page_epoch": 1,
        }
    )


def chunk():
    return {
        "audio_base64": "AAAAAA==",
        "format": "pcm",
        "container": "none",
        "sample_rate": 16000,
        "channels": 1,
    }


def test_tts_stream_has_one_reply_identity_and_explicit_end():
    async def tts(text, revision, grant):
        yield chunk()
        yield chunk()

    with TestClient(make_app(tts)).websocket_connect(
        f"/ws/voice/{SHOP}", headers={"origin": ORIGIN}
    ) as ws:
        ws.send_json({"type": "authenticate", "grant": signed_grant()})
        ws.receive_json()
        send_turn(ws, 1)
        assert ws.receive_json()["type"] == "shopping_result"
        first, second, end = ws.receive_json(), ws.receive_json(), ws.receive_json()
        assert first["type"] == second["type"] == "shopping_tts"
        assert end["type"] == "shopping_tts_end"
        assert len({e["reply_id"] for e in [first, second, end]}) == 1
        assert all(e["reply_sequence"] == 1 for e in [first, second, end])
        send_turn(ws, 2)
        ws.receive_json()
        newer = ws.receive_json()
        assert newer["reply_sequence"] == 2 and newer["reply_id"] != first["reply_id"]


def test_cancelled_reply_cannot_end_a_newer_stream():
    cancelled = []

    async def tts(text, revision, grant):
        yield chunk()
        if revision == 1:
            try:
                await asyncio.Event().wait()
            finally:
                cancelled.append(revision)
        else:
            yield chunk()

    with TestClient(make_app(tts)).websocket_connect(
        f"/ws/voice/{SHOP}", headers={"origin": ORIGIN}
    ) as ws:
        ws.send_json({"type": "authenticate", "grant": signed_grant()})
        ws.receive_json()
        send_turn(ws, 1)
        ws.receive_json()
        old = ws.receive_json()
        send_turn(ws, 2)
        assert ws.receive_json()["type"] == "shopping_result"
        first, second, end = ws.receive_json(), ws.receive_json(), ws.receive_json()
        assert end["type"] == "shopping_tts_end" and end["reply_sequence"] == 2
        assert all(e["reply_id"] != old["reply_id"] for e in [first, second, end])
        assert cancelled == [1]


def test_partial_stream_failure_reuses_identity_without_false_completion():
    async def tts(text, revision, grant):
        yield chunk()
        raise RuntimeError("private provider response")

    with TestClient(make_app(tts)).websocket_connect(
        f"/ws/voice/{SHOP}", headers={"origin": ORIGIN}
    ) as ws:
        ws.send_json({"type": "authenticate", "grant": signed_grant()})
        ws.receive_json()
        send_turn(ws, 1)
        ws.receive_json()
        first, error = ws.receive_json(), ws.receive_json()
        assert error["type"] == "tts_unavailable"
        assert error["reply_id"] == first["reply_id"] and error["reply_sequence"] == 1
        assert "private" not in str(error)
