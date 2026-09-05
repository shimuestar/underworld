// I 창 — 소모품 퀵슬롯 + 가방. DOM 오버레이. 스킬은 Tab 창(SkillUI)이 따로 맡는다 —
// 스킬은 아이템이 아니라 리스트라 가방에 들어가지 않는다.
// 열려 있는 동안 시뮬레이션은 main이 일시정지한다.
//
// 조작 규약 하나로 통일한다: 가방 칸을 왼쪽 클릭하면 골라지고, 그 상태에서
// 퀵슬롯을 누르면 등록된다 (창 안에서는 숫자 키도 같은 뜻). 고른 것 없이 퀵슬롯을
// 누르면 등록이 풀리고, 가방 칸을 오른쪽 클릭하면 그 칸을 통째로 바닥에 버린다.
// 버리기가 없으면 가방이 가득 찼을 때 빠져나갈 길이 없다.

import {
  bindQuickslot,
  countOf,
  isUseful,
  itemDef,
  dropSlot,
  unbindQuickslot,
} from '../core/Inventory';
import { balance } from '../core/Balance';
import { itemIcon } from './ItemIcons';
import { attachPopup, consumablePopup } from './ItemPopup';
import type { ItemKind, World } from '../core/World';

const CELL_PX = 64;
const GAP_PX = 8;
const CELL = `width:${CELL_PX}px;height:${CELL_PX}px;box-sizing:border-box;position:relative;`;
/** 칸(64px) 안에서 숫자·번호와 부딪히지 않는 크기 */
const ICON_PX = 28;
/** 두 열 사이 간격 — 가방 5×4 격자(352px) | 퀵슬롯 십자(208px) */
const COLUMN_GAP_PX = 28;
/** 창 폭 고정 — 안내 문장 길이에 따라 창이 늘고 줄지 않게 (LootUI 와 같은 규약). 352 + 28 + 208 + 여백 26×2 */
const PANEL_PX = 640;
/** 퀵슬롯 십자 — HUD 마름모 넷과 같은 자리(위 1·오른쪽 2·아래 3·왼쪽 4, 시계 방향). grid-area 'row / col' */
const CROSS_AREAS = ['1 / 2', '2 / 3', '3 / 2', '2 / 1'];

export class InventoryUI {
  private readonly root: HTMLDivElement;
  open = false;
  /** 퀵슬롯에 꽂으려고 골라 둔 가방 칸 (-1 = 없음) */
  private picked = -1;
  /** 마우스가 얹힌 가방 칸 / 퀵슬롯 칸 (-1 = 없음) — 설명 팝업이 여기 붙는다. 없으면 고른 칸에 */
  private hover = -1;
  private hoverQ = -1;
  /** 보관 주머니 내려놓기 — P 키·패드 Y·버튼. main 이 Loot.createPlayerPouch 로 잇는다 */
  onPlacePouch: (() => void) | null = null;

  constructor(private readonly world: World) {
    this.root = document.createElement('div');
    this.root.id = 'sigilui';
    this.root.style.cssText =
      'position:fixed;inset:0;display:none;align-items:center;justify-content:center;' +
      'background:rgba(0,0,0,0.72);color:#cfd2da;font:13px/1.6 monospace;user-select:none;z-index:10;';
    document.body.appendChild(this.root);

    // 창 안에서 숫자 키 — 고른 게 있으면 그 칸에 꽂고, 없으면 그냥 쓴다는 뜻은 아니다
    // (전투 키와 헷갈리지 않게, 창이 열려 있을 때는 등록 전용이다)
    window.addEventListener('keydown', (e) => {
      if (!this.open) return;
      if (e.code === 'KeyP') {
        // 보관 주머니 — 빈 주머니를 발밑에 내려놓고 루팅 창으로 넘어간다 (main 이 잇는다)
        e.preventDefault();
        this.onPlacePouch?.();
        return;
      }
      const digit = Number.parseInt(e.code.replace('Digit', ''), 10);
      if (!e.code.startsWith('Digit') || Number.isNaN(digit)) return;
      const index = digit - 1;
      if (index < 0 || index >= this.world.quickslots.length) return;
      e.preventDefault();
      this.assign(index);
    });
  }

