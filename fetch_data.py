#!/usr/bin/env python3
"""Build the Chronology game's dataset from MoMA's public collection data.

MoMA publishes its collection as CSVs in the MuseumofModernArt/collection
repo on GitHub, stored via Git LFS (so they must be fetched from the
media.githubusercontent.com endpoint, not raw.githubusercontent.com).

The game needs paintings that are (a) currently on view at MoMA, (b) have a
usable image, and (c) have a single confidently-parseable year, since the
whole point is ordering works in time. This script applies those filters and
writes docs/data.js (loaded by a plain <script> tag) plus a pretty-printed
data/paintings.json for inspection and diffing.

Usage:
    python3 fetch_data.py           # use cached CSVs in raw/ if present
    python3 fetch_data.py --refresh # re-download the CSVs first
"""

import argparse
import csv
import json
import os
import re
import sys
import urllib.request

BASE = "https://media.githubusercontent.com/media/MuseumofModernArt/collection/main"
HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, "raw")
DATA = os.path.join(HERE, "data")
DOCS = os.path.join(HERE, "docs")

csv.field_size_limit(10 ** 7)


def download(name):
    """Fetch one CSV from MoMA's LFS media endpoint into raw/."""
    dest = os.path.join(RAW, name)
    url = f"{BASE}/{name}"
    print(f"  downloading {name} ...", end="", flush=True)
    with urllib.request.urlopen(url, timeout=300) as resp, open(dest, "wb") as fh:
        fh.write(resp.read())
    print(f" {os.path.getsize(dest) // 1024} KB")
    return dest


def load_csv(name, refresh):
    path = os.path.join(RAW, name)
    if refresh or not os.path.exists(path):
        os.makedirs(RAW, exist_ok=True)
        download(name)
    with open(path, encoding="utf-8-sig") as fh:
        return list(csv.DictReader(fh))


# --- year parsing -----------------------------------------------------------
# MoMA's Date field is free text: "1913", "1940-41", "c. 1930", "1962-1964",
# "n.d.", "1960s". The game can only use a work if we can pin it to one year
# we'd defend, so anything vague is dropped rather than guessed at.

YEAR_RE = re.compile(r"\b(1[0-9]{3}|20[0-2][0-9])\b")
RANGE_RE = re.compile(r"^\s*(1[0-9]{3}|20[0-2][0-9])\s*[-–—/]\s*(\d{2}|\d{4})\s*$")
VAGUE_RE = re.compile(r"n\.d\.|unknown|\?|\bor\b|\bca?\.\s*\d{3}0s", re.I)
DECADE_RE = re.compile(r"\d{4}\s*s\b")


def parse_year(raw):
    """Return one confident year for a Date string, or None to drop the work.

    For a completed-over-time work ("1940-41") we use the completion year,
    which is how MoMA itself orders such works.
    """
    s = (raw or "").strip()
    if not s or VAGUE_RE.search(s) or DECADE_RE.search(s):
        return None

    m = RANGE_RE.match(s)
    if m:
        start = int(m.group(1))
        end = m.group(2)
        end = int(end) if len(end) == 4 else int(str(start)[:2] + end)
        # A span longer than a working lifetime means the string isn't a range
        # we understand; a negative one means it's malformed.
        return end if 0 <= end - start <= 30 else None

    years = [int(y) for y in YEAR_RE.findall(s)]
    if not years:
        return None
    if max(years) - min(years) > 30:
        return None
    return max(years)


TAG_RE = re.compile(r"<[^>]+>")


def clean(value):
    """Normalise a MoMA text field for display.

    Two quirks to handle: OnView values arrive wrapped in literal quote
    characters, and a handful of titles carry inline HTML markup (e.g.
    "Untitled <em>from the series</em> Hourglasses"), which would otherwise
    be shown to the player as raw tags.
    """
    s = (value or "").strip()
    if len(s) >= 2 and s[0] == '"' and s[-1] == '"':
        s = s[1:-1]
    s = TAG_RE.sub("", s)
    return re.sub(r"\s+", " ", s).strip()


