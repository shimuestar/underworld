// 보스 아레나 — 낫뿔 거수 「무저갱 우리」 (docs/systems/boss_scythe_behemoth.md §9.3·§9.4·§10, B3-5).
//
// 레벨 JSON 의 arena{bounds, home} 을 읽어 World.arena 를 짓고(층마다 — main 의 FloorState 가 함께 얼리고 되살린다) 매 틱:
//  ① 봉쇄 — 아레나 주인(boss 배치 플래그·def.boss)이 깨어 있고(ai ≠ idle) 플레이어가 아레나 '안'(insideCells — 홈에서 문 D 를 넘지 않고 닿는 칸: 안쪽·균열벽 뒤 상자 벽감·
//     출구 벽감·문 칸. 문 밖 복도는 밖)이면 문 D 를 봉쇄:
//     door.sealed(E 가 먹지 않는다 — Door.tick 이 본다) + 열려 있으면 closing(Door.tick 규약 — 문틈에 몸이 있으면 비켜날 때까지 기다린다) + arena_sealed.
//     밖에서 깨웠으면(총격·소음) 보스는 chase 대신 홈 칸으로 돌아가 기다린다(enemy.holdHome — Enemies 가 읽는다) 하고 플레이어가 경계를 넘는 틱에 봉쇄한다.
//     봉쇄 중 플레이어가 경계 밖으로 나가면(문이 다 닫히기 전에 빠져나감) 해제 + 홈 대기 — 문 밖에 갇히는 소프트락이 없다. 보스 사망·플레이어 사망도 해제(arena_unsealed{reason}).
//  ② 기둥 내구·붕괴 — pillar_hit(돌격 전도·반캠핑 박치기)마다 −1(balance.arena.pillarHp), 0 이면 붕괴 = 낙석 규약 복제(Traps 를 import 하지 않고 같은 Level/World 헬퍼로):
//     칸을 연다(총알·시야·소음 통과) + 잔해 차단 상자(rubbleHalf) + 적 경로 차단(setPathBlocked), 반경 rockfallRadius 안 플레이어 rockfallDamage(막기 불가·회피 무적 면제)·
//     적 rockfallEnemyDamage(보스 × traps.bossDamageMul = 36, heavy 타격 → 갑각판 풀) + 플레이어 밀림. 잔해에 박히는 돌격은 충돌이 아니다(Level.blockedAhead 가 props 를
//     벽으로 읽지 않는다 → 질주가 계속돼 시간이 다하면 헛돌격 90 — 기획서 §9.3 표). 폭발(explosion 이벤트 — 수류탄·화염구·폭발통)이 닿으면 잔해를 치운다(rubbleBreakable).
//  ③ 반캠핑(§9.4) — 봉쇄 중 시야선 없이 noLosTicks 면 시야를 가린 그 기둥으로 자발 돌격 요청(enemy.anticampTarget → Enemies 가 돌격 예고를 낸다; 박히면 내구 −1 +
//     pillarStunTicks 실신만, 전도·눈 노출 없음), 시야는 있는데 farM 밖에 farTicks 면 farNearM 안에 들 때까지 접근 이속 × farSpeedMul(enemy.anticampBoost) + 돌격 쿨 리셋
//     (+ P3 포효 간격 리셋).
// Enemies 는 World.arena.bounds 로 아레나 주인의 이동·돌격 목표를 클램프한다(벽감·관문 밖으로 목표를 잡지 않는다). 수치는 전부 balance.arena·traps.bossDamageMul.
// 이벤트: arena_sealed{row, col, x, z, enemyId} / arena_unsealed{reason 'boss_dead'|'death'|'left'|'asleep', row, col} / arena_hold{enemyId} /
//        pillar_damaged{row, col, hp, max, x, z} / pillar_collapsed{row, col, x, z, playerHit, enemyHits} / arena_rubble_broken{row, col, x, z} / arena_rockfall_hit{enemyId, amount} /
//        anticamp_far{enemyId, on} — 자발 돌격 anticamp_charge·박치기 anticamp_stun 은 Enemies 가 낸다.

