/* Same Year — pairs of paintings made in the same year, one abstract and one
   representational. The years are listed down the middle, newest at the top
   like Chronology; each column arrives shuffled, and the player drags each
   painting level with its year. Abstract paintings stay in the left column
   and representational ones in the right, so the task is two orderings
   against one shared set of years. */

const ROWS = 5;

/* Years that have at least one painting of each kind, from STYLES. */
const BY_YEAR = (() => {
  const by = new Map();
  for (const w of PAINTINGS) {
    const kind = STYLES[w.id];
    if (!kind) continue;
    if (!by.has(w.year)) by.set(w.year, { abstract: [], representational: [] });
    by.get(w.year)[kind].push(w);
  }
  for (const [year, v] of by) if (!v.abstract.length || !v.representational.length) by.delete(year);
  return by;
})();

const state = {
  rows: [],       // [{ year, abstract: work, representational: work }], newest first
  abstract: [],   // work ids, top to bottom, as the player has them
  representational: [],
  locked: false,
};

const COLS = ['abstract', 'representational'];
const workById = (id) => PAINTINGS.find((w) => w.id === id);

/* Choose ROWS years and one painting of each kind per year, with all
   2 x ROWS artists different so no painter gives two rows away. */
function drawRound() {
  for (let attempt = 0; attempt < 200; attempt++) {
    const years = shuffle([...BY_YEAR.keys()]).slice(0, ROWS);
    const artists = new Set();
    const rows = [];
    for (const year of years) {
      const v = BY_YEAR.get(year);
      const a = shuffle(v.abstract).find((w) => !artists.has(w.artist));
      if (!a) break;
      artists.add(a.artist);
      const r = shuffle(v.representational).find((w) => !artists.has(w.artist));
      if (!r) break;
      artists.add(r.artist);
      rows.push({ year, abstract: a, representational: r });
    }
    if (rows.length === ROWS) return rows.sort((x, y) => y.year - x.year);
  }
  return null;
}

/* Shuffle a column so that no painting starts level with its own year. */
function deal(ids) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const s = shuffle(ids);
    if (s.every((id, i) => id !== ids[i])) return s;
  }
  return ids.slice(1).concat(ids[0]);
}

async function newRound() {
  state.rows = drawRound();
  state.locked = false;
  for (const col of COLS) state[col] = deal(state.rows.map((r) => r[col].id));
  el('sy-result').hidden = true;
  el('btn-sy-submit').hidden = false;
  el('btn-sy-next').hidden = true;
  const board = el('sy-board');
  board.classList.add('is-loading');
  render();
  await loadImages(state.rows.flatMap((r) => [r.abstract.image, r.representational.image]));
  board.classList.remove('is-loading');
}

function cardHtml(col, id, row) {
  const w = workById(id);
  let info = '';
  let mark = '';
  if (state.locked) {
    const ok = w.year === state.rows[row].year;
    mark = `<span class="sy-mark ${ok ? 'ok' : 'no'}" aria-label="${ok ? 'right year' : 'wrong year'}">${ok ? '✓' : '✗'}</span>`;
    info = `<span class="sy-info"><span class="sy-year">${w.year}</span>` +
      `<span class="sy-title">${escapeHtml(w.title)}</span>` +
      `<span class="sy-artist">${escapeHtml(w.artist)}</span></span>`;
  }
  return `<div class="sy-card" tabindex="0" data-id="${id}" data-col="${col}" ` +
    `aria-label="${state.locked ? escapeHtml(w.title) : `${col} painting, row ${row + 1}`}">` +
    `<img src="${escapeHtml(w.image)}" alt="" draggable="false">${mark}</div>${info}`;
}

function render() {
  const board = el('sy-board');
  board.classList.toggle('is-locked', state.locked);
  board.innerHTML =
    '<div class="sy-head">Abstract</div><div class="sy-head sy-head-year">Year</div><div class="sy-head">Representational</div>' +
    state.rows.map((row, i) => {
      const cell = (col) => {
        const id = state[col][i];
        const ok = state.locked ? (workById(id).year === row.year ? ' ok' : ' no') : '';
        return `<div class="sy-cell${ok}" data-col="${col}" data-row="${i}">${cardHtml(col, id, i)}</div>`;
      };
      return cell('abstract') + `<div class="sy-year-cell">${row.year}</div>` + cell('representational');
    }).join('');
}

/* Swap two paintings within one column. Every move goes through here. */
function swap(col, from, to) {
  if (state.locked || from === to || to < 0 || to >= ROWS) return;
  const ids = state[col];
  [ids[from], ids[to]] = [ids[to], ids[from]];
  render();
}

function onDrop(card, target) {
  if (!target) return;
  const col = card.dataset.col;
  if (target.dataset.col !== col) return;   // abstract stays left, representational right
  swap(col, state[col].indexOf(card.dataset.id), Number(target.dataset.row));
}

function onKey(ev) {
  const card = ev.target.closest('.sy-card');
  if (!card || state.locked) return;
  const delta = ev.key === 'ArrowUp' ? -1 : ev.key === 'ArrowDown' ? 1 : 0;
  if (!delta) return;
  ev.preventDefault();
  const col = card.dataset.col;
  const at = state[col].indexOf(card.dataset.id);
  swap(col, at, at + delta);
  const moved = document.querySelector(`.sy-card[data-id="${card.dataset.id}"]`);
  if (moved) moved.focus();
}

function submit() {
  state.locked = true;
  render();
  let right = 0;
  state.rows.forEach((row, i) => {
    for (const col of COLS) if (workById(state[col][i]).year === row.year) right++;
  });
  const total = ROWS * 2;
  const res = el('sy-result');
  res.className = 'verdict sy-result ' + (right === total ? 'is-pass' : right >= total - 2 ? 'is-close' : 'is-fail');
  res.innerHTML = `<span class="v-head">${right} of ${total} paintings in the right year</span>` +
    `<span class="v-sub">${right === total ? 'Every pair matched.' :
      'A cross marks a painting in the wrong row; its real year is under it.'}</span>`;
  res.hidden = false;
  el('btn-sy-submit').hidden = true;
  el('btn-sy-next').hidden = false;
  el('btn-sy-next').focus();
}

function init() {
  enableDrag(el('sy-board'), {
    items: '.sy-card',
    targets: '.sy-cell',
    onDrop,
    canDrag: () => !state.locked,
  });
  el('sy-board').addEventListener('keydown', onKey);
  el('btn-sy-submit').addEventListener('click', submit);
  el('btn-sy-next').addEventListener('click', newRound);
  newRound();
}

document.addEventListener('DOMContentLoaded', init);
