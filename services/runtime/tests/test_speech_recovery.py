"""Speech failure isolation: billing/disconnect errors must not kill commerce."""

import asyncio

import pytest
from fastapi.testclient import TestClient
from ishop.domain.models import SessionGrant
from ishop.speech.base import SpeechProviderError
from ishop.speech.elevenlabs_scribe_realtime import ElevenLabsScribeRealtimeSession
from ishop.speech.realtime import SpeechEventKind
from ishop.transport.websocket import _validate_shopping_turn, create_voice_app
from test_voice_transport import ORIGIN, SECRET, SHOP, FakeRealtimeSession, signed_grant
from websockets.exceptions import ConnectionClosedOK
from websockets.frames import Close


def billing_close():
    close = Close(1000, "insufficient_funds_initial_check")
    return ConnectionClosedOK(close, close, True)


def test_elevenlabs_close_reason_becomes_safe_credit_error():
    class Socket:
        async def recv(self):
            raise billing_close()

        async def send(self, data):
            raise billing_close()

        async def close(self):
            pass

    async def run():
        async def connect(url, headers):
            return Socket()

        session = ElevenLabsScribeRealtimeSession("test-key", revision=1, connector=connect)
        await session.start()
        events = [event async for event in session.events()]
        assert events[0].kind == SpeechEventKind.ERROR
        assert events[0].error_code == "speech_insufficient_credits"
        with pytest.raises(SpeechProviderError) as caught:
            await session.send_audio(b"\0\0" * 512)
        assert caught.value.error_code == "speech_insufficient_credits"
        assert "insufficient_funds_initial_check" not in str(caught.value)
        await session.cancel()

    asyncio.run(run())


@pytest.mark.parametrize("binary", [True, False])
def test_provider_send_failure_does_not_close_shopping_socket(binary):
    class FailedSession(FakeRealtimeSession):
        async def send_audio(self, data):
            raise billing_close()

    async def shopping(payload, grant):
        return {"status": "completed", "spoken_response": "Text shopping still works."}

    app = create_voice_app(
        signing_secret=SECRET,
        allowed_origins={ORIGIN},
        session_factory=FailedSession,
        shopping_turn_handler=shopping,
    )
    with TestClient(app).websocket_connect(f"/ws/voice/{SHOP}", headers={"origin": ORIGIN}) as ws:
        ws.send_json({"type": "authenticate", "grant": signed_grant()})
        assert ws.receive_json()["type"] == "authenticated"
        ws.send_json({"type": "start_turn", "revision": 1})
        assert ws.receive_json()["type"] == "session_started"
        if binary:
            ws.send_bytes(b"\0\0" * 512)
        else:
            ws.send_json({"type": "audio_base64", "audio": "AAAA"})
        assert ws.receive_json()["error_code"] == "provider_stream_failed"
        # Already-in-flight audio is discarded without flooding duplicate errors.
        ws.send_bytes(b"\0\0" * 512)
        ws.send_json(
            {
                "type": "shopping_turn",
                "transcript": "Hello",
                "turn_id": "turn_text",
                "request_revision": 2,
                "page_epoch": 1,
            }
        )
        assert ws.receive_json()["spoken_response"] == "Text shopping still works."


def test_displayed_card_identities_are_bounded_and_unique():
    payload = {
        "type": "shopping_turn",
        "transcript": "open second",
        "turn_id": "turn_cards",
        "request_revision": 1,
        "page_epoch": 1,
        "displayed_search": {
            "schema_version": "1.0.0",
            "adapter": "drake-recommendations-v1",
            "actual_url": "/#cards_123",
            "query": "Recommendations",
            "sort_by": "relevance",
            "rendered_count": 2,
            "ordered_product_ids": ["p2", "p1"],
        },
    }
    _validate_shopping_turn(payload, SessionGrant(**signed_grant()))
    payload["displayed_search"]["ordered_product_ids"] = ["p1", "p1"]
    with pytest.raises(ValueError, match="identities"):
        _validate_shopping_turn(payload, SessionGrant(**signed_grant()))


def test_provider_error_event_keeps_text_transport_available():
    class BillingSession(FakeRealtimeSession):
        async def events(self):
            from ishop.speech.realtime import SpeechStreamEvent

            yield SpeechStreamEvent(
                SpeechEventKind.ERROR,
                "speech",
                self.revision,
                error_code="speech_insufficient_credits",
            )

    async def shopping(payload, grant):
        return {"status": "completed", "spoken_response": "You can still type."}

    app = create_voice_app(
        signing_secret=SECRET,
        allowed_origins={ORIGIN},
        session_factory=BillingSession,
        shopping_turn_handler=shopping,
    )
    with TestClient(app).websocket_connect(f"/ws/voice/{SHOP}", headers={"origin": ORIGIN}) as ws:
        ws.send_json({"type": "authenticate", "grant": signed_grant()})
        ws.receive_json()
        ws.send_json({"type": "start_turn", "revision": 1})
        events = [ws.receive_json(), ws.receive_json()]
        assert {event["type"] for event in events} == {"session_started", "error"}
        assert (
            next(event for event in events if event["type"] == "error")["error_code"]
            == "speech_insufficient_credits"
        )
        ws.send_json(
            {
                "type": "shopping_turn",
                "transcript": "Hello",
                "turn_id": "turn_text",
                "request_revision": 2,
                "page_epoch": 1,
            }
        )
        assert ws.receive_json()["spoken_response"] == "You can still type."
