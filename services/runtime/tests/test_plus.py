"""Offline contract and authorization checks for the new workflows."""

import asyncio
import base64
import io
from types import SimpleNamespace

import pytest
from ishop.domain.models import CartLine, CartSnapshot
from ishop.plus import (
    AgentChoice,
    MissionSpec,
    PlusError,
    PlusWorkflow,
    VisionSpec,
    amount,
    candidates,
    validate_image,
)
from ishop.transport.websocket import _verify_reported_cart_result
from PIL import Image

NOW = 1_800_000_000_000
SHOP = "demo.myshopify.com"


def grant():
    return SimpleNamespace(
        shop_id=SHOP, anonymous_session_id="session_plus", is_valid_at=lambda now: True
    )


def product(pid="p1", vid="v1", price="20.00", color="Black", stock=10):
    return {
        "product_id": pid,
        "title": "Black " + pid,
        "handle": pid,
        "url": "/products/" + pid,
        "variants": [
            {
                "variant_id": vid,
                "product_id": pid,
                "variant_title": color,
                "selected_options": {"Color": color},
                "price": {"amount": price, "currency": "USD"},
                "available_for_sale": True,
                "quantity_available": stock,
            }
        ],
    }


class Model:
    model = "fake-for-offline-tests"

    def __init__(self):
        self.calls = []

    async def generate(self, prompt, schema, image=None):
        self.calls.append((schema.__name__, prompt, bool(image)))
        if schema is VisionSpec:
            return VisionSpec(
                query="shirt",
                currency="USD",
                max_price="30.00",
                required_options={"Color": "Black"},
            )
        if schema is MissionSpec:
            return MissionSpec(
                goal="Desk setup",
                budget="50.00",
                currency="USD",
                tasks=[
                    {"category": "keyboard", "query": "keyboard", "quantity": 1},
                    {"category": "mouse", "query": "mouse", "quantity": 1},
                ],
            )
        if "research_1" in prompt:
            return AgentChoice(variant_ids=["v1", "invented"])
        if "research_2" in prompt:
            return AgentChoice(variant_ids=["v2"])
        return AgentChoice(variant_ids=["v1", "invented"])


async def emit(stage, label):
    return None


def request(feature, **extra):
    return {
        "type": "plus_request",
        "feature": feature,
        "request_id": "r1",
        "currency": "USD",
        "text": "Keyboard and mouse under $50. Don't add anything yet.",
        **extra,
    }


async def mission(workflow, products=None):
    searching = await workflow.handle(request("mission"), grant(), emit)
    return await workflow.handle(
        {
            "type": "plus_catalog_result",
            "request_id": "r1",
            "shop_id": SHOP,
            "observed_at_ms": NOW,
            "results": [
                {"agent_id": task["agent_id"], "products": [p]}
                for task, p in zip(
                    searching["queries"], products or [product(), product("p2", "v2", "15.00")]
                )
            ],
        },
        grant(),
        emit,
    )


def approval(proposal, feature="approve", **extra):
    return request(
        feature,
        proposal_id=proposal["proposal_id"],
        revision=proposal["revision"],
        products=[product(), product("p2", "v2", "15.00")],
        shop_id=SHOP,
        observed_at_ms=NOW,
        current_cart=CartSnapshot(SHOP, "USD").to_dict(),
        page_epoch=1,
        request_revision=3,
        **extra,
    )


def image_payload():
    out = io.BytesIO()
    Image.new("RGB", (8, 8), "black").save(out, format="PNG")
    return {"mime_type": "image/png", "data": base64.b64encode(out.getvalue()).decode()}


def test_image_decode_and_mime_and_invalid_input():
    assert validate_image(image_payload())["mimeType"] == "image/jpeg"
    with pytest.raises(PlusError):
        validate_image({**image_payload(), "mime_type": "image/jpeg"})
    with pytest.raises(PlusError):
        validate_image({"mime_type": "image/png", "data": "bad-base64"})
    with pytest.raises(PlusError):
        validate_image({"mime_type": "image/svg+xml", "data": ""})


