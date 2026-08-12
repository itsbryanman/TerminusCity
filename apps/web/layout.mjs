/**
 * Deterministic square spiral placement. Coordinates are deliberately not
 * re-centred here: an existing id keeps its cell when a lexically-later id is
 * added. The renderer centres the complete occupied range for presentation.
 */
function spiralCell(index) {
  if (index === 0) return { col: 0, row: 0 };
  let col = 0; let row = 0; let seen = 0; let step = 1;
  while (true) {
    for (const [dx, dy, count] of [[1, 0, step], [0, 1, step], [-1, 0, step + 1], [0, -1, step + 1]]) {
      for (let i = 0; i < count; i++) {
        col += dx; row += dy; seen += 1;
        if (seen === index) return { col, row };
      }
    }
    step += 2;
  }
}

export function placeBuildings(ids) {
  const result = new Map();
  [...new Set(ids)].sort().forEach((id, index) => result.set(id, spiralCell(index)));
  return result;
}
