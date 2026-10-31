"""Opt-in live, read-only Gemma/catalog/ElevenLabs probe. Never changes a cart.

Run: .venv/Scripts/python.exe scripts/smoke-plus.py --shop your-store.myshopify.com --voice
This is a provider/catalog smoke, not proof of a connected browser/cart demo.
"""

import argparse
import asyncio
import base64
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "services/runtime/src"))
from ishop.config import load_local_environment
from ishop.plus import PlusWorkflow


def fetch(url, binary=False):
    req = urllib.request.Request(url, headers={"User-Agent": "iShop-plus-read-only-smoke/1.0"})
    with urllib.request.urlopen(req, timeout=20) as response:
        body = response.read(4 * 1024 * 1024 + 1)
        return (body, response.headers.get_content_type()) if binary else json.loads(body)


def normalize(raw, currency):
    pid = str(raw["id"])
    options = [o["name"] if isinstance(o, dict) else o for o in raw.get("options", [])]
    return {
        "product_id": pid,
        "title": raw["title"],
        "handle": raw["handle"],
        "image_url": (raw.get("featured_image") or (raw.get("images") or [""])[0]),
        "variants": [
            {
                "variant_id": str(v["id"]),
                "product_id": pid,
                "product_title": raw["title"],
                "variant_title": v["title"],
                "selected_options": dict(zip(options, v.get("options", []))),
                "price": {"amount": str(Decimal(str(v["price"])) / 100), "currency": currency},
                "available_for_sale": v.get("available", False),
                "quantity_available": None,
            }
            for v in raw.get("variants", [])
        ],
    }


