// 메뉴 창 — 가방 키(I·패드 Menu)로 여는 하나의 창에 탭이 있다: 맵 · 가방 · 스킬 (2026-09-04 사용자 확정).
// 탭 목록은 balance.hud.menuTabs.order 가 정하고 셸은 개수를 세지 않는다 — 나중에 탭을 더 넣어도 여기는 안 바뀐다.
// 조작: 패드 Menu 열기/닫기, LB/RB 탭 좌우(빙글 돈다), B 닫기(가방 탭은 InventoryUI 가 들기·대화상자 취소를 먼저 처리).
// 키보드는 I(가방)·M(맵)·Tab(스킬)으로 바로 열고 Esc 로 닫는다 — 마우스 사용자는 탭 헤더를 클릭한다.
// 시간 정지(uiOpen)는 이 창 하나가 켜고 끈다. 각 탭 패널은 자기 창(InventoryUI·SkillUI·MapPanel)이 그린다.

import { balance } from '../core/Balance';
import { keycap } from './ItemPopup';

export interface MenuTabDef {
  id: string;
  label: string;
  /** 탭 이름 옆 작은 상태 — '12/20', '지하 1층' */
  status?: () => string;
  show(): void;
  hide(): void;
  /** 열려 있는 동안 매 프레임 (맵 다시 그리기 등) */
  update?(): void;
  /** 지금 화살표를 탭 전환에 쓰면 안 되는가(대화상자가 열려 있다 등) — true 면 셸은 ←→ 를 건너뛴다 */
  blocksArrows?: () => boolean;
}

export class MenuTabs {
  readonly root: HTMLDivElement;
  /** 탭 패널들이 붙는 자리 — 각 창의 root 가 여기 자식이다 */
  readonly body: HTMLDivElement;
  private readonly header: HTMLDivElement;
  /** 탭 정의 원본 — main 이 셸을 만든 뒤에 채운다(패널은 셸의 body 가 필요하다). 순서는 매번 데이터로 해석 */
  private readonly defs: MenuTabDef[];
  open = false;
  active = '';
  /** 스킬 탭이 제단(상점)에서 열렸는가 — 패시브를 떼는 건 제단에서만 */
  altar = false;
  padMode = false;
  onOpenChange: ((open: boolean) => void) | null = null;
  onTabChange: ((id: string) => void) | null = null;

  constructor(defs: MenuTabDef[]) {
    this.defs = defs;
    this.root = document.createElement('div');
    this.root.id = 'menuui';
    // 헤더는 화면의 같은 자리에 고정 — 세로 가운데 정렬로 두면 탭마다 본문 높이가 달라 헤더가 위아래로 움직인다 (2026-09-04 사용자)
    this.root.style.cssText =
      'position:fixed;inset:0;display:none;align-items:flex-start;justify-content:center;padding-top:72px;box-sizing:border-box;' +
      'background:rgba(0,0,0,0.72);color:#cfd2da;font:13px/1.6 monospace;user-select:none;z-index:10;';
    const column = document.createElement('div');
    column.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:10px;';
    this.header = document.createElement('div');
    this.header.style.cssText = 'display:flex;align-items:center;gap:6px;';
    this.body = document.createElement('div');
    this.body.style.cssText = 'display:flex;align-items:flex-start;justify-content:center;';
    column.appendChild(this.header);
    column.appendChild(this.body);
    this.root.appendChild(column);
    document.body.appendChild(this.root);

    window.addEventListener('keydown', (e) => {
      if (!this.open) return;
      // Esc — 가방 탭은 InventoryUI 가 들기·대화상자 취소를 먼저 처리하고 onClose 로 여기를 닫는다
      if (e.code === 'Escape' && this.active !== 'bag') {
        e.preventDefault();
        this.hide();
        return;
      }
      // ←→ / A·D — 탭 전환(키보드는 칸 이동에 화살표를 쓰지 않는다, 마우스만). 대화상자가 열려 있으면 그쪽 몫.
      // 같은 이벤트가 다른 리스너로 새지 않게 끊는다 (stopImmediatePropagation)
      if (this.tab(this.active)?.blocksArrows?.()) return;
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') { e.preventDefault(); e.stopImmediatePropagation(); this.next(-1); }
      else if (e.code === 'ArrowRight' || e.code === 'KeyD') { e.preventDefault(); e.stopImmediatePropagation(); this.next(1); }
    });
  }

