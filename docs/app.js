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
  { n: 3, gap: 20 },
  { n: 4, gap: 15 },
  { n: 5, gap: 10 },
  { n: 6, gap: 5 },
  { n: 7, gap: 2 }
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

function openLightbox(id) {
  const work = state.works.find((w) => w.id === id);
  if (!work) return;
  const box = el('lightbox');
  el('lightbox-img').src = work.image;
  // Before the stage is answered the caption would give the game away, so
  // the enlarged view stays deliberately anonymous until then.
  el('lightbox-caption').innerHTML = state.locked
    ? `<span class="lb-year">${work.year}</span>` +
      `<span class="lb-title">${escapeHtml(work.title)}</span>` +
      `<span class="lb-artist">${escapeHtml(work.artist)}` +
      (work.artistBio ? ` <span class="lb-bio">${escapeHtml(work.artistBio)}</span>` : '') +
      `</span>` +
      (work.medium ? `<span class="lb-medium">${escapeHtml(work.medium)}</span>` : '') +
      (work.gallery ? `<span class="lb-where">${escapeHtml(work.gallery)}</span>` : '') +
      (work.url ? `<a class="lb-link" href="${escapeHtml(work.url)}" target="_blank" rel="noopener">View at moma.org</a>` : '')
    : '<span class="lb-hidden">Title and date hidden until you submit</span>';
  box.hidden = false;
  el('lightbox-close').focus();
}

function closeLightbox() {
  el('lightbox').hidden = true;
  el('lightbox-img').removeAttribute('src');
}

/* ------------------------------------------------------------ stage set-up */

function startStage(index) {
  const stage = STAGES[index];
  state.stageIndex = index;
  state.works = drawStage(stage);
  state.works.forEach((w) => state.usedIds.add(w.id));
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
    if (past) li.className = past.perfect ? 'is-pass' : 'is-fail';
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

  render();
}

/* -------------------------------------------------------------- scoring */

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

function submit() {
  if (state.locked || state.pendingImages > 0) return;
  state.locked = true;

  const byId = new Map(state.works.map((w) => [w.id, w]));
  const answer = correctOrder(state.works);
  const keep = keepSet(state.order, answer);
  const moves = state.order.length - keep.size;
  const pairs = pairScore(state.order, answer);

  state.order.forEach((id, i) => {
    const work = byId.get(id);
    const stays = keep.has(i);
    state.slotEls[i].classList.add('revealed', stays ? 'ok' : 'no');

    const card = state.cardEls.get(id);
    const mark = document.createElement('span');
    const target = answer.indexOf(id) + 1;
    mark.className = `mark ${stays ? 'ok' : 'no'}`;
    // A painting that has to move says where it belongs, so the reveal is
    // a correction rather than just a verdict.
    mark.textContent = stays ? '✓' : `${target < i + 1 ? '↑' : '↓'} ${target}`;
    mark.title = stays ? 'In the right order' : `Belongs in position ${target}`;
    card.appendChild(mark);

    card.querySelector('.card-info').innerHTML =
      `<span class="r-year">${work.year}</span>` +
      `<span class="r-title">${escapeHtml(work.title)}</span><br>` +
      `<span class="r-artist">${escapeHtml(work.artist)}</span>` +
      (work.gallery ? `<span class="r-where">${escapeHtml(work.gallery)}</span>` : '');
  });

  const perfect = moves === 0;
  state.results[state.stageIndex] = {
    perfect, moves, n: state.order.length,
    pairsRight: pairs.right, pairsTotal: pairs.total
  };

  const verdict = el('verdict');
  verdict.className = `verdict ${perfect ? 'ok' : 'no'}`;
  verdict.innerHTML = perfect
    ? '<span class="v-head">Correct — that’s the right order.</span>' +
      `<span class="v-sub">All ${pairs.total} before-and-after calls right.</span>`
    : `<span class="v-head">${moves === 1 ? 'One move' : moves + ' moves'} from correct.</span>` +
      `<span class="v-sub">${pairs.right} of ${pairs.total} before-and-after calls right — ` +
      `move the marked painting${moves === 1 ? '' : 's'}.</span>`;
  el('instruction').textContent = 'Click any painting to see it larger';

  el('pips').children[state.stageIndex].className = perfect ? 'is-pass' : 'is-fail';

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

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ----------------------------------------------------------------- results */

function showResults() {
  show('screen-done');
  const done = state.results.filter(Boolean);
  const passed = done.filter((r) => r.perfect).length;
  const right = done.reduce((t, r) => t + r.pairsRight, 0);
  const total = done.reduce((t, r) => t + r.pairsTotal, 0);
  const moves = done.reduce((t, r) => t + r.moves, 0);

  el('done-title').textContent =
    passed === STAGES.length ? 'Perfect run.' :
    passed === 0 ? 'That was a hard one.' :
    `${passed} of ${STAGES.length} stages solved.`;
  // The run score is pairwise: across five stages there are 55 before-and-
  // after judgements, and that count scales sensibly as the stages grow.
  el('done-line').innerHTML =
    `<strong>${right} of ${total}</strong> before-and-after calls right` +
    (moves ? `, and ${moves === 1 ? 'one move' : moves + ' moves'} from a clean sweep` : '') +
    '. Each stage drew a fresh set of paintings on view at MoMA — play again for a different run.';

  const list = el('scorecard');
  list.innerHTML = '';
  STAGES.forEach((stage, i) => {
    const r = state.results[i];
    const li = document.createElement('li');
    const detail = !r ? '—'
      : r.perfect ? `solved · ${r.pairsRight}/${r.pairsTotal} calls`
      : `${r.moves === 1 ? '1 move' : r.moves + ' moves'} away · ${r.pairsRight}/${r.pairsTotal} calls`;
    li.innerHTML =
      `<span class="sc-badge ${r && r.perfect ? 'ok' : 'no'}">${r && r.perfect ? '✓' : '✕'}</span>` +
      `<span>Stage ${i + 1} — ${stage.n} paintings, ${stage.gap}+ years apart</span>` +
      `<span class="sc-detail">${detail}</span>`;
    list.appendChild(li);
  });
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

  el('btn-start').addEventListener('click', newRun);
  el('btn-again').addEventListener('click', newRun);
  el('btn-submit').addEventListener('click', submit);
  el('btn-shuffle').addEventListener('click', () => startStage(state.stageIndex));
  el('btn-next').addEventListener('click', () => {
    if (state.stageIndex === STAGES.length - 1) showResults();
    else startStage(state.stageIndex + 1);
  });

  const play = el('screen-play');
  play.addEventListener('pointerdown', onPointerDown);
  play.addEventListener('keydown', onBoardKey);

  el('lightbox-close').addEventListener('click', closeLightbox);
  el('lightbox').addEventListener('click', (ev) => {
    if (!ev.target.closest('.lightbox-figure') || ev.target.tagName === 'IMG') closeLightbox();
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && !el('lightbox').hidden) closeLightbox();
  });
}

document.addEventListener('DOMContentLoaded', init);
