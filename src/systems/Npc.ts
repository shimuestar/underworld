// NPC — 성소 로비의 성직자 사제·상인. 제단과 같은 접근 규약(반경 + 시야각)으로 대상을 잡고,
// 상호작용을 누르면 npc_talked 를 낸다 — 대화·상점 UI 는 main 이 이벤트로 연다.
// 사제의 축복(bless)은 여기서 처리한다: 체력·마나 가득, 독·화염·상태이상 정화, 잠시 받는 피해 감소.
// 축복 잔여 틱은 tick 이 줄이고, 피해 배율은 Combat(피해 계산)이 blessingDamageMul 로 읽는다.

import { balance } from '../core/Balance';
import type { NpcState, World } from '../core/World';
import * as Status from './Status';

export function tick(world: World, _dt: number): void {
  if (world.blessingTicks > 0) {
    world.blessingTicks--;
    if (world.blessingTicks === 0) world.events.emit('blessing_ended', {});
  }

  // 창을 닫은 키가 도로 열지 않게 — 가드가 남은 틱 동안은 상호작용을 무시한다 (N 이면 N 틱)
  const guarded = world.npcReopenGuard > 0;
  if (guarded) world.npcReopenGuard--;
  if (world.npcs.length === 0) {
    world.npcInView = null;
    return;
  }
  const cfg = balance.lobby.npc;
  const p = world.player;
  const fx = -Math.sin(p.yaw);
  const fz = -Math.cos(p.yaw);
  const cosArc = Math.cos((cfg.facingArcDeg * Math.PI) / 360);
  let best: NpcState | null = null;
  let bestDist = Infinity;
  for (const npc of world.npcs) {
    const toX = npc.x - p.x;
    const toZ = npc.z - p.z;
    const dist = Math.hypot(toX, toZ);
    if (dist > cfg.radius || dist >= bestDist) continue;
    const facing = dist <= 0.001 || (toX * fx + toZ * fz) / dist >= cosArc;
    if (!facing) continue;
    best = npc;
    bestDist = dist;
  }
  world.npcInView = best;

  // 제단·상자·문이 같은 틱에 상호작용을 먹으면 겹친다 — 로비엔 그런 대상이 대제단뿐이고,
  // 대제단 반경(2.4) 과 NPC 자리는 겹치지 않게 배치한다 (lobby.json)
  if (best && world.input.interactPressed && !world.uiOpen && !world.dead && !guarded) {
    world.events.emit('npc_talked', { id: best.id, kind: best.kind, x: best.x, z: best.z });
  }
}

/** 사제의 축복 — 체력·마나 가득, 독·화염·팔 저림·진탕 정화, durationTicks 동안 받는 피해 감소.
 *  값(cost)이 있으면 골드를 받는다. 성공하면 true, 골드가 모자라면 false (blessing_denied) */
export function bless(world: World): boolean {
  const cfg = balance.lobby.blessing;
  if (world.gold < cfg.cost) {
    world.events.emit('blessing_denied', { cost: cfg.cost, gold: world.gold });
    return false;
  }
  world.gold -= cfg.cost;
  const p = world.player;
  const healed = balance.player.healthMax - p.health;
  p.health = balance.player.healthMax;
  p.dots = {};
  Status.clearAll(world);
  world.mana.value = balance.mana.max;
  world.blessingTicks = cfg.durationTicks;
  world.blessingDamageMul = cfg.damageTakenMul; // World.damagePlayer 가 곱한다 (World 는 데이터를 안 읽는다)
  world.events.emit('blessed', { healed, cost: cfg.cost, durationTicks: cfg.durationTicks });
  return true;
}

/** 축복 중 받는 피해 배율 — 없으면 1 (HUD 표시용) */
export function blessingDamageMul(world: World): number {
  return world.blessingTicks > 0 ? world.blessingDamageMul : 1;
}