async def main(args):
    import os

    load_local_environment(Path.cwd() / ".env")
    summary = {
        "scope": "live model + direct public catalog, no browser/cart execution",
        "shop": args.shop,
        "model": os.getenv("ISHOP_PLUS_GEMMA_MODEL", "gemma-4-26b-a4b-it"),
    }
    if not re.fullmatch(r"[a-z0-9-]+\.myshopify\.com", args.shop):
        raise SystemExit("Use a Shopify myshopify.com domain, without a path.")
    currency = args.currency
    workflow = PlusWorkflow()
    grant = SimpleNamespace(
        shop_id=args.shop, anonymous_session_id="read_only_smoke", is_valid_at=lambda now: True
    )

    async def emit(stage, label):
        print(json.dumps({"stage": stage, "label": label}))

    async def search(query):
        params = urllib.parse.urlencode(
            {"q": query, "resources[type]": "product", "resources[limit]": "8"}
        )
        found = await asyncio.to_thread(fetch, f"https://{args.shop}/search/suggest.json?{params}")
        result = []
        for product in found.get("resources", {}).get("results", {}).get("products", [])[:8]:
            handle = product.get("handle")
            if handle:
                raw = await asyncio.to_thread(
                    fetch, f"https://{args.shop}/products/{urllib.parse.quote(handle)}.js"
                )
                result.append(normalize(raw, currency))
        return result

    async def complete_catalog(event):
        results = [
            {
                "agent_id": task["agent_id"],
                "query": task["query"],
                "products": await search(task["query"]),
            }
            for task in event["queries"]
        ]
        return await workflow.handle(
            {
                "type": "plus_catalog_result",
                "request_id": event["request_id"],
                "shop_id": args.shop,
                "observed_at_ms": int(time.time() * 1000),
                "results": results,
            },
            grant,
            emit,
        )

    try:
        public_products = await search(args.query)
        target = next(p for p in public_products if p.get("image_url"))
        image_url = target["image_url"]
        if image_url.startswith("//"):
            image_url = "https:" + image_url
        if not image_url.startswith("https://"):
            raise ValueError("Public product image unavailable")
        photo, mime = await asyncio.to_thread(fetch, image_url, True)
        initial = await workflow.handle(
            {
                "type": "plus_request",
                "feature": "vision",
                "request_id": "smoke_vision",
                "text": args.vision_constraint,
                "currency": currency,
                "image": {"mime_type": mime, "data": base64.b64encode(photo).decode()},
            },
            grant,
            emit,
        )
        result = await complete_catalog(initial)
        summary["vision"] = {
            "status": result["status"],
            "products": len(result.get("products", [])),
            "titles": [p["title"] for p in result.get("products", [])],
        }
        refinement = await workflow.handle(
            {
                "type": "plus_request",
                "feature": "refine",
                "request_id": "smoke_refine",
                "text": args.refine,
                "currency": currency,
            },
            grant,
            emit,
        )
        result = await complete_catalog(refinement)
        summary["vision_refinement"] = {
            "status": result["status"],
            "products": len(result.get("products", [])),
        }
    except Exception as exc:
        summary["vision"] = {
            "status": "blocked",
            "error_type": type(exc).__name__,
            "message": str(exc)[:180],
        }
    try:
        initial = await workflow.handle(
            {
                "type": "plus_request",
                "feature": "mission",
                "request_id": "smoke_mission",
                "text": args.mission,
                "currency": currency,
            },
            grant,
            emit,
        )
        result = await complete_catalog(initial)
        summary["mission"] = {
            "status": result["status"],
            "agents": result.get("agents", []),
            "proposal": result.get("proposal"),
            "cart_mutations": 0,
        }
    except Exception as exc:
        summary["mission"] = {
            "status": "blocked",
            "error_type": type(exc).__name__,
            "message": str(exc)[:180],
        }
    if args.voice:
        from ishop.speech.elevenlabs_scribe_realtime import ElevenLabsScribeRealtimeSession
        from ishop.tts.elevenlabs import ElevenLabsHttpTtsProvider

        try:
            tts = ElevenLabsHttpTtsProvider(api_key=os.getenv("ELEVENLABS_API_KEY"))
            session = await tts.synthesize(
                "Your shopping list is ready. Please review your basket before approving.",
                generation=1,
            )
            audio = b"".join([chunk.audio async for chunk in session.chunks()])
            summary["elevenlabs_tts"] = {"status": "passed", "pcm_bytes": len(audio)}
            stt = ElevenLabsScribeRealtimeSession(
                api_key=os.getenv("ELEVENLABS_API_KEY", ""),
                revision=1,
                language="en",
                sample_rate=16000,
                channels=1,
            )
            await stt.start()
            try:
                for offset in range(0, len(audio), 4096):
                    await stt.send_audio(audio[offset : offset + 4096])
                    await asyncio.sleep(0.02)
                await stt.commit()
                async with asyncio.timeout(20):
                    async for event in stt.events():
                        kind = str(getattr(event.kind, "value", event.kind))
                        if kind == "final_transcript":
                            summary["elevenlabs_stt"] = {
                                "status": "passed",
                                "transcript": event.text,
                            }
                            break
                summary.setdefault(
                    "elevenlabs_stt",
                    {"status": "blocked", "message": "No final transcript returned"},
                )
            finally:
                await stt.cancel()
        except Exception as exc:
            summary.setdefault(
                "elevenlabs_tts", {"status": "blocked", "error_type": type(exc).__name__}
            )
            summary.setdefault(
                "elevenlabs_stt", {"status": "blocked", "error_type": type(exc).__name__}
            )
    target = Path("artifacts/runs/plus-live-smoke.json")
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--shop", required=True)
    parser.add_argument("--currency", default="USD")
    parser.add_argument("--query", default="snowboard")
    parser.add_argument(
        "--vision-constraint", default="Find available snowboard alternatives under 800 USD."
    )
    parser.add_argument("--refine", default="Keep the budget under 650 USD.")
    parser.add_argument(
        "--mission",
        default="Find one Hydrogen snowboard and one Complete snowboard, "
        "total under 1400 USD. Don't add anything yet.",
    )
    parser.add_argument("--voice", action="store_true")
    asyncio.run(main(parser.parse_args()))
