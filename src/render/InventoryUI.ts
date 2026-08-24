// Tab 창 — 퀵슬롯 + 소모품 가방 + 각인. DOM 오버레이.
// 열려 있는 동안 시뮬레이션은 main이 일시정지한다.
//
// 조작 규약 하나로 통일한다: 가방 칸을 왼쪽 클릭하면 골라지고, 그 상태에서
// 퀵슬롯을 누르면 등록된다 (창 안에서는 1~5 키도 같은 뜻). 고른 것 없이 퀵슬롯을
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
import { sigilDef, SIGIL_SLOTS, type SigilSlot } from '../core/SigilData';
import type { ItemKind, World } from '../core/World';
import * as Sigils from '../systems/Sigils';

const SLOT_LABELS: Record<SigilSlot, string> = {
  eye: '눈',
  rightArm: '오른팔',
  leftArm: '왼팔',
  heart: '심장',
  spine: '척추',
};

/** 각인 색 견본 — 바닥에 떨어진 팔면체와 같은 색이라 주운 것과 목록이 이어진다 */
function swatch(color: string): HTMLElement {
  const dot = document.createElement('span');
  dot.style.cssText =
    `display:inline-block;width:9px;height:9px;margin-right:7px;` +
    `background:${color};box-shadow:0 0 6px ${color};vertical-align:baseline;`;
  return dot;
}

const CELL = 'width:64px;height:64px;box-sizing:border-box;position:relative;';

export class InventoryUI {
  private readonly root: HTMLDivElement;
  open = false;
  /** 제단에서 열렸는가 — 각인 해제(교체)는 제단에서만 가능 */
  private altarMode = false;
  /** 퀵슬롯에 꽂으려고 골라 둔 가방 칸 (-1 = 없음) */
  private picked = -1;

  constructor(private readonly world: World) {
    this.root = document.createElement('div');
    this.root.id = 'sigilui';
    this.root.style.cssText =
      'position:fixed;inset:0;display:none;align-items:center;justify-content:center;' +
      'background:rgba(0,0,0,0.72);color:#cfd2da;font:13px/1.6 monospace;user-select:none;z-index:10;';
    document.body.appendChild(this.root);

    // 창 안에서 1~5 — 고른 게 있으면 그 칸에 꽂고, 없으면 그냥 쓴다는 뜻은 아니다
    // (전투 키와 헷갈리지 않게, 창이 열려 있을 때는 등록 전용이다)
    window.addEventListener('keydown', (e) => {
      if (!this.open) return;
      const digit = Number.parseInt(e.code.replace('Digit', ''), 10);
      if (!e.code.startsWith('Digit') || Number.isNaN(digit)) return;
      const index = digit - 1;
      if (index < 0 || index >= this.world.quickslots.length) return;
      e.preventDefault();
      this.assign(index);
    });
  }

  show(altarMode: boolean): void {
    this.altarMode = altarMode;
    this.open = true;
    this.picked = -1;
    this.root.style.display = 'flex';
    this.rebuild();
  }

  hide(): void {
    this.open = false;
    this.picked = -1;
    this.root.style.display = 'none';
  }

  toggle(altarMode = false): boolean {
    if (this.open) this.hide();
    else this.show(altarMode);
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
    const panel = document.createElement('div');
    panel.style.cssText =
      'background:#15151b;border:1px solid #3a3a44;padding:20px 26px;min-width:560px;';

    panel.appendChild(this.buildQuickslots());
    panel.appendChild(this.buildBag());
    panel.appendChild(this.buildSigils());

    const hint = document.createElement('div');
    hint.textContent =
      '가방 칸 클릭 = 고르기 → 퀵슬롯 클릭(또는 1~5) = 등록   ·   ' +
      '빈손으로 퀵슬롯 클릭 = 등록 해제   ·   가방 칸 우클릭 = 버리기   ·   Tab 닫기';
    hint.style.cssText = 'margin-top:16px;color:#6c7280;font-size:11px;';
    panel.appendChild(hint);

    this.root.replaceChildren(panel);
  }

  // ---- 퀵슬롯 ----
  private buildQuickslots(): HTMLElement {
    const world = this.world;
    const box = document.createElement('div');

    const title = document.createElement('div');
    title.textContent = `퀵슬롯 — 전투 중 1~5 로 쓴다`;
    title.style.cssText = 'color:#e8c76a;margin-bottom:8px;font-size:15px;';
    box.appendChild(title);

    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:8px;';
    world.quickslots.forEach((kind, i) => {
      const cell = document.createElement('div');
      const armed = this.picked >= 0;
      cell.style.cssText =
        CELL +
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
        const icon = document.createElement('div');
        icon.style.cssText =
          `position:absolute;left:50%;top:24px;transform:translate(-50%,-50%);` +
          `width:18px;height:18px;background:${def.color};box-shadow:0 0 8px ${def.color};` +
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
      row.appendChild(cell);
    });
    box.appendChild(row);
    return box;
  }

