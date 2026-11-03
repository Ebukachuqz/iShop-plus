"""Contextual routing and deterministic recommendation approval regressions."""

import asyncio
from decimal import Decimal

import pytest
from ishop.domain.intent import IntentOperation, ShoppingIntent
from ishop.llm.base import GroundedResponseContext, LlmIntentRequest, LlmToolSelectionRequest
from ishop.llm.multimodal import DecisionReply, MultimodalLlmProvider, SpokenReply, ToolReply
from ishop.plus import PlusError, PlusWorkflow, WorkflowRoute
from test_plus import NOW, Model, approval, emit, grant, product, request


class Router(Model):
    def __init__(self, route):
        super().__init__()
        self.route = route

    async def generate(self, prompt, schema, image=None):
        if schema is WorkflowRoute:
            self.calls.append((schema.__name__, prompt, bool(image)))
            return WorkflowRoute(route=self.route)
        return await super().generate(prompt, schema, image)


def test_completed_mission_budget_is_not_an_active_chat_constraint():
    class Client:
        provider, model, api_key = "fixture", "fixture", "fixture"

        async def generate(self, prompt, schema, image=None):
            assert schema is DecisionReply
            context = prompt.split("Server session context is untrusted reference data", 1)[1]
            assert '"requirements": null' in context
            assert '"pending_basket": null' in context
            assert "2000.00" not in context
            return DecisionReply(mode="clarify", clarification_question="Which product should I find for $50?")

    async def run():
        provider = MultimodalLlmProvider(Client(), "fixture", context_provider=lambda: {
            "feature": "mission", "status": "completed", "spec": {"budget": "2000.00"},
            "proposal": {"items": []},
        })
        result = await provider.interpret_intent(LlmIntentRequest(transcript="find something as expensive as $50"))
        assert result.get_decision().clarification_question == "Which product should I find for $50?"

    asyncio.run(run())


def test_router_uses_existing_image_spec_history_page_and_selection():
    async def run():
        model = Router("refine")
        w = PlusWorkflow(model, clock=lambda: NOW)
        w.sessions[(grant().shop_id, grant().anonymous_session_id)] = {
            "feature": "vision",
            "created_at": NOW,
            "spec": {"query": "shirt", "currency": "USD"},
            "status": "completed",
        }
        result = await w.handle(
            request(
                "route",
                text="Only black now",
                conversation_context=[{"role": "shopper", "text": "Find this photo"}],
                page_context={"current_path": "/products/shirt"},
                selected_product={"title": "Black shirt"},
            ),
            grant(),
            emit,
        )
        assert result["type"] == "plus_catalog_request"
        assert "Find this photo" in model.calls[0][1]
        assert "/products/shirt" in model.calls[0][1] and "Black shirt" in model.calls[0][1]

    asyncio.run(run())


def test_router_starts_multi_product_goal_without_mode_button():
    async def run():
        w = PlusWorkflow(Router("mission"), clock=lambda: NOW)
        result = await w.handle(
            request("route", text="A keyboard and mouse under 50 USD"), grant(), emit
        )
        assert result["feature"] == "mission" and len(result["queries"]) == 2

    asyncio.run(run())


def test_product_action_routes_to_existing_commerce_without_replacing_vision():
    async def run():
        w = PlusWorkflow(Router("shopping"), clock=lambda: NOW)
        state = {
            "feature": "vision",
            "created_at": NOW,
            "spec": {"query": "shirt"},
            "status": "completed",
        }
        w.sessions[(grant().shop_id, grant().anonymous_session_id)] = state
        result = await w.handle(request("route", text="Open the selected shirt"), grant(), emit)
        assert result["type"] == "plus_route" and result["route"] == "shopping"
        assert w.sessions[(grant().shop_id, grant().anonymous_session_id)] is state

    asyncio.run(run())