def first_constituent(raw):
    """Artworks.csv gives ConstituentID as a bare id or a comma-separated list."""
    ids = [c.strip() for c in (raw or "").split(",") if c.strip().isdigit()]
    return ids[0] if ids else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--refresh", action="store_true",
                    help="re-download the CSVs instead of using raw/")
    args = ap.parse_args()

    print("Loading MoMA collection data")
    artworks = load_csv("Artworks.csv", args.refresh)
    artists = load_csv("Artists.csv", args.refresh)
    print(f"  {len(artworks):,} artworks, {len(artists):,} artists")

    qid_by_id = {a["ConstituentID"]: a["Wiki QID"].strip()
                 for a in artists if a.get("Wiki QID", "").strip()}

    # --- filter down to the playable pool ---------------------------------
    stats = {"painting": 0, "imaged": 0, "on_view": 0, "dated": 0,
             "named_artist": 0, "kept": 0}
    pool = []
    for r in artworks:
        if r.get("Classification") != "Painting":
            continue
        stats["painting"] += 1
        image = clean(r.get("ImageURL"))
        if not image:
            continue
        stats["imaged"] += 1
        gallery = clean(r.get("OnView"))
        if not gallery:
            continue
        stats["on_view"] += 1
        year = parse_year(r.get("Date"))
        if year is None:
            continue
        stats["dated"] += 1
        artist = clean(r.get("Artist"))
        # An anonymous attribution can't anchor the "all different artists"
        # rule, since two such works would collide as the same "artist".
        if not artist or re.search(r"unidentified|unknown|various", artist, re.I):
            continue
        stats["named_artist"] += 1

        cid = first_constituent(r.get("ConstituentID"))
        pool.append({
            "id": clean(r.get("ObjectID")),
            "title": clean(r.get("Title")) or "Untitled",
            "artist": artist,
            "artistBio": clean(r.get("ArtistBio")),
            "nationality": clean(r.get("Nationality")),
            "year": year,
            "dateText": clean(r.get("Date")),
            "medium": clean(r.get("Medium")),
            "dimensions": clean(r.get("Dimensions")),
            "creditLine": clean(r.get("CreditLine")),
            "accession": clean(r.get("AccessionNumber")),
            "gallery": gallery,
            "url": clean(r.get("URL")),
            "image": image,
            "wikiQid": qid_by_id.get(cid or "", ""),
        })

    # Guard against the same work appearing twice under different object ids.
    seen, deduped = set(), []
    for w in pool:
        key = (w["artist"].lower(), w["title"].lower(), w["year"])
        if key in seen:
            continue
        seen.add(key)
        deduped.append(w)
    dropped = len(pool) - len(deduped)
    pool = deduped
    stats["kept"] = len(pool)

    pool.sort(key=lambda w: (w["year"], w["artist"], w["title"]))

    print("\nFilter funnel")
    print(f"  classification=Painting        {stats['painting']:>6,}")
    print(f"  ...with an image               {stats['imaged']:>6,}")
    print(f"  ...currently on view           {stats['on_view']:>6,}")
    print(f"  ...with a confident year       {stats['dated']:>6,}")
    print(f"  ...with a named artist         {stats['named_artist']:>6,}")
    if dropped:
        print(f"  ...minus {dropped} duplicate(s)")
    print(f"  playable pool                  {stats['kept']:>6,}")

    years = [w["year"] for w in pool]
    artist_count = len({w["artist"] for w in pool})
    print(f"\n  {artist_count} distinct artists, {min(years)}–{max(years)}")

    os.makedirs(DATA, exist_ok=True)
    os.makedirs(DOCS, exist_ok=True)

    json_path = os.path.join(DATA, "paintings.json")
    with open(json_path, "w", encoding="utf-8") as fh:
        json.dump(pool, fh, indent=2, ensure_ascii=False)
        fh.write("\n")

    js_path = os.path.join(DOCS, "data.js")
    with open(js_path, "w", encoding="utf-8") as fh:
        fh.write("// Generated by fetch_data.py — do not edit by hand.\n")
        fh.write("// MoMA paintings currently on view, with an image and a known year.\n")
        fh.write("const PAINTINGS = ")
        json.dump(pool, fh, ensure_ascii=False, separators=(",", ":"))
        fh.write(";\n")

    print(f"\nWrote {json_path} and {js_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
