// 세이브 저장소 — localStorage 한 키에 저장 목록(JSON 배열)을 둔다. 규칙은 core/Save, 시점·UI 는 main.
// 종류별로 최근 keep.auto / keep.manual 개만 남기고 오래된 것부터 지운다. 깨진 항목·다른 버전은 목록에서 걸러 낸다.
// Storage 를 주입할 수 있어 테스트는 메모리 스텁을 쓴다 (Vitest 노드 환경엔 localStorage 가 없다).

import { balance } from './Balance';
import { isSaveData, type SaveData, type SaveKind } from './Save';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function store(custom?: StorageLike): StorageLike | null {
  if (custom) return custom;
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

/** 저장 목록 — 최신이 앞. 읽을 수 없거나 깨졌으면 빈 목록 */
export function listSaves(custom?: StorageLike): SaveData[] {
  const s = store(custom);
  if (!s) return [];
  try {
    const raw = s.getItem(balance.save.storageKey);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isSaveData).sort((a, b) => b.savedAt - a.savedAt);
  } catch {
    return [];
  }
}

function write(list: SaveData[], custom?: StorageLike): boolean {
  const s = store(custom);
  if (!s) return false;
  try {
    s.setItem(balance.save.storageKey, JSON.stringify(list));
    return true;
  } catch {
    return false; // 용량 초과 등 — 부르는 쪽이 알린다
  }
}

/** 종류별 최근 N개만 남긴다 (최신이 앞인 목록에서) */
export function trimSaves(list: SaveData[]): SaveData[] {
  const keep: Record<SaveKind, number> = { auto: balance.save.keep.auto, manual: balance.save.keep.manual };
  const seen: Record<SaveKind, number> = { auto: 0, manual: 0 };
  return list.filter((d) => seen[d.kind]++ < keep[d.kind]);
}

/** 저장 하나를 추가한다 — 목록을 다듬고 통째로 다시 쓴다. 쓰지 못했으면 false */
export function putSave(data: SaveData, custom?: StorageLike): boolean {
  const list = trimSaves([data, ...listSaves(custom).filter((d) => d.id !== data.id)].sort((a, b) => b.savedAt - a.savedAt));
  return write(list, custom);
}

export function deleteSave(id: string, custom?: StorageLike): boolean {
  return write(listSaves(custom).filter((d) => d.id !== id), custom);
}

export function clearSaves(custom?: StorageLike): void {
  const s = store(custom);
  if (!s) return;
  try { s.removeItem(balance.save.storageKey); } catch { /* 무시 */ }
}
