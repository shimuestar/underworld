// 소모품 아이콘 — 인라인 SVG. 에셋을 쓰지 않는다는 규약(CLAUDE.md §6)을 지키면서
// 색칠한 네모보다 알아보기 쉽게, 도형만으로 실루엣을 그린다.
//
// 모양은 바닥에 떨어진 3D 모형을 그대로 옮겼다 — 약병은 목 달린 병, 음식은 뼈다귀
// 고기. 미니맵 색이 실물과 같아야 한다는 규약과 같은 이유다: 주워 온 그것이
// 칸 안에 그대로 있어야 "이게 뭐였지"가 안 생긴다.

import { itemDef } from '../core/Inventory';
import { equipDef } from '../core/EquipData';
import { sigilColor } from '../core/SigilData';
import type { ItemKind, LootEntry } from '../core/World';

/** 유리·뼈 같은 보조 색 — 3D 모형(Stage)의 POTION_GLASS / FOOD_BONE 과 같은 값 */
const GLASS = '#bfe6ff';
const BONE = '#e8ddc0';

/** 어두운 화면에서 형태가 뭉개지지 않게 깔아 주는 외곽선 */
const OUTLINE = 'rgba(0,0,0,0.55)';

/** 약병 — 목 + 어깨 + 둥근 몸통. viewBox 24×24 기준 */
function flask(color: string): string {
  return (
    `<path d="M10 2h4v4l3.4 5.2a7 7 0 1 1-10.8 0L10 6V2z" ` +
    `fill="${color}" stroke="${OUTLINE}" stroke-width="1.4" stroke-linejoin="round"/>` +
    // 마개와 목 — 유리색으로 따로 얹어 '병'으로 읽히게
    `<rect x="9.2" y="1.2" width="5.6" height="2.6" rx="0.8" fill="${GLASS}"/>` +
    // 하이라이트 한 줄 — 단색 덩어리로 보이지 않게
    `<path d="M9.6 13.5a4.6 4.6 0 0 1 2.2-3.1" fill="none" stroke="rgba(255,255,255,0.5)" ` +
    `stroke-width="1.3" stroke-linecap="round"/>`
  );
}

/** 뼈다귀 고기 — 살점 덩어리를 뼈가 관통한다.
 *  그리는 순서가 중요하다: 대를 먼저 깔고 살점을 얹은 뒤 마디를 맨 위에 찍는다.
 *  살점을 뼈보다 크게 그리면 대가 통째로 묻혀 "점 두 개 붙은 덩어리"가 된다 */
function meat(color: string): string {
  return (
    // 뼈 대 — 살점 밖으로 양끝이 드러나야 뼈다귀로 읽힌다
    `<path d="M4.8 19.2L19.2 4.8" stroke="${BONE}" stroke-width="3" ` +
    `stroke-linecap="round" opacity="0.95"/>` +
    // 살점 — 대를 다 덮지 않을 만큼만
    `<ellipse cx="12" cy="12" rx="5.4" ry="4.2" transform="rotate(-45 12 12)" ` +
    `fill="${color}" stroke="${OUTLINE}" stroke-width="1.3"/>` +
    `<path d="M9.8 13.2a2.8 2.8 0 0 1 1.6-2.4" fill="none" stroke="rgba(255,255,255,0.45)" ` +
    `stroke-width="1.3" stroke-linecap="round"/>` +
    // 마디 — 맨 위에 찍어 뼈 끝을 확실히 굵게
    `<g fill="${BONE}" stroke="${OUTLINE}" stroke-width="1">` +
    `<circle cx="19.6" cy="4.4" r="2.6"/>` +
    `<circle cx="4.4" cy="19.6" r="2.6"/>` +
    `</g>`
  );
}

const SHAPES: Record<string, (color: string) => string> = { flask, meat };

/** 아이콘 SVG 문자열. 모르는 icon 이름이면 색 네모로 물러난다 (없는 것보다 낫다) */
/** 각인 팔면체 — 가방·전리품 공용 (색은 그 각인의 색) */
function octahedronSvg(color: string, size: number): string {
  const body =
    `<path d="M12 2L19 12L12 22L5 12Z" fill="${color}" stroke="${OUTLINE}" stroke-width="1.4" stroke-linejoin="round"/>` +
    `<path d="M5 12H19M12 2V22" stroke="rgba(0,0,0,0.35)" stroke-width="1"/>`;
  return (
    `<svg viewBox="0 0 24 24" width="${size}" height="${size}" ` +
    `style="display:block;filter:drop-shadow(0 0 4px ${color});">${body}</svg>`
  );
}

/** 각인 아이콘 (가방 칸) — sigilId 의 색 팔면체 */
export function sigilIconSvg(sigilId: string, size: number): string {
  return octahedronSvg(`#${sigilColor(sigilId).toString(16).padStart(6, '0')}`, size);
}
export function sigilIcon(sigilId: string, size: number): HTMLSpanElement {
  const span = document.createElement('span');
  span.style.cssText = 'display:block;line-height:0;';
  span.innerHTML = sigilIconSvg(sigilId, size);
  return span;
}

