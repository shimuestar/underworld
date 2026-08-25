// data/sigils.json 로더. 각인 정의는 전부 여기서 읽는다.

import sigilsJson from '../../data/sigils.json';

export type SigilSlot = 'eye' | 'rightArm' | 'leftArm' | 'heart' | 'spine';

export interface SigilDef {
  id: string;
  name: string;
  /** 한 줄 설명 — 스킬창에 그대로 뜬다 */
  desc?: string;
  /** 새겨지는 부위 — 오염 비용 산정에만 쓴다 (2026-08 스킬 개념 이후) */
  slot: SigilSlot;
  tier: 'passive' | 'small' | 'medium' | 'large';
  /** 액티브 스킬의 시전 방식 — 없으면 아직 데이터만 있는 스킬이다 */
  cast?: 'projectile' | 'beam' | 'nova' | 'blink';
  zone: number;
  slice: boolean;
  /** 표시 색 (#rrggbb) — 바닥 각인과 각인 UI가 같은 값을 쓴다.
   *  24종이 전부 다른 색이라 주우러 가기 전에 무엇인지 구분된다 */
  color: string;
  effects: Record<string, number>;
}

const byId = new Map<string, SigilDef>(
  (sigilsJson.sigils as unknown as SigilDef[]).map((sigil) => [sigil.id, sigil]),
);

export function sigilDef(id: string): SigilDef {
  const def = byId.get(id);
  if (!def) throw new Error(`sigils.json에 없는 각인: ${id}`);
  return def;
}

export const SIGIL_SLOTS: SigilSlot[] = ['eye', 'rightArm', 'leftArm', 'heart', 'spine'];

/** 각인 색 — Three.js·CSS 양쪽에서 쓰게 숫자로 준다 */
export function sigilColor(id: string): number {
  return Number.parseInt(sigilDef(id).color.slice(1), 16);
}

/** 액티브 스킬인가 — 골라서 Q 로 쓴다. 패시브는 갖고만 있어도 켜진다 */
export function isActiveSkill(def: SigilDef): boolean {
  return def.tier !== 'passive';
}
