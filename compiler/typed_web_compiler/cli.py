"""`compile <url> --type <Type> --out <dir> [--samples id,id]` and `repair <site>`.

Wires the ladder (design doc, Compiler tab): fetch -> detect -> locate -> emit. The compiler
stops at the first step after which every required field has a source (D4).
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from urllib import robotparser
from urllib.parse import urlsplit, urlunsplit

from selectolax.lexbor import LexborHTMLParser as HTMLParser

from . import detect, emit, fetch, locate
from .detect import CompileError
from .emit import TYPES, CssSource, Fetch, FieldSpec, Freshness, JsonLdSource, JsonSource, Locale, Spec, StateSource, Verify

DATE_ORDER = {"en-us": "MDY", "en": "DMY", "de": "DMY", "fr": "DMY", "es": "DMY", "it": "DMY", "nl": "DMY", "pt": "DMY", "ja": "YMD", "zh": "YMD", "ko": "YMD", "hu": "YMD", "sv": "YMD"}


def log(msg: str) -> None:
    print(msg, file=sys.stderr)


def robots_allow(url: str) -> bool:
    parts = urlsplit(url)
    rp = robotparser.RobotFileParser(urlunsplit((parts.scheme, parts.netloc, "/robots.txt", "", "")))
    try:
        rp.read()
    except OSError:
        return True
    return rp.can_fetch(fetch.UA, url)


def date_order(lang: str | None) -> str | None:
    if not lang:
        return None
    lang = lang.lower()
    return DATE_ORDER.get(lang) or DATE_ORDER.get(lang.split("-")[0])


def compile_site(page_url: str, type_: str, out: Path, samples: list[str] | None = None, version: int = 1) -> tuple[Spec, dict]:
    """Climb the ladder for one page, verify on the sample pages, write the registry folder."""
    if type_ not in TYPES:
        raise CompileError(f"unknown type '{type_}'; known: {', '.join(TYPES)}")
    templates = TYPES[type_]
    required = [f for f, t in templates.items() if t.required]
    site = out.name
    template_url, page_id = detect.templatize_page(page_url)
    if not robots_allow(page_url):
        raise CompileError(f"robots.txt disallows {page_url} (D11); not compiling")
    sample_ids = samples or detect.neighbour_ids(page_id, template_url)
    log(f"compile: {site} <- {template_url} id={page_id} samples={','.join(sample_ids)}")

    # step 1: known patterns (probed and logged; the rung 0 marker waits for a documented-API site, D20)
    known = detect.known_patterns(page_url)
    log(f"step 1 known patterns: {known or 'none'}")

    # step 2: plain fetch, JSON-LD and state blobs
    p1 = fetch.plain(page_url, fetch.PAGE_HEADERS)
    if p1.status != 200:
        access = "rate-limited" if p1.status == 429 else "challenged" if p1.status in (403, 503) else "open"
        raise CompileError(f"HTTP {p1.status} for {page_url} (access: {access}); milestone 1 compiles open sites only")
    page_text = detect.body_text(p1.text)
    page_money = emit.money_amounts(page_text)
    currency = emit.currency_of(page_text)
    sources: dict[str, list] = {}
    coerce: dict[str, str] = {}
    fetch_url, headers, auth = template_url, dict(fetch.PAGE_HEADERS), "none"

    def take(matches: dict[str, detect.Match], make) -> None:  # noqa: ANN001
        for f, m in matches.items():
            sources.setdefault(f, []).append(make(m.path))
            if m.coerce:
                coerce[f] = m.coerce

    for node in detect.jsonld_nodes(p1.text):
        if has := detect.has_type(node, type_):
            matches, cur = detect.match_fields(node, templates, page_money, page_text)
            currency = cur or currency
            take(matches, lambda path: JsonLdSource(type=type_, path=path))
            log(f"step 2 jsonld {type_}: {sorted(matches)}")
    for g, blob in detect.state_blobs(p1.text).items():
        matches, cur = detect.match_fields(blob, templates, page_money, page_text)
        currency = cur or currency
        take(matches, lambda path, g=g: StateSource(**{"global": g, "path": path}))
        log(f"step 2 state {g}: {sorted(matches)}")

    def missing() -> list[str]:
        return [f for f in required if f not in sources]

    rendered_values: list[str] = []
    if missing():
        # step 3: browser fetch and diff
        r = fetch.rendered(page_url)
        rendered_values = detect.js_only_values(p1.text, r.text)
        log(f"step 3 browser: {len(r.responses)} xhr/fetch responses, {len(rendered_values)} JS-only text blocks")
        if rendered_values:
            page_text = r.text
            page_money = emit.money_amounts(page_text) or page_money
            # step 4: endpoint replay
            for cap, body in detect.endpoint_candidates(r.responses, rendered_values):
                ep = detect.templatize(cap.url, page_id)
                if ep is None:
                    log(f"step 4 {cap.url}: id not in the URL, skipped (computed ids are milestone 2)")
                    continue
                replayed = detect.replay(cap, body)
                if replayed is None:
                    log(f"step 4 {cap.url}: no header set reproduces the body, skipped (session auth is milestone 2)")
                    continue
                matches, cur = detect.match_fields(body, templates, page_money, page_text)
                if all(f in matches for f in required):
                    fetch_url, (headers, auth) = ep, replayed
                    currency = cur or currency
                    sources, coerce = {}, {}
                    take(matches, lambda path: JsonSource(path=path))
                    log(f"step 4 endpoint {ep}: fills {sorted(matches)} with headers {sorted(headers)}")
                    break
                log(f"step 4 {cap.url}: fills only {sorted(matches)}")

    pages: list[HTMLParser] = []
    excluded: dict[str, set[str]] = {}
    chosen: dict[str, locate.Candidate] = {}

    def locate_field(f: str) -> None:
        if not pages:
            pages.extend(HTMLParser(h) for h in [p1.text, *(fetch.plain(template_url.replace("{id}", s), fetch.PAGE_HEADERS).text for s in sample_ids)])
        known_value = next((str(src) for src in rendered_values if f == "title"), None)
        cands = locate.candidates(f, templates[f], pages, known_value, frozenset(excluded.get(f, ())))
        pick = locate.choose(cands)
        if pick is None:
            hint = " (only exists after JavaScript: fetcher 'browser' is milestone 2)" if rendered_values else ""
            raise CompileError(f"step 5: no candidate for field '{f}'{hint}")
        chosen[f] = pick
        fallbacks = [c for c in cands[1:] if c.anchored and c.score >= 3][:1]  # D19
        sources[f] = [CssSource(selector=c.selector) for c in (pick, *fallbacks)]
        log(f"step 5 {f}: {pick.selector!r} = {pick.text!r} (score {pick.score}, {len(cands)} candidates)")

    if fetch_url == template_url:
        for f in missing():
            locate_field(f)

    # the spec
    lang = (HTMLParser(p1.text).css_first("html") or HTMLParser("<html>").root).attributes.get("lang") if p1.text else None
    fields = {
        f: FieldSpec(
            type=t.type,
            required=t.required,
            sources=sources[f],
            coerce=coerce.get(f) or t.coerce,
            values=list(t.values) if t.values else None,
        )
        for f, t in templates.items()
        if f in sources
    }
    spec = Spec(
        site=site,
        version=version,
        type=type_,
        access="open",
        locale=Locale(lang=lang, currency=currency, dateOrder=date_order(lang)),
        fetch=Fetch(url=fetch_url, headers=headers, auth=auth),
        fields=fields,
        freshness=Freshness(defaultMaxAge="1h"),
        verify=Verify(samplePaths=sample_ids),
    )

    # step 6: verify; a failing css field goes back to step 5, nothing restarts from step 1
    ids = [page_id, *sample_ids]
    for attempt in range(4):
        records, failures = emit.verify(spec, ids)
        if not failures:
            break
        bad = {f for msg in failures.values() for f in emit.failing_fields(msg)}
        log(f"step 6 attempt {attempt + 1}: {failures}")
        if not bad or any(f not in chosen for f in bad) or attempt == 3:
            raise CompileError("verify failed: " + "; ".join(f"{i}: {m}" for i, m in failures.items()))
        for f in bad:
            excluded.setdefault(f, set()).add(chosen[f].selector)
            locate_field(f)
            spec.fields[f].sources = sources[f]
    log(f"step 6 verified {len(records)}/{len(ids)} pages")
    expected = emit.expected_json(spec, {i: records[i] for i in ids}, template_url)
    emit.write_registry(out, spec, p1.body, expected)
    log(f"wrote {out}/spec.json v{spec.version}, snapshot.html, expected.json")
    return spec, expected


def compile_main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="compile", description="Compile one site into a spec.")
    p.add_argument("url", help="One example page of the type, e.g. a product page")
    p.add_argument("--type", required=True, help="schema.org type: Product, JobPosting, NewsArticle")
    p.add_argument("--out", required=True, type=Path, help="Registry folder, e.g. ../specs/<site>")
    p.add_argument("--samples", help="Two or more other ids of the same type, comma-separated (D17)")
    args = p.parse_args(argv)
    try:
        compile_site(args.url, args.type, args.out, args.samples.split(",") if args.samples else None)
    except (CompileError, emit.VerifyError) as err:
        log(f"compile: {err}")
        return 1
    return 0


def repair_main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="repair", description="Recompile a flagged site.")
    p.add_argument("site", help="Registry folder name under specs/")
    args = p.parse_args(argv)
    print(f"repair: {args.site}", file=sys.stderr)
    print("not implemented yet: milestone 1 build step 5 (change detection + repair)", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(compile_main())
