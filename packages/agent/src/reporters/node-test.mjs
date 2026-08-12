import { createEvent } from '../../../protocol/src/index.mjs';
import { randomUUID } from 'node:crypto';

/** node:test reporter: forwards aggregate results only, never test labels or output. */
export default async function* report(source) {
  let passed = 0; let failed = 0; const started = Date.now();
  for await (const event of source) {
    if (event.type === 'test:pass') passed += 1;
    if (event.type === 'test:fail') failed += 1;
    yield event;
  }
  const payload = { runId: randomUUID(), framework: 'node', exitCode: failed ? 1 : 0, durationMs: Date.now() - started, passed, failed };
  try { await fetch(`${process.env.TERMINUS_CITY_RELAY || 'http://127.0.0.1:31338'}/events`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(createEvent('test.run.finished', payload)) }); } catch {}
}
