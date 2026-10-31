from __future__ import annotations

import asyncio
import io
import json

from ishop.config import RuntimeSettings
from ishop.tts.elevenlabs import ElevenLabsHttpTtsProvider
from ishop.tts.factory import create_default_tts_registry


def test_text_runtime_does_not_require_a_retired_sahara_credential(monkeypatch):
    monkeypatch.setenv("SESSION_SIGNING_SECRET", "plus_test_signing_secret_at_least_32_chars")
    monkeypatch.setenv("DEV_ALLOWED_ORIGINS", "https://shop.myshopify.com")
    monkeypatch.delenv("SAHARA_API_KEY", raising=False)
    monkeypatch.delenv("INTRON_API_KEY", raising=False)
    monkeypatch.delenv("ELEVENLABS_API_KEY", raising=False)
    settings = RuntimeSettings.from_environment()
    assert settings.sahara_api_key == ""
    assert settings.elevenlabs_api_key is None


def test_live_tts_registry_contains_only_elevenlabs():
    registry = create_default_tts_registry(sahara_api_key="retired", gemini_api_key="retired")
    assert set(registry.list_profiles()) == {
        "elevenlabs-tts-female-stream", "elevenlabs-tts-female-ws"
    }
    assert registry.get("sahara-tts-female-pidgin") is None


def test_elevenlabs_account_voice_and_model_overrides_use_existing_stream(monkeypatch):
    monkeypatch.setenv("ELEVENLABS_VOICE_ID", "account_voice")
    monkeypatch.setenv("ELEVENLABS_TTS_MODEL", "account_model")
    calls = []

    def opener(request, timeout):
        calls.append((request, timeout))
        return io.BytesIO(b"\x00\x00\x01\x00")

    provider = ElevenLabsHttpTtsProvider(api_key="test-key", opener=opener)
    async def synthesize():
        session = await provider.synthesize("Your shopping list is ready.", generation=2)
        return [chunk async for chunk in session.chunks()]

    chunks = asyncio.run(synthesize())
    request, timeout = calls[0]
    assert "/account_voice/stream?output_format=pcm_16000" in request.full_url
    assert json.loads(request.data)["model_id"] == "account_model"
    assert timeout == 10.0
    assert chunks[0].generation == 2
    assert chunks[0].audio == b"\x00\x00\x01\x00"
