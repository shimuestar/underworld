// 아이템 설명 팝업 — 루팅 창·가방 창에서 커서(또는 마우스) 아래 칸 '옆'에 붙는다.
// 칸이 창의 왼쪽에 있으면 오른쪽에, 오른쪽에 있으면 왼쪽에 띄운다 (2026-09-04 사용자 지시 — 하단 설명줄을 대체).
// DOM 만 만든다 — 무엇을 설명할지(효과·유용성·가방 수)는 Inventory 의 규칙을 그대로 읽는다.

import { balance } from '../core/Balance';
import { equipDef, describeEffect, slotLabel, slotsFor, type EquipSlot } from '../core/EquipData';
import { countOf, isUseful, itemDef } from '../core/Inventory';
import { sigilDef, isActiveSkill } from '../core/SigilData';
import type { ItemKind, LootEntry, World } from '../core/World';

export interface PopupContent {
  title: string;
  lines: string[];
  /** 지금 쓸 값어치 — 있으면 초록, 없으면 회색으로 칠한다 (없으면 줄 자체를 생략) */
  useful?: boolean;
  usefulText?: string;
  /** 맨 아래 조작 안내 (작고 흐리게) */
  note?: string;
  /** 조작 줄 — 한 줄에 하나씩 위에서 아래로 ("가져오기" 아래 "버리기"). 키캡은 패드면 원형 */
  actions?: { key: string; label: string }[];
}
export type PopupSide = 'left' | 'right';

const POPUP_W = 250;
const GAP_PX = 10;

/** 소모품 설명 — 효과·가방 수·유용성. where 는 제목 뒤 꼬리(' (내 가방)' 등) */
export function consumablePopup(world: World, kind: ItemKind, count: number, where = '', note?: string): PopupContent {
  const def = itemDef(kind);
  const lines: string[] = [];
  if (def.heal > 0) lines.push(`체력 +${def.heal}`);
  if (def.restore > 0) lines.push(`마나 +${def.restore}`);
  if (def.regen) {
    const total = Math.round(def.regen.healPerTick * def.regen.durationTicks);
    lines.push(`${Math.round(def.regen.durationTicks / 60)}초 지속 회복 (총 +${total})`);
    lines.push(`스태미너 회복 ×${def.regen.staminaRegenMul}`);
  }
  lines.push(`가방에 ${countOf(world, kind)}개`);
  const useful = isUseful(world, kind);
  return {
    title: `${def.name} ×${count}${where}`,
    lines,
    useful,
    usefulText: useful ? '지금 쓸 값어치 있음' : '지금은 가득 — 쓸 값어치 없음',
    note,
  };
}

/** 컨테이너(주머니·상자) 항목 설명 — 아직 모르는 칸은 그렇다고만 말한다 */
export function lootEntryPopup(world: World, e: LootEntry): PopupContent {
  if (!e.searched) return { title: '아직 모른다', lines: ['뒤지는 중…', '밝혀진 칸만 가져갈 수 있다'] };
  if (e.kind === 'gold') {
    return { title: `골드 ×${e.count}`, lines: ['제단 상점에서 체력·마나·탄약·수류탄·배터리를 산다', `소지 ◆ ${world.gold}`] };
  }
  if (e.kind === 'arrow') {
    const have = world.weapon.arrows ?? 0;
    const max = balance.weapons.bow.ammoMax;
    return {
      title: `화살 ×${e.count}`,
      lines: ['활 탄약', `화살통 ${have}/${max}`],
      useful: have < max,
      usefulText: have < max ? '화살통에 들어간다' : '가득 — 들어갈 자리가 없다',
    };
  }
  if (e.kind === 'sigil') {
    if (!e.sigilId) return { title: '각인', lines: [] };
    const c = sigilPopup(world, e.sigilId);
    c.note = '가져가면 가방에 들어간다 — 스킬 탭에서 새긴다';
    return c;
  }
  if (e.kind === 'equip') {
    if (!e.equipId) return { title: '장비', lines: [] };
    const c = equipPopup(world, e.equipId);
    c.note = '가져가면 가방에 들어간다 — 가방 탭에서 걸친다';
    return c;
  }
  return consumablePopup(world, e.kind as ItemKind, e.count);
}

/** 장비 설명 — 부위·효과·지금 걸친 것과 비교 (2026-09-04) */
export function equipPopup(world: World, equipId: string, where = '', at?: EquipSlot): PopupContent {
  const def = equipDef(equipId);
  const lines: string[] = [def.desc];
  for (const [k, v] of Object.entries(def.effects)) lines.push(describeEffect(k, v));
  // at = 이미 걸친 칸(인형 팝업). 없으면 걸칠 칸 — 빈 칸 먼저, 다 차 있으면 첫 칸과 맞바꾼다
  const target = at ?? slotsFor(def.slot).find((s) => world.equipment[s] === null) ?? slotsFor(def.slot)[0]!;
  const worn = at ? null : world.equipment[target];
  if (worn) lines.push(`지금 ${slotLabel(target)}: ${equipDef(worn).name} — 걸치면 맞바꾼다`);
  return {
    title: `${def.name} (${slotLabel(target)})${where}`,
    lines,
    useful: true,
    usefulText: worn ? `${equipDef(worn).name} 과 바꿔 걸친다` : `${slotLabel(target)} 칸이 비어 있다 — 바로 걸친다`,
  };
}

const PART_LABEL: Record<string, string> = { eye: '눈', rightArm: '오른팔', leftArm: '왼팔', heart: '심장', spine: '척추' };