import { balance } from '../core/Balance';
import { enemyDef, slotUnlocked } from '../core/Entities';
import { hitShellPlates } from '../core/ShellPlates';
import { applyFrostOnHit, damagePlayer, pushPlayer, type ArenaState, type DoorState, type EnemyState, type Rect, type World } from '../core/World';
import type { Level } from '../level/GridLoader';

/** 기둥 장부 키 — "row-col" */
export function pillarKey(row: number, col: number): string {
  return `${row}-${col}`;
}

/** 사각 안인가 (경계 포함) */
export function inRect(rect: Rect, x: number, z: number): boolean {
  return x >= rect.minX && x <= rect.maxX && z >= rect.minZ && z <= rect.maxZ;
}

/** (x,z) 를 사각 안(몸 반경만큼 안쪽)으로 자른 자리 — 보스 이동·돌격 목표 클램프(Enemies 가 부른다) */
export function clampToRect(rect: Rect, x: number, z: number, radius: number): { x: number; z: number } {
  return {
    x: Math.min(Math.max(x, rect.minX + radius), rect.maxX - radius),
    z: Math.min(Math.max(z, rect.minZ + radius), rect.maxZ - radius),
  };
}

/** 칸 키 — row * 4096 + col (noiseField 규약) */
export function cellKey(row: number, col: number): number {
  return row * 4096 + col;
}

/** 아레나 '안' 칸 집합 — 홈에서 4방향으로 퍼지되 벽(#)·관문(G)·기둥 밖 벽은 못 넘고, 균열벽(C)은 넘는다(부서지면 벽감이 아레나의 일부), 문(D)은 그 칸까지만(넘어가지 않는다).
 *  그래서 안쪽 11×9·균열벽 뒤 상자 벽감·출구 벽감 X·문 칸은 '안', 문 밖 복도는 '밖' — 문틈에 선 플레이어는 안이라 봉쇄가 걸리고 문은 비켜날 때까지 기다린다(Door 규약) */
function floodInside(level: Level, hr: number, hc: number): Set<number> {
  const seen = new Set<number>([cellKey(hr, hc)]);
  const queue: [number, number][] = [[hr, hc]];
  while (queue.length > 0) {
    const [r, c] = queue.shift()!;
    for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nr = r + dr;
      const nc = c + dc;
      const key = cellKey(nr, nc);
      if (seen.has(key)) continue;
      const ch = level.charAt(nc, nr);
      if (ch === '#' || ch === 'G') continue;
      seen.add(key);
      if (ch === 'D') continue; // 문 칸은 안이되 그 너머로는 퍼지지 않는다
      queue.push([nr, nc]);
    }
  }
  return seen;
}

/** 레벨 정의(arena{bounds, home})에서 아레나 상태를 짓는다 — arena 가 없는 층이면 null. 기둥 내구는 격자의 P 전부(balance.arena.pillarHp) */
export function fromLevel(level: Level): ArenaState | null {
  const def = level.arena;
  if (!def) return null;
  const [r0, c0, r1, c1] = def.bounds as [number, number, number, number];
  const [hr, hc] = def.home as [number, number];
  const cs = level.cellSize;
  const bounds: Rect = { minX: c0 * cs, maxX: (c1 + 1) * cs, minZ: r0 * cs, maxZ: (r1 + 1) * cs };
  const insideCells = floodInside(level, hr, hc);
  const pillarHp: Record<string, number> = {};
  for (let row = 0; row < level.rows; row++) {
    for (let col = 0; col < level.cols; col++) if (level.charAt(col, row) === 'P') pillarHp[pillarKey(row, col)] = balance.arena.pillarHp;
  }
  // 봉쇄 대상 — 경계에 붙은 문(D·G) 하나
  const doorCell = level.doors.find(
    (d) =>
      ((d.row === r0 - 1 || d.row === r1 + 1) && d.col >= c0 && d.col <= c1) ||
      ((d.col === c0 - 1 || d.col === c1 + 1) && d.row >= r0 && d.row <= r1),
  );
  return {
    level,
    bounds,
    insideCells,
    homeX: (hc + 0.5) * cs,
    homeZ: (hr + 0.5) * cs,
    homeRow: hr,
    homeCol: hc,
    bossId: null,
    sealed: false,
    door: doorCell ? { row: doorCell.row, col: doorCell.col } : null,
    pillarHp,
    rubble: [],
    noLosTicks: 0,
    farTicks: 0,
  };
}

