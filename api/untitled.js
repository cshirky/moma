/* Backend for the Untitled game. One endpoint, routed by ?action=.

   Two players share a room. A (the describer) is shown which of five
   paintings is the target and writes up to 50 words about it; the server
   turns that into an image; B (the guesser) sees only the image and picks
   which painting it came from. The server is what keeps the two halves
   apart: B is never sent the description (or the target) and A is never
   sent the image until the guess is in. */

const crypto = require('crypto');
const store = require('../lib/store');
const { generate } = require('../lib/generate');

const TTL = 60 * 60 * 24;                       // rooms live a day
const MAX_WORDS = 50;
const DAILY_CAP = Number(process.env.MAX_DAILY_IMAGES || 200);
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // no 0/O, 1/I

module.exports.config = { maxDuration: 60 };

const token = () => crypto.randomBytes(16).toString('hex');
const roomCode = () => Array.from(crypto.randomBytes(5), (b) => ALPHABET[b % ALPHABET.length]).join('');
const wordCount = (s) => s.trim().split(/\s+/).filter(Boolean).length;

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

async function loadRoom(code) {
  const raw = code && await store.get(`untitled:room:${code}`);
  if (!raw) throw new HttpError(404, 'No such game. It may have expired.');
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
}
const saveRoom = (room) => store.set(`untitled:room:${room.id}`, JSON.stringify(room), TTL);

function roleOf(room, tok) {
  if (tok && tok === room.tokenA) return 'A';
  if (tok && room.tokenB && tok === room.tokenB) return 'B';
  throw new HttpError(403, 'You are not a player in this game.');
}

/* What each player is allowed to know right now. */
function view(room, role) {
  const done = room.status === 'done';
  const v = { room: room.id, role, status: room.status, ids: room.ids, hasB: !!room.tokenB, error: room.error || null };
  if (role === 'A' || done) v.target = room.ids[room.target];
  if (role === 'A' || done) v.description = room.description || null;
  v.image = role === 'B' ? (room.status === 'ready' || done) : done;
  if (done) { v.guess = room.guess; v.correct = room.guess === room.ids[room.target]; }
  return v;
}

async function handle(action, q, body) {
  if (action === 'create') {
    const ids = body.ids;
    if (!Array.isArray(ids) || ids.length !== 5 || new Set(ids).size !== 5 || !ids.every((x) => /^\d{1,12}$/.test(String(x)))) {
      throw new HttpError(400, 'Need five different painting ids.');
    }
    const room = {
      id: roomCode(), ids: ids.map(String), target: crypto.randomInt(5),
      tokenA: token(), tokenB: null, status: 'describing',
      description: null, guess: null, error: null,
    };
    await saveRoom(room);
    return { room: room.id, token: room.tokenA, role: 'A' };
  }

  const room = await loadRoom(String(q.room || body.room || '').toUpperCase());

  if (action === 'join') {
    if (body.token && (body.token === room.tokenA || body.token === room.tokenB)) {
      return { room: room.id, token: body.token, role: roleOf(room, body.token) };
    }
    if (room.tokenB) throw new HttpError(409, 'This game already has two players.');
    room.tokenB = token();
    await saveRoom(room);
    return { room: room.id, token: room.tokenB, role: 'B' };
  }

  const role = roleOf(room, body.token || q.token);

  if (action === 'state') return view(room, role);

  if (action === 'image') {
    const allowed = role === 'B' ? (room.status === 'ready' || room.status === 'done') : room.status === 'done';
    if (!allowed) throw new HttpError(403, 'Not yet.');
    const raw = await store.get(`untitled:img:${room.id}`);
    if (!raw) throw new HttpError(404, 'No image.');
    const { mime, base64 } = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return { binary: Buffer.from(base64, 'base64'), mime };
  }

  if (action === 'describe') {
    if (role !== 'A') throw new HttpError(403, 'Only the describer writes the description.');
    if (room.status !== 'describing') throw new HttpError(409, 'The description has already been sent.');
    const text = String(body.text || '').trim();
    if (!text) throw new HttpError(400, 'Write something first.');
    if (wordCount(text) > MAX_WORDS) throw new HttpError(400, `Keep it to ${MAX_WORDS} words or fewer.`);
    if (text.length > 600) throw new HttpError(400, 'That is too long.');

    const day = new Date().toISOString().slice(0, 10);
    if (await store.incr(`untitled:gen:${day}`, TTL) > DAILY_CAP) {
      throw new HttpError(429, 'The game has made all the images it can for today. Try again tomorrow.');
    }

    room.status = 'generating'; room.description = text; room.error = null;
    await saveRoom(room);
    try {
      const img = await generate(text);
      const payload = JSON.stringify(img);
      if (payload.length > 900000) throw new Error('The generated image was too large to store.');
      await store.set(`untitled:img:${room.id}`, payload, TTL);
      room.status = 'ready';
    } catch (e) {
      room.status = 'describing'; room.description = null;
      room.error = `Image generation failed: ${e.message}`;
    }
    await saveRoom(room);
    return view(room, 'A');
  }

  if (action === 'guess') {
    if (role !== 'B') throw new HttpError(403, 'Only the guesser guesses.');
    if (room.status !== 'ready') throw new HttpError(409, 'There is nothing to guess yet.');
    if (!room.ids.includes(String(body.id))) throw new HttpError(400, 'That is not one of the five.');
    room.guess = String(body.id);
    room.status = 'done';
    await saveRoom(room);
    return view(room, 'B');
  }

  throw new HttpError(400, 'Unknown action.');
}

async function readBody(req) {
  if (req.body !== undefined) return typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const s = Buffer.concat(chunks).toString();
  return s ? JSON.parse(s) : {};
}

module.exports = async function (req, res) {
  // The static site on GitHub Pages is a different origin from this function.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
  try {
    const q = Object.fromEntries(new URL(req.url, 'http://x').searchParams);
    const body = req.method === 'POST' ? await readBody(req) : {};
    const out = await handle(q.action, q, body);
    if (out.binary) {
      res.setHeader('Content-Type', out.mime);
      res.setHeader('Cache-Control', 'private, max-age=3600');
      return res.end(out.binary);
    }
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify(out));
  } catch (e) {
    const status = e.status || 500;
    if (status === 500) console.error(e);
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: status === 500 ? 'Something went wrong on the server.' : e.message }));
  }
};
