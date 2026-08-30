// 레벨 정의의 entities 목록 → World 적 상태 배열.
// group이 붙은 개체는 매복 트리거가 활성화할 때까지 스폰하지 않는다 (트리거는 후속 작업).

import { balance } from '../core/Balance';
import { enemyDef } from '../core/Entities';
import { findWallNormal, type BarrelState, type ChestState, type EnemyState, type PropState } from '../core/World';
import type { Level } from './GridLoader';

export interface EntityPlacement {
  type: string;
  cell: number[];
  group?: string;
}

/** 현재 구현된 적 타입만 스폰한다. 새 적을 구현하면 여기에 추가. */
// 스폰 id — 층을 오가도 1부터 다시 세지 않는 모듈 연번.
// Stage 가 모형을 id 로 캐시하므로, 층마다 id 가 겹치면 새 층의 적이
// 앞 층에서 같은 id 였던 다른 종의 외형을 뒤집어쓴다 (1-3 에서 실측)
let nextChestId = 1;
let nextBarrelId = 1;
let nextEnemySpawnId = 1;

/** 실제로 스폰되는 적 — entities.json 에는 있지만 behavior·attack 이 없는 스텁(오크 계열 등)은
 *  여기 없으면 조용히 건너뛴다. 레벨을 짤 때 이 목록 밖의 적을 쓰면 그 자리는 빈다 */
const IMPLEMENTED = new Set([
  'goblin_runner',
  'goblin_spear',
  'goblin_archer',
  'warden',
  'goblin_chieftain',
  'spider_small',
  'spider_large',
  'slime',
  'slime_small',
  'slime_mother',
  'ghoul',
  'leech',
  'bat',
]);

/** 이 적 타입이 실제로 스폰되는가 — 레벨 검증이 이걸로 스텁 배치를 잡는다 */
export function isSpawnable(type: string): boolean {
  return IMPLEMENTED.has(type);
}

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
    homeYaw: 0,
    health: def.health,
    alive: true,
    ai: 'idle',
    timer: 0,
    burnTicks: 0,
    burnDamagePerTick: 0,
  };
  if (def.boss) enemy.parryStreak = 0;
  if (def.hearingMul !== undefined) enemy.hearingMul = def.hearingMul; // World 는 def 를 모른다
  enemy.homeX = x; // 대기 배회의 중심
  enemy.homeZ = z;
  return enemy;
}

/** 레벨의 chest 배치 → 보물상자. 통과 마찬가지로 몸으로 막는다 */
export function spawnChests(placements: EntityPlacement[], level: Level): ChestState[] {
  const chests: ChestState[] = [];
  for (const placement of placements) {
    if (placement.type !== 'chest') continue;
    const [row, col] = placement.cell;
    if (row === undefined || col === undefined) continue;
    if (level.solidAt(col, row)) {
      console.warn(`[Spawner] 벽 안의 보물상자 건너뜀: [${row}, ${col}]`);
      continue;
    }
    const x = (col + 0.5) * level.cellSize;
    const z = (row + 0.5) * level.cellSize;
    const chest: ChestState = { id: nextChestId++, x, z, opened: false };
    chest.blocker = level.addBlocker(x, z, balance.chest.collisionRadius);
    chests.push(chest);
  }
  return chests;
}

/** 레벨의 barrel 배치 → 폭발통 상태. 몸으로 막게 차단 블록도 함께 등록한다 */
export function spawnBarrels(placements: EntityPlacement[], level: Level): BarrelState[] {
  const barrels: BarrelState[] = [];
  for (const placement of placements) {
    if (placement.type !== 'barrel') continue;
    const [row, col] = placement.cell;
    if (row === undefined || col === undefined) continue;
    if (level.solidAt(col, row)) {
      console.warn(`[Spawner] 벽 안의 폭발통 건너뜀: [${row}, ${col}]`);
      continue;
    }
    const x = (col + 0.5) * level.cellSize;
    const z = (row + 0.5) * level.cellSize;
    const barrel: BarrelState = { id: nextBarrelId++, x, z, alive: true, hits: 0, fuseTicks: -1 };
    barrel.blocker = level.addBlocker(x, z, balance.barrel.collisionRadius);
    barrels.push(barrel);
  }
  return barrels;
}