/** 장비 아이콘 — 부위별 실루엣, 색은 그 장비의 색 (2026-09-04) */
export function equipIconSvg(equipId: string, size: number): string {
  const def = equipDef(equipId);
  const c = def.color;
  let body: string;
  switch (def.slot) {
    case 'head':
      body = `<path d="M5 14A7 7 0 0 1 19 14V17H5Z" fill="${c}" stroke="${OUTLINE}" stroke-width="1.4"/><path d="M4 17H20V19.5H4Z" fill="${c}" stroke="${OUTLINE}" stroke-width="1.2"/>`;
      break;
    case 'body':
      body = `<path d="M8 4L12 6L16 4L20 7L18 10L17 20H7L6 10L4 7Z" fill="${c}" stroke="${OUTLINE}" stroke-width="1.4" stroke-linejoin="round"/>`;
      break;
    case 'feet':
      body = `<path d="M7 4H13V12L19 15V19H5V4Z" fill="${c}" stroke="${OUTLINE}" stroke-width="1.4" stroke-linejoin="round"/>`;
      break;
    case 'ring':
      body = `<circle cx="12" cy="14" r="6" fill="none" stroke="${c}" stroke-width="3"/><path d="M9 6L12 3L15 6L12 9Z" fill="${c}" stroke="${OUTLINE}" stroke-width="1"/>`;
      break;
    case 'neck':
      body = `<path d="M5 4Q12 16 19 4" fill="none" stroke="${c}" stroke-width="1.8"/><path d="M9 14L12 11L15 14L12 20Z" fill="${c}" stroke="${OUTLINE}" stroke-width="1.2"/>`;
      break;
    default:
      body = def.packKind === 'belt'
        ? `<rect x="3" y="10" width="18" height="5" fill="${c}" stroke="${OUTLINE}" stroke-width="1.2"/><rect x="9.5" y="8.5" width="5" height="8" fill="none" stroke="#e8c76a" stroke-width="1.4"/>`
        : `<path d="M5 9H19V20H5Z" fill="${c}" stroke="${OUTLINE}" stroke-width="1.4"/><path d="M5 9L7 5H17L19 9Z" fill="${c}" stroke="${OUTLINE}" stroke-width="1.2"/><path d="M9 13H15" stroke="${OUTLINE}" stroke-width="1.2"/>`;
  }
  return (
    `<svg viewBox="0 0 24 24" width="${size}" height="${size}" ` +
    `style="display:block;filter:drop-shadow(0 0 4px ${c});">${body}</svg>`
  );
}
export function equipIcon(equipId: string, size: number): HTMLSpanElement {
  const span = document.createElement('span');
  span.style.cssText = 'display:block;line-height:0;';
  span.innerHTML = equipIconSvg(equipId, size);
  return span;
}

export function itemIconSvg(kind: ItemKind, size: number): string {
  const def = itemDef(kind);
  if (kind === 'sigil') return octahedronSvg(def.color, size); // 어느 각인인지 모를 때의 폴백 색
  if (kind === 'equip') return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" style="display:block;"><rect x="5" y="6" width="14" height="12" fill="${def.color}" stroke="${OUTLINE}" stroke-width="1.4"/></svg>`;
  const shape = SHAPES[def.icon];
  const body = shape
    ? shape(def.color)
    : `<rect x="4" y="4" width="16" height="16" fill="${def.color}"/>`;
  return (
    `<svg viewBox="0 0 24 24" width="${size}" height="${size}" ` +
    `style="display:block;filter:drop-shadow(0 0 4px ${def.color});">${body}</svg>`
  );
}

/** 아이콘을 담은 span — 붙이는 쪽에서 위치만 잡으면 된다 */
export function itemIcon(kind: ItemKind, size: number): HTMLSpanElement {
  const span = document.createElement('span');
  span.style.cssText = 'display:block;line-height:0;';
  span.innerHTML = itemIconSvg(kind, size);
  return span;
}

/** 골드 — 바닥 골드 더미(Stage GOLD_COLOR)와 같은 색 */
const GOLD = '#ffcc3a';
const ARROW_WOOD = '#d8d0b8';

/** 전리품 줄 아이콘 — 소모품은 가방 아이콘 그대로, 골드는 ◆, 화살은 대·촉·깃, 각인은 그 각인 색 팔면체 */
export function lootIconSvg(entry: LootEntry, size: number): string {
  if (entry.kind === 'potion' || entry.kind === 'mana' || entry.kind === 'food') return itemIconSvg(entry.kind, size);
  let body: string;
  let glow: string;
  if (entry.kind === 'gold') {
    glow = GOLD;
    body =
      `<path d="M12 2.5L21 12L12 21.5L3 12Z" fill="${GOLD}" stroke="${OUTLINE}" stroke-width="1.4" stroke-linejoin="round"/>` +
      `<path d="M8.5 12L12 6.5L15.5 12" fill="none" stroke="rgba(255,255,255,0.55)" stroke-width="1.3" stroke-linecap="round"/>`;
  } else if (entry.kind === 'arrow') {
    glow = ARROW_WOOD;
    body =
      `<path d="M5 19L18 6" stroke="${ARROW_WOOD}" stroke-width="2.2" stroke-linecap="round"/>` +
      `<path d="M15.2 4.2L20 4L19.8 8.8Z" fill="#9a9aa4" stroke="${OUTLINE}" stroke-width="1"/>` +
      `<path d="M5.5 15.5L3.5 17.5M8.5 18.5L6.5 20.5" stroke="#e8ddc0" stroke-width="1.6" stroke-linecap="round"/>`;
  } else if (entry.kind === 'equip') {
    return entry.equipId ? equipIconSvg(entry.equipId, size) : itemIconSvg('equip', size);
  } else {
    return entry.sigilId ? sigilIconSvg(entry.sigilId, size) : itemIconSvg('sigil', size);
  }
  return (
    `<svg viewBox="0 0 24 24" width="${size}" height="${size}" ` +
    `style="display:block;filter:drop-shadow(0 0 4px ${glow});">${body}</svg>`
  );
}
