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

// WASD 는 이동키 그대로 쓰는 게 손이 편하다 — 세로 목록이라 A/D 도 위/아래에 붙인다
const UP_KEYS = new Set(['KeyW', 'KeyA', 'ArrowUp', 'ArrowLeft']);
const DOWN_KEYS = new Set(['KeyS', 'KeyD', 'ArrowDown', 'ArrowRight']);

export class ShopUI {
  private readonly root: HTMLDivElement;
  open = false;
  /** 키보드 커서 위치 (WASD/화살표로 이동, Enter로 구매) */
  private selected = 0;
  /** 닫힐 때 main이 uiOpen 을 되돌린다 */
  onClose: (() => void) | null = null;

  constructor(private readonly world: World) {
    this.root = document.createElement('div');
    this.root.id = 'shopui';
    this.root.style.cssText =
      'position:fixed;inset:0;display:none;align-items:center;justify-content:center;' +
      'background:rgba(0,0,0,0.72);color:#cfd2da;font:13px/1.6 monospace;user-select:none;z-index:10;';
    document.body.appendChild(this.root);

    // 상점이 열려 있을 때만 반응한다.
    // WASD/화살표로 커서 이동 + Enter 구매, 숫자키는 바로 구매 (둘 다 지원)
    window.addEventListener('keydown', (e) => {
      if (!this.open) return;
      const digit = ROWS.findIndex((_, i) => e.code === `Digit${i + 1}`);
      if (digit >= 0) {
        e.preventDefault();
        this.selected = digit; // 숫자로 산 줄에 커서를 남긴다
        this.buy(ROWS[digit]!.item);
        return;
      }
      if (UP_KEYS.has(e.code)) {
        e.preventDefault();
        this.move(-1);
        return;
      }
      if (DOWN_KEYS.has(e.code)) {
        e.preventDefault();
        this.move(1);
        return;
      }
      // Space 는 일부러 뺐다 — 전투에서 가장 많이 두들기는 키라 오구매가 난다
      if (e.code === 'Enter' || e.code === 'NumpadEnter') {
        e.preventDefault();
        this.buy(ROWS[this.selected]!.item);
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
    this.selected = 0;
    this.root.style.display = 'flex';
    this.rebuild();
  }

  /** 커서 이동 — 끝에서 반대편으로 돈다 (5줄뿐이라 감기는 편이 빠르다) */
  private move(step: number): void {
    this.selected = (this.selected + step + ROWS.length) % ROWS.length;
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
      const here = i === this.selected;
      const line = document.createElement('div');
      line.style.cssText =
        'display:flex;gap:12px;padding:4px 8px;align-items:baseline;border-top:1px solid #23232b;' +
        (here ? 'background:#242a36;box-shadow:inset 2px 0 0 #7fbfff;' : '');
      // 마우스를 움직이면 커서가 따라온다. mouseenter 가 아니라 mousemove 인 이유:
      // 커서가 패널 위에 멈춰 있어도 rebuild 로 노드가 갈리면 mouseenter 가 다시 떠서
      // 키보드로 옮긴 선택을 마우스 위치로 되돌려 버린다 (실측으로 확인)
      line.onmousemove = () => {
        if (this.selected === i) return;
        this.selected = i;
        this.rebuild();
      };

      const cursor = document.createElement('span');
      cursor.textContent = here ? '▸' : ' ';
      cursor.style.cssText = 'color:#7fbfff;width:10px;';
      line.appendChild(cursor);

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
    hint.textContent = 'WASD·↑↓ 이동   Enter 구매   1~5 바로 구매   Tab 각인 교체   E / Esc 닫기';
    hint.style.cssText = 'margin-top:16px;color:#8a8f9a;border-top:1px solid #23232b;padding-top:10px;';
    panel.appendChild(hint);

    this.root.replaceChildren(panel);
  }
}
