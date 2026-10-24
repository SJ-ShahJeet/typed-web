"""Steps 1–4 of the ladder (Compiler tab): known patterns, JSON-LD and state blobs in the plain
body, rendered-vs-plain diff, endpoint replay with header minimisation. Plus the JSON field
matcher every JSON-shaped rung shares.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from decimal import Decimal
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from selectolax.lexbor import LexborHTMLParser as HTMLParser

from . import fetch
from .emit import FieldTemplate, availability, decimal_of, minor_units, shape

KNOWN_PATTERNS = {"shopify": "/products.json", "wordpress": "/wp-json/"}
STATE_GLOBALS = ("__NEXT_DATA__", "__NUXT__", "__INITIAL_STATE__", "__PRELOADED_STATE__")
# request headers worth replaying; the browser's sec-ch-* and user-agent are noise
REPLAY_HEADERS = ("accept", "authorization", "cookie", "referer", "origin", "content-type")


class CompileError(RuntimeError):
    pass


# --- ids and url templates (D17) ---------------------------------------------------------


def templatize_page(url: str) -> tuple[str, str]:
    """`/ssr/1.html` → (`/ssr/{id}.html`, `1`); `/catalogue/slug_1000/index.html` → (`/catalogue/{id}/index.html`, slug)."""
    parts = urlsplit(url)
    segs = parts.path.split("/")
    for i in range(len(segs) - 1, 0, -1):
        seg = segs[i]
        if not seg or re.fullmatch(r"index(\.\w+)?", seg):
            continue
        stem, dot, ext = seg.rpartition(".")
        if dot and stem and len(ext) <= 5:
            segs[i], id_ = "{id}." + ext, stem
        else:
            segs[i], id_ = "{id}", seg
        return urlunsplit(parts._replace(path="/".join(segs))), id_
    raise CompileError(f"cannot find an id segment in {url}")


def templatize(url: str, id_: str) -> str | None:
    """Replace the page id wherever it appears in an endpoint URL, or None when it does not."""
    parts = urlsplit(url)
    segs = parts.path.split("/")
    hit = False
    for i, seg in enumerate(segs):
        stem, dot, ext = seg.rpartition(".")
        if seg == id_:
            segs[i], hit = "{id}", True
        elif dot and stem == id_:
            segs[i], hit = "{id}." + ext, True
    query = [(k, "{id}" if v == id_ else v) for k, v in parse_qsl(parts.query, keep_blank_values=True)]
    hit = hit or any(v == "{id}" for _, v in query)
    if not hit:
        return None
    q = urlencode(query, safe="{}")
    return urlunsplit(parts._replace(path="/".join(segs), query=q))


def neighbour_ids(id_: str, template: str, want: int = 2) -> list[str]:
    """Numeric ids: probe the neighbours for sample pages (D17). Anything else needs --samples."""
    if not id_.isdigit():
        raise CompileError(f"id '{id_}' is not numeric: pass --samples <id>,<id> with two other pages of this type")
    n, found, tried = int(id_), [], 0
    for delta in (1, 2, 3, -1, 4, 5, -2, 6):
        cand = n + delta
        if cand < 0 or len(found) >= want:
            continue
        tried += 1
        if fetch.plain(template.replace("{id}", str(cand)), fetch.PAGE_HEADERS).status == 200:
            found.append(str(cand))
    if len(found) < want:
        raise CompileError(f"found only {len(found)} neighbour page(s) of {id_} after {tried} probes; pass --samples")
    return found


# --- step 1: known patterns ---------------------------------------------------------------


def known_patterns(page_url: str) -> dict[str, str]:
    """Documented-API probes on the page's origin; logged, not yet emitted (D20)."""
    parts = urlsplit(page_url)
    found: dict[str, str] = {}
    for name, path in KNOWN_PATTERNS.items():
        url = urlunsplit((parts.scheme, parts.netloc, path, "", ""))
        try:
            r = fetch.plain(url, fetch.JSON_HEADERS)
        except Exception:
            continue
        if r.status == 200 and "json" in r.content_type:
            found[name] = url
    return found


