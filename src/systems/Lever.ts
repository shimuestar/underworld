// 레버 — E로 당기면 연결된 잠긴 문(D)이 열린다. 레버-문 연결은 레벨 데이터의 triggers.

import { balance } from '../core/Balance';
import type { World } from '../core/World';

export function tick(world: World, _dt: number): void {
  if (!world.input.interactPressed) return;
  const p = world.player;
  const cs = world.level.cellSize;

  for (const lever of world.level.levers) {
    const [row, col] = lever.cell;
    if (row === undefined || col === undefined) continue;
    const key = `${row}-${col}`;
    if (world.pulledLevers.has(key)) continue;

    const x = (col + 0.5) * cs;
    const z = (row + 0.5) * cs;
    if (Math.hypot(p.x - x, p.z - z) > balance.interaction.leverRadius) continue;

    const [doorRow, doorCol] = lever.opens!;
    if (doorRow === undefined || doorCol === undefined) continue;
    world.level.openCell(doorCol, doorRow);
    world.pulledLevers.add(key);
    world.events.emit('lever_pulled', {
      lever: { row, col },
      door: { row: doorRow, col: doorCol },
    });
  }
}
