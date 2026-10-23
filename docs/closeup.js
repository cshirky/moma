/* Close Up — four paintings, each shown as one small section, and four
   labels (title, artist, year) to drag onto them. Clicking a painting shows
   a bigger section of it and costs a point.

   Each painting is worth STEPS points, one per click it could still take
   before it is shown whole. A correctly labelled painting scores whatever is
   left; a wrong label scores nothing. So the perfect score, 4 x STEPS, is
   labelling all four from their first, smallest section. */

const N = 4;

/* Grid sizes, coarsening with each click, as [cells along the long side,
   cells along the short side]: a portrait painting starts as 8 rows by 4
   columns, a landscape one as 4 rows by 8. The last entry is the whole. */
const LEVELS = [[8, 4], [6, 4], [4, 4], [4, 3], [3, 3], [3, 2], [2, 2], [2, 1], [1, 1]];
const STEPS = LEVELS.length - 1;
const MAX_SCORE = N * STEPS;

/* Very long, thin paintings make sections too slender to read, so the pool
   leaves them out. */
const MAX_ASPECT = 2.5;

const state = {
  works: [],        // the four, in board order
  imgs: new Map(),  // id -> loaded HTMLImageElement
  level: {},        // id -> index into LEVELS
  anchor: {},       // id -> {x, y}: centre of the first section, 0..1
  labels: [],       // label ids (= work ids), tray order
  place: {},        // painting id -> label id, or null
  selected: null,   // label picked up by click/keyboard rather than drag
  locked: false,
  scored: null,     // per-painting points, once submitted
};

const workById = (id) => state.works.find((w) => w.id === id);

function grid(id, level) {
  const img = state.imgs.get(id);
  const portrait = img.naturalHeight > img.naturalWidth;
  const [long, short] = LEVELS[level];
  return portrait ? { rows: long, cols: short } : { rows: short, cols: long };
}

/* The visible section at a level (by default the painting's current one), as
   fractions of the image. Each bigger section is centred on the first one,
   nudged inward where it would run off the edge, so a click always widens
   the same view. */
function region(id, level = state.locked ? STEPS : state.level[id]) {
  const { rows, cols } = grid(id, level);
  const w = 1 / cols, h = 1 / rows;
  const a = state.anchor[id];
  return {
    x: Math.min(1 - w, Math.max(0, a.x - w / 2)),
    y: Math.min(1 - h, Math.max(0, a.y - h / 2)),
    w, h,
  };
}

/* A small white rectangle in the painting's proportions, with the section
   on view marked inside it, so the player knows where they are looking.
   It sits in a strip under the painting, beside the words saying how much
   is showing, so nothing covers the painting. The strip keeps its height
   when the map goes (the painting is whole), so the label spaces stay level
   across the row. */
const MAP_SIZE = 40;   // px along the long side

function mapHtml(id) {
  if (state.locked || state.level[id] >= STEPS) return '';
  const img = state.imgs.get(id);
  const k = MAP_SIZE / Math.max(img.naturalWidth, img.naturalHeight);
  const r = region(id);
  const pct = (v) => `${(v * 100).toFixed(2)}%`;
  return `<span class="cu-map" aria-hidden="true" style="width:${Math.round(img.naturalWidth * k)}px;` +
    `height:${Math.round(img.naturalHeight * k)}px"><span class="cu-map-box" style="left:${pct(r.x)};` +
    `top:${pct(r.y)};width:${pct(r.w)};height:${pct(r.h)}"></span></span>`;
}

/* How much of the painting is showing, in words. */
function shownLabel(id) {
  const level = state.locked ? STEPS : state.level[id];
  const [long, short] = LEVELS[level];
  return long * short === 1 ? 'Whole painting' : `1/${long * short} of the painting`;
}

/* The first section is a random cell from the busier half of the grid, so
   it is never a patch of bare canvas or frame. "Busy" is how much neighbouring
   pixels differ, which favours edges and texture over smooth gradients. If
   the pixels can't be read, any cell will do. */
function busyCells(img, rows, cols) {
  const all = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) all.push({ r, c, score: 0 });
  const W = cols * 16, H = rows * 16;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, W, H);
    const px = ctx.getImageData(0, 0, W, H).data;
    const lum = (x, y) => { const i = (y * W + x) * 4; return 0.3 * px[i] + 0.59 * px[i + 1] + 0.11 * px[i + 2]; };
    for (const cell of all) {
      for (let y = cell.r * 16; y < cell.r * 16 + 15; y++) {
        for (let x = cell.c * 16; x < cell.c * 16 + 15; x++) {
          const l = lum(x, y);
          cell.score += Math.abs(l - lum(x + 1, y)) + Math.abs(l - lum(x, y + 1));
        }
      }
    }
  } catch (e) {
    return all;
  }
  return all.sort((a, b) => b.score - a.score).slice(0, Math.ceil(all.length / 2));
}

