"""The Spec model (mirror of spec/spec.schema.json), the type templates the compiler fills,
the value shapes it recognises, verification through the runtime, and the registry writer.

Keep the model in lockstep with spec/spec.schema.json and runtime/src/spec.ts; the test suite
checks that the shared example validates on both sides.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Annotated, Literal, Union

from pydantic import BaseModel, ConfigDict, Field, model_validator

DURATION = re.compile(r"^\d+(s|m|h|d)$")
ROOT = Path(__file__).resolve().parents[2]
RUNTIME = Path(os.environ.get("TYPED_WEB_RUNTIME", ROOT / "runtime"))


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class JsonSource(_Strict):
    kind: Literal["json"] = "json"
    path: str = Field(min_length=1)


class JsonLdSource(_Strict):
    kind: Literal["jsonld"] = "jsonld"
    type: str
    path: str = Field(min_length=1)


class StateSource(_Strict):
    kind: Literal["state"] = "state"
    global_: str = Field(alias="global")
    path: str = Field(min_length=1)


class CssSource(_Strict):
    kind: Literal["css"] = "css"
    selector: str = Field(min_length=1)
    attr: str | None = None
    all: bool = False


class XPathSource(_Strict):
    kind: Literal["xpath"] = "xpath"
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


def spec_json(spec: Spec) -> str:
    return json.dumps(spec.model_dump(by_alias=True, exclude_none=True), indent=2) + "\n"


# --- what the compiler compiles to ------------------------------------------------------


@dataclass(frozen=True)
class FieldTemplate:
    """One output field of a schema.org type: its spec type and the signals that locate it."""

    type: str
    aliases: tuple[str, ...]  # words found in JSON keys and DOM attributes, most specific first
    tags: tuple[str, ...] = ()  # DOM tag hint
    path_hint: str | None = None  # JSON path word that favours one leaf over another
    coerce: str | None = None
    values: tuple[str, ...] | None = None
    required: bool = True


# ponytail: one type; JobPosting and NewsArticle are rows here when a fixture needs them (D5).
TYPES: dict[str, dict[str, FieldTemplate]] = {
    "Product": {
        "title": FieldTemplate("string", ("title", "name", "productname"), tags=("h1",)),
        "price": FieldTemplate("money", ("price", "amount", "cost", "lowprice"), path_hint="offer"),
        "inStock": FieldTemplate(
            "enum",
            ("availability", "instock", "stock", "available"),
            coerce="availability",
            values=("in_stock", "out_of_stock", "unknown"),
        ),
    },
}

SYMBOLS = {"£": "GBP", "€": "EUR", "₹": "INR", "¥": "JPY", "$": "USD"}
ZERO_MINOR = {"JPY", "KRW", "VND", "CLP", "ISK"}
MONEY = re.compile(
    r"(?:(?P<sym>[£€₹¥$])\s?(?P<a>\d[\d,.]*)|(?P<b>\d[\d,.]*)\s?(?P<code>[A-Z]{3}|[£€₹¥$]))"
)


def minor_units(currency: str) -> int:
    return 0 if currency in ZERO_MINOR else 2


def decimal_of(text: str) -> Decimal | None:
    """'1,234.50' / '1.234,50' / '129' → Decimal; None when it is not a number."""
    t = re.sub(r"[^\d.,-]", "", text)
    dot, comma = t.rfind("."), t.rfind(",")
    dec = "." if dot > comma else "," if comma >= 0 else "."
    t = t.replace("," if dec == "." else ".", "").replace(dec, ".")
    try:
        return Decimal(t) if re.fullmatch(r"-?\d+(\.\d+)?", t) else None
    except InvalidOperation:
        return None


def money_amounts(text: str) -> list[Decimal]:
    """Every price-shaped value in a text, as major-unit decimals."""
    out: list[Decimal] = []
    for m in MONEY.finditer(text):
        d = decimal_of(m.group("a") or m.group("b"))
        if d is not None:
            out.append(d)
    return out


def currency_of(text: str) -> str | None:
    m = MONEY.search(text)
    if not m:
        return None
    sym = m.group("sym") or m.group("code")
    return SYMBOLS.get(sym, sym if sym and len(sym) == 3 else None)


def availability(text: str) -> str:
    """Mirror of the runtime's named coercer; keep the two in step."""
    t = text.lower()
    if re.search(r"out ?of ?stock|sold out|unavailable|discontinued|backorder", t):
        return "out_of_stock"
    if re.search(r"in ?stock|available|only \d+ left|\d+ available|limited ?availability|pre-?order", t):
        return "in_stock"
    return "unknown"


