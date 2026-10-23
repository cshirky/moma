# Projects: Chronology as an iOS and Android app

What it would take to ship the game in the App Store and Google Play. The code
is the easy part. The hard parts are rights, store review, and keeping the
painting pool fresh without shipping a new build every time MoMA rehangs.

## Recommendation

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

## The real blockers

### Image rights

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

### Name and trademark

"MoMA" and "Museum of Modern Art" are trademarks. An app titled or branded with
them, without permission, is likely to be rejected or taken down. Store
listings would need a neutral name ("Chronology: Modern Painting") and
wording like "uses public data from the Museum of Modern Art collection",
unless MoMA signs on.

### Apple's "minimum functionality" rule

Guideline 4.2 rejects apps that are "a repackaged website". A Capacitor wrapper
passes when it feels native and does something the website doesn't. Candidates
here, which are also worth doing for their own sake:

- works offline (bundled data plus cached images)
- haptic feedback while dragging
- the gallery map saved to Photos or shared via the share sheet, instead of
  printed
- optionally, a "you're at MoMA" mode that uses location to put the map first

## Changes the code would need

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

## Tooling and accounts

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

## Testing

- Add WebKit to the Playwright run in `test_game.py`. It's the closest thing
  to iOS Safari that runs on Linux, and it catches most WKWebView differences.
- Test on at least one real iPhone and one mid-range Android phone. Drag feel,
  scroll conflicts and safe areas only show up on hardware.
- Use TestFlight for iOS beta testing and the Play closed track for Android.

## Rough timeline (Capacitor route, after rights are settled)

| Phase | Effort |
|-------|--------|
| PWA (manifest, service worker, icons) | 2–3 days |
| Capacitor shell, data fetch, image cache | 1 week |
| Share-sheet map, in-app browser, haptics, accessibility actions | 1 week |
| Device testing and fixes | 3–5 days |
| Store listings, privacy forms, review rounds | 1–2 weeks, mostly waiting |

## Ongoing cost of having an app

- Annual Apple fee, and store-policy changes to keep up with: every year
  there's a new SDK target level and privacy requirements.
- Every change to the game ships three ways (web, iOS, Android). Fetching the
  data remotely keeps routine pool refreshes to the web deploy alone.
- Reviews and support email, which the website doesn't generate.
