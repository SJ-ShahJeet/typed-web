"""The Pydantic Spec model must accept the shared example and reject the classic mistakes."""

from __future__ import annotations

import json
import unittest
from pathlib import Path

from pydantic import ValidationError

from typed_web_compiler.emit import Spec, load_spec

ROOT = Path(__file__).resolve().parents[2]
EXAMPLE = ROOT / "spec" / "examples" / "books-toscrape.spec.json"


class SpecModelTests(unittest.TestCase):
    def test_example_validates(self) -> None:
        spec = load_spec(EXAMPLE)
        self.assertEqual(spec.site, "books-toscrape")
        self.assertEqual(spec.fields["price"].type, "money")
        self.assertFalse(spec.fields["upc"].required)
        self.assertEqual(spec.fields["price"].sources[1].kind, "css")

    def test_round_trip_keeps_every_key(self) -> None:
        raw = json.loads(EXAMPLE.read_text())
        dumped = Spec.model_validate(raw).model_dump(by_alias=True, exclude_none=True)
        # defaults are added, nothing present is lost
        for key in raw:
            self.assertIn(key, dumped)
        self.assertEqual(dumped["fields"]["title"]["required"], True)

    def test_rejects_url_without_id_placeholder(self) -> None:
        raw = json.loads(EXAMPLE.read_text())
        raw["fetch"]["url"] = "https://books.toscrape.com/catalogue/index.html"
        with self.assertRaises(ValidationError):
            Spec.model_validate(raw)

    def test_rejects_enum_without_values(self) -> None:
        raw = json.loads(EXAMPLE.read_text())
        del raw["fields"]["inStock"]["values"]
        with self.assertRaises(ValidationError):
            Spec.model_validate(raw)

    def test_rejects_single_sample_path(self) -> None:
        raw = json.loads(EXAMPLE.read_text())
        raw["verify"]["samplePaths"] = ["only-one"]
        with self.assertRaises(ValidationError):
            Spec.model_validate(raw)

    def test_rejects_unknown_source_kind(self) -> None:
        raw = json.loads(EXAMPLE.read_text())
        raw["fields"]["title"]["sources"] = [{"kind": "regex", "pattern": ".*"}]
        with self.assertRaises(ValidationError):
            Spec.model_validate(raw)


if __name__ == "__main__":
    unittest.main()