  /** 데이터(order)가 정한 순서의 탭 — 정의 없는 id 는 건너뛴다 */
  private get tabs(): MenuTabDef[] {
    const order = balance.hud.menuTabs.order as readonly string[];
    return order.map((id) => this.defs.find((t) => t.id === id)).filter((t): t is MenuTabDef => t !== undefined);
  }
  private tab(id: string): MenuTabDef | undefined {
    return this.defs.find((t) => t.id === id);
  }

  /** 열기 — 탭을 주지 않으면 마지막으로 보던 탭(rememberLast) 또는 첫 탭 */
  show(id?: string, altar = false): void {
    this.altar = altar;
    const remembered = balance.hud.menuTabs.rememberLast && this.active ? this.active : (this.tabs[0]?.id ?? '');
    const target = id && this.tab(id) ? id : remembered;
    if (!this.open) {
      this.open = true;
      this.root.style.display = 'flex';
      this.onOpenChange?.(true);
      this.active = ''; // select 가 반드시 show 를 부르게
    }
    this.select(target);
  }

  hide(): void {
    if (!this.open) return;
    this.tab(this.active)?.hide();
    this.open = false;
    this.root.style.display = 'none';
    this.onOpenChange?.(false);
  }

  /** 같은 탭이 열려 있으면 닫고, 아니면 그 탭으로 연다 (I·M·Tab 키) */
  toggleTab(id: string): void {
    if (this.open && this.active === id) this.hide();
    else this.show(id);
  }
  toggle(): void {
    if (this.open) this.hide();
    else this.show();
  }

  select(id: string): void {
    const next = this.tab(id);
    if (!next) return;
    if (this.active === id && this.open) { this.renderHeader(); return; }
    this.tab(this.active)?.hide();
    this.active = id;
    next.show();
    this.renderHeader();
    this.onTabChange?.(id);
  }

  /** LB/RB — 좌우로, 끝에서 빙글 돈다 */
  next(dir: number): void {
    if (!this.open || this.tabs.length === 0) return;
    const i = this.tabs.findIndex((t) => t.id === this.active);
    const n = (i + dir + this.tabs.length) % this.tabs.length;
    this.select(this.tabs[n]!.id);
  }

  /** 매 프레임 — 헤더 상태 글·활성 탭 갱신 */
  update(): void {
    if (!this.open) return;
    this.tab(this.active)?.update?.();
    this.renderHeader();
  }

  private headerKey = '';
  private renderHeader(): void {
    // 내용 서명이 같으면 DOM 을 건드리지 않는다 — 매 프레임 갈아 끼우면 mousedown~mouseup 사이 버튼이 바뀌어 클릭이 안 된다
    const key = `${this.padMode ? 'p' : 'k'}|${this.active}|${this.tabs.map((t) => `${t.id}:${t.status?.() ?? ''}`).join(',')}`;
    if (key === this.headerKey) return;
    this.headerKey = key;
    const parts: HTMLElement[] = [];
    // 왼쪽 글리프 — 패드 LB / 마우스는 클릭이라 표기 없음
    if (this.padMode) {
      const l = document.createElement('span');
      l.appendChild(keycap('LB', true));
      l.style.cssText = 'margin-right:6px;opacity:0.85;';
      parts.push(l);
    }
    for (const t of this.tabs) {
      const b = document.createElement('div');
      const on = t.id === this.active;
      b.style.cssText =
        `padding:6px 16px;border:1px solid ${on ? '#e8c76a' : '#3a3a44'};border-bottom:${on ? '2px solid #e8c76a' : '1px solid #3a3a44'};` +
        `background:${on ? 'rgba(232,199,106,0.12)' : 'rgba(21,21,27,0.85)'};color:${on ? '#e8c76a' : '#8a8f9a'};cursor:pointer;` +
        'display:flex;align-items:baseline;gap:8px;font-size:15px;';
      const name = document.createElement('span');
      name.textContent = t.label;
      b.appendChild(name);
      const status = t.status?.();
      if (status) {
        const s = document.createElement('span');
        s.textContent = status;
        s.style.cssText = 'font-size:11px;color:#8a8f9a;';
        b.appendChild(s);
      }
      b.onclick = () => this.select(t.id);
      parts.push(b);
    }
    if (this.padMode) {
      const r = document.createElement('span');
      r.appendChild(keycap('RB', true));
      r.style.cssText = 'margin-left:6px;opacity:0.85;';
      parts.push(r);
    }
    this.header.replaceChildren(...parts);
  }
}
