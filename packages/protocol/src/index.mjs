import { randomUUID } from 'node:crypto';

export const PROTOCOL_VERSION = 1;
export const EVENT_TYPES = new Set([
  'shell.command.started', 'shell.command.finished', 'git.repo.discovered',
  'git.commit', 'git.branch.changed', 'test.run.finished', 'system.metrics',
  'container.started', 'network.summary'
]);
const MAX_STRING = 160;

function isObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function string(value, name, optional = false) {
  if (optional && value === undefined) return;
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_STRING) throw new Error(`Invalid ${name}`);
}
function number(value, name, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isFinite(value) || value < min || value > max) throw new Error(`Invalid ${name}`);
}

/** Validates the stable envelope while deliberately allowing unknown future event types. */
export function validateEvent(event) {
  if (!isObject(event)) throw new Error('Event must be an object');
  if (event.v !== PROTOCOL_VERSION) throw new Error('Unsupported protocol version');
  string(event.id, 'id'); string(event.hostId, 'hostId'); string(event.sessionId, 'sessionId');
  string(event.type, 'type'); number(event.ts, 'ts');
  if (event.seq !== undefined) number(event.seq, 'seq', { min: 1 });
  if (!isObject(event.payload)) throw new Error('Invalid payload');
  if (EVENT_TYPES.has(event.type)) validatePayload(event.type, event.payload);
  return structuredClone(event);
}

function validatePayload(type, p) {
  if (type.startsWith('shell.command.')) {
    string(p.command, 'payload.command'); string(p.category, 'payload.category'); string(p.cwdKey, 'payload.cwdKey');
    string(p.subcommand, 'payload.subcommand', true);
    if (type.endsWith('finished')) { number(p.exitCode, 'payload.exitCode', { min: 0, max: 255 }); number(p.durationMs, 'payload.durationMs', { max: 86_400_000 }); }
  } else if (type === 'git.repo.discovered') { string(p.repoId, 'payload.repoId'); string(p.displayName, 'payload.displayName'); string(p.branch, 'payload.branch'); }
  else if (type === 'git.commit') { string(p.repoId, 'payload.repoId'); string(p.hashShort, 'payload.hashShort'); string(p.branch, 'payload.branch'); }
  else if (type === 'system.metrics') { ['cpuPct', 'memoryPct', 'diskReadBps', 'diskWriteBps', 'networkRxBps', 'networkTxBps', 'load1'].forEach((k) => number(p[k], `payload.${k}`)); }
}

export function createEvent(type, payload, { hostId = 'local', sessionId = 'manual', ts = Date.now() } = {}) {
  return validateEvent({ v: PROTOCOL_VERSION, id: randomUUID(), ts, hostId, sessionId, type, payload });
}
