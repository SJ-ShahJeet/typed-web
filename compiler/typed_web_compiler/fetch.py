"""Plain fetch (httpx) and rendered fetch (Playwright) for the compiler (Compiler tab, fetch.py).

`plain()` is what the runtime will do forever; `rendered()` runs once per compile and only when
the plain body does not fill every field.
"""

from __future__ import annotations

import hashlib
import time
from dataclasses import dataclass, field

import httpx

UA = "typed-web-compiler/0.0.1 (+https://github.com/SJ-ShahJeet/typed-web)"
PAGE_HEADERS = {"accept": "text/html"}
JSON_HEADERS = {"accept": "application/json"}

_client = httpx.Client(follow_redirects=True, timeout=20.0, headers={"user-agent": UA})


@dataclass
class Plain:
    requested_url: str
    final_url: str
    status: int
    headers: dict[str, str]
    body: bytes
    sha256: str
    elapsed_ms: float

    @property
    def text(self) -> str:
        return self.body.decode("utf-8", "replace")

    @property
    def content_type(self) -> str:
        return self.headers.get("content-type", "")


def plain(url: str, headers: dict[str, str] | None = None) -> Plain:
    t0 = time.perf_counter()
    r = _client.get(url, headers=headers or {})
    return Plain(
        url,
        str(r.url),
        r.status_code,
        dict(r.headers),
        r.content,
        hashlib.sha256(r.content).hexdigest(),
        round((time.perf_counter() - t0) * 1000, 1),
    )


@dataclass
class Captured:
    """One XHR/fetch response the page's own JavaScript made."""

    url: str
    status: int
    content_type: str
    request_headers: dict[str, str]
    body: str


@dataclass
class Rendered:
    text: str  # innerText of <body> once the network went idle
    html: str  # serialised DOM at that moment
    responses: list[Captured] = field(default_factory=list)


def rendered(url: str, *, timeout_ms: int = 15_000) -> Rendered:
    from playwright.sync_api import sync_playwright

    captured: list[Captured] = []

    def on_response(r) -> None:  # noqa: ANN001 (playwright Response)
        if r.request.resource_type not in ("xhr", "fetch"):
            return
        try:
            body = r.text()
        except Exception:  # binary or already gone
            body = ""
        captured.append(Captured(r.url, r.status, r.headers.get("content-type", ""), dict(r.request.headers), body))

    with sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            page = browser.new_page(user_agent=UA)
            page.on("response", on_response)
            page.goto(url, wait_until="networkidle", timeout=timeout_ms)
            return Rendered(page.inner_text("body"), page.content(), captured)
        finally:
            browser.close()
