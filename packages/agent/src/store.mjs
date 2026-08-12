import { appendFile, chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { validateEvent } from '../../protocol/src/index.mjs';
import { createCity, reduceCity, replay } from '../../world/src/index.mjs';

export class EventStore {
  constructor(dataDirectory) { this.dir = dataDirectory; this.eventsFile = join(dataDirectory, 'events.jsonl'); this.stateFile = join(dataDirectory, 'state.json'); this.sequence = 0; this.skipped = 0; this.state = null; this._persistTimer = null; }
  async init() { await mkdir(this.dir, { recursive: true, mode: 0o700 }); await chmod(this.dir, 0o700).catch(() => {}); const events = await this.events(); this.sequence = events.at(-1)?.seq || 0; this.state = replay(events); return this; }
  async events() {
    let data;
    try { data = await readFile(this.eventsFile, 'utf8'); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    const result = []; let newSkipped = 0;
    for (const line of data.split('\n')) { if (!line.trim()) continue; try { result.push(validateEvent(JSON.parse(line))); } catch { newSkipped++; } }
    if (newSkipped > 0) { this.skipped += newSkipped; console.error(`Skipped ${newSkipped} unreadable event(s).`); }
    return result;
  }
  async append(event) { const next = this.sequence + 1; const stored = validateEvent({ ...event, seq: next }); this.sequence = next; await appendFile(this.eventsFile, `${JSON.stringify(stored)}\n`, { mode: 0o600 }); await chmod(this.eventsFile, 0o600).catch(() => {}); this.state = reduceCity(this.state, stored); this._schedulePersist(); return stored; }
  _schedulePersist() { if (this._persistTimer !== null) return; this._persistTimer = setTimeout(async () => { this._persistTimer = null; await this._persist().catch(() => {}); }, 2000); if (this._persistTimer.unref) this._persistTimer.unref(); }
  async _persist() { if (!this.state) return; const snapshot = { lastSequence: this.sequence, state: this.state }; const tmp = `${this.stateFile}.tmp`; await writeFile(tmp, JSON.stringify(snapshot), { mode: 0o600 }); await rename(tmp, this.stateFile); }
  snapshot() { this._schedulePersist(); return { lastSequence: this.sequence, state: this.state }; }
  hydrate() { if (this.state) return { lastSequence: this.sequence, state: this.state }; return this._rebuildFromDisk(); }
  async _rebuildFromDisk() { try { const saved = JSON.parse(await readFile(this.stateFile, 'utf8')); if (saved.lastSequence === this.sequence) { this.state = saved.state; return saved; } } catch {} const events = await this.events(); this.state = replay(events); return { lastSequence: this.sequence, state: this.state }; }
  async close() { if (this._persistTimer !== null) { clearTimeout(this._persistTimer); this._persistTimer = null; } await this._persist().catch(() => {}); }
}
