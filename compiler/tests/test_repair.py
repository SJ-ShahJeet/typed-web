"""The repair half of the loop, offline: a mutated copy of the fixtures on another port, a copy of the
compiled fixture-ssr registry folder pointed at it, `repair` emits version 2 with the new class.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

import httpx

from typed_web_compiler.cli import repair_site

from .support import ROOT, TRUTH, ensure_fixtures

PORT = 8788


def setUpModule() -> None:
    ensure_fixtures()


class RepairTests(unittest.TestCase):
    def setUp(self) -> None:
        tmp = Path(tempfile.mkdtemp(prefix="typed-web-repair-"))
        self.fixtures = tmp / "fixtures"
        shutil.copytree(ROOT / "fixtures", self.fixtures)
        for page in (self.fixtures / "pages" / "ssr").glob("*.html"):
            page.write_text(page.read_text().replace('class="price"', 'class="cost"'))
        self.site = tmp / "fixture-ssr"
        shutil.copytree(ROOT / "specs" / "fixture-ssr", self.site)
        for name in ("spec.json", "expected.json"):
            f = self.site / name
            f.write_text(f.read_text().replace(":8787/", f":{PORT}/"))
        self.server = subprocess.Popen(
            [sys.executable, str(self.fixtures / "serve.py"), "--quiet", "--port", str(PORT), "--root", str(self.fixtures)],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        for _ in range(50):
            try:
                if httpx.get(f"http://127.0.0.1:{PORT}/ssr/1.html", timeout=1).status_code == 200:
                    break
            except httpx.HTTPError:
                time.sleep(0.1)
        self.addCleanup(lambda: (self.server.kill(), self.server.wait()))

    def test_repair_bumps_the_version_and_finds_the_renamed_class(self) -> None:
        new = repair_site(self.site)
        self.assertEqual(new.version, 2)
        self.assertEqual(new.fields["price"].sources[0].selector, "main.product span.cost")
        self.assertEqual(new.fields["title"].sources[0].selector, "main.product h1.title")
        status = json.loads((self.site / "status.json").read_text())
        self.assertEqual((status["state"], status["specVersion"], status["detail"]), ("ok", 2, {"repairedFrom": 1}))
        expected = json.loads((self.site / "expected.json").read_text())
        self.assertEqual(expected["specVersion"], 2)
        self.assertEqual({r["id"]: r["data"] for r in expected["records"]}, TRUTH)
        self.assertIn('class="cost"', (self.site / "snapshot.html").read_text())


if __name__ == "__main__":
    unittest.main()