def test_gemma_provider_errors_are_not_retried_as_invalid_json():
    from ishop.plus import GemmaClient

    class Unavailable(GemmaClient):
        calls = 0

        def _post(self, payload):
            self.calls += 1
            raise PlusError("Gemma is unavailable (HTTP 503). Please try again shortly.")

    client = Unavailable(api_key="offline-test-key")
    with pytest.raises(PlusError, match="HTTP 503"):
        asyncio.run(client.generate("Classify this request", VisionSpec))
    assert client.calls == 1


def test_prices_options_stock_currency_are_deterministic():
    assert candidates([product()], "USD", {"Color": "Black"}, 2)
    assert not candidates([product(stock=1)], "USD", {}, 2)
    assert not candidates([product()], "NGN", {})
    assert not candidates([product()], "USD", {"Color": "Blue"})
    assert not candidates([product()], "USD", {}, cap=amount("19.99"))
    for bad in ["NaN", "Infinity", "-1", "oops"]:
        with pytest.raises(PlusError):
            amount(bad)


def test_vision_image_to_grounded_results_and_refinement():
    async def run():
        model = Model()
        workflow = PlusWorkflow(model, lambda: NOW)
        response = await workflow.handle(request("vision", image=image_payload()), grant(), emit)
        assert response["type"] == "plus_catalog_request"
        result = await workflow.handle(
            {
                "type": "plus_catalog_result",
                "request_id": "r1",
                "shop_id": SHOP,
                "observed_at_ms": NOW,
                "results": [
                    {"agent_id": "vision", "products": [product(), product("p2", "v2", "50.00")]}
                ],
            },
            grant(),
            emit,
        )
        assert [p["product_id"] for p in result["products"]] == ["p1"]
        assert "authorized_command" not in result
        assert model.calls[0][2]
        assert len(model.calls) == 1  # one eligible variant needs no comparison call
        await workflow.handle(request("refine", text="only black"), grant(), emit)
        assert not model.calls[-1][2]  # raw image is not retained

    asyncio.run(run())


def test_mission_independent_agents_budget_no_unapproved_writes():
    async def run():
        model = Model()
        workflow = PlusWorkflow(model, lambda: NOW)
        result = await mission(workflow)
        assert result["status"] == "approval"
        proposal = result["proposal"]
        assert proposal["subtotal"] == {"amount": "35", "currency": "USD"}
        assert len(result["agents"]) == 2
        assert len([call for call in model.calls if call[0] == "AgentChoice"]) == 2
        assert "authorized_command" not in result
        assert "invented" not in str(proposal)
        with pytest.raises(PlusError, match="Approve"):
            await workflow.handle(approval(proposal, "continue"), grant(), emit)
        rejected = await workflow.handle(approval(proposal, "reject"), grant(), emit)
        assert rejected["status"] == "rejected"
        with pytest.raises(PlusError):
            await workflow.handle(approval(proposal), grant(), emit)

    asyncio.run(run())


def test_approved_serial_commands_verified_preserve_existing_lines_no_replay():
    async def run():
        workflow = PlusWorkflow(Model(), lambda: NOW)
        proposal = (await mission(workflow))["proposal"]
        cart = CartSnapshot(SHOP, "USD", (CartLine("existing", 2),))
        action = approval(proposal)
        action["current_cart"] = cart.to_dict()
        first = await workflow.handle(action, grant(), emit)
        assert first["status"] == "executing"
        command = first["authorized_command"]
        with pytest.raises(PlusError):
            await workflow.handle(action, grant(), emit)
        after = CartSnapshot(SHOP, "USD", (*cart.lines, CartLine("v1", 1)))
        receipt = {
            "outcome": "verified_success",
            "before_cart": cart.to_dict(),
            "after_cart": after.to_dict(),
        }
        assert _verify_reported_cart_result(command, receipt)
        assert workflow.command_finished(command, receipt, True, grant())
        assert not workflow.command_finished(command, receipt, True, grant())
        action = approval(proposal, "continue")
        action["current_cart"] = after.to_dict()
        second = await workflow.handle(action, grant(), emit)
        final_cart = CartSnapshot(SHOP, "USD", (*after.lines, CartLine("v2", 1)))
        receipt = {
            "outcome": "verified_success",
            "before_cart": after.to_dict(),
            "after_cart": final_cart.to_dict(),
        }
        assert _verify_reported_cart_result(second["authorized_command"], receipt)
        workflow.command_finished(second["authorized_command"], receipt, True, grant())
        action["current_cart"] = final_cart.to_dict()
        assert (await workflow.handle(action, grant(), emit))["status"] == "completed"
        assert (await workflow.handle(action, grant(), emit))["status"] == "completed"

    asyncio.run(run())