  show(): void {
    this.open = true;
    this.picked = -1;
    this.hover = -1;
    this.hoverQ = -1;
    this.root.style.display = 'flex';
    this.rebuild();
  }

  hide(): void {
    this.open = false;
    this.picked = -1;
    this.hover = -1;
    this.hoverQ = -1;
    this.root.style.display = 'none';
  }

  toggle(): boolean {
    if (this.open) this.hide();
    else this.show();
    return this.open;
  }

  /** 골라 둔 가방 칸을 퀵슬롯 index 에 꽂는다. 고른 게 없으면 등록 해제 */
  private assign(index: number): void {
    const slot = this.picked >= 0 ? this.world.inventory[this.picked] : null;
    if (slot) bindQuickslot(this.world, index, slot.kind);
    else unbindQuickslot(this.world, index);
    this.picked = -1;
    this.rebuild();
  }

  private rebuild(): void {
    const world = this.world;
    const panel = document.createElement('div');
    panel.style.cssText =
      `background:#15151b;border:1px solid #3a3a44;padding:20px 26px;width:${PANEL_PX}px;box-sizing:border-box;`;

    // 머리줄 — 창 이름과, 가방을 안 거치는 자원(골드·화살)을 한눈에 (루팅 창의 가방 열과 같은 표기)
    const head = document.createElement('div');
    head.style.cssText = 'display:flex;justify-content:space-between;align-items:baseline;margin-bottom:12px;';
    const title = document.createElement('div');
    title.textContent = '가방';
    title.style.cssText = 'color:#e8c76a;font-size:15px;';
    const counters = document.createElement('div');
    counters.style.cssText = 'color:#cfd2da;display:flex;gap:18px;';
    const gold = document.createElement('span');
    gold.textContent = `◆ ${world.gold}`;
    gold.style.color = '#e8c76a';
    const arrows = document.createElement('span');
    arrows.textContent = `화살 ${world.weapon.arrows ?? 0}/${balance.weapons.bow.ammoMax}`;
    counters.append(gold, arrows);
    head.append(title, counters);
    panel.appendChild(head);

    // 본문 — 왼쪽 가방 격자(5×4), 오른쪽 퀵슬롯 십자. 가방이 넷 줄이 되며(2026-09-04) 위아래로 쌓던 배치를 옆으로 눕혔다
    const columns = document.createElement('div');
    columns.style.cssText = `display:flex;gap:${COLUMN_GAP_PX}px;align-items:flex-start;`;
    columns.appendChild(this.buildBag());
    columns.appendChild(this.buildQuickslots());
    panel.appendChild(columns);

    // 보관 주머니 — 가방을 비워 두고 싶을 때. 넣어 둔 것은 층을 오가도·죽어도 그 자리에 남는다
    const stash = document.createElement('button');
    stash.textContent = '주머니 내려놓기 (P / 패드 Y) — 여기에 아이템을 보관한다';
    stash.style.cssText =
      'margin-top:16px;padding:6px 14px;border:1px solid #3a3a44;background:#1b1b22;color:#cfd2da;cursor:pointer;font:inherit;';
    stash.onclick = () => this.onPlacePouch?.();
    panel.appendChild(stash);

    const hint = document.createElement('div');
    hint.textContent =
      `가방 칸 클릭 = 고르기 → 퀵슬롯 클릭(또는 1~${this.world.quickslots.length}) = 등록   ·   ` +
      '빈손으로 퀵슬롯 클릭 = 등록 해제   ·   가방 칸 우클릭 = 버리기   ·   P 주머니 내려놓기   ·   I 닫기   ·   스킬은 Tab';
    hint.style.cssText = 'margin-top:14px;color:#6c7280;font-size:11px;line-height:1.7;white-space:normal;';
    panel.appendChild(hint);

    this.root.replaceChildren(panel);
  }

