// data/sigils.json 로더. 각인 정의는 전부 여기서 읽는다.

import sigilsJson from '../../data/sigils.json';

export type SigilSlot = 'eye' | 'rightArm' | 'leftArm' | 'heart' | 'spine';

export interface SigilDef {
  id: string;
  name: string;
  slot: SigilSlot;
  tier: 'passive' | 'small' | 'medium' | 'large';
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