def test_stale_price_or_missing_stock_invalidates_approval():
    async def run():
        for kind in ["price", "stock", "expired"]:
            clock = [NOW]
            workflow = PlusWorkflow(Model(), lambda: clock[0])
            proposal = (await mission(workflow))["proposal"]
            action = approval(proposal)
            if kind == "price":
                action["products"][0]["variants"][0]["price"]["amount"] = "21.00"
            elif kind == "stock":
                action["products"][0]["variants"][0]["available_for_sale"] = False
            else:
                clock[0] += 200_000
            with pytest.raises(PlusError):
                await workflow.handle(action, grant(), emit)
            assert not workflow.sessions[(SHOP, "session_plus")].get("in_flight")

    asyncio.run(run())


def test_infeasible_budget_and_wrong_tenant_do_not_create_commands():
    async def run():
        workflow = PlusWorkflow(Model(), lambda: NOW)
        result = await mission(workflow, [product(price="40.00"), product("p2", "v2", "40.00")])
        assert result["status"] == "no_match" and "proposal" not in result
        await workflow.handle(request("mission"), grant(), emit)
        with pytest.raises(PlusError):
            await workflow.handle(
                {
                    "type": "plus_catalog_result",
                    "request_id": "r1",
                    "shop_id": "wrong",
                    "observed_at_ms": NOW,
                },
                grant(),
                emit,
            )

    asyncio.run(run())


def test_cancel_during_write_stops_remaining_commands():
    async def run():
        workflow = PlusWorkflow(Model(), lambda: NOW)
        proposal = (await mission(workflow))["proposal"]
        response = await workflow.handle(approval(proposal), grant(), emit)
        cancelled = await workflow.handle(approval(proposal, "reject"), grant(), emit)
        assert cancelled["status"] == "canceling"
        after = CartSnapshot(SHOP, "USD", (CartLine("v1", 1),))
        workflow.command_finished(
            response["authorized_command"], {"after_cart": after.to_dict()}, True, grant()
        )
        with pytest.raises(PlusError):
            await workflow.handle(approval(proposal, "continue"), grant(), emit)

    asyncio.run(run())


