const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const { GAMES, publicMeta } = require('./lib/games');
const { createStore } = require('./lib/store');
const { createTranslator } = require('./lib/translate');

const PUBLIC_DIR = path.join(__dirname, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
};

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': MIME['.json'],
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function serveStatic(req, res, pathname) {
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const file = path.normalize(path.join(PUBLIC_DIR, relative));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  fs.readFile(file, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Не найдено');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(content);
  });
}

function defaultStore(games) {
  const translator = createTranslator({ cacheFile: path.join(__dirname, '.cache', 'translations.json') });
  return createStore(games, { localize: translator.localize, translateBlocks: translator.translateBlocks });
}

function createApp({ games = GAMES, store = defaultStore(games) } = {}) {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const { pathname } = url;

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' }).end();
      return;
    }

    if (pathname === '/api/health') return sendJson(res, 200, { status: 'ok' });
    if (pathname === '/api/games') return sendJson(res, 200, { games: games.map(publicMeta) });

    const articleMatch = pathname.match(/^\/api\/games\/([a-z0-9_-]+)\/article$/);
    if (articleMatch) {
      const result = await store.getArticle(articleMatch[1], url.searchParams.get('ref'));
      if (!result) return sendJson(res, 404, { error: 'Игра не найдена' });
      return sendJson(res, 200, result);
    }

    const match = pathname.match(/^\/api\/games\/([a-z0-9_-]+)$/);
    if (match) {
      const result = await store.get(match[1], { force: url.searchParams.has('refresh') });
      if (!result) return sendJson(res, 404, { error: 'Игра не найдена' });
      return sendJson(res, 200, result);
    }

    if (pathname.startsWith('/api/')) return sendJson(res, 404, { error: 'Неизвестный маршрут' });
    serveStatic(req, res, pathname);
  });
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  const host = process.env.HOST || '0.0.0.0';
  createApp().listen(port, host, () => {
    console.log(`Трекер игр запущен: http://localhost:${port}`);
  });
}

module.exports = { createApp };