  // ---- 퀵슬롯 ----
  /** HUD 마름모 넷과 같은 십자 배치(위 1·오른쪽 2·아래 3·왼쪽 4). 칸 수가 넷이 아니면 한 줄로 늘어놓는다 */
  private buildQuickslots(): HTMLElement {
    const world = this.world;
    const box = document.createElement('div');
    box.style.cssText = `width:${CELL_PX * 3 + GAP_PX * 2}px;flex:none;`;

    const title = document.createElement('div');
    title.textContent = `퀵슬롯 — 전투 중 1~${world.quickslots.length}`;
    title.style.cssText = 'color:#e8c76a;margin-bottom:6px;';
    box.appendChild(title);

    const cross = world.quickslots.length === CROSS_AREAS.length;
    const grid = document.createElement('div');
    grid.style.cssText = cross
      ? `display:grid;grid-template-columns:repeat(3, ${CELL_PX}px);grid-template-rows:repeat(3, ${CELL_PX}px);gap:${GAP_PX}px;`
      : `display:flex;flex-wrap:wrap;gap:${GAP_PX}px;`;
    if (cross) {
      // 십자의 중심 — 고른 것이 있으면 "어디에 꽂을까"를 여기서 말한다
      const center = document.createElement('div');
      center.style.cssText =
        'grid-area:2 / 2;display:flex;align-items:center;justify-content:center;text-align:center;' +
        `font-size:10px;line-height:1.5;white-space:pre;color:${this.picked >= 0 ? '#e8c76a' : '#555c66'};`;
      center.textContent = this.picked >= 0 ? '칸을 눌러\n등록' : '1~4';
      grid.appendChild(center);
    }
    world.quickslots.forEach((kind, i) => {
      const cell = document.createElement('div');
      const armed = this.picked >= 0;
      cell.style.cssText =
        CELL +
        (cross ? `grid-area:${CROSS_AREAS[i]};` : '') +
        `border:1px solid ${armed ? '#e8c76a' : '#3a3a44'};` +
        `background:${kind ? 'rgba(232,199,106,0.07)' : 'rgba(255,255,255,0.02)'};cursor:pointer;`;

      const key = document.createElement('div');
      key.textContent = String(i + 1);
      key.style.cssText =
        'position:absolute;top:2px;left:5px;font-size:10px;color:#8a8f9a;';
      cell.appendChild(key);

      if (kind) {
        const def = itemDef(kind);
        const count = countOf(world, kind);
        const icon = itemIcon(kind, ICON_PX);
        icon.style.cssText +=
          `position:absolute;left:50%;top:24px;transform:translate(-50%,-50%);` +
          `opacity:${count > 0 ? 1 : 0.25};`;
        cell.appendChild(icon);
        const name = document.createElement('div');
        name.textContent = `${def.name.slice(0, 2)} ${count}`;
        name.style.cssText =
          `position:absolute;bottom:3px;width:100%;text-align:center;font-size:10px;` +
          `color:${count > 0 ? '#cfd2da' : '#555c66'};`;
        cell.appendChild(name);
      }

      cell.onclick = () => this.assign(i);
      cell.onmousemove = (ev) => {
        if ((ev.movementX === 0 && ev.movementY === 0) || this.hoverQ === i) return; // 유령 이동은 무시 (LootUI 규약)
        this.hoverQ = i;
        this.hover = -1;
        this.rebuild();
      };
      if (kind && this.hoverQ === i) {
        // 십자는 창의 오른쪽 — 칸 왼쪽에 띄운다
        attachPopup(cell, consumablePopup(world, kind, countOf(world, kind), '', `퀵슬롯 ${i + 1} — 전투 중 ${i + 1} 키로 쓴다`), 'left');
      }
      grid.appendChild(cell);
    });
    grid.onmouseleave = () => {
      if (this.hoverQ < 0) return;
      this.hoverQ = -1;
      this.rebuild();
    };
    box.appendChild(grid);
    return box;
  }

