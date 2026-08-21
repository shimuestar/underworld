// 제단 — 접근 감지, 진입(보급/세이브/정산 트리거), 우회 계측, 공격성 보너스.
// docs/systems/economy.md §1~2.
//
// ⚠ 반직관 핵심 규칙: 보급은 잔탄과 무관하게 상한으로 "설정"한다.
//    ammo += refill 이나 Math.min(ammo + n, max) 형태는 절대 금지 —
//    30발 남기고 온 플레이어는 30발어치를 버린 것이며, 그것이 의도된 동작이다.

import { balance } from '../core/Balance';
import type { World } from '../core/World';

/** 구간 전투 통계 구독. 시작 시 1회 호출 */
export function init(world: World): void {
  const stats = world.combatStats;
  const events = world.events;

  events.on('weapon_kill', () => stats.totalKills++);
  events.on('spell_kill', () => stats.totalKills++);
  events.on('melee_kill', () => {
    stats.totalKills++;
    stats.meleeKills++;
  });
  events.on('parry_attempt', (payload) => {
    if ((payload as { result: string }).result === 'perfect') stats.perfectParries++;
  });
  events.on('combat_entered', () => {
    stats.encounters++;
    stats.damagedThisEncounter = false;
  });
  events.on('player_damaged', () => {
    stats.damagedThisEncounter = true;
  });
  events.on('combat_exited', () => {
    if (!stats.damagedThisEncounter) stats.cleanEncounters++;
  });
}

export function tick(world: World, _dt: number): void {
  const altar = world.level.altarPos;
  if (!altar) return;

  const dist = Math.hypot(world.player.x - altar.x, world.player.z - altar.z);
  const near = dist <= balance.altar.radius;

  if (near && !world.nearAltar) {
    world.nearAltar = true;
    world.altarEnteredThisApproach = false;
  } else if (!near && world.nearAltar) {
    world.nearAltar = false;
    if (!world.altarEnteredThisApproach) {
      world.events.emit('altar_bypassed', { ammoLeftRatio: ammoLeftRatio(world) });
    }
  }

  if (near && world.input.interactPressed && !world.altarEnteredThisApproach) {
    enter(world, altar);
  }
}

function ammoLeftRatio(world: World): number {
  const pistol = balance.weapons.pistol;
  return (world.weapon.mag + world.weapon.reserve) / (pistol.magSize + pistol.ammoMax);
}

/** 직전 구간 전투 평가 → 해당 구역 한정 탄약 상한 배율 (1.0 ~ maxMultiplier) */
export function aggressionMultiplier(world: World): number {
  const ag = balance.altar.aggressionBonus;
  const stats = world.combatStats;
  const meleeRatio = stats.totalKills > 0 ? stats.meleeKills / stats.totalKills : 0;
  const parryScore = Math.min(stats.perfectParries / ag.perfectParryCap, 1);
  const cleanRatio = stats.encounters > 0 ? stats.cleanEncounters / stats.encounters : 0;
  const score =
    meleeRatio * ag.meleeRatioWeight +
    parryScore * ag.perfectParryWeight +
    cleanRatio * ag.noDamageRatioWeight;
  return 1 + Math.min(Math.max(score, 0), 1) * (ag.maxMultiplier - 1);
}

export function enter(world: World, altar: { x: number; z: number }): void {
  const ratio = ammoLeftRatio(world);
  const mul = aggressionMultiplier(world);
  world.altarBonusMul = mul;

  // 보급 — 상한으로 SET. 잔탄이 얼마였는지는 보지 않는다 (하드 룰)
  const pistol = balance.weapons.pistol;
  world.weapon.reserve = Math.round(pistol.ammoMax * mul);
  world.weapon.mag = pistol.magSize;
  world.weapon.reloading = 0;

  // 세이브/리스폰 지점 등록
  world.respawn = { x: altar.x, z: altar.z };
  world.events.emit('respawn_registered', { x: altar.x, z: altar.z });

  world.altarEnteredThisApproach = true;

  // 오염 정산은 Corruption이, 각인 교체 UI는 main이 이 이벤트를 구독해 처리
  world.events.emit('altar_entered', {
    ammoLeftRatio: ratio,
    pendingCorruption: world.corruption.pending,
    multiplier: mul,
  });

  // 보너스는 다음 제단에서 재계산. 누적되지 않는다
  const stats = world.combatStats;
  stats.meleeKills = 0;
  stats.totalKills = 0;
  stats.perfectParries = 0;
  stats.encounters = 0;
  stats.cleanEncounters = 0;
  stats.damagedThisEncounter = false;
}
