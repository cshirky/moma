/* Chronology — order MoMA paintings by year.
 *
 * Reads PAINTINGS from data.js (MoMA paintings on view, with an image and a
 * confidently-parsed year). Five stages of increasing difficulty: more
 * paintings each time, and a smaller guaranteed gap between their years.
 *
 * Every stage deals its paintings straight into the column in the wrong
 * order, so the task is pure reordering. Each input has exactly one meaning:
 *   - drag a painting          -> move it, shifting the others around it
 *   - click a painting         -> open it larger
 *   - arrow keys on a painting -> move it up or down one place
 */

'use strict';

/* Each stage draws `n` paintings by `n` different artists whose years are all
 * at least `gap` apart. Shrinking the gap is what makes later stages hard:
 * twenty years apart is usually legible from style alone, two years is not.
 * Every row here was simulated against the real pool before being fixed —
 * re-run test_game.py after changing them, since a small pool can make an
 * aggressive row unsatisfiable. */
const STAGES = [
  { n: 3, gap: 25 },
  { n: 4, gap: 20 },
  { n: 5, gap: 15 },
  { n: 6, gap: 10 },
  { n: 7, gap: 5 }
];

/* The worst a stage can go is n-1 moves (getting the order exactly backwards),
 * so a clean run across the ladder is worth the sum of those. Derived from
 * STAGES rather than hard-coded, so changing the ladder can't leave the score
 * out of step with what's achievable. */
const MAX_SCORE = STAGES.reduce((t, s) => t + s.n - 1, 0);

/* Bands, highest first.
 *
 * 18 is a meaningful cut: scoring 18 or more is only reachable with at least
 * three stages solved outright, since three imperfect stages cost at least
 * three moves between them. Verified exhaustively over every move-split.
 *
 * The 9 floor sits on the random median: random play averages 8.8 of 20
 * (median 9), so 57% of random runs reach it, hence "Nearly Random". Only
 * 4.4% of random runs reach 12, so OK and above means better than guessing. */
const BANDS = [
  { min: 20, label: 'Perfect' },
  { min: 18, label: 'Excellent' },
  { min: 16, label: 'Very Good' },
  { min: 14, label: 'Good' },
  { min: 12, label: 'OK' },
  { min: 9,  label: 'Nearly Random' },
  { min: 0,  label: 'Worse than Random' }
];

const el = (id) => document.getElementById(id);

const state = {
  stageIndex: 0,
  works: [],        // this stage's paintings
  order: [],        // painting ids, top (most recent) to bottom (oldest)
  cardEls: new Map(),
  slotEls: [],
  locked: false,
  pendingImages: 0,
  loadTimer: null,
  results: []
};

/* ---------------------------------------------------------------- drawing */

function shuffled(list) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* Greedy sampling with restarts: shuffle, then walk the pool taking any work
 * that clears the year gap against everything taken so far and doesn't repeat
 * an artist. Cheap, and the constraints are loose enough that it lands well
 * inside the retry budget every time. */
function drawWorks(pool, n, gap, tries) {
  for (let t = 0; t < tries; t++) {
    const order = shuffled(pool);
    const chosen = [];
    const artists = new Set();
    for (const w of order) {
      if (artists.has(w.artist)) continue;
      if (chosen.every((c) => Math.abs(c.year - w.year) >= gap)) {
        chosen.push(w);
        artists.add(w.artist);
        if (chosen.length === n) return chosen;
      }
    }
  }
  return null;
}

function drawStage(stage) {
  const fresh = PAINTINGS.filter((w) => !state.usedIds.has(w.id));
  // Prefer paintings this playthrough hasn't shown yet, but never fail the
  // stage over it — fall back to the whole pool, then to a relaxed gap.
  return drawWorks(fresh, stage.n, stage.gap, 300)
      || drawWorks(PAINTINGS, stage.n, stage.gap, 300)
      || drawWorks(PAINTINGS, stage.n, Math.max(1, stage.gap - 2), 400);
}
state.usedIds = new Set();

function correctOrder(works) {
  return works.slice().sort((a, b) => b.year - a.year).map((w) => w.id);
}

/* Deal in a wrong order — an accidentally-solved board would hand the player
 * the stage for nothing. */
function dealtOrder(works) {
  const answer = correctOrder(works).join();
  let ids;
  do {
    ids = shuffled(works.map((w) => w.id));
  } while (ids.join() === answer);
  return ids;
}

/* ------------------------------------------------------------------ cards */

