#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { access, constants, mkdir, rename, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { commandFinishedEvent, defaultDataDirectory } from '../packages/agent/src/sanitizer.mjs';
import { commandStartedEvent } from '../packages/agent/src/sanitizer.mjs';
import { readCollectorConfig, writeCollectorConfig } from '../packages/agent/src/collectors/config.mjs';
import { gitCollector } from '../packages/agent/src/collectors/git.mjs';
import { systemCollector } from '../packages/agent/src/collectors/system.mjs';
import { networkCollector } from '../packages/agent/src/collectors/network.mjs';
import { containerCollector } from '../packages/agent/src/collectors/container.mjs';

const project = fileURLToPath(new URL('..', import.meta.url));
const [command = 'help', ...args] = process.argv.slice(2);
const baseUrl = `http://127.0.0.1:${process.env.TERMINUS_CITY_PORT || 31338}`;
const usage = () => console.log(`Terminus City

Usage: terminus <start|dev|status|pause|resume|emit|emit-started|collectors|doctor>

Events are sanitized before they are sent to the local relay.`);
const request = async (path, options) => { const response = await fetch(`${baseUrl}${path}`, options); const body = await response.json(); if (!response.ok) throw new Error(body.error || `Relay returned ${response.status}`); return body; };

if (command === 'start' || command === 'dev') {
  const child = spawn(process.execPath, [join(project, 'apps/relay/src/server.mjs')], { cwd: project, env: process.env, stdio: 'inherit' });
  child.on('exit', (code) => process.exitCode = code ?? 0);
} else if (command === 'status') {
  try { const health = await request('/health'); console.log(`Relay: running at ${baseUrl}\nCollection: ${health.paused ? 'paused' : 'active'}\nBinding: 127.0.0.1 only`); } catch { console.log('Relay: not running\nCollection: unavailable'); process.exitCode = 1; }
} else if (command === 'pause' || command === 'resume') {
  const dataDir = defaultDataDirectory(); await mkdir(dataDir, { recursive: true, mode: 0o700 }); const controlFile = join(dataDir, 'control.json'); const tmp = `${controlFile}.tmp`; const next = { paused: command === 'pause' }; await writeFile(tmp, JSON.stringify(next), { mode: 0o600 }); await rename(tmp, controlFile); console.log(`Collection ${next.paused ? 'paused' : 'resumed'}.`);
} else if (command === 'emit') {
  const [base = 'shell', subcommand = '', exitCode = '0', durationMs = '0', pairId] = args;
  const event = commandFinishedEvent(`${base} ${subcommand}`, { exitCode, durationMs, ...(pairId ? { pairId } : {}) }); await request('/events', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(event) }); console.log(`Observed ${event.payload.command} (${event.payload.category}).`);
} else if (command === 'emit-started') {
  const [base = 'shell', subcommand = '', pairId] = args; const event = commandStartedEvent(`${base} ${subcommand}`, { ...(pairId ? { pairId } : {}) }); await request('/events', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(event) }); console.log(`Observed start for ${event.payload.command} (${event.payload.category}).`);
} else if (command === 'collectors') {
  const [action, name, value, ...flags] = args; const dataDir = defaultDataDirectory(); const config = await readCollectorConfig(dataDir); const collectors = [gitCollector, systemCollector, networkCollector, containerCollector]; const selected = collectors.find((item) => item.name === name);
  if (!action) { for (const item of collectors) console.log(`${item.name}: ${(config[item.name]?.enabled) ? 'enabled' : 'disabled'} | ${item.platforms.includes(process.platform) ? 'supported' : 'unsupported'} | ${item.description}`); }
  else if (action === 'add-repo') { const path = resolve(name || ''); if (!name) throw new Error('A repository path is required'); const git = config.git || { enabled: false, repos: [] }; git.repos = [...(git.repos || []), { path }]; config.git = git; await writeCollectorConfig(dataDir, config); console.log('Repository registered. Git collection remains disabled.'); }
  else if ((action === 'enable' || action === 'disable') && selected) { const current = config[name] || {}; if (action === 'enable' && !current.enabled && !flags.includes('--yes')) { console.log(`${selected.description}\nRun again with --yes to enable this collector.`); process.exitCode = 1; } else { config[name] = { ...current, enabled: action === 'enable' }; await writeCollectorConfig(dataDir, config); console.log(`${name} collector ${action}d.`); } }
  else throw new Error('Usage: terminus collectors [enable|disable NAME|add-repo PATH]');
} else if (command === 'doctor') {
  const dataDirectory = defaultDataDirectory(); const checks = [];
  checks.push(['Node.js', Number(process.versions.node.split('.')[0]) >= 20, process.version]);
  try { await access(dataDirectory, constants.W_OK); checks.push(['Data directory', true, dataDirectory]); } catch { checks.push(['Data directory', true, `${dataDirectory} (created at first start)`]); }
  try { const health = await request('/health'); checks.push(['Local relay', true, health.paused ? 'running (paused)' : 'running']); } catch { checks.push(['Local relay', false, 'not running']); }
  const config = await readCollectorConfig(dataDirectory); for (const item of [gitCollector, systemCollector, networkCollector, containerCollector]) { const health = await request('/health').then((item) => item).catch(() => null); const detail = health?.collectors?.[item.name]; checks.push([`Collector ${item.name}`, true, config[item.name]?.enabled ? (detail?.backedOff ? 'enabled (backed off)' : detail?.error ? 'enabled (error)' : 'enabled') : 'disabled']); }
  for (const [name, ok, detail] of checks) console.log(`${ok ? '✓' : '✗'} ${name}: ${detail}`);
  if (checks.some(([, ok]) => !ok)) process.exitCode = 1;
} else usage();