def shape(tpl: FieldTemplate, text: str) -> int:
    """0 = not this type's shape, 1 = contains it, 2 = is exactly it."""
    t = text.strip()
    if not t:
        return 0
    if tpl.type == "money":
        m = MONEY.search(t)
        return 0 if not m else 2 if m.group(0) == t else 1
    if tpl.type == "enum" and tpl.coerce == "availability":
        return 2 if availability(t) != "unknown" else 0
    if tpl.type == "number":
        return 2 if decimal_of(t) is not None and re.fullmatch(r"[\d.,\s-]+", t) else 0
    if tpl.type == "date":
        return 2 if re.fullmatch(r"\d{4}-\d{2}-\d{2}.*|\d{1,2}[./-]\d{1,2}[./-]\d{2,4}", t) else 0
    if tpl.type == "url":
        return 2 if re.fullmatch(r"https?://\S+|/\S*", t) else 0
    if tpl.type == "string":
        return 2 if len(t) <= 300 else 0
    return 0


# --- verify and write --------------------------------------------------------------------


class VerifyError(RuntimeError):
    pass


def verify(spec: Spec, ids: list[str]) -> tuple[dict[str, dict], dict[str, str]]:
    """Run the draft spec through the runtime CLI on every id (Compiler tab, step 6).

    Returns ({id: data}, {id: failure message}). The spec is written to a temp dir so the
    runtime's status.json lands there, not in the registry; the index is in memory.
    """
    tsx = RUNTIME / "node_modules" / ".bin" / "tsx"
    if not tsx.exists():
        raise VerifyError(f"runtime not installed: run `npm install` in {RUNTIME}")
    if not shutil.which("node"):
        raise VerifyError("node not on PATH: `source ~/.nvm/nvm.sh && nvm use 26` first")
    records: dict[str, dict] = {}
    failures: dict[str, str] = {}
    with tempfile.TemporaryDirectory(prefix="typed-web-verify-") as tmp:
        spec_path = Path(tmp) / "spec.json"
        spec_path.write_text(spec_json(spec), encoding="utf-8")
        for id_ in ids:
            r = subprocess.run(
                [str(tsx), "src/cli.ts", "run", str(spec_path), "--id", id_, "--index", ":memory:"],
                cwd=RUNTIME,
                capture_output=True,
                text=True,
                timeout=120,
            )
            if r.returncode == 0:
                records[id_] = json.loads(r.stdout)["data"]
            else:
                failures[id_] = r.stderr.strip().splitlines()[-1] if r.stderr.strip() else f"exit {r.returncode}"
    return records, failures


def failing_fields(message: str) -> set[str]:
    """`schema_failure: site v1 id=2: price: not a number; inStock: ...` → {'price', 'inStock'}."""
    _, _, issues = message.partition(": id=") if ": id=" in message else ("", "", message)
    issues = issues.split(": ", 1)[1] if ": " in issues else issues
    return {m.group(1) for m in re.finditer(r"(?:^|; )([a-z][A-Za-z0-9]*): ", issues)}


def expected_json(spec: Spec, records: dict[str, dict], page_url: str) -> dict:
    """`{ specVersion, records, stats, compile }`; `compile.pageUrl` lets repair re-run the ladder."""
    rate = {
        f: round(sum(1 for r in records.values() if r.get(f) is None) / max(len(records), 1), 3)
        for f in spec.fields
    }
    return {
        "specVersion": spec.version,
        "records": [{"id": id_, "data": data} for id_, data in records.items()],
        "stats": {"nullRate": rate},
        "compile": {"pageUrl": page_url, "type": spec.type},
    }


def write_registry(out: Path, spec: Spec, snapshot: bytes, expected: dict) -> None:
    """Write spec.json, snapshot.html and expected.json into specs/<site>/."""
    out.mkdir(parents=True, exist_ok=True)
    (out / "spec.json").write_text(spec_json(spec), encoding="utf-8")
    (out / "snapshot.html").write_bytes(snapshot)
    (out / "expected.json").write_text(json.dumps(expected, indent=2) + "\n", encoding="utf-8")


def write_status(out: Path, state: str, spec_version: int, detail: dict | None = None) -> None:
    """Mirror of the runtime's writeStatus: `since` survives while the state holds."""
    from datetime import datetime, timezone

    file = out / "status.json"
    since = datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    try:
        prev = json.loads(file.read_text(encoding="utf-8"))
        if prev.get("state") == state and prev.get("since"):
            since = prev["since"]
    except (OSError, ValueError):
        pass
    body = {"state": state, "since": since, "specVersion": spec_version, "detail": detail or {}}
    file.write_text(json.dumps(body, indent=2) + "\n", encoding="utf-8")