function buildCard(work) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'card';
  btn.dataset.id = work.id;

  const frame = document.createElement('span');
  frame.className = 'card-img';

  const img = document.createElement('img');
  img.src = work.image;
  img.alt = '';
  img.draggable = false;
  // MoMA serves these directly, but stripping the referrer avoids any
  // hotlink check and costs nothing.
  img.referrerPolicy = 'no-referrer';
  img.addEventListener('load', imageSettled);
  img.addEventListener('error', () => {
    frame.classList.add('img-missing');
    frame.textContent = 'Image unavailable';
    imageSettled();
  });
  frame.appendChild(img);
  btn.appendChild(frame);

  const zoom = document.createElement('span');
  zoom.className = 'card-zoom';
  zoom.setAttribute('aria-hidden', 'true');
  zoom.textContent = '⤢';
  btn.appendChild(zoom);

  // Filled in at reveal time; sits beside the painting rather than over it.
  const info = document.createElement('span');
  info.className = 'card-info';
  btn.appendChild(info);
  return btn;
}

/* Paintings are hotlinked from moma.org, so a stage would otherwise pop in
 * card by card. Hold the board until every image of the stage has settled
 * (loaded or failed), with a ceiling so a slow image can't strand the game. */
function imageSettled() {
  if (state.pendingImages > 0 && --state.pendingImages === 0) boardReady();
}

function boardReady() {
  state.pendingImages = 0;
  clearTimeout(state.loadTimer);
  el('screen-play').classList.remove('is-loading');
  render();
}

/* Warm the browser cache for the next stage while the player reads the
 * current reveal, so the next board is usually instant. */
function preload(works) {
  works.forEach((w) => { new Image().src = w.image; });
}

/* ------------------------------------------------------------ reordering */

/* The single funnel every move goes through, whatever the input was. Lifting
 * a painting out and re-inserting it shifts everything between, which is how
 * people expect "put this one above that one" to behave — a straight swap
 * would fling the displaced painting across the board. */
function moveTo(id, targetIndex) {
  if (state.locked) return;
  const from = state.order.indexOf(id);
  const to = Math.max(0, Math.min(state.order.length - 1, targetIndex));
  if (from === -1 || from === to) return;
  state.order.splice(from, 1);
  state.order.splice(to, 0, id);
  render();
}

function render() {
  state.slotEls.forEach((slotEl, i) => {
    const id = state.order[i];
    const card = state.cardEls.get(id);
    if (card.parentElement !== slotEl) slotEl.appendChild(card);
    card.setAttribute('aria-label',
      `Painting ${i + 1} of ${state.order.length}` +
      (i === 0 ? ', currently placed as most recent'
       : i === state.order.length - 1 ? ', currently placed as oldest' : '') +
      '. Arrow keys move it, Enter opens it larger.');
    slotEl.setAttribute('aria-label', `Position ${i + 1} of ${state.order.length}`);
  });
  el('btn-submit').disabled = state.locked || state.pendingImages > 0;
}

/* --------------------------------------------------------- pointer dragging */

const drag = { id: null, active: false, ghost: null, startX: 0, startY: 0, noDrag: false };
const DRAG_THRESHOLD = 6;   // px of travel before a click becomes a drag

function slotIndexFromPoint(x, y) {
  const node = document.elementFromPoint(x, y);
  const slot = node && node.closest('.slot');
  return slot ? Number(slot.dataset.index) : -1;
}

function onPointerDown(ev) {
  if (state.pendingImages > 0 || ev.button > 0) return;
  const card = ev.target.closest('.card');
  if (!card) return;
  drag.id = card.dataset.id;
  drag.active = false;
  // Once a stage is answered the order is fixed, but clicking a painting to
  // see it larger still works — that's when people most want a closer look.
  drag.noDrag = state.locked;
  drag.startX = ev.clientX;
  drag.startY = ev.clientY;
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerUp);
}

function onPointerMove(ev) {
  if (!drag.id) return;
  if (drag.noDrag) return;
  if (!drag.active) {
    if (Math.hypot(ev.clientX - drag.startX, ev.clientY - drag.startY) < DRAG_THRESHOLD) return;
    startDrag();
  }
  drag.ghost.style.left = ev.clientX + 'px';
  drag.ghost.style.top = ev.clientY + 'px';

  // Reorder live under the pointer, so the column previews the result.
  const over = slotIndexFromPoint(ev.clientX, ev.clientY);
  if (over !== -1 && over !== state.order.indexOf(drag.id)) moveTo(drag.id, over);
}

function startDrag() {
  const card = state.cardEls.get(drag.id);
  const rect = card.getBoundingClientRect();
  const ghost = card.cloneNode(true);
  ghost.className = 'drag-ghost';
  ghost.style.width = rect.width + 'px';
  ghost.style.height = rect.height + 'px';
  el('drag-layer').appendChild(ghost);
  card.classList.add('is-held');
  drag.ghost = ghost;
  drag.active = true;
  document.body.classList.add('is-dragging');
}

