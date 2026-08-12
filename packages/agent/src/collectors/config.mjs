import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const collectorConfigFile = (dataDirectory) => join(dataDirectory, 'collectors.json');
export async function readCollectorConfig(dataDirectory) {
  try { const value = JSON.parse(await readFile(collectorConfigFile(dataDirectory), 'utf8')); return value && typeof value === 'object' ? value : {}; } catch { return {}; }
}
export async function writeCollectorConfig(dataDirectory, config) {
  await mkdir(dataDirectory, { recursive: true, mode: 0o700 }); const file = collectorConfigFile(dataDirectory); const tmp = `${file}.tmp`;
  await writeFile(tmp, JSON.stringify(config, null, 2), { mode: 0o600 }); await rename(tmp, file);
}
