"""`compile <url> --type <Type> --out <dir>` and `repair <site>`.

Build order (design doc, Compiler tab): fetch -> detect -> locate -> emit. Each step lands
in its own commit; until a step exists the CLI says so instead of pretending.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path


def compile_main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="compile", description="Compile one site into a spec.")
    p.add_argument("url", help="One example page of the type, e.g. a product page")
    p.add_argument("--type", required=True, help="schema.org type: Product, JobPosting, NewsArticle")
    p.add_argument("--out", required=True, type=Path, help="Registry folder, e.g. ../specs/<site>")
    args = p.parse_args(argv)
    print(f"compile: {args.url} as {args.type} -> {args.out}", file=sys.stderr)
    print("not implemented yet: milestone 1 build step 4 (fetch, detect, locate, emit)", file=sys.stderr)
    return 2


def repair_main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="repair", description="Recompile a flagged site.")
    p.add_argument("site", help="Registry folder name under specs/")
    args = p.parse_args(argv)
    print(f"repair: {args.site}", file=sys.stderr)
    print("not implemented yet: milestone 1 build step 5 (change detection + repair)", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(compile_main())