function onPointerUp() {
  window.removeEventListener('pointermove', onPointerMove);
  window.removeEventListener('pointerup', onPointerUp);
  window.removeEventListener('pointercancel', onPointerUp);
  const id = drag.id;
  if (!id) return;

  if (drag.active) {
    state.cardEls.get(id).classList.remove('is-held');
    drag.ghost.remove();
    document.body.classList.remove('is-dragging');
  } else {
    // No travel: it was a click, which means "show me this one bigger".
    openLightbox(id);
  }
  drag.id = null;
  drag.active = false;
  drag.ghost = null;
  drag.noDrag = false;
}

/* Arrow keys nudge a focused painting up or down one place. */
function onBoardKey(ev) {
  const card = ev.target.closest('.card');
  if (!card) return;
  const id = card.dataset.id;
  if (ev.key === 'Enter' || ev.key === ' ') {
    ev.preventDefault();
    openLightbox(id);
    return;
  }
  if (state.locked) return;
  const delta = ev.key === 'ArrowUp' ? -1 : ev.key === 'ArrowDown' ? 1 : 0;
  if (!delta) return;
  ev.preventDefault();
  moveTo(id, state.order.indexOf(id) + delta);
  state.cardEls.get(id).focus();
}

/* ------------------------------------------------------------- lightbox */

// The enlarged painting fills 95% of the screen's width or height, whichever
// keeps all of it in view. Zoom scales that fitted size up to LB_MAX_ZOOM and
// pan slides it; both live in one transform. MoMA's images are at most 1024px,
// so zoom magnifies what is there rather than fetching anything finer.
const LB_FILL = 0.95;
const LB_MAX_ZOOM = 6;
const LB_STEP = 1.6;          // the +/- buttons and keys
const LB_TAP_ZOOM = 2.5;      // clicking the painting zooms in to this
const lb = { scale: 1, x: 0, y: 0, w: 0, h: 0, pointers: new Map(), gesture: null, downOnImage: false };

function openLightbox(id) {
  const work = state.works.find((w) => w.id === id);
  if (!work) return;
  const box = el('lightbox');
  const img = el('lightbox-img');
  lb.scale = 1; lb.x = 0; lb.y = 0;
  box.classList.add('is-loading');
  img.onload = () => { box.classList.remove('is-loading'); fitLightbox(); };
  img.src = work.image;
  const hint = '<span class="lb-hint">Click the painting to zoom in, scroll or pinch to zoom, drag to look around</span>';
  // Before the stage is answered the caption would give the game away, so
  // the enlarged view stays deliberately anonymous until then.
  el('lightbox-caption').innerHTML = (state.locked
    ? `<span class="lb-year">${work.year}</span>` +
      `<span class="lb-title">${escapeHtml(work.title)}</span>` +
      `<span class="lb-artist">${escapeHtml(work.artist)}` +
      (work.artistBio ? ` <span class="lb-bio">${escapeHtml(work.artistBio)}</span>` : '') +
      `</span>` +
      (work.medium ? `<span class="lb-medium">${escapeHtml(work.medium)}</span>` : '') +
      (work.gallery ? `<span class="lb-where">${escapeHtml(work.gallery)}</span>` : '') +
      (work.url ? `<a class="lb-link" href="${escapeHtml(work.url)}" target="_blank" rel="noopener">View at moma.org</a>` : '')
    : '<span class="lb-hidden">Title and date hidden until you submit</span>') + hint;
  box.hidden = false;
  setZoom(1, 0, 0);
  el('lightbox-close').focus();
}

function closeLightbox() {
  const box = el('lightbox');
  box.hidden = true;
  box.classList.remove('is-panning', 'is-zoomed');
  el('lightbox-img').onload = null;
  el('lightbox-img').removeAttribute('src');
  lb.pointers.clear();
  lb.gesture = null;
}

/* Size the image so all of it fits at 95% of the limiting dimension. Runs on
   load and on resize; the current zoom and pan are kept, re-clamped. */
function fitLightbox() {
  const box = el('lightbox');
  const img = el('lightbox-img');
  if (box.hidden || !img.naturalWidth) return;
  const k = Math.min(LB_FILL * box.clientWidth / img.naturalWidth,
                     LB_FILL * box.clientHeight / img.naturalHeight);
  lb.w = img.naturalWidth * k;
  lb.h = img.naturalHeight * k;
  img.style.width = `${lb.w}px`;
  img.style.height = `${lb.h}px`;
  setZoom(lb.scale, lb.x, lb.y);
}

const clampZoom = (s) => Math.min(LB_MAX_ZOOM, Math.max(1, s));

/* Apply a zoom and pan. Pan is clamped so a zoomed painting can't be dragged
   away from the edges of the screen, and stays centred while it still fits. */