/** world.level 에 맞는 아레나 상태를 보장한다 — 층이 바뀌었으면 새로 짓는다(와 본 층은 main 이 FloorState 의 world.arena 를 되돌려 두므로 level 이 같다) */
export function ensure(world: World): ArenaState | null {
  if (world.arena && world.arena.level === world.level) return world.arena;
  world.arena = fromLevel(world.level);
  return world.arena;
}

/** 구독 — 시작 시 1회. 기둥 충돌(내구 −1)·폭발(잔해 치우기)·플레이어 사망(봉쇄 해제) */
export function init(world: World): void {
  world.events.on('pillar_hit', (payload) => {
    const h = payload as { row: number; col: number };
    hitPillar(world, h.row, h.col);
  });
  // 폭발은 잔해를 치운다 — 수류탄·화염구·폭발통(Hazards 의 불 규약과 같은 셋). 내파(implode)는 아니다
  world.events.on('explosion', (payload) => {
    const e = payload as { x: number; z: number; radius: number; kind?: string };
    if (e.kind === 'implode') return;
    breakRubbleNear(world, e.x, e.z, e.radius);
  });
  world.events.on('player_died', () => {
    const arena = world.arena;
    if (!arena) return;
    if (arena.sealed) unseal(world, arena, 'death');
    const boss = findBoss(world, arena);
    if (boss) boss.holdHome = true; // 부활 뒤 main 이 새 몸에 지속 상태를 옮긴다(carryOver) — 그때까지 홈으로
  });
}

/** (x,z) 가 아레나 '안' 칸(insideCells — 안쪽·벽감·출구 벽감·문 칸)인가 */
export function insideAt(arena: ArenaState, x: number, z: number): boolean {
  const cs = arena.level.cellSize;
  return arena.insideCells.has(cellKey(Math.floor(z / cs), Math.floor(x / cs)));
}

/** 플레이어가 아레나 '안'에 있는가 */
export function playerInside(world: World, arena: ArenaState): boolean {
  return insideAt(arena, world.player.x, world.player.z);
}

/** 아레나 주인 — 살아 있는 boss 배치(floorBoss)·def.boss 중 아레나 안에 있는 것, 없으면 그 중 첫째 */
function findBoss(world: World, arena: ArenaState): EnemyState | undefined {
  const masters = world.enemies.filter((e) => e.alive && (e.floorBoss || enemyDef(e.type).boss));
  return masters.find((e) => insideAt(arena, e.x, e.z)) ?? masters[0];
}

/** 봉쇄 대상 문 상태 */
function arenaDoor(world: World, arena: ArenaState): DoorState | undefined {
  const d = arena.door;
  if (!d) return undefined;
  return world.doors.find((door) => door.row === d.row && door.col === d.col);
}

/** 열린 문을 닫기 시작한다(Door.tick closing 규약 — 문틈에 몸이 있으면 tickClosing 이 비켜날 때까지 기다린다) */
function startClosing(world: World, door: DoorState, sealed = true): void {
  if (!door.opened || door.closing) return;
  door.closing = true;
  door.blockedTicks = 0;
  door.prevSlide = door.slide;
  world.events.emit('door_closing', { row: door.row, col: door.col, x: door.x, z: door.z, sealed });
}

function seal(world: World, arena: ArenaState, boss: EnemyState): void {
  arena.sealed = true;
  const door = arenaDoor(world, arena);
  if (door) {
    door.sealed = true;
    startClosing(world, door);
  }
  world.events.emit('arena_sealed', {
    enemyId: boss.id, enemyType: boss.type, row: arena.door?.row, col: arena.door?.col, x: door?.x, z: door?.z,
  });
}

function unseal(world: World, arena: ArenaState, reason: 'boss_dead' | 'death' | 'left' | 'asleep'): void {
  arena.sealed = false;
  const door = arenaDoor(world, arena);
  if (door) door.sealed = false;
  arena.noLosTicks = 0;
  arena.farTicks = 0;
  world.events.emit('arena_unsealed', { reason, row: arena.door?.row, col: arena.door?.col, x: door?.x, z: door?.z });
}

