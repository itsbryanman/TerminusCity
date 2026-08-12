import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('shell producers sanitize before crossing the process boundary', async () => {
  for (const file of ['packages/agent/shell/bash.sh', 'packages/agent/shell/zsh.sh']) {
    const hook = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.match(hook, /__terminus_city_sanitize/);
    assert.doesNotMatch(hook, /terminus emit(?:-started)? "\$?(?:BASH_COMMAND|1)"/);
    assert.match(hook, /terminus emit .*__terminus_city_subcommand/);
  }
});
