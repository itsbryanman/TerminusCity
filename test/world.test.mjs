import test from 'node:test';
import assert from 'node:assert/strict';
import { createEvent } from '../packages/protocol/src/index.mjs';
import { createCity, replay, reduceCity } from '../packages/world/src/index.mjs';
import { sanitizeCommandLine } from '../packages/agent/src/sanitizer.mjs';

test('the same event stream produces the same city', () => {
  const events = [createEvent('shell.command.finished', { command: 'git', subcommand: 'commit', category: 'git', cwdKey: 'path_a', exitCode: 0, durationMs: 3 }, { ts: 100 }), createEvent('git.commit', { repoId: 'repo_a', hashShort: 'abc1234', branch: 'main', filesChanged: 1, insertions: 2, deletions: 0 }, { ts: 200 })];
  assert.deepEqual(replay(events, createCity()), replay(events, createCity()));
});
test('reduceCity does not mutate its input state', () => {
  const state = createCity();
  const event = { ...createEvent('shell.command.finished', { command: 'git', subcommand: 'commit', category: 'git', cwdKey: 'path_a', exitCode: 0, durationMs: 3 }, { ts: 100 }), seq: 1 };
  const stateBefore = JSON.parse(JSON.stringify(state));
  reduceCity(state, event);
  assert.deepEqual(state, stateBefore, 'reduceCity must not modify its input');
});
test('sanitization only preserves the safe command classification', () => {
  const safe = sanitizeCommandLine('curl -H Authorization:Bearer-super-secret-token https://private.example', '/home/alice/work');
  assert.deepEqual(Object.keys(safe).sort(), ['category', 'command', 'cwdKey', 'subcommand'].sort()); assert.equal(safe.command, 'curl'); assert.equal(safe.subcommand, undefined); assert.match(safe.cwdKey, /^path_/);
});
