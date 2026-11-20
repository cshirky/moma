/* Untitled — two players, five paintings all called "Untitled". Player A
   writes up to 50 words about the highlighted one; the server has an image
   generator paint from that; player B sees only that picture and guesses
   which painting it came from.

   The server (api/untitled.js) decides who may see what; this page just
   draws whatever it is sent. Each browser remembers its role in a room in
   localStorage, so a refresh doesn't lose its place. */

/* Where the API lives. Served from Vercel, it is same-origin; from GitHub
   Pages it is the Vercel deployment. */
const API_BASE = location.hostname.endsWith('github.io') ? 'https://moma-mu.vercel.app' : '';
const API = `${API_BASE}/api/untitled`;

const MAX_WORDS = 50;
const POLL_MS = 2000;

const me = { room: null, token: null, role: null };
let view = null;        // latest state from the server
let pollTimer = null;
let selected = null;    // B's pending guess (painting id)
let renderedIds = '';

const workById = (id) => PAINTINGS.find((w) => w.id === id);
const wordCount = (s) => s.trim().split(/\s+/).filter(Boolean).length;

/* Five abstract paintings by five different artists. Abstract ones make a
   fair guessing game: there is a lot to say and no obvious subject to name. */
function drawFive() {
  const pool = PAINTINGS.filter((w) => STYLES[w.id] === 'abstract');
  const picked = [];
  for (const w of shuffle(pool)) {
    if (picked.some((p) => p.artist === w.artist)) continue;
    picked.push(w);
    if (picked.length === 5) return picked.map((p) => p.id);
  }
  return null;
}