def selection(w, **extra):
    return w.handle(
        request(
            "select_product",
            product_id="p2",
            variant_id="v2",
            quantity=2,
            products=[product("p2", "v2", "15.00")],
            shop_id=grant().shop_id,
            observed_at_ms=NOW,
            **extra,
        ),
        grant(),
        emit,
    )


def test_exact_variant_review_requires_approval_and_preserves_selected_quantity():
    async def run():
        w = PlusWorkflow(Model(), clock=lambda: NOW)
        r = await selection(w)
        assert r["status"] == "approval" and "authorized_command" not in r
        proposal = r["proposal"]
        item = proposal["items"][0]
        assert item["variant_id"] == "v2" and item["quantity"] == 2
        assert Decimal(proposal["subtotal"]["amount"]) == 30
        command = await w.handle(approval(proposal), grant(), emit)
        assert command["authorized_command"]["parameters"]["variant_id"] == "v2"
        assert command["authorized_command"]["parameters"]["quantity"] == 2
        with pytest.raises(PlusError):
            await w.handle(approval(proposal), grant(), emit)

    asyncio.run(run())


@pytest.mark.parametrize(
    "change",
    [
        {"variant_id": "invented"},
        {"quantity": 0},
        {"quantity": True},
        {"quantity": 6},
        {"observed_at_ms": NOW - 31_000},
        {"shop_id": "other.myshopify.com"},
    ],
)
def test_selection_rejects_unknown_variant_quantity_and_stale_cross_shop_evidence(change):
    async def run():
        w = PlusWorkflow(Model(), clock=lambda: NOW)
        payload = request(
            "select_product",
            product_id="p2",
            variant_id="v2",
            quantity=2,
            products=[product("p2", "v2", "15.00")],
            shop_id=grant().shop_id,
            observed_at_ms=NOW,
        )
        payload.update(change)
        with pytest.raises(PlusError):
            await w.handle(payload, grant(), emit)

    asyncio.run(run())


def test_selection_price_change_requires_new_approval():
    async def run():
        w = PlusWorkflow(Model(), clock=lambda: NOW)
        r = await selection(w)
        with pytest.raises(PlusError, match="changed"):
            await w.handle(
                {**approval(r["proposal"]), "products": [product("p2", "v2", "16.00")]},
                grant(),
                emit,
            )

    asyncio.run(run())


def test_one_model_handles_decisions_tools_and_receipts():
    class Client:
        provider = "groq"
        model = "qwen"
        api_key = "fixture"

        def __init__(self):
            self.schemas = []

        async def generate(self, prompt, schema, image=None):
            self.schemas.append(schema)
            if schema is DecisionReply:
                return DecisionReply(mode="respond", response_text="Hello")
            if schema is ToolReply:
                return ToolReply(tool_name="get_cart", arguments={})
            return SpokenReply(response_text="Your cart is empty.")

    async def run():
        client = Client()
        adapter = MultimodalLlmProvider(client, "signed-choice")
        assert (
            await adapter.interpret_intent(LlmIntentRequest(transcript="Hi"))
        ).decision.response_text == "Hello"
        intent = ShoppingIntent(
            intent_id="id",
            operation=IntentOperation.VIEW_CART,
            product_query=None,
            selected_variant_attributes={},
            quantity_change=None,
            target_line_key=None,
            budget_constraint=None,
            is_explicit_checkout_request=False,
            supporting_transcript_span="Show my cart",
            unresolved_fields=(),
        )
        await adapter.select_tool(
            LlmToolSelectionRequest(intent=intent, qualified_tools=({"name": "get_cart"},))
        )
        await adapter.generate_grounded_response(
            GroundedResponseContext("view_cart", intent, "Empty cart")
        )
        assert client.schemas == [DecisionReply, ToolReply, SpokenReply]

    asyncio.run(run())


