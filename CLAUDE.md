# Chronology — MoMA

A static drag-and-drop game: put MoMA paintings in the order they were made,
newest at the top of the column, oldest at the bottom. Each stage deals its
paintings straight into the column in a deliberately wrong order, so the task
is pure reordering — there is no tray or staging area. Five stages, each
harder than the last. Served straight from `docs/`, no build step — plain
`<script>` tags load everything.

Two more games sit beside it, linked from a menu across the top of every
page: **Same Year** (`sameyear.html`) and **Close Up** (`closeup.html`). See
"The other games" below.

Sibling project to `../museum_flashcards` (Studio Museum in Harlem); the
palette and the "generated data as a `.js` file" pattern come from there.

## Deploying

- **Live:** https://cshirky.github.io/moma/
- **Repo:** https://github.com/cshirky/moma (public; Pages serves `main` → `/docs`)

`git push` to `main` is the whole deploy step — Pages rebuilds within a
minute or two. There is no build step of any kind. Run `python3 test_game.py`
before pushing; it drives the real app in Chromium and is the only thing
standing between a bad change and the public URL.

For local work, serve `docs/` on any static server
(`python3 -m http.server 8765` from inside `docs/`) — the game is plain
files, so a refresh picks up every edit.

Two things about this machine that are invisible until they bite:

- **An invalid `GH_TOKEN` environment variable shadows the working keyring
  login.** It breaks `gh` ("the token in GH_TOKEN is invalid") *and* `git
  push`, which fails with "Invalid username or token. Password authentication
  is not supported" because the gh credential helper reads the same variable.
  Prefix either with `env -u GH_TOKEN`: `env -u GH_TOKEN git push origin
  main`.
- **Commits here are authored `cshirky <cshirky@penguin>`**, matching
  `museum_flashcards`, to keep a personal email out of public commit history.
  The repo's local git identity is set to this, so it holds by default —
  don't override it with `-c user.email`, and don't reintroduce the address
  when copying commands between projects. History was rewritten once before
  the first push to remove it; doing that after people have cloned is much
  worse than getting it right up front.

## Architecture

- `docs/index.html` — the three screens (start / play / results), all in one
  file. `app.js` only toggles `hidden` between them.
- `docs/app.js` — all game logic. The `STAGES` constant at the top is the
  difficulty ladder; it is the one place to change how the game escalates.
- `docs/style.css` — all styling. `--n` (paintings in the current stage) is
  set on `#screen-play` by `app.js` and drives the row height calculation.
- `docs/data.js` — generated. `const PAINTINGS = [...]`. Mirrored in
  pretty-printed form at `data/paintings.json` for inspection and diffing.
  Don't hand-edit either; regenerate with `fetch_data.py`.
- `docs/sameyear.html` + `sameyear.js`, `docs/closeup.html` + `closeup.js`
  — the two newer games, one page each.
- `docs/common.js` — helpers and the pointer-drag routine shared by the two
  newer games. Never load it on `index.html`: `app.js` predates it, keeps
  its own copies, and the names would collide.
- `docs/styles.js` — `const STYLES = {id: "abstract" | "representational"}`,
  **hand-made**, unlike `data.js`. See "The other games".
- `fetch_data.py` — the pipeline. Downloads MoMA's public collection CSVs,
  filters to the playable pool, and writes both data files.
- `test_game.py` — end-to-end Playwright test. Run it after any change to
  `app.js` or `style.css`.
- `raw/` — cached source CSVs, gitignored (`Artworks.csv` is ~73 MB).

## The data

MoMA publishes its collection at `MuseumofModernArt/collection` on GitHub,
under **Git LFS** — so the CSVs must be fetched from
`media.githubusercontent.com/media/...`, not `raw.githubusercontent.com`,
which returns an LFS pointer stub instead of the file.

`fetch_data.py` narrows ~160,000 artworks to the ~276 that the game can
actually use, and prints the funnel each run:

