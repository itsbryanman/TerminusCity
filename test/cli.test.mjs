import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const cli = fileURLToPath(new URL('../bin/terminus.mjs', import.meta.url));

async function withDir(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'terminus-cli-'));
  try { await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

test('terminus pause writes control.json without the relay running', async () => {
  await withDir(async (dir) => {
    const env = { ...process.env, TERMINUS_CITY_DATA_DIR: dir }; delete env.NODE_TEST_CONTEXT;
    const { stdout } = await execFileAsync(process.execPath, [cli, 'pause'], { env });
    assert.match(stdout, /paused/i, 'stdout must confirm collection was paused');
    const controlFile = join(dir, 'control.json');
    const parsed = JSON.parse(await readFile(controlFile, 'utf8'));
    assert.equal(parsed.paused, true, 'control.json must have paused: true');
  });
});

test('terminus resume writes control.json without the relay running', async () => {
  await withDir(async (dir) => {
    const env = { ...process.env, TERMINUS_CITY_DATA_DIR: dir }; delete env.NODE_TEST_CONTEXT;
    const { stdout } = await execFileAsync(process.execPath, [cli, 'resume'], { env });
    assert.match(stdout, /resumed/i, 'stdout must confirm collection was resumed');
    const controlFile = join(dir, 'control.json');
    const parsed = JSON.parse(await readFile(controlFile, 'utf8'));
    assert.equal(parsed.paused, false, 'control.json must have paused: false');
  });
});