async function drawRound() {
  for (let attempt = 0; attempt < 20; attempt++) {
    const artists = new Set();
    const works = [];
    for (const w of shuffle(PAINTINGS)) {
      if (artists.has(w.artist)) continue;
      artists.add(w.artist);
      works.push(w);
      if (works.length === N) break;
    }
    const imgs = await loadImages(works.map((w) => w.image), { cors: true });
    const usable = works.every((w) => {
      const img = imgs.get(w.image);
      if (!img) return false;
      const r = img.naturalWidth / img.naturalHeight;
      return Math.max(r, 1 / r) <= MAX_ASPECT;
    });
    if (usable) return { works, imgs };
  }
  return null;
}

async function newRound() {
  const board = el('cu-board');
  board.classList.add('is-loading');
  el('cu-result').hidden = true;
  el('btn-cu-submit').hidden = false;
  el('btn-cu-next').hidden = true;
  const { works, imgs } = await drawRound();
  state.works = works;
  state.imgs = new Map(works.map((w) => [w.id, imgs.get(w.image)]));
  state.level = {};
  state.anchor = {};
  state.place = {};
  for (const w of works) {
    state.level[w.id] = 0;
    state.place[w.id] = null;
    const { rows, cols } = grid(w.id, 0);
    const cell = pick(busyCells(state.imgs.get(w.id), rows, cols));
    state.anchor[w.id] = { x: (cell.c + 0.5) / cols, y: (cell.r + 0.5) / rows };
  }
  state.labels = shuffle(works.map((w) => w.id));
  state.selected = null;
  state.locked = false;
  state.scored = null;
  board.classList.remove('is-loading');
  render();
}

function labelHtml(labelId, cls = '') {
  const w = workById(labelId);
  const sel = state.selected === labelId ? ' is-selected' : '';
  return `<div class="cu-label${sel}${cls}" tabindex="0" data-label="${labelId}">` +
    `<span class="cu-l-title">${escapeHtml(w.title)}</span>` +
    `<span class="cu-l-artist">${escapeHtml(w.artist)}</span>` +
    `<span class="cu-l-year">${w.year}</span></div>`;
}

function render() {
  const board = el('cu-board');
  board.classList.toggle('is-locked', state.locked);
  const placed = new Set(Object.values(state.place));

  el('cu-paintings').innerHTML = state.works.map((w, i) => {
    const labelId = state.place[w.id];
    let slot;
    if (labelId) {
      const mark = state.locked ? (labelId === w.id ? ' ok' : ' no') : '';
      slot = labelHtml(labelId, mark);
    } else {
      slot = '<span class="cu-slot-empty">Drop a label here</span>';
    }
    let after = '';
    if (state.locked) {
      const pts = state.scored[w.id];
      after = labelId === w.id
        ? `<p class="cu-verdict ok">Right &middot; ${pts} point${pts === 1 ? '' : 's'}</p>`
        : `<p class="cu-verdict no">Actually <em>${escapeHtml(w.title)}</em>, ${escapeHtml(w.artist)}, ${w.year}</p>`;
    }
    return `<div class="cu-item">` +
      `<div class="cu-view" tabindex="0" data-id="${w.id}" ` +
      `aria-label="Painting ${i + 1}${state.locked ? '' : ': click to see more of it'}">` +
      `<canvas></canvas></div>` +
      `<div class="cu-strip" data-id="${w.id}">${mapHtml(w.id)}<span class="cu-shown">${shownLabel(w.id)}</span></div>` +
      `<div class="cu-slot" data-slot="${w.id}" tabindex="${labelId ? -1 : 0}">${slot}</div>${after}</div>`;
  }).join('');

  const tray = state.labels.filter((id) => !placed.has(id));
  el('cu-tray').innerHTML = tray.map((id) => labelHtml(id)).join('') ||
    (state.locked ? '' : '<span class="cu-tray-empty">All four labels placed</span>');
  el('cu-tray').hidden = state.locked;

  const clicks = Object.values(state.level).reduce((t, l) => t + l, 0);
  el('cu-status').textContent = state.locked ? '' :
    `${clicks} click${clicks === 1 ? '' : 's'} so far · up to ${MAX_SCORE - clicks} of ${MAX_SCORE} points still available`;
  el('btn-cu-submit').disabled = Object.values(state.place).some((v) => !v);
  drawViews();
}

/* Paint each painting's current section onto its canvas, fitted inside the
   view box at the screen's pixel density. Once submitted, the whole painting
   is drawn with a box round the last section the player was looking at. */