- `Classification == "Painting"`
- has an `ImageURL` (MoMA hotlinks fine; images are ~1024 px)
- has a non-empty `OnView` — **only works currently hanging at MoMA**, which
  is what makes the reveal able to name the gallery ("MoMA, Floor 5, 501")
- has a year `parse_year` will vouch for — `Date` is free text, so `"1940-41"`
  resolves to its completion year while `"n.d."`, `"1960s"`, and anything
  spanning over 30 years are dropped rather than guessed at
- has a named artist — anonymous attributions are excluded because two of
  them would collide under the "all different artists" rule

Because `OnView` reflects MoMA's rotation, **the pool goes stale**. Re-run
`python3 fetch_data.py --refresh` to pick up a new hang; expect the count to
move and some paintings to drop out.

Two data quirks the pipeline handles, worth knowing if you touch `clean()`:
`OnView` values arrive wrapped in literal quote characters, and a few titles
carry inline HTML (`Untitled <em>from the series</em> Hourglasses`).

MoMA's servers 403 requests from `python-urllib`'s default user agent. Real
browsers are fine, so this only bites scripted image checks — send a browser
UA if you write one.

## Difficulty ladder

Stage N draws `n` paintings by `n` different artists whose years are all at
least `gap` apart. Loosening the gap is what makes later stages hard: 15
years apart is usually legible from style alone, 2 years is not.

| Stage | Paintings | Min gap |
|-------|-----------|---------|
| 1 | 3 | 25 years |
| 2 | 4 | 20 years |
| 3 | 5 | 15 years |
| 4 | 6 | 10 years |
| 5 | 7 | 5 years  |

Every row was simulated against the real pool before being fixed, and
`test_game.py` re-checks 1,000 live draws against these rules. If you change
the ladder, re-run the test — a pool this small can make an aggressive row
unsatisfiable, and `drawStage` will quietly fall back to a relaxed gap.

## Scoring

A stage is scored two ways, because exact-position marking is wrong for an
ordering task — it is not merely harsh but *inconsistent*. Dragging the newest
painting to the bottom scores 0 of 5 despite being one drag from correct,
while swapping the two end paintings scores 3 of 5 despite being twice as far
off and getting only 30% of the before/after calls right.

- **Moves from correct** (`keepSet()`) is the headline. It is `n` minus the
  largest group of paintings already in the right order relative to each
  other, which is provably the minimum number of drags needed. It also tells
  the reveal what to mark: the keepers get a tick, everything else gets the
  position it belongs in. `n` is at most 7, so every subset is checked;
  ties break toward keeping paintings that are also in their exact final
  position, which is what a player reads as "already right".
- **Before-and-after calls** (`pairScore()`) is the run total, shown on the
  results screen. It is the task exactly as the game describes it to the
  player, and it scales as stages grow: the five stages hold
  3+6+10+15+21 = **55 pairs**.

A stage's outcome is one of solved / one move away / further off, decided in
`outcome()`. The stage pips, the verdict headline and the results scorecard
all colour themselves from it, so they can't drift apart — green, amber, red.
The current stage's pip is a *hollow* amber outline rather than filled, which
is what keeps "you are here" from colliding with "one move away". The
scorecard badge carries the move count itself (✓, or 1, or 5).

`test_game.py` pins both metrics against hand-worked cases, including the
one-drag-from-correct board that the old rule scored zero on, and checks that
amber and red land on the right stages. Keep those cases passing if you touch
the scoring.

## The final score

The results screen scores the run out of **20** — `MAX_SCORE`, derived from
`STAGES` as the sum of `n-1`, because the worst a stage can go is getting it
exactly backwards. Score is `20 - total moves`, banded in `BANDS`.

| Score | Band |
|-------|------|
| 20 | Perfect |
| 19–18 | Excellent |
| 17–16 | Very Good |
| 15–14 | Good |
| 13–12 | OK |
| 11–9 | Nearly Random |
| 8 and below | Worse than Random |

