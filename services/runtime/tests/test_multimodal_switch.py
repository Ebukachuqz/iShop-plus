"""Groq wire and signed per-merchant selection tests; provider calls are mocked."""

import asyncio
import io
import json
import urllib.error
from dataclasses import replace

import pytest
from fastapi.testclient import TestClient
from ishop.app import create_runtime_app
from ishop.plus import (
    AgentChoice,
    GroqVisionClient,
    PlusError,
    VisionSpec,
    create_gemma_client,
    split_reasoning_profile,
)
from test_openrouter_gemma import reply
from test_plus import image_payload
from test_runtime_app import settings
from test_voice_transport import signed_grant


def test_groq_image_request_uses_own_wire_and_bounded_output(monkeypatch):
    calls = []

    def send(request, **kwargs):
        calls.append(request)
        return reply()

    monkeypatch.setattr("ishop.plus.urllib.request.urlopen", send)
    client = create_gemma_client(provider="groq", groq_api_key="test-key")
    assert isinstance(client, GroqVisionClient)
    image = {"mimeType": "image/png", "data": image_payload()["data"]}
    assert asyncio.run(client.generate("Identify photo", VisionSpec, image)).query == "croissant"
    r = calls[0]
    body = json.loads(r.data)
    assert r.full_url == "https://api.groq.com/openai/v1/chat/completions"
    assert r.get_header("User-agent") == "iShop-plus/0.1"
    assert body["model"] == "qwen/qwen3.8-27b"
    assert body["max_completion_tokens"] == 768
    assert body["temperature"] == 0
    assert body["response_format"] == {"type": "json_object"}
    assert "provider" not in body and "reasoning" not in body
    assert body["messages"][0]["content"][1]["image_url"]["url"].startswith(
        "data:image/png;base64,"
    )


@pytest.mark.parametrize(
    "profile",
    ["gemini-flash|plus=unknown", "unknown|plus=groq", "gemini-flash|plus=groq|plus=google"],
)
def test_unknown_combined_profiles_rejected(profile):
    with pytest.raises(ValueError):
        split_reasoning_profile(profile)


def test_signed_merchant_selection_routes_separate_sessions(monkeypatch, tmp_path):
    calls = []

    class FakeModel:
        def __init__(self, provider):
            self.provider = provider or "google"
            self.model = "fixture"
            self.api_key = "fixture"

        async def generate(self, prompt, schema, image=None):
            calls.append((self.provider, schema.__name__, bool(image)))
            if schema is VisionSpec:
                return VisionSpec(query="croissant", currency="USD")
            return AgentChoice(variant_ids=[])

    monkeypatch.setattr("ishop.app.create_gemma_client", lambda **kw: FakeModel(kw.get("provider")))
    config = replace(settings(), state_db_path=str(tmp_path / "state.sqlite3"))
    app = create_runtime_app(config)
    with TestClient(app) as client:
        for i, provider in enumerate(["groq", "openrouter", "groq"]):
            grant = signed_grant(
                shop_id="shop.myshopify.com",
                permitted_origin="https://shop.myshopify.com",
                signing_secret=config.signing_secret,
                llm_profile_id=f"gemini-flash|plus={provider}",
                asr_profile_id="elevenlabs-scribe-v2-realtime",
                tts_profile_id="elevenlabs-tts-female-stream",
                anonymous_session_id=f"sess_selection_{i}",
                grant_id=f"grant_selection_{i}",
            )
            with client.websocket_connect(
                "/ws/voice/shop.myshopify.com", headers={"origin": "https://shop.myshopify.com"}
            ) as ws:
                ws.send_json({"type": "authenticate", "grant": grant})
                assert ws.receive_json()["type"] == "authenticated"
                ws.send_json(
                    {
                        "type": "plus_request",
                        "feature": "vision",
                        "request_id": "photo",
                        "text": "Find this",
                        "currency": "USD",
                        "request_revision": 1,
                        "page_epoch": 1,
                        "image": image_payload(),
                    }
                )
                for _ in range(5):
                    event = ws.receive_json()
                    if event["type"] == "plus_catalog_request":
                        break
                    assert event["type"] == "plus_activity", event
                assert event["type"] == "plus_catalog_request"
    assert [c[0] for c in calls] == ["groq", "openrouter", "groq"]


@pytest.mark.parametrize("code", [400, 401, 429, 500])
def test_groq_error_never_changes_provider_or_retries(monkeypatch, code):
    calls = []

    def fail(request, **kwargs):
        calls.append(request)
        raise urllib.error.HTTPError(request.full_url, code, "failed", {}, io.BytesIO(b"private"))

    monkeypatch.setattr("ishop.plus.urllib.request.urlopen", fail)
    with pytest.raises(PlusError, match=f"Groq Qwen.*HTTP {code}"):
        asyncio.run(GroqVisionClient("test-key").generate("photo", VisionSpec))
    assert len(calls) == 1
