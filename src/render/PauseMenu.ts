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
  /** 키 설정 열기 — 키보드 화면 또는 패드 화면 */
  openBindings(mode: 'kb' | 'pad'): void;
  /** 트랩 시험방 — 함정 8종이 깔린 특수 층으로 */
  trapRoom(): void;
  /** 미니맵 켜기/끄기 — 왼쪽 위 안내 글도 함께 (키가 아니라 여기서만, 2026-09-04) */
  toggleMinimap(): void;
  minimapOn(): boolean;
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
  /** 오른쪽 패드 다이어그램 — 패드가 연결돼 있을 때만 보인다 */
  private readonly diagramEl: HTMLDivElement;
  private readonly rows: HTMLDivElement[] = [];
  private readonly labels: HTMLSpanElement[] = [];
  private readonly hints: HTMLSpanElement[] = [];
  /** 상황 안내 — 창 전환 뒤 패드·소리가 잠든 이유 같은 것 (main 이 setNotice 로 갈아 끼운다) */
  private readonly notice: HTMLDivElement;
  private readonly items: MenuItem[];
  open = false;
  private selected = 0;
  private openedAt = 0;

  constructor(
    private readonly root: HTMLElement,
    private readonly world: World,
    actions: PauseMenuActions,
    /** 현재 패드 매핑의 다이어그램 SVG — 패드 미연결이면 null (main 이 공급) */
    private readonly padDiagram?: () => string | null,
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
            ? '제단 체크포인트 — 골드 전액을 재물로 바친다 · 죽인 적은 안 살아난다'
            : '아직 들른 제단이 없다',
        enabled: (world) => world.respawn !== null,
        run: actions.loadSave,
      },
      {
        label: '4. 키보드 키 설정',
        hint: () => '키보드 키를 기능에 건다',
        enabled: () => true,
        run: () => actions.openBindings('kb'),
      },
      {
        label: '5. 패드 키 설정',
        hint: () => '게임패드 버튼을 기능에 건다',
        enabled: () => true,
        run: () => actions.openBindings('pad'),
      },
      {
        label: '6. 트랩 시험방',
        hint: () => '함정 8종이 한 방에 — 스킬·탄 전부 지급. 나오는 길은 처음부터 시작',
        enabled: () => true,
        run: actions.trapRoom,
      },
      {
        label: '7. 미니맵 켜기 / 끄기',
        hint: () =>
          actions.minimapOn()
            ? '지금 켜짐 — 끄면 왼쪽 위 안내 글도 함께 사라진다 (화면을 비운다)'
            : '지금 꺼짐 — 켜면 미니맵과 왼쪽 위 안내 글이 돌아온다',
        enabled: () => true,
        run: actions.toggleMinimap,
      },
    ];

    this.root.textContent = '';
    // 메뉴 + (패드 연결 시) 오른쪽 다이어그램을 가로로 나란히
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:18px;align-items:flex-start;';
    this.root.appendChild(row);
    this.panel = document.createElement('div');
    this.panel.className = 'menu';
    this.panel.style.cssText =
      'background:#15151b;border:1px solid #3a3a44;padding:22px 30px;min-width:420px;' +
      'font:13px/1.6 monospace;letter-spacing:0;text-align:left;';
    row.appendChild(this.panel);
    this.diagramEl = document.createElement('div');
    this.diagramEl.className = 'menu'; // 클릭이 재개로 새지 않게 — 메뉴 패널과 같은 예외
    this.diagramEl.style.cssText =
      'background:#15151b;border:1px solid #3a3a44;padding:14px 16px;display:none;';
    row.appendChild(this.diagramEl);

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

    this.notice = document.createElement('div');
    this.notice.style.cssText =
      'display:none;margin-top:10px;padding:8px 10px;border:1px solid #6b4a2f;background:rgba(107,74,47,0.18);' +
      'color:#e8c76a;font-size:12px;line-height:1.5;max-width:460px;white-space:normal;';
    this.panel.appendChild(this.notice);

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

  /** 상황 안내 줄 — null 이면 숨긴다. 같은 글이면 DOM 을 건드리지 않는다 */
  setNotice(text: string | null): void {
    const shown = this.notice.style.display !== 'none';
    if (!text) {
      if (shown) this.notice.style.display = 'none';
      return;
    }
    if (!shown) this.notice.style.display = 'block';
    if (this.notice.textContent !== text) this.notice.textContent = text;
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
    if (this.open) this.refresh(); // 토글 항목(미니맵)은 메뉴가 열린 채 설명이 바뀐다
  }

  /** 라벨·설명·선택 표시를 지금 상태에 맞춘다 (DOM 은 생성자에서 한 번만 만든다 —
   *  매번 다시 만들면 마우스가 얹힌 줄이 교체돼 mouseenter 가 다시 터진다) */
  private refresh(): void {
    // 패드가 연결돼 있으면 오른쪽에 현재 매핑 다이어그램 — 설정을 바꾸고 돌아와도 최신
    const svg = this.padDiagram?.() ?? null;
    if (svg) {
      this.diagramEl.innerHTML = svg;
      this.diagramEl.style.display = 'block';
    } else {
      this.diagramEl.style.display = 'none';
    }
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
