import test from 'node:test';
import assert from 'node:assert/strict';
import { createEvent, validateEvent } from '../packages/protocol/src/index.mjs';

const payload = { command: 'git', subcommand: 'status', category: 'git', cwdKey: 'path_12345678', exitCode: 0, durationMs: 4 };
test('valid command event parses', () => assert.equal(validateEvent(createEvent('shell.command.finished', payload)).payload.command, 'git'));
test('invalid protocol version rejects', () => assert.throws(() => validateEvent({ ...createEvent('shell.command.finished', payload), v: 2 })));
test('oversized protocol strings reject', () => assert.throws(() => validateEvent(createEvent('shell.command.finished', { ...payload, command: 'x'.repeat(161) }))));
test('unknown future events are safe to retain', () => assert.equal(validateEvent(createEvent('future.new.event', { value: true })).type, 'future.new.event'));