# --- step 2: structured data in the plain body ---------------------------------------------


def body_text(html: str) -> str:
    tree = HTMLParser(html)
    for n in tree.css("script, style, noscript, template"):
        n.decompose()
    return (tree.body or tree.root).text(deep=True, separator="\n") if tree.body or tree.root else ""


def jsonld_nodes(html: str) -> list[dict]:
    """Every ld+json node, `@graph` flattened one level, as the runtime does."""
    out: list[dict] = []

    def push(node) -> None:  # noqa: ANN001
        if isinstance(node, list):
            for n in node:
                push(n)
        elif isinstance(node, dict):
            if isinstance(node.get("@graph"), list):
                push(node["@graph"])
            else:
                out.append(node)

    for s in HTMLParser(html).css('script[type="application/ld+json"]'):
        try:
            push(json.loads(s.text()))
        except ValueError:
            continue
    return out


def has_type(node: dict, type_: str) -> bool:
    t = node.get("@type")
    return type_ in t if isinstance(t, list) else t == type_


def state_blobs(html: str) -> dict[str, object]:
    """`{global: parsed JSON}` for every framework state global found in inline scripts."""
    tree = HTMLParser(html)
    found: dict[str, object] = {}
    for g in STATE_GLOBALS:
        by_id = tree.css_first(f"script#{g}")
        if by_id is not None:
            try:
                found[g] = json.loads(by_id.text())
                continue
            except ValueError:
                pass
        rx = re.compile(rf"(?:window\.)?{g}\s*=\s*")
        for s in tree.css("script:not([src])"):
            text = s.text()
            m = rx.search(text)
            if not m:
                continue
            tail = text[m.end() :].strip().rstrip(";").strip()
            try:
                found[g] = json.loads(tail)  # ponytail: whole-statement JSON only, as in the runtime
                break
            except ValueError:
                continue
    return found


# --- the JSON field matcher ---------------------------------------------------------------


@dataclass
class Match:
    path: str
    value: object
    score: float
    coerce: str | None = None  # "minorUnits" when the JSON integer is the page price ×10^minor


def leaves(obj: object, prefix: str = "") -> list[tuple[str, object]]:
    """(runtime path, scalar) for every leaf: `product.offers[0].price`."""
    if isinstance(obj, dict):
        return [p for k, v in obj.items() for p in leaves(v, f"{prefix}.{k}" if prefix else k)]
    if isinstance(obj, list):
        return [p for i, v in enumerate(obj) for p in leaves(v, f"{prefix}[{i}]")]
    return [(prefix, obj)]


def last_key(path: str) -> str:
    return re.sub(r"\[\d+\]$", "", path).rsplit(".", 1)[-1].lower()


def _value_shape(tpl: FieldTemplate, value: object, page_money: list[Decimal], currency: str | None) -> tuple[int, str | None]:
    """(strength, coerce) of a JSON leaf for a template; 0 rejects."""
    if value is None or isinstance(value, (dict, list)):
        return 0, None
    if tpl.type == "money":
        if isinstance(value, bool):
            return 0, None
        d = Decimal(str(value)) if isinstance(value, (int, float)) else decimal_of(str(value))
        if d is None:
            return 0, None
        if not page_money:
            return 1, None
        if d in page_money:
            return 2, None
        if isinstance(value, int) and Decimal(value).scaleb(-minor_units(currency or "GBP")) in page_money:
            return 2, "minorUnits"
        return 0, None
    if tpl.type == "enum" and tpl.coerce == "availability":
        if isinstance(value, bool):
            return 1, None
        return (2, None) if availability(str(value)) != "unknown" else (0, None)
    if tpl.type == "boolean":
        return (2, None) if isinstance(value, bool) else (0, None)
    if isinstance(value, bool):
        return 0, None
    return shape(tpl, str(value)), None