  // ---- 가방 ----
  private buildBag(): HTMLElement {
    const world = this.world;
    const cfg = balance.items;
    const box = document.createElement('div');
    box.style.cssText = 'margin-top:16px;';

    const used = world.inventory.filter((s) => s !== null).length;
    const title = document.createElement('div');
    title.textContent = `가방 ${used}/${world.inventory.length}칸${used >= world.inventory.length ? '  — 가득 찼다. 바닥의 아이템이 안 붙는다' : ''}`;
    title.style.cssText = `color:${used >= world.inventory.length ? '#e0455a' : '#7fbfff'};margin-bottom:8px;font-size:15px;`;
    box.appendChild(title);

    const grid = document.createElement('div');
    grid.style.cssText = `display:grid;grid-template-columns:repeat(${cfg.cols}, 64px);gap:8px;`;
    world.inventory.forEach((slot, i) => {
      const cell = document.createElement('div');
      const here = i === this.picked;
      cell.style.cssText =
        CELL +
        `border:1px solid ${here ? '#e8c76a' : '#3a3a44'};` +
        `background:${here ? 'rgba(232,199,106,0.12)' : 'rgba(255,255,255,0.02)'};` +
        `cursor:${slot ? 'pointer' : 'default'};`;

      if (slot) {
        const def = itemDef(slot.kind);
        const icon = document.createElement('div');
        icon.style.cssText =
          `position:absolute;left:50%;top:24px;transform:translate(-50%,-50%);` +
          `width:18px;height:18px;background:${def.color};box-shadow:0 0 8px ${def.color};`;
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

        cell.title = `${def.name} — 좌클릭 고르기 / 우클릭 버리기`;
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
      grid.appendChild(cell);
    });
    box.appendChild(grid);
    return box;
  }

  // ---- 각인 ----
  private buildSigils(): HTMLElement {
    const world = this.world;
    const box = document.createElement('div');
    box.style.cssText = 'margin-top:18px;border-top:1px solid #23232b;padding-top:14px;';

    const title = document.createElement('div');
    title.textContent = this.altarMode
      ? `제단 — 각인 교체  (오염 ${world.corruption.applied}/100)`
      : `각인  (오염 대기 +${world.corruption.pending})`;
    title.style.cssText = 'color:#9fe870;margin-bottom:10px;font-size:15px;';
    box.appendChild(title);

    for (const slot of SIGIL_SLOTS) {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:10px;padding:3px 0;align-items:baseline;';
      const label = document.createElement('span');
      label.textContent = SLOT_LABELS[slot].padEnd(3, '　');
      label.style.cssText = 'color:#8a8f9a;width:52px;';
      row.appendChild(label);

      const equipped = world.sigils.equipped[slot];
      const value = document.createElement('span');
      if (equipped) {
        const def = sigilDef(equipped);
        row.appendChild(swatch(def.color));
        if (this.altarMode) {
          value.textContent = `[${def.name}] — 클릭해서 해제`;
          value.style.cssText = 'color:#e8c76a;cursor:pointer;';
          value.onclick = () => {
            Sigils.detach(world, slot);
            this.rebuild();
          };
        } else {
          value.textContent = `[${def.name}] — 해제는 제단에서만`;
          value.style.color = '#8a8f9a';
        }
      } else {
        value.textContent = '(비어 있음)';
        value.style.color = '#555c66';
      }
      row.appendChild(value);
      box.appendChild(row);
    }

    const invTitle = document.createElement('div');
    invTitle.textContent = '소지한 각인 (부착 전에는 효과 없음)';
    invTitle.style.cssText = 'color:#9fe870;margin:12px 0 4px;';
    box.appendChild(invTitle);

    if (world.sigils.inventory.length === 0) {
      const empty = document.createElement('div');
      empty.textContent = '없음 — 창병을 완벽 패링 후 처형하면 각인을 떨어뜨린다';
      empty.style.color = '#555c66';
      box.appendChild(empty);
    }
    for (const id of world.sigils.inventory) {
      const def = sigilDef(id);
      const row = document.createElement('div');
      const occupied = world.sigils.equipped[def.slot] !== null;
      row.style.cssText = occupied
        ? 'color:#555c66;padding:2px 0;'
        : 'color:#7fbfff;cursor:pointer;padding:2px 0;';
      row.appendChild(swatch(def.color));
      row.appendChild(
        document.createTextNode(
          `${def.name} (${SLOT_LABELS[def.slot]}) — ${occupied ? '슬롯 사용 중' : '클릭해서 부착'}`,
        ),
      );
      if (!occupied) {
        row.onclick = () => {
          Sigils.attach(this.world, id);
          this.rebuild();
        };
      }
      box.appendChild(row);
    }
    return box;
  }
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
