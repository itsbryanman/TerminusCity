import { createHash, randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, rename, stat as fsStat, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { EventStore } from '../../../packages/agent/src/store.mjs';
import { defaultDataDirectory } from '../../../packages/agent/src/sanitizer.mjs';
import { validateEvent } from '../../../packages/protocol/src/index.mjs';

const rawRoot = fileURLToPath(new URL('../../web/', import.meta.url));
const root = rawRoot.endsWith(sep) ? rawRoot : rawRoot + sep;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8' };
const json = (response, status, body) => { response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'vary': 'Origin', 'x-content-type-options': 'nosniff' }); response.end(JSON.stringify(body)); };

export const websocketFrame = (payload) => {
  const body = Buffer.from(JSON.stringify(payload));
  let head;
  if (body.length < 126) { head = Buffer.from([0x81, body.length]); }
  else if (body.length < 65536) { head = Buffer.from([0x81, 126, body.length >> 8, body.length & 255]); }
  else { head = Buffer.allocUnsafe(10); head[0] = 0x81; head[1] = 127; head.writeUInt32BE(0, 2); head.writeUInt32BE(body.length, 6); }
  return Buffer.concat([head, body]);
};

function isLocalRequest(request, port) {
  const host = request.headers.host || '';
  const colon = host.lastIndexOf(':');
  const hostname = colon >= 0 ? host.slice(0, colon) : host;
  const hostPort = colon >= 0 ? host.slice(colon + 1) : String(port);
  const validHostnames = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);
  if (!validHostnames.has(hostname) || hostPort !== String(port)) return false;
  const origin = request.headers.origin;
  if (origin !== undefined && origin !== `http://127.0.0.1:${port}` && origin !== `http://localhost:${port}`) return false;
  const fetchSite = request.headers['sec-fetch-site'];
  if (fetchSite !== undefined && fetchSite !== 'same-origin' && fetchSite !== 'same-site' && fetchSite !== 'none') return false;
  return true;
}

/** Exported for testing only: returns true when argv1 resolves to this module. */
export const _isMain = (argv1) => resolve(argv1) === resolve(fileURLToPath(import.meta.url));

