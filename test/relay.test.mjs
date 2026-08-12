import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startRelay, _isMain, websocketFrame } from '../apps/relay/src/server.mjs';

async function withRelay(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'terminus-test-'));
  const relay = await startRelay({ port: 0, dataDirectory: dir });
  try { await fn(relay); } finally { await relay.close().catch(() => {}); await rm(dir, { recursive: true, force: true }); }
}

/** Low-level HTTP request that allows overriding the Host header (unlike fetch). */
function rawRequest(port, { method = 'GET', path = '/', headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path, method, headers }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: data ? JSON.parse(data) : null }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function fetchRelay(port, path, options = {}) {
  return fetch(`http://127.0.0.1:${port}${path}`, options);
}

// --- Phase 2: cross-origin protection ---

test('POST /control with evil origin is rejected with 403', async () => {
  await withRelay(async ({ port }) => {
    const res = await fetchRelay(port, '/control', {
      method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
      body: JSON.stringify({ paused: true }),
    });
    assert.equal(res.status, 403);
    const health = await fetchRelay(port, '/health');
    const body = await health.json();
    assert.equal(body.paused, false, 'paused state must remain unchanged after rejected request');
  });
});

test('POST /control with mismatched Host is rejected with 403', async () => {
  await withRelay(async ({ port }) => {
    const res = await rawRequest(port, {
      method: 'POST', path: '/control',
      headers: { host: 'evil.example', 'content-type': 'application/json' },
      body: JSON.stringify({ paused: true }),
    });
    assert.equal(res.status, 403);
  });
});

test('POST /events with content-type text/plain is rejected', async () => {
  await withRelay(async ({ port }) => {
    const res = await fetchRelay(port, '/events', {
      method: 'POST', headers: { 'content-type': 'text/plain' },
      body: '{}',
    });
    assert.ok(res.status === 400 || res.status === 403, `expected 400 or 403, got ${res.status}`);
    const eventsRes = await fetchRelay(port, '/events');
    const { events } = await eventsRes.json();
    assert.deepEqual(events, [], 'event list must be empty after rejected post');
  });
});

test('POST /control with no origin and correct Host succeeds', async () => {
  await withRelay(async ({ port }) => {
    const res = await fetchRelay(port, '/control', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ paused: true }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.paused, true);
  });
});

test('GET /snapshot with evil origin is rejected with 403', async () => {
  await withRelay(async ({ port }) => {
    const res = await fetchRelay(port, '/snapshot', { headers: { origin: 'https://evil.example' } });
    assert.equal(res.status, 403);
  });
});

// --- Phase 3: path resolution ---

test('GET / returns 200 text/html', async () => {
  await withRelay(async ({ port }) => {
    const res = await fetchRelay(port, '/');
    assert.equal(res.status, 200);
    assert.ok(res.headers.get('content-type').startsWith('text/html'), `expected text/html, got ${res.headers.get('content-type')}`);
    await res.text(); // consume body to close the connection promptly
  });
});

test('GET /layout.mjs returns a JavaScript module MIME type', async () => {
  await withRelay(async ({ port }) => {
    const res = await fetchRelay(port, '/layout.mjs');
    assert.equal(res.status, 200);
    assert.ok(res.headers.get('content-type').startsWith('text/javascript'));
  });
});

test('GET /../../package.json returns 404 (traversal blocked)', async () => {
  await withRelay(async ({ port }) => {
    const res = await fetchRelay(port, '/../../package.json');
    assert.equal(res.status, 404);
  });
});

test('GET /%2e%2e/%2e%2e/package.json returns 404 (encoded traversal blocked)', async () => {
  await withRelay(async ({ port }) => {
    const res = await rawRequest(port, { path: '/%2e%2e/%2e%2e/package.json' });
    assert.equal(res.status, 404);
  });
});

// --- Phase 5: WebSocket shutdown and frame format ---

const WS_KEY = 'dGhlIHNhbXBsZSBub25jZQ==';

function wsUpgrade(port) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(port, '127.0.0.1');
    socket.write(`GET /events HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${WS_KEY}\r\nSec-WebSocket-Version: 13\r\n\r\n`);
    let data = '';
    const onData = (chunk) => {
      data += chunk.toString('latin1');
      if (!data.includes('\r\n\r\n')) return;
      socket.off('data', onData);
      if (data.startsWith('HTTP/1.1 101')) resolve(socket);
      else reject(new Error(`Upgrade failed: ${data.slice(0, 200)}`));
    };
    socket.on('data', onData);
    socket.on('error', reject);
  });
}

test('relay.close() resolves within 3 seconds with an open WebSocket client', { timeout: 6000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'terminus-ws-'));
  const relay = await startRelay({ port: 0, dataDirectory: dir });
  const socket = await wsUpgrade(relay.port);
  try {
    const start = Date.now();
    await relay.close();
    assert.ok(Date.now() - start < 3000, `relay.close() must resolve within 3s, took ${Date.now() - start}ms`);
  } finally { socket.destroy(); await rm(dir, { recursive: true, force: true }); }
});

test('websocketFrame emits correct header for small payload (< 126 bytes)', () => {
  const frame = websocketFrame({ ok: 1 });
  const body = Buffer.from(JSON.stringify({ ok: 1 }));
  assert.equal(frame[0], 0x81, 'first byte must be 0x81');
  assert.equal(frame[1], body.length, 'second byte is payload length for small frames');
  assert.ok(frame[1] < 126, 'payload must be < 126 bytes for this branch');
});

test('websocketFrame emits correct header for medium payload (126–65535 bytes)', () => {
  const payload = { d: 'x'.repeat(200) };
  const body = Buffer.from(JSON.stringify(payload));
  assert.ok(body.length >= 126 && body.length < 65536, 'payload must be in medium range');
  const frame = websocketFrame(payload);
  assert.equal(frame[0], 0x81);
  assert.equal(frame[1], 126, 'second byte must be 126 for medium frames');
  assert.equal((frame[2] << 8) | frame[3], body.length, 'bytes 2-3 must encode payload length');
});

test('websocketFrame emits correct header for large payload (>= 65536 bytes)', () => {
  const payload = { d: 'x'.repeat(70000) };
  const body = Buffer.from(JSON.stringify(payload));
  assert.ok(body.length >= 65536, 'payload must be >= 65536 bytes');
  const frame = websocketFrame(payload);
  assert.equal(frame[0], 0x81);
  assert.equal(frame[1], 127, 'second byte must be 127 for large frames');
  assert.equal(frame.readUInt32BE(2), 0, 'high 32 bits of length must be 0');
  assert.equal(frame.readUInt32BE(6), body.length, 'low 32 bits must encode payload length');
});

test('_isMain correctly identifies the server module', () => {
  const serverPath = fileURLToPath(new URL('../apps/relay/src/server.mjs', import.meta.url));
  assert.ok(_isMain(serverPath), 'should match when argv[1] is the server path');
  assert.ok(!_isMain('/some/other/script.mjs'), 'should not match unrelated paths');
  assert.ok(!_isMain(fileURLToPath(import.meta.url)), 'should not match the test file itself');
});
