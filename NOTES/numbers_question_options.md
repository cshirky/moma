# MoMA by the Numbers: more question options

Thirty-six candidate questions to add to or rotate through the quiz, written
2026-11-19. Each one is marked by where its answer would come from:

- **Now:** answerable from the collection CSVs already in `raw/`. Answers
  below are from the August 29, 2026 snapshot, and could go straight into
  `build_numbers()` in `fetch_data.py`.
- **New data:** needs a dataset the pipeline doesn't download yet, though one
  is public. Mostly MoMA's exhibition history.
- **Outside source:** facts about the museum itself, which no dataset covers.
  They would be written by hand, with a citation, and checked once a year,
  because a refresh can't update them. Answers marked *to source* need to be
  looked up. Don't fill them in from memory.

No question involves dollar figures: no prices, budgets, admission, sales or
values. Keep it that way when adding more.

## Answerable now, from the collection data

| # | Question | Answer | Notes and possible facts for wrong options |
|---|----------|--------|--------------------------------------|
| 1 | Works by Louise Bourgeois, the most-collected woman artist | 3,336 | Only Mies van der Rohe and Eugène Atget have more |
| 2 | Paintings by Vincent van Gogh in the collection | 3 | He has 6 works in all; *The Starry Night* is one. Good for a low-number surprise |
| 3 | Works by Claude Monet | 4 | Pairs well with Q2: famous names, tiny counts |
| 4 | Works by Henri Matisse | 1,067 | Most of them prints and illustrated books, like Picasso |
| 5 | Works by Andy Warhol | 278 | Possible fact: Cindy Sherman has 104, Yoko Ono 93 |
| 6 | Share of paintings that are oil on canvas | 43% (1,063 of 2,453) | The next most common is acrylic on canvas, at just 75 |
| 7 | Share of the collection with a photograph online | 59% (95,151 of 160,705) | |
| 8 | Year of the newest work in the collection | 2026 | Changes with every acquisition, so it's always fresh |
| 9 | Works made in 1929, the year MoMA opened | 1,039 | |
| 10 | Works acquired in the last ten years (2016–2025) | 16,474 | |
| 11 | Share of works that came in as gifts | 59% (94,172) | Purchases are about 7% by credit line. Phrase as a share, never as money |
| 12 | Galleries with something on view right now | 70 | Possible fact: Floors 4 and 5 hold 980 of the 1,248 works on view |
| 13 | Works by Picasso on view right now | 26 | Rotates with the hang, so it updates on each refresh |
| 14 | Works with "chair" in the title | 1,057 | Architecture & Design is full of them |
| 15 | Width of the widest painting | 46.6 m | Jennifer Bartlett's *Rhapsody*. Fact: Rosenquist's *F-111* is 26 m |
| 16 | Size of the smallest painting | 7 × 5.8 cm | Richard Pettibone's *Andy Warhol, "Jackie," 1964*, a tiny copy of a Warhol |
| 17 | Weight of the heaviest work not by Richard Serra | 4 tonnes | Tony Smith's *Moondog*. Fact: Barnett Newman's *Broken Obelisk* is 3.6 tonnes |
| 18 | Birth year of the earliest-born artist in the collection | 1181 | **Trick:** St. Francis of Assisi, credited for a text in a 1928 illustrated book. The earliest-born maker of an actual object is Josiah Wedgwood, 1730 |
| 19 | Share of artists with a known birth year who are still living | about half (6,567 of 12,464) | The CSV marks living artists with an end year of 0. Check that it doesn't also mean "unknown" before using this |
| 20 | Women's share of the paintings in the collection | 14% (347 of 2,453) | Compare with women's 20% of all artists, already in the quiz |
| 21 | The second most common nationality among the artists | German (1,000) | A choice question: American, German, French, British. French and British tie at 876 |
| 22 | Curatorial departments in the collection data | 8 | Close to the real number, but the CSV's departments aren't exactly MoMA's current curatorial departments, so phrase it as "in the data" or use an outside source |
| 23 | Floors with works on view | 6 | Floor 4 has the most (491) and Floor 1 the fewest (21) |
| 24 | Works by Jackson Pollock | 89 | |

Two that look answerable but aren't:

- **Films and video games.** The CSV lists only 153 works classed as Film and 4
  as Software, but MoMA's film collection is far larger and catalogued
  separately, and it collects more video games than four. Counting films or
  games needs an outside source (row 31).
- **Longest running time.** `Duration (sec.)` has obvious errors (one film is
  listed at 73 days), so leave running times alone unless the values are
  checked by hand.

## Needs new data: MoMA's exhibition history

MoMA publishes its exhibition history at
https://github.com/MuseumofModernArt/exhibitions (exhibitions, with the
artists and staff involved in each). Check the years it covers before using
it. The exhibitions catalogued there run from the museum's opening up to a
cutoff, so a "total ever" question would need moma.org for the years after it.

| # | Question | Answer | Notes |
|---|----------|--------|-------|
| 25 | Total exhibitions MoMA has held | *from the dataset, plus moma.org for later years* | The headline museum question |
| 26 | The year with the most exhibitions | *from the dataset* | |
| 27 | The artist in the most MoMA exhibitions | *from the dataset* | A choice question: probably Picasso, but let the data say |
| 28 | Exhibitions in MoMA's first year | *from the dataset* | |
| 29 | Women's share of artists in MoMA's exhibitions, decade by decade | *from the dataset* | Better as a fact than a question: "in the 1940s it was N%" |

## Needs an outside source: the museum itself

| # | Question | Answer | Notes |
|---|----------|--------|-------|
| 30 | Branch museums MoMA operates outside New York City | **0** | **Trick question.** MoMA PS1 in Queens is an affiliate, so the wording has to say "outside New York City", or the answer becomes arguable. The fact for wrong options could name PS1 |
| 31 | Films in MoMA's film collection | *to source* | moma.org's film department page. Also gives the scale the CSV misses |
| 32 | Video games MoMA has collected | *to source* | moma.org. Options could tease: "4" is what the CSV says |
| 33 | Total square feet of gallery space after the 2019 expansion | *to source* | Square feet or square metres, but pick one and say which |
| 34 | Women who founded MoMA in 1929 | 3 | Abby Aldrich Rockefeller, Lillie P. Bliss and Mary Quinn Sullivan. Confirm against moma.org's history page |
| 35 | Directors MoMA has had since Alfred H. Barr Jr. | *to source* | moma.org history |
| 36 | Visitors in a typical year | *to source* | Use a pre- or post-pandemic year, and say which |

More of this kind, if the outside-source set grows: curators on staff (the
question dropped from the first twelve), items in the library and archives,
films screened a year, how long the museum closed for the 2019 expansion,
how many times it has moved since opening in a rented office suite.

## Choosing questions

- **Prefer "Now" questions.** They stay true by themselves and get facts for
  free from `place_facts()`.
- **Keep the answer-position balance.** Any new question has to keep the
  smallest and largest options each right about a fifth of the time;
  `test_game.py` enforces this.
- **Rotation.** With 36 more, the quiz could draw 12 from a larger pool each
  play, keeping the balance within each draw rather than across a fixed
  twelve.
