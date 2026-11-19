/* Pixelated — Close Up's game with a different way of hiding the paintings.
   Each one starts as a single colour, the average of the whole canvas, and
   every click redraws it as a finer grid of averaged squares: 2x2, 3x3, up
   to 6x6, and then the painting itself. The labels, clicks and scoring are
   Close Up's, from closeup.js, which must load first; this file only swaps
   in the VIEW that draws the paintings. */

/* Squares along each side at each step; the step after the last is the
   whole painting. The grid is square whatever the painting's shape, so a
   landscape painting has wide cells and a portrait one tall cells. */
const PIXEL_GRIDS = [1, 2, 3, 4, 5, 6];

/* Every painting is sampled once onto a SAMPLE x SAMPLE canvas. 60 divides
   evenly by every grid size above, so each cell's colour is the exact mean of
   a whole block of samples. */
const SAMPLE = 60;
const samples = new Map();   // id -> RGBA pixels, or null if unreadable

function sampleOf(id) {
  if (!samples.has(id)) {
    let px = null;
    try {
      const c = document.createElement('canvas');
      c.width = c.height = SAMPLE;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(state.imgs.get(id), 0, 0, SAMPLE, SAMPLE);
      // Works because moma.org allows CORS and the images load with it.
      px = ctx.getImageData(0, 0, SAMPLE, SAMPLE).data;
    } catch (e) {
      px = null;
    }
    samples.set(id, px);
  }
  return samples.get(id);
}

/* The mean colour of each cell of an n x n grid, row by row, as CSS colours. */
function cellColours(id, n) {
  const px = sampleOf(id);
  if (!px) return null;
  const k = SAMPLE / n, out = [];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      let R = 0, G = 0, B = 0;
      for (let y = r * k; y < (r + 1) * k; y++) {
        for (let x = c * k; x < (c + 1) * k; x++) {
          const i = (y * SAMPLE + x) * 4;
          R += px[i]; G += px[i + 1]; B += px[i + 2];
        }
      }
      const m = k * k;
      out.push(`rgb(${Math.round(R / m)}, ${Math.round(G / m)}, ${Math.round(B / m)})`);
    }
  }
  return out;
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
  return n === 1 ? 'One colour' : `${n} &times; ${n} squares`;
}

const PIXELATED = {
  steps: PIXEL_GRIDS.length,
  prepare: (id) => samples.delete(id),
  frame: () => ({ x: 0, y: 0, w: 1, h: 1 }),
  paint: paintPixels,
  map: () => '',
  shown: pixelShown,
};
VIEW = PIXELATED;
