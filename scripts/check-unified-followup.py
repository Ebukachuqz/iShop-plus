"""Opt-in real model Vision -> contextual follow-up probe; synthetic catalogue, no cart writes."""

import argparse
import asyncio
import base64
import json
import time
import urllib.request
from pathlib import Path
from types import SimpleNamespace

from ishop.config import load_local_environment
from ishop.llm.base import LlmIntentRequest, LlmToolSelectionRequest
from ishop.llm.multimodal import MultimodalLlmProvider
from ishop.plus import PlusWorkflow, create_gemma_client


async def main(pause_before_goal=0):
    load_local_environment(Path(".env"))
    model = create_gemma_client()
    workflow = PlusWorkflow(model)
    adapter = MultimodalLlmProvider(
        model,
        "same-selected-model-probe",
        context_provider=lambda: workflow.sessions.get((grant.shop_id, grant.anonymous_session_id)),
    )
    grant = SimpleNamespace(
        shop_id="fixture.myshopify.com",
        anonymous_session_id="unified_probe",
        is_valid_at=lambda t: True,
    )
    report = {
        "scope": "real selected model + synthetic catalogue; no live Shopify/cart writes",
        "provider": model.provider,
        "model": model.model,
    }

    async def emit(stage, label):
        print(json.dumps({"stage": stage}), flush=True)

    started = time.monotonic()
    try:
        with urllib.request.urlopen(
            "https://storage.googleapis.com/generativeai-downloads/images/croissant.jpg", timeout=20
        ) as response:
            image = base64.b64encode(response.read()).decode()
        search = await workflow.handle(
            {
                "type": "plus_request",
                "feature": "route",
                "request_id": "image",
                "text": "Find similar available products under 10 USD",
                "currency": "USD",
                "image": {"mime_type": "image/jpeg", "data": image},
            },
            grant,
            emit,
        )
        report["vision_requirements"] = search.get("constraints")
        query = search["constraints"]["query"].lower()
        assert any(
            word in query
            for word in ("croissant", "pastry", "pastries", "crescent", "bread", "roll")
        ), "Wrong image category"
        assert not any(
            word in query for word in ("earphone", "earbud", "gadget", "headphone", "tech")
        ), "Invented image category"
        p = {
            "product_id": "croissant",
            "title": "Plain Croissant",
            "handle": "plain-croissant",
            "variants": [
                {
                    "variant_id": "plain",
                    "product_id": "croissant",
                    "variant_title": "Plain",
                    "selected_options": {"Flavor": "Plain"},
                    "price": {"amount": "2.50", "currency": "USD"},
                    "available_for_sale": True,
                    "quantity_available": 10,
                }
            ],
        }
        result = await workflow.handle(
            {
                "type": "plus_catalog_result",
                "request_id": "image",
                "shop_id": grant.shop_id,
                "observed_at_ms": int(time.time() * 1000),
                "results": [
                    {"agent_id": q["agent_id"], "products": [p]} for q in search["queries"]
                ],
            },
            grant,
            emit,
        )
        assert result.get("products"), "No synthetic catalogue match for the extracted requirements"
        assert result["products"][0]["product_id"] == "croissant"
        report["vision_passed"] = True
        route = await workflow.handle(
            {
                "type": "plus_request",
                "feature": "route",
                "request_id": "followup",
                "text": "Open the page of the Plain Croissant",
                "currency": "USD",
                "conversation_context": [
                    {"role": "assistant", "text": "Found the Plain Croissant."}
                ],
            },
            grant,
            emit,
        )
        assert route["type"] == "plus_route" and route["route"] == "shopping"
        report["followup_route_passed"] = True
        decision = await adapter.interpret_intent(
            LlmIntentRequest(
                transcript="Open the page of the Plain Croissant",
                budget_currency="USD",
                catalog_context=(
                    "Observed product: Plain Croissant, ID croissant, handle plain-croissant, "
                    "price 2.50 USD, variant Plain.",
                ),
                conversation_history=(
                    {"role": "assistant", "content": "I found the Plain Croissant."},
                ),
            )
        )
        assert decision.intent and decision.intent.operation.value == "navigate"
        selection = await adapter.select_tool(
            LlmToolSelectionRequest(
                intent=decision.intent,
                qualified_tools=(
                    {
                        "name": "get_product",
                        "description": "Retrieve the verified product by its observed reference",
                        "parameters": {"product_reference": "string"},
                    },
                ),
                resolved_context={"observed_product": p},
            )
        )
        assert selection.tool_name == "get_product"
        report["navigation_and_tool_passed"] = True
        reviewed = await workflow.handle(
            {
                "type": "plus_request",
                "feature": "select_product",
                "request_id": "review",
                "product_id": "croissant",
                "variant_id": "plain",
                "quantity": 2,
                "products": [p],
                "shop_id": grant.shop_id,
                "currency": "USD",
                "observed_at_ms": int(time.time() * 1000),
            },
            grant,
            emit,
        )
        assert (
            reviewed["proposal"]["items"][0]["quantity"] == 2
            and "authorized_command" not in reviewed
        )
        report["variant_review_passed"] = True
        if pause_before_goal:
            print(json.dumps({"cooldown_seconds": pause_before_goal}), flush=True)
            await asyncio.sleep(pause_before_goal)
        mission = await workflow.handle(
            {
                "type": "plus_request",
                "feature": "route",
                "request_id": "goal",
                "text": "Find one keyboard and one mouse with a total budget of 50 USD. "
                "Wait for approval.",
                "currency": "USD",
            },
            grant,
            emit,
        )
        assert mission["type"] == "plus_catalog_request" and mission["feature"] == "mission"
        assert len(mission["queries"]) == 2
        report.update(
            passed=True,
            vision_product="croissant",
            followup_operation="navigate",
            tool=selection.tool_name,
            review_quantity=2,
            automatic_goal_tasks=2,
        )
    except Exception as exc:
        report.update(passed=False, error_type=type(exc).__name__, error=str(exc)[:200])
    report["seconds"] = round(time.monotonic() - started, 1)
    output = Path("artifacts/runs/unified-model-followup.json")
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2))
    print(json.dumps(report), flush=True)
    return 0 if report.get("passed") else 1


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--pause-before-goal", type=float, default=0)
    args = parser.parse_args()
    if not 0 <= args.pause_before_goal <= 120:
        parser.error("pause must be between 0 and 120 seconds")
    raise SystemExit(asyncio.run(main(args.pause_before_goal)))
