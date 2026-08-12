import test from 'node:test';
import assert from 'node:assert/strict';
import { createEvent, validateEvent } from '../packages/protocol/src/index.mjs';

const payload = { command: 'git', subcommand: 'status', category: 'git', cwdKey: 'path_1234567890abcdef', exitCode: 0, durationMs: 4 };
test('valid command event parses', () => assert.equal(validateEvent(createEvent('shell.command.finished', payload)).payload.command, 'git'));
test('invalid protocol version rejects', () => assert.throws(() => validateEvent({ ...createEvent('shell.command.finished', payload), v: 2 })));
test('oversized protocol strings reject', () => assert.throws(() => validateEvent(createEvent('shell.command.finished', { ...payload, command: 'x'.repeat(161) }))));
test('unknown future events are safe to retain', () => assert.equal(validateEvent(createEvent('future.new.event', { value: true })).type, 'future.new.event'));
test('new event payloads and ephemeral flag validate', () => {
  assert.equal(validateEvent(createEvent('shell.command.started', { command: 'git', category: 'git', cwdKey: 'path_aaaaaaaaaaaaaaaa', pairId: 'pair_a' })).payload.pairId, 'pair_a');
  assert.equal(validateEvent(createEvent('network.summary', { rxBytes: 1, txBytes: 2, windowMs: 3, interfaceCount: 1 }, { persist: false })).persist, false);
  assert.throws(() => createEvent('test.run.finished', { runId: 'x', framework: 'bad', exitCode: 0, durationMs: 1 }));
});
test('shell protocol cannot bypass the producer allowlist', () => assert.throws(() => createEvent('shell.command.finished', { command: 'deploy-acmecorp-prod', category: 'shell', cwdKey: 'path_1234567890abcdef', exitCode: 0, durationMs: 1 })));