async function api(action, body, query = '') {
  let r;
  try {
    r = await fetch(`${API}?action=${action}${query}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
  } catch (e) {
    throw new Error('Could not reach the game server.');
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Server error (${r.status})`);
  return j;
}

const saved = (room) => { try { return JSON.parse(localStorage.getItem(`untitled:${room}`)); } catch (e) { return null; } };
const remember = (room, token, role) => { try { localStorage.setItem(`untitled:${room}`, JSON.stringify({ token, role })); } catch (e) { /* private mode */ } };

function show(which) {
  el('un-start').hidden = which !== 'start';
  el('un-play').hidden = which !== 'play';
}

async function newGame() {
  el('btn-un-new').disabled = true;
  el('un-start-error').hidden = true;
  try {
    const ids = drawFive();
    const j = await api('create', { ids });
    remember(j.room, j.token, j.role);
    history.replaceState(null, '', `?room=${j.room}`);
    await enter(j.room);
  } catch (e) {
    el('un-start-error').textContent = e.message;
    el('un-start-error').hidden = false;
  } finally {
    el('btn-un-new').disabled = false;
  }
}

/* Arrive in a room: use the saved seat if there is one, otherwise take the
   free one. */
async function enter(room) {
  show('play');
  el('un-status').textContent = 'Joining…';
  try {
    const s = saved(room);
    const j = await api('join', { token: s && s.token }, `&room=${encodeURIComponent(room)}`);
    remember(j.room, j.token, j.role);
    Object.assign(me, { room: j.room, token: j.token, role: j.role });
    await refresh();
    clearInterval(pollTimer);
    pollTimer = setInterval(refresh, POLL_MS);
  } catch (e) {
    el('un-status').textContent = e.message;
  }
}

async function refresh() {
  try {
    view = await api('state', { token: me.token }, `&room=${me.room}`);
  } catch (e) {
    el('un-status').textContent = e.message;
    return;
  }
  if (view.status === 'done') clearInterval(pollTimer);
  render();
}

function buildGrid() {
  const key = view.ids.join(',');
  if (key === renderedIds) return;
  renderedIds = key;
  el('un-grid').innerHTML = view.ids.map((id) => {
    const w = workById(id);
    return `<button type="button" class="un-card" data-id="${id}" aria-label="Untitled">
      <img src="${escapeHtml(w.image)}" alt="Untitled painting" draggable="false">
      <span class="un-title">Untitled</span>
      <span class="un-fact"></span>
    </button>`;
  }).join('');
}

function render() {
  buildGrid();
  const { role, status } = view;
  const isA = role === 'A', isB = role === 'B';
  const done = status === 'done';

  el('un-role').textContent = isA ? 'You are the describer.' : 'You are the guesser.';

  // A sees the link until B has joined.
  el('un-share').hidden = !(isA && !view.hasB && status !== 'done');
  el('un-link').value = `${location.origin}${location.pathname}?room=${view.room}`;

  // The AI's picture: B once it exists, A only at the end.
  const showAi = view.image;
  el('un-ai').hidden = !showAi;
  if (showAi && !el('un-ai-img').src.includes(`room=${view.room}`)) {
    el('un-ai-img').src = `${API}?action=image&room=${view.room}&token=${me.token}`;
  }
  document.querySelector('.un-ai-cap').textContent = done
    ? 'The AI’s picture, made from the description below.'
    : 'The AI’s picture. Which of these did it come from?';

  // Cards: A sees the target highlighted; B can pick; at the end, everyone sees the answer.
  document.querySelectorAll('.un-card').forEach((c) => {
    const id = c.dataset.id;
    const w = workById(id);
    c.classList.toggle('is-target', (isA && id === view.target && !done));
    c.classList.toggle('is-picked', isB && !done && id === selected);
    c.classList.toggle('is-answer', done && id === view.target);
    c.classList.toggle('is-miss', done && id === view.guess && !view.correct);
    c.disabled = !(isB && status === 'ready');
    c.querySelector('.un-fact').textContent = done && (id === view.target || id === view.guess)
      ? `${w.title}, ${w.artist}, ${w.year}${id === view.target ? ' — the answer' : ' — the guess'}` : '';
    
  });

  // Describe panel (A, before sending).
  const writing = isA && status === 'describing';
  el('un-describe').hidden = !writing;
  if (writing && view.error) { el('un-error').textContent = view.error; el('un-error').hidden = false; }
  else if (!writing) el('un-error').hidden = true;

  // Status line.
  let msg = '';
  let cls = '';
  if (isA && status === 'describing') msg = view.hasB ? 'The other player is here. Describe the highlighted painting.' : 'Describe the highlighted painting while you wait for the other player.';
  else if (isA && status === 'generating') msg = 'Making the picture…';
  else if (isA && status === 'ready') msg = 'Description sent. Waiting for the other player to guess…';
  else if (isB && status === 'describing') msg = 'Waiting for the describer to write their description…';
  else if (isB && status === 'generating') msg = 'The picture is being made…';
  else if (isB && status === 'ready') msg = selected ? 'Make your guess, or pick a different one.' : 'Pick the painting you think the picture came from.';
  else if (done) { msg = view.correct ? 'Found it.' : 'Not this time.'; cls = view.correct ? 'is-pass' : 'is-fail'; }
  const st = el('un-status');
  st.className = `verdict un-status ${cls}`;
  st.innerHTML = done
    ? `<span class="v-head">${msg}</span><span>${view.correct ? 'The guesser picked the right painting.' : 'The guesser picked a different painting. The answer is marked.'}</span>`
    : escapeHtml(msg);

  el('btn-un-guess').hidden = !(isB && status === 'ready');
  el('btn-un-guess').disabled = !selected;
  el('btn-un-again').hidden = !done;

  el('un-reveal').hidden = !done;
  if (done) el('un-said').textContent = view.description || '';
}

function updateCount() {
  const n = wordCount(el('un-text').value);
  const over = n > MAX_WORDS;
  el('un-count').textContent = `${n} / ${MAX_WORDS} words`;
  el('un-count').classList.toggle('is-bad', over);
  el('btn-un-send').disabled = n === 0 || over;
}

async function send() {
  el('btn-un-send').disabled = true;
  el('un-error').hidden = true;
  el('un-status').textContent = 'Making the picture…';
  try {
    view = await api('describe', { token: me.token, text: el('un-text').value }, `&room=${me.room}`);
    render();
  } catch (e) {
    el('un-error').textContent = e.message;
    el('un-error').hidden = false;
    updateCount();
  }
}

async function guess() {
  el('btn-un-guess').disabled = true;
  try {
    view = await api('guess', { token: me.token, id: selected }, `&room=${me.room}`);
    clearInterval(pollTimer);
    render();
  } catch (e) {
    el('un-status').textContent = e.message;
    el('btn-un-guess').disabled = false;
  }
}

el('btn-un-new').addEventListener('click', newGame);
el('btn-un-again').addEventListener('click', () => { location.href = location.pathname; });
el('un-text').addEventListener('input', updateCount);
el('btn-un-send').addEventListener('click', send);
el('btn-un-guess').addEventListener('click', guess);
el('btn-un-copy').addEventListener('click', async () => {
  el('un-link').select();
  try { await navigator.clipboard.writeText(el('un-link').value); el('btn-un-copy').textContent = 'Copied'; }
  catch (e) { document.execCommand('copy'); }
  setTimeout(() => { el('btn-un-copy').textContent = 'Copy'; }, 1500);
});
el('un-grid').addEventListener('click', (ev) => {
  const c = ev.target.closest('.un-card');
  if (!c || c.disabled) return;
  selected = c.dataset.id;
  render();
});

const roomParam = new URLSearchParams(location.search).get('room');
if (roomParam) enter(roomParam.toUpperCase());
else show('start');
