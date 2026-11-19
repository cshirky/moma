/* MoMA by the Numbers: twelve multiple-choice questions about the collection.
   The questions, options and notes all come from numbers_data.js, which
   fetch_data.py works out from MoMA's CSVs; this file only plays them. */

// Random guessing averages 3 of 12, so the lowest band says so.
const NB_BANDS = [
  [12, 'Perfect'],
  [10, 'Excellent'],
  [7, 'Good'],
  [4, 'Better than guessing'],
  [0, 'About what guessing gets'],
];

const state = { order: [], at: 0, picks: [] };

function start() {
  state.order = shuffle(NUMBERS);
  state.at = 0;
  state.picks = [];
  el('nb-results').hidden = true;
  el('nb-quiz').hidden = false;
  showQuestion();
}

const current = () => state.order[state.at];

function showQuestion() {
  const q = current();
  const score = state.picks.filter((p, i) => p === state.order[i].answer).length;
  el('nb-progress').textContent =
    `Question ${state.at + 1} of ${state.order.length}` + (state.at ? ` · ${score} right so far` : '');
  el('nb-question').textContent = q.question;
  // Options arrive smallest first and stack in that order. Nothing is
  // focused, so all four look the same until the player picks one.
  el('nb-options').innerHTML = q.options.map((o, i) =>
    `<button class="btn nb-option" data-i="${i}"><span class="nb-key">${i + 1}</span>` +
    `<span class="nb-value">${escapeHtml(o)}</span><span class="nb-label"></span></button>`
  ).join('');
  el('nb-reveal').hidden = true;
  el('btn-nb-next').hidden = true;
  if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
}

/* What to say beside an option once the player has guessed: the right one
   says so, a wrong one carries its own fact if the data gave it one, and
   otherwise says which way it misses. */
function optionLabel(q, j) {
  if (j === q.answer) return 'Right answer';
  return q.facts[j] || (j < q.answer ? q.low : q.high);
}

function choose(i) {
  const q = current();
  if (state.picks.length > state.at) return; // already answered
  state.picks.push(i);
  const right = i === q.answer;
  el('nb-options').querySelectorAll('.nb-option').forEach((b, j) => {
    b.disabled = true;
    if (j === q.answer) b.classList.add('ok');
    else if (j === i) b.classList.add('no');
    if (j === i) b.classList.add('picked');
    b.querySelector('.nb-label').textContent = optionLabel(q, j);
  });
  const fig = q.image
    ? `<figure class="nb-figure"><a href="${escapeHtml(q.url)}" target="_blank" rel="noopener">
         <img src="${escapeHtml(q.image)}" alt="${escapeHtml(q.caption)}"
           onerror="this.closest('figure').hidden = true"></a>
         <figcaption>${escapeHtml(q.caption)}</figcaption></figure>`
    : '';
  el('nb-reveal').innerHTML =
    `<p class="nb-head ${right ? 'ok' : 'no'}">${right ? 'Right.' : `No: it’s ${escapeHtml(q.options[q.answer])}.`}</p>
     <p class="nb-note">${escapeHtml(q.note)}</p>${fig}`;
  el('nb-reveal').hidden = false;
  const last = state.at === state.order.length - 1;
  el('btn-nb-next').textContent = last ? 'See your score' : 'Next question';
  el('btn-nb-next').hidden = false;
  el('btn-nb-next').focus({ preventScroll: true });
}

function next() {
  if (state.at < state.order.length - 1) {
    state.at += 1;
    showQuestion();
  } else {
    finish();
  }
}

function finish() {
  const results = state.order.map((q, i) => ({ q, right: state.picks[i] === q.answer }));
  const score = results.filter((r) => r.right).length;
  const band = NB_BANDS.find(([min]) => score >= min)[1];
  const cls = score >= 10 ? 'is-pass' : score >= 4 ? 'is-close' : 'is-fail';
  el('nb-verdict').className = `verdict ${cls}`;
  el('nb-verdict').innerHTML =
    `<span class="v-head">${score} of ${results.length}</span><span class="v-sub">${band}</span>`;
  el('nb-summary').innerHTML = results.map(({ q, right }) =>
    `<li class="${right ? 'ok' : 'no'}"><span class="nb-mark" aria-label="${right ? 'right' : 'wrong'}">${right ? '✓' : '✗'}</span>
       <span>${escapeHtml(q.question)}: <strong>${escapeHtml(q.options[q.answer])}</strong></span></li>`
  ).join('');
  el('nb-quiz').hidden = true;
  el('nb-results').hidden = false;
  el('btn-nb-again').focus({ preventScroll: true });
}

el('nb-options').addEventListener('click', (ev) => {
  const b = ev.target.closest('.nb-option');
  if (b) choose(Number(b.dataset.i));
});
el('btn-nb-next').addEventListener('click', next);
el('btn-nb-again').addEventListener('click', start);
document.addEventListener('keydown', (ev) => {
  if (el('nb-quiz').hidden || ev.ctrlKey || ev.metaKey || ev.altKey) return;
  const n = Number(ev.key);
  if (n >= 1 && n <= 4) choose(n - 1);
});

el('nb-snapshot').textContent = new Date(`${NUMBERS_SNAPSHOT}T12:00:00`)
  .toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
start();
