"""Offline NVIDIA wire/validation tests; real provider results are reported separately."""

import asyncio
import io
import json
import urllib.error
from dataclasses import replace

import pytest
from fastapi.testclient import TestClient
from ishop.app import create_runtime_app
from ishop.plus import NvidiaGemmaClient, PlusError, VisionSpec, create_gemma_client, validate_image
from test_plus import image_payload
from test_runtime_app import settings


class Response(io.BytesIO):
    status = 200


def test_nvidia_image_wire_and_schema_validation_ignore_reasoning(monkeypatch):
    calls = []

    def open_request(request, **kwargs):
        calls.append((request, kwargs))
        return Response(
            json.dumps(
                {
                    "choices": [
                        {
                            "finish_reason": "stop",
                            "message": {
                                "content": '```json\n{"query":"croissant","currency":"USD"}\n```',
                                "reasoning_content": "private reasoning must never become output",
                            },
                        }
                    ]
                }
            ).encode()
        )

    monkeypatch.setattr("ishop.plus.urllib.request.urlopen", open_request)
    client = NvidiaGemmaClient(api_key="test-nvidia-secret")
    result = asyncio.run(
        client.generate("Identify photo", VisionSpec, validate_image(image_payload()))
    )
    assert result.query == "croissant"
    request, options = calls[0]
    assert request.full_url == "https://integrate.api.nvidia.com/v1/chat/completions"
    assert request.get_header("Authorization") == "Bearer test-nvidia-secret"
    body = json.loads(request.data)
    assert body["model"] == "google/gemma-4-31b-it"
    assert body["stream"] is True and body["max_tokens"] == 768
    assert body["chat_template_kwargs"] == {"enable_thinking": False}
    assert "thinkingConfig" not in body and "generationConfig" not in body
    assert body["messages"][0]["content"][1]["image_url"]["url"].startswith(
        "data:image/jpeg;base64,"
    )
    assert options["timeout"] == 180


@pytest.mark.parametrize("code", [401, 403, 429, 500])
def test_nvidia_http_failure_is_safe_and_not_retried_as_schema_error(monkeypatch, code):
    calls = []

    def fail(request, **kwargs):
        calls.append(request)
        raise urllib.error.HTTPError(
            request.full_url, code, "failed", {}, io.BytesIO(b"private provider data")
        )

    monkeypatch.setattr("ishop.plus.urllib.request.urlopen", fail)
    with pytest.raises(PlusError, match=f"HTTP {code}") as exc:
        asyncio.run(NvidiaGemmaClient(api_key="test-key").generate("photo", VisionSpec))
    assert len(calls) == 1 and "private provider data" not in str(exc.value)


def test_nvidia_malformed_reply_gets_only_one_schema_repair(monkeypatch):
    calls = []

    def malformed(request, **kwargs):
        calls.append(request)
        return Response(b'{"choices":[{"message":{"content":"invalid JSON"}}]}')

    monkeypatch.setattr("ishop.plus.urllib.request.urlopen", malformed)
    with pytest.raises(PlusError, match="interpret"):
        asyncio.run(NvidiaGemmaClient(api_key="test-key").generate("photo", VisionSpec))
    assert len(calls) == 2


def test_nvidia_token_limit_is_not_reported_as_success(monkeypatch):
    monkeypatch.setattr(
        "ishop.plus.urllib.request.urlopen",
        lambda *a, **k: Response(
            b'{"choices":[{"finish_reason":"length","message":{"content":"{}"}}]}'
        ),
    )
    with pytest.raises(PlusError, match="too detailed"):
        asyncio.run(NvidiaGemmaClient(api_key="test-key").generate("photo", VisionSpec))


