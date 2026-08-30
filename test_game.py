#!/usr/bin/env python3
"""End-to-end test of the Chronology game with Playwright/Chromium.

Serves docs/ on a scratch port and drives a real browser: checks the draw
constraints hold, plays a full five-stage run by clicking, plays another by
dragging, and asserts the reveal and scoring are right.
"""
import functools, http.server, socket, socketserver, sys, threading
from playwright.sync_api import sync_playwright

DOCS = "docs"
fails = []

def check(label, cond, detail=""):
    print(("  PASS  " if cond else "  FAIL  ") + label + (f"  [{detail}]" if detail and not cond else ""))
    if not cond:
        fails.append(label)

def serve():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0)); port = s.getsockname()[1]
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=DOCS)
    handler.log_message = lambda *a, **k: None
    httpd = socketserver.TCPServer(("127.0.0.1", port), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, f"http://127.0.0.1:{port}/"

def ready(page):
    """Wait for the stage to be dealt and its images to have settled."""
    page.wait_for_selector(".slot")
    page.wait_for_selector("#screen-play:not(.is-loading)", timeout=15000)

def correct_order(page):
    """Ids newest-first — the answer the game expects."""
    return page.evaluate("state.works.slice().sort((a,b)=>b.year-a.year).map(w=>w.id)")

def place_by_click(page, ids):
    for i, wid in enumerate(ids):
        page.click(f'.card[data-id="{wid}"]')
        page.click(f'.slot[data-index="{i}"]')

def place_by_drag(page, ids):
    for i, wid in enumerate(ids):
        card = page.locator(f'.card[data-id="{wid}"]')
        slot = page.locator(f'.slot[data-index="{i}"]')
        cb, sb = card.bounding_box(), slot.bounding_box()
        page.mouse.move(cb["x"] + cb["width"]/2, cb["y"] + cb["height"]/2)
        page.mouse.down()
        page.mouse.move(sb["x"] + sb["width"]/2, sb["y"] + sb["height"]/2, steps=12)
        page.mouse.up()

def main():
    httpd, url = serve()
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1280, "height": 1000})
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        page.goto(url)

        print("\n== data + draw constraints ==")
        n = page.evaluate("PAINTINGS.length")
        check("dataset loaded", n > 200, f"n={n}")
        check("every painting has image+year+artist", page.evaluate(
            "PAINTINGS.every(w=>w.image&&w.year&&w.artist)"))

        # 200 synthetic draws per stage, checked against the stated rules.
        bad = page.evaluate("""() => {
          const out = [];
          STAGES.forEach((s, si) => {
            for (let t = 0; t < 200; t++) {
              const w = drawStage(s);
              if (!w || w.length !== s.n) { out.push(`stage${si+1} bad draw`); return; }
              const artists = new Set(w.map(x => x.artist));
              if (artists.size !== s.n) { out.push(`stage${si+1} repeat artist`); return; }
              for (let i = 0; i < w.length; i++)
                for (let j = i+1; j < w.length; j++)
                  if (Math.abs(w[i].year - w[j].year) < s.gap) {
                    out.push(`stage${si+1} gap ${Math.abs(w[i].year-w[j].year)} < ${s.gap}`); return;
                  }
            }
          });
          return out;
        }""")
        check("1000 draws satisfy distinct-artist + gap rules", not bad, "; ".join(bad[:3]))

        print("\n== full run, placing by CLICK, always correct ==")
        page.click("#btn-start")
        check("board is gated while images load, then released",
              page.wait_for_selector("#screen-play:not(.is-loading)", timeout=15000) is not None)
        for stage in range(5):
            ready(page)
            cards = page.locator("#tray .card").count()
            expect_n = page.evaluate("state.slots.length")
            check(f"stage {stage+1}: {expect_n} cards in tray", cards == expect_n, f"got {cards}")
            check(f"stage {stage+1}: submit disabled while tray full",
                  page.is_disabled("#btn-submit"))
            place_by_click(page, correct_order(page))
            check(f"stage {stage+1}: tray empty after placing",
                  page.locator("#tray .card").count() == 0)
            check(f"stage {stage+1}: submit now enabled", not page.is_disabled("#btn-submit"))
            page.click("#btn-submit")
            page.wait_for_selector(".slot.revealed")
            check(f"stage {stage+1}: verdict is correct",
                  "Correct" in page.inner_text("#verdict"), page.inner_text("#verdict"))
            check(f"stage {stage+1}: all slots marked ok",
                  page.locator(".slot.revealed.ok").count() == expect_n)
            check(f"stage {stage+1}: reveal shows year+title+artist",
                  page.locator(".card-info .r-year").count() == expect_n
                  and page.locator(".card-info .r-artist").count() == expect_n)
            if stage == 0:
                page.screenshot(path="/tmp/chrono_stage1_revealed.png")
            page.click("#btn-next")

        page.wait_for_selector("#screen-done:not([hidden])")
        check("results screen: perfect run", "Perfect run" in page.inner_text("#done-title"),
              page.inner_text("#done-title"))
        check("results: 5 rows, all ticked", page.locator(".scorecard .sc-badge.ok").count() == 5)
        page.screenshot(path="/tmp/chrono_results.png")

        print("\n== full run, placing by DRAG, deliberately reversed ==")
        page.click("#btn-again")
        ready(page)
        place_by_drag(page, list(reversed(correct_order(page))))
        check("drag placed every card", page.locator("#tray .card").count() == 0)
        page.click("#btn-submit")
        page.wait_for_selector(".slot.revealed")
        check("reversed order is judged wrong", "Not quite" in page.inner_text("#verdict"),
              page.inner_text("#verdict"))
        check("reversed order: both ends wrong",
              page.locator(".slot.revealed.no").count() >= 2)
        page.screenshot(path="/tmp/chrono_wrong.png")

        print("\n== interaction details ==")
        page.click("#btn-next"); ready(page)
        ids = page.evaluate("state.works.map(w=>w.id)")
        # swap semantics: placing B on a slot held by A should evict A, not lose it
        page.click(f'.card[data-id="{ids[0]}"]'); page.click('.slot[data-index="0"]')
        page.click(f'.card[data-id="{ids[1]}"]'); page.click('.slot[data-index="0"]')
        check("occupied slot swaps, no card lost",
              page.evaluate("state.slots.filter(Boolean).length + state.tray.length") == len(ids),
              page.evaluate("JSON.stringify({s:state.slots,t:state.tray})"))
        check("evicted card returned to tray", page.evaluate(f"state.tray.includes('{ids[0]}')"))
        # reset
        page.click("#btn-shuffle"); page.wait_for_selector(".slot.is-empty")
        check("reset clears the column", page.evaluate("state.slots.every(s=>!s)"))
        check("reset refills the tray",
              page.evaluate("state.tray.length === state.slots.length"))

        print("\n== images actually load from moma.org ==")
        page.wait_for_timeout(2500)
        ok = page.evaluate("""() => Array.from(document.querySelectorAll('.card img'))
              .map(i => i.complete && i.naturalWidth > 0)""")
        check("all stage images rendered", ok and all(ok), f"{sum(1 for x in ok if x)}/{len(ok)}")

        check("no console/page errors", not errors, "; ".join(errors[:3]))
        browser.close()
    httpd.shutdown()

    print("\n" + ("ALL CHECKS PASSED" if not fails else f"{len(fails)} FAILED: {fails}"))
    return 1 if fails else 0

sys.exit(main())
