#!/usr/bin/env python3
"""Build the Chronology game's dataset from MoMA's public collection data.

MoMA publishes its collection as CSVs in the MuseumofModernArt/collection
repo on GitHub, stored via Git LFS (so they must be fetched from the
media.githubusercontent.com endpoint, not raw.githubusercontent.com).

The game needs paintings that are (a) currently on view at MoMA, (b) have a
usable image, and (c) have a single confidently-parseable year, since the
whole point is ordering works in time. This script applies those filters and
writes docs/data.js (loaded by a plain <script> tag) plus a pretty-printed
data/paintings.json for inspection and diffing. It also writes the questions
for MoMA by the numbers to docs/numbers_data.js and data/numbers.json, worked
out from the whole collection, so the quiz stays true after a refresh.

Usage:
    python3 fetch_data.py           # use cached CSVs in raw/ if present
    python3 fetch_data.py --refresh # re-download the CSVs first
    python3 fetch_data.py --artists # also write NOTES/moma_artists.md
    python3 fetch_data.py --works   # also write NOTES/moma_works.md

--artists and --works write browsable Markdown tables of the whole
collection (every constituent, every artwork), not just the playable pool.
They don't affect the game data.
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
NOTES = os.path.join(HERE, "NOTES")
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


def md(value):
    """Make a field safe to put in a Markdown table cell."""
    return clean(value).replace("\\", "\\\\").replace("|", "\\|")


def year_cell(value):
    """MoMA writes an unknown begin/end year as 0; show it as blank."""
    s = (value or "").strip()
    return "" if s in ("", "0") else s


def snapshot_date():
    """The date the cached Artworks.csv was downloaded."""
    from datetime import date
    return date.fromtimestamp(os.path.getmtime(os.path.join(RAW, "Artworks.csv"))).isoformat()


def constituent_ids(raw):
    return {c.strip() for c in (raw or "").split(",") if c.strip()}


def write_artists(artworks, artists):
    """Write moma_artists.md: every constituent, with work and painting counts."""
    from collections import Counter
    works, paintings = Counter(), Counter()
    for r in artworks:
        for cid in constituent_ids(r.get("ConstituentID")):
            works[cid] += 1
            if r.get("Classification") == "Painting":
                paintings[cid] += 1

    rows = sorted(artists, key=lambda a: clean(a["DisplayName"]).casefold())
    lines = [
        "# Artists in the MoMA collection",
        "",
        f"Every constituent in MoMA's public `Artists.csv` (snapshot of {snapshot_date()}), "
        f"{len(rows):,} entries, sorted by name. MoMA's list counts everyone credited on a work, "
        "so it includes architects, designers, photographers and companies as well as artists. "
        "Works and paintings are counted from `Artworks.csv`; a blank date means MoMA has none.",
        "",
        f"- {sum(1 for a in rows if works[a['ConstituentID']]):,} have at least one work in `Artworks.csv`",
        f"- {sum(1 for a in rows if paintings[a['ConstituentID']]):,} have at least one painting",
        "",
        "Generated by `python3 fetch_data.py --artists` — do not edit by hand.",
        "",
        "| Name | Nationality | Born | Died | Gender | Works | Paintings |",
        "|---|---|---|---|---|--:|--:|",
    ]
    for a in rows:
        cid = a["ConstituentID"]
        lines.append(f"| {md(a['DisplayName'])} | {md(a['Nationality'])} | "
                     f"{year_cell(a['BeginDate'])} | {year_cell(a['EndDate'])} | "
                     f"{md(a['Gender'])} | {works[cid] or ''} | {paintings[cid] or ''} |")
    os.makedirs(NOTES, exist_ok=True)
    path = os.path.join(NOTES, "moma_artists.md")
    with open(path, "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines) + "\n")
    print(f"Wrote {path} ({len(rows):,} artists)")


def write_works(artworks):
    """Write moma_works.md: every artwork, sorted by artist, then date."""
    rows = sorted(artworks, key=lambda r: (not clean(r.get("Artist")),
                                           clean(r.get("Artist")).casefold(),
                                           parse_year(r.get("Date")) or 9999,
                                           clean(r.get("Title")).casefold()))
    on_view = sum(1 for r in rows if clean(r.get("OnView")))
    lines = [
        "# Works in the MoMA collection",
        "",
        f"Every record in MoMA's public `Artworks.csv` (snapshot of {snapshot_date()}), "
        f"{len(rows):,} works, sorted by artist and then date (works with no artist come last). Titles link to moma.org "
        f"where MoMA gives a page. {on_view:,} were on view at the time of the snapshot.",
        "",
        "Generated by `python3 fetch_data.py --works` — do not edit by hand.",
        "",
        "| Artist | Title | Date | Classification | Department | On view | Accession |",
        "|---|---|---|---|---|---|---|",
    ]
    for r in rows:
        title = md(r.get("Title")) or "Untitled"
        url = clean(r.get("URL"))
        if url:
            label = title.replace("[", "\\[").replace("]", "\\]")
            title = f"[{label}]({url})"
        lines.append(f"| {md(r.get('Artist'))} | {title} | {md(r.get('Date'))} | "
                     f"{md(r.get('Classification'))} | {md(r.get('Department'))} | "
                     f"{md(r.get('OnView'))} | {md(r.get('AccessionNumber'))} |")
    os.makedirs(NOTES, exist_ok=True)
    path = os.path.join(NOTES, "moma_works.md")
    with open(path, "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines) + "\n")
    print(f"Wrote {path} ({len(rows):,} works)")



# --- MoMA by the numbers ----------------------------------------------------
# Every answer is computed from the CSVs, and so are the wrong options, as
# multiples or offsets of the true figure, so a refresh can't leave an option
# list that no longer contains the right answer. Options are shown smallest
# to largest.
#
# Where the true figure sits among the four is fixed per question, and the
# twelve are balanced so the quiz undershoots as often as it overshoots: the
# smallest and largest options are each right about a fifth of the time, the
# middle two the rest. test_game.py checks the balance.
#
# After a guess, each wrong option is labelled "Too low" or "Too high" in the
# game, unless the question gives it a fact of its own here.

def num(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def sig2(x):
    """Round to two significant figures: 329,851 -> 330,000."""
    if x <= 0:
        return 0
    from math import floor, log10
    step = 10 ** (floor(log10(x)) - 1)
    return round(x / step) * step


def commas(x):
    return f"{x:,.0f}" if x >= 1 or x == 0 else f"{x:g}"


def ladder(true, mults, rounder=sig2):
    """Option values at true * m for each m; the m == 1 entry is the answer."""
    return [rounder(true * m) for m in mults], mults.index(1)


def place_facts(values, answer, candidates, max_ratio=None):
    """Hang each (value, text) fact on the nearest wrong option still free.

    Returns a list parallel to values: a fact string, or None for the game's
    default "Too low" / "Too high". With max_ratio, a fact only lands on an
    option within that factor of its value, so it stays relevant.
    """
    facts = [None] * len(values)
    for v, text in candidates:
        free = [i for i in range(len(values)) if i != answer and facts[i] is None]
        if max_ratio:
            free = [i for i in free
                    if max(values[i], v) / max(min(values[i], v), 1e-9) <= max_ratio]
        if free:
            facts[min(free, key=lambda i: abs(values[i] - v))] = text
    return facts


def work_ref(r):
    """The image and link to show beside an answer about one work."""
    return {"image": clean(r.get("ImageURL")), "url": clean(r.get("URL")),
            "caption": f"{clean(r.get('Artist'))}, {clean(r.get('Title'))}, {clean(r.get('Date'))}"}


def build_numbers(artworks, artists):
    from collections import Counter
    qs = []

    def add(qid, question, options, answer, note, facts=None, low="Too low", high="Too high",
            ref=None):
        assert len(options) == 4 and len(set(options)) == 4, (qid, options)
        q = {"id": qid, "question": question, "options": options, "answer": answer,
             "facts": facts or [None] * 4, "low": low, "high": high, "note": note}
        if ref and ref["image"]:
            q.update(ref)
        qs.append(q)

    named = [r for r in artworks if clean(r.get("Artist"))]
    by_artist = Counter(clean(r.get("Artist")) for r in named)
    paintings = [r for r in artworks if clean(r.get("Classification")) == "Painting"]
    total = len(artworks)

    # 1. Richard Serra's weight
    serra = [r for r in artworks if clean(r.get("Artist")) == "Richard Serra"]
    weighed = [(num(r.get("Weight (kg)")), r) for r in serra if num(r.get("Weight (kg)"))]
    tonnes = sum(w for w, _ in weighed) / 1000
    heavy_kg, heavy = max(weighed, key=lambda p: p[0])
    vals, ans = ladder(tonnes, [0.1, 0.33, 1, 3.3])
    add("serra-weight", "Total recorded weight of Richard Serra's works at MoMA",
        [f"{commas(v)} tonnes" for v in vals], ans,
        f"About {tonnes:,.0f} tonnes, but only {len(weighed)} of his {len(serra)} works have a "
        f"recorded weight.",
        place_facts(vals, ans, [(heavy_kg / 1000,
            f"Too low: {clean(heavy.get('Title'))} alone weighs {heavy_kg / 1000:,.0f} tonnes.")]),
        ref=work_ref(heavy))

    # 2. the oldest dated work
    dated = [(parse_year(r.get("Date")), r) for r in artworks]
    dated = [(y, r) for y, r in dated if y]
    oldest_year = min(y for y, _ in dated)
    oldest = [r for y, r in dated if y == oldest_year]
    makers = sorted({clean(r.get("Artist")) for r in oldest})
    firsts = []
    for cls, label in [("Painting", "painting"), ("Drawing", "drawing"),
                       ("Illustrated Book", "illustrated book"), ("Sculpture", "sculpture")]:
        y, r = min(((y, r) for y, r in dated if clean(r.get("Classification")) == cls),
                   key=lambda p: p[0])
        firsts.append((y, f"Too late. The oldest {label} dates from {y}, "
                          f"by {clean(r.get('Artist'))}."))
    vals = [oldest_year + d for d in (0, 40, 80, 120)]
    add("oldest", "The year the oldest dated work in the collection was made",
        [str(v) for v in vals], 0,
        f"{oldest_year}. The oldest dated works are {len(oldest)} pieces by "
        f"{' and '.join(makers)}, including {clean(oldest[0].get('Title'))}.",
        place_facts(vals, 0, firsts), low="Too early", high="Too late",
        ref=work_ref(oldest[0]))

    # 3. size of the collection
    depts = Counter(clean(r.get("Department")) for r in artworks)
    dept, dept_n = depts.most_common(1)[0]
    vals, ans = ladder(total, [0.37, 1, 3.7, 10])
    add("total-works", "Works in MoMA's public collection data", [commas(v) for v in vals], ans,
        f"{total:,} works, from paintings and films to chairs, posters and architectural drawings.",
        place_facts(vals, ans, [(dept_n, f"Too low: {dept} alone holds {dept_n:,}.")], max_ratio=2))

    # 4. the artist with the most works. Not a number, so every wrong option
    # gets its own count instead of a direction.
    real = [(a, n) for a, n in by_artist.most_common(10)
            if not re.search(r"unidentified|unknown|various", a, re.I)]
    top, top_n = real[0]
    cast = [a for a, _ in real[:3]]
    cast.append("Pablo Picasso" if "Pablo Picasso" not in cast else real[3][0])
    cast.sort(key=lambda a: a.split()[-1])
    in_archive = sum(1 for r in artworks if clean(r.get("Artist")) == top
                     and clean(r.get("Classification")) == "Mies van der Rohe Archive")
    extra = (f" {in_archive:,} of them are in the Mies van der Rohe Archive, the drawings"
             f" and papers he gave the museum." if in_archive else "")
    add("top-artist", "The artist with the most works in the collection", cast, cast.index(top),
        f"{top}, with {top_n:,} works.{extra}",
        [None if a == top else f"{by_artist[a]:,} works" for a in cast])

    # 5. "Untitled"
    untitled = sum(1 for r in artworks if clean(r.get("Title")) == "Untitled")
    starts = sum(1 for r in artworks if clean(r.get("Title")).lower().startswith("untitled"))
    vals, ans = ladder(untitled, [0.03, 0.1, 0.35, 1])
    add("untitled", 'Works titled exactly "Untitled"', [commas(v) for v in vals], ans,
        f"{untitled:,}. Counting titles that start with it, such as "
        f'"Untitled (Blue)", there are {starts:,}.')

    # 6. Picasso's paintings, with his total across every medium as the trap
    picasso = [r for r in artworks if clean(r.get("Artist")) == "Pablo Picasso"]
    p_paint = sum(1 for r in picasso if clean(r.get("Classification")) == "Painting")
    kinds = Counter(clean(r.get("Classification")) for r in picasso).most_common(2)
    vals = sorted({sig2(p_paint * 0.22), p_paint, sig2(p_paint * 2.5), sig2(len(picasso))})
    ans = vals.index(p_paint)
    add("picasso-paintings", "Paintings by Picasso in the collection",
        [commas(v) for v in vals], ans,
        f"{p_paint} paintings, out of {len(picasso):,} works by Picasso in all.",
        place_facts(vals, ans, [(len(picasso),
            f"That's every work by Picasso, {len(picasso):,} of them, including "
            f"{kinds[0][1]:,} {kinds[0][0].lower()}s and {kinds[1][1]:,} {kinds[1][0].lower()}s.")]))

    # 7. the tallest painting, and the runner-up as a fact
    tall = sorted(((num(r.get("Height (cm)")), r) for r in paintings if num(r.get("Height (cm)"))),
                  key=lambda p: p[0], reverse=True)
    (tall_cm, tallest), (next_cm, runner) = tall[0], tall[1]
    vals, ans = ladder(tall_cm / 100, [0.5, 1, 2, 4], rounder=round)
    add("tallest", "Height of the tallest painting", [f"{v} m" for v in vals], ans,
        f"{tall_cm:,.0f} cm: {clean(tallest.get('Artist'))}'s {clean(tallest.get('Title'))}.",
        place_facts(vals, ans, [(next_cm / 100,
            f"Too low, but the runner-up is close: {clean(runner.get('Artist'))}'s "
            f"{clean(runner.get('Title'))}, {next_cm / 100:.1f} m.")], max_ratio=1.5),
        ref=work_ref(tallest))

    # 8. women among the artists
    genders = Counter(clean(a.get("Gender")).strip("()").lower() for a in artists)
    recorded = sum(n for g, n in genders.items() if g)
    women = genders.get("female", 0)
    pct = round(100 * women / recorded)
    vals = [pct + d for d in (-15, 0, 15, 30)]
    add("women", "Women's share of the artists whose gender is recorded",
        [f"{v}%" for v in vals], 1,
        f"{pct}%: {women:,} women out of {recorded:,} artists with a recorded gender. "
        f"Another {genders.get('', 0):,} artists have none recorded.")

    # 9. the biggest year for acquisitions. Every wrong year gets its count.
    acq = Counter(clean(r.get("DateAcquired"))[:4] for r in artworks
                  if clean(r.get("DateAcquired"))[:4].isdigit())
    busiest, busiest_n = acq.most_common(1)[0]
    first = min(acq)
    years = {first, busiest}
    for y, _ in acq.most_common():
        if len(years) == 4:
            break
        years.add(y)
    years = sorted(years)
    add("acquired", "The year MoMA acquired the most works", years, years.index(busiest),
        f"{busiest}, with {busiest_n:,} works. The earliest acquisitions date from {first}, "
        f"the year the museum opened.",
        [None if y == busiest else
         (f"Just {acq[y]:,} works, in the museum's first year." if y == first
          else f"{acq[y]:,} works acquired.") for y in years])

    # 10. how much is on view, with the share for paintings as a fact
    on_view = sum(1 for r in artworks if clean(r.get("OnView")))
    share = round(100 * on_view / total, 1)
    p_view = sum(1 for r in paintings if clean(r.get("OnView")))
    p_share = 100 * p_view / len(paintings)
    vals = sorted({share, 5, 12, 25})
    ans = vals.index(share)
    add("on-view", "The share of the collection on view right now",
        [f"{v:g}%" for v in vals], ans,
        f"{share}%: {on_view:,} of {total:,} works were hanging at the time of the snapshot.",
        place_facts(vals, ans, [(p_share,
            f"Too high for the whole collection, but about right for paintings: "
            f"{p_view:,} of {len(paintings):,} are on view.")], max_ratio=1.5))

    # 11. nationalities
    nats = Counter(clean(a.get("Nationality")).strip("()") for a in artists)
    n = len(set(nats) - {"", "Nationality unknown"})
    vals = [n + d for d in (-100, -50, 0, 50)]
    add("nationalities", "Nationalities represented among the artists",
        [str(v) for v in vals], 2,
        f"{n}, not counting artists whose nationality is unknown.")

    # 12. how many artists, with the biggest nationality as a fact
    top_nat, top_nat_n = [(k, v) for k, v in nats.most_common(3) if k][0]
    vals, ans = ladder(len(artists), [0.1, 0.33, 1, 3])
    add("artists", "Artists, designers and other makers in the collection",
        [commas(v) for v in vals], ans,
        f"{len(artists):,}, counting everyone MoMA credits: painters, photographers, "
        f"architects, designers, filmmakers and firms.",
        place_facts(vals, ans, [(top_nat_n,
            f"Too low: there are {top_nat_n:,} {top_nat} artists alone.")], max_ratio=1.5))

    return qs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--refresh", action="store_true",
                    help="re-download the CSVs instead of using raw/")
    ap.add_argument("--artists", action="store_true",
                    help="also write NOTES/moma_artists.md, every artist in the collection")
    ap.add_argument("--works", action="store_true",
                    help="also write NOTES/moma_works.md, every work in the collection")
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

    numbers = build_numbers(artworks, artists)
    numbers_json = os.path.join(DATA, "numbers.json")
    with open(numbers_json, "w", encoding="utf-8") as fh:
        json.dump(numbers, fh, indent=2, ensure_ascii=False)
        fh.write("\n")
    numbers_js = os.path.join(DOCS, "numbers_data.js")
    with open(numbers_js, "w", encoding="utf-8") as fh:
        fh.write("// Generated by fetch_data.py — do not edit by hand.\n")
        fh.write("// Questions for MoMA by the numbers, worked out from the whole collection.\n")
        fh.write(f"const NUMBERS_SNAPSHOT = {json.dumps(snapshot_date())};\n")
        fh.write("const NUMBERS = ")
        json.dump(numbers, fh, ensure_ascii=False, separators=(",", ":"))
        fh.write(";\n")
    print(f"Wrote {numbers_json} and {numbers_js} ({len(numbers)} questions)")

    # data.js and numbers_data.js just changed, so their pages need new
    # fingerprints on the script tags, or browsers keep the cached copies.
    import version_assets
    version_assets.main([])
    if args.artists:
        write_artists(artworks, artists)
    if args.works:
        write_works(artworks)
    return 0


if __name__ == "__main__":
    sys.exit(main())