function setZoom(scale, x, y, animate = false) {
  const box = el('lightbox');
  lb.scale = clampZoom(scale);
  const maxX = Math.max(0, (lb.w * lb.scale - box.clientWidth) / 2);
  const maxY = Math.max(0, (lb.h * lb.scale - box.clientHeight) / 2);
  lb.x = Math.min(maxX, Math.max(-maxX, x));
  lb.y = Math.min(maxY, Math.max(-maxY, y));
  box.classList.toggle('is-animating', animate);
  box.classList.toggle('is-zoomed', lb.scale > 1.001);
  el('lightbox-img').style.transform = `translate(${lb.x}px, ${lb.y}px) scale(${lb.scale})`;
  el('lb-zoom-out').disabled = lb.scale <= 1.001;
  el('lb-zoom-in').disabled = lb.scale >= LB_MAX_ZOOM - 0.001;
}

/* Zoom to `scale`, keeping the point of the painting under (px, py) still. */
function zoomAt(scale, px, py, animate = false) {
  const box = el('lightbox');
  const cx = box.clientWidth / 2, cy = box.clientHeight / 2;
  if (px === undefined) { px = cx; py = cy; }
  const next = clampZoom(scale);
  const r = next / lb.scale;
  setZoom(next, (px - cx) - r * (px - cx - lb.x), (py - cy) - r * (py - cy - lb.y), animate);
}

/* Snapshot for a gesture: where the pointers are, and the zoom they started
   from. Retaken whenever a finger lands or lifts, so pinch hands over to pan
   without a jump. */
function lbGesture(moved = false) {
  const pts = [...lb.pointers.values()];
  const mid = {
    x: pts.reduce((t, p) => t + p.x, 0) / pts.length,
    y: pts.reduce((t, p) => t + p.y, 0) / pts.length,
  };
  const dist = pts.length > 1 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0;
  return { mid, dist, scale: lb.scale, x: lb.x, y: lb.y, moved };
}

function onLbPointerDown(ev) {
  lb.downOnImage = ev.target === el('lightbox-img');
  if (!lb.downOnImage) return;
  ev.preventDefault();
  ev.target.setPointerCapture(ev.pointerId);
  lb.pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
  lb.gesture = lbGesture(lb.pointers.size > 1);
}

function onLbPointerMove(ev) {
  if (!lb.pointers.has(ev.pointerId)) return;
  lb.pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
  const g = lb.gesture;
  const now = lbGesture();
  if (!g.moved && Math.hypot(now.mid.x - g.mid.x, now.mid.y - g.mid.y) < 6) return;
  g.moved = true;
  const box = el('lightbox');
  if (g.dist && now.dist) {
    // Pinch: scale by the change in finger spread, about the fingers' midpoint.
    const cx = box.clientWidth / 2, cy = box.clientHeight / 2;
    const next = clampZoom(g.scale * now.dist / g.dist);
    const r = next / g.scale;
    setZoom(next, (now.mid.x - cx) - r * (g.mid.x - cx - g.x), (now.mid.y - cy) - r * (g.mid.y - cy - g.y));
  } else if (lb.scale > 1.001) {
    box.classList.add('is-panning');
    setZoom(lb.scale, g.x + now.mid.x - g.mid.x, g.y + now.mid.y - g.mid.y);
  }
}

function onLbPointerUp(ev) {
  if (!lb.pointers.has(ev.pointerId)) return;
  lb.pointers.delete(ev.pointerId);
  const g = lb.gesture;
  if (lb.pointers.size) { lb.gesture = lbGesture(true); return; }
  lb.gesture = null;
  el('lightbox').classList.remove('is-panning');
  // A click that didn't travel zooms in on that spot, or back out to fit.
  if (ev.type === 'pointerup' && !g.moved) {
    if (lb.scale > 1.001) setZoom(1, 0, 0, true);
    else zoomAt(LB_TAP_ZOOM, ev.clientX, ev.clientY, true);
  }
}

function onLbKey(ev) {
  if (ev.key === 'Escape') { closeLightbox(); return; }
  if (ev.target.closest('a')) return;
  const pan = 80;
  const moves = {
    '+': () => zoomAt(lb.scale * LB_STEP, undefined, undefined, true),
    '=': () => zoomAt(lb.scale * LB_STEP, undefined, undefined, true),
    '-': () => zoomAt(lb.scale / LB_STEP, undefined, undefined, true),
    '0': () => setZoom(1, 0, 0, true),
    ArrowLeft: () => setZoom(lb.scale, lb.x + pan, lb.y, true),
    ArrowRight: () => setZoom(lb.scale, lb.x - pan, lb.y, true),
    ArrowUp: () => setZoom(lb.scale, lb.x, lb.y + pan, true),
    ArrowDown: () => setZoom(lb.scale, lb.x, lb.y - pan, true),
  };
  if (!moves[ev.key]) return;
  ev.preventDefault();
  moves[ev.key]();
}

