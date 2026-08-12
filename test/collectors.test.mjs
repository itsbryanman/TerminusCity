import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CollectorHost } from '../packages/agent/src/collectors/index.mjs';
import { writeCollectorConfig } from '../packages/agent/src/collectors/config.mjs';
import { runReadOnly } from '../packages/agent/src/collectors/run.mjs';

test('read-only helper rejects shell metacharacters and unregistered cwd', async () => {
  await assert.rejects(() => runReadOnly('git', ['status; rm -rf /'], { cwd: process.cwd(), allowedDirectories: [process.cwd()] }));
  await assert.rejects(() => runReadOnly('git', ['status'], { cwd: process.cwd(), allowedDirectories: [] }));
});

test('collector host honors consent, pause, and close', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'terminus-collectors-')); let calls = 0; let paused = false;
  try {
    await writeCollectorConfig(dir, { fake: { enabled: true } });
    const host = new CollectorHost({ dataDirectory: dir, isPaused: async () => paused, dispatch: async () => { calls += 1; }, collectors: [{ name: 'fake', intervalMs: 10, platforms: [process.platform], async collect() { return [{ v: 1, id: 'x', ts: 1, hostId: 'h', sessionId: 's', type: 'future.fake', payload: {} }]; } }] }).start();
    await new Promise((resolve) => setTimeout(resolve, 35)); assert.ok(calls > 0);
    paused = true; const before = calls; await new Promise((resolve) => setTimeout(resolve, 25)); assert.equal(calls, before, 'pause halts collection');
    host.stop(); paused = false; await new Promise((resolve) => setTimeout(resolve, 25)); assert.equal(calls, before, 'closed host cannot tick');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