def test_runtime_selects_nvidia_without_google_key_and_reports_safe_health(monkeypatch):
    monkeypatch.setenv("ISHOP_PLUS_GEMMA_PROVIDER", "nvidia")
    configured = replace(settings(), nvidia_api_key="test-nvidia-secret", gemini_api_key=None)
    with TestClient(create_runtime_app(configured)) as client:
        health = client.get("/health").json()
    assert health["plus_provider"] == "nvidia"
    assert health["plus_model"] == "google/gemma-4-31b-it"
    assert health["plus_model_configured"] is True
    assert "test-nvidia-secret" not in json.dumps(health)
    assert isinstance(create_gemma_client(nvidia_api_key="test-key"), NvidiaGemmaClient)


def test_unknown_provider_is_rejected(monkeypatch):
    monkeypatch.setenv("ISHOP_PLUS_GEMMA_PROVIDER", "unknown")
    with pytest.raises(ValueError, match="google, nvidia or openrouter"):
        create_gemma_client()


def test_nvidia_stream_reassembles_json_and_discards_reasoning(monkeypatch):
    class Stream(Response):
        headers = {"Content-Type": "text/event-stream"}

    chunks = [
        {"choices": [{"delta": {"reasoning_content": "private"}, "finish_reason": None}]},
        {"choices": [{"delta": {"content": '{"query":"croissant",'}, "finish_reason": None}]},
        {"choices": [{"delta": {"content": '"currency":"USD"}'}, "finish_reason": "stop"}]},
    ]
    wire = b"".join(b"data: " + json.dumps(c).encode() + b"\n\n" for c in chunks)
    wire += b"data: [DONE]\n\n"
    monkeypatch.setattr("ishop.plus.urllib.request.urlopen", lambda *a, **k: Stream(wire))
    result = asyncio.run(NvidiaGemmaClient(api_key="test-key").generate("photo", VisionSpec))
    assert result.query == "croissant"
    assert "private" not in result.model_dump_json()


@pytest.mark.parametrize(
    "chunk",
    [
        {"choices": [{"delta": {"content": "{}"}, "finish_reason": None}]},
        {"error": {"message": "private provider failure"}},
        {"choices": [{"delta": {"tool_calls": [{"name": "write_cart"}]}}]},
    ],
)
def test_nvidia_incomplete_or_failed_stream_never_produces_a_success(monkeypatch, chunk):
    class Stream(Response):
        headers = {"Content-Type": "text/event-stream"}

    wire = b"data: " + json.dumps(chunk).encode() + b"\n\ndata: [DONE]\n\n"
    monkeypatch.setattr("ishop.plus.urllib.request.urlopen", lambda *a, **k: Stream(wire))
    with pytest.raises(PlusError) as error:
        asyncio.run(NvidiaGemmaClient(api_key="test-key").generate("photo", VisionSpec))
    assert "private provider failure" not in str(error.value)


def test_nvidia_timeout_is_reported_as_latency_not_invalid_key(monkeypatch):
    def timeout(*args, **kwargs):
        raise TimeoutError("socket read timed out")

    monkeypatch.setattr("ishop.plus.urllib.request.urlopen", timeout)
    with pytest.raises(PlusError, match="took too long"):
        asyncio.run(NvidiaGemmaClient(api_key="test-key").generate("photo", VisionSpec))


def test_nvidia_pending_result_polls_same_request_without_regeneration(monkeypatch):
    pending_id = "00000000-0000-0000-0000-000000000001"

    class Pending(Response):
        status = 202
        headers = {"NVCF-REQID": pending_id}

    calls = []

    def respond(request, **kwargs):
        calls.append(request)
        if len(calls) == 1:
            return Pending(b"")
        return Response(
            json.dumps(
                {
                    "choices": [
                        {
                            "finish_reason": "stop",
                            "message": {
                                "content": json.dumps({"query": "croissant", "currency": "USD"})
                            },
                        }
                    ]
                }
            ).encode()
        )

    monkeypatch.setattr("ishop.plus.urllib.request.urlopen", respond)
    result = asyncio.run(NvidiaGemmaClient(api_key="test-key").generate("photo", VisionSpec))
    assert result.query == "croissant"
    assert [r.get_method() for r in calls] == ["POST", "GET"]
    assert calls[1].full_url.endswith("/status/" + pending_id)