/** 각인 설명 — 효과·종류(패시브 부위/액티브)·오염·지금 새길 수 있는가 (2026-09-04 아이템화) */
export function sigilPopup(world: World, sigilId: string, where = ''): PopupContent {
  const def = sigilDef(sigilId);
  const active = isActiveSkill(def);
  const lines: string[] = def.desc ? [def.desc] : [];
  lines.push(active ? '액티브 — 익히면 스킬 칸(Z·X·C·V)에 오른다' : `패시브 — ${PART_LABEL[def.slot] ?? def.slot}에 새긴다`);
  lines.push(`새길 때 오염 +${(balance.corruption.slotCost as Record<string, number>)[def.slot] ?? 0}`);
  const known = world.sigils.inventory.includes(sigilId);
  const partFull = !active && world.sigils.equipped[def.slot] !== null;
  const sell = (balance.sigil.sellGold as Record<string, number>)[def.tier] ?? 0;
  return {
    title: `${def.name} (각인)${where}`,
    lines,
    useful: !known && !partFull,
    usefulText: known
      ? `이미 익힌 각인 — 제단에서 ◆ ${sell} 에 판다`
      : partFull
        ? `${PART_LABEL[def.slot] ?? def.slot}이 차 있다 — 제단에서 떼고 새긴다`
        : '지금 새길 수 있다',
  };
}

/** 키캡 글리프 — 패드는 콘솔 버튼처럼 원형, 키보드는 사각 키캡 (HUD 중앙 키캡·바닥 선 끝 키캡과 같은 결) */
export function keycap(label: string, round: boolean): HTMLSpanElement {
  const k = document.createElement('span');
  k.textContent = label;
  // 패드: 한 글자(A/B/X/Y)는 원, 두 글자 이상('X 길게'·'◂▸')은 같은 높이의 알약 — 지름 고정 원에 넣으면 넘쳐 옆 글자와 겹쳤다
  const pill = round && label.length > 1;
  k.style.cssText = round
    ? `display:inline-block;${pill ? 'min-width:18px;padding:0 7px;' : 'width:18px;'}height:18px;border:1px solid rgba(216,224,234,0.7);` +
      `border-radius:${pill ? '9px' : '50%'};font-weight:bold;color:#e8ecf2;line-height:16px;text-align:center;margin-right:6px;` +
      'box-sizing:border-box;flex:none;white-space:nowrap;'
    : 'display:inline-block;min-width:14px;padding:0 5px;border:1px solid rgba(216,224,234,0.65);border-bottom-width:3px;' +
      'border-radius:4px;font-weight:bold;color:#e8ecf2;line-height:15px;text-align:center;margin-right:6px;flex:none;white-space:nowrap;';
  return k;
}

/** 칸 옆에 팝업을 붙인다 — 칸은 position:relative 여야 한다. 세로는 칸 가운데에 맞춘다.
 *  조작 안내(actions)도 팝업 안에 넣는다 — 칸 아래 따로 붙이던 배지는 팝업에 가려졌다 (2026-09-04) */
export function attachPopup(cell: HTMLElement, content: PopupContent, side: PopupSide, padGlyph = false): void {
  const box = document.createElement('div');
  box.dataset['popup'] = '1';
  const anchor = side === 'right' ? `left:calc(100% + ${GAP_PX}px);` : `right:calc(100% + ${GAP_PX}px);`;
  box.style.cssText =
    `position:absolute;top:50%;transform:translateY(-50%);${anchor}width:${POPUP_W}px;box-sizing:border-box;` +
    'padding:8px 11px;background:rgba(12,14,18,0.96);border:1px solid #3a3a44;border-radius:6px;' +
    'font:12px/1.55 monospace;color:#cfd2da;text-align:left;white-space:normal;overflow-wrap:anywhere;' +
    'box-shadow:0 4px 14px rgba(0,0,0,0.5);z-index:3;pointer-events:none;';
  const title = document.createElement('div');
  title.textContent = content.title;
  title.style.cssText = 'color:#e8c76a;font-size:13px;margin-bottom:4px;';
  box.appendChild(title);
  for (const line of content.lines) {
    const el = document.createElement('div');
    el.textContent = line;
    box.appendChild(el);
  }
  if (content.usefulText) {
    const el = document.createElement('div');
    el.textContent = content.usefulText;
    el.style.cssText = `margin-top:4px;color:${content.useful ? '#7fd27f' : '#8a8f9a'};`;
    box.appendChild(el);
  }
  if (content.note) {
    const el = document.createElement('div');
    el.textContent = content.note;
    el.style.cssText = 'margin-top:5px;padding-top:5px;border-top:1px solid #23232b;color:#8a8f9a;font-size:11px;';
    box.appendChild(el);
  }
  if (content.actions && content.actions.length > 0) {
    const list = document.createElement('div');
    list.style.cssText = 'margin-top:6px;padding-top:6px;border-top:1px solid #23232b;display:flex;flex-direction:column;gap:3px;font-size:11px;color:#cfd2da;';
    for (const a of content.actions) {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;white-space:nowrap;';
      row.appendChild(keycap(a.key, padGlyph));
      row.appendChild(document.createTextNode(a.label));
      list.appendChild(row);
    }
    box.appendChild(list);
  }
  // 팝업이 붙은 칸은 이웃 칸 위로 떠야 한다
  cell.style.zIndex = '3';
  cell.appendChild(box);
}