**18 is a real threshold, not a round number.** Scoring 18 or more is only
reachable with at least three stages solved outright, because three imperfect
stages cost at least three moves between them. `test_game.py` proves this by
walking every possible move-split rather than trusting the argument.

**The 9 floor sits on the random median, which is why it's "Nearly Random".**
Measured random play averages **8.8 of 20**, median 9 over 200,000 simulated
runs, so 57% of random runs land in that band or above. It was once labelled
"Better than Random", which told those runs they'd beaten chance; the label
was changed rather than the floor. Only 4.4% of random runs reach 12, so OK
and above genuinely means better than guessing.

**Pairwise counts are computed but never shown.** `pairScore()` still runs
and its numbers are stored on each result, but n-squared pair maths doesn't
read intuitively, so every user-facing string is phrased in moves. Don't
reintroduce "before-and-after calls" into the interface.

Worth knowing if you revisit the metrics: weighting a move by how far it
travels does **not** give a new measure — the minimum distance-weighted cost
to sort equals the inversion count exactly, verified over every arrangement
up to n=7. So "moves" and "before-and-after calls" are already the unweighted
and weighted versions of the same idea, and there is no third metric to add.

## The closing painting list

All 25 paintings from the run, merged out of their stages into one timeline,
**newest first**, the same way round as the board. The list renders in full
with no inner scroll box: an earlier version capped it at 420px, which showed
7 of 25 and read as "only six paintings showed up". Let the page scroll
instead. Each row has a checkbox; ticking any and pressing **Make my map**
produces a route grouped by floor, highest floor first, because MoMA hangs
the collection chronologically from the top down.

**Nothing is emailed.** The site is static with no backend, so "send me a
map" is honoured as an on-screen route plus a print button (`@media print`
hides everything but the route). Adding real email delivery would mean adding
a server, which this project does not have.

## Ending a stage

**Submit is the only way to end a stage.** `finishStage()` scores the
arrangement and marks each painting — a tick if it's already in the right
relative order, or the position it belongs in. A misplaced painting is also
ringed in red across **half** its frame, on the side it has to travel
towards: top half means it belongs higher up the column, bottom half means
lower down. That half-ring is a clipped `::after` overlay, not
`border-top`/`border-bottom`, because CSS borders are per-side and can't
render half of the left and right edges.

Afterwards, a stage that came out wrong offers **Show the order**, which
calls `showCorrectOrder()`: the column re-sorts into the true sequence, the
marks and half-rings come off, slots get a neutral frame, and the headline
isn't red — being shown the answer is not a wrong answer. The stage is
already scored by then, so this only ever changes what is displayed.

There was once a second button, "See the right order", offered *during* play.
It was dropped because it did nothing Submit didn't: it scored whatever was
on the board and then revealed, so it was Submit and Show the order behind a
different label, a minute apart and nearly identically worded. Don't
reintroduce a give-up button unless it does something genuinely different —
forfeiting the stage at maximum moves, say.

Nothing on a finished stage may tell the player to do something they can't:
the board is locked, so the copy explains the ring and offers the answer
rather than saying "move the marked paintings".

Either way **the score comes from the arrangement the player actually built**,
captured before the column is re-sorted, so asking for the answer costs
exactly what it should. The result records `shown: true` and the results
scorecard says "answer shown".

## Interaction

Each input has exactly one meaning, so nothing competes:

- **drag** a painting — reorders, funnelled through `moveTo()`
- **click** a painting — opens it larger in the lightbox
- **in the lightbox**, the painting zooms and pans: click it to zoom in on
  that spot (or back out), scroll or pinch to zoom, drag to pan, `+`/`-`/`0`
  and arrow keys too. Any click *off* the painting — backdrop, caption —
  dismisses it, as does Escape
- **arrow keys** on a focused painting — moves it one place up or down
- **Enter/Space** on a focused painting — opens the lightbox

