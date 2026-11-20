/* Room storage. Uses Upstash Redis over its REST API when configured (on
   Vercel: add the Upstash Redis integration, which sets KV_REST_API_URL and
   KV_REST_API_TOKEN, or set UPSTASH_REDIS_REST_URL / _TOKEN yourself).
   Otherwise falls back to an in-process Map, which is fine for the local dev
   server and useless on Vercel, where each request may land on a fresh
   instance — so there it fails loudly instead of losing rooms. */

const URL_ = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

const mem = new Map();

async function cmd(...args) {
  const r = await fetch(URL_, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  const j = await r.json();
  if (!r.ok || j.error) throw new Error(`store: ${j.error || r.status}`);
  return j.result;
}

function configured() {
  if (URL_ && TOKEN) return true;
  if (process.env.VERCEL) throw new Error('No Redis configured: add the Upstash Redis integration to the Vercel project.');
  return false;
}

async function get(key) {
  if (configured()) return cmd('GET', key);
  const e = mem.get(key);
  return e && e.exp > Date.now() ? e.val : null;
}

async function set(key, val, ttlSeconds) {
  if (configured()) { await cmd('SET', key, val, 'EX', String(ttlSeconds)); return; }
  mem.set(key, { val, exp: Date.now() + ttlSeconds * 1000 });
}

async function incr(key, ttlSeconds) {
  if (configured()) {
    const n = await cmd('INCR', key);
    if (n === 1) await cmd('EXPIRE', key, String(ttlSeconds));
    return n;
  }
  const e = mem.get(key);
  const n = (e && e.exp > Date.now() ? Number(e.val) : 0) + 1;
  mem.set(key, { val: String(n), exp: e && e.exp > Date.now() ? e.exp : Date.now() + ttlSeconds * 1000 });
  return n;
}

module.exports = { get, set, incr };
