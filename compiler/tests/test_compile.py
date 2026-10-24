"""Each fixture compiles to a spec the runtime executes to its expected.json (Testing tab).

Needs the fixtures server (started here if absent), Playwright Chromium, and runtime/node_modules.
"""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from typed_web_compiler.cli import compile_site
from typed_web_compiler.emit import load_spec

from .support import FIXTURES, TRUTH, ensure_fixtures


def setUpModule() -> None:
    ensure_fixtures()


class CompileFixtures(unittest.TestCase):
    def compile(self, kind: str, extra: dict[str, dict] | None = None) -> tuple[dict, dict, Path]:
        out = Path(tempfile.mkdtemp(prefix="typed-web-")) / f"fixture-{kind}"
        compile_site(f"{FIXTURES}/{kind}/1.html", "Product", out)
        spec = json.loads((out / "spec.json").read_text())
        expected = json.loads((out / "expected.json").read_text())
        load_spec(out / "spec.json")  # round-trips through the model
        truth = {i: {**r, **(extra or {}).get(i, {})} for i, r in TRUTH.items()}
        self.assertEqual({r["id"]: r["data"] for r in expected["records"]}, truth)
        self.assertEqual(expected["stats"]["nullRate"], {f: 0.0 for f in truth["1"]})
        self.assertEqual(expected["compile"]["pageUrl"], f"{FIXTURES}/{kind}/{{id}}.html")
        self.assertEqual(spec["verify"]["samplePaths"], ["2", "3"])
        self.assertEqual(spec["locale"], {"lang": "en-GB", "currency": "GBP", "dateOrder": "DMY"})
        self.assertTrue((out / "snapshot.html").read_bytes().startswith(b"<!doctype html>"))
        return spec, expected, out

    def kinds(self, spec: dict) -> dict[str, list[str]]:
        return {f: [s["kind"] for s in v["sources"]] for f, v in spec["fields"].items()}

    def test_shell_compiles_to_the_hidden_endpoint_with_minimal_headers(self) -> None:
        spec, _, _ = self.compile("shell")
        self.assertEqual(spec["fetch"]["url"], f"{FIXTURES}/api/product/{{id}}")
        self.assertEqual(spec["fetch"]["headers"], {"accept": "application/json"})  # header minimisation
        self.assertEqual(self.kinds(spec), {"title": ["json"], "price": ["json"], "inStock": ["json"]})
        self.assertEqual(spec["fields"]["price"]["coerce"], "minorUnits")

    def test_jsonld_compiles_to_jsonld_sources(self) -> None:
        spec, _, _ = self.compile("jsonld")
        self.assertEqual(spec["fetch"]["url"], f"{FIXTURES}/jsonld/{{id}}.html")
        self.assertEqual(self.kinds(spec), {"title": ["jsonld"], "price": ["jsonld"], "inStock": ["jsonld"]})

    def test_ssr_compiles_to_ranked_css(self) -> None:
        spec, _, _ = self.compile("ssr")
        self.assertEqual(self.kinds(spec), {"title": ["css"], "price": ["css"], "inStock": ["css"]})
        self.assertEqual(spec["fields"]["price"]["sources"], [{"kind": "css", "selector": "main.product span.price", "all": False}])
        self.assertEqual(spec["fields"]["title"]["sources"][0]["selector"], "main.product h1.title")

    def test_table_compiles_to_label_keyed_xpath(self) -> None:
        upc = {"1": {"upc": "5012345678900"}, "2": {"upc": "5012345678917"}, "3": {"upc": "5012345678924"}}
        spec, _, _ = self.compile("table", upc)  # page 3 reorders the rows: TRUTH holds only if no position is used
        self.assertEqual(self.kinds(spec), {"title": ["css"], "price": ["xpath"], "inStock": ["css"], "upc": ["xpath"]})
        self.assertEqual(spec["fields"]["upc"]["sources"], [{"kind": "xpath", "expr": "//th[normalize-space()='UPC']/following-sibling::td[1]"}])
        self.assertFalse(spec["fields"]["upc"]["required"])
        self.assertNotIn("nth-child", json.dumps(spec))


if __name__ == "__main__":
    unittest.main()