export function tick(world: World, _dt: number): void {
  const arena = ensure(world);
  if (!arena) return;
  let boss = arena.bossId === null ? undefined : world.enemies.find((e) => e.id === arena.bossId);
  if (!boss || !boss.alive) {
    boss = findBoss(world, arena);
    arena.bossId = boss?.id ?? null;
  }
  if (!boss) {
    // 주인이 죽었다(또는 없다) — 봉쇄 해제. 출구 쇠창살 상승은 Exit 이 def.boss/floorBoss 사망으로 알아서 올린다
    if (arena.sealed) unseal(world, arena, 'boss_dead');
    return;
  }
  const door = arenaDoor(world, arena);
  if (world.dead) {
    if (arena.sealed) unseal(world, arena, 'death');
    return;
  }
  const awake = boss.ai !== 'idle';
  const inside = playerInside(world, arena);
  if (!awake) {
    // 잠든 주인 — 홈에 있다. 봉쇄는 각성 뒤에만
    if (boss.holdHome) boss.holdHome = false;
    if (arena.sealed) unseal(world, arena, 'asleep');
    boss.anticampBoost = false;
    arena.noLosTicks = 0;
    arena.farTicks = 0;
    return;
  }
  if (inside) {
    if (boss.holdHome) boss.holdHome = false;
    if (!arena.sealed) seal(world, arena, boss);
    // 봉쇄 중 문이 (다시) 열린 채면 닫는다 — 열리는 도중에 봉쇄가 걸렸으면 다 열린 뒤 여기서 닫기 시작한다
    else if (door && door.opened && !door.closing) startClosing(world, door);
    tickAnticamp(world, arena, boss);
  } else {
    // 밖에서 깨웠다(또는 문이 닫히기 전에 빠져나갔다) — 봉쇄 해제 + 홈 복귀·대기. 경계를 넘는 틱에 다시 봉쇄한다
    if (arena.sealed) unseal(world, arena, 'left');
    if (!boss.holdHome) {
      boss.holdHome = true;
      boss.anticampTarget = undefined;
      boss.anticampCharge = false; // 예고 중 밖으로 나갔으면 그 돌격은 보통 돌격으로(전도) — 실신 오판 방지
      world.events.emit('arena_hold', { enemyId: boss.id, enemyType: boss.type, x: boss.x, z: boss.z });
    }
    // 밖에서 깨웠으면 열린 문을 닫아 시야를 끊는다 — 문 밖 복도에서 홈의 보스를 저격하는 캠핑 방지(B3-5 잔여 메모 (b)).
    // 봉쇄는 아니다: E 로 다시 열고 들어오면 그때 봉쇄된다
    if (door && door.opened && !door.closing) startClosing(world, door, false);
    if (boss.anticampBoost) {
      boss.anticampBoost = false;
      world.events.emit('anticamp_far', { enemyId: boss.id, enemyType: boss.type, on: false });
    }
    arena.noLosTicks = 0;
    arena.farTicks = 0;
  }
}

