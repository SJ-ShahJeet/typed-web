"""Offline: url templating (D17), the JSON leaf matcher (incl. minor units, D18), the rendered diff."""

from __future__ import annotations

import json
import unittest
from decimal import Decimal

from typed_web_compiler import detect
from typed_web_compiler.emit import TYPES, money_amounts

from .support import ROOT

PRODUCT = TYPES["Product"]


class TemplateTests(unittest.TestCase):
    def test_page_id_is_the_last_meaningful_segment(self) -> None:
        self.assertEqual(detect.templatize_page("http://127.0.0.1:8787/ssr/1.html"), ("http://127.0.0.1:8787/ssr/{id}.html", "1"))
        self.assertEqual(
            detect.templatize_page("https://books.toscrape.com/catalogue/a-light-in-the-attic_1000/index.html"),
            ("https://books.toscrape.com/catalogue/{id}/index.html", "a-light-in-the-attic_1000"),
        )

    def test_endpoint_templating_needs_the_id_in_the_url(self) -> None:
        self.assertEqual(detect.templatize("http://h/api/product/1", "1"), "http://h/api/product/{id}")
        self.assertEqual(detect.templatize("http://h/api?pid=1&x=2", "1"), "http://h/api?pid={id}&x=2")
        self.assertIsNone(detect.templatize("http://h/api/product/42", "1"))

    def test_non_numeric_id_needs_samples(self) -> None:
        with self.assertRaises(detect.CompileError):
            detect.neighbour_ids("a-light-in-the-attic_1000", "https://x/{id}/")


class MatchTests(unittest.TestCase):
    def test_hidden_endpoint_matches_fields_and_detects_minor_units(self) -> None:
        body = json.loads((ROOT / "fixtures" / "api" / "product" / "1.json").read_text())
        matches, currency = detect.match_fields(body, PRODUCT, [Decimal("129.00")], "Trail Runner 3 £129.00")
        self.assertEqual(currency, "GBP")
        self.assertEqual(matches["title"].path, "product.name")
        self.assertEqual((matches["price"].path, matches["price"].coerce), ("product.offers.price", "minorUnits"))
        self.assertEqual(matches["inStock"].path, "product.offers.availability")

    def test_price_not_on_the_page_is_rejected(self) -> None:
        body = {"product": {"name": "X", "costHint": 6450, "offers": {"price": 12900}}}
        matches, _ = detect.match_fields(body, PRODUCT, [Decimal("129.00")])
        self.assertEqual(matches["price"].path, "product.offers.price")
        matches, _ = detect.match_fields({"product": {"costHint": 6450}}, PRODUCT, [Decimal("129.00")])
        self.assertNotIn("price", matches)

    def test_jsonld_product_matches_major_units(self) -> None:
        html = (ROOT / "fixtures" / "pages" / "jsonld" / "1.html").read_text()
        [node] = [n for n in detect.jsonld_nodes(html) if detect.has_type(n, "Product")]
        matches, currency = detect.match_fields(node, PRODUCT, money_amounts(detect.body_text(html)))
        self.assertEqual({f: m.path for f, m in matches.items()}, {"title": "name", "price": "offers.price", "inStock": "offers.availability"})
        self.assertIsNone(matches["price"].coerce)
        self.assertEqual(currency, "GBP")

    def test_rendered_diff_ignores_layout_noise(self) -> None:
        html = (ROOT / "fixtures" / "pages" / "ssr" / "1.html").read_text()
        rendered = "Home · About · Cart\nTrail Runner 3\n\nPrice: £129.00\nSKU\tTR3-BLK-42\n© Fixture Store · all prices in GBP"
        self.assertEqual(detect.js_only_values(html, rendered), [])
        self.assertEqual(detect.js_only_values(html, rendered + "\nOnly after JS"), ["Only after JS"])


if __name__ == "__main__":
    unittest.main()
