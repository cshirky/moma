/* Local stand-in for Vercel: serves docs/ and routes /api/untitled to the
   real handler, with the in-memory store and placeholder image generator
   (unless the env vars are set). Usage: node dev_server.js [port] */
const http = require('http'), fs = require('fs'), path = require('path');
const handler = require('./api/untitled');
const DOCS = path.join(__dirname, 'docs');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };

http.createServer((req, res) => {
  const p = new URL(req.url, 'http://x').pathname;
  if (p === '/api/untitled') return handler(req, res);
  const file = path.join(DOCS, p === '/' ? 'index.html' : p);
  if (!file.startsWith(DOCS) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.statusCode = 404; return res.end('not found'); }
  res.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
}).listen(Number(process.argv[2] || 8766), '127.0.0.1', () => console.log('dev server up'));
