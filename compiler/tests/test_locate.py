"""Offline: selector ranking on the ssr fixture pages, including the repair case (D19)."""

from __future__ import annotations

import unittest

from selectolax.lexbor import LexborHTMLParser as HTMLParser

from typed_web_compiler import locate
from typed_web_compiler.emit import TYPES

from .support import ROOT

PRODUCT = TYPES["Product"]


def pages(mutate=lambda s: s) -> list[HTMLParser]:
    return [HTMLParser(mutate((ROOT / "fixtures" / "pages" / "ssr" / f"{i}.html").read_text())) for i in (1, 2, 3)]


class LocateTests(unittest.TestCase):
    def test_class_anchored_price_beats_the_positional_table_cell(self) -> None:
        cands = locate.candidates("price", PRODUCT["price"], pages())
        self.assertEqual(cands[0].selector, "main.product span.price")
        self.assertEqual([c.text for c in cands], ["£129.00", "£129.00"])
        self.assertTrue(cands[1].positional)
        self.assertFalse(cands[1].anchored)  # D19: never emitted as a fallback

    def test_title_prefers_the_h1_and_skips_containers_and_head(self) -> None:
        cands = locate.candidates("title", PRODUCT["title"], pages())
        self.assertEqual(cands[0].selector, "main.product h1.title")
        leaf_texts = {"Trail Runner 3", "TR3-BLK-42", "Price: £129.00", "£129.00", "In stock (7 available)", "SKU", "Price"}
        self.assertTrue(all(c.text in leaf_texts for c in cands), [c.text for c in cands])  # no containers, no <head>
        self.assertFalse(any(c.anchored and c.score >= 3 for c in cands[1:]))

    def test_availability(self) -> None:
        self.assertEqual(locate.choose(locate.candidates("inStock", PRODUCT["inStock"], pages())).selector, "main.product p.availability")

    def test_repair_finds_the_renamed_class(self) -> None:
        renamed = pages(lambda s: s.replace('class="price"', 'class="cost"'))
        cands = locate.candidates("price", PRODUCT["price"], renamed, exclude=frozenset({"main.product span.price"}))
        self.assertEqual(cands[0].selector, "main.product span.cost")

    def test_generated_classes_are_never_emitted(self) -> None:
        html = '<html><body><main class="css-1x2y3z"><h1 class="css-8ab9cd">A</h1><div class="css-77ff21">£1.00</div></main></body></html>'
        cands = locate.candidates("title", PRODUCT["title"], [HTMLParser(html), HTMLParser(html.replace("A", "B"))])
        self.assertEqual(cands[0].selector, "h1")


if __name__ == "__main__":
    unittest.main()
