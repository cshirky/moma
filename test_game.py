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
        check("ladder is 25/20/15/10/5 years",
              page.evaluate("STAGES.map(s=>s.gap).join()") == "25,20,15,10,5",
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
                first = f'.card[data-id="{current(page)[0]}"]'
                page.hover(first)
                page.wait_for_timeout(500)
                check("hovering a painting does not open the enlarged view",
                      page.is_hidden("#lightbox"))
                check("the enlarge affordance is visible without hovering",
                      float(page.evaluate("""()=>{const c=document.querySelector('.card-zoom');
                            return getComputedStyle(c).opacity;}""")) > 0.2)

                page.click(first); page.wait_for_selector("#lightbox:not([hidden])")
                page.wait_for_function("document.querySelector('#lightbox-img').naturalWidth > 0"
                                       " && !document.querySelector('#lightbox').classList.contains('is-loading')")
                fit = page.evaluate("""()=>{const r=document.querySelector('#lightbox-img').getBoundingClientRect();
                      return {w:r.width,h:r.height,vw:innerWidth,vh:innerHeight};}""")
                fw, fh = fit["w"] / fit["vw"], fit["h"] / fit["vh"]
                check("enlarged painting fills 95% of the limiting dimension",
                      max(fw, fh) > 0.94 and max(fw, fh) < 0.96 and fw <= 0.951 and fh <= 0.951,
                      f"{fw:.3f} of width, {fh:.3f} of height")

                def lb_scale():
                    return page.evaluate("lb.scale")
                img = page.locator("#lightbox-img")
                box = img.bounding_box()
                page.mouse.click(box["x"] + box["width"] * 0.3, box["y"] + box["height"] * 0.3)
                page.wait_for_timeout(300)
                check("clicking the painting zooms in rather than dismissing",
                      page.is_visible("#lightbox") and lb_scale() > 2, lb_scale())
                check("the caption gets out of the way while zoomed",
                      page.evaluate("getComputedStyle(document.querySelector('#lightbox-caption')).opacity") == "0")
                before = page.evaluate("[lb.x, lb.y]")
                cx, cy = fit["vw"] / 2, fit["vh"] / 2
                page.mouse.move(cx, cy); page.mouse.down()
                page.mouse.move(cx - 60, cy - 40, steps=6); page.mouse.up()
                after = page.evaluate("[lb.x, lb.y]")
                check("dragging a zoomed painting pans it",
                      after[0] < before[0] and after[1] < before[1] and page.is_visible("#lightbox"),
                      f"{before} -> {after}")
                page.mouse.click(cx, cy)
                page.wait_for_timeout(300)
                check("clicking a zoomed painting zooms back out to fit",
                      lb_scale() == 1 and page.evaluate("[lb.x, lb.y]") == [0, 0])
                page.mouse.move(cx, cy); page.mouse.wheel(0, -400)
                page.wait_for_timeout(100)
                check("scrolling over the painting zooms it", lb_scale() > 1.5, lb_scale())
                page.click("#lb-zoom-out")
                page.click("#lb-zoom-in")
                check("the zoom buttons work without closing the view",
                      page.is_visible("#lightbox") and lb_scale() > 1.5)
                page.keyboard.press("0")
                check("0 resets the zoom", lb_scale() == 1)
                check("zoom out is disabled at the fitted size", page.is_disabled("#lb-zoom-out"))
                page.wait_for_timeout(300)   # let the zoom-out animation finish
                page.mouse.click(3, 3)
                page.wait_for_selector("#lightbox", state="hidden")
                check("clicking the backdrop dismisses it", page.is_hidden("#lightbox"))

                page.click(first); page.wait_for_selector("#lightbox:not([hidden])")
                page.locator("#lightbox-caption").click(force=True)
                page.wait_for_selector("#lightbox", state="hidden")
                check("clicking the caption dismisses it too", page.is_hidden("#lightbox"))

                page.click(first); page.wait_for_selector("#lightbox:not([hidden])")
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
            check(f"stage {stage+1}: a solved stage offers no Show the order button",
                  page.is_hidden("#btn-show-order"))
            check(f"stage {stage+1}: submit is the only way to end a stage",
                  page.locator("#btn-reveal").count() == 0)
            check(f"stage {stage+1}: solved verdict avoids pair-counting language",
                  "Every painting in its place" in page.inner_text("#verdict")
                  and "call" not in page.inner_text("#verdict").lower(),
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
        check("results: 5 rows, all ticked", page.locator(".scorecard .sc-badge.is-pass").count() == 5)
        # 3+6+10+15+21 pairs across the five stages
        # Asserted on meaning rather than exact phrasing, which gets reworded:
        # a flawless run must not report any distance from correct.
        check("results: a perfect run reports no moves outstanding",
              "move" not in page.inner_text("#done-line").lower(),
              page.inner_text("#done-line"))
        check("no pair-counting language anywhere on the results page",
              "call" not in page.inner_text("#screen-done").lower(),
              page.inner_text("#screen-done")[:120])

        print("\n== score out of 20 ==")
        check("a perfect run scores 20 of 20",
              page.inner_text("#score-num").strip() == "20", page.inner_text("#score-num"))
        # the band is upper-cased by CSS, so compare case-insensitively
        check("and is labelled Perfect",
              page.inner_text("#score-band").strip().lower() == "perfect",
              page.inner_text("#score-band"))
        for sc, want in [(20,"Perfect"), (19,"Excellent"), (18,"Excellent"),
                         (17,"Very Good"), (16,"Very Good"), (15,"Good"), (14,"Good"),
                         (13,"OK"), (12,"OK"), (11,"Nearly Random"),
                         (9,"Nearly Random"), (8,"Worse than Random"),
                         (0,"Worse than Random")]:
            got = page.evaluate("(s)=>BANDS.find(b=>s>=b.min).label", sc)
            check(f"score {sc} -> {want}", got == want, got)
        check("no role titles remain", page.locator("#score-title").count() == 0
              and page.evaluate("()=>BANDS.every(b=>b.title===undefined)"))
        # Excellent is meant to mean "three or more stages solved outright".
        # Three imperfect stages cost at least three moves, so 18+ can't be
        # reached with fewer than three perfect stages.
        check("a score of 18 is unreachable with fewer than 3 perfect stages",
              page.evaluate("""()=>{
                const ns=STAGES.map(s=>s.n); let bad=0;
                const walk=(i,moves,perfect)=>{
                  if(i===ns.length){ if(20-moves>=18 && perfect<3) bad++; return; }
                  for(let m=0;m<ns[i];m++) walk(i+1,moves+m,perfect+(m===0?1:0));
                };
                walk(0,0,0); return bad;}""") == 0)
        check("max score is derived from the ladder, not hard-coded",
              page.evaluate("MAX_SCORE") == 20 and
              page.evaluate("STAGES.reduce((t,s)=>t+s.n-1,0)") == 20)

        print("\n== the closing painting list ==")
        rows = page.locator("#painting-list li")
        check("all 25 paintings are listed", rows.count() == 25, str(rows.count()))
        years = page.evaluate("""()=>[...document.querySelectorAll('#painting-list .pl-year')]
                                    .map(e=>+e.textContent)""")
        check("listed newest to oldest, like the board",
              years == sorted(years, reverse=True), str(years))
        check("no painting repeats across a run",
              len(set(page.evaluate("()=>[...document.querySelectorAll('#painting-list input')].map(i=>i.dataset.id)"))) == 25)
        # All 25 must actually be on screen: an inner scroll box hid 18 of them
        # and the list read as six paintings.
        check("no inner scroll box hides paintings",
              page.evaluate("()=>{const l=document.getElementById('painting-list');"
                            "return l.scrollHeight <= l.clientHeight + 2;}"),
              page.evaluate("()=>{const l=document.getElementById('painting-list');"
                            "return l.scrollHeight+' vs '+l.clientHeight;}"))
        check("every one of the 25 rows is rendered at full height",
              page.evaluate("""()=>[...document.querySelectorAll('#painting-list li')]
                    .every(li=>li.getBoundingClientRect().height > 20)"""))
        check("the map instruction uses the agreed wording",
              "check the box next to it" in page.inner_text(".visit"),
              page.inner_text(".visit")[:160])
        check("every row has a thumbnail and a checkbox",
              page.locator("#painting-list img").count() == 25
              and page.locator("#painting-list input[type=checkbox]").count() == 25)
        check("map button starts disabled", page.is_disabled("#btn-map"))

        print("\n== ticking paintings and building a map ==")
        for i in range(5):
            page.locator("#painting-list input").nth(i).check()
        check("tick count updates", "5 paintings ticked" in page.inner_text("#tick-count"),
              page.inner_text("#tick-count"))
        check("map button enables once something is ticked", not page.is_disabled("#btn-map"))
        page.click("#btn-map")
        page.wait_for_selector("#map-out:not([hidden])")
        check("map lists the ticked paintings",
              page.locator("#map-out .map-floor li").count() == 5,
              str(page.locator("#map-out .map-floor li").count()))
        check("map groups them by floor", page.locator("#map-out .map-floor").count() >= 1)
        floors = page.evaluate("""()=>[...document.querySelectorAll('#map-out .map-floor h5')]
                                     .map(e=>e.textContent)""")
        nums = [int(f.split()[-1]) for f in floors if f.startswith("Floor")]
        check("floors run highest first", nums == sorted(nums, reverse=True), str(floors))
        check("map offers a print button", page.locator("#btn-print").count() == 1)
        page.screenshot(path="/tmp/chrono_results.png", full_page=True)

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
        check("a one-move stage gets the amber pip, not red",
              page.locator("#pips li.is-close").count() == 1
              and page.locator("#pips li.is-fail").count() == 0,
              page.evaluate("[...document.querySelectorAll('#pips li')].map(l=>l.className).join('|')"))
        check("the verdict headline is amber, not red",
              "is-close" in page.get_attribute("#verdict", "class"),
              page.get_attribute("#verdict", "class"))
        check("it is ringed on the top half, the way it has to travel",
              page.locator(".slot.revealed.no.needs-up").count() == 1
              and page.locator(".slot.revealed.no.needs-down").count() == 0)
        check("the half-ring is actually drawn, not just declared",
              page.evaluate("""()=>{const s=document.querySelector('.slot.revealed.no');
                    const a=getComputedStyle(s,'::after');
                    return a.content !== 'none' && a.clipPath.startsWith('inset');}"""),
              page.evaluate("()=>getComputedStyle(document.querySelector('.slot.revealed.no'),'::after').clipPath"))
        check("the verdict explains the ring instead of asking for a move",
              "red edge" in page.inner_text("#verdict")
              and "Move the marked" not in page.inner_text("#verdict"),
              page.inner_text("#verdict"))
        page.screenshot(path="/tmp/chrono_moves.png")

        print("\n== Show the order, after a stage has been scored ==")
        check("the button is offered once a stage comes out wrong",
              page.is_visible("#btn-show-order"))
        scored = page.evaluate("state.results[state.stageIndex].moves")
        page.click("#btn-show-order")
        page.wait_for_selector(".slot.revealed.shown")
        check("the column re-sorts into the true order", current(page) == answer(page))
        check("the red half-rings are cleared",
              page.locator(".slot.revealed.no").count() == 0
              and page.locator(".slot.needs-up, .slot.needs-down").count() == 0)
        check("the per-card marks are removed", page.locator(".mark").count() == 0)
        check("looking does not change the score already recorded",
              page.evaluate("state.results[state.stageIndex].moves") == scored,
              f"{scored} -> {page.evaluate('state.results[state.stageIndex].moves')}")
        check("the button withdraws after use", page.is_hidden("#btn-show-order"))
        page.screenshot(path="/tmp/chrono_showorder.png")

        print("\n== a badly wrong stage stays red ==")
        page.click("#btn-next"); ready(page)
        page.evaluate("""()=>{const a=state.works.slice().sort((x,y)=>y.year-x.year).map(w=>w.id);
                            state.order = a.slice().reverse(); render();}""")
        page.click("#btn-submit"); page.wait_for_selector(".slot.revealed")
        check("a reversed board is more than one move away",
              "moves from correct" in page.inner_text("#verdict"), page.inner_text("#verdict"))
        # assert on this stage's own pip, since earlier stages in this run have
        # already painted pips of their own
        check("it gets the red pip",
              page.evaluate("()=>document.querySelectorAll('#pips li')[state.stageIndex].className")
              == "is-fail",
              page.evaluate("[...document.querySelectorAll('#pips li')].map(l=>l.className).join('|')"))
        check("amber and red coexist across stages",
              page.locator("#pips li.is-close").count() >= 1
              and page.locator("#pips li.is-fail").count() >= 1,
              page.evaluate("[...document.querySelectorAll('#pips li')].map(l=>l.className).join('|')"))

        print("\n== menu of games ==")
        for path, current_name in [("", "Chronology"), ("sameyear.html", "Same Year"), ("closeup.html", "Close Up")]:
            page.goto(url + path)
            names = page.eval_on_selector_all(".game-nav a", "as => as.map(a => a.textContent)")
            cur = page.eval_on_selector_all('.game-nav a[aria-current="page"]', "as => as.map(a => a.textContent)")
            check(f"{current_name}: menu links all three games and marks this one",
                  names == ["Chronology", "Same Year", "Close Up"] and cur == [current_name], f"{names} {cur}")

        print("\n== Same Year ==")
        page.goto(url + "sameyear.html")
        page.wait_for_selector("#sy-board:not(.is-loading) .sy-card", timeout=30000)
        check("enough pairable years for varied rounds", page.evaluate("BY_YEAR.size") >= 15,
              page.evaluate("BY_YEAR.size"))
        bad = page.evaluate("""() => { const out = [];
            for (let i = 0; i < 500; i++) {
              const rows = drawRound();
              if (!rows || rows.length !== ROWS) { out.push('short draw'); continue; }
              const years = rows.map(r => r.year);
              if (new Set(years).size !== ROWS) out.push('repeated year');
              if (years.some((y, j) => j && y > years[j-1])) out.push('not newest first');
              if (years.some((y, j) => j && years[j-1] - y < MIN_GAP)) out.push('years too close');
              const artists = rows.flatMap(r => [r.abstract.artist, r.representational.artist]);
              if (new Set(artists).size !== ROWS * 2) out.push('repeated artist');
              for (const r of rows) {
                if (STYLES[r.abstract.id] !== 'abstract' || STYLES[r.representational.id] !== 'representational')
                  out.push('wrong kind in column');
                if (r.abstract.year !== r.year || r.representational.year !== r.year) out.push('year mismatch');
              }
              const ids = rows.map(r => r.abstract.id), dealt = deal(ids);
              if (dealt.some((id, j) => id === ids[j])) out.push('dealt in place');
            }
            return [...new Set(out)]; }""")
        check("500 draws: years 5+ apart, one abstract + one representational per year, all artists different, dealt out of place",
              bad == [] and page.evaluate("MIN_GAP") == 5, bad)
        before = page.evaluate("state.abstract.slice()")
        a = page.locator('.sy-cell[data-col="abstract"][data-row="0"] .sy-card').bounding_box()
        t = page.locator('.sy-cell[data-col="abstract"][data-row="3"]').bounding_box()
        page.mouse.move(a["x"] + 30, a["y"] + 30); page.mouse.down()
        page.mouse.move(t["x"] + 30, t["y"] + 30, steps=10); page.mouse.up()
        after = page.evaluate("state.abstract.slice()")
        check("dragging a painting onto another row swaps the two",
              after[3] == before[0] and after[0] == before[3], f"{before} -> {after}")
        before_r = page.evaluate("state.representational.slice()")
        a = page.locator('.sy-cell[data-col="abstract"][data-row="1"] .sy-card').bounding_box()
        t = page.locator('.sy-cell[data-col="representational"][data-row="2"]').bounding_box()
        page.mouse.move(a["x"] + 30, a["y"] + 30); page.mouse.down()
        page.mouse.move(t["x"] + 30, t["y"] + 30, steps=10); page.mouse.up()
        check("an abstract painting can't be dropped in the representational column",
              page.evaluate("state.abstract.slice()") == after
              and page.evaluate("state.representational.slice()") == before_r)
        top = page.evaluate("state.abstract[0]")
        page.focus(f'.sy-card[data-id="{top}"]'); page.keyboard.press("ArrowDown")
        check("ArrowDown moves a focused painting down a row", page.evaluate("state.abstract[1]") == top)
        page.evaluate("""() => { for (const c of COLS) state[c] = state.rows.map(r => r[c].id); render(); }""")
        page.click("#btn-sy-submit")
        check("a solved board scores 10 of 10", "10 of 10" in page.inner_text("#sy-result"),
              page.inner_text("#sy-result"))
        check("every cell is marked right", page.locator(".sy-cell.ok").count() == 10)
        check("the answers show year, title and artist", page.locator(".sy-info").count() == 10)
        page.click("#btn-sy-next")
        page.wait_for_selector("#sy-board:not(.is-loading) .sy-card", timeout=30000)
        check("New round deals a fresh, unanswered board",
              page.locator(".sy-cell.ok, .sy-cell.no").count() == 0 and page.is_visible("#btn-sy-submit"))

        print("\n== Close Up ==")
        page.goto(url + "closeup.html")
        page.wait_for_selector("#cu-board:not(.is-loading) .cu-view canvas", timeout=30000)
        ids = page.evaluate("state.works.map(w => w.id)")
        check("four paintings by four artists",
              len(ids) == 4 and page.evaluate("new Set(state.works.map(w => w.artist)).size") == 4)
        check("the click ladder runs 8x4 down to the whole painting",
              page.evaluate("JSON.stringify(LEVELS)") ==
              "[[8,4],[6,4],[4,4],[4,3],[3,3],[3,2],[2,2],[2,1],[1,1]]" and page.evaluate("MAX_SCORE") == 32)
        grids = page.evaluate("""state.works.map(w => { const i = state.imgs.get(w.id), g = grid(w.id, 0);
            return i.naturalHeight > i.naturalWidth ? (g.rows === 8 && g.cols === 4) : (g.rows === 4 && g.cols === 8); })""")
        check("portrait paintings start as 8 rows x 4 columns, landscape as 4 x 8", all(grids), grids)
        check("the first section comes from the busier half of the grid",
              page.evaluate("""state.works.every(w => { const g = grid(w.id, 0), a = state.anchor[w.id];
                  const busy = busyCells(state.imgs.get(w.id), g.rows, g.cols);
                  return busy.length === g.rows * g.cols / 2 &&
                         busy.some(c => Math.abs((c.c + 0.5) / g.cols - a.x) < 1e-9 && Math.abs((c.r + 0.5) / g.rows - a.y) < 1e-9); })"""))
        check("each painting has a locator map in its proportions, marking the section on view",
              page.evaluate("""state.works.every(w => {
                  const m = document.querySelector(`.cu-view[data-id="${w.id}"] .cu-map`);
                  if (!m) return false;
                  const i = state.imgs.get(w.id), b = m.firstElementChild, r = region(w.id);
                  const close = (a, c, tol) => Math.abs(a - c) <= tol;
                  return close(m.offsetWidth / m.offsetHeight, i.naturalWidth / i.naturalHeight, 0.1) &&
                         close(b.offsetLeft / m.clientWidth, r.x, 0.06) && close(b.offsetTop / m.clientHeight, r.y, 0.06) &&
                         close(b.offsetWidth / m.clientWidth, r.w, 0.06) && close(b.offsetHeight / m.clientHeight, r.h, 0.06); })"""))
        first = ids[0]
        areas = []
        for _ in range(10):
            areas.append(page.evaluate(f"(() => {{ const r = region('{first}'); return r.w * r.h; }})()"))
            page.click(f'.cu-view[data-id="{first}"]')
        check("each click shows a bigger section, ending at the whole painting",
              all(b > a for a, b in zip(areas, areas[1:9])) and abs(areas[8] - 1) < 1e-9,
              [round(x, 3) for x in areas])
        check("the locator map goes once the painting is whole",
              page.locator(f'.cu-view[data-id="{first}"] .cu-map').count() == 0
              and page.locator(f'.cu-view[data-id="{ids[1]}"] .cu-map').count() == 1)
        check("clicks past the whole painting cost nothing",
              page.evaluate(f"state.level['{first}']") == 8
              and "Whole painting" in page.inner_text(f'.cu-view[data-id="{first}"]'))
        check("bigger sections stay centred on the first one",
              page.evaluate(f"""(() => {{ const a = state.anchor['{first}'];
                  for (let l = 0; l <= STEPS; l++) {{ state.level['{first}'] = l; const r = region('{first}');
                    if (a.x < r.x - 1e-9 || a.x > r.x + r.w + 1e-9 || a.y < r.y - 1e-9 || a.y > r.y + r.h + 1e-9) return false; }}
                  state.level['{first}'] = 8; return true; }})()"""))
        check("the status line counts the cost", "8 clicks" in page.inner_text("#cu-status"),
              page.inner_text("#cu-status"))
        check("Submit waits for all four labels", page.is_disabled("#btn-cu-submit"))
        l = page.locator(f'#cu-tray .cu-label[data-label="{ids[1]}"]').bounding_box()
        t = page.locator(f'.cu-slot[data-slot="{ids[1]}"]').bounding_box()
        page.mouse.move(l["x"] + 20, l["y"] + 20); page.mouse.down()
        page.mouse.move(t["x"] + 20, t["y"] + 20, steps=10); page.mouse.up()
        check("dragging a label onto a painting places it",
              page.evaluate(f"state.place['{ids[1]}']") == ids[1] and page.evaluate("state.selected") is None)
        page.click(f'.cu-label[data-label="{ids[0]}"]')
        page.click(f'.cu-slot[data-slot="{ids[1]}"]')
        check("placing a label on an occupied painting sends the old one back",
              page.evaluate(f"state.place['{ids[1]}']") == ids[0]
              and page.locator(f'#cu-tray .cu-label[data-label="{ids[1]}"]').count() == 1)
        for lab, slot in [(ids[1], ids[1]), (ids[0], ids[0]), (ids[2], ids[3]), (ids[3], ids[2])]:
            page.click(f'.cu-label[data-label="{lab}"]'); page.click(f'.cu-slot[data-slot="{slot}"]')
        page.click("#btn-cu-submit")
        # ids[0] took 8 clicks (0 left), ids[1] none (8); ids[2] and ids[3] are swapped (0 each)
        scored = page.evaluate("state.scored")
        check("score: a right label keeps 8 less its clicks, a wrong one scores 0",
              scored == {ids[0]: 0, ids[1]: 8, ids[2]: 0, ids[3]: 0}
              and page.inner_text(".cu-score").split("/")[0].strip() == "8", scored)
        check("after submitting, every painting is shown whole",
              page.locator(".cu-shown", has_text="Whole painting").count() == 4)
        check("a wrong label names the right answer", page.locator(".cu-verdict.no").count() == 2)
        check("the revealed paintings drop the locator map", page.locator(".cu-map").count() == 0)
        box_px = page.evaluate(f"""(() => {{
            const c = document.querySelector('.cu-view[data-id="{ids[1]}"] canvas');
            const r = region('{ids[1]}', state.level['{ids[1]}']), lw = 2 * (window.devicePixelRatio || 1);
            const x = Math.round(r.x * c.width + lw), y = Math.round((r.y + r.h / 2) * c.height);
            return Array.from(c.getContext('2d').getImageData(x, y, 1, 1).data.slice(0, 3)); }})()""")
        check("the reveal boxes the last section the player saw, in white", min(box_px) >= 240, box_px)
        page.click("#btn-cu-next")
        page.wait_for_selector("#cu-board:not(.is-loading) .cu-view canvas", timeout=30000)
        page.evaluate("""() => { for (const w of state.works) state.place[w.id] = w.id; render(); }""")
        page.click("#btn-cu-submit")
        check("all four right without a click scores the perfect 32",
              page.inner_text(".cu-score").split("/")[0].strip() == "32", page.inner_text(".cu-score"))

        print("\n== images actually load from moma.org ==")
        page.goto(url); page.click("#btn-start"); ready(page)
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
