import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { gitCollector } from '../packages/agent/src/collectors/git.mjs';

const run = promisify(execFile);
async function fixture() { const repo = await mkdtemp(join(tmpdir(), 'acmecorp-secret-billing-')); await run('git', ['init', '-q', repo]); await run('git', ['-C', repo, 'config', 'user.email', 'privacy@example.invalid']); await run('git', ['-C', repo, 'config', 'user.name', 'Privacy Test']); await run('git', ['-C', repo, 'remote', 'add', 'origin', 'https://github.com/acmecorp/secret-project']); await writeFile(join(repo, 'note.txt'), 'safe'); await run('git', ['-C', repo, 'add', '.']); await run('git', ['-C', repo, 'commit', '-qm', 'fix ACME-1234 password rotation for bigcorp']); await run('git', ['-C', repo, 'branch', '-M', 'feature/ACME-1234-billing-fix']); return repo; }

test('git collector emits only sanitized repo and branch values, once per head', async () => {
  const repo = await fixture();
  try {
    const first = await gitCollector.collect({ config: { privacyKey: 'test-key', git: { repos: [{ path: repo }] } } }); const serialized = JSON.stringify(first);
    for (const secret of ['acmecorp', 'secret-project', 'ACME-1234', 'password', 'bigcorp', repo]) assert.ok(!serialized.includes(secret), `leaked ${secret}`);
    assert.equal(first.find((event) => event.type === 'git.repo.discovered').payload.branch.startsWith('branch_'), true);
    const second = await gitCollector.collect({ config: { privacyKey: 'test-key', git: { repos: [{ path: repo }] } }, previous: first.state });
    assert.equal(second.length, 0, 'a second poll does not duplicate HEAD');
  } finally { await rm(repo, { recursive: true, force: true }); }
});
