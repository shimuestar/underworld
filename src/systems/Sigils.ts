// 각인 — 획득(처형 드랍), 부착/해제, 파생 수치(Modifiers) 재계산.
// 주우면 즉시 부착되어 효과가 붙는다. 부위 페널티는 폐지(2026-08), 오염만 pending에 누적.
// docs/systems/economy.md §3~4.

import { balance } from '../core/Balance';
import { enemyDef } from '../core/Entities';
import { isActiveSkill, sigilDef, type SigilSlot } from '../core/SigilData';
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
  ensureSkillSlots(world);
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

/** 바닥 각인 줍기 — 접근하면 자동 획득. 스킬 교체 입력도 여기서 받는다 */
export function tick(world: World, _dt: number): void {
  if (world.input.cycleSkill) cycleSkill(world);
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

/** 스킬 퀵슬롯 칸 수를 balance 에 맞춘다 (테스트·시작 시 빈 배열로 올 수 있다) */
export function ensureSkillSlots(world: World): (string | null)[] {
  const n = balance.skills.quickslots;
  if (world.skillSlots.length !== n) {
    world.skillSlots = Array.from({ length: n }, (_, i) => world.skillSlots[i] ?? null);
  }
  return world.skillSlots;
}

/** 스킬 획득. 패시브는 부위가 비어 있으면 곧바로 새겨지고(오염은 attach 에서),
 *  액티브는 리스트에 들어가며 시전이 구현된 것이면 빈 퀵슬롯에 바로 올라간다.
 *  액티브의 오염은 여기서 — 익히는 순간이 대가를 치르는 순간이다 */
export function acquire(world: World, sigilId: string): void {
  const def = sigilDef(sigilId);
  // 이미 익힌 스킬 — 같은 각인을 두 개 들고 있어 봐야 쓸 데가 없다. 경험치로 바꾼다
  if (world.sigils.inventory.includes(sigilId)) {
    const amount = balance.sigil.duplicateXp[def.tier] ?? 0;
    world.xp += amount;
    world.events.emit('xp_gained', { amount, total: world.xp, source: 'sigil_duplicate' });
    world.events.emit('sigil_duplicate', { id: sigilId, xp: amount });
    return;
  }
  world.sigils.inventory.push(sigilId);
  if (isActiveSkill(def)) {
    const cost = balance.corruption.slotCost[def.slot];
    world.corruption.pending += cost;
    let slot = -1;
    if (def.cast) {
      const slots = ensureSkillSlots(world);
      slot = slots.indexOf(null);
      if (slot >= 0) slots[slot] = sigilId;
      settleSelection(world);
    }
    world.events.emit('sigil_acquired', { id: sigilId, kind: 'active', slot, corruptionCost: cost });
    return;
  }
  const attached = attach(world, sigilId);
  world.events.emit('sigil_acquired', { id: sigilId, kind: 'passive', attached, slot: def.slot });
}

/** 패시브를 부위에 새긴다. 갖고 있지 않거나, 액티브거나, 부위가 차 있으면 실패 */
export function attach(world: World, sigilId: string): boolean {
  if (!world.sigils.inventory.includes(sigilId)) return false;
  const def = sigilDef(sigilId);
  if (isActiveSkill(def)) return false;
  if (world.sigils.equipped[def.slot] !== null) return false;
  world.sigils.equipped[def.slot] = sigilId;
  const cost = balance.corruption.slotCost[def.slot];
  world.corruption.pending += cost; // 오염은 부착 시 1회 pending 누적, 제단에서 정산 (M6)
  recompute(world);
  world.events.emit('sigil_attached', { id: sigilId, slot: def.slot, corruptionCost: cost });
  return true;
}

/** 부위의 패시브를 떼어 낸다 — 리스트에는 그대로 남는다 (다시 새길 수 있다) */
export function detach(world: World, slot: SigilSlot): boolean {
  const id = world.sigils.equipped[slot];
  if (!id) return false;
  world.sigils.equipped[slot] = null;
  recompute(world);
  world.events.emit('sigil_detached', { id, slot });
  return true;
}

/** 선택 칸을 다음으로 돌린다 — 빈 칸은 건너뛰고 끝에서 처음으로 돈다. 전부 비었으면 그대로 */
export function cycleSkill(world: World, dir = 1): boolean {
  const slots = ensureSkillSlots(world);
  const n = slots.length;
  for (let step = 1; step <= n; step++) {
    const i = (((world.selectedSkill + dir * step) % n) + n) % n;
    if (slots[i] !== null) {
      if (i === world.selectedSkill) return false; // 찬 칸이 하나뿐
      world.selectedSkill = i;
      world.events.emit('skill_selected', { index: i, id: slots[i] });
      return true;
    }
  }
  return false;
}

/** 선택 칸이 비면 찬 칸으로 옮긴다 — 빈 칸을 가리킨 채 두면 사용 키가 헛방이다 */
function settleSelection(world: World): void {
  const slots = world.skillSlots;
  if (slots[world.selectedSkill] !== null) return;
  const first = slots.findIndex((id) => id !== null);
  if (first >= 0) world.selectedSkill = first;
}

/** 스킬 퀵슬롯에 액티브를 올린다 (null 이면 비운다). 같은 스킬은 한 칸에만 */
export function assignSkill(world: World, index: number, sigilId: string | null): boolean {
  const slots = ensureSkillSlots(world);
  if (index < 0 || index >= slots.length) return false;
  if (sigilId !== null) {
    if (!world.sigils.inventory.includes(sigilId)) return false;
    if (!isActiveSkill(sigilDef(sigilId))) return false;
    const dup = slots.indexOf(sigilId);
    if (dup >= 0) slots[dup] = null;
  }
  slots[index] = sigilId;
  settleSelection(world);
  world.events.emit('skill_slot_changed', { index, id: sigilId });
  return true;
}

/** 부위에 새겨진 패시브로 Modifiers 재계산. 갖고만 있는 패시브는 꺼져 있다.
 *  페널티는 없다 (2026-08) — 스킬은 순수 강화, 대가는 오염 정산뿐 */
export function recompute(world: World): void {
  const mods = defaultModifiers();

  for (const id of Object.values(world.sigils.equipped)) {
    if (!id) continue;
    const effects = sigilDef(id).effects;
    if (effects['dodgeDistanceMul']) mods.dodgeDistanceMul = effects['dodgeDistanceMul'];
    if (effects['iFrameTicks']) mods.dodgeIFrameTicks = effects['iFrameTicks'];
    if (effects['ambientVisionBoost']) mods.ambientVisionBoost = effects['ambientVisionBoost'];
  }

  world.modifiers = mods;
}