/* ------------------------------------------------------------ stage set-up */

function startStage(index) {
  const stage = STAGES[index];
  state.stageIndex = index;
  state.works = drawStage(stage);
  state.works.forEach((w) => state.usedIds.add(w.id));
  // Replayed stages replace their paintings rather than adding to the run.
  state.seen = state.seen.filter((s) => s.stage !== index)
                         .concat(state.works.map((w) => ({ stage: index, work: w })));
  state.order = dealtOrder(state.works);
  state.cardEls = new Map();
  state.slotEls = [];
  state.locked = false;
  state.pendingImages = stage.n;

  const play = el('screen-play');
  play.classList.add('is-loading');
  clearTimeout(state.loadTimer);
  state.loadTimer = setTimeout(boardReady, 6000);
  play.style.setProperty('--n', String(stage.n));

  el('stage-label').textContent = `Stage ${index + 1} of ${STAGES.length}`;
  el('stage-rule').textContent =
    `${stage.n} paintings · at least ${stage.gap} years apart`;
  el('instruction').textContent = 'Drag these into the right order';

  const pips = el('pips');
  pips.innerHTML = '';
  STAGES.forEach((_, i) => {
    const li = document.createElement('li');
    const past = state.results[i];
    if (past) li.className = 'is-' + outcome(past);
    else if (i === index) li.className = 'is-current';
    pips.appendChild(li);
  });

  const column = el('column');
  column.innerHTML = '';
  for (let i = 0; i < stage.n; i++) {
    const li = document.createElement('li');
    li.className = 'slot';
    li.dataset.index = String(i);
    column.appendChild(li);
    state.slotEls.push(li);
  }

  state.works.forEach((w) => state.cardEls.set(w.id, buildCard(w)));
  // An image served from cache can complete before its load listener is
  // attached; count those now so the board isn't held for events that
  // will never fire.
  state.works.forEach((w) => {
    const img = state.cardEls.get(w.id).querySelector('img');
    if (img && img.complete) imageSettled();
  });

  el('verdict').textContent = '';
  el('verdict').className = 'verdict';
  el('btn-submit').hidden = false;
  el('btn-next').hidden = true;
  el('btn-shuffle').hidden = false;
  el('btn-show-order').hidden = true;

  render();
}

/* -------------------------------------------------------------- scoring */

/* Solved / one move away / further off. Everything that reports a stage's
 * outcome derives its colour from this, so they always agree. */
function outcome(result) {
  if (!result) return 'none';
  if (result.perfect) return 'pass';
  return result.moves === 1 ? 'close' : 'fail';
}

/* Exact-position marking is both harsh and inconsistent for an ordering task:
 * dragging the newest painting to the bottom scores zero despite being one
 * drag from correct, while swapping the two end paintings scores well despite
 * being twice as far off. So a stage is scored two ways instead.
 *
 * keepSet() finds the largest group of paintings already in the right order
 * relative to each other — everything outside it has to move, and that count
 * is provably the minimum number of drags needed. n is at most 7, so we can
 * check every subset and break ties toward keeping paintings that are also in
 * their exact final position, which is what a player reads as "already right".
 */
function keepSet(order, answer) {
  const rank = new Map(answer.map((id, i) => [id, i]));
  const seq = order.map((id) => rank.get(id));
  let best = null;
  for (let mask = 0; mask < (1 << seq.length); mask++) {
    const idx = [];
    for (let i = 0; i < seq.length; i++) if (mask & (1 << i)) idx.push(i);
    let rising = true;
    for (let i = 1; i < idx.length; i++) {
      if (seq[idx[i]] <= seq[idx[i - 1]]) { rising = false; break; }
    }
    if (!rising) continue;
    const settled = idx.filter((i) => seq[i] === i).length;
    if (!best || idx.length > best.len ||
        (idx.length === best.len && settled > best.settled)) {
      best = { len: idx.length, settled, idx };
    }
  }
  return new Set(best.idx);
}

/* How many "which came first?" calls the player got right — the task exactly
 * as the game describes it to them. */
function pairScore(order, answer) {
  const rank = new Map(answer.map((id, i) => [id, i]));
  let right = 0, total = 0;
  for (let i = 0; i < order.length; i++) {
    for (let j = i + 1; j < order.length; j++) {
      total++;
      if (rank.get(order[i]) < rank.get(order[j])) right++;
    }
  }
  return { right, total };
}

/* -------------------------------------------------------------- submitting */