  // ---- 가방 ----
  private buildBag(): HTMLElement {
    const world = this.world;
    const cfg = balance.items;
    const box = document.createElement('div');
    box.style.cssText = 'flex:none;';

    const used = world.inventory.filter((s) => s !== null).length;
    const full = used >= world.inventory.length;
    const title = document.createElement('div');
    title.textContent = `가방 ${used}/${world.inventory.length}칸${full ? '  — 가득 찼다. 바닥의 아이템을 집을 수 없다' : ''}`;
    title.style.cssText = `color:${full ? '#e0455a' : '#7fbfff'};margin-bottom:6px;`;
    box.appendChild(title);

    const grid = document.createElement('div');
    grid.style.cssText = `display:grid;grid-template-columns:repeat(${cfg.cols}, ${CELL_PX}px);gap:${GAP_PX}px;`;
    world.inventory.forEach((slot, i) => {
      const cell = document.createElement('div');
      const here = i === this.picked;
      cell.style.cssText =
        CELL +
        `border:1px solid ${here ? '#e8c76a' : '#3a3a44'};` +
        `background:${here ? 'rgba(232,199,106,0.12)' : 'rgba(255,255,255,0.02)'};` +
        `cursor:${slot ? 'pointer' : 'default'};`;

      if (slot) {
        const icon = itemIcon(slot.kind, ICON_PX);
        icon.style.cssText +=
          'position:absolute;left:50%;top:24px;transform:translate(-50%,-50%);';
        cell.appendChild(icon);

        const count = document.createElement('div');
        count.textContent = `×${slot.count}`;
        count.style.cssText =
          'position:absolute;bottom:3px;right:5px;font-size:11px;color:#cfd2da;';
        cell.appendChild(count);

        // 지금 써도 값어치가 없으면 흐리게 — "마셔도 안 나가는" 이유를 미리 보여 준다
        if (!isUseful(world, slot.kind)) cell.style.opacity = '0.45';

        const bound = world.quickslots.indexOf(slot.kind);
        if (bound >= 0) {
          const tag = document.createElement('div');
          tag.textContent = String(bound + 1);
          tag.style.cssText =
            'position:absolute;top:2px;left:5px;font-size:10px;color:#e8c76a;';
          cell.appendChild(tag);
        }

        // 설명 팝업 — 마우스가 얹힌 칸, 없으면 고른 칸. 가방은 창의 왼쪽이라 칸 오른쪽에 띄운다
        const showPopup = this.hover === i || (this.hover < 0 && this.hoverQ < 0 && this.picked === i);
        if (showPopup) {
          attachPopup(
            cell,
            consumablePopup(world, slot.kind, slot.count, '', '좌클릭 고르기 → 퀵슬롯 클릭(또는 1~4) 등록 · 우클릭 버리기'),
            'right',
          );
        }
        cell.onclick = () => {
          this.picked = this.picked === i ? -1 : i;
          this.rebuild();
        };
        cell.oncontextmenu = (e) => {
          e.preventDefault();
          dropSlot(world, i);
          this.picked = -1;
          this.rebuild();
        };
      }
      cell.onmousemove = (ev) => {
        if ((ev.movementX === 0 && ev.movementY === 0) || this.hover === i) return; // 유령 이동은 무시 (LootUI 규약)
        this.hover = i;
        this.hoverQ = -1;
        this.rebuild();
      };
      grid.appendChild(cell);
    });
    grid.onmouseleave = () => {
      if (this.hover < 0) return;
      this.hover = -1;
      this.rebuild();
    };
    box.appendChild(grid);
    return box;
  }

  // ---- 각인 ----
}

/** 퀵슬롯에 든 종류 — HUD 바가 읽는다 */
export function quickslotView(world: World): {
  kind: ItemKind | null;
  name: string;
  color: string;
  count: number;
  useful: boolean;
}[] {
  return world.quickslots.map((kind) => {
    if (!kind) return { kind: null, name: '', color: '#3a3a44', count: 0, useful: false };
    const def = itemDef(kind);
    return {
      kind,
      name: def.name,
      color: def.color,
      count: countOf(world, kind),
      useful: isUseful(world, kind),
    };
  });
}
