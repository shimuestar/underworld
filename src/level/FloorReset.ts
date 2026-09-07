// 던전 초기화 — 성소 로비에 들어오는 순간(워프·부활·계단) 모든 던전 층을 되돌린다 (2026-09-07 사용자).
// 초기화 = 몬스터 전부 배치대로 부활(단, 잡은 보스는 돌아오지 않는다) · 함정 재무장 · 바닥 아이템(주머니 포함) 삭제.
// 남기는 것 — 비석(유품, 사용자 지시) · 연 상자(빈 채로, 다시 주지 않는다) · 문·레버·자물쇠 · 부순 통·소품 ·
// 부서진 균열벽·아레나 기둥(Level 격자와 차단 목록에 살아 있어 Level 을 그대로 두면 유지된다).
// main 은 얼려 둔 FloorState(살아 있는 Level 포함)에는 resetFloor 를, 아직 짓지 않은 층의 세이브 차이에는 resetFloorDiff 를 쓴다.

import { enemyDef } from '../core/Entities';
import type { FloorDiff } from '../core/Save';
import type { ArenaState, ChestState, EnemyState, GroundItemState, LifeMoteState, TrapState } from '../core/World';
import type { Level } from './GridLoader';
import { spawnEnemies, spawnTraps, type EntityPlacement } from './Spawner';

export interface ResettableFloor {
  enemies: EnemyState[];
  traps: TrapState[];
  chests: ChestState[];
  groundItems: GroundItemState[];
  lifeMotes: LifeMoteState[];
  arena: ArenaState | null;
}

/** 층의 주인인가 — 배치 플래그(boss: true) 또는 보스 종 */
export function isBossEnemy(e: { type: string; floorBoss?: boolean }): boolean {
  return !!e.floorBoss || enemyDef(e.type).boss === true;
}

/** 얼려 둔(또는 살아 있는) 층을 초기화한다. level 은 그 층의 Level — 격자·차단은 그대로 두고 함정 잔해 차단만 걷는다 */
export function resetFloor(fs: ResettableFloor, placements: EntityPlacement[], level: Level, bossSlain: boolean): void {
  // 함정 — 낙석 잔해가 막던 길을 걷고 배치대로 다시 무장
  for (const t of fs.traps) {
    if (!t.blocker) continue;
    level.removeBlocker(t.blocker);
    level.clearPathBlocked(t.col, t.row);
  }
  fs.traps = spawnTraps(placements, level);
  // 몬스터 — 배치대로 다시. 보스를 잡은 층은 보스만 빼고
  const fresh = spawnEnemies(placements, level);
  fs.enemies = bossSlain ? fresh.filter((e) => !isBossEnemy(e)) : fresh;
  if (fs.arena) fs.arena.bossId = null; // 새 몸은 Arena.tick 이 다시 찾는다 (잡았으면 없는 채로)
  // 연 상자는 빈 채로 — 더 주지 않는다
  for (const c of fs.chests) if (c.opened) c.chestItems = [];
  // 바닥 — 비석만 남긴다
  fs.groundItems = fs.groundItems.filter((g) => g.kind === 'grave');
  fs.lifeMotes = [];
}

/** 세이브 차이 키(`type@x,z`)가 보스인가 — 종이 보스거나 그 칸 배치에 boss 플래그 */
export function isBossKey(key: string, placements: EntityPlacement[], cellSize: number): boolean {
  const at = key.indexOf('@');
  if (at < 0) return false;
  const type = key.slice(0, at);
  const [x, z] = key.slice(at + 1).split(',').map(Number);
  if (enemyDef(type).boss === true) return true;
  return placements.some(
    (p) => p.type === type && (p as { boss?: boolean }).boss === true &&
      (p.cell[1]! + 0.5) * cellSize === x && (p.cell[0]! + 0.5) * cellSize === z,
  );
}

/** 아직 짓지 않은 층(불러온 세이브의 차이)을 같은 규칙으로 초기화한 새 차이 */
export function resetFloorDiff(diff: FloorDiff, placements: EntityPlacement[], cellSize: number, bossSlain: boolean): FloorDiff {
  return {
    slain: bossSlain ? diff.slain.filter((k) => isBossKey(k, placements, cellSize)) : [],
    chests: diff.chests.map((c) => ({ key: c.key, items: [] })),
    levers: [...diff.levers],
    doorsUnlocked: [...diff.doorsUnlocked],
    barrelsBroken: [...diff.barrelsBroken],
    propsBroken: [...diff.propsBroken],
    traps: [],
    groundItems: diff.groundItems.filter((g) => g.kind === 'grave'),
  };
}
