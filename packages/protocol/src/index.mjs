import { randomUUID } from 'node:crypto';

export const PROTOCOL_VERSION = 1;
export const EVENT_TYPES = new Set([
  'shell.command.started', 'shell.command.finished', 'git.repo.discovered',
  'git.commit', 'git.branch.changed', 'test.run.finished', 'system.metrics',
  'container.started', 'network.summary'
]);
const MAX_STRING = 160;
const SAFE_COMMANDS = new Set(['other', 'export', 'env', 'printenv', 'set', 'pass', 'gpg', 'ssh', 'scp', 'rsync', 'curl', 'wget', 'mysql', 'psql', 'redis-cli', 'kubectl', 'aws', 'gcloud', 'az', 'docker', 'podman', 'test', 'vitest', 'jest', 'pytest', 'go', 'cargo', 'npm', 'pnpm', 'yarn', 'bun', 'git', 'ls', 'cd', 'cat', 'grep', 'find', 'make', 'node', 'python', 'python3', 'pip', 'ruby', 'java', 'code', 'vim', 'nvim', 'nano', 'tmux', 'htop', 'top', 'df', 'du', 'ps', 'kill', 'mkdir', 'rm', 'mv', 'cp', 'touch', 'chmod', 'chown', 'tar', 'unzip', 'sed', 'awk', 'jq', 'man', 'which', 'echo', 'clear', 'history', 'sudo', 'apt', 'dnf', 'pacman', 'brew', 'systemctl', 'journalctl']);
const SAFE_CATEGORIES = new Set(['git', 'test', 'build', 'package', 'container', 'sensitive', 'shell', 'other']);

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
  if (event.persist !== undefined && typeof event.persist !== 'boolean') throw new Error('Invalid persist');
  if (!isObject(event.payload)) throw new Error('Invalid payload');
  if (EVENT_TYPES.has(event.type)) validatePayload(event.type, event.payload);
  return structuredClone(event);
}

function validatePayload(type, p) {
  if (type.startsWith('shell.command.')) {
    string(p.command, 'payload.command'); string(p.category, 'payload.category'); string(p.cwdKey, 'payload.cwdKey');
    if (!SAFE_COMMANDS.has(p.command) || !SAFE_CATEGORIES.has(p.category) || !/^path_[a-f0-9]{16}$/.test(p.cwdKey)) throw new Error('Unsafe shell payload');
    string(p.subcommand, 'payload.subcommand', true);
    if (type.endsWith('started')) string(p.pairId, 'payload.pairId');
    if (type.endsWith('finished')) { number(p.exitCode, 'payload.exitCode', { min: 0, max: 255 }); number(p.durationMs, 'payload.durationMs', { max: 86_400_000 }); string(p.pairId, 'payload.pairId', true); }
  } else if (type === 'git.repo.discovered') { string(p.repoId, 'payload.repoId'); string(p.displayName, 'payload.displayName'); string(p.branch, 'payload.branch'); }
  else if (type === 'git.branch.changed') { string(p.repoId, 'payload.repoId'); string(p.branch, 'payload.branch'); string(p.previousBranch, 'payload.previousBranch'); }
  else if (type === 'git.commit') { string(p.repoId, 'payload.repoId'); string(p.hashShort, 'payload.hashShort'); string(p.branch, 'payload.branch'); number(p.filesChanged, 'payload.filesChanged'); number(p.insertions, 'payload.insertions'); number(p.deletions, 'payload.deletions'); }
  else if (type === 'system.metrics') { ['cpuPct', 'memoryPct', 'diskReadBps', 'diskWriteBps', 'networkRxBps', 'networkTxBps', 'load1'].forEach((k) => number(p[k], `payload.${k}`)); }
  else if (type === 'container.started') { string(p.imageKey, 'payload.imageKey'); string(p.containerKey, 'payload.containerKey'); if (!['docker', 'podman'].includes(p.runtime)) throw new Error('Invalid payload.runtime'); }
  else if (type === 'network.summary') { ['rxBytes', 'txBytes', 'windowMs', 'interfaceCount'].forEach((k) => number(p[k], `payload.${k}`)); }
  else if (type === 'test.run.finished') { string(p.runId, 'payload.runId'); if (!['node', 'vitest', 'jest', 'pytest', 'go', 'cargo', 'unknown'].includes(p.framework)) throw new Error('Invalid payload.framework'); number(p.exitCode, 'payload.exitCode', { min: 0, max: 255 }); number(p.durationMs, 'payload.durationMs', { max: 86_400_000 }); ['passed', 'failed', 'skipped'].forEach((k) => { if (p[k] !== undefined) number(p[k], `payload.${k}`); }); }
}

/** persist:false events are reduced and broadcast but intentionally never enter events.jsonl. */
export function createEvent(type, payload, { hostId = 'local', sessionId = 'manual', ts = Date.now(), persist = true } = {}) {
  return validateEvent({ v: PROTOCOL_VERSION, id: randomUUID(), ts, hostId, sessionId, type, payload, ...(persist ? {} : { persist: false }) });
}
