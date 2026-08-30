/* Chronology — order MoMA paintings by year.
 *
 * Reads PAINTINGS from data.js (MoMA paintings on view, with an image and a
 * confidently-parsed year). Five stages of increasing difficulty: more
 * paintings each time, and a smaller guaranteed gap between their years.
 *
 * Placement works three ways, all routed through moveCard():
 *   - pointer drag (mouse + touch, via pointer events)
 *   - click/tap a painting to pick it up, then click/tap where it goes
 *   - keyboard: slots and cards are focusable; Enter/Space does the same
 */

'use strict';

/* Each stage draws `n` paintings whose years are all at least `gap` apart, by
 * `n` different artists. Loosening the gap is what makes later stages hard:
 * with 15 years between works the order is usually legible from style alone;
 * with 2 years it comes down to real knowledge. Feasibility of every row was
 * simulated against the actual pool before these numbers were fixed. */
const STAGES = [
  { n: 3, gap: 15 },
  { n: 4, gap: 10 },
  { n: 5, gap: 6 },
  { n: 6, gap: 4 },
  { n: 7, gap: 2 }
];

const el = (id) => document.getElementById(id);

const state = {
  stageIndex: 0,
  works: [],        // this stage's paintings, in no particular order
  slots: [],        // length n; each entry a painting id or null
  tray: [],         // painting ids not yet placed
  cardEls: new Map(),
  slotEls: [],
  locked: false,
  selectedId: null,
  pendingImages: 0,
  loadTimer: null,
  usedIds: new Set(),   // don't repeat a painting within one playthrough
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

/* ------------------------------------------------------------------ cards */

function buildCard(work) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'card';
  btn.dataset.id = work.id;
  btn.setAttribute('aria-label', 'Painting, not yet placed');

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

/* ----------------------------------------------------------- move + render */

function refOf(id) {
  const slotIndex = state.slots.indexOf(id);
  if (slotIndex !== -1) return { zone: 'slot', index: slotIndex };
  return { zone: 'tray' };
}

/* The single funnel every placement goes through, whatever the input was.
 * Dropping onto an occupied slot swaps: the sitting tenant takes the moving
 * card's old seat, or goes back to the tray if it came from there. */
function moveCard(id, target) {
  if (state.locked) return;
  const from = refOf(id);
  if (target.zone === 'slot' && from.zone === 'slot' && from.index === target.index) return;

  // lift the card out of wherever it is
  if (from.zone === 'slot') state.slots[from.index] = null;
  else state.tray = state.tray.filter((x) => x !== id);

  if (target.zone === 'tray') {
    if (!state.tray.includes(id)) state.tray.push(id);
  } else {
    const tenant = state.slots[target.index];
    if (tenant) {
      if (from.zone === 'slot') state.slots[from.index] = tenant;
      else if (!state.tray.includes(tenant)) state.tray.push(tenant);
    }
    state.slots[target.index] = id;
  }

  state.selectedId = null;
  render();
}

function render() {
  const tray = el('tray');
  const filled = state.slots.filter(Boolean).length;

  state.slotEls.forEach((slotEl, i) => {
    const id = state.slots[i];
    slotEl.classList.toggle('is-empty', !id);
    slotEl.classList.toggle('is-filled', !!id);
    if (id) {
      const card = state.cardEls.get(id);
      if (card.parentElement !== slotEl) slotEl.appendChild(card);
      card.setAttribute('aria-label', `Painting in position ${i + 1} of ${state.slots.length}`);
    }
    slotEl.setAttribute('aria-label',
      `Position ${i + 1} of ${state.slots.length}` +
      (i === 0 ? ', most recent' : i === state.slots.length - 1 ? ', oldest' : '') +
      (id ? ', filled' : ', empty'));
  });

  state.tray.forEach((id) => {
    const card = state.cardEls.get(id);
    if (card.parentElement !== tray) tray.appendChild(card);
    card.setAttribute('aria-label', 'Painting, not yet placed');
  });

  state.cardEls.forEach((card, id) => {
    card.classList.toggle('is-selected', state.selectedId === id);
  });

  tray.classList.toggle('is-empty', state.tray.length === 0);
  el('btn-submit').disabled = filled !== state.slots.length || state.locked
                              || state.pendingImages > 0;
  el('tray-label').textContent = state.tray.length
    ? `Tray — ${state.tray.length} to place`
    : 'Tray';
}

/* --------------------------------------------------------- pointer dragging */

const drag = { id: null, active: false, ghost: null, startX: 0, startY: 0, target: null };
const DRAG_THRESHOLD = 6;   // px of travel before a tap becomes a drag

function targetFromPoint(x, y) {
  const node = document.elementFromPoint(x, y);
  if (!node) return null;
  const slot = node.closest('.slot');
  if (slot) return { zone: 'slot', index: Number(slot.dataset.index), node: slot };
  const tray = node.closest('.tray');
  if (tray) return { zone: 'tray', node: tray };
  return null;
}

function highlight(target) {
  document.querySelectorAll('.is-over').forEach((n) => n.classList.remove('is-over'));
  if (target && target.node) target.node.classList.add('is-over');
}

function onPointerDown(ev) {
  if (state.locked || state.pendingImages > 0 || ev.button > 0) return;
  const card = ev.target.closest('.card');
  if (!card) return;
  drag.id = card.dataset.id;
  drag.active = false;
  drag.startX = ev.clientX;
  drag.startY = ev.clientY;
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerUp);
}