/* Both Submit and "See the right order" end the stage the same way. The only
 * difference is that giving up re-sorts the column into the true sequence and
 * drops the per-card marks, which would be meaningless once every painting is
 * sitting where it belongs. Either way the score comes from the arrangement
 * the player actually built, so asking for the answer costs what it should. */
function finishStage() {
  if (state.locked || state.pendingImages > 0) return;
  state.locked = true;

  const answer = correctOrder(state.works);
  const keep = keepSet(state.order, answer);
  const moves = state.order.length - keep.size;
  const pairs = pairScore(state.order, answer);
  const perfect = moves === 0;

  state.results[state.stageIndex] = {
    perfect, moves, n: state.order.length,
    pairsRight: pairs.right, pairsTotal: pairs.total
  };

  // Labels are a property of the painting, not of where it was put, so they
  // go on before anything is re-sorted.
  state.works.forEach((work) => {
    state.cardEls.get(work.id).querySelector('.card-info').innerHTML =
      `<span class="r-year">${work.year}</span>` +
      `<span class="r-title">${escapeHtml(work.title)}</span><br>` +
      `<span class="r-artist">${escapeHtml(work.artist)}</span>` +
      (work.gallery ? `<span class="r-where">${escapeHtml(work.gallery)}</span>` : '');
  });

  state.order.forEach((id, i) => {
    const stays = keep.has(i);
    const target = answer.indexOf(id) + 1;
    const up = target < i + 1;
    // A misplaced painting is ringed on the side it has to travel towards —
    // red across the top means it belongs higher up the column.
    state.slotEls[i].classList.add('revealed',
      stays ? 'ok' : 'no', ...(stays ? [] : [up ? 'needs-up' : 'needs-down']));

    const mark = document.createElement('span');
    mark.className = `mark ${stays ? 'ok' : 'no'}`;
    mark.textContent = stays ? '✓' : `${up ? '↑' : '↓'} ${target}`;
    mark.title = stays ? 'In the right order' : `Belongs in position ${target}`;
    state.cardEls.get(id).appendChild(mark);
  });

  const how = outcome(state.results[state.stageIndex]);
  const verdict = el('verdict');
  verdict.className = `verdict is-${how}`;
  verdict.innerHTML = perfect
    ? '<span class="v-head">Correct — that’s the right order.</span>' +
      '<span class="v-sub">Every painting in its place.</span>'
    : `<span class="v-head">${moves === 1 ? 'One move' : moves + ' moves'} from correct.</span>` +
      '<span class="v-sub">A red edge along the top means that painting belongs ' +
      'higher up; along the bottom, lower down.</span>';
  // The stage is already scored and the board is locked, so the only useful
  // thing left to offer is the answer itself.
  el('btn-show-order').hidden = perfect;

  el('instruction').textContent = 'Click any painting to see it larger';
  el('pips').children[state.stageIndex].className =
    'is-' + outcome(state.results[state.stageIndex]);

  const upcoming = STAGES[state.stageIndex + 1];
  if (upcoming) {
    const peek = drawStage(upcoming);
    if (peek) preload(peek);
  }

  el('btn-submit').hidden = true;
  el('btn-shuffle').hidden = true;
  const next = el('btn-next');
  next.hidden = false;
  next.textContent = state.stageIndex === STAGES.length - 1 ? 'See results' : 'Next stage';
  next.focus();
}

/* Re-sort the column into the true sequence and strip the per-card marks,
 * which mean nothing once every painting sits where it belongs. Only ever
 * reached after a stage has been submitted and scored, so it changes what is
 * displayed and nothing else. */
