import { createHash, randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { createEvent } from '../../protocol/src/index.mjs';

const SENSITIVE = new Set(['export', 'env', 'printenv', 'set', 'pass', 'gpg', 'ssh', 'scp', 'rsync', 'curl', 'wget', 'mysql', 'psql', 'redis-cli', 'kubectl', 'aws', 'gcloud', 'az', 'docker', 'podman']);
const TEST_COMMANDS = new Set(['test', 'vitest', 'jest', 'pytest', 'go', 'cargo']);
const GIT_SUBCOMMANDS = new Set(['status', 'log', 'diff', 'add', 'commit', 'push', 'pull', 'checkout', 'switch', 'merge', 'rebase', 'branch', 'fetch']);

export const COMMAND_FAMILIES = new Set([
  ...SENSITIVE, ...TEST_COMMANDS,
  'npm', 'pnpm', 'yarn', 'bun', 'git',
  'ls', 'cd', 'cat', 'grep', 'find', 'make', 'node', 'python', 'python3', 'pip',
  'ruby', 'java', 'code', 'vim', 'nvim', 'nano', 'tmux', 'htop', 'top',
  'df', 'du', 'ps', 'kill', 'mkdir', 'rm', 'mv', 'cp', 'touch', 'chmod',
  'chown', 'tar', 'unzip', 'sed', 'awk', 'jq', 'man', 'which', 'echo',
  'clear', 'history', 'sudo', 'apt', 'dnf', 'pacman', 'brew', 'systemctl', 'journalctl',
]);

export function classifyCommand(command, subcommand) {
  if (command === 'git') return { category: 'git', subcommand: GIT_SUBCOMMANDS.has(subcommand) ? subcommand : undefined };
  if (TEST_COMMANDS.has(command) || subcommand === 'test') return { category: 'test', subcommand: command === 'go' || command === 'cargo' ? subcommand : undefined };
  if (SENSITIVE.has(command)) return { category: command === 'docker' || command === 'podman' ? 'container' : 'sensitive', subcommand: undefined };
  if (['npm', 'pnpm', 'yarn', 'bun'].includes(command)) return { category: subcommand === 'run' || subcommand === 'build' ? 'build' : 'package', subcommand: ['test', 'run', 'build', 'install'].includes(subcommand) ? subcommand : undefined };
  return { category: 'shell', subcommand: undefined };
}

export function cwdKey(cwd, localSecret = 'terminus-city-local') {
  return `path_${createHash('sha256').update(`${localSecret}:${resolve(cwd)}`).digest('hex').slice(0, 16)}`;
}

/** Parses only the first two whitespace-separated tokens. Command must be in COMMAND_FAMILIES; anything else is recorded as 'other'. */
export function sanitizeCommandLine(raw, cwd = process.cwd(), options = {}) {
  const [token = '', possibleSubcommand = ''] = String(raw).trim().split(/\s+/, 2);
  const key = cwdKey(cwd, options.localSecret);
  const other = { command: 'other', category: 'other', subcommand: undefined, cwdKey: key };
  if (token.includes('=')) return other;
  const basename = token.slice(token.lastIndexOf('/') + 1);
  if (!COMMAND_FAMILIES.has(basename)) return other;
  const safeSubcommand = possibleSubcommand.replace(/[^a-zA-Z0-9._/-]/g, '').slice(0, 80);
  const classified = classifyCommand(basename, safeSubcommand);
  return { command: basename, ...classified, cwdKey: key };
}

export function commandFinishedEvent(raw, { cwd = process.cwd(), exitCode = 0, durationMs = 0, hostId = 'local', sessionId = randomUUID(), localSecret } = {}) {
  const payload = sanitizeCommandLine(raw, cwd, { localSecret });
  return createEvent('shell.command.finished', { ...payload, exitCode: Math.max(0, Math.min(255, Number(exitCode) || 0)), durationMs: Math.max(0, Math.min(86_400_000, Number(durationMs) || 0)) }, { hostId, sessionId });
}

export const defaultDataDirectory = () => process.env.TERMINUS_CITY_DATA_DIR || resolve(process.env.XDG_DATA_HOME || resolve(homedir(), '.local', 'share'), 'terminus-city');