let nextPropId = 1;

/** 레벨의 prop_* 배치 → 기믹 상태. 몸으로 막게 차단 블록도 함께 등록한다 (통과 동형) */
export function spawnProps(placements: EntityPlacement[], level: Level): PropState[] {
  const props: PropState[] = [];
  const types = balance.props.types as Record<string, { collisionRadius: number }>;
  for (const placement of placements) {
    if (!placement.type.startsWith('prop_')) continue;
    const cfg = types[placement.type];
    if (!cfg) {
      console.warn(`[Spawner] 미정의 기믹 건너뜀: ${placement.type}`);
      continue;
    }
    const [row, col] = placement.cell;
    if (row === undefined || col === undefined) continue;
    if (level.solidAt(col, row)) {
      console.warn(`[Spawner] 벽 안의 기믹 건너뜀: [${row}, ${col}]`);
      continue;
    }
    const x = (col + 0.5) * level.cellSize;
    const z = (row + 0.5) * level.cellSize;
    const prop: PropState = {
      id: nextPropId++, type: placement.type, x, z, alive: true, hits: 0, fuseTicks: -1,
    };
    prop.blocker = level.addBlocker(x, z, cfg.collisionRadius);
    props.push(prop);
  }
  return props;
}

export function spawnEnemies(placements: EntityPlacement[], level: Level): EnemyState[] {
  const enemies: EnemyState[] = [];
  let skippedNearAltar = 0;

  for (const placement of placements) {
    if (placement.group) continue; // 매복 대기조
    if (placement.type.startsWith('prop_')) continue; // 기믹 — spawnProps 몫 (경고 없이)
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
    const spawned = spawnEnemyAt(placement.type, x, z, nextEnemySpawnId++);
    // 죽은 척 배치 — 시체처럼 엎어져 시작한다 (구울). 기척·소음·피격이 깨운다
    if ((placement as { feign?: boolean }).feign) spawned.feigning = true;
    // 천장 배치 (거머리) — 천장에 매달려 시작한다
    if ((placement as { ceiling?: boolean }).ceiling && enemyDef(placement.type).ceilingLurk) {
      spawned.lurking = true;
      spawned.jumpY = level.ceiling - enemyDef(placement.type).height - 0.05;
      spawned.prevJumpY = spawned.jumpY;
    }
    // 비행체(박쥐) — 공중에서 시작한다
    if (enemyDef(placement.type).flying) {
      spawned.jumpY = enemyDef(placement.type).flying!.cruiseHeight;
      spawned.prevJumpY = spawned.jumpY;
    }
    // 벽 배치 (벽거미) — 가장 가까운 벽에 눌러 붙인 채 매복한다. 벽이 없으면 지상 스폰
    if ((placement as { wall?: boolean }).wall && enemyDef(placement.type).wallCrawl) {
      const wdef = enemyDef(placement.type);
      const wcfg = wdef.wallCrawl!;
      const n = findWallNormal(level, spawned.x, spawned.z, wdef.radius, wcfg.attachRange, 0.75);
      if (n) {
        level.slideMove(spawned, wdef.radius, -n.nx * wcfg.attachRange, -n.nz * wcfg.attachRange);
        spawned.prevX = spawned.x;
        spawned.prevZ = spawned.z;
        spawned.wallCling = true;
        spawned.wallNX = n.nx;
        spawned.wallNZ = n.nz;
        spawned.jumpY = wcfg.height;
        spawned.prevJumpY = wcfg.height;
      } else {
        console.warn(`[spawn] 벽거미 자리에 벽이 없다 — 지상 스폰 (${placement.cell[0]},${placement.cell[1]})`);
      }
    }
    enemies.push(spawned);
  }
  if (skippedNearAltar > 0) {
    console.warn(`[spawn] 제단 안전 반경 안이라 ${skippedNearAltar}마리를 건너뛰었다`);
  }

  return enemies;
}
