// 각인 부착 UI (Tab) — DOM 오버레이. 열려 있는 동안 시뮬레이션은 main이 일시정지한다.
// 부위 5슬롯 + 인벤토리 목록. 클릭으로 부착/해제.

import { sigilDef, SIGIL_SLOTS, type SigilSlot } from '../core/SigilData';
import type { World } from '../core/World';
import * as Sigils from '../systems/Sigils';

const SLOT_LABELS: Record<SigilSlot, string> = {
  eye: '눈',
  rightArm: '오른팔',
  leftArm: '왼팔',
  heart: '심장',
  spine: '척추',
};

export class SigilUI {
  private readonly root: HTMLDivElement;
  open = false;
  /** 제단에서 열렸는가 — 해제(교체)는 제단에서만 가능 */
  private altarMode = false;

  constructor(private readonly world: World) {
    this.root = document.createElement('div');
    this.root.id = 'sigilui';
    this.root.style.cssText =
      'position:fixed;inset:0;display:none;align-items:center;justify-content:center;' +
      'background:rgba(0,0,0,0.72);color:#cfd2da;font:13px/1.6 monospace;user-select:none;z-index:10;';
    document.body.appendChild(this.root);
  }

  show(altarMode: boolean): void {
    this.altarMode = altarMode;
    this.open = true;
    this.root.style.display = 'flex';
    this.rebuild();
  }

  hide(): void {
    this.open = false;
    this.root.style.display = 'none';
  }

  toggle(altarMode = false): boolean {
    if (this.open) this.hide();
    else this.show(altarMode);
    return this.open;
  }

  private rebuild(): void {
    const world = this.world;
    const panel = document.createElement('div');
    panel.style.cssText =
      'background:#15151b;border:1px solid #3a3a44;padding:20px 26px;min-width:520px;';

    const title = document.createElement('div');
    title.textContent = this.altarMode
      ? `제단 — 각인 교체  (오염 ${world.corruption.applied}/100)`
      : `각인  (오염 대기 +${world.corruption.pending})`;
    title.style.cssText = 'color:#9fe870;margin-bottom:12px;font-size:15px;';
    panel.appendChild(title);

    // 부위 슬롯
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
      panel.appendChild(row);
    }

    // 인벤토리
    const invTitle = document.createElement('div');
    invTitle.textContent = '소지 중 (부착 전에는 효과 없음)';
    invTitle.style.cssText = 'color:#9fe870;margin:14px 0 6px;';
    panel.appendChild(invTitle);

    if (world.sigils.inventory.length === 0) {
      const empty = document.createElement('div');
      empty.textContent = '없음 — 창병을 완벽 패링 후 처형하면 각인을 떨어뜨린다';
      empty.style.color = '#555c66';
      panel.appendChild(empty);
    }
    for (const id of world.sigils.inventory) {
      const def = sigilDef(id);
      const row = document.createElement('div');
      const occupied = world.sigils.equipped[def.slot] !== null;
      row.textContent = `${def.name} (${SLOT_LABELS[def.slot]}) — ${occupied ? '슬롯 사용 중' : '클릭해서 부착'}`;
      row.style.cssText = occupied
        ? 'color:#555c66;padding:2px 0;'
        : 'color:#7fbfff;cursor:pointer;padding:2px 0;';
      if (!occupied) {
        row.onclick = () => {
          Sigils.attach(this.world, id);
          this.rebuild();
        };
      }
      panel.appendChild(row);
    }

    const hint = document.createElement('div');
    hint.textContent = 'Tab 닫기';
    hint.style.cssText = 'margin-top:14px;color:#8a8f9a;';
    panel.appendChild(hint);

    this.root.replaceChildren(panel);
  }
}
