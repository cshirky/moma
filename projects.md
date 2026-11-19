# Projects

## Contents

- [Games built on MoMA data](#games-built-on-moma-data)
  - Built
    - [Chronology](#chronology)
    - [Same Year](#same-year)
    - [Close Up](#close-up)
    - [MoMA by the numbers](#moma-by-the-numbers)
  - To build
    - [Which tortured artist are you?](#which-tortured-artist-are-you)
    - [4x4](#4x4)
    - [Find the real title](#find-the-real-title) (group game)
    - [Say what you see](#say-what-you-see) (group game)
  - [What the group games need](#what-the-group-games-need)
- [Chronology as an iOS and Android app](#chronology-as-an-ios-and-android-app)
  - [Recommendation](#recommendation)
  - [The real blockers](#the-real-blockers)
  - [Changes the code would need](#changes-the-code-would-need)
  - [Tooling and accounts](#tooling-and-accounts)
  - [Testing](#testing)
  - [Rough timeline](#rough-timeline-capacitor-route-after-rights-are-settled)
  - [Ongoing cost of having an app](#ongoing-cost-of-having-an-app)

## Games built on MoMA data

Every game here draws on MoMA's public collection data, the same CSVs that
`fetch_data.py` already downloads: about 160,000 artworks and 16,000 artists.
Chronology, Same Year and Close Up use only the paintings currently on
view. MoMA by the numbers and the games still to build reach further into the
collection.

### Built

#### Chronology

*Put the paintings in the order they were made.*

Five stages of 3 to 7 paintings, each by a different artist. Each stage is
dealt into a single column in the wrong order, and the player drags them
into sequence, newest at the top. Later stages get harder by shrinking the
minimum gap between dates from 25 years to 5. Each stage is scored by how
many moves it is from correct, and the run is scored out of 20. The end
screen lists all 25 paintings as one timeline and builds a floor-by-floor
route to see them at MoMA.

#### Same Year

*One abstract, one representational: match each to its year.*

Five rows, one per year, newest at the top. Each year has an abstract
painting and a representational one, dealt so that no painting starts in its
own row. The player swaps paintings within their column until each lines up
with its year. It's scored out of 10, one point per painting in the right
row. The abstract/representational labels are hand-made, in
`docs/styles.js`.

#### Close Up

*Name the painting from a fragment.*

Four paintings by four artists, each showing only a small section, and four
labels (title, artist, year) to drag onto them. Clicking a painting widens
the view one step, from an eighth of the canvas up to the whole thing, and
each step costs a point. A small locator map shows where on the canvas the
section sits. Each painting is worth 8 and a wrong label scores 0, so the
maximum is 32.

#### MoMA by the numbers

*Twelve questions about the collection, each with four answers.*

*Built: `docs/numbers.html`.* A multiple-choice quiz of surprising numbers.
Pick one of four answers, see the real figure with a sentence of context,
and move on. It's scored out of 12. Every answer and every wrong option is
computed from the CSVs by `build_numbers()` in `fetch_data.py`, so the quiz
stays true as the collection changes. The game shuffles the question order
on each play.

This was the original plan, written from the snapshot in `raw/` (August
2026), with the right answer in bold. The built quiz keeps most of it. It
drops the curators question, which the data can't answer, in favour of the
number of artists, and some options moved so the right answer isn't always
third.

| # | Question | Answers |
|---|----------|---------|
| 1 | Total recorded weight of Richard Serra's works at MoMA | 33 tonnes · 110 tonnes · **330 tonnes** · 1,100 tonnes |
| 2 | Total number of curators at MoMA | *Not in the data, so it needs an outside source, such as MoMA's staff listing* |
| 3 | The year the oldest dated work in the collection was made | **1768** · 1820 · 1859 · 1880 |
| 4 | Works in MoMA's public collection data | 16,000 · 60,000 · **160,000** · 600,000 |
| 5 | The artist with the most works in the collection | Pablo Picasso · Eugène Atget · Louise Bourgeois · **Ludwig Mies van der Rohe** |
| 6 | Works titled exactly "Untitled" | 850 · 3,000 · **8,500** · 25,000 |
| 7 | Paintings by Picasso in the collection | 12 · **55** · 140 · 1,400 |
| 8 | Height of the tallest painting | 3 m · 5 m · **10 m** · 20 m |
| 9 | Women's share of the artists whose gender is recorded | 5% · **20%** · 35% · 50% |
| 10 | The year MoMA acquired the most works | 1929 · **1968** · 1984 · 2008 |
| 11 | The share of the collection on view right now | **under 1%** · 5% · 12% · 25% |
| 12 | Nationalities represented among the artists | 40 · 90 · **140** · 200 |

Notes for the answer screens:

1. Only 9 of Serra's 54 works have a recorded weight. *Switch* alone weighs
   185 tonnes.
3. The oldest dated works are a Josiah Wedgwood coffee and tea service.
5. The Mies van der Rohe Archive accounts for about 16,000 of his 16,272
   works. Picasso has 1,407.
7. "1,400" is a deliberate trap: that is Picasso's total across every
   medium. 55 of those works are paintings.
8. The tallest is Niele Toroni's *Imprints of a No. 50 Paintbrush Repeated
   at Regular Intervals of 30 cm*, at 1,011 cm.
9. 2,530 women out of about 12,600 artists with a recorded gender.
10. The museum acquired 20,527 works in 1968.
11. 1,248 of 160,705 works are on view.
12. The exact count is 142, not counting "Nationality unknown".

The weight and size fields are filled in for only a fraction of the
records, so questions built on them should say "recorded" and stay
approximate.

### To build

#### Which tortured artist are you?

*A personality quiz that ends in front of a painting.*

About eight light multiple-choice questions ("Your studio is: a barn / a
loft / your kitchen table / wherever the bar is"). Each answer adds weight to
a few artists from a hand-picked cast whose lives are as well known as their
work: Van Gogh, Rothko, Pollock, Kahlo, Basquiat, Gorky, Kirchner, Arbus. The
highest total wins. The result card shows that artist, one of their works
MoMA holds, and the gallery where it hangs, if it's on view.

The data supplies the works and the galleries, but not the personalities.
The cast, the questions and the weights have to be written by hand, the way
`styles.js` was. The tone should be affectionate rather than making light of
real suffering, so the questions stay about habits and temperament, not
illness.

#### 4x4

*Sixteen works, four hidden groups.*

A grid of 16 images. The player selects four that they think share
something and submits them. A right group locks together and is named; a
wrong guess costs one of four lives. Some groups can come straight from the
data: same artist, same year, same gallery room, same medium (oil on
burlap), the same word in the title. Others need hand labels: subject (dogs,
windows, bathers), or style, as `styles.js` already provides. The puzzle is
hard to the extent that the groups overlap. A red-herring work that seems to
belong to two groups is what makes it a puzzle rather than a sort. Puzzles
would be generated and then checked by eye, since a bad overlap can make a
grid unsolvable. That suits a daily-puzzle format.

#### Find the real title

*Group game: bluff a title for a real work.*

Everyone sees the same image with its artist and year, but not its title.
Each player privately writes a title they think could pass for the real
one. The real title is shuffled in with the fakes, everyone votes for the
one they believe, and the round is scored: a point for finding the real
title, and a point for each player fooled by yours. Modern art is ideal for
this, because real titles range from *Untitled* to *Imprints of a No. 50
Paintbrush Repeated at Regular Intervals of 30 cm*. Draw works with
distinctive titles, and leave out the 8,500 called "Untitled".

#### Say what you see

*Group game: describe one painting so the others can find it.*

The group sees five works. One player, the describer, is also shown which
one is the target, and has to describe it in words, out loud or typed, until
the others can pick it out. The describer and every player who picks the
target score; a wrong pick scores nothing. The five should be similar enough
to be hard (same decade, same palette, same subject), so that "the blue
one" won't do. Variants: a time limit, a word limit, or banned words (no
colours, no naming the subject).

### What the group games need

The site is static, with no server, and the group games are the first
designs that need several players to share a game. There are two ways to
handle that:

- **Pass and play on one device.** The phone goes around the table, and
  private steps (writing a fake title, seeing the target) happen one player
  at a time behind a "hand to the next player" screen. This works with the
  current static site.
- **Each player on their own phone.** This is closer to how party games
  work, with a room code and live voting, but it needs a realtime backend,
  which would be the project's first. That could be a small hosted service
  (Firebase, Supabase, PartyKit) or a WebSocket server.

Pass-and-play is the cheaper first step and tests whether the games are fun
before anything is built server-side.

## Chronology as an iOS and Android app

What it would take to ship the game in the App Store and Google Play. The code
is the easy part. The hard parts are rights, store review, and keeping the
painting pool fresh without shipping a new build every time MoMA rehangs.

### Recommendation

1. **Clear the rights first.** Nothing else is worth starting until this is
   settled; see the next section.
2. **Make the site a PWA** (a few days). It's installable to the home screen on
   both platforms, needs no store review, and tells you whether anyone wants an
   app at all.
3. **Wrap the existing code with Capacitor** (2–4 weeks to first store
   submission). It ships the same `docs/` HTML/CSS/JS inside a native shell,
   so one codebase serves the web, iOS and Android, and `test_game.py` keeps
   working.
4. **Rewrite natively only if the wrapped version proves itself.** SwiftUI and
   Jetpack Compose, or a single React Native or Flutter codebase, cost months,
   not weeks. The game is small, but drag-to-reorder, the reveal and the map
   would all have to be rebuilt.

### The real blockers

#### Image rights

MoMA's collection *metadata* is public domain (CC0), so `fetch_data.py` is on
solid ground. The *images* are not. Most of the pool is 20th-century work still
in copyright, and MoMA's image licence covers its own site, not third-party
apps. A free website hotlinking images is a grey area. A store app is a
distributed product, and both stores act on IP complaints (Apple guideline
5.2). Options:

- **Ask MoMA.** An educational or partnership licence is the clean route, and
  could come with an official blessing.
- **Restrict the pool to public-domain works.** Roughly, that means works by
  artists who died more than 70 years ago, though US rules for older works
  differ and are worth checking with someone who knows them. That takes out much of the late
  century and would change the game, because later stages depend on close
  dates.
- **Link instead of embed.** This doesn't work: the game is looking at
  paintings.

#### Name and trademark

"MoMA" and "Museum of Modern Art" are trademarks. An app titled or branded with
them, without permission, is likely to be rejected or taken down. Store
listings would need a neutral name ("Chronology: Modern Painting") and
wording like "uses public data from the Museum of Modern Art collection",
unless MoMA signs on.

#### Apple's "minimum functionality" rule

Guideline 4.2 rejects apps that are "a repackaged website". A Capacitor wrapper
passes when it feels native and does something the website doesn't. Candidates
here, which are also worth doing for their own sake:

- works offline (bundled data plus cached images)
- haptic feedback while dragging
- the gallery map saved to Photos or shared via the share sheet, instead of
  printed
- optionally, a "you're at MoMA" mode that uses location to put the map first

### Changes the code would need

All of this applies to the Capacitor route. A native rewrite would need it too.

| Area | Today | In the app |
|------|-------|------------|
| Painting data | `data.js` baked in at deploy | Bundle a copy, and on launch fetch a fresh `paintings.json` from GitHub Pages, so a rehang doesn't need an app release |
| Images | Hotlinked from moma.org | Cache after first load. Preload the next stage. Show a clear offline state |
| Print map | `window.print()` | Doesn't work in an app WebView. Render to an image or PDF and use the share sheet (Capacitor Share plugin) |
| moma.org links | `target="_blank"` | Open in an in-app browser (Capacitor Browser plugin) |
| Drag | Pointer events | Works in WKWebView and Android WebView. Also turn off text selection, the long-press callout and overscroll bounce on the board, and add haptics |
| Layout | `viewport-fit=cover` is already set | Check the safe-area insets (notch, home indicator) on real devices |
| Accessibility | Arrow keys reorder | VoiceOver and TalkBack users have no arrow keys. Add accessibility actions ("move up" / "move down") that call `moveTo()` |
| Analytics | GoatCounter script | Disclose it in Apple's privacy label and Google's Data Safety form, or drop it in the app |

`moveTo()` being the single entry point for every move pays off here: haptics
and accessibility actions are both one call each.

### Tooling and accounts

- **Apple Developer Program**: $99/year. **Google Play Console**: $25 one-time.
- **Building for iOS needs a Mac with Xcode.** This machine is Linux, so you
  would need a Mac or a cloud build service (Codemagic, Ionic Appflow, GitHub
  Actions macOS runners). Android builds fine on Linux with Android Studio.
- **New personal Google Play accounts** must run a closed test with at least 12
  testers for 14 days before they can publish to production. Line the testers
  up early.
- **Store listing assets**: icon set, screenshots for each required device
  size, a privacy policy URL (a page on the Pages site is enough), and an age
  rating questionnaire.

### Testing

- Add WebKit to the Playwright run in `test_game.py`. It's the closest thing
  to iOS Safari that runs on Linux, and it catches most WKWebView differences.
- Test on at least one real iPhone and one mid-range Android phone. Drag feel,
  scroll conflicts and safe areas only show up on hardware.
- Use TestFlight for iOS beta testing and the Play closed track for Android.

### Rough timeline (Capacitor route, after rights are settled)

| Phase | Effort |
|-------|--------|
| PWA (manifest, service worker, icons) | 2–3 days |
| Capacitor shell, data fetch, image cache | 1 week |
| Share-sheet map, in-app browser, haptics, accessibility actions | 1 week |
| Device testing and fixes | 3–5 days |
| Store listings, privacy forms, review rounds | 1–2 weeks, mostly waiting |

### Ongoing cost of having an app

- Annual Apple fee, and store-policy changes to keep up with: every year
  there's a new SDK target level and privacy requirements.
- Every change to the game ships three ways (web, iOS, Android). Fetching the
  data remotely keeps routine pool refreshes to the web deploy alone.
- Reviews and support email, which the website doesn't generate.
