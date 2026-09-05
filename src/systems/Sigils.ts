// 각인 — 드랍(처형·보스), 익히기/새기기/떼기, 파생 수치(Modifiers) 재계산.
// 2026-09-04 아이템화: 각인은 가방 아이템이다(Pickups 가 E 로 집고 Loot 가 주머니·상자에서 넘긴다).
// 스킬 탭에서 가방의 각인을 새기면(learnFromBag) 가방에서 빠져 몸에 박히고 그때 오염이 pending 에 누적된다.
// 떼면(제단) 다시 가방 아이템으로 돌아오고, 이미 익힌 각인(중복)은 제단에서 판다(sellFromBag).
// docs/systems/economy.md §3~4.

import { balance } from '../core/Balance';
import { enemyDef } from '../core/Entities';
import { addSigil } from '../core/Inventory';
import { isActiveSkill, sigilDef, type SigilSlot } from '../core/SigilData';
import { scatterAwayFromPlayer, type Modifiers, type World } from '../core/World';
import { defaultModifiers as defaultModifiersCore, recomputeModifiers } from '../core/Modifiers';

/** 기본 파생 수치 — core/Modifiers 의 것을 그대로 (테스트·World 초기화가 여기서 부른다) */
export function defaultModifiers(): Modifiers {
  return defaultModifiersCore();
}

let nextGroundItemId = 1;

function dropAll(world: World, enemyType: string, x: number, z: number): void {
  for (const id of enemyDef(enemyType).drops ?? []) {
    // 공통 드랍 규칙 — 플레이어 반대쪽으로, 바닥에 놓인 뒤에야 줍힌다
    const at = scatterAwayFromPlayer(world, x, z, 0.7, balance.pickups.awayArcDeg);
    world.groundItems.push({
      id: nextGroundItemId++, kind: 'sigil', sigilId: id, x: at.x, z: at.z,
      noMagnetTicks: balance.pickups.landNoMagnetTicks,
    });
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

  // 액티브 스킬 각인 — 아이템이 아니다. 바닥(Pickups)·주머니·상자(Loot)에서 가져가는 순간 익힌다 (2026-09-04 개념 변경)
  world.events.on('sigil_taken', (payload) => {
    const t = payload as { sigilId: string };
    if (t.sigilId) acquire(world, t.sigilId);
  });
}

/** 스킬 교체 입력. (패시브 각인 줍기는 Pickups 가 소모품처럼 E 로 집어 가방에 넣는다) */
export function tick(world: World, _dt: number): void {
  if (world.input.cycleSkill) cycleSkill(world);
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

/** 부위의 패시브를 떼어 낸다 — 가방 아이템으로 돌아간다(가방이 가득이면 못 뗀다). 다시 새기면 오염을 다시 낸다 */
export function detach(world: World, slot: SigilSlot): boolean {
  const id = world.sigils.equipped[slot];
  if (!id) return false;
  if (!addSigil(world, id)) {
    world.events.emit('sigil_detach_denied', { id, slot, reason: 'bag_full' });
    return false;
  }
  world.sigils.equipped[slot] = null;
  const at = world.sigils.inventory.indexOf(id);
  if (at >= 0) world.sigils.inventory.splice(at, 1); // 몸에서 빠졌다 — 가방의 아이템이 정본
  recompute(world);
  world.events.emit('sigil_detached', { id, slot });
  return true;
}

export type LearnResult = 'attached' | 'learned' | 'part_full' | 'known' | 'none';

/** 가방의 각인을 새긴다/익힌다 (2026-09-04 아이템화). 패시브는 부위가 비어 있어야 하고 새기면 가방에서 빠져 몸에 박힌다.
 *  액티브는 익히면(오염) 목록에 들고 빈 스킬 칸에 오른다. 이미 익힌 것(중복)은 그대로 둔다 — 제단에서 판다 */
export function learnFromBag(world: World, slotIndex: number): LearnResult {
  const slot = world.inventory[slotIndex];
  if (!slot || slot.kind !== 'sigil' || !slot.sigilId) return 'none';
  const id = slot.sigilId;
  const def = sigilDef(id);
  if (world.sigils.inventory.includes(id)) {
    world.events.emit('sigil_learn_denied', { id, reason: 'known' });
    return 'known';
  }
  if (!isActiveSkill(def) && world.sigils.equipped[def.slot] !== null) {
    world.events.emit('sigil_learn_denied', { id, reason: 'part_full', slot: def.slot });
    return 'part_full';
  }
  world.inventory[slotIndex] = null;
  acquire(world, id); // 패시브는 부위가 비어 있어 곧바로 새겨진다, 액티브는 익힘 + 빈 스킬 칸
  return isActiveSkill(def) ? 'learned' : 'attached';
}

/** 제단에서 가방의 각인을 판다 — 티어별 골드(sigil.sellGold). 중복 각인의 출구 */
export function sellFromBag(world: World, slotIndex: number): number {
  const slot = world.inventory[slotIndex];
  if (!slot || slot.kind !== 'sigil' || !slot.sigilId) return 0;
  const def = sigilDef(slot.sigilId);
  const gold = (balance.sigil.sellGold as Record<string, number>)[def.tier] ?? 0;
  world.inventory[slotIndex] = null;
  world.gold += gold;
  world.events.emit('sigil_sold', { id: slot.sigilId, gold, total: world.gold });
  return gold;
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
  recomputeModifiers(world); // 각인 + 장비 (core/Modifiers)
}
