// 몬스터 시험방 소환 — 종족별 목표 수를 두고, 자동 소환이 켜지면 죽은 만큼 3초 뒤 되채운다(규칙 A).
// 위치는 플레이어 시선 앞 부채꼴(min~max m) 랜덤. 벽 아닌 바닥, 플레이어·다른 적과 안 겹치는 자리.
// 소환 몬스터는 noLoot — 전리품·경험치 없다(무한 사냥). 거머리 바닥·구울 배회·박쥐 비행 상태로 시작.

import { balance } from '../core/Balance';
import { enemyDef } from '../core/Entities';
import { spawnEnemyAt } from '../level/Spawner';
import type { World } from '../core/World';

let nextSummonId = 5_000_000; // 소환 id 대역 — 레벨 스폰과 안 겹친다

function spot(world: World): { x: number; z: number } | null {
  const cfg = balance.monsterRoom.summon;
  const p = world.player;
  const level = world.level;
  for (let i = 0; i < cfg.tries; i++) {
    const t = i / cfg.tries; // 시도가 늘수록 각도·거리를 넓혀 자리를 찾는다
    const arc = (cfg.arcDeg / 2) * (1 + t) * (Math.PI / 180);
    const ang = p.yaw + (Math.random() * 2 - 1) * arc;
    const dist = cfg.minDist + Math.random() * (cfg.maxDist - cfg.minDist);
    const x = p.x - Math.sin(ang) * dist;
    const z = p.z - Math.cos(ang) * dist;
    if (level.solidAt(Math.floor(x / level.cellSize), Math.floor(z / level.cellSize))) continue;
    if (Math.hypot(x - p.x, z - p.z) < cfg.minPlayerDist) continue;
    if (world.enemies.some((e) => e.alive && Math.hypot(e.x - x, e.z - z) < enemyDef(e.type).radius + 1)) continue;
    return { x, z };
  }
  return null;
}

/** 시선 앞에 한 마리 놓는다 — 종족별 초기 상태(거머리 바닥·구울 배회·박쥐 비행·벽거미 벽) 반영. 자리가 없으면 false */
export function summonOne(world: World, type: string): boolean {
  const at = spot(world);
  if (!at) return false;
  const def = enemyDef(type);
  const e = spawnEnemyAt(type, at.x, at.z, nextSummonId++);
  // 거머리는 바닥에서(천장 위장 없음), 구울은 배회(죽은 척 없음)에서, 박쥐는 비행에서 시작 — 사용자 지정 (2026-09-04)
  if (def.flying) {
    e.jumpY = def.flying.cruiseHeight;
    e.prevJumpY = e.jumpY;
  }
  e.noLoot = true; // 전리품·경험치 없음
  world.enemies.push(e);
  return true;
}

/** 소환 버튼 — count 마리를 놓고 목표 수를 올린다. 실제로 놓인 수를 돌려준다(자리가 모자라면 그만큼) */
export function summon(world: World, type: string, count: number): number {
  let placed = 0;
  for (let i = 0; i < count; i++) if (summonOne(world, type)) placed++;
  world.summonTargets[type] = (world.summonTargets[type] ?? 0) + placed;
  world.events.emit('summon_spawned', { type, count: placed });
  return placed;
}

/** 화면의 모든 몬스터를 죽인다 — 자동 소환이 켜져 있으면 3초 뒤 되살아난다 (enemy_died 로 큐에 들어간다) */
export function killAll(world: World): number {
  let n = 0;
  for (const e of world.enemies) {
    if (!e.alive) continue;
    e.alive = false;
    e.health = 0;
    n++;
    world.events.emit('enemy_died', { enemyId: e.id, enemyType: e.type, x: e.x, z: e.z, noLoot: true });
  }
  return n;
}

/** 초기화 — 전부 없애고 목표·대기열·자동 소환을 비운다 (아무것도 소환하지 않는 상태) */
export function reset(world: World): void {
  world.enemies.length = 0;
  world.summonTargets = {};
  world.summonQueue = [];
  world.summonAuto = false;
  world.events.emit('summon_reset', {});
}

/** 시작 시 1회 — 처치를 구독해 자동 소환 대기열에 넣는다 (그 종족만) */
export function init(world: World): void {
  world.events.on('enemy_died', (payload) => {
    if (!world.monsterRoom || !world.summonAuto) return;
    const { enemyType } = payload as { enemyType: string };
    if (!(enemyType in world.summonTargets)) return; // 소환한 종족만 되채운다
    world.summonQueue.push({ type: enemyType, at: world.tick + balance.monsterRoom.autoRespawnDelayTicks });
  });
}

/** 매 틱 — 도래한 재소환을 처리한다. 목표 수를 넘겨 채우지 않는다(자리가 없으면 다음 틱에 다시) */
export function tick(world: World, _dt: number): void {
  if (!world.monsterRoom || world.summonQueue.length === 0) return;
  for (let i = world.summonQueue.length - 1; i >= 0; i--) {
    const q = world.summonQueue[i]!;
    if (world.tick < q.at) continue;
    const alive = world.enemies.filter((e) => e.alive && e.type === q.type).length;
    const target = world.summonTargets[q.type] ?? 0;
    if (alive >= target) {
      world.summonQueue.splice(i, 1); // 이미 목표만큼 있다 — 취소
      continue;
    }
    if (summonOne(world, q.type)) world.summonQueue.splice(i, 1); // 놓였으면 대기열에서 뺀다
  }
}
