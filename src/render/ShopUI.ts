// 제단 상점 UI — DOM 오버레이. 열려 있는 동안 시뮬레이션은 main이 일시정지한다.
// 골드로 HP·마나·탄약·수류탄·배터리를 산다. 무료 보급은 폐지됐다 (economy.md §1).

import type { World } from '../core/World';
import * as Altar from '../systems/Altar';

const ROWS: { item: Altar.ShopItem; name: string; unit: string }[] = [
  { item: 'heal', name: '체력 회복', unit: 'HP' },
  { item: 'mana', name: '마나 회복', unit: '마나' },
  { item: 'ammo', name: '권총탄', unit: '발' },
  { item: 'grenade', name: '수류탄', unit: '개' },
  { item: 'battery', name: '예비 배터리', unit: '개' },
];

export class ShopUI {
  private readonly root: HTMLDivElement;
  open = false;
  /** 닫힐 때 main이 uiOpen 을 되돌린다 */
  onClose: (() => void) | null = null;

  constructor(private readonly world: World) {
    this.root = document.createElement('div');
    this.root.id = 'shopui';
    this.root.style.cssText =
      'position:fixed;inset:0;display:none;align-items:center;justify-content:center;' +
      'background:rgba(0,0,0,0.72);color:#cfd2da;font:13px/1.6 monospace;user-select:none;z-index:10;';
    document.body.appendChild(this.root);

    // 숫자키 즉시 구매 — 상점이 열려 있을 때만 반응한다
    window.addEventListener('keydown', (e) => {
      if (!this.open) return;
      const digit = ROWS.findIndex((_, i) => e.code === `Digit${i + 1}`);
      if (digit >= 0) {
        e.preventDefault();
        this.buy(ROWS[digit]!.item);
        return;
      }
      if (e.code === 'KeyE' || e.code === 'Escape') {
        e.preventDefault();
        this.hide();
        this.onClose?.();
      }
    });
  }

  show(): void {
    this.open = true;
    this.root.style.display = 'flex';
    this.rebuild();
  }

  hide(): void {
    this.open = false;
    this.root.style.display = 'none';
  }

  private buy(item: Altar.ShopItem): void {
    Altar.purchase(this.world, item); // 성공/실패 연출은 main이 이벤트로 처리
    this.rebuild();
  }

  private rebuild(): void {
    const world = this.world;
    const panel = document.createElement('div');
    panel.style.cssText =
      'background:#15151b;border:1px solid #3a3a44;padding:20px 26px;min-width:560px;';

    const title = document.createElement('div');
    title.textContent = `제단 — 보급 상점   ◆ ${world.gold}`;
    title.style.cssText = 'color:#e8c76a;margin-bottom:4px;font-size:15px;';
    panel.appendChild(title);

    const sub = document.createElement('div');
    sub.textContent = `오염 ${world.corruption.applied}/100   여기서 죽으면 이 자리에서 다시 시작한다`;
    sub.style.cssText = 'color:#8a8f9a;margin-bottom:14px;';
    panel.appendChild(sub);

    ROWS.forEach((row, i) => {
      const s = Altar.shopState(world, row.item);
      const line = document.createElement('div');
      line.style.cssText =
        'display:flex;gap:12px;padding:4px 0;align-items:baseline;border-top:1px solid #23232b;';

      const key = document.createElement('span');
      key.textContent = `${i + 1}`;
      key.style.cssText = 'color:#555c66;width:14px;';
      line.appendChild(key);

      const name = document.createElement('span');
      name.textContent = row.name;
      name.style.cssText = 'width:96px;';
      line.appendChild(name);

      const gain = document.createElement('span');
      gain.textContent = `+${s.amount}${row.unit}`;
      gain.style.cssText = 'color:#9fe870;width:74px;';
      line.appendChild(gain);

      const have = document.createElement('span');
      have.textContent = `${s.have}/${s.max}`;
      have.style.cssText = 'color:#8a8f9a;width:74px;';
      line.appendChild(have);

      const price = document.createElement('span');
      price.textContent = `◆ ${s.price}`;
      price.style.cssText = `width:56px;color:${s.poor ? '#a05050' : '#e8c76a'};`;
      line.appendChild(price);

      const action = document.createElement('span');
      if (s.full) {
        action.textContent = '가득 참';
        action.style.color = '#555c66';
      } else if (s.poor) {
        action.textContent = '골드 부족';
        action.style.color = '#a05050';
      } else {
        action.textContent = '구매';
        action.style.cssText = 'color:#7fbfff;cursor:pointer;';
        action.onclick = () => this.buy(row.item);
      }
      line.appendChild(action);

      panel.appendChild(line);
    });

    const hint = document.createElement('div');
    hint.textContent = '1~5 구매   Tab 각인 교체   E / Esc 닫기';
    hint.style.cssText = 'margin-top:16px;color:#8a8f9a;border-top:1px solid #23232b;padding-top:10px;';
    panel.appendChild(hint);

    this.root.replaceChildren(panel);
  }
}
