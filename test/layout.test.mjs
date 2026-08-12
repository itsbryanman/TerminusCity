import test from 'node:test';
import assert from 'node:assert/strict';
import { placeBuildings } from '../apps/web/layout.mjs';

const ids = (count) => Array.from({ length: count }, (_, i) => `building-${String(i).padStart(4, '0')}`);

test('layout is deterministic and has no colliding cells', () => {
  for (const count of [1, 2, 50, 500]) {
    const input = ids(count).reverse();
    const first = placeBuildings(input); const second = placeBuildings(input);
    assert.deepEqual([...first], [...second]);
    assert.equal(new Set([...first.values()].map(({ col, row }) => `${col},${row}`)).size, count);
  }
});

test('adding a lexically later id preserves existing spiral cells', () => {
  const before = placeBuildings(['a', 'b', 'c']);
  const after = placeBuildings(['a', 'b', 'c', 'z']);
  for (const id of before.keys()) assert.deepEqual(after.get(id), before.get(id));
});
