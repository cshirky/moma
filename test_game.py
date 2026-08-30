#!/usr/bin/env python3
"""End-to-end test of the Chronology game with Playwright/Chromium.

Serves docs/ on a scratch port and drives a real browser: checks the draw
constraints hold, plays a full five-stage run with the keyboard, exercises
drag-reordering and the enlarged view, and asserts the scoring is right.
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
    page.wait_for_selector(".slot")
    page.wait_for_selector("#screen-play:not(.is-loading)", timeout=20000)

def answer(page):
    """Ids newest-first — the order the game expects."""
    return page.evaluate("state.works.slice().sort((a,b)=>b.year-a.year).map(w=>w.id)")

def current(page):
    return page.evaluate("state.order")

def solve_with_keyboard(page):
    """Selection sort using only ArrowUp, i.e. real user input."""
    for target, wid in enumerate(answer(page)):
        at = current(page).index(wid)
        page.focus(f'.card[data-id="{wid}"]')
        for _ in range(at - target):
            page.keyboard.press("ArrowUp")

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
        check("dataset loaded", page.evaluate("PAINTINGS.length") > 200)
        check("every painting has image+year+artist",
              page.evaluate("PAINTINGS.every(w=>w.image&&w.year&&w.artist)"))
        check("ladder is 20/15/10/5/2 years",
              page.evaluate("STAGES.map(s=>s.gap).join()") == "20,15,10,5,2",
              page.evaluate("STAGES.map(s=>s.gap).join()"))
        check("ladder is 3-7 paintings",
              page.evaluate("STAGES.map(s=>s.n).join()") == "3,4,5,6,7")

        bad = page.evaluate("""() => {
          const out = [];
          STAGES.forEach((s, si) => {
            for (let t = 0; t < 200; t++) {
              const w = drawStage(s);
              if (!w || w.length !== s.n) { out.push(`stage${si+1} bad draw`); return; }
              if (new Set(w.map(x => x.artist)).size !== s.n) {
                out.push(`stage${si+1} repeated artist`); return; }
              for (let i = 0; i < w.length; i++)
                for (let j = i+1; j < w.length; j++)
                  if (Math.abs(w[i].year - w[j].year) < s.gap) {
                    out.push(`stage${si+1} gap ${Math.abs(w[i].year-w[j].year)} < ${s.gap}`); return; }
            }
          });
          return out;
        }""")
        check("1000 draws satisfy distinct-artist + gap rules", not bad, "; ".join(bad[:3]))

        print("\n== scoring maths ==")
        # Cases worked out by hand; "moves" is n minus the largest group already
        # in the right relative order, i.e. the minimum number of drags.
        expected = [([2,3,1,4,5], 1, 8), ([2,1,3,4,5], 1, 9), ([5,1,2,3,4], 1, 6),
                    ([5,2,3,4,1], 2, 3), ([5,4,3,2,1], 4, 0), ([1,2,3,4,5], 0, 10)]
        for arrangement, want_moves, want_pairs in expected:
            got = page.evaluate("""(c)=>{const ans=c.map((_,i)=>'w'+(i+1));
                const order=c.map(v=>'w'+v);
                const k=keepSet(order,ans), p=pairScore(order,ans);
                return {moves:order.length-k.size, right:p.right, total:p.total};}""", arrangement)
            check(f"{arrangement} -> {want_moves} move(s), {want_pairs}/10 calls",
                  got["moves"] == want_moves and got["right"] == want_pairs and got["total"] == 10,
                  str(got))
        check("a board one drag from correct never scores zero",
              page.evaluate("""()=>{const ans=['a','b','c','d','e'];
                const k=keepSet(['e','a','b','c','d'],ans); return k.size;}""") == 4,
              "the old exact-position rule scored this 0 of 5")

        print("\n== full run, solving with the KEYBOARD ==")
        page.click("#btn-start")
        check("board is gated while images load, then released",
              page.wait_for_selector("#screen-play:not(.is-loading)", timeout=20000) is not None)
        for stage in range(5):
            ready(page)
            n = page.evaluate("state.works.length")
            check(f"stage {stage+1}: {n} paintings dealt into the column",
                  page.locator(".slot .card").count() == n)
            check(f"stage {stage+1}: no separate tray exists",
                  page.locator("#tray").count() == 0)
            check(f"stage {stage+1}: dealt in a wrong order",
                  current(page) != answer(page))
            check(f"stage {stage+1}: submit available immediately",
                  not page.is_disabled("#btn-submit"))
            if stage == 0:
                page.click(f'.card[data-id="{current(page)[0]}"]')
                page.wait_for_selector("#lightbox:not([hidden])")
                check("enlarged view hides the answer before submitting",
                      "hidden until you submit" in page.inner_text("#lightbox-caption"),
                      page.inner_text("#lightbox-caption"))
                page.screenshot(path="/tmp/chrono_lightbox_pre.png")
                page.keyboard.press("Escape")
                page.wait_for_selector("#lightbox", state="hidden")
                check("Escape closes the enlarged view", page.is_hidden("#lightbox"))

            solve_with_keyboard(page)
            check(f"stage {stage+1}: keyboard reordering solved the board",
                  current(page) == answer(page))
            page.click("#btn-submit")
            page.wait_for_selector(".slot.revealed")
            check(f"stage {stage+1}: verdict is correct",
                  "Correct" in page.inner_text("#verdict"), page.inner_text("#verdict"))
            check(f"stage {stage+1}: every slot marked right",
                  page.locator(".slot.revealed.ok").count() == n)
            check(f"stage {stage+1}: solved verdict reports all calls right",
                  f"All {n*(n-1)//2} before-and-after calls right" in page.inner_text("#verdict"),
                  page.inner_text("#verdict"))
            check(f"stage {stage+1}: reveal shows year+title+artist",
                  page.locator(".card-info .r-year").count() == n
                  and page.locator(".card-info .r-artist").count() == n)
            if stage == 0:
                page.click(f'.card[data-id="{current(page)[0]}"]')
                page.wait_for_selector("#lightbox:not([hidden])")
                cap = page.inner_text("#lightbox-caption")
                check("enlarged view shows full details after submitting",
                      any(ch.isdigit() for ch in cap) and "hidden until" not in cap, cap[:60])
                check("enlarged view links to moma.org",
                      page.locator("#lightbox-caption a.lb-link").count() == 1)
                page.screenshot(path="/tmp/chrono_lightbox_post.png")
                page.click("#lightbox-close")
                page.wait_for_selector("#lightbox", state="hidden")
                page.screenshot(path="/tmp/chrono_stage1_revealed.png")
            page.click("#btn-next")

        page.wait_for_selector("#screen-done:not([hidden])")
        check("results screen: perfect run", "Perfect run" in page.inner_text("#done-title"),
              page.inner_text("#done-title"))
        check("results: 5 rows, all ticked", page.locator(".scorecard .sc-badge.ok").count() == 5)
        # 3+6+10+15+21 pairs across the five stages
        check("results: run total is 55 of 55 calls",
              "55 of 55" in page.inner_text("#done-line"), page.inner_text("#done-line"))
        page.screenshot(path="/tmp/chrono_results.png")

        print("\n== drag reordering ==")
        page.click("#btn-again"); ready(page)
        before = current(page)
        card = page.locator(f'.card[data-id="{before[-1]}"]')
        slot = page.locator('.slot[data-index="0"]')
        cb, sb = card.bounding_box(), slot.bounding_box()
        page.mouse.move(cb["x"] + cb["width"]/2, cb["y"] + cb["height"]/2)
        page.mouse.down()
        page.mouse.move(sb["x"] + sb["width"]/2, sb["y"] + sb["height"]/2, steps=14)
        page.mouse.up()
        after = current(page)
        check("dragging the bottom painting to the top moves it there",
              after[0] == before[-1], f"{before} -> {after}")
        check("drag shifts the others down rather than swapping",
              after == [before[-1]] + before[:-1], f"{before} -> {after}")
        check("drag loses no paintings", sorted(after) == sorted(before))
        check("a drag does not open the enlarged view", page.is_hidden("#lightbox"))

        print("\n== wrong answer, scored by moves ==")
        # Put the newest painting at the bottom: one drag from correct, but the
        # arrangement the old exact-position rule scored zero on.
        page.evaluate("""()=>{const a=state.works.slice().sort((x,y)=>y.year-x.year).map(w=>w.id);
                            state.order = a.slice(1).concat([a[0]]); render();}""")
        page.click("#btn-submit")
        page.wait_for_selector(".slot.revealed")
        verdict = page.inner_text("#verdict")
        check("one-drag board reads as one move from correct",
              "One move from correct" in verdict, verdict)
        check("exactly one painting is flagged to move",
              page.locator(".slot.revealed.no").count() == 1,
              str(page.locator(".slot.revealed.no").count()))
        check("the rest are marked as already in order",
              page.locator(".slot.revealed.ok").count() == page.evaluate("state.order.length") - 1)
        mark = page.locator(".mark.no").inner_text()
        check("the flagged painting says where it belongs", "1" in mark and "↑" in mark, mark)
        page.screenshot(path="/tmp/chrono_moves.png")

        print("\n== images actually load from moma.org ==")
        page.wait_for_timeout(2000)
        ok = page.evaluate("""() => Array.from(document.querySelectorAll('.card img'))
              .map(i => i.complete && i.naturalWidth > 0)""")
        check("all stage images rendered", ok and all(ok), f"{sum(1 for x in ok if x)}/{len(ok)}")
        check("no console/page errors", not errors, "; ".join(errors[:3]))
        browser.close()
    httpd.shutdown()

    print("\n" + ("ALL CHECKS PASSED" if not fails else f"{len(fails)} FAILED: {fails}"))
    return 1 if fails else 0

sys.exit(main())