/** 반캠핑(기획서 §9.4) — 봉쇄 중(전투 중)에만 센다 */
function tickAnticamp(world: World, arena: ArenaState, boss: EnemyState): void {
  const cfg = balance.arena;
  const def = enemyDef(boss.type);
  const p = world.player;
  const dist = Math.hypot(p.x - boss.x, p.z - boss.z);
  const los = world.level.hasLineOfSight(boss.x, boss.z, p.x, p.z);
  if (!los) {
    arena.farTicks = 0;
    arena.noLosTicks++;
    // 시야를 가린 것이 기둥 P 면 그 기둥으로 자발 돌격을 요청한다(추격 중일 때 — 공격·자세 중이면 다음 틱에 다시 본다). 벽·문설주면 요청하지 않는다
    if (arena.noLosTicks >= cfg.noLosTicks && boss.ai === 'chase' && !boss.anticampTarget && def.chargeAttack) {
      const hit = world.level.blockingCellOnRay(boss.x, boss.z, p.x - boss.x, p.z - boss.z);
      if (hit.ch === 'P' && (arena.pillarHp[pillarKey(hit.row, hit.col)] ?? 0) > 0) {
        const cs = world.level.cellSize;
        boss.anticampTarget = { x: (hit.col + 0.5) * cs, z: (hit.row + 0.5) * cs, row: hit.row, col: hit.col };
        arena.noLosTicks = 0;
      }
    }
    return;
  }
  arena.noLosTicks = 0;
  if (dist > cfg.farM) {
    arena.farTicks++;
    if (arena.farTicks >= cfg.farTicks && !boss.anticampBoost) {
      // 멀리서 총만 쏘는 플레이어 — farNearM 안까지 접근 가속 + 돌격 쿨 즉시 리셋(+ P3 포효 간격 리셋): maxRange 안에 드는 순간 돌격이 실제로 나간다
      boss.anticampBoost = true;
      boss.chargeCooldown = 0;
      if (def.roarAttack && slotUnlocked(def, boss, 'roar')) boss.roarCooldown = 0;
      arena.farTicks = 0;
      world.events.emit('anticamp_far', { enemyId: boss.id, enemyType: boss.type, on: true, dist });
    }
  } else {
    arena.farTicks = 0;
  }
  if (boss.anticampBoost && dist <= cfg.farNearM) {
    boss.anticampBoost = false;
    world.events.emit('anticamp_far', { enemyId: boss.id, enemyType: boss.type, on: false, dist });
  }
}

/** 기둥 내구 −1 — 0 이면 붕괴. 장부에 없는 칸(아레나 밖·이미 붕괴)이면 null */
export function hitPillar(world: World, row: number, col: number): 'damaged' | 'collapsed' | null {
  const arena = ensure(world);
  if (!arena) return null;
  const key = pillarKey(row, col);
  const hp = arena.pillarHp[key];
  if (hp === undefined || hp <= 0) return null;
  const left = hp - 1;
  arena.pillarHp[key] = left;
  const cs = world.level.cellSize;
  const x = (col + 0.5) * cs;
  const z = (row + 0.5) * cs;
  if (left > 0) {
    world.events.emit('pillar_damaged', { row, col, hp: left, max: balance.arena.pillarHp, x, z });
    return 'damaged';
  }
  collapsePillar(world, arena, row, col);
  return 'collapsed';
}

/** 기둥 붕괴 — 낙석 규약(Traps.fireRockfall) 복제: 칸을 열고 잔해 차단 + 경로 차단, 반경 안 전원 피해 */
function collapsePillar(world: World, arena: ArenaState, row: number, col: number): void {
  const cfg = balance.arena;
  const level = world.level;
  const cs = level.cellSize;
  const x = (col + 0.5) * cs;
  const z = (row + 0.5) * cs;
  level.openCell(col, row); // 기둥이 사라진다 — 총알·시야·소음은 넘어간다
  const blocker = level.addBlocker(x, z, cfg.rubbleHalf); // 몸만 막는 잔해(props) — 돌격이 박혀도 충돌이 아니다
  level.setPathBlocked(col, row); // 적 추격 흐름장은 잔해를 벽으로 돌아간다
  arena.rubble.push({ row, col, x, z, blocker, broken: false });
  world.events.emit('pillar_damaged', { row, col, hp: 0, max: cfg.pillarHp, x, z });

  // 낙석 — 플레이어: 막기 불가, 회피 무적이면 면제(함정 낙석과 같다), 바깥으로 밀림
  const p = world.player;
  const R = cfg.rockfallRadius;
  const pd = Math.hypot(p.x - x, p.z - z);
  let playerHit = false;
  if (!world.dead && pd <= R && p.iframeTicks <= 0) {
    const amount = damagePlayer(world, cfg.rockfallDamage, { trap: true });
    if (pd > 0.001) pushPlayer(p, (p.x - x) / pd, (p.z - z) / pd, cfg.rockfallPlayerKnockback, cfg.rockfallKnockbackTicks);
    world.events.emit('player_damaged', { amount, health: p.health, blocked: false, srcX: x, srcZ: z, source: 'pillar_rockfall' });
    playerHit = true;
    if (p.health <= 0) {
      p.health = 0;
      world.dead = true;
      world.events.emit('player_died', { tick: world.tick });
    }
  }
  // 낙석 — 적: 반경 안 전원(천장에서 떨어진다). 보스는 traps.bossDamageMul, heavy 타격이라 갑각판 풀도 깎인다(B3-3)
  let enemyHits = 0;
  for (const enemy of world.enemies) {
    if (!enemy.alive) continue;
    if (Math.hypot(enemy.x - x, enemy.z - z) > R) continue;
    const def = enemyDef(enemy.type);
    const boss = def.boss || enemy.floorBoss === true;
    const raw = cfg.rockfallEnemyDamage * (boss ? balance.traps.bossDamageMul : 1);
    if (enemy.ai === 'idle') enemy.ai = 'chase';
    const dealt = applyFrostOnHit(world.events, enemy, raw);
    enemy.health -= dealt;
    hitShellPlates(world, enemy, dealt);
    enemyHits++;
    world.events.emit('damage_pop', { enemyId: enemy.id, amount: dealt });
    world.events.emit('arena_rockfall_hit', { enemyId: enemy.id, enemyType: enemy.type, amount: dealt, boss });
    if (enemy.health <= 0) {
      enemy.alive = false;
      world.events.emit('enemy_died', { enemyId: enemy.id, enemyType: enemy.type, x: enemy.x, z: enemy.z, noLoot: enemy.noLoot });
    }
  }
  world.events.emit('pillar_collapsed', { row, col, x, z, playerHit, enemyHits });
}