function onPointerMove(ev) {
  if (!drag.id) return;
  if (!drag.active) {
    if (Math.hypot(ev.clientX - drag.startX, ev.clientY - drag.startY) < DRAG_THRESHOLD) return;
    startDrag();
  }
  drag.ghost.style.left = ev.clientX + 'px';
  drag.ghost.style.top = ev.clientY + 'px';
  drag.target = targetFromPoint(ev.clientX, ev.clientY);
  highlight(drag.target);
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
}

function onPointerUp(ev) {
  window.removeEventListener('pointermove', onPointerMove);
  window.removeEventListener('pointerup', onPointerUp);
  window.removeEventListener('pointercancel', onPointerUp);
  const id = drag.id;
  if (!id) return;

  if (drag.active) {
    const card = state.cardEls.get(id);
    card.classList.remove('is-held');
    drag.ghost.remove();
    highlight(null);
    const target = drag.target || targetFromPoint(ev.clientX, ev.clientY);
    if (target) moveCard(id, target);
    else render();
  } else {
    // No travel: treat as a tap — select, or place onto the selection.
    if (state.selectedId && state.selectedId !== id) {
      moveCard(state.selectedId, refOf(id));
    } else {
      state.selectedId = state.selectedId === id ? null : id;
      render();
    }
  }
  drag.id = null;
  drag.active = false;
  drag.ghost = null;
  drag.target = null;
}

/* Clicking a slot or the tray commits whatever is currently picked up. */
function onZoneClick(ev) {
  if (state.locked || !state.selectedId) return;
  if (ev.target.closest('.card')) return;   // the card handler owns that
  const slot = ev.target.closest('.slot');
  if (slot) { moveCard(state.selectedId, { zone: 'slot', index: Number(slot.dataset.index) }); return; }
  if (ev.target.closest('.tray')) moveCard(state.selectedId, { zone: 'tray' });
}

function onZoneKey(ev) {
  if (ev.key !== 'Enter' && ev.key !== ' ') return;
  const slot = ev.target.closest('.slot');
  if (!slot || !state.selectedId) return;
  ev.preventDefault();
  moveCard(state.selectedId, { zone: 'slot', index: Number(slot.dataset.index) });
}

/* ------------------------------------------------------------ stage set-up */

function startStage(index) {
  const stage = STAGES[index];
  state.stageIndex = index;
  state.works = drawStage(stage);
  state.works.forEach((w) => state.usedIds.add(w.id));
  state.slots = new Array(stage.n).fill(null);
  state.tray = shuffled(state.works.map((w) => w.id));
  state.cardEls = new Map();
  state.slotEls = [];
  state.locked = false;
  state.selectedId = null;
  state.pendingImages = stage.n;

  const play = el('screen-play');
  play.classList.add('is-loading');
  clearTimeout(state.loadTimer);
  state.loadTimer = setTimeout(boardReady, 6000);
  play.style.setProperty('--n', String(stage.n));
  el('stage-label').textContent = `Stage ${index + 1} of ${STAGES.length}`;
  el('stage-rule').textContent =
    `${stage.n} paintings · at least ${stage.gap} year${stage.gap === 1 ? '' : 's'} apart`;

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
    li.className = 'slot is-empty';
    li.dataset.index = String(i);
    li.dataset.hint = i === 0 ? 'Most recent'
                    : i === stage.n - 1 ? 'Oldest'
                    : `Position ${i + 1}`;
    li.tabIndex = 0;
    li.setAttribute('role', 'button');
    column.appendChild(li);
    state.slotEls.push(li);
  }

  const tray = el('tray');
  tray.innerHTML = '';
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

