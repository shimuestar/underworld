// 소모품 아이콘 — 인라인 SVG. 에셋을 쓰지 않는다는 규약(CLAUDE.md §6)을 지키면서
// 색칠한 네모보다 알아보기 쉽게, 도형만으로 실루엣을 그린다.
//
// 모양은 바닥에 떨어진 3D 모형을 그대로 옮겼다 — 약병은 목 달린 병, 음식은 뼈다귀
// 고기. 미니맵 색이 실물과 같아야 한다는 규약과 같은 이유다: 주워 온 그것이
// 칸 안에 그대로 있어야 "이게 뭐였지"가 안 생긴다.

import { itemDef } from '../core/Inventory';
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
export function itemIconSvg(kind: ItemKind, size: number): string {
  const def = itemDef(kind);
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
  } else {
    const c = `#${sigilColor(entry.sigilId ?? '').toString(16).padStart(6, '0')}`;
    glow = c;
    body =
      `<path d="M12 2L19 12L12 22L5 12Z" fill="${c}" stroke="${OUTLINE}" stroke-width="1.4" stroke-linejoin="round"/>` +
      `<path d="M5 12H19M12 2V22" stroke="rgba(0,0,0,0.35)" stroke-width="1"/>`;
  }
  return (
    `<svg viewBox="0 0 24 24" width="${size}" height="${size}" ` +
    `style="display:block;filter:drop-shadow(0 0 4px ${glow});">${body}</svg>`
  );
}
