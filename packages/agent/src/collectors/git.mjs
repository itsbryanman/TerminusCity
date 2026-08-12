import { createEvent } from '../../../protocol/src/index.mjs';
import { privateKey } from '../sanitizer.mjs';
import { runReadOnly } from './run.mjs';

const BRANCHES = new Set(['main', 'master', 'develop', 'dev', 'staging', 'production', 'release', 'trunk']);
export const safeBranch = (branch, secret) => BRANCHES.has(branch) ? branch : privateKey('branch', branch, secret);
const result = (events, state) => Object.assign(events, { state });
const output = async (repo, args) => runReadOnly('git', ['-C', repo, ...args], { cwd: repo, allowedDirectories: [repo] });

export const gitCollector = { name: 'git', defaultEnabled: false, intervalMs: 15000, platforms: ['linux', 'darwin', 'win32'], description: 'Hashed registered repo identity, safe branch label, commit hash, and numeric diff counts.', async collect({ config, previous = {} }) {
  const events = []; const state = { ...previous }; const repos = config.git?.repos || [];
  for (const registered of repos) {
    const repo = typeof registered === 'string' ? registered : registered.path; if (!repo) continue;
    const top = await output(repo, ['rev-parse', '--show-toplevel']); const branchRaw = await output(repo, ['rev-parse', '--abbrev-ref', 'HEAD']); if (top === null || branchRaw === null) continue;
    const repoId = privateKey('repo', repo, config.privacyKey); const branch = safeBranch(branchRaw.trim(), config.privacyKey); const alias = typeof registered === 'object' && typeof registered.alias === 'string' ? registered.alias.slice(0, 80) : repoId.slice(0, 13);
    const known = state[repoId] || {}; if (!known.discovered) events.push(createEvent('git.repo.discovered', { repoId, displayName: alias, branch })); if (known.branch && known.branch !== branch) events.push(createEvent('git.branch.changed', { repoId, branch, previousBranch: known.branch }));
    const hashShort = (await output(repo, ['rev-parse', '--short=7', 'HEAD']))?.trim(); if (hashShort && hashShort !== known.hashShort) { const numstat = await output(repo, ['show', '--numstat', '--format=', 'HEAD']); let filesChanged = 0; let insertions = 0; let deletions = 0; for (const line of (numstat || '').split('\n')) { const [add, del] = line.split('\t'); if (/^\d+$/.test(add) && /^\d+$/.test(del)) { filesChanged += 1; insertions += Number(add); deletions += Number(del); } } events.push(createEvent('git.commit', { repoId, hashShort, branch, filesChanged, insertions, deletions })); }
    state[repoId] = { discovered: true, branch, hashShort };
  }
  return result(events, state);
} };
