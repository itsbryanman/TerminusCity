const hash = (text) => [...text].reduce((value, char) => ((value * 31) + char.charCodeAt(0)) >>> 0, 2166136261);
const palette = ['violet', 'cyan', 'amber', 'rose', 'lime'];
export const createCity = () => ({ version: 1, startedAt: 0, lastSequence: 0, commands: 0, commits: 0, errors: 0, metrics: { cpuPct: 0, memoryPct: 0, history: [] }, network: { rxBytes: 0, txBytes: 0 }, districts: {}, buildings: {}, incidents: [] });

function districtFor(districts, id, label = 'Terminal') { if (districts[id]) return { ...districts[id] }; const seed = hash(id); return { id, name: label.slice(0, 48), seed, palette: palette[seed % palette.length], activityScore: 0, commandCount: 0, commitCount: 0 }; }
function buildingFor(buildings, id, districtId, kind) { return buildings[id] ? { ...buildings[id] } : { id, districtId, kind, seed: hash(id), height: 2, targetHeight: 2, activity: 0, health: 100 }; }
function evictOrphans(buildings, now) { const result = {}; for (const [id, building] of Object.entries(buildings)) result[id] = building.pending && now - building.pendingAt > 300000 ? { ...building, pending: false, pendingPairId: undefined, pendingAt: undefined } : building; return result; }
function addIncident(next, event, districtId, kind) { next.incidents = [{ id: event.id, districtId, kind, createdAt: event.ts }, ...next.incidents].slice(0, 12); }

export function reduceCity(state, event) {
  const next = { ...state, startedAt: state.startedAt || event.ts, lastSequence: Math.max(state.lastSequence, event.seq || 0), buildings: evictOrphans(state.buildings, event.ts) };
  if (event.type === 'shell.command.started') {
    const id = event.payload.cwdKey; next.districts = { ...state.districts }; const district = districtFor(next.districts, id, id === 'path_0000000000000000' ? 'Manual District' : 'Terminal District'); next.districts[id] = district;
    const buildingId = `${id}:${event.payload.category}`; const building = buildingFor(next.buildings, buildingId, id, event.payload.category); building.pending = true; building.pendingPairId = event.payload.pairId; building.pendingAt = event.ts; next.buildings[buildingId] = building;
  } else if (event.type === 'shell.command.finished') {
    const id = event.payload.cwdKey; next.districts = { ...state.districts }; const district = districtFor(next.districts, id, id === 'path_0000000000000000' ? 'Manual District' : 'Terminal District'); district.commandCount += 1; district.activityScore += event.payload.exitCode === 0 ? 1 : 2; next.districts[id] = district; next.commands = state.commands + 1;
    const buildingId = `${id}:${event.payload.category}`; const building = buildingFor(next.buildings, buildingId, id, event.payload.category); building.activity += 1; building.targetHeight = Math.min(30, 2 + Math.floor(building.activity / 2)); if (!event.payload.pairId || building.pendingPairId === event.payload.pairId) { building.pending = false; building.pendingPairId = undefined; building.pendingAt = undefined; }
    if (event.payload.exitCode !== 0) { building.health = Math.max(20, building.health - 12); next.errors = state.errors + 1; addIncident(next, event, id, 'error'); }
    if (event.payload.category === 'test') building.health = event.payload.exitCode === 0 ? 100 : Math.max(20, building.health - 12);
    next.buildings[buildingId] = building;
    if (event.payload.category === 'container') { const containerId = 'containers:container'; const container = buildingFor(next.buildings, containerId, 'containers', 'container'); next.districts = { ...next.districts, containers: districtFor(next.districts, 'containers', 'Containers') }; container.activity += 1; container.targetHeight = Math.min(20, 2 + container.activity); next.buildings[containerId] = container; }
  } else if (event.type === 'git.repo.discovered') { next.districts = { ...state.districts, [event.payload.repoId]: districtFor(state.districts, event.payload.repoId, event.payload.displayName) };
  } else if (event.type === 'git.branch.changed') { next.districts = { ...state.districts }; const district = districtFor(next.districts, event.payload.repoId); district.activityScore += 2; district.branch = event.payload.branch; next.districts[district.id] = district; addIncident(next, event, district.id, 'branch');
  } else if (event.type === 'git.commit') { next.districts = { ...state.districts }; const district = districtFor(next.districts, event.payload.repoId); district.commitCount += 1; district.activityScore += Math.min(12, 2 + event.payload.filesChanged); next.districts[district.id] = district; next.commits = state.commits + 1; const id = `${district.id}:commit`; const building = buildingFor(next.buildings, id, district.id, 'office'); building.activity += Math.min(12, 2 + event.payload.filesChanged); building.targetHeight = Math.min(40, building.targetHeight + Math.min(5, 1 + Math.floor(event.payload.filesChanged / 4))); next.buildings[id] = building;
  } else if (event.type === 'test.run.finished') { const id = 'tests:test'; next.districts = { ...state.districts, tests: districtFor(state.districts, 'tests', 'Test District') }; const building = buildingFor(next.buildings, id, 'tests', 'test'); building.activity += 1; building.health = event.payload.exitCode === 0 ? 100 : Math.max(20, building.health - 12); next.buildings[id] = building;
  } else if (event.type === 'container.started') { const id = `containers:${event.payload.imageKey}`; next.districts = { ...state.districts, containers: districtFor(state.districts, 'containers', 'Containers') }; const building = buildingFor(next.buildings, id, 'containers', 'container'); building.activity += 1; building.targetHeight = Math.min(20, building.targetHeight + 1); next.buildings[id] = building;
  } else if (event.type === 'system.metrics') { const sample = { cpuPct: event.payload.cpuPct, memoryPct: event.payload.memoryPct, ts: event.ts }; next.metrics = { ...event.payload, history: [...(state.metrics.history || []), sample].slice(-60) };
  } else if (event.type === 'network.summary') next.network = { ...event.payload };
  return next;
}

export const replay = (events, initial = createCity()) => events.reduce(reduceCity, initial);