function showCorrectOrder() {
  const r = state.results[state.stageIndex];
  state.order = correctOrder(state.works);
  render();

  state.slotEls.forEach((slot) => {
    slot.classList.remove('ok', 'no', 'needs-up', 'needs-down');
    slot.classList.add('revealed', 'shown');
  });
  state.cardEls.forEach((card) => {
    const mark = card.querySelector('.mark');
    if (mark) mark.remove();
  });

  const verdict = el('verdict');
  // Being shown the answer isn't a wrong answer, so it loses the red headline;
  // the pip still records how the attempt actually went.
  verdict.className = 'verdict is-shown';
  verdict.innerHTML = '<span class="v-head">This is the right order.</span>' +
    `<span class="v-sub">${r.perfect
      ? 'Your arrangement already matched it.'
      : `You were ${r.moves === 1 ? 'one move' : r.moves + ' moves'} away from the right order.`}</span>`;
  el('btn-show-order').hidden = true;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ----------------------------------------------------------------- results */

function showResults() {
  show('screen-done');
  const done = state.results.filter(Boolean);
  const passed = done.filter((r) => r.perfect).length;
  const moves = done.reduce((t, r) => t + r.moves, 0);

  el('done-title').textContent =
    passed === STAGES.length ? 'Perfect run.' :
    passed === 0 ? 'That was a hard one.' :
    `${passed} of ${STAGES.length} stages solved.`;
  el('done-line').innerHTML = (moves === 0
    ? 'Perfect — every painting in the right order.'
    : `<strong>${moves === 1 ? 'One move' : moves + ' moves'}</strong> from placing every painting correctly.`) +
    ' Each stage draws a fresh set of paintings from MoMA — play again for a different run.';

  const score = MAX_SCORE - moves;
  el('score-num').textContent = String(score);
  el('score-of').textContent = ` of ${MAX_SCORE}`;
  const band = BANDS.find((b) => score >= b.min);
  el('score-band').textContent = band.label;
  // Colour follows the band boundaries: green for Perfect and Excellent,
  // amber down to OK, red once the label starts mentioning randomness.
  el('score-band').className = 'score-band ' +
    (score >= 18 ? 'is-pass' : score >= 12 ? 'is-close' : 'is-fail');

  buildVisitList();

  const list = el('scorecard');
  list.innerHTML = '';
  STAGES.forEach((stage, i) => {
    const r = state.results[i];
    const li = document.createElement('li');
    const how = outcome(r);
    const detail = !r ? '—'
      : r.perfect ? 'solved'
      : `${r.moves === 1 ? '1 move' : r.moves + ' moves'} away`;
    // The badge carries the move count, so a near miss reads as a near miss.
    const badge = !r ? '—' : r.perfect ? '✓' : String(r.moves);
    li.innerHTML =
      `<span class="sc-badge is-${how}">${badge}</span>` +
      `<span>Stage ${i + 1} — ${stage.n} paintings, ${stage.gap}+ years apart</span>` +
      `<span class="sc-detail">${detail}</span>`;
    list.appendChild(li);
  });
}

/* --------------------------------------------------- the closing painting list */

/* Every painting the run showed, merged out of its stages into one timeline,
 * newest first so it reads the same way round as the board did. */
function buildVisitList() {
  const works = state.seen.map((s) => s.work).sort((a, b) => b.year - a.year);
  el('visit-head').textContent =
    `Your ${works.length} paintings, newest to oldest`;

  const list = el('painting-list');
  list.innerHTML = '';
  works.forEach((w) => {
    const li = document.createElement('li');
    const id = `see-${w.id}`;
    li.innerHTML =
      `<input type="checkbox" id="${id}" data-id="${escapeHtml(w.id)}">` +
      `<img src="${escapeHtml(w.image)}" alt="" referrerpolicy="no-referrer">` +
      `<label for="${id}">` +
        `<span class="pl-year">${w.year}</span>` +
        `<span class="pl-title">${escapeHtml(w.title)}</span>` +
        `<span class="pl-artist">${escapeHtml(w.artist)}</span>` +
        (w.gallery ? `<span class="pl-where">${escapeHtml(w.gallery)}</span>` : '') +
      `</label>`;
    list.appendChild(li);
  });

  el('map-out').hidden = true;
  updateTickCount();
}

function ticked() {
  return Array.from(el('painting-list').querySelectorAll('input:checked'))
    .map((box) => state.seen.find((s) => s.work.id === box.dataset.id).work);
}

function updateTickCount() {
  const n = ticked().length;
  el('tick-count').textContent = n
    ? `${n} painting${n === 1 ? '' : 's'} ticked`
    : 'Nothing ticked yet';
  el('btn-map').disabled = n === 0;
}

/* "MoMA, Floor 5, 501" -> { floor: 5, room: "501" }. Some works give only a
 * floor, so the room is optional. */
function parseGallery(gallery) {
  const m = /Floor\s+(\w+)(?:\s*,\s*(.+))?$/i.exec(gallery || '');
  if (!m) return { floor: null, room: null, raw: gallery || '' };
  return { floor: Number(m[1]) || m[1], room: m[2] || null, raw: gallery };
}

/* MoMA hangs its collection chronologically from the fifth floor down, so
 * walking the floors in descending order is both the natural route and
 * roughly the order these paintings were made. */
function buildMap() {
  const chosen = ticked();
  const floors = new Map();
  chosen.forEach((w) => {
    const g = parseGallery(w.gallery);
    const key = g.floor === null ? 'Elsewhere in the museum' : `Floor ${g.floor}`;
    if (!floors.has(key)) floors.set(key, { sort: g.floor === null ? -1 : g.floor, rooms: [] });
    floors.get(key).rooms.push({ room: g.room, work: w });
  });

  const order = Array.from(floors.entries()).sort((a, b) => b[1].sort - a[1].sort);
  const rooms = new Set(chosen.map((w) => parseGallery(w.gallery).room).filter(Boolean));

  let html =
    `<h4>Your visit — ${chosen.length} painting${chosen.length === 1 ? '' : 's'}` +
    (rooms.size ? ` across ${rooms.size} room${rooms.size === 1 ? '' : 's'}` : '') + `</h4>` +
    `<p class="muted fine">MoMA hangs the collection chronologically from the top down, ` +
    `so this route runs highest floor first.</p>`;

  order.forEach(([floorName, data]) => {
    data.rooms.sort((a, b) => String(a.room).localeCompare(String(b.room), undefined, { numeric: true }));
    html += `<div class="map-floor"><h5>${escapeHtml(floorName)}</h5><ul>`;
    data.rooms.forEach(({ room, work }) => {
      html += `<li><span class="map-room">${room ? escapeHtml(room) : '—'}</span>` +
              `<span><em>${escapeHtml(work.title)}</em>, ${escapeHtml(work.artist)}, ${work.year}</span></li>`;
    });
    html += `</ul></div>`;
  });

  html += `<p class="muted fine">Gallery locations come from MoMA's own on-view data ` +
          `and can change when the museum rehangs — check moma.org before you go.</p>` +
          `<button class="btn" id="btn-print">Print this list</button>`;

  const out = el('map-out');
  out.innerHTML = html;
  out.hidden = false;
  el('btn-print').addEventListener('click', () => window.print());
  out.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/* ------------------------------------------------------------------- shell */

function show(id) {
  ['screen-start', 'screen-play', 'screen-done'].forEach((s) => {
    el(s).hidden = s !== id;
  });
  window.scrollTo(0, 0);
}

function newRun() {
  state.results = [];
  state.usedIds = new Set();
  state.seen = [];
  show('screen-play');
  startStage(0);
}

function init() {
  const ladder = el('ladder');
  STAGES.forEach((stage, i) => {
    const li = document.createElement('li');
    li.innerHTML = `<span class="lad-stage">Stage ${i + 1}</span>` +
                   `<span>${stage.n} paintings · ${stage.gap}+ years apart</span>`;
    ladder.appendChild(li);
  });

  const artists = new Set(PAINTINGS.map((w) => w.artist)).size;
  const years = PAINTINGS.map((w) => w.year);
  el('pool-note').textContent =
    `Drawing from ${PAINTINGS.length} paintings by ${artists} artists, ` +
    `${Math.min(...years)}–${Math.max(...years)}, all currently on view.`;

  el('painting-list').addEventListener('change', updateTickCount);
  el('btn-map').addEventListener('click', buildMap);

  el('btn-start').addEventListener('click', newRun);
  el('btn-again').addEventListener('click', newRun);
  el('btn-submit').addEventListener('click', finishStage);
  el('btn-show-order').addEventListener('click', showCorrectOrder);
  el('btn-shuffle').addEventListener('click', () => startStage(state.stageIndex));
  el('btn-next').addEventListener('click', () => {
    if (state.stageIndex === STAGES.length - 1) showResults();
    else startStage(state.stageIndex + 1);
  });

  const play = el('screen-play');
  play.addEventListener('pointerdown', onPointerDown);
  play.addEventListener('keydown', onBoardKey);

  const box = el('lightbox');
  el('lightbox-close').addEventListener('click', closeLightbox);
  el('lb-zoom-in').addEventListener('click', () => zoomAt(lb.scale * LB_STEP, undefined, undefined, true));
  el('lb-zoom-out').addEventListener('click', () => zoomAt(lb.scale / LB_STEP, undefined, undefined, true));
  // The painting zooms and pans; a click anywhere else dismisses — the
  // backdrop, the caption. A link inside the caption still follows (it opens
  // in a new tab), so closing underneath it costs nothing.
  box.addEventListener('click', (ev) => {
    if (lb.downOnImage || ev.target.closest('#lb-zoom-in, #lb-zoom-out')) {
      lb.downOnImage = false;
      return;
    }
    closeLightbox();
  });
  box.addEventListener('pointerdown', onLbPointerDown);
  box.addEventListener('pointermove', onLbPointerMove);
  box.addEventListener('pointerup', onLbPointerUp);
  box.addEventListener('pointercancel', onLbPointerUp);
  box.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    const dy = ev.deltaY * (ev.deltaMode === 1 ? 16 : 1);
    zoomAt(lb.scale * Math.exp(-dy * 0.0015), ev.clientX, ev.clientY);
  }, { passive: false });
  window.addEventListener('resize', fitLightbox);
  document.addEventListener('keydown', (ev) => {
    if (!box.hidden) onLbKey(ev);
  });
}

document.addEventListener('DOMContentLoaded', init);
