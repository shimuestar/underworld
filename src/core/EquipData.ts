// 장비 정의 접근 — data/equipment.json (2026-09-04). 7칸: 투구·갑옷·부츠·반지 2·목걸이·짐칸(벨트/가방 중 하나).
import equipmentJson from '../../data/equipment.json';

/** 장비 정의의 부위 — 반지는 하나의 정의가 두 칸(ring1/ring2) 중 어디든 간다 */
export type EquipSlotKind = 'head' | 'body' | 'feet' | 'ring' | 'neck' | 'pack';
/** 몸의 실제 칸 */
export type EquipSlot = 'head' | 'body' | 'feet' | 'ring1' | 'ring2' | 'neck' | 'pack';
export const EQUIP_SLOTS: EquipSlot[] = ['head', 'body', 'feet', 'ring1', 'ring2', 'neck', 'pack'];

export interface EquipDef {
  name: string;
  slot: EquipSlotKind;
  /** 짐칸 종류 — 벨트(칸 적게 + 빨리 마시기) / 가방(칸 많이) */
  packKind?: 'belt' | 'bag';
  tier: number;
  color: string;
  price: number;
  desc: string;
  effects: Record<string, number>;
}

export function equipDef(id: string): EquipDef {
  const def = (equipmentJson.items as Record<string, unknown>)[id];
  if (!def) throw new Error(`equipment.json에 없는 장비: ${id}`);
  return def as EquipDef;
}

export function allEquipIds(): string[] {
  return Object.keys(equipmentJson.items);
}

/** Three.js·CSS 양쪽에서 쓰게 숫자로 (sigilColor 와 같은 규약) */
export function equipColor(id: string): number {
  return Number.parseInt(equipDef(id).color.slice(1), 16);
}

/** 정의 부위 → 몸의 칸들 (반지는 둘) */
export function slotsFor(kind: EquipSlotKind): EquipSlot[] {
  return kind === 'ring' ? ['ring1', 'ring2'] : [kind];
}

/** 칸 이름표 — '반지 1'·'반지 2' 처럼 */
export function slotLabel(slot: EquipSlot): string {
  const labels = equipmentJson.slotLabels as Record<string, string>;
  if (slot === 'ring1') return `${labels['ring']} 1`;
  if (slot === 'ring2') return `${labels['ring']} 2`;
  return labels[slot] ?? slot;
}

/** 효과 한 줄 설명 — 팝업·비교용 */
export function describeEffect(key: string, value: number): string {
  const pct = (v: number): string => `${v >= 0 ? '+' : ''}${Math.round(v * 100)}%`;
  switch (key) {
    case 'damageTakenMul': return `받는 피해 ${pct(value - 1)}`;
    case 'trapDamageMul': return `함정 피해 ${pct(value - 1)}`;
    case 'moveSpeedMul': return `이동 속도 ${pct(value - 1)}`;
    case 'sprintDrainMul': return `질주 스태미나 소모 ${pct(value - 1)}`;
    case 'dodgeDistanceMul': return `회피 거리 ${pct(value - 1)}`;
    case 'manaRegenMul': return `마나 회복 ${pct(value - 1)}`;
    case 'goldMul': return `골드 획득 ${pct(value - 1)}`;
    case 'perfectBandBonus': return `완벽 패링 대역 +${value}m`;
    case 'stunMul': return `경직 시간 ${pct(value - 1)}`;
    case 'shopDiscount': return `제단 가격 -${Math.round(value * 100)}%`;
    case 'itemChannelMul': return `마시는 시간 ${pct(value - 1)}`;
    case 'potionHealMul': return `물약 회복 ${pct(value - 1)}`;
    case 'bagSlots': return `가방 +${value}칸`;
    default: return `${key} ${value}`;
  }
}
