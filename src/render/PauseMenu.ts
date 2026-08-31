// 일시정지 메뉴 — DOM 오버레이. 포인터 락이 풀리면(ESC·알트탭·창 밖 클릭) main이 띄운다.
// 상점·각인 UI와 같은 규약: 키보드(W/S·↑↓ + Enter)와 마우스 클릭을 모두 받는다.
//
// 클릭 처리에 주의점이 하나 있다 — "화면 아무 데나 클릭하면 재개"가 기존 규칙이라
// 오버레이가 클릭을 통째로 삼키면 재개가 막힌다. 그래서 오버레이 자체는
// pointer-events:none 으로 두고 메뉴 패널만 클릭을 받는다. 패널 안 클릭이
// 포인터 락 요청으로 새지 않게 Input 쪽에서 #pause 를 제외 목록에 넣어 둔다.

import type { World } from '../core/World';

const UP_KEYS = new Set(['KeyW', 'ArrowUp']);
const DOWN_KEYS = new Set(['KeyS', 'ArrowDown']);

/** 메뉴가 뜬 직후 ESC 를 무시하는 시간(ms).
 *  멈춤 자체가 ESC 로 시작되는 경우가 많은데, 브라우저가 그 keydown 을 페이지로
 *  흘려보내면 메뉴가 뜨자마자 "계속"으로 튕겨 나간다 */
const ESC_GUARD_MS = 250;

/** 메뉴가 main에게 부탁하는 일. 실제 재개·재시작 절차는 main이 안다 */
export interface PauseMenuActions {
  /** 게임 계속 */
  resume(): void;
  /** 처음부터 시작 */
  restart(): void;
  /** 저장된 곳(제단 체크포인트)에서 시작 */
  loadSave(): void;
  /** 패드 키 설정 열기 */
  openGamepad(): void;
}

interface MenuItem {
  label: string;
  /** 아래 줄 설명 — 저장 여부처럼 상황에 따라 바뀐다 */
  hint: (world: World) => string;
  /** false 면 비활성 — 커서가 건너뛰고 클릭도 안 먹는다 */
  enabled: (world: World) => boolean;
  run: () => void;
}

export class PauseMenu {
  private readonly panel: HTMLDivElement;
  private readonly rows: HTMLDivElement[] = [];
  private readonly labels: HTMLSpanElement[] = [];
  private readonly hints: HTMLSpanElement[] = [];
  private readonly items: MenuItem[];
  open = false;
  private selected = 0;
  private openedAt = 0;

