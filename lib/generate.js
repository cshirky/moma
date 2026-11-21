/* Turns a player's description into an image. Returns { mime, base64 }.

   AI_GATEWAY_API_KEY set -> Vercel AI Gateway, OpenAI-compatible
                             /v1/images/generations. The model is
                             AI_GATEWAY_IMAGE_MODEL (default
                             bfl/flux-3-image-klein, about a cent an image);
                             any image model from
                             https://ai-gateway.vercel.sh/v1/models works.
   otherwise              -> a deterministic placeholder SVG, so the game can
                             be played and tested end to end without a key.
   To use another provider, replace the body of generate(); nothing else in
   the game cares how the picture is made. */

const crypto = require('crypto');

function placeholder(text) {
  const h = crypto.createHash('sha256').update(text).digest();
  const hue = (i) => Math.round((h[i] / 255) * 360);
  const blobs = [0, 1, 2, 3, 4].map((i) => {
    const x = Math.round((h[i * 4 + 5] / 255) * 100);
    const y = Math.round((h[i * 4 + 6] / 255) * 100);
    const r = 12 + Math.round((h[i * 4 + 7] / 255) * 30);
    return `<circle cx="${x}" cy="${y}" r="${r}" fill="hsl(${hue(i + 8)} 60% 55%)" opacity="0.8"/>`;
  }).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="512" height="512">` +
    `<rect width="100" height="100" fill="hsl(${hue(0)} 35% 80%)"/>${blobs}</svg>`;
  return { mime: 'image/svg+xml', base64: Buffer.from(svg).toString('base64') };
}

/* Models differ in what they return (Flux sends JPEG), so read the type from
   the first bytes rather than assuming. */
function sniff(b64) {
  const head = Buffer.from(b64.slice(0, 16), 'base64');
  if (head[0] === 0xff && head[1] === 0xd8) return 'image/jpeg';
  if (head.slice(1, 4).toString() === 'PNG') return 'image/png';
  if (head.slice(0, 4).toString() === 'RIFF') return 'image/webp';
  return 'image/png';
}

async function generate(description) {
  const key = process.env.AI_GATEWAY_API_KEY;
  if (!key) return placeholder(description);

  const prompt = 'A painting, shown flat and unframed, filling the whole image, with no text or caption. ' +
    'It is described like this: ' + description;
  const r = await fetch('https://ai-gateway.vercel.sh/v1/images/generations', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.AI_GATEWAY_IMAGE_MODEL || 'bfl/flux-3-image-klein',
      prompt,
      size: '768x768',
      n: 1,
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j.error && (j.error.message || j.error)) || `image API returned ${r.status}`);
  const item = j.data && j.data[0];
  if (item && item.b64_json) return { mime: sniff(item.b64_json), base64: item.b64_json };
  if (item && item.url) {                       // some models hand back a link instead
    const img = await fetch(item.url);
    if (!img.ok) throw new Error(`could not fetch the image (${img.status})`);
    return { mime: img.headers.get('content-type') || 'image/png', base64: Buffer.from(await img.arrayBuffer()).toString('base64') };
  }
  throw new Error('image API returned no image');
}

module.exports = { generate };
