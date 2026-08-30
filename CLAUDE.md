# Chronology — MoMA

A static drag-and-drop game: put MoMA paintings in the order they were made,
newest at the top of the column, oldest at the bottom. Five stages, each
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
| 1 | 3 | 15 years |
| 2 | 4 | 10 years |
| 3 | 5 | 6 years  |
| 4 | 6 | 4 years  |
| 5 | 7 | 2 years  |

Every row was simulated against the real pool before being fixed, and
`test_game.py` re-checks 1,000 live draws against these rules. If you change
the ladder, re-run the test — a pool this small can make an aggressive row
unsatisfiable, and `drawStage` will quietly fall back to a relaxed gap.

## Interaction

Placement has three input paths, all funnelled through `moveCard()` so they
can't drift apart: pointer drag (mouse and touch), click-to-pick-up then
click-to-place, and keyboard (slots are focusable, Enter/Space places). Any
new input path should call `moveCard()` too. Dropping onto an occupied slot
swaps rather than displaces to the tray.