  constructor(
    private readonly root: HTMLElement,
    private readonly world: World,
    actions: PauseMenuActions,
  ) {
    this.items = [
      {
        label: '1. 게임 계속',
        hint: () => '',
        enabled: () => true,
        run: actions.resume,
      },
      {
        label: '2. 처음부터 시작',
        hint: () => '지금까지의 진행은 사라진다',
        enabled: () => true,
        run: actions.restart,
      },
      {
        label: '3. 저장된 곳에서 시작',
        // 저장 = 제단 진입 시 등록되는 리스폰 지점. 사망 시 부활 지점과 같은 곳이다
        hint: (world) =>
          world.respawn
            ? '제단 체크포인트 — 각인·골드는 그대로, 적 배치는 초기화'
            : '아직 들른 제단이 없다',
        enabled: (world) => world.respawn !== null,
        run: actions.loadSave,
      },
      {
        label: '4. 키 설정 (키보드 · 패드)',
        hint: () => '게임패드 버튼을 기능에 건다',
        enabled: () => true,
        run: actions.openGamepad,
      },
    ];

    this.root.textContent = '';
    this.panel = document.createElement('div');
    this.panel.className = 'menu';
    this.panel.style.cssText =
      'background:#15151b;border:1px solid #3a3a44;padding:22px 30px;min-width:420px;' +
      'font:13px/1.6 monospace;letter-spacing:0;text-align:left;';
    this.root.appendChild(this.panel);

    const title = document.createElement('div');
    title.textContent = '일시정지';
    title.style.cssText = 'color:#d8e0ea;font-size:18px;letter-spacing:4px;margin-bottom:16px;';
    this.panel.appendChild(title);

    this.items.forEach((_, i) => {
      const row = document.createElement('div');
      row.style.cssText =
        'padding:7px 12px;border-left:2px solid transparent;border-top:1px solid #23232b;';
      const label = document.createElement('span');
      label.style.cssText = 'font-size:15px;';
      const hint = document.createElement('span');
      hint.style.cssText = 'display:block;font-size:11px;color:#6c7280;';
      row.appendChild(label);
      row.appendChild(hint);
      // 커서는 마우스를 따라간다 — 키보드와 마우스가 같은 선택을 가리켜야 헷갈리지 않는다
      row.addEventListener('mouseenter', () => this.hover(i));
      row.addEventListener('click', () => this.activate(i));
      this.panel.appendChild(row);
      this.rows.push(row);
      this.labels.push(label);
      this.hints.push(hint);
    });

    const foot = document.createElement('div');
    foot.textContent = 'W/S·↑↓ 선택   Enter 결정   ESC·화면 클릭으로 바로 계속';
    foot.style.cssText = 'color:#6c7280;font-size:11px;margin-top:14px;';
    this.panel.appendChild(foot);

    window.addEventListener('keydown', (e) => {
      if (!this.open) return;
      const digit = this.items.findIndex((_, i) => e.code === `Digit${i + 1}`);
      if (digit >= 0) {
        e.preventDefault();
        this.activate(digit);
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
      if (e.code === 'Enter' || e.code === 'NumpadEnter') {
        e.preventDefault();
        this.activate(this.selected);
        return;
      }
      // ESC 는 "계속" 과 같다 — 멈출 때 누른 키로 그대로 빠져나올 수 있게
      if (e.code === 'Escape' && performance.now() - this.openedAt > ESC_GUARD_MS) {
        e.preventDefault();
        this.activate(0);
      }
    });
  }

  /** 패드로 커서를 옮긴다 — 일시정지 중에는 키보드 핸들러가 안 돌 수도 있다
   *  (패드만 쓰는 사람은 포인터 락도 키 입력도 없이 여기 들어온다) */
  padMove(step: number): void {
    if (!this.open) return;
    this.move(step);
  }

  /** 패드로 지금 줄을 고른다 */
  padActivate(): void {
    if (!this.open) return;
    this.activate(this.selected);
  }

  show(): void {
    this.open = true;
    this.openedAt = performance.now();
    this.selected = 0;
    this.root.classList.add('visible');
    this.refresh();
  }

  hide(): void {
    this.open = false;
    this.root.classList.remove('visible');
  }

  /** 커서 이동 — 비활성 줄은 건너뛰고, 끝에서 반대편으로 돈다 */
  private move(step: number): void {
    const n = this.items.length;
    for (let i = 1; i <= n; i++) {
      const next = (this.selected + step * i + n * n) % n;
      if (this.items[next]!.enabled(this.world)) {
        this.selected = next;
        break;
      }
    }
    this.refresh();
  }

  private hover(index: number): void {
    if (this.selected === index || !this.items[index]!.enabled(this.world)) return;
    this.selected = index;
    this.refresh();
  }

  private activate(index: number): void {
    const item = this.items[index];
    if (!item || !item.enabled(this.world)) return;
    this.selected = index;
    item.run();
  }

  /** 라벨·설명·선택 표시를 지금 상태에 맞춘다 (DOM 은 생성자에서 한 번만 만든다 —
   *  매번 다시 만들면 마우스가 얹힌 줄이 교체돼 mouseenter 가 다시 터진다) */
  private refresh(): void {
    this.items.forEach((item, i) => {
      const enabled = item.enabled(this.world);
      const here = enabled && i === this.selected;
      this.rows[i]!.style.borderLeftColor = here ? '#e8c76a' : 'transparent';
      this.rows[i]!.style.background = here ? 'rgba(232,199,106,0.08)' : 'transparent';
      this.rows[i]!.style.cursor = enabled ? 'pointer' : 'default';
      this.labels[i]!.textContent = item.label;
      this.labels[i]!.style.color = !enabled ? '#4a4f5a' : here ? '#e8c76a' : '#cfd2da';
      this.hints[i]!.textContent = item.hint(this.world);
      this.hints[i]!.style.color = enabled ? '#6c7280' : '#454a54';
    });
  }
}