export async function startRelay({ port = 31338, dataDirectory = defaultDataDirectory() } = {}) {
  const store = await new EventStore(dataDirectory).init();
  const clients = new Set();
  const pendingPong = new Set();
  const controlFile = join(dataDirectory, 'control.json');
  const control = async () => { try { return { paused: Boolean(JSON.parse(await readFile(controlFile, 'utf8')).paused) }; } catch { return { paused: false }; } };
  const broadcast = (event) => {
    const frame = websocketFrame({ kind: 'event', event });
    for (const socket of clients) { const ok = socket.write(frame); if (!ok) { socket.destroy(); clients.delete(socket); pendingPong.delete(socket); } }
  };
  const pingTimer = setInterval(() => {
    for (const socket of clients) {
      if (pendingPong.has(socket)) { socket.destroy(); clients.delete(socket); pendingPong.delete(socket); }
      else { pendingPong.add(socket); socket.write(Buffer.from([0x89, 0x00])); }
    }
  }, 30_000);
  pingTimer.unref();
  const server = http.createServer(async (request, response) => {
    try {
      if (!isLocalRequest(request, server.address().port)) return json(response, 403, { error: 'Cross-origin request refused' });
      const requestUrl = new URL(request.url, 'http://127.0.0.1');
      if (request.method === 'GET' && requestUrl.pathname === '/health') return json(response, 200, { ok: true, host: '127.0.0.1', skipped: store.skipped, ...(await control()) });
      if (request.method === 'GET' && requestUrl.pathname === '/snapshot') return json(response, 200, await store.hydrate());
      if (request.method === 'GET' && requestUrl.pathname === '/events') return json(response, 200, { events: (await store.events()).filter((event) => event.seq > Number(requestUrl.searchParams.get('afterSeq') || 0)) });
      if (request.method === 'POST' && requestUrl.pathname === '/events') {
        if (request.headers['content-type'] !== 'application/json') return json(response, 400, { error: 'Content-Type must be application/json' });
        let raw = ''; let tooLarge = false;
        request.setEncoding('utf8');
        request.on('error', () => {});
        request.on('data', (part) => { raw += part; if (raw.length > 16_384 && !tooLarge) { tooLarge = true; json(response, 413, { error: 'Payload too large' }); request.destroy(); } });
        return request.on('end', async () => { if (tooLarge) return; try { if ((await control()).paused) return json(response, 423, { error: 'Collection is paused' }); const event = await store.append(validateEvent(JSON.parse(raw))); store.snapshot(); broadcast(event); json(response, 201, event); } catch (error) { json(response, 400, { error: error.message }); } });
      }
      if (request.method === 'POST' && requestUrl.pathname === '/control') {
        if (request.headers['content-type'] !== 'application/json') return json(response, 400, { error: 'Content-Type must be application/json' });
        let raw = '';
        request.setEncoding('utf8');
        request.on('error', () => {});
        request.on('data', (part) => { raw += part; });
        return request.on('end', async () => { try { const input = JSON.parse(raw); const next = { paused: Boolean(input.paused) }; const tmp = `${controlFile}.tmp`; await writeFile(tmp, JSON.stringify(next), { mode: 0o600 }); await rename(tmp, controlFile); broadcast({ kind: 'control', ...next }); json(response, 200, next); } catch { json(response, 400, { error: 'Invalid control message' }); } });
      }
      if (request.method === 'GET') {
        let decoded;
        try { decoded = decodeURIComponent(requestUrl.pathname === '/' ? '/index.html' : requestUrl.pathname); } catch { return json(response, 400, { error: 'Bad request' }); }
        const file = resolve(join(root, decoded));
        if (file !== root.slice(0, -1) && !file.startsWith(root)) return json(response, 404, { error: 'Not found' });
        const st = await fsStat(file).catch(() => null);
        if (!st || !st.isFile()) return json(response, 404, { error: 'Not found' });
        const fileHeaders = { 'content-type': MIME[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store', 'vary': 'Origin', 'x-content-type-options': 'nosniff' };
        if (extname(file) === '.html') fileHeaders['content-security-policy'] = "default-src 'self'; connect-src 'self' ws://127.0.0.1:* ws://localhost:*; img-src 'self' data:; style-src 'self'; font-src 'self'";
        response.writeHead(200, fileHeaders);
        const stream = createReadStream(file);
        stream.on('error', () => { if (!response.headersSent) json(response, 500, { error: 'Read error' }); else response.destroy(); });
        return stream.pipe(response);
      }
      json(response, 405, { error: 'Method not allowed' });
    } catch (error) { if (!response.headersSent) json(response, 500, { error: 'Internal error' }); else response.destroy(); }
  });
  server.on('upgrade', async (request, socket) => {
    try {
      const url = new URL(request.url, 'http://127.0.0.1'); const key = request.headers['sec-websocket-key'];
      if (url.pathname !== '/events' || !key || !isLocalRequest(request, server.address().port)) return socket.destroy();
      socket.setNoDelay(true);
      const accept = createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
      socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
      clients.add(socket);
      for (const event of (await store.events()).filter((item) => item.seq > Number(url.searchParams.get('afterSeq') || 0))) socket.write(websocketFrame({ kind: 'event', event }));
      let buf = Buffer.alloc(0);
      socket.on('data', (chunk) => {
        buf = Buffer.concat([buf, chunk]);
        while (buf.length >= 2) {
          const opcode = buf[0] & 0x0f; const masked = !!(buf[1] & 0x80);
          let payloadLen = buf[1] & 0x7f; let offset = 2;
          if (payloadLen === 126) { if (buf.length < 4) break; payloadLen = buf.readUInt16BE(2); offset = 4; }
          else if (payloadLen === 127) { if (buf.length < 10) break; payloadLen = buf.readUInt32BE(6); offset = 10; }
          if (masked) { if (buf.length < offset + 4) break; offset += 4; }
          if (buf.length < offset + payloadLen) break;
          buf = buf.slice(offset + payloadLen);
          if (opcode === 0x8) { socket.write(Buffer.from([0x88, 0x00])); socket.destroy(); return; }
          if (opcode === 0x9) socket.write(Buffer.from([0x8a, 0x00]));
          if (opcode === 0xa) pendingPong.delete(socket);
        }
      });
      socket.on('close', () => { clients.delete(socket); pendingPong.delete(socket); });
      socket.on('error', () => { clients.delete(socket); pendingPong.delete(socket); });
    } catch { socket.destroy(); }
  });
  server.on('clientError', (err, socket) => socket.destroy());
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  const closeRelay = async () => {
    clearInterval(pingTimer);
    for (const socket of clients) socket.destroy();
    clients.clear(); pendingPong.clear();
    await new Promise((resolve) => { const timer = setTimeout(resolve, 2000); server.close(() => { clearTimeout(timer); resolve(); }); });
    await store.close().catch(() => {});
  };
  return { server, store, port: server.address().port, dataDirectory, close: closeRelay };
}

if (_isMain(process.argv[1])) {
  const relay = await startRelay({ port: Number(process.env.PORT || 31338) });
  console.log(`Terminus City is listening at http://127.0.0.1:${relay.port}`);
  const shutdown = () => relay.close().then(() => process.exit(0));
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