def test_signed_websocket_vision_catalog_and_tts_roundtrip():
    from fastapi.testclient import TestClient
    from ishop.domain.models import SessionGrant
    from ishop.transport.websocket import create_voice_app

    secret = "plus_transport_test_secret_at_least_32_characters"
    origin = "https://" + SHOP
    workflow = PlusWorkflow(Model(), lambda: NOW)

    async def tts(text, revision, grant):
        yield {"audio": "AAAA", "generation": revision}

    app = create_voice_app(
        signing_secret=secret,
        allowed_origins={origin},
        clock_ms=lambda: NOW,
        session_factories={"elevenlabs-scribe-v2-realtime": lambda **kwargs: None},
        allowed_llm_profiles={"gemini-flash"},
        allowed_tts_profiles={"elevenlabs-tts-female-stream"},
        plus_handler=workflow.handle,
        shopping_tts_handler=tts,
    )
    signed = SessionGrant.create_signed(
        grant_id="grant_plus",
        shop_id=SHOP,
        permitted_origin=origin,
        anonymous_session_id="session_plus",
        config_revision="cfg1",
        asr_profile_id="elevenlabs-scribe-v2-realtime",
        llm_profile_id="gemini-flash",
        tts_profile_id="elevenlabs-tts-female-stream",
        issued_at_ms=NOW - 100,
        ttl_ms=60_000,
        signing_secret=secret,
    )

    def until(ws, kind):
        for _ in range(15):
            result = ws.receive_json()
            if result["type"] == kind:
                return result
        raise AssertionError("Expected event not received")

    with TestClient(app).websocket_connect("/ws/voice/" + SHOP, headers={"origin": origin}) as ws:
        ws.send_json({"type": "authenticate", "grant": signed.__dict__})
        assert ws.receive_json()["type"] == "authenticated"
        ws.send_json(request("vision", image=image_payload(), request_revision=2, page_epoch=1))
        assert until(ws, "plus_catalog_request")["queries"][0]["query"] == "shirt"
        ws.send_json(
            {
                "type": "plus_catalog_result",
                "request_id": "r1",
                "shop_id": SHOP,
                "observed_at_ms": NOW,
                "results": [{"agent_id": "vision", "products": [product()]}],
            }
        )
        result = until(ws, "plus_result")
        assert result["status"] == "completed" and result["request_revision"] == 2
        audio = until(ws, "shopping_tts")
        assert audio["request_revision"] == 2 and audio["page_epoch"] == 1
        ws.send_json(
            {
                "type": "plus_catalog_result",
                "request_id": "old",
                "shop_id": SHOP,
                "observed_at_ms": NOW,
            }
        )
        assert until(ws, "plus_result")["status"] == "error"


def test_signed_websocket_mission_uses_journal_and_verified_serial_results():
    import sqlite3

    from fastapi.testclient import TestClient
    from ishop.domain.journal import CommandJournal, CommandStatus
    from ishop.domain.models import SessionGrant
    from ishop.transport.websocket import create_voice_app

    secret = "mission_transport_signing_secret_at_least_32_chars"
    origin = "https://" + SHOP
    workflow = PlusWorkflow(Model(), lambda: NOW)
    journal = CommandJournal()
    # TestClient owns a second event-loop thread; production uses one runtime loop.
    journal._conn.close()
    journal._conn = sqlite3.connect(":memory:", check_same_thread=False)
    journal._conn.row_factory = sqlite3.Row
    journal._init_db()

    async def record(command, result, verified, signed):
        assert workflow.command_finished(command, result, verified, signed)
        return {"plus_mission": True}

    app = create_voice_app(
        signing_secret=secret,
        allowed_origins={origin},
        clock_ms=lambda: NOW,
        session_factories={"elevenlabs-scribe-v2-realtime": lambda **kwargs: None},
        allowed_llm_profiles={"gemini-flash"},
        allowed_tts_profiles={"elevenlabs-tts-female-stream"},
        plus_handler=workflow.handle,
        command_journal=journal,
        shopping_command_result_handler=record,
    )
    signed = SessionGrant.create_signed(
        grant_id="grant_mission",
        shop_id=SHOP,
        permitted_origin=origin,
        anonymous_session_id="session_plus",
        config_revision="cfg1",
        asr_profile_id="elevenlabs-scribe-v2-realtime",
        llm_profile_id="gemini-flash",
        tts_profile_id="elevenlabs-tts-female-stream",
        issued_at_ms=NOW - 100,
        ttl_ms=60_000,
        signing_secret=secret,
    )

    def until(ws, kind):
        for _ in range(15):
            result = ws.receive_json()
            if result["type"] == kind:
                return result
        raise AssertionError("Expected mission event not received")

    with TestClient(app).websocket_connect("/ws/voice/" + SHOP, headers={"origin": origin}) as ws:
        ws.send_json({"type": "authenticate", "grant": signed.__dict__})
        assert ws.receive_json()["type"] == "authenticated"
        ws.send_json(request("mission", request_revision=1, page_epoch=1))
        search = until(ws, "plus_catalog_request")
        ws.send_json(
            {
                "type": "plus_catalog_result",
                "request_id": "r1",
                "shop_id": SHOP,
                "observed_at_ms": NOW,
                "results": [
                    {"agent_id": task["agent_id"], "products": [p]}
                    for task, p in zip(search["queries"], [product(), product("p2", "v2", "15.00")])
                ],
            }
        )
        proposal = until(ws, "plus_result")["proposal"]
        assert not journal._conn.execute("SELECT * FROM command_journal").fetchall()
        cart = CartSnapshot(SHOP, "USD", (CartLine("existing", 3),))
        for index, variant in enumerate(["v1", "v2"]):
            payload = approval(proposal, "approve" if index == 0 else "continue")
            payload["current_cart"] = cart.to_dict()
            ws.send_json(payload)
            command = until(ws, "plus_result")["authorized_command"]
            assert journal.get_entry(command["command_id"]).status == CommandStatus.DISPATCHED
            after = CartSnapshot(SHOP, "USD", (*cart.lines, CartLine(variant, 1)))
            ws.send_json(
                {
                    "type": "command_result",
                    "command_id": command["command_id"],
                    "result": {
                        "outcome": "verified_success",
                        "before_cart": cart.to_dict(),
                        "after_cart": after.to_dict(),
                    },
                }
            )
            assert until(ws, "command_result_ack")["verified"]
            assert journal.get_entry(command["command_id"]).status == CommandStatus.VERIFIED_SUCCESS
            cart = after
        payload = approval(proposal, "continue")
        payload["current_cart"] = cart.to_dict()
        ws.send_json(payload)
        assert until(ws, "plus_result")["status"] == "completed"


