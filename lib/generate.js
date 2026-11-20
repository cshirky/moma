/* Turns a player's description into an image. Returns { mime, base64 }.

   OPENAI_API_KEY set  -> OpenAI Images (model: OPENAI_IMAGE_MODEL, default
                          gpt-image-1; quality: OPENAI_IMAGE_QUALITY, default
                          medium). Output is JPEG to keep it small enough to
                          store in Redis.
   otherwise           -> a deterministic placeholder SVG, so the game can be
                          played and tested end to end without a key.
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

async function generate(description) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return placeholder(description);

  const prompt = 'A painting, shown flat and unframed, filling the whole image, with no text or caption. ' +
    'It is described like this: ' + description;
  const r = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1',
      prompt,
      size: '1024x1024',
      quality: process.env.OPENAI_IMAGE_QUALITY || 'medium',
      output_format: 'jpeg',
      output_compression: 70,
      n: 1,
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j.error && j.error.message) || `image API returned ${r.status}`);
  const b64 = j.data && j.data[0] && j.data[0].b64_json;
  if (!b64) throw new Error('image API returned no image');
  return { mime: 'image/jpeg', base64: b64 };
}

module.exports = { generate };