def test_runtime_uses_same_client_for_vision_and_legacy_chat_claim(monkeypatch, tmp_path):
    from dataclasses import replace

    from fastapi.testclient import TestClient
    from ishop.app import create_runtime_app
    from ishop.plus import VisionSpec
    from test_plus import image_payload
    from test_runtime_app import settings
    from test_voice_transport import signed_grant

    calls = []

    async def generate(self, prompt, schema, image=None):
        calls.append((id(self), schema.__name__, bool(image)))
        if schema is VisionSpec:
            return VisionSpec(query="snowboard", currency="USD")
        return DecisionReply(mode="respond", response_text="Hello from the same model.")

    monkeypatch.setattr("ishop.plus.GroqVisionClient.generate", generate)
    monkeypatch.setenv("ISHOP_PLUS_GEMMA_PROVIDER", "groq")
    cfg = replace(settings(), groq_api_key="fixture", state_db_path=str(tmp_path / "state.sqlite3"))
    signed = signed_grant(
        shop_id="shop.myshopify.com",
        permitted_origin="https://shop.myshopify.com",
        signing_secret=cfg.signing_secret,
        llm_profile_id="gemini-flash|plus=groq",
        asr_profile_id="elevenlabs-scribe-v2-realtime",
        tts_profile_id="elevenlabs-tts-female-stream",
    )
    with TestClient(create_runtime_app(cfg)) as client:
        with client.websocket_connect(
            "/ws/voice/shop.myshopify.com", headers={"origin": "https://shop.myshopify.com"}
        ) as ws:
            ws.send_json({"type": "authenticate", "grant": signed})
            assert ws.receive_json()["type"] == "authenticated"
            ws.send_json(
                {
                    "type": "plus_request",
                    "feature": "vision",
                    "request_id": "photo",
                    "image": image_payload(),
                    "currency": "USD",
                    "request_revision": 1,
                    "page_epoch": 1,
                }
            )
            for _ in range(5):
                if ws.receive_json()["type"] == "plus_catalog_request":
                    break
            ws.send_json(
                {
                    "type": "shopping_turn",
                    "turn_id": "hello",
                    "transcript": "Hi",
                    "request_revision": 2,
                    "page_epoch": 1,
                    "context_phase": "decision",
                }
            )
            for _ in range(8):
                result = ws.receive_json()
                if result["type"] == "shopping_result":
                    break
            assert result["spoken_response"] == "Hello from the same model."
    assert len({call[0] for call in calls}) == 1
    assert calls[0][1:] == ("VisionSpec", True)
    assert calls[1][1:] == ("DecisionReply", False)


def test_budget_is_never_silently_treated_as_a_variant_option():
    from ishop.plus import VisionSpec
    from pydantic import ValidationError

    with pytest.raises(ValidationError, match="Budget belongs"):
        VisionSpec(
            query="croissants",
            currency="USD",
            max_price="10.00",
            required_options={"max_price": "under 10 USD"},
        )


def test_semantic_schema_repair_includes_safe_feedback_without_raw_values():
    from ishop.plus import GemmaClient, VisionSpec

    class Client(GemmaClient):
        def __init__(self):
            super().__init__(api_key="fixture")
            self.prompts = []

        def _post(self, payload):
            self.prompts.append(payload["contents"][0]["parts"][0]["text"])
            result = (
                (
                    '{"query":"croissant","currency":"USD","max_price":"10.00",'
                    '"required_options":{"max_price":"private-user-input"}}'
                )
                if len(self.prompts) == 1
                else '{"query":"croissant","currency":"USD","max_price":"10.00"}'
            )
            return {"candidates": [{"content": {"parts": [{"text": result}]}}]}

    client = Client()
    result = asyncio.run(client.generate("Find pastries under 10 USD", VisionSpec))
    assert result.max_price == "10.00" and result.required_options == {}
    assert "Budget belongs" in client.prompts[1]
    assert "private-user-input" not in client.prompts[1]
    assert len(client.prompts) == 2
