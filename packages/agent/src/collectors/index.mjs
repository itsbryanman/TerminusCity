import { readCollectorConfig } from './config.mjs';

export class CollectorHost {
  constructor({ collectors = [], dataDirectory, dispatch, isPaused = async () => false, timeoutMs = 5000 }) { this.collectors = collectors; this.dataDirectory = dataDirectory; this.dispatch = dispatch; this.isPaused = isPaused; this.timeoutMs = timeoutMs; this.entries = new Map(); this.closed = false; }
  async _tick(collector, entry) {
    if (this.closed || entry.running || !collector.platforms.includes(process.platform) || await this.isPaused()) return;
    const config = await readCollectorConfig(this.dataDirectory); if (!config[collector.name]?.enabled) return;
    entry.running = true;
    try {
      let timer; const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('collector timeout')), this.timeoutMs); });
      const result = await Promise.race([collector.collect({ dataDirectory: this.dataDirectory, config, previous: entry.previous }), timeout]); clearTimeout(timer);
      const events = Array.isArray(result) ? result : result?.events || []; entry.previous = result?.state ?? result?.previous ?? events.previous ?? entry.previous;
      for (const event of events) { if (!this.closed && !await this.isPaused()) await this.dispatch(event); }
      entry.failures = 0; entry.error = null;
    } catch (error) { entry.failures += 1; entry.error = 'collector failed'; if (entry.failures === 1) console.error(`Collector ${collector.name} failed; backing off.`); entry.backoffUntil = Date.now() + Math.min(300000, collector.intervalMs * (2 ** entry.failures)); }
    finally { entry.running = false; }
  }
  start() { for (const collector of this.collectors) { const entry = { running: false, failures: 0, error: null, backoffUntil: 0, previous: undefined, timer: null }; this.entries.set(collector.name, entry); const run = async () => { if (!this.closed && Date.now() >= entry.backoffUntil) await this._tick(collector, entry); }; run(); entry.timer = setInterval(run, collector.intervalMs); entry.timer.unref?.(); } return this; }
  stop() { this.closed = true; for (const entry of this.entries.values()) clearInterval(entry.timer); }
  status() { return Object.fromEntries([...this.entries].map(([name, entry]) => [name, { error: entry.error, backedOff: entry.backoffUntil > Date.now() }])); }
}
