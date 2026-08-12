import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEvent } from '../packages/protocol/src/index.mjs';
import { EventStore } from '../packages/agent/src/store.mjs';
import { replay } from '../packages/world/src/index.mjs';
import { startRelay } from '../apps/relay/src/server.mjs';

async function withDir(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'terminus-store-'));
  try { await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

const cmdPayload = { command: 'git', category: 'git', subcommand: 'status', cwdKey: 'path_abcd1234abcd1234', exitCode: 0, durationMs: 5 };

test('events() skips malformed lines and tracks skipped count', async () => {
  await withDir(async (dir) => {
    const e1 = createEvent('shell.command.finished', cmdPayload);
    const e2 = createEvent('shell.command.finished', { ...cmdPayload, cwdKey: 'path_efgh5678efgh5678' });
    const eventsFile = join(dir, 'events.jsonl');
    await writeFile(eventsFile, `${JSON.stringify({ ...e1, seq: 1 })}\n{truncated bad line\n${JSON.stringify({ ...e2, seq: 2 })}\n`);
    const store = new EventStore(dir);
    const events = await store.events();
    assert.equal(events.length, 2, 'should return 2 valid events');
    assert.equal(store.skipped, 1, 'should track 1 skipped line');
  });
});

test('relay starts against a corrupted log and answers GET /health with 200', async () => {
  await withDir(async (dir) => {
    const e1 = createEvent('shell.command.finished', cmdPayload);
    const eventsFile = join(dir, 'events.jsonl');
    await writeFile(eventsFile, `${JSON.stringify({ ...e1, seq: 1 })}\n{corrupted\n`);
    const relay = await startRelay({ port: 0, dataDirectory: dir });
    try {
      const res = await fetch(`http://127.0.0.1:${relay.port}/health`);
      assert.equal(res.status, 200, 'relay must not crash on corrupted log');
      const body = await res.json();
      assert.ok(body.ok);
    } finally { await relay.close(); }
  });
});

test('failed append leaves sequence unchanged; next successful append is contiguous', async () => {
  await withDir(async (dir) => {
    const store = await new EventStore(dir).init();
    const before = store.sequence;
    await assert.rejects(() => store.append({ not: 'a valid event at all' }), 'bad event must throw');
    assert.equal(store.sequence, before, 'sequence must be unchanged after failed append');
    const stored = await store.append(createEvent('shell.command.finished', cmdPayload));
    assert.equal(stored.seq, before + 1, 'next good append must get the expected contiguous seq');
  });
});

test('5000 appends stay under 5 s and in-memory state matches full replay', async () => {
  await withDir(async (dir) => {
    const store = await new EventStore(dir).init();
    const cwdKeys = Array.from({ length: 10 }, (_, i) => `path_${String(i).padStart(16, '0')}`);
    const start = Date.now();
    for (let i = 0; i < 5000; i++) {
      await store.append(createEvent('shell.command.finished', { command: 'git', category: 'git', subcommand: 'status', cwdKey: cwdKeys[i % 10], exitCode: 0, durationMs: 1 }));
    }
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 5000, `5000 appends must finish in under 5 s, took ${elapsed} ms`);
    const events = await store.events();
    const replayed = replay(events);
    assert.deepEqual(store.state, replayed, 'in-memory state must equal a fresh full replay');
    await store.close();
  });
});
test('snapshot flushes valid JSON atomically via store.close()', async () => {
  await withDir(async (dir) => {
    const store = await new EventStore(dir).init();
    await store.append(createEvent('shell.command.finished', cmdPayload));
    store.snapshot(); // schedules background persist
    await store.close(); // flushes the pending write immediately
    const stateFile = join(dir, 'state.json');
    const parsed = JSON.parse(readFileSync(stateFile, 'utf8'));
    assert.ok(typeof parsed.lastSequence === 'number', 'state.json must have numeric lastSequence');
    assert.ok(parsed.state, 'state.json must have a state object');
  });
});
