#!/usr/bin/env python3
"""Stamp every local script and stylesheet tag in docs/*.html with a
fingerprint of the file's contents: <script src="app.js?v=1a2b3c4d">.

GitHub Pages lets browsers cache these files for ten minutes, so without
this a visitor can run a fresh page against a stale script, or a stale
script against a fresh one. Once Pixelated ran a new pixelated.js on an
old closeup.js and silently drew the wrong thing. A changed file gets a
new fingerprint, so a new URL, so the browser has to fetch it.

Run it after changing anything in docs/ and before committing:

    python3 version_assets.py           # rewrite the tags
    python3 version_assets.py --check   # exit 1 if any tag is stale

test_game.py runs the check, so a forgotten stamp fails the tests.
fetch_data.py runs it too, since it rewrites data.js and numbers_data.js.
"""
import hashlib
import os
import re
import sys

DOCS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "docs")

# src="x.js" or href="x.css", optionally already carrying ?v=...; only bare
# local file names, so the GoatCounter script (//gc.zgo.at/...) and links
# between pages are left alone.
TAG_RE = re.compile(r'((?:src|href)=")([\w.-]+\.(?:js|css))(?:\?v=[\w]*)?(")')


def fingerprint(name):
    with open(os.path.join(DOCS, name), "rb") as fh:
        return hashlib.sha1(fh.read()).hexdigest()[:8]


def stamp(html):
    return TAG_RE.sub(lambda m: f"{m.group(1)}{m.group(2)}?v={fingerprint(m.group(2))}{m.group(3)}", html)


def stale_pages():
    """(page, would-be contents) for every page whose stamps are out of date."""
    out = []
    for page in sorted(os.listdir(DOCS)):
        if not page.endswith(".html"):
            continue
        path = os.path.join(DOCS, page)
        with open(path, encoding="utf-8") as fh:
            html = fh.read()
        new = stamp(html)
        if new != html:
            out.append((path, new))
    return out


def main(argv):
    stale = stale_pages()
    if "--check" in argv:
        for path, _ in stale:
            print(f"stale asset versions in {os.path.relpath(path)}")
        return 1 if stale else 0
    for path, new in stale:
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(new)
        print(f"stamped {os.path.relpath(path)}")
    if not stale:
        print("asset versions already current")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
