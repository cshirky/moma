/* Pixelated — Close Up's game with a different way of hiding the paintings.
   Each one starts as a 2x2 grid of averaged colours, and every click redraws
   it as a finer grid: 3x3, 4x4, up to 10x10, and then the painting itself. The labels, clicks and scoring are
   Close Up's, from closeup.js, which must load first; this file only swaps
   in the VIEW that draws the paintings. */

/* Squares along each side at each step; the step after the last is the
   whole painting. The grid is square whatever the painting's shape, so a
   landscape painting has wide cells and a portrait one tall cells. */
const PIXEL_GRIDS = [2, 3, 4, 5, 6, 7, 8, 9, 10];

/* Every painting is sampled once onto a SAMPLE x SAMPLE canvas, and each
   cell's colour is the mean of the samples inside it. Where a grid size
   doesn't divide 840 (9, say), cell edges round to whole samples, so cells
   differ in size by at most one sample in about ninety: invisible. A size
   that does divide it, like 840 / 8, gives exactly equal blocks. */
const SAMPLE = 840;

/* id -> one list of cell colours per grid size, worked out when the round is
   drawn; null if the pixels couldn't be read. The 840 x 840 sample itself
   is about 3 MB, so it is thrown away once the colours are known. */
const colours = new Map();

/* A painting called Untitled gives the player nothing to recognise on its
   label, so Pixelated leaves them out: "Untitled", "Untitled (Blue)" and
   the like. */
const UNTITLED = /^untitled\b/i;

/* The mean colour of each cell of an n x n grid over the sample, row by
   row, as CSS colours. */
function averageGrid(px, n) {
  const edge = (i) => Math.round((i * SAMPLE) / n), out = [];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const x0 = edge(c), x1 = edge(c + 1), y0 = edge(r), y1 = edge(r + 1);
      const m = (x1 - x0) * (y1 - y0);
      let R = 0, G = 0, B = 0;
      for (let y = y0; y < y1; y++) {
        for (let i = (y * SAMPLE + x0) * 4, end = (y * SAMPLE + x1) * 4; i < end; i += 4) {
          R += px[i]; G += px[i + 1]; B += px[i + 2];
        }
      }
      out.push(`rgb(${Math.round(R / m)}, ${Math.round(G / m)}, ${Math.round(B / m)})`);
    }
  }
  return out;
}

function preparePixels(id) {
  // Drop colours for paintings no longer on the board.
  for (const k of colours.keys()) if (!workById(k)) colours.delete(k);
  let grids = null;
  try {
    const c = document.createElement('canvas');
    c.width = c.height = SAMPLE;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(state.imgs.get(id), 0, 0, SAMPLE, SAMPLE);
    // Works because moma.org allows CORS and the images load with it.
    const px = ctx.getImageData(0, 0, SAMPLE, SAMPLE).data;
    grids = PIXEL_GRIDS.map((n) => averageGrid(px, n));
  } catch (e) {
    grids = null;
  }
  colours.set(id, grids);
}

/* The colours for an n x n grid, or null if the pixels were unreadable. */
function cellColours(id, n) {
  const grids = colours.get(id);
  return grids ? grids[PIXEL_GRIDS.indexOf(n)] : null;
}

function pixelStep(id) {
  return state.locked ? STEPS : state.level[id];
}

function paintPixels(canvas, id) {
  const img = state.imgs.get(id);
  const ctx = canvas.getContext('2d');
  const step = pixelStep(id);
  if (step >= PIXEL_GRIDS.length) {
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return;
  }
  const n = PIXEL_GRIDS[step];
  const colours = cellColours(id, n);
  if (!colours) {
    // Pixels unreadable: let the browser shrink the image to n x n and blow
    // it back up unsmoothed, which looks the same without reading anything.
    const tiny = document.createElement('canvas');
    tiny.width = tiny.height = n;
    const t = tiny.getContext('2d');
    t.imageSmoothingQuality = 'high';
    t.drawImage(img, 0, 0, n, n);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(tiny, 0, 0, canvas.width, canvas.height);
    return;
  }
  // Cell edges on whole pixels, so neighbouring squares meet without seams.
  const xs = (c) => Math.round((c * canvas.width) / n);
  const ys = (r) => Math.round((r * canvas.height) / n);
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      ctx.fillStyle = colours[r * n + c];
      ctx.fillRect(xs(c), ys(r), xs(c + 1) - xs(c), ys(r + 1) - ys(r));
    }
  }
}

function pixelShown(id) {
  const step = pixelStep(id);
  if (step >= PIXEL_GRIDS.length) return 'Whole painting';
  const n = PIXEL_GRIDS[step];
  return `${n} &times; ${n} squares`;
}

const PIXELATED = {
  steps: PIXEL_GRIDS.length,
  allows: (w) => !UNTITLED.test(w.title),
  prepare: preparePixels,
  frame: () => ({ x: 0, y: 0, w: 1, h: 1 }),
  paint: paintPixels,
  map: () => '',
  shown: pixelShown,
};
VIEW = PIXELATED;
