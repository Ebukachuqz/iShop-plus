"""Real selected-provider Vision/refinement probe; synthetic catalogue, no cart writes."""

import argparse
import asyncio
import base64
import json
import time
import urllib.request
from copy import deepcopy
from pathlib import Path
from types import SimpleNamespace

from ishop.config import load_local_environment
from ishop.plus import PlusWorkflow

load_local_environment(Path(".env"))


async def main(pause_seconds=0):
    raw = urllib.request.urlopen(
        "https://storage.googleapis.com/generativeai-downloads/images/croissant.jpg", timeout=20
    ).read()
    reports = []
    for iteration in range(2):
        if iteration and pause_seconds:
            print(json.dumps({"cooldown_seconds": pause_seconds}), flush=True)
            await asyncio.sleep(pause_seconds)
        w = PlusWorkflow()
        g = SimpleNamespace(
            shop_id="fixture.myshopify.com",
            anonymous_session_id="poll_flow_" + str(iteration),
            is_valid_at=lambda t: True,
        )

        async def emit(stage, label):
            print(json.dumps({"run": iteration + 1, "stage": stage}), flush=True)

        p = {
            "product_id": "croissant",
            "title": "Plain Croissant",
            "handle": "croissant",
            "variants": [
                {
                    "variant_id": "v1",
                    "product_id": "croissant",
                    "variant_title": "Standard",
                    "selected_options": {},
                    "price": {"amount": "2.50", "currency": "USD"},
                    "available_for_sale": True,
                    "quantity_available": 10,
                }
            ],
        }
        second = deepcopy(p)
        second.update(product_id="croissant2", title="Butter Croissant", handle="croissant2")
        second["variants"][0].update(variant_id="v2", product_id="croissant2")
        report = {
            "run": iteration + 1,
            "scope": f"real {w.model.provider} + synthetic catalogue; no cart writes",
        }
        start = time.monotonic()
        try:
            e = await w.handle(
                {
                    "type": "plus_request",
                    "feature": "vision",
                    "request_id": "image",
                    "currency": "USD",
                    "text": "Find similar items under 10 USD.",
                    "image": {"mime_type": "image/jpeg", "data": base64.b64encode(raw).decode()},
                },
                g,
                emit,
            )

            async def catalogue(e):
                return await w.handle(
                    {
                        "type": "plus_catalog_result",
                        "request_id": e["request_id"],
                        "shop_id": g.shop_id,
                        "observed_at_ms": int(time.time() * 1000),
                        "results": [
                            {"agent_id": q["agent_id"], "products": [p, second]}
                            for q in e["queries"]
                        ],
                    },
                    g,
                    emit,
                )

            r = await catalogue(e)
            ids = {x["product_id"] for x in r.get("products", [])}
            assert ids and ids <= {"croissant", "croissant2"}
            assert "authorized_command" not in r
            e = await w.handle(
                {
                    "type": "plus_request",
                    "feature": "refine",
                    "request_id": "refine",
                    "currency": "USD",
                    "text": "Only items under 0.50 USD now.",
                },
                g,
                emit,
            )
            r = await catalogue(e)
            assert not r.get("products")
            assert "authorized_command" not in r
            report["passed"] = True
        except Exception as exc:
            report.update(passed=False, error_type=type(exc).__name__, error=str(exc)[:160])
        report["seconds"] = round(time.monotonic() - start, 1)
        reports.append(report)
        print(json.dumps(report), flush=True)
        output = Path(f"artifacts/runs/{w.model.provider}-full-vision-flow.json")
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(reports, indent=2))
        if not report["passed"]:
            break
    return 0 if len(reports) == 2 and all(r.get("passed") for r in reports) else 1


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--pause-seconds", type=float, default=0)
    args = parser.parse_args()
    if not 0 <= args.pause_seconds <= 120:
        parser.error("pause must be between 0 and 120 seconds")
    raise SystemExit(asyncio.run(main(args.pause_seconds)))
