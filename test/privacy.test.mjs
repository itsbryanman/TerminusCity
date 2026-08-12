import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { commandFinishedEvent, privateKey } from '../packages/agent/src/sanitizer.mjs';
import { createEvent } from '../packages/protocol/src/index.mjs';
import { EventStore } from '../packages/agent/src/store.mjs';
import { websocketFrame } from '../apps/relay/src/server.mjs';
import { gitCollector } from '../packages/agent/src/collectors/git.mjs';

test('privacy backstop: serialized events, snapshots, and websocket frames contain no planted secrets', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'acmecorp-private-')); const repo = join(dir, 'secret-billing');
  const canaries = ['acmecorp', 'secret-billing', 'ACME-1234', 'password', 'bigcorp', 'registry.acme.internal', 'billing-api:v2', 'AWS_SECRET_ACCESS_KEY', 'wJalrXUtnFEMI', 'deploy-acmecorp-prod'];
  try {
    const run = promisify(execFile); await run('git', ['init', '-q', repo]); await run('git', ['-C', repo, 'config', 'user.email', 'privacy@example.invalid']); await run('git', ['-C', repo, 'config', 'user.name', 'Privacy Test']); await run('git', ['-C', repo, 'remote', 'add', 'origin', 'https://github.com/acmecorp/secret-billing']); await run('git', ['-C', repo, 'commit', '--allow-empty', '-qm', 'fix password rotation for bigcorp']); await run('git', ['-C', repo, 'branch', '-M', 'feature/ACME-1234-rotate-prod-keys']);
    const shell = [commandFinishedEvent('AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI aws s3 ls', { cwd: join(dir, 'deploy-acmecorp-prod') }), commandFinishedEvent('./deploy-acmecorp-prod.sh', { cwd: join(dir, 'deploy-acmecorp-prod') })];
    const gitEvents = await gitCollector.collect({ config: { privacyKey: 'backstop', git: { repos: [{ path: repo }] } } });
    const container = createEvent('container.started', { imageKey: privateKey('image', 'registry.acme.internal/billing-api:v2', 'backstop'), containerKey: privateKey('container', 'acmecorp-container', 'backstop'), runtime: 'docker' });
    const metrics = createEvent('system.metrics', { cpuPct: 1, memoryPct: 2, diskReadBps: 3, diskWriteBps: 4, networkRxBps: 5, networkTxBps: 6, load1: 7 }, { persist: false });
    const store = await new EventStore(dir).init(); for (const event of [...shell, ...gitEvents, container, metrics]) await store.append(event); const snapshot = await store.hydrate(); await store.close();
    const serialized = [await readFile(join(dir, 'events.jsonl'), 'utf8'), await readFile(join(dir, 'state.json'), 'utf8'), JSON.stringify(snapshot), ...shell.map((event) => websocketFrame(event).toString('utf8')), websocketFrame(container).toString('utf8')].join('\n').toLowerCase();
    for (const canary of canaries) assert.ok(!serialized.includes(canary.toLowerCase()), `privacy leak: ${canary}`);
    assert.equal(repo.includes('secret-billing'), true, 'fixture retains its canary path without serializing it');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
