#!/usr/bin/env python3
"""Serve the offline fixture pages on http://127.0.0.1:8787.

Routes:
  /shell/<id>.html, /jsonld/<id>.html, /ssr/<id>.html,
  /table/<id>.html                                     -> fixtures/pages/<kind>/<id>.html
  /api/product/<id>                                    -> fixtures/api/product/<id>.json (application/json)

Stdlib only; nothing to install. Used by both test suites and by `uv run compile`.
`--root <dir> --port <n>` serves a copy of this folder elsewhere (the repair test mutates one).
"""

from __future__ import annotations

import argparse
import json
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PAGES = ROOT / "pages"
API = ROOT / "api"
PORT = 8787


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(PAGES), **kwargs)

    def do_GET(self) -> None:  # noqa: N802 (http.server naming)
        if self.path.startswith("/api/product/"):
            return self._serve_json(API / "product" / f"{self.path.rsplit('/', 1)[1]}.json")
        return super().do_GET()

    def _serve_json(self, file: Path) -> None:
        if not file.is_file():
            self.send_error(404, "no such product")
            return
        body = file.read_bytes()
        json.loads(body)  # fail loudly on a broken fixture rather than serving it
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt: str, *args) -> None:
        if "--quiet" not in sys.argv:
            super().log_message(fmt, *args)


def main() -> None:
    global PAGES, API
    p = argparse.ArgumentParser()
    p.add_argument("--quiet", action="store_true")
    p.add_argument("--port", type=int, default=PORT)
    p.add_argument("--root", type=Path, default=ROOT, help="a folder with pages/ and api/ like this one")
    args = p.parse_args()
    PAGES, API = args.root / "pages", args.root / "api"
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print(f"fixtures: http://127.0.0.1:{args.port}  (ctrl-c to stop)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
