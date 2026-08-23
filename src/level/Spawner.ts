// 레벨 정의의 entities 목록 → World 적 상태 배열.
// group이 붙은 개체는 매복 트리거가 활성화할 때까지 스폰하지 않는다 (트리거는 후속 작업).

import { balance } from '../core/Balance';
import { enemyDef } from '../core/Entities';
import type { EnemyState } from '../core/World';
import type { Level } from './GridLoader';

export interface EntityPlacement {
  type: string;
  cell: number[];
  group?: string;
}

/** 현재 구현된 적 타입만 스폰한다. 새 적을 구현하면 여기에 추가. */
const IMPLEMENTED = new Set([
  'goblin_runner',
  'goblin_spear',
  'goblin_archer',
  'warden',
  'goblin_chieftain',
  'spider_small',
  'spider_large',
]);

/** 임의 위치에 적 하나 생성 (연습 소환 등) */
export function spawnEnemyAt(type: string, x: number, z: number, id: number): EnemyState {
  const def = enemyDef(type);
  const enemy: EnemyState = {
    id,
    type,
    x,
    z,
    prevX: x,
    prevZ: z,
    yaw: 0,
    health: def.health,
    alive: true,
    ai: 'idle',
    timer: 0,
    burnTicks: 0,
    burnDamagePerTick: 0,
  };
  if (def.boss) enemy.parryStreak = 0;
  return enemy;
}

export function spawnEnemies(placements: EntityPlacement[], level: Level): EnemyState[] {
  const enemies: EnemyState[] = [];
  let nextId = 1;
  let skippedNearAltar = 0;

  for (const placement of placements) {
    if (placement.group) continue; // 매복 대기조
    if (!IMPLEMENTED.has(placement.type)) {
      console.warn(`[Spawner] 미구현 적 타입 건너뜀: ${placement.type}`);
      continue;
    }
    const [row, col] = placement.cell;
    if (row === undefined || col === undefined) continue;
    // 제단 주변은 비워 둔다 — 부활 지점이라 되살아나자마자 전투가 붙으면 안 된다
    const x = (col + 0.5) * level.cellSize;
    const z = (row + 0.5) * level.cellSize;
    if (level.altarPos) {
      const d = Math.hypot(x - level.altarPos.x, z - level.altarPos.z);
      if (d <= balance.altar.safeRadius) {
        skippedNearAltar++;
        continue;
      }
    }
    enemies.push(
      spawnEnemyAt(
        placement.type,
        x,
        z,
        nextId++,
      ),
    );
  }
  if (skippedNearAltar > 0) {
    console.warn(`[spawn] 제단 안전 반경 안이라 ${skippedNearAltar}마리를 건너뛰었다`);
  }

  return enemies;
}
