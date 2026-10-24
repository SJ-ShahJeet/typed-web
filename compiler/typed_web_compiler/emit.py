"""The Spec model (mirror of spec/spec.schema.json) and the writer for the registry files.

Keep this in lockstep with spec/spec.schema.json and runtime/src/spec.ts; the test suite
checks that the shared example validates on both sides.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Annotated, Literal, Union

from pydantic import BaseModel, ConfigDict, Field, model_validator

DURATION = re.compile(r"^\d+(s|m|h|d)$")


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class JsonSource(_Strict):
    kind: Literal["json"]
    path: str = Field(min_length=1)


class JsonLdSource(_Strict):
    kind: Literal["jsonld"]
    type: str
    path: str = Field(min_length=1)


class StateSource(_Strict):
    kind: Literal["state"]
    global_: str = Field(alias="global")
    path: str = Field(min_length=1)


class CssSource(_Strict):
    kind: Literal["css"]
    selector: str = Field(min_length=1)
    attr: str | None = None
    all: bool = False


class XPathSource(_Strict):
    kind: Literal["xpath"]
    expr: str = Field(min_length=1)


Source = Annotated[
    Union[JsonSource, JsonLdSource, StateSource, CssSource, XPathSource],
    Field(discriminator="kind"),
]


class Range(_Strict):
    min: float | None = None
    max: float | None = None


class FieldSpec(_Strict):
    type: Literal["string", "number", "money", "date", "enum", "boolean", "url"]
    required: bool = True
    sources: list[Source] = Field(min_length=1)
    coerce: str | None = None
    range: Range | None = None
    values: list[str] | None = Field(default=None, min_length=1)

    @model_validator(mode="after")
    def _enum_needs_values(self) -> FieldSpec:
        if self.type == "enum" and not self.values:
            raise ValueError("type 'enum' requires 'values'")
        return self


class Locale(_Strict):
    lang: str | None = None
    currency: str | None = Field(default=None, pattern=r"^[A-Z]{3}$")
    dateOrder: Literal["DMY", "MDY", "YMD"] | None = None


class Fetch(_Strict):
    url: str = Field(pattern=r"^https?://.*\{id\}.*$")
    method: Literal["GET", "POST"] = "GET"
    headers: dict[str, str] = Field(default_factory=dict)
    auth: Literal["none", "static", "session", "computed"] = "none"
    fetcher: Literal["http", "browser"] = "http"


class Freshness(_Strict):
    defaultMaxAge: str | None = Field(default=None, pattern=DURATION.pattern)


class Verify(_Strict):
    samplePaths: list[str] = Field(min_length=2)


class Spec(_Strict):
    site: str = Field(pattern=r"^[a-z0-9]+(-[a-z0-9]+)*$")
    version: int = Field(ge=1)
    type: str = Field(pattern=r"^[A-Z][A-Za-z0-9]*$")
    access: Literal["open", "rate-limited", "challenged"] = "open"
    locale: Locale | None = None
    fetch: Fetch
    fields: dict[str, FieldSpec] = Field(min_length=1)
    freshness: Freshness | None = None
    verify: Verify

    @model_validator(mode="after")
    def _field_names(self) -> Spec:
        bad = [k for k in self.fields if not re.match(r"^[a-z][A-Za-z0-9]*$", k)]
        if bad:
            raise ValueError(f"field names must be lowerCamel: {bad}")
        return self


def load_spec(path: Path) -> Spec:
    return Spec.model_validate(json.loads(path.read_text(encoding="utf-8")))


def write_registry(out: Path, spec: Spec, snapshot: bytes, expected: dict) -> None:
    """Write spec.json, snapshot.html and expected.json into specs/<site>/."""
    out.mkdir(parents=True, exist_ok=True)
    (out / "spec.json").write_text(
        json.dumps(spec.model_dump(by_alias=True, exclude_none=True), indent=2) + "\n",
        encoding="utf-8",
    )
    (out / "snapshot.html").write_bytes(snapshot)
    (out / "expected.json").write_text(json.dumps(expected, indent=2) + "\n", encoding="utf-8")
