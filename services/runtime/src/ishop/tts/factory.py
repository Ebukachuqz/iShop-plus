"""Factory for configured TTS providers."""

from __future__ import annotations

from ishop.tts.base import TtsRegistry
from ishop.tts.elevenlabs import ElevenLabsHttpTtsProvider, ElevenLabsWsTtsProvider


def create_default_tts_registry(
    sahara_api_key: str = "",
    elevenlabs_api_key: str = "",
    gemini_api_key: str = "",
    groq_api_key: str = "",
) -> TtsRegistry:
    registry = TtsRegistry()
    # Legacy arguments remain accepted so callers do not need a provider-wide
    # refactor. Only ElevenLabs can synthesize live iShop-plus responses.
    registry.register("elevenlabs-tts-female-stream", ElevenLabsHttpTtsProvider(api_key=elevenlabs_api_key or None))
    registry.register("elevenlabs-tts-female-ws", ElevenLabsWsTtsProvider(api_key=elevenlabs_api_key or None))
    return registry