def test_four_category_mission_and_optional_budget_schema():
    spec = MissionSpec(
        goal="Office",
        currency="NGN",
        tasks=[
            {"category": name, "query": name}
            for name in ("keyboard", "mouse", "monitor", "headphones")
        ],
    )
    assert len(spec.tasks) == 4 and spec.budget is None


def test_candidates_reject_excluded_attributes_and_fractional_currency():
    assert not candidates([product()], "USD", {}, excluded=["Black"])
    assert not candidates([product(price="20.001")], "USD", {})


def test_catalog_failure_is_not_empty_search():
    async def run():
        workflow = PlusWorkflow(Model(), lambda: NOW)
        await workflow.handle(request("mission"), grant(), emit)
        with pytest.raises(PlusError, match="could not be read"):
            await workflow.handle(
                {
                    "type": "plus_catalog_result",
                    "request_id": "r1",
                    "shop_id": SHOP,
                    "observed_at_ms": NOW,
                    "results": [
                        {"agent_id": "research_1", "products": [], "error": "catalog_read_failed"}
                    ],
                },
                grant(),
                emit,
            )

    asyncio.run(run())


def test_cancellation_releases_locks_and_discards_research_state():
    async def run():
        workflow = PlusWorkflow(Model(), lambda: NOW)
        await workflow.handle(request("mission"), grant(), emit)
        result = await workflow.handle(request("cancel", request_id="cancel_1"), grant(), emit)
        assert result["status"] == "cancelled"
        assert not workflow.sessions and not workflow.locks and not workflow.lock_users

    asyncio.run(run())


