// 각인 — 획득(처형 드랍), 부착/해제, 파생 수치(Modifiers) 재계산.
// 주우면 즉시 부착되어 효과가 붙는다. 부위 페널티는 폐지(2026-08), 오염만 pending에 누적.
// docs/systems/economy.md §3~4.

import { balance } from '../core/Balance';
import { enemyDef } from '../core/Entities';
import { isActiveSkill, sigilDef } from '../core/SigilData';
import type { Modifiers, World } from '../core/World';

export function defaultModifiers(): Modifiers {
  return {
    dodgeDistanceMul: 1,
    dodgeIFrameTicks: balance.reaction.dodgeIFrameTicks,
    ambientVisionBoost: 0,
  };
}

let nextGroundItemId = 1;

function dropAll(world: World, enemyType: string, x: number, z: number): void {
  for (const id of enemyDef(enemyType).drops ?? []) {
    world.groundItems.push({ id: nextGroundItemId++, kind: 'sigil', sigilId: id, x, z });
    world.events.emit('sigil_dropped', { id });
  }
}

/** 드랍 구독. 시작 시 1회 호출.
 *  일반 적: 처형 시에만 드랍. 처형 불가능한 적(warden)·보스: 사망 시 드랍(dropsOnDeath) */
export function init(world: World): void {
  world.events.on('melee_kill', (payload) => {
    const { enemyType, execution, x, z } = payload as {
      enemyType: string;
      execution?: boolean;
      x?: number;
      z?: number;
    };
    if (!execution) return;
    if (enemyDef(enemyType).dropsOnDeath) return; // enemy_died 쪽에서 처리 (중복 방지)
    dropAll(world, enemyType, x ?? world.player.x, z ?? world.player.z);
  });

  world.events.on('enemy_died', (payload) => {
    const { enemyType, x, z } = payload as { enemyType: string; x: number; z: number };
    if (!enemyDef(enemyType).dropsOnDeath) return;
    dropAll(world, enemyType, x, z);
  });
}

/** 바닥 각인 줍기 — 접근하면 자동 획득 */
export function tick(world: World, _dt: number): void {
  if (world.groundItems.length === 0) return;
  const p = world.player;
  for (let i = world.groundItems.length - 1; i >= 0; i--) {
    const item = world.groundItems[i]!;
    if (item.kind !== 'sigil') continue; // 포션·골드는 Pickups가 줍는다
    if (Math.hypot(p.x - item.x, p.z - item.z) > balance.sigil.pickupRadius) continue;
    world.groundItems.splice(i, 1);
    acquire(world, item.sigilId!);
  }
}

/** 스킬 획득 — 갖는 순간 몸에 새겨진다. 패시브는 곧바로 켜지고,
 *  액티브는 골라 둔 것이 없으면 이것이 선택된다. 오염은 부위 비용만큼 대기(pending)에
 *  쌓여 제단에서 정산된다 (M6) */
export function acquire(world: World, sigilId: string): void {
  const def = sigilDef(sigilId);
  world.sigils.inventory.push(sigilId);
  const cost = balance.corruption.slotCost[def.slot];
  world.corruption.pending += cost;
  const active = isActiveSkill(def);
  // 자동 선택은 시전이 구현된 스킬만 — 데이터만 있는 스킬이 Q 에 올라가면 죽은 키가 된다.
  // 직접 고르는 건 막지 않는다 (select)
  if (active && def.slice && world.sigils.active === null) world.sigils.active = sigilId;
  recompute(world);
  world.events.emit('sigil_acquired', {
    id: sigilId,
    kind: active ? 'active' : 'passive',
    selected: world.sigils.active === sigilId,
    corruptionCost: cost,
  });
}

/** 액티브 스킬 선택 — Q 가 이걸 쓴다. 갖고 있지 않거나 패시브면 실패 */
export function select(world: World, sigilId: string): boolean {
  if (!world.sigils.inventory.includes(sigilId)) return false;
  if (!isActiveSkill(sigilDef(sigilId))) return false;
  if (world.sigils.active === sigilId) return true;
  world.sigils.active = sigilId;
  world.events.emit('skill_selected', { id: sigilId });
  return true;
}

/** 갖고 있는 패시브 스킬로 Modifiers 재계산. 액티브 스킬의 effects 는 시전 수치라
 *  여기 안 들어온다. 페널티는 없다 (2026-08) — 스킬은 순수 강화, 대가는 오염 정산뿐 */
export function recompute(world: World): void {
  const mods = defaultModifiers();

  for (const id of world.sigils.inventory) {
    const def = sigilDef(id);
    if (isActiveSkill(def)) continue;
    const effects = def.effects;
    if (effects['dodgeDistanceMul']) mods.dodgeDistanceMul = effects['dodgeDistanceMul'];
    if (effects['iFrameTicks']) mods.dodgeIFrameTicks = effects['iFrameTicks'];
    if (effects['ambientVisionBoost']) mods.ambientVisionBoost = effects['ambientVisionBoost'];
  }

  world.modifiers = mods;
}