Any new input path should call `moveTo()` rather than touch `state.order`.
Moving is insert-and-shift, not swap: lifting a painting out and re-inserting
it shifts everything between, which is how people expect "put this one above
that one" to behave.

Enlarging has always been click-driven, never hover. The `⤢` affordance is
therefore **always visible**, not revealed on hover: a hover-only cue never
appears on a touch screen at all, and on a desktop it made the feature look
like a rollover.

The enlarged painting is sized in `fitLightbox()` to 95% of the screen's
width or height, whichever keeps all of it in view, so the caption and the
zoom/close buttons float over it; the caption fades out while zoomed. MoMA's
images are at most 1024px and their URLs are signed (asking for a bigger
size returns 400), so zoom magnifies the pixels there are — it can't fetch
finer detail.

The lightbox deliberately shows **no caption before the stage is submitted** —
the title and date are the answer. After submitting it shows the full record
and a link to moma.org. Dragging is disabled once a stage is answered, but
clicking to enlarge stays live (`drag.noDrag`), because that is exactly when
people want a closer look.

Two layout rules that look arbitrary but aren't: a painting is limited by its
row's *height*, so extra row width is dead space — row width is derived from
`--slot-h` and only widens at the reveal, when there are words to put beside
the picture. And `[hidden] { display: none !important; }` is load-bearing: the
lightbox sets `display: flex`, which otherwise beats the `hidden` attribute and
leaves an invisible overlay swallowing every click on the page.

## The other games

The menu (`.game-nav`) is plain HTML repeated in each page's markup, with
`aria-current="page"` on the current game. Adding a game means adding a link
to all three.

### Same Year

Five rows, one per year, newest at the top like Chronology. Each year has
one abstract and one representational painting; each column is dealt so no
painting starts in its own row, and the player drags paintings within a
column to line them up with the years. Dropping on another row **swaps** the
two (not insert-and-shift as in Chronology), because the rows are fixed
slots. Abstract paintings can't cross into the representational column.
Scored as paintings in the right row, out of 10.

The abstract/representational split comes from `docs/styles.js`, labelled
by eye from contact sheets of every painting: 96 abstract, 85
representational, and 95 left out on purpose because they sit between the
two (analytic cubism, futurism, much surrealism, text paintings, a few
objects). Only unambiguous pairs reach the game. That leaves 27 years with
at least one pair, and `test_game.py` requires at least 15. **A data
refresh doesn't update the labels**: new paintings are simply left out until
someone labels them, and paintings that rotate off view drop out of pairs.
Re-check the year count after `fetch_data.py --refresh`.

While labelling, a few records turned out not to be paintings at all — an
installation view, a gallery photo with escalators, a box. They're
unlabelled, so Same Year never shows them, but Chronology and Close Up can.

### Close Up

Four paintings by four artists, each showing only one section, and four
labels (title, artist, year) to drag onto them. A press with no travel picks
a label up and a second click puts it down, which gives keyboard and touch
users a path that isn't dragging.

Clicking a painting coarsens its grid and costs a point:
`LEVELS = 8x4, 6x4, 4x4, 4x3, 3x3, 3x2, 2x2, 2x1, whole`, written as
[long side, short side], so a portrait painting starts as 8 rows by 4
columns and a landscape one as 4 by 8. Each bigger section is centred on the
first one, clamped to the edges, rather than snapped to the new grid, so a
click always widens the same view.

**Scoring**: each painting is worth 8, one per click it could still take; a
right label keeps what's left, a wrong label scores 0. The maximum is 32:
all four right from the first section.

The first section is drawn from the busier half of the grid (`busyCells()`,
summed neighbour-pixel differences), so it's never a patch of bare canvas.
That reads pixels back from a canvas, which works only because moma.org
sends `Access-Control-Allow-Origin: *`; the images are loaded with
`crossOrigin = "anonymous"` for it. If that header ever goes away, the
first section falls back to any cell. Very long, thin paintings (aspect
over 2.5) are left out, since their sections are too slender to read.