def test_websocket_cancels_slow_model_without_waiting_for_model_completion():
    from fastapi.testclient import TestClient
    from ishop.domain.models import SessionGrant
    from ishop.transport.websocket import create_voice_app

    cancelled = []

    async def slow(payload, grant, emit):
        if payload.get("feature") == "cancel":
            return {
                "type": "plus_result",
                "request_id": payload["request_id"],
                "status": "cancelled",
            }
        await emit("mission.planning", "Planning")
        try:
            await asyncio.sleep(60)
        except asyncio.CancelledError:
            cancelled.append(True)
            raise

    secret = "transport_cancellation_test_secret_at_least_32_chars"
    origin = "https://" + SHOP
    signed = SessionGrant.create_signed(
        grant_id="cancel_grant",
        shop_id=SHOP,
        permitted_origin=origin,
        anonymous_session_id="cancel_session",
        config_revision="cfg1",
        asr_profile_id="elevenlabs-scribe-v2-realtime",
        llm_profile_id="gemini-flash",
        tts_profile_id="elevenlabs-tts-female-stream",
        issued_at_ms=NOW - 100,
        ttl_ms=60000,
        signing_secret=secret,
    )
    app = create_voice_app(
        signing_secret=secret,
        allowed_origins={origin},
        clock_ms=lambda: NOW,
        session_factories={"elevenlabs-scribe-v2-realtime": lambda **kw: None},
        allowed_llm_profiles={"gemini-flash"},
        allowed_tts_profiles={"elevenlabs-tts-female-stream"},
        plus_handler=slow,
    )
    with TestClient(app).websocket_connect("/ws/voice/" + SHOP, headers={"origin": origin}) as ws:
        ws.send_json({"type": "authenticate", "grant": signed.__dict__})
        assert ws.receive_json()["type"] == "authenticated"
        ws.send_json(request("mission", request_revision=1, page_epoch=1))
        assert ws.receive_json()["type"] == "plus_activity"
        ws.send_json(request("cancel", request_id="cancel_now", request_revision=2, page_epoch=1))
        assert ws.receive_json()["status"] == "cancelled"
    assert cancelled == [True]


def test_mission_clarification_retains_prior_constraints():
    class Draft(Model):
        async def generate(self, prompt, schema, image=None):
            if schema is MissionSpec:
                self.calls.append((schema.__name__, prompt, bool(image)))
                return MissionSpec(
                    goal="Office",
                    budget="50",
                    currency="USD",
                    tasks=[{"category": "keyboard", "query": "keyboard"}],
                    open_questions=["What other category should I include?"],
                )
            return await super().generate(prompt, schema, image)

    async def run():
        model = Draft()
        workflow = PlusWorkflow(model, lambda: NOW)
        assert (await workflow.handle(request("mission"), grant(), emit))[
            "status"
        ] == "needs_clarification"
        await workflow.handle(request("refine", text="Include a mouse"), grant(), emit)
        assert '"budget": "50"' in model.calls[-1][1]
        assert not workflow.locks

    asyncio.run(run())


def test_image_http_400_is_actionable_and_does_not_expose_provider_body(monkeypatch):
    import urllib.error

    from ishop.plus import GemmaClient

    calls = []

    def fail(request, **kwargs):
        calls.append(request)
        raise urllib.error.HTTPError(
            request.full_url,
            400,
            "Bad Request",
            {},
            io.BytesIO(b'{"error":{"message":"private provider details"}}'),
        )

    monkeypatch.setattr("ishop.plus.urllib.request.urlopen", fail)
    client = GemmaClient(api_key="offline-test-key")
    with pytest.raises(PlusError, match="describe the product in text") as error:
        asyncio.run(client.generate("Photo", VisionSpec, validate_image(image_payload())))
    assert len(calls) == 1
    assert "private provider details" not in str(error.value)
    assert calls[0].get_header("X-goog-api-key") == "offline-test-key"


def test_vision_searches_secondary_queries_without_inventing_candidates():
    class MultiQuery(Model):
        async def generate(self, prompt, schema, image=None):
            result = await super().generate(prompt, schema, image)
            if schema is VisionSpec:
                result.search_terms = ["black shirt", "shirt", "black shirt"]
            return result

    async def run():
        workflow = PlusWorkflow(MultiQuery(), lambda: NOW)
        response = await workflow.handle(request("vision", image=image_payload()), grant(), emit)
        assert [q["query"] for q in response["queries"]] == ["shirt", "black shirt"]
        result = await workflow.handle(
            {
                "type": "plus_catalog_result",
                "request_id": "r1",
                "shop_id": SHOP,
                "observed_at_ms": NOW,
                "results": [
                    {"agent_id": "vision", "products": []},
                    {"agent_id": "vision_2", "products": [product()]},
                ],
            },
            grant(),
            emit,
        )
        assert [p["product_id"] for p in result["products"]] == ["p1"]
        assert "authorized_command" not in result

    asyncio.run(run())
