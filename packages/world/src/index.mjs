const hash = (text) => [...text].reduce((value, char) => ((value * 31) + char.charCodeAt(0)) >>> 0, 2166136261);
const palette = ['violet', 'cyan', 'amber', 'rose', 'lime'];
export const createCity = () => ({ version: 1, lastSequence: 0, commands: 0, commits: 0, errors: 0, metrics: { cpuPct: 0, memoryPct: 0 }, districts: {}, buildings: {}, incidents: [] });

function districtFor(districts, id, label = 'Terminal') {
  if (districts[id]) return { ...districts[id] };
  const seed = hash(id); return { id, name: label.slice(0, 48), seed, palette: palette[seed % palette.length], activityScore: 0, commandCount: 0, commitCount: 0 };
}

export function reduceCity(state, event) {
  const next = { ...state };
  next.lastSequence = Math.max(next.lastSequence, event.seq || 0);
  if (event.type === 'shell.command.finished') {
    const id = event.payload.cwdKey;
    next.districts = { ...state.districts };
    const district = districtFor(next.districts, id, id === 'path_manual' ? 'Manual District' : 'Terminal District');
    district.commandCount += 1; district.activityScore += event.payload.exitCode === 0 ? 1 : 2;
    next.districts[id] = district; next.commands += 1;
    const buildingId = `${id}:${event.payload.category}`;
    next.buildings = { ...state.buildings };
    const building = state.buildings[buildingId] ? { ...state.buildings[buildingId] } : { id: buildingId, districtId: id, kind: event.payload.category, seed: hash(buildingId), height: 2, targetHeight: 2, activity: 0, health: 100 };
    building.activity += 1; building.targetHeight = Math.min(30, 2 + Math.floor(building.activity / 2));
    if (event.payload.exitCode !== 0) { building.health = Math.max(20, building.health - 12); next.errors += 1; next.incidents = [{ id: event.id, districtId: id, kind: 'error', createdAt: event.ts }, ...state.incidents].slice(0, 12); }
    next.buildings[buildingId] = building;
  } else if (event.type === 'git.repo.discovered') {
    next.districts = { ...state.districts };
    next.districts[event.payload.repoId] = districtFor(next.districts, event.payload.repoId, event.payload.displayName);
  } else if (event.type === 'git.commit') {
    next.districts = { ...state.districts };
    const district = districtFor(next.districts, event.payload.repoId); next.districts[event.payload.repoId] = district; district.commitCount += 1; district.activityScore += 4; next.commits += 1;
    const id = `${district.id}:commit`;
    next.buildings = { ...state.buildings };
    const building = state.buildings[id] ? { ...state.buildings[id] } : { id, districtId: district.id, kind: 'office', seed: hash(id), height: 4, targetHeight: 4, activity: 0, health: 100 };
    building.activity += 3; building.targetHeight = Math.min(40, building.targetHeight + 2); next.buildings[id] = building;
  } else if (event.type === 'system.metrics') next.metrics = { cpuPct: event.payload.cpuPct, memoryPct: event.payload.memoryPct };
  return next;
}

export const replay = (events, initial = createCity()) => events.reduce(reduceCity, initial);
