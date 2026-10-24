"""Step 5 of the ladder (Compiler tab, 'Field location without labels'): candidate nodes per
field, selector ranking, and the `choose()` hook a chooser model slots into later (D6).
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from selectolax.lexbor import LexborHTMLParser as HTMLParser
from selectolax.lexbor import LexborNode as Node

from .emit import TYPES, FieldTemplate, shape

SKIP = {"script", "style", "noscript", "template", "svg", "nav", "footer", "header", "button", "select", "option", "input", "form", "iframe"}
# ponytail: generated-class heuristic by prefix and hash-like runs; a per-framework table replaces it when a site fools it.
GENERATED = re.compile(r"^(css|sc|jss|svelte|emotion|chakra|_)[-_]|[0-9a-f]{5,}|\d{3,}|^[a-z]$")
STABLE_ID = re.compile(r"^[A-Za-z][\w-]*$")


@dataclass
class Candidate:
    selector: str
    text: str
    score: float
    rank: int  # 0 id/itemprop · 1 data-* · 2 stable class · 3 tag · 4 positional
    positional: bool

    @property
    def anchored(self) -> bool:
        """D19: only an anchored candidate may be emitted as a fallback source."""
        return not self.positional


def norm(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def stable_classes(el: Node) -> list[str]:
    return [c for c in (el.attributes.get("class") or "").split() if not GENERATED.search(c)]


def own_selector(el: Node, aliases: tuple[str, ...]) -> tuple[str, int]:
    a = el.attributes
    if a.get("id") and STABLE_ID.match(a["id"]) and not GENERATED.search(a["id"]):
        return f'{el.tag}#{a["id"]}', 0
    if a.get("itemprop"):
        return f'{el.tag}[itemprop="{a["itemprop"]}"]', 0
    for k, v in a.items():
        if k.startswith("data-") and v and k not in ("data-reactid", "data-v") and not GENERATED.search(v):
            return f'{el.tag}[{k}="{v}"]', 1
    classes = stable_classes(el)
    if classes:
        pick = next((c for c in classes if any(w in c.lower() for w in aliases)), classes[0])
        return f"{el.tag}.{pick}", 2
    return el.tag, 3


def scope_node(el: Node) -> Node | None:
    """Nearest ancestor with an id or a stable class, below body."""
    p = el.parent
    while p is not None and p.tag not in ("body", "html"):
        if own_selector(p, ())[1] <= 2:
            return p
        p = p.parent
    return None


def nth(el: Node) -> int:
    return 1 + [s.mem_id for s in el.parent.iter()].index(el.mem_id)


def selector_for(el: Node, root: HTMLParser, aliases: tuple[str, ...]) -> Candidate | None:
    own, rank = own_selector(el, aliases)
    scope = scope_node(el)
    sel = f"{own_selector(scope, ())[0]} {own}" if scope is not None else own
    if len(root.css(sel)) == 1:
        return Candidate(sel, "", 0, rank, False)
    # positional: child chain from the scope (or body) down to the element
    chain, node = [], el
    while node is not None and node.tag != "body" and not (scope is not None and node.mem_id == scope.mem_id):
        chain.append(f"{node.tag}:nth-child({nth(node)})")
        node = node.parent
    head = own_selector(scope, ())[0] if scope is not None else "body"
    sel = " > ".join([head, *reversed(chain)])
    return Candidate(sel, "", 0, 4, True) if len(root.css(sel)) == 1 else None


def _skipped(el: Node, cache: dict[int, bool]) -> bool:
    if el.mem_id in cache:
        return cache[el.mem_id]
    p = el.parent
    cache[el.mem_id] = el.tag in SKIP or (p is not None and p.tag != "html" and _skipped(p, cache))
    return cache[el.mem_id]


def candidates(field: str, tpl: FieldTemplate, pages: list[HTMLParser], known: str | None = None, exclude: frozenset[str] = frozenset()) -> list[Candidate]:
    """Ranked candidates for one field from the first page, checked against the sample pages."""
    first, others = pages[0], pages[1:]
    body = first.body
    if body is None:
        return []
    aliases = tuple(a.lower() for a in tpl.aliases) + (field.lower(),)
    other_shapes = [t for t in TYPES.get("Product", {}).values() if t.type != "string" and t is not tpl]
    out: list[Candidate] = []
    cache: dict[int, bool] = {}
    for el in body.traverse(include_text=False):
        if not el.tag or el.tag == "-text" or _skipped(el, cache):
            continue
        text = norm(el.text(deep=True))
        strength = shape(tpl, text)
        if not strength:
            continue
        # innermost rule: a child that carries the value is the real candidate; for free text a
        # container of several text-bearing children is a list or a table, not a field
        child_texts = [ct for c in el.iter() if c.tag and c.tag != "-text" and (ct := norm(c.text(deep=True)))]
        if tpl.type == "string":
            # ponytail: <h1>Trail <em>Runner</em> 3</h1> loses the h1; accepted until a fixture has one.
            if len(child_texts) >= 2 or any(ct == text for ct in child_texts):
                continue
        elif any(shape(tpl, ct) for ct in child_texts):
            continue
        cand = selector_for(el, first, aliases)
        if cand is None or cand.selector in exclude:
            continue
        # template diff: the selector must resolve to exactly one node on every sample page
        texts = []
        for page in others:
            hits = page.css(cand.selector)
            if len(hits) != 1:
                break
            texts.append(norm(hits[0].text(deep=True)))
        if len(texts) != len(others):
            continue
        score = float(strength)
        score += 3 if any(t != text for t in texts) else 0
        attrs = " ".join(v for k, v in el.attributes.items() if k in ("id", "class", "itemprop", "name") or k.startswith("data-")).lower()
        score += 4 if any(a in attrs for a in aliases) else 0
        score += 2 if el.tag in tpl.tags else 0
        label = norm((el.parent.text(deep=False) if el.parent is not None else "") + " " + (el.prev.text(deep=True) if el.prev is not None and el.prev.tag in ("th", "dt", "label", "span", "strong", "b") else "")).lower()
        score += 1 if any(a in label for a in aliases) else 0
        score += 5 if known and known in text else 0
        score -= 3 if tpl.type == "string" and any(shape(t, text) == 2 for t in other_shapes) else 0
        score -= 1 if cand.positional else 0
        score -= cand.rank * 0.25
        cand.text, cand.score = text, score
        out.append(cand)
    out.sort(key=lambda c: -c.score)  # stable: document order breaks ties
    return out


PAIR = {"th": "td", "dt": "dd"}


def label_xpath(field: str, tpl: FieldTemplate, pages: list[HTMLParser]) -> tuple[str, str] | None:
    """D24: a th/dt whose text is one of the field's aliases, read through its next td/dd.

    Keyed on the label text, never a position, so a reordered table still answers. The label
    must answer with the field's shape on every sample page. Returns (expr, first page value).
    """
    aliases = {a.lower() for a in tpl.aliases} | {field.lower()}

    def cell(page: HTMLParser, tag: str, text: str) -> str | None:
        for lab in page.css(tag):
            if norm(lab.text(deep=True)) != text:
                continue
            n = lab.next
            while n is not None and n.tag == "-text":
                n = n.next
            if n is not None and n.tag == PAIR[tag]:
                v = norm(n.text(deep=True))
                return v if shape(tpl, v) else None
        return None

    for lab in pages[0].css("th, dt"):
        text = norm(lab.text(deep=True))
        # ponytail: a label holding a quote is skipped; concat() quoting when a site needs one.
        if text.rstrip(":").strip().lower() not in aliases or "'" in text:
            continue
        if all(cell(p, lab.tag, text) for p in pages):
            return f"//{lab.tag}[normalize-space()='{text}']/following-sibling::{PAIR[lab.tag]}[1]", cell(pages[0], lab.tag, text) or ""
    return None


def choose(cands: list[Candidate]) -> Candidate | None:
    """The chooser hook (D6): milestone 1 takes the top candidate; a model slots in here."""
    return cands[0] if cands else None
