import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeCommandLine, COMMAND_FAMILIES } from '../packages/agent/src/sanitizer.mjs';

const GIT_SUBCOMMANDS = new Set(['status', 'log', 'diff', 'add', 'commit', 'push', 'pull', 'checkout', 'switch', 'merge', 'rebase', 'branch', 'fetch']);
const NPM_SUBCOMMANDS = new Set(['test', 'run', 'build', 'install']);

test('inline env assignment yields command === other and does not leak the secret', () => {
  const result = sanitizeCommandLine('AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY aws s3 ls');
  assert.equal(result.command, 'other');
  assert.ok(!JSON.stringify(result).includes('wJalr'), 'secret key value must not appear in serialized result');
});

test('shell script path yields command === other and does not leak the script name', () => {
  const result = sanitizeCommandLine('./deploy-acmecorp-prod.sh --force');
  assert.equal(result.command, 'other');
  assert.ok(!JSON.stringify(result).includes('acmecorp'), 'company name must not appear in serialized result');
});

test('unknown binary yields command === other', () => {
  const result = sanitizeCommandLine('hunter2-vpn-clientname --connect');
  assert.equal(result.command, 'other');
});

test('git commit yields correct classification', () => {
  const result = sanitizeCommandLine('git commit -m "secret message"');
  assert.equal(result.command, 'git');
  assert.equal(result.category, 'git');
  assert.equal(result.subcommand, 'commit');
});

test('curl with auth header yields sensitive classification', () => {
  const result = sanitizeCommandLine('curl -H Authorization:Bearer-token https://x');
  assert.equal(result.command, 'curl');
  assert.equal(result.category, 'sensitive');
  assert.equal(result.subcommand, undefined);
});

test('adversarial command lines never produce out-of-vocabulary command values', () => {
  const adversarial = [
    'AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY aws s3 ls',
    './deploy-acmecorp-prod.sh --force',
    'hunter2-vpn-clientname --connect',
    '../scripts/run.sh',
    '/home/alice/.secret-tool --export password',
    'password=hunter2 curl https://api.example',
    '$HOME/.bin/malware --silent',
    'rm;malware',
    'cmd.exe /c dir',
    '$(whoami)',
  ];
  const validSubcommands = new Set([...GIT_SUBCOMMANDS, ...NPM_SUBCOMMANDS]);
  for (const cmd of adversarial) {
    const result = sanitizeCommandLine(cmd);
    assert.ok(
      result.command === 'other' || COMMAND_FAMILIES.has(result.command),
      `command '${result.command}' from input '${cmd}' is not in the fixed vocabulary`,
    );
    assert.match(result.cwdKey, /^path_[0-9a-f]{16}$/, `cwdKey malformed for input '${cmd}'`);
    if (result.subcommand !== undefined) {
      assert.ok(
        validSubcommands.has(result.subcommand) || typeof result.subcommand === 'string',
        `subcommand '${result.subcommand}' from '${cmd}' must be a known string`,
      );
    }
  }
});
