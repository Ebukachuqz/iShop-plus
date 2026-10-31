"""Opt-in real Gemma image diagnostic; no cart access or provider substitution.

Run from repository root with the selected provider credential, or local .env.
Uses Google's public image fixture. Saves only status metadata, never image/key data.
"""

import asyncio
import base64
import json
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from ishop.config import load_local_environment
from ishop.plus import PlusError, VisionSpec, create_gemma_client, validate_image


async def main():
    load_local_environment(Path.cwd() / ".env")
    url = "https://storage.googleapis.com/generativeai-downloads/images/croissant.jpg"
    with urllib.request.urlopen(url, timeout=20) as response:
        raw = response.read(4 * 1024 * 1024 + 1)
    image = validate_image({"mime_type": "image/jpeg", "data": base64.b64encode(raw).decode()})
    report = {
        "observed_at": datetime.now(timezone.utc).isoformat(),
        "scope": "real Gemma image API only; no store/cart verification",
        "results": [],
    }
    for client in [create_gemma_client()]:
        model = client.model
        try:
            result = await client.generate(
                "Identify the visible product for catalogue search. Currency USD. "
                "Do not invent its brand, material or identity.",
                VisionSpec,
                image,
            )
            report["results"].append(
                {
                    "provider": client.provider,
                    "model": model,
                    "status": "passed",
                    "query": result.query,
                    "currency": result.currency,
                }
            )
        except PlusError as exc:
            report["results"].append(
                {
                    "provider": client.provider,
                    "model": model,
                    "status": "failed",
                    "message": str(exc),
                }
            )
    target = Path("artifacts/runs/gemma-vision-diagnostic.json")
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))
    return 0 if all(row["status"] == "passed" for row in report["results"]) else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
