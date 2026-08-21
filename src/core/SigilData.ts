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
