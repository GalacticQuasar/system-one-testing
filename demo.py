#!/usr/bin/env python3
"""Tiny System One demo: triage support tickets with Ollama's /v1/systemone endpoint.

Requires Ollama >= 0.35 running locally and a System One model, e.g.:
    ollama pull tev1:0.8b

Usage:
    python3 demo.py                      # run the built-in sample tickets
    python3 demo.py "my ticket text..."  # triage your own text
    MODEL=nimble python3 demo.py         # pick a different model
"""
import json
import os
import sys
import urllib.error
import urllib.request

HOST = os.environ.get("OLLAMA_HOST", "http://localhost:11434").rstrip("/")
if not HOST.startswith("http"):
    HOST = "http://" + HOST
MODEL = os.environ.get("MODEL", "tev1:0.8b")

SAMPLES = [
    "Refund for order 8841 was never posted to my card. It's been three weeks.",
    "Our checkout has returned 500 errors since 9am and we're losing sales.",
    "I can't log in after resetting my password, the link says it expired.",
    "Love the new dark mode! Any plans for a compact layout?",
]

# One request asks all three question types at once.
QUESTIONS = {
    "category": {
        "type": "choice",
        "instructions": "Which category best fits this support ticket?",
        "criteria": {
            "billing": "Payments, charges and refunds",
            "bug": "Software errors or outages",
            "account": "Login and account access",
            "feedback": "Feature requests and general feedback",
        },
    },
    "angry": {
        "type": "noul",
        "instructions": "Is the customer frustrated or upset?",
    },
    "urgency": {
        "type": "score",
        "instructions": "How quickly does this ticket need a response?",
        "criteria": ["Routine", "Soon", "Immediate"],
    },
}


def ask(state: str) -> dict:
    body = json.dumps({"model": MODEL, "state": state, "questions": QUESTIONS}).encode()
    req = urllib.request.Request(
        f"{HOST}/v1/systemone", data=body, headers={"Content-Type": "application/json"}
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            return json.load(resp)
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors="replace")
        if e.code == 404 and "model" in detail.lower():
            sys.exit(f"Model not found. Run: ollama pull {MODEL}\n{detail}")
        if e.code == 404:
            sys.exit("Endpoint /v1/systemone not found -- upgrade Ollama to 0.35 or later.")
        sys.exit(f"HTTP {e.code}: {detail}")
    except urllib.error.URLError as e:
        sys.exit(f"Can't reach Ollama at {HOST}: {e.reason}")


def bar(p: float, width: int = 20) -> str:
    filled = round(p * width)
    return "█" * filled + "░" * (width - filled)


def show(state: str, result: dict) -> None:
    a = result["answers"]
    cat, angry, urg = a["category"], a["angry"], a["urgency"]
    levels = QUESTIONS["urgency"]["criteria"]

    print(f"\n📨 {state}")
    print(f"   category → {cat['choice']}  (confidence {cat['confidence']:.2f})")
    for opt, p in sorted(cat["probabilities"].items(), key=lambda kv: -kv[1]):
        print(f"      {opt:<9} {bar(p)} {p:.1%}")
    print(f"   angry?   → {bar(angry['noul'])} {angry['noul']:.1%}")
    nearest = levels[round(urg["score"])]
    print(f"   urgency  → {urg['score']:.2f} / {len(levels) - 1}  (≈ {nearest})")
    u = result.get("usage", {})
    print(f"   tokens   → in {u.get('input_tokens')}, out {u.get('output_tokens')}")


def main() -> None:
    tickets = sys.argv[1:] or SAMPLES
    print(f"System One demo · model={MODEL} · host={HOST}")
    for t in tickets:
        show(t, ask(t))


if __name__ == "__main__":
    main()
