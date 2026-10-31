"""Offline wire tests; these do not prove external OpenRouter availability."""

import asyncio
import io
import json
import urllib.error

import pytest
from ishop.plus import (
    OpenRouterGemmaClient,
    PlusError,
    VisionSpec,
    create_gemma_client,
    validate_image,
)
from test_plus import image_payload


def reply(content='{"query":"croissant","currency":"USD"}', finish="stop", **extra):
    return io.BytesIO(
        json.dumps(
            {
                "choices": [
                    {
                        "finish_reason": finish,
                        "message": {"content": content, "reasoning": "private", **extra},
                    }
                ]
            }
        ).encode()
    )


def test_image_wire_and_factory(monkeypatch):
    calls = []

    def send(request, **kwargs):
        calls.append(request)
        return reply()

    monkeypatch.setattr("ishop.plus.urllib.request.urlopen", send)
    monkeypatch.setenv("ISHOP_PLUS_GEMMA_PROVIDER", "openrouter")
    client = create_gemma_client(openrouter_api_key="test-key")
    assert isinstance(client, OpenRouterGemmaClient)
    result = asyncio.run(client.generate("photo", VisionSpec, validate_image(image_payload())))
    assert result.query == "croissant"
    request = calls[0]
    assert request.full_url == "https://openrouter.ai/api/v1/chat/completions"
    assert request.get_header("Authorization") == "Bearer test-key"
    body = json.loads(request.data)
    assert body["model"] == "google/gemma-4-31b-it:free"
    assert body["provider"] == {"allow_fallbacks": False}
    assert body["messages"][0]["content"][1]["image_url"]["url"].startswith(
        "data:image/jpeg;base64,"
    )
    assert "generationConfig" not in body and "chat_template_kwargs" not in body


@pytest.mark.parametrize("code", [401, 402, 429, 503])
def test_http_failure_never_retries_or_leaks(monkeypatch, code):
    calls = []

    def fail(request, **kwargs):
        calls.append(request)
        raise urllib.error.HTTPError(request.full_url, code, "secret", {}, io.BytesIO(b"private"))

    monkeypatch.setattr("ishop.plus.urllib.request.urlopen", fail)
    with pytest.raises(PlusError, match=f"HTTP {code}") as error:
        asyncio.run(OpenRouterGemmaClient("test-key").generate("photo", VisionSpec))
    assert "private" not in str(error.value) and len(calls) == 1


@pytest.mark.parametrize(
    "finish,extra", [("length", {}), ("content_filter", {}), ("stop", {"tool_calls": [{}]})]
)
def test_incomplete_or_action_reply_fails_closed(monkeypatch, finish, extra):
    monkeypatch.setattr(
        "ishop.plus.urllib.request.urlopen", lambda *a, **k: reply(finish=finish, **extra)
    )
    with pytest.raises(PlusError):
        asyncio.run(OpenRouterGemmaClient("test-key").generate("photo", VisionSpec))


def test_malformed_output_has_one_repair(monkeypatch):
    calls = []

    def send(*args, **kwargs):
        calls.append(1)
        return reply("bad")

    monkeypatch.setattr("ishop.plus.urllib.request.urlopen", send)
    with pytest.raises(PlusError, match="interpret"):
        asyncio.run(OpenRouterGemmaClient("test-key").generate("photo", VisionSpec))
    assert len(calls) == 2
