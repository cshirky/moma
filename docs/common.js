/* Shared by the Same Year and Close Up games. Chronology (app.js) predates
   this file and keeps its own copies, so this one is never loaded alongside
   app.js — the names would collide. */

const el = (id) => document.getElementById(id);

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

/* Wait for every URL to load (or fail), so a round never appears half-drawn.
   Resolves to a Map of url -> HTMLImageElement, or null for one that failed.
   Pass cors: true when the pixels will be read from a canvas. */
function loadImages(urls, { cors = false } = {}) {
  return Promise.all(urls.map((url) => new Promise((resolve) => {
    const img = new Image();
    // moma.org sends Access-Control-Allow-Origin: *, so a CORS request gives
    // an image whose pixels a canvas may read back.
    if (cors) img.crossOrigin = 'anonymous';
    img.onload = () => resolve([url, img]);
    img.onerror = () => resolve([url, null]);
    img.src = url;
  }))).then((pairs) => new Map(pairs));
}

/* Pointer dragging for both games. Pressing an `items` element inside `root`
   and travelling past a few pixels lifts a ghost copy; releasing calls
   onDrop(item, target), where target is the `targets` element under the
   pointer, or null. A press that doesn't travel is a click: onClick(item). */
const DRAG_THRESHOLD = 6;

function enableDrag(root, { items, targets, onDrop, onClick, canDrag = () => true }) {
  let d = null;

  root.addEventListener('pointerdown', (ev) => {
    const item = ev.target.closest(items);
    if (!item || ev.button !== 0) return;
    ev.preventDefault();
    item.focus({ preventScroll: true });
    d = { item, x: ev.clientX, y: ev.clientY, ghost: null, over: null, dx: 0, dy: 0 };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  });

  function move(ev) {
    if (!d.ghost) {
      if (Math.hypot(ev.clientX - d.x, ev.clientY - d.y) < DRAG_THRESHOLD) return;
      if (!canDrag(d.item)) return;
      const r = d.item.getBoundingClientRect();
      d.dx = d.x - r.left;
      d.dy = d.y - r.top;
      d.ghost = d.item.cloneNode(true);
      d.ghost.removeAttribute('id');
      d.ghost.classList.add('ghost');
      d.ghost.style.width = `${r.width}px`;
      d.ghost.style.height = `${r.height}px`;
      // A cloned canvas comes out blank, so repaint any it carries.
      d.item.querySelectorAll('canvas').forEach((c, i) => {
        const copy = d.ghost.querySelectorAll('canvas')[i];
        copy.getContext('2d').drawImage(c, 0, 0);
      });
      document.body.appendChild(d.ghost);
      d.item.classList.add('is-held');
      document.body.classList.add('is-dragging');
    }
    d.ghost.style.left = `${ev.clientX - d.dx}px`;
    d.ghost.style.top = `${ev.clientY - d.dy}px`;
    const under = document.elementFromPoint(ev.clientX, ev.clientY);
    const target = under ? under.closest(targets) : null;
    if (target !== d.over) {
      if (d.over) d.over.classList.remove('is-over');
      if (target) target.classList.add('is-over');
      d.over = target;
    }
  }

  function up(ev) {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
    const { item, ghost, over } = d;
    d = null;
    if (ghost) {
      ghost.remove();
      item.classList.remove('is-held');
      document.body.classList.remove('is-dragging');
      if (over) over.classList.remove('is-over');
      // The browser follows a drag's pointerup with a click on whatever is
      // under it, which would read as a separate tap. Swallow that one.
      const swallow = (e) => { e.stopPropagation(); e.preventDefault(); };
      window.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
      if (ev.type === 'pointerup') onDrop(item, over);
    } else if (ev.type === 'pointerup' && onClick) {
      onClick(item);
    }
  }
}
