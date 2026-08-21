// 레벨 정의의 entities 목록 → World 적 상태 배열.
// group이 붙은 개체는 매복 트리거가 활성화할 때까지 스폰하지 않는다 (트리거는 후속 작업).

import { enemyDef } from '../core/Entities';
import type { EnemyState } from '../core/World';
import type { Level } from './GridLoader';

export interface EntityPlacement {
  type: string;
  cell: number[];
  group?: string;
}

/** 현재 구현된 적 타입만 스폰한다. 새 적을 구현하면 여기에 추가. */
const IMPLEMENTED = new Set(['goblin_runner']);

export function spawnEnemies(placements: EntityPlacement[], level: Level): EnemyState[] {
  const enemies: EnemyState[] = [];
  let nextId = 1;

  for (const placement of placements) {
    if (placement.group) continue; // 매복 대기조
    if (!IMPLEMENTED.has(placement.type)) {
      console.warn(`[Spawner] 미구현 적 타입 건너뜀: ${placement.type}`);
      continue;
    }
    const [row, col] = placement.cell;
    if (row === undefined || col === undefined) continue;
    const def = enemyDef(placement.type);
    const x = (col + 0.5) * level.cellSize;
    const z = (row + 0.5) * level.cellSize;
    enemies.push({
      id: nextId++,
      type: placement.type,
      x,
      z,
      prevX: x,
      prevZ: z,
      health: def.health,
      alive: true,
      ai: 'idle',
      timer: 0,
    });
  }

  return enemies;
}