function drawViews() {
  const dpr = window.devicePixelRatio || 1;
  document.querySelectorAll('.cu-view').forEach((view) => {
    const id = view.dataset.id;
    const img = state.imgs.get(id);
    const canvas = view.querySelector('canvas');
    const r = region(id);
    const sw = r.w * img.naturalWidth, sh = r.h * img.naturalHeight;
    const box = view.getBoundingClientRect();
    const k = Math.min(box.width / sw, box.height / sh);
    const cw = Math.max(1, Math.round(sw * k)), ch = Math.max(1, Math.round(sh * k));
    canvas.style.width = `${cw}px`;
    canvas.style.height = `${ch}px`;
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, r.x * img.naturalWidth, r.y * img.naturalHeight, sw, sh,
                  0, 0, canvas.width, canvas.height);
    if (state.locked && state.level[id] < STEPS) {
      const last = region(id, state.level[id]);
      const lw = 2 * dpr;
      const bx = last.x * canvas.width, by = last.y * canvas.height;
      const bw = last.w * canvas.width, bh = last.h * canvas.height;
      // A dark line under a white one, so the box reads on light and dark paint.
      ctx.lineWidth = lw * 2;
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
      ctx.strokeRect(bx + lw, by + lw, bw - 2 * lw, bh - 2 * lw);
      ctx.lineWidth = lw;
      ctx.strokeStyle = '#fff';
      ctx.strokeRect(bx + lw, by + lw, bw - 2 * lw, bh - 2 * lw);
    }
  });
}

/* One click: show the next bigger section. This is the only thing that
   costs points. */
function reveal(id) {
  if (state.locked || state.level[id] >= STEPS) return;
  state.level[id]++;
  render();
  const v = document.querySelector(`.cu-view[data-id="${id}"]`);
  if (v) v.focus({ preventScroll: true });
}

/* Put a label on a painting (slotId) or back in the tray (null). A label
   already on that painting swaps into wherever the moved one came from.
   Every placement, by drag or by click, goes through here. */
function placeLabel(labelId, slotId) {
  if (state.locked) return;
  const from = Object.keys(state.place).find((k) => state.place[k] === labelId) || null;
  state.selected = null;
  if (from !== slotId) {
    const occupant = slotId ? state.place[slotId] : null;
    if (from) state.place[from] = occupant;
    if (slotId) state.place[slotId] = labelId;
  }
  render();
}

function onDrop(label, target) {
  if (!target) return;
  placeLabel(label.dataset.label, target.id === 'cu-tray' ? null : target.dataset.slot);
}

/* Without dragging: click (or Enter on) a label to pick it up, then click a
   painting's label space, or the tray, to put it down. */
function onClick(ev) {
  if (state.locked) return;
  const view = ev.target.closest('.cu-view');
  if (view) { reveal(view.dataset.id); return; }
  const label = ev.target.closest('.cu-label');
  const slot = ev.target.closest('.cu-slot');
  if (state.selected && (slot || ev.target.closest('#cu-tray'))) {
    if (!label || label.dataset.label !== state.selected) {
      placeLabel(state.selected, slot ? slot.dataset.slot : null);
      return;
    }
  }
  if (label) {
    state.selected = state.selected === label.dataset.label ? null : label.dataset.label;
    render();
  }
}

function submit() {
  state.scored = {};
  let total = 0;
  for (const w of state.works) {
    state.scored[w.id] = state.place[w.id] === w.id ? STEPS - state.level[w.id] : 0;
    total += state.scored[w.id];
  }
  const right = state.works.filter((w) => state.place[w.id] === w.id).length;
  state.locked = true;
  render();
  const res = el('cu-result');
  res.className = 'verdict cu-result ' + (right === N ? 'is-pass' : right >= N - 1 ? 'is-close' : 'is-fail');
  res.innerHTML = `<span class="cu-score">${total}<span class="score-of"> / ${MAX_SCORE}</span></span>` +
    `<span class="v-head">${right} of ${N} labelled correctly</span>` +
    `<span class="v-sub">Each painting is worth ${STEPS}, less one for every click it took.</span>`;
  res.hidden = false;
  el('btn-cu-submit').hidden = true;
  el('btn-cu-next').hidden = false;
  el('btn-cu-next').focus();
}

function init() {
  const board = el('cu-board');
  enableDrag(board, {
    items: '.cu-label',
    targets: '.cu-slot, #cu-tray',
    onDrop,
    canDrag: () => !state.locked,
  });
  // enableDrag swallows pointerdown on labels, so clicks reach here through
  // the ordinary click event, which still fires after a press with no travel.
  board.addEventListener('click', onClick);
  board.addEventListener('keydown', (ev) => {
    if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.closest('.cu-view, .cu-label, .cu-slot')) {
      ev.preventDefault();
      ev.target.click();
    }
  });
  el('btn-cu-submit').addEventListener('click', submit);
  el('btn-cu-next').addEventListener('click', newRound);
  window.addEventListener('resize', () => { if (state.works.length) drawViews(); });
  newRound();
}

document.addEventListener('DOMContentLoaded', init);