/* -------------------------------------------------------------- submitting */

function submit() {
  if (state.locked || state.slots.some((s) => !s)) return;
  state.locked = true;
  state.selectedId = null;

  const byId = new Map(state.works.map((w) => [w.id, w]));
  const placed = state.slots.map((id) => byId.get(id));
  // Correct answer: newest first, oldest last.
  const correct = state.works.slice().sort((a, b) => b.year - a.year);

  let rightCount = 0;
  placed.forEach((work, i) => {
    const ok = work.id === correct[i].id;
    if (ok) rightCount++;
    const slot = state.slotEls[i];
    slot.classList.add('revealed', ok ? 'ok' : 'no');

    const card = state.cardEls.get(work.id);
    const mark = document.createElement('span');
    mark.className = `mark ${ok ? 'ok' : 'no'}`;
    mark.textContent = ok ? '✓' : '✕';
    card.appendChild(mark);

    card.querySelector('.card-info').innerHTML =
      `<span class="r-year">${work.year}</span>` +
      `<span class="r-title">${escapeHtml(work.title)}</span><br>` +
      `<span class="r-artist">${escapeHtml(work.artist)}</span>` +
      (work.gallery ? `<span class="r-where">${escapeHtml(work.gallery)}</span>` : '');
    card.style.cursor = 'default';
  });

  const perfect = rightCount === placed.length;
  state.results[state.stageIndex] = { perfect, rightCount, n: placed.length };

  const verdict = el('verdict');
  verdict.className = `verdict ${perfect ? 'ok' : 'no'}`;
  verdict.textContent = perfect
    ? 'Correct — that’s the right order.'
    : `Not quite — ${rightCount} of ${placed.length} in the right place.`;

  const pip = el('pips').children[state.stageIndex];
  pip.className = perfect ? 'is-pass' : 'is-fail';

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
  const passed = state.results.filter((r) => r && r.perfect).length;
  el('done-title').textContent =
    passed === STAGES.length ? 'Perfect run.' :
    passed === 0 ? 'That was a hard one.' :
    `${passed} of ${STAGES.length} stages solved.`;
  el('done-line').textContent =
    'Each stage drew a fresh set of paintings on view at MoMA. Play again for a different run.';

  const list = el('scorecard');
  list.innerHTML = '';
  STAGES.forEach((stage, i) => {
    const r = state.results[i];
    const li = document.createElement('li');
    li.innerHTML =
      `<span class="sc-badge ${r && r.perfect ? 'ok' : 'no'}">${r && r.perfect ? '✓' : '✕'}</span>` +
      `<span>Stage ${i + 1} — ${stage.n} paintings, ${stage.gap}+ years apart</span>` +
      `<span class="sc-detail">${r ? `${r.rightCount} of ${r.n} placed` : '—'}</span>`;
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

  el('btn-start').addEventListener('click', () => {
    state.results = [];
    state.usedIds = new Set();
    show('screen-play');
    startStage(0);
  });

  el('btn-submit').addEventListener('click', submit);
  el('btn-shuffle').addEventListener('click', () => startStage(state.stageIndex));
  el('btn-next').addEventListener('click', () => {
    if (state.stageIndex === STAGES.length - 1) showResults();
    else startStage(state.stageIndex + 1);
  });
  el('btn-again').addEventListener('click', () => {
    state.results = [];
    state.usedIds = new Set();
    show('screen-play');
    startStage(0);
  });

  const play = el('screen-play');
  play.addEventListener('pointerdown', onPointerDown);
  play.addEventListener('click', onZoneClick);
  play.addEventListener('keydown', onZoneKey);
}

document.addEventListener('DOMContentLoaded', init);