/** (x,z) 반경 안 잔해를 치운다 — 폭발. 잔해 상자의 가장 가까운 점이 반경 안이면(낙석 잔해 breakRubbleInRadius 와 같은 잣대). 치운 수를 돌려준다 */
export function breakRubbleNear(world: World, x: number, z: number, radius: number): number {
  const arena = world.arena;
  if (!arena || !balance.arena.rubbleBreakable) return 0;
  let count = 0;
  for (const rubble of arena.rubble) {
    if (rubble.broken || !rubble.blocker) continue;
    const b = rubble.blocker;
    const dx = Math.max(b.minX - x, 0, x - b.maxX);
    const dz = Math.max(b.minZ - z, 0, z - b.maxZ);
    if (Math.hypot(dx, dz) > radius) continue;
    world.level.removeBlocker(b);
    world.level.clearPathBlocked(rubble.col, rubble.row);
    rubble.blocker = undefined;
    rubble.broken = true;
    count++;
    world.events.emit('arena_rubble_broken', { row: rubble.row, col: rubble.col, x: rubble.x, z: rubble.z });
  }
  return count;
}

/** 부활(main.respawnAtAltar) — 되살아난 새 보스 몸에 지속 상태를 옮긴다(체력·페이즈·약점 내구·파열·낫 잠김·갑각판·질식·혼절 쿨다운·전투 장부).
 *  기획서가 부활 시 보스 체력을 규정하지 않아 '유지'로 둔다(B3-5) — 위치·AI·자세·노출 같은 전투 순간 상태는 새 몸(홈·idle)의 것 */
export function carryOver(from: EnemyState, to: EnemyState): void {
  to.health = from.health;
  if (from.phase !== undefined) to.phase = from.phase;
  if (from.weakHp) to.weakHp = { ...from.weakHp };
  if (from.ruptured) to.ruptured = { ...from.ruptured };
  if (from.bladeLock) to.bladeLock = { ...from.bladeLock };
  if (from.limping) to.limping = from.limping;
  if (from.platesLeft !== undefined) to.platesLeft = from.platesLeft;
  if (from.plateHp !== undefined) to.plateHp = from.plateHp;
  if (from.ventScale !== undefined) to.ventScale = from.ventScale;
  if (from.chokeTicks) to.chokeTicks = from.chokeTicks;
  if (from.dazeCooldown) to.dazeCooldown = from.dazeCooldown;
  if (from.weakCooldown) to.weakCooldown = { ...from.weakCooldown };
  if (from.fightPendingIn !== undefined) to.fightPendingIn = from.fightPendingIn;
  if (from.fightCleansed !== undefined) to.fightCleansed = from.fightCleansed;
}