def find_currency(ls: list[tuple[str, object]]) -> str | None:
    for path, v in ls:
        if last_key(path) in ("pricecurrency", "currency", "currencycode") and isinstance(v, str) and re.fullmatch(r"[A-Z]{3}", v):
            return v
    return None


def match_fields(obj: object, templates: dict[str, FieldTemplate], page_money: list[Decimal], page_text: str = "") -> tuple[dict[str, Match], str | None]:
    """Best leaf per field by key alias, value shape and agreement with the page (Compiler tab, 'Known value')."""
    ls = leaves(obj)
    currency = find_currency(ls)
    out: dict[str, Match] = {}
    for name, tpl in templates.items():
        best: Match | None = None
        for path, value in ls:
            key = last_key(path)
            alias = next((i for i, a in enumerate(tpl.aliases) if a in key), None)
            if alias is None:
                continue
            strength, coerce = _value_shape(tpl, value, page_money, currency)
            if not strength:
                continue
            score = strength * 2 + (3 if key == tpl.aliases[alias] else 1) - alias * 0.5
            if tpl.path_hint and tpl.path_hint in path.lower():
                score += 1
            if tpl.type == "string" and page_text and str(value) in page_text:
                score += 2
            if best is None or score > best.score:
                best = Match(path, value, score, coerce)
        if best:
            out[name] = best
    return out, currency


# --- steps 3 and 4: rendered diff, endpoint replay -----------------------------------------


def js_only_values(plain_html: str, rendered_text: str) -> list[str]:
    """Text blocks present after JavaScript ran but absent from the plain body."""
    plain = re.sub(r"\s+", " ", body_text(plain_html))
    blocks = [b.strip() for b in re.split(r"[\n\t]", rendered_text)]
    return [b for b in blocks if b and re.sub(r"\s+", " ", b) not in plain]


def _json_body(c: fetch.Captured) -> object | None:
    if "json" not in c.content_type and not c.body.lstrip().startswith(("{", "[")):
        return None
    try:
        return json.loads(c.body)
    except ValueError:
        return None


def endpoint_candidates(responses: list[fetch.Captured], js_values: list[str]) -> list[tuple[fetch.Captured, object]]:
    """JSON responses whose leaves carry at least one value that only exists after JavaScript."""
    money = [d for v in js_values for d in (decimal_of(v),) if d is not None]
    out = []
    for c in responses:
        body = _json_body(c)
        if body is None or c.status != 200:
            continue
        hits = 0
        for _, v in leaves(body):
            if isinstance(v, str) and any(v and v in jv for jv in js_values):
                hits += 1
            elif isinstance(v, (int, float)) and not isinstance(v, bool):
                d = Decimal(str(v))
                if d in money or any(d.scaleb(-2) == m for m in money):
                    hits += 1
        if hits:
            out.append((c, body))
    return out


def replay(c: fetch.Captured, body: object) -> tuple[dict[str, str], str] | None:
    """Fetch the endpoint without a browser; find the smallest header set that returns the same JSON.

    Returns (headers, auth) or None when no header set reproduces the body (session or computed
    auth, milestone 2).
    """
    wanted = {k: v for k, v in c.request_headers.items() if k.lower() in REPLAY_HEADERS}
    wanted.setdefault("accept", "application/json")

    def same(headers: dict[str, str]) -> bool:
        r = fetch.plain(c.url, headers)
        return r.status == 200 and _json_body(fetch.Captured(c.url, r.status, r.content_type, {}, r.text)) == body

    minimal = {"accept": wanted["accept"]}
    if same(minimal):
        return minimal, "none"
    if not same(wanted):
        return None
    for k in list(wanted):  # greedy drop, cheapest first
        if k == "accept":
            continue
        trial = {h: v for h, v in wanted.items() if h != k}
        if same(trial):
            wanted = trial
    auth = "static" if any(k in ("authorization", "cookie") for k in wanted) else "none"
    return wanted, auth
