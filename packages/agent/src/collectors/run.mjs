import { execFile as rawExecFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';

const execFile = promisify(rawExecFile); const META = /[;&|`$><(){}[\]*?!~\r\n]/;
/** Runs an explicitly registered, read-only argv command. stderr is never returned or logged. */
export async function runReadOnly(file, args, { cwd, allowedDirectories = [], timeout = 5000 } = {}) {
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== 'string' || META.test(arg))) throw new Error('Unsafe collector argv');
  const directory = resolve(cwd || '.'); if (!allowedDirectories.map((item) => resolve(item)).includes(directory)) throw new Error('Collector cwd is not registered');
  try { const { stdout } = await execFile(file, args, { cwd: directory, shell: false, timeout, maxBuffer: 256 * 1024, windowsHide: true, env: Object.fromEntries(['PATH', 'HOME', 'LANG'].filter((key) => process.env[key]).map((key) => [key, process.env[key]])) }); return stdout; } catch { return null; }
}
