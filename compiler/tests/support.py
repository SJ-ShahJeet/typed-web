"""Shared test plumbing: the fixtures server on 127.0.0.1:8787, started unless something already listens."""

from __future__ import annotations

import atexit
import subprocess
import sys
import time
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[2]
FIXTURES = "http://127.0.0.1:8787"
TRUTH = {
    "1": {"title": "Trail Runner 3", "price": {"amount": 12900, "currency": "GBP"}, "inStock": "in_stock"},
    "2": {"title": "Summit Jacket", "price": {"amount": 24950, "currency": "GBP"}, "inStock": "in_stock"},
    "3": {"title": "Base Layer Tee", "price": {"amount": 3400, "currency": "GBP"}, "inStock": "out_of_stock"},
}


def _up() -> bool:
    try:
        return httpx.get(f"{FIXTURES}/ssr/1.html", timeout=1).status_code == 200
    except httpx.HTTPError:
        return False


def ensure_fixtures() -> None:
    if _up():
        return
    proc = subprocess.Popen([sys.executable, str(ROOT / "fixtures" / "serve.py"), "--quiet"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    atexit.register(lambda: (proc.kill(), proc.wait()))
    for _ in range(50):
        if _up():
            return
        time.sleep(0.1)
    raise RuntimeError("fixtures server did not start on 127.0.0.1:8787")
