// 진액 웅덩이 — 낫뿔 거수 P2+ 바닥 압박 (docs/systems/boss_scythe_behemoth.md §10.2, B3-2).
//
// 웅덩이 생성(spawn_pool 이벤트 — Enemies 의 낫 착지점·발구르기 착지·미끄러짐, Projectiles 의 진액 구슬 착탄)·증발·접촉 검사만 한다.
// 접촉하면 플레이어 corrosive 를 lingerTicks 로 세우기만 한다(setPlayerStatus = 긴 쪽 갱신) — 감소·도트·오염 대기 가산은 Status.ts 한 곳(규칙 2, 기획서 §6 소유 규약).
// Traps.tickOil 의 '밟는 동안 매 틱 갱신' 규약을 복제했고 Traps 를 import 하지 않는다(한 파일 = 한 시스템).
//
// 증발: 불(explosion 이벤트 — 화염구·수류탄·폭발통, 내파는 불이 아니다 / 불붙은 기름 함정 trap_oil firing 반경) 즉시 · 질식(boss_status choke on) 때 전부 ·
// 동시 상한 poolMax 초과 시 오래된 것부터 · 아니면 ticks 뒤 자연 소멸. 수치는 전부 balance.hazards.
//
// 이벤트: pool_spawned{id, x, z, r, kind} / pool_evaporated{id, x, z, r, kind, reason 'expired'|'fire'|'choke'|'overflow'} — 계측(Metrics)·연출(Stage 는 world.pools 를 직접 그린다)

import { balance } from '../core/Balance';
import { setPlayerStatus, type PoolState, type World } from '../core/World';

let nextPoolId = 1;

type PoolKindCfg = { radius: number; ticks: number };
type EvaporateReason = 'expired' | 'fire' | 'choke' | 'overflow';

/** 구독 — 시작 시 1회 */
export function init(world: World): void {
  world.events.on('spawn_pool', (payload) => {
    const s = payload as { kind: string; x: number; z: number };
    spawnPool(world, s.x, s.z, s.kind);
  });
  // 질식(분출공 내구 0) — 아레나 웅덩이 전부 증발(기획서 §5 choke)
  world.events.on('boss_status', (payload) => {
    const st = payload as { kind: string; on: boolean };
    if (st.kind === 'choke' && st.on) evaporateAll(world, 'choke');
  });
  // 폭발은 불이다 — 화염구·수류탄·폭발통(igniteOilInRadius 와 같은 셋). 수호주술사 마법탄의 내파(implode)는 끌어당기는 힘이라 아니다
  world.events.on('explosion', (payload) => {
    const e = payload as { x: number; z: number; radius: number; kind?: string };
    if (e.kind === 'implode') return;
    evaporateNear(world, e.x, e.z, e.radius, 'fire');
  });
}

/** 웅덩이를 만든다 — kind 는 balance.hazards.pools 의 키(blade·stomp·orb·skid). 모르는 종류면 아무것도 안 하고 null.
 *  상한(poolMax)을 넘기면 오래된 것부터 증발한다(pool_evaporated{reason 'overflow'}) */
export function spawnPool(world: World, x: number, z: number, kind: string): PoolState | null {
  const cfg = (balance.hazards.pools as Record<string, PoolKindCfg | undefined>)[kind];
  if (!cfg) return null;
  const pool: PoolState = { id: nextPoolId++, x, z, r: cfg.radius, ticks: cfg.ticks, duration: cfg.ticks, kind };
  world.pools.push(pool);
  while (world.pools.length > balance.hazards.poolMax) {
    const oldest = world.pools.shift()!;
    emitEvaporated(world, oldest, 'overflow');
  }
  world.events.emit('pool_spawned', { id: pool.id, x, z, r: pool.r, kind });
  return pool;
}

/** (x,z) 반경 radius 에 닿는 웅덩이(원끼리 겹침)를 전부 증발시킨다 — 불. 증발한 수를 돌려준다 */
export function evaporateNear(world: World, x: number, z: number, radius: number, reason: EvaporateReason = 'fire'): number {
  let count = 0;
  world.pools = world.pools.filter((pool) => {
    if (Math.hypot(pool.x - x, pool.z - z) > radius + pool.r) return true;
    emitEvaporated(world, pool, reason);
    count++;
    return false;
  });
  return count;
}

/** 전부 증발 — 질식. 증발한 수를 돌려준다 */
export function evaporateAll(world: World, reason: EvaporateReason = 'choke'): number {
  const gone = world.pools;
  world.pools = [];
  for (const pool of gone) emitEvaporated(world, pool, reason);
  return gone.length;
}

/** 이벤트 없이 비운다 — 층 이동·부활·시험방 진입(main.loadFloor). 웅덩이는 층/판에 속한다 */
export function clearAll(world: World): void {
  world.pools.length = 0;
}

/** 이 자리(중심)가 웅덩이 위인가 — 접촉 규칙(중심 거리 ≤ r, 점액 장판과 같은 잣대) */
export function poolAt(world: World, x: number, z: number): PoolState | undefined {
  return world.pools.find((pool) => Math.hypot(x - pool.x, z - pool.z) <= pool.r);
}

export function tick(world: World, _dt: number): void {
  if (world.pools.length === 0) return;
  // 불붙은 기름 함정 — 불길 반경에 닿은 웅덩이는 매 틱 증발한다(옮겨붙는 순간·이미 타는 자리에 새로 생긴 웅덩이 모두)
  const oil = balance.traps.types.trap_oil;
  for (const trap of world.traps) {
    if (trap.type !== 'trap_oil' || trap.phase !== 'firing') continue;
    evaporateNear(world, trap.x, trap.z, oil.radius, 'fire');
  }
  // 자연 소멸
  world.pools = world.pools.filter((pool) => {
    pool.ticks--;
    if (pool.ticks > 0) return true;
    emitEvaporated(world, pool, 'expired');
    return false;
  });
  // 접촉 — 웅덩이 위에 서 있으면 오염 진액을 lingerTicks 로 세운다(매 틱 되살아난다 — 나오면 그만큼 뒤 풀린다).
  // 회피 무적·그림자 이동 중에는 새로 붙지 않는다(불길·포자와 같은 도트 규약 — 대시로 가르는 건 무사)
  const p = world.player;
  if (world.dead || p.iframeTicks > 0 || (p.blinkLeft ?? 0) > 0) return;
  if (poolAt(world, p.x, p.z)) setPlayerStatus(p, 'corrosive', balance.status.corrosive.lingerTicks);
}

function emitEvaporated(world: World, pool: PoolState, reason: EvaporateReason): void {
  world.events.emit('pool_evaporated', { id: pool.id, x: pool.x, z: pool.z, r: pool.r, kind: pool.kind, reason });
}
