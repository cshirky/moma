# Chronology — MoMA

A static drag-and-drop game: put MoMA paintings in the order they were made,
newest at the top of the column, oldest at the bottom. Each stage deals its
paintings straight into the column in a deliberately wrong order, so the task
is pure reordering — there is no tray or staging area. Five stages, each
harder than the last. Served straight from `docs/`, no build step — plain
`<script>` tags load everything.

Sibling project to `../museum_flashcards` (Studio Museum in Harlem); the
palette and the "generated data as a `.js` file" pattern come from there.

## Deploying

`git push` to `main` is the whole deploy step if this is served via GitHub
Pages from `docs/`. There is no build.

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

The top three bands carry a role title (Museum Director / Curator / Docent).
The bands are calibrated against measured random play, which averages **8.8
of 20** (median 9 over 200,000 simulated runs): random runs land in "Nearly
Random" 66% of the time, "OK" 14%, "Worse than Random" 20%. Keep that
property if you retune `BANDS` — an earlier set labelled ordinary random
play "Worse than Random" two times in three.

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

`finishStage(showAnswer)` is the single exit, used by both buttons:

- **Submit** scores the arrangement and marks each painting — a tick if it's
  already in the right relative order, or the position it belongs in. A
  misplaced painting is also ringed in red across **half** its frame, on the
  side it has to travel towards: top half means it belongs higher up the
  column, bottom half means lower down. That half-ring is a clipped `::after`
  overlay, not `border-top`/`border-bottom`, because CSS borders are per-side
  and can't render half of the left and right edges.
- **See the right order** (during play) and **Show the order** (offered after
  a stage is scored wrong) both call `showCorrectOrder()`: the column re-sorts
  into the true sequence, the marks and half-rings come off, slots get a
  neutral frame, and the headline isn't red — being shown the answer is not a
  wrong answer. `showCorrectOrder()` only ever changes what is displayed; the
  score is already recorded before it runs, so looking after submitting is
  free while giving up beforehand still costs the attempt.

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
- **arrow keys** on a focused painting — moves it one place up or down
- **Enter/Space** on a focused painting — opens the lightbox

Any new input path should call `moveTo()` rather than touch `state.order`.
Moving is insert-and-shift, not swap: lifting a painting out and re-inserting
it shifts everything between, which is how people expect "put this one above
that one" to behave.

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
