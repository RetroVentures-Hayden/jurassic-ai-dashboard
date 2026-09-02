#!/usr/bin/env node
// Web-app host for the Jurassic AI Dashboard. Serves the same renderer the
// Electron app uses (src/renderer/), but instead of Electron IPC it exposes a
// single POST /api/invoke that runs the reused IPC handlers (see ipcBridge.js),
// plus /local-file for the cached map/book preview images.
//
// Run:  npm run web        (defaults to 127.0.0.1:4178)
// Env:  WEB_PORT  WEB_HOST  WEB_TOKEN
//
// Put Cloudflare Access (or at least WEB_TOKEN) in front before exposing it.
// Run the web host OR the Electron app, not both — DuckDB allows one writer.

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const { openDatabase } = require('../main/db');
const { IMAGES_DIR } = require('../main/constants');
const { buildBridge } = require('./ipcBridge');
const { startScheduler } = require('./scheduler');

const PORT = Number(process.env.WEB_PORT || process.env.PORT || 4178);
const HOST = process.env.WEB_HOST || '127.0.0.1';
const TOKEN = process.env.WEB_TOKEN || null;
const RENDERER_DIR = path.join(__dirname, '..', 'renderer');
const MAX_BODY = 2 * 1024 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};
function send(res, status, body, headers = {}) {
  if (res.headersSent) return;
  res.writeHead(status, headers);
  res.end(body);
}

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > -1) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

// If WEB_TOKEN is set, require it once via ?dt=<token> (then a year-long cookie
// carries it), or an x-dt header. No token set => open (LAN / behind Access).
function checkAuth(req, res, url) {
  if (!TOKEN) return true;
  const q = url.searchParams.get('dt');
  if (q && q === TOKEN) {
    res.setHeader(
      'Set-Cookie',
      `dt=${encodeURIComponent(TOKEN)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000`
    );
    return true;
  }
  if (parseCookies(req).dt === TOKEN) return true;
  if ((req.headers['x-dt'] || '') === TOKEN) return true;
  return false;
}

function serveIndex(res) {
  let html;
  try {
    html = fs.readFileSync(path.join(RENDERER_DIR, 'index.html'), 'utf8');
  } catch (err) {
    return send(res, 500, `Could not read index.html: ${err.message}`);
  }
  // Swap the Electron file:// CSP for a web one, and load the window.api shim
  // (a classic script, so it runs before the deferred app.js module).
  html = html.replace(
    /<meta http-equiv="Content-Security-Policy"[^>]*>/,
    `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; img-src 'self' data: https:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'" />`
  );
  html = html.replace(
    '<script type="module" src="js/app.js"></script>',
    '<script src="/web-api-shim.js"></script>\n  <script type="module" src="js/app.js"></script>'
  );
  send(res, 200, html, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache' });
}

function serveStatic(req, res, pathname) {
  const filePath = path.join(RENDERER_DIR, pathname.replace(/^\/+/, ''));
  if (filePath !== RENDERER_DIR && !filePath.startsWith(RENDERER_DIR + path.sep)) {
    return send(res, 403, 'Forbidden');
  }
  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'Not found');
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'Content-Length': st.size,
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

// Cached map/book preview images live under IMAGES_DIR; the getImage handlers
// return absolute paths there and the client rewrites them to /local-file?p=.
function serveLocalFile(req, res, url) {
  const p = url.searchParams.get('p');
  if (!p) return send(res, 400, 'missing ?p');
  const resolved = path.resolve(p);
  const root = path.resolve(IMAGES_DIR);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) return send(res, 403, 'Forbidden');
  fs.stat(resolved, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'Not found');
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(resolved).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'public, max-age=86400',
      'Content-Length': st.size,
    });
    fs.createReadStream(resolved).pipe(res);
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c) => {
      body += c;
      if (body.length > MAX_BODY) {
        reject(new Error('Body too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

async function main() {
  let db;
  try {
    db = await openDatabase();
  } catch (err) {
    console.error(
      'Could not open the database. Is the Electron app still running?\n' +
        'DuckDB allows a single writer — run the web host OR the desktop app, not both.\n',
      err.message
    );
    process.exit(1);
  }

  const bridge = buildBridge(db);
  startScheduler(db);

  const server = http.createServer(async (req, res) => {
    let url;
    try {
      url = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);
    } catch {
      return send(res, 400, 'Bad request');
    }
    const { pathname } = url;

    if (!checkAuth(req, res, url)) {
      return send(res, 401, 'Unauthorized. Append ?dt=YOUR_TOKEN to the URL once to sign in.', {
        'Content-Type': 'text/plain; charset=utf-8',
      });
    }

    try {
      if (req.method === 'POST' && pathname === '/api/invoke') {
        let payload;
        try {
          payload = JSON.parse((await readBody(req)) || '{}');
        } catch (err) {
          return send(res, 400, JSON.stringify({ ok: false, error: err.message }), {
            'Content-Type': MIME['.json'],
          });
        }
        try {
          const result = await bridge.invoke(payload.channel, payload.args || []);
          return send(res, 200, JSON.stringify({ ok: true, result }), { 'Content-Type': MIME['.json'] });
        } catch (err) {
          return send(res, 200, JSON.stringify({ ok: false, error: err.message }), {
            'Content-Type': MIME['.json'],
          });
        }
      }

      if (req.method === 'GET' && pathname === '/local-file') {
        return serveLocalFile(req, res, url);
      }
      if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
        return serveIndex(res);
      }
      if (req.method === 'GET') {
        return serveStatic(req, res, pathname);
      }
      send(res, 405, 'Method not allowed');
    } catch (err) {
      console.error('[web] request error:', err);
      send(res, 500, 'Internal error');
    }
  });

  server.listen(PORT, HOST, () => {
    console.log(`Jurassic AI Dashboard (web) → http://${HOST}:${PORT}`);
    if (!TOKEN) {
      console.log(
        'WARNING: WEB_TOKEN is not set — this server is unauthenticated. Set WEB_TOKEN ' +
          'and/or put Cloudflare Access in front before exposing it to the internet.'
      );
    }
  });
}

main();
