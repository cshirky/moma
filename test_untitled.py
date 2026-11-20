#!/usr/bin/env python3
"""End-to-end test of Untitled: two browser contexts play one game against
dev_server.js (in-memory store, placeholder image generator, no API key).
Also probes the API directly to prove each player is only sent what they
may see."""
import json, socket, subprocess, sys, time, urllib.request, urllib.error
from playwright.sync_api import sync_playwright

fails = []
def check(label, cond, detail=""):
    print(("  PASS  " if cond else "  FAIL  ") + label + (f"  [{detail}]" if detail and not cond else ""))
    if not cond: fails.append(label)

def call(base, action, body, query=""):
    req = urllib.request.Request(f"{base}/api/untitled?action={action}{query}", data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req) as r: return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read())

def main():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0)); port = s.getsockname()[1]
    srv = subprocess.Popen(["node", "dev_server.js", str(port)], env={"PATH": "/usr/bin:/bin"})
    base = f"http://127.0.0.1:{port}"
    for _ in range(50):
        try: urllib.request.urlopen(base + "/untitled.html"); break
        except Exception: time.sleep(0.1)
    try:
        print("\n== API: who may see what ==")
        st, c = call(base, "create", {"ids": ["1", "2", "3", "4", "5"]})
        room, ta = c["room"], c["token"]
        check("create returns a room and the describer's token", st == 200 and len(room) == 5 and c["role"] == "A")
        st, j = call(base, "join", {}, f"&room={room}"); tb = j["token"]
        check("the second visitor becomes the guesser", j["role"] == "B")
        check("a third visitor is turned away", call(base, "join", {}, f"&room={room}")[0] == 409)
        check("a stranger can't read the room", call(base, "state", {"token": "nope"}, f"&room={room}")[0] == 403)
        a = call(base, "state", {"token": ta}, f"&room={room}")[1]
        b = call(base, "state", {"token": tb}, f"&room={room}")[1]
        check("the describer is told the target", a.get("target") in ["1", "2", "3", "4", "5"])
        check("the guesser is not", "target" not in b and "description" not in b)
        check("51 words are refused", call(base, "describe", {"token": ta, "text": " ".join(["w"] * 51)}, f"&room={room}")[0] == 400)
        check("the guesser can't describe", call(base, "describe", {"token": tb, "text": "hi"}, f"&room={room}")[0] == 403)
        check("no guessing before there is a picture", call(base, "guess", {"token": tb, "id": "1"}, f"&room={room}")[0] == 409)
        st, a2 = call(base, "describe", {"token": ta, "text": " ".join(["w"] * 50)}, f"&room={room}")
        check("exactly 50 words are accepted", st == 200 and a2["status"] == "ready", a2)
        b = call(base, "state", {"token": tb}, f"&room={room}")[1]
        check("now the guesser has a picture but still no description or target",
              b["image"] is True and "description" not in b and "target" not in b)
        a = call(base, "state", {"token": ta}, f"&room={room}")[1]
        check("the describer does not have the picture yet", a["image"] is False)
        img = lambda t: urllib.request.urlopen(f"{base}/api/untitled?action=image&room={room}&token={t}")
        check("the picture downloads for the guesser", img(tb).status == 200)
        try: img(ta); leaked = True
        except urllib.error.HTTPError as e: leaked = e.code != 403
        check("the picture is refused to the describer", not leaked)
        call(base, "guess", {"token": tb, "id": "1"}, f"&room={room}")
        a = call(base, "state", {"token": ta}, f"&room={room}")[1]
        check("after the guess both sides can see everything", a["status"] == "done" and a["image"] and a["description"])

        print("\n== two browsers play a game ==")
        with sync_playwright() as p:
            browser = p.chromium.launch()
            errors = []
            A = browser.new_context(viewport={"width": 1280, "height": 900}).new_page()
            B = browser.new_context(viewport={"width": 1280, "height": 900}).new_page()
            for pg in (A, B):
                pg.on("pageerror", lambda e: errors.append(str(e)))
                pg.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
            A.goto(base + "/untitled.html")
            A.click("#btn-un-new")
            A.wait_for_selector(".un-card")
            check("five paintings, all titled Untitled",
                  A.locator(".un-card").count() == 5 and
                  A.eval_on_selector_all(".un-title", "ts => ts.every(t => t.textContent === 'Untitled')"))
            check("no artist or real title is on the page before the guess",
                  A.eval_on_selector_all(".un-fact", "ts => ts.every(t => t.textContent === '')"))
            check("exactly one painting is highlighted for the describer", A.locator(".un-card.is-target").count() == 1)
            link = A.input_value("#un-link")
            B.goto(link)
            B.wait_for_selector(".un-card")
            check("the guesser sees the same five, in the same order",
                  A.eval_on_selector_all(".un-card", "cs => cs.map(c => c.dataset.id)") ==
                  B.eval_on_selector_all(".un-card", "cs => cs.map(c => c.dataset.id)"))
            check("the guesser has nothing highlighted and no writing box",
                  B.locator(".un-card.is-target").count() == 0 and B.locator("#un-describe").is_hidden())
            check("the guesser's cards are locked until there is a picture", B.locator(".un-card").first.is_disabled())
            A.fill("#un-text", " ".join(["word"] * 51)); 
            check("51 words turns the counter red and blocks Send",
                  A.locator("#un-count.is-bad").count() == 1 and A.locator("#btn-un-send").is_disabled())
            A.fill("#un-text", "Two hot orange bars over a field of grey, left bar leaning.")
            check("a valid description enables Send", A.locator("#btn-un-send").is_enabled())
            A.click("#btn-un-send")
            B.wait_for_selector("#un-ai:not([hidden])", timeout=15000)
            B.wait_for_function("document.getElementById('un-ai-img').naturalWidth > 0")
            check("the guesser gets the picture", True)
            check("the guesser can't see the description on the page",
                  "orange bars" not in B.inner_text("body"))
            check("the describer sees no picture", A.locator("#un-ai").is_hidden())
            check("the describer's writing box has gone", A.locator("#un-describe").is_hidden())
            target = A.evaluate("view.target")
            wrong = next(i for i in A.eval_on_selector_all(".un-card", "cs => cs.map(c => c.dataset.id)") if i != target)
            check("Guess is disabled until a painting is picked", B.locator("#btn-un-guess").is_disabled())
            B.click(f'.un-card[data-id="{wrong}"]')
            B.click("#btn-un-guess")
            A.wait_for_selector("#un-reveal:not([hidden])", timeout=15000)
            check("the describer's page reveals the guess was wrong", "Not this time" in A.inner_text("#un-status"))
            check("the description is shown at the end", "orange bars" in A.inner_text("#un-said") and "orange bars" in B.inner_text("#un-said"))
            check("the describer now sees the picture", A.locator("#un-ai").is_visible())
            check("the answer is marked green and the guess red on both pages",
                  A.locator(".un-card.is-answer").count() == 1 and B.locator(".un-card.is-miss").count() == 1)
            check("real details appear only for the answer and the guess", B.locator(".un-fact:not(:empty)").count() == 2)
            B.reload(); B.wait_for_selector("#un-reveal:not([hidden])")
            check("a refresh keeps the guesser's seat", B.locator("#un-role").inner_text().startswith("You are the guesser"))
            check("no console/page errors", not errors, "; ".join(errors[:3]))
            browser.close()
    finally:
        srv.terminate()
    print("\n" + ("ALL CHECKS PASSED" if not fails else f"{len(fails)} FAILED: {fails}"))
    return 1 if fails else 0

sys.exit(main())
