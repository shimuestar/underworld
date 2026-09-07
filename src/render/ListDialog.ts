// 목록 대화창 — 제목·설명·고를 줄 몇 개·바닥글. 사망 메뉴, 로비 대제단 워프 목록, 사제 대화가 같은 틀을 쓴다.
// 일시정지 메뉴와 같은 규약: 키보드(W/S·↑↓ + Enter, 숫자키)와 마우스(hover·클릭), 패드(main 이 padMove/padActivate/padClose 를 부른다).
// 한 번 만들어 두고 show(spec) 마다 내용을 갈아 끼운다 — 줄 DOM 은 항목이 바뀔 때만 다시 만든다(hover 튐 방지, PauseMenu 와 같은 이유).
//
// root 를 주면 그 오버레이 안에 패널을 넣고(사망 화면 #death), 없으면 제 오버레이를 만든다(워프·대화).
// 오버레이 자체는 클릭을 안 삼키고(pointer-events:none) 패널만 받는다 — Input 이 '.menu' 안 클릭을 포인터 락에서 제외한다.

const UP_KEYS = new Set(['KeyW', 'ArrowUp']);
const DOWN_KEYS = new Set(['KeyS', 'ArrowDown']);

export interface DialogEntry {
  id: string;
  label: string;
  /** 아래 줄 설명 */
  sub?: string;
  /** false 면 회색 — 커서가 건너뛰고 클릭도 안 먹는다 */
  enabled?: boolean;
  /** 초록 강조 — "지금 여기" 같은 표식 */
  current?: boolean;
}

export interface DialogSpec {
  title: string;
  subtitle?: string;
  entries: DialogEntry[];
  /** 바닥글 — 조작 안내. 없으면 기본 안내 */
  footer?: string;
  /** 줄을 골랐다. 창을 닫을지는 부르는 쪽이 정한다 (closeOnPick) */
  onPick: (id: string) => void;
  /** ESC·B·닫기 줄로 닫혔다 (onPick 뒤 닫힘에는 부르지 않는다) */
  onClose?: () => void;
  /** 기본 true — 고르면 닫힌다. false 면 열린 채 refresh 로 내용만 갈아 끼운다 (사제 대화) */
  closeOnPick?: boolean;
  /** ESC 로 닫을 수 있는가 — 기본 true. 사망 메뉴는 닫을 수 없다 */
  closable?: boolean;
  /** 패널 색조 — 'dark'(기본) / 'holy'(로비 — 밝은 상아·금) */
  tone?: 'dark' | 'holy';
}

export class ListDialog {
  private readonly root: HTMLElement;
  private readonly ownsRoot: boolean;
  private readonly panel: HTMLDivElement;
  private readonly titleEl: HTMLDivElement;
  private readonly subtitleEl: HTMLDivElement;
  private readonly listEl: HTMLDivElement;
  private readonly footEl: HTMLDivElement;
  private rows: { row: HTMLDivElement; label: HTMLSpanElement; sub: HTMLSpanElement }[] = [];
  private rowsKey = '';
  private spec: DialogSpec | null = null;
  private selected = 0;
  private openedAt = 0;
  open = false;
  /** 패드로 조작 중 — 바닥글을 패드 표기로 (main 이 갱신) */
  padMode = false;

  constructor(root?: HTMLElement, id = 'listdialog') {
    this.ownsRoot = !root;
    if (root) {
      this.root = root;
    } else {
      this.root = document.createElement('div');
      this.root.id = id;
      this.root.style.cssText =
        'position:fixed;inset:0;display:none;align-items:center;justify-content:center;' +
        'background:rgba(0,0,0,0.55);color:#cfd2da;font:13px/1.6 monospace;user-select:none;z-index:10;pointer-events:none;';
      document.body.appendChild(this.root);
    }
    this.panel = document.createElement('div');
    this.panel.className = 'menu';
    this.panel.style.cssText =
      'display:none;pointer-events:auto;background:#15151b;border:1px solid #3a3a44;padding:22px 30px;min-width:460px;max-width:640px;' +
      'font:13px/1.6 monospace;letter-spacing:0;text-align:left;color:#cfd2da;';
    this.root.appendChild(this.panel);
    this.titleEl = document.createElement('div');
    this.titleEl.style.cssText = 'color:#d8e0ea;font-size:18px;letter-spacing:4px;margin-bottom:6px;';
    this.panel.appendChild(this.titleEl);
    this.subtitleEl = document.createElement('div');
    this.subtitleEl.style.cssText = 'color:#8a8f9a;font-size:12px;margin-bottom:14px;white-space:pre-line;';
    this.panel.appendChild(this.subtitleEl);
    this.listEl = document.createElement('div');
    this.panel.appendChild(this.listEl);
    this.footEl = document.createElement('div');
    this.footEl.style.cssText = 'color:#6c7280;font-size:11px;margin-top:14px;white-space:pre-line;';
    this.panel.appendChild(this.footEl);

    window.addEventListener('keydown', (e) => {
      if (!this.open || !this.spec) return;
      const digit = this.spec.entries.findIndex((_, i) => e.code === `Digit${i + 1}`);
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
      // ESC·E — 닫기. 창을 연 그 E 가 곧바로 닫지 않게 잠깐 무시한다
      if ((e.code === 'Escape' || e.code === 'KeyE') && performance.now() - this.openedAt > 250) {
        e.preventDefault();
        this.close();
      }
    });
  }

  show(spec: DialogSpec): void {
    this.spec = spec;
    this.open = true;
    this.openedAt = performance.now();
    this.selected = 0;
    // 첫 활성 줄에 커서
    const first = spec.entries.findIndex((en) => en.enabled !== false);
    if (first >= 0) this.selected = first;
    const holy = spec.tone === 'holy';
    this.panel.style.background = holy ? '#f4efe2' : '#15151b';
    this.panel.style.borderColor = holy ? '#c9b26a' : '#3a3a44';
    this.panel.style.color = holy ? '#3a3226' : '#cfd2da';
    this.titleEl.style.color = holy ? '#7a5a12' : '#d8e0ea';
    this.subtitleEl.style.color = holy ? '#6c5f48' : '#8a8f9a';
    this.footEl.style.color = holy ? '#8a7c60' : '#6c7280';
    this.rowsKey = ''; // 색조가 바뀌면 줄도 다시 만든다
    if (this.ownsRoot) this.root.style.display = 'flex';
    this.panel.style.display = 'block';
    this.refresh();
  }

  /** 내용만 갈아 끼운다 (열린 채) — 사제 대화처럼 고른 뒤 설명이 바뀌는 창 */
  refresh(entries?: DialogEntry[], subtitle?: string): void {
    if (!this.spec) return;
    if (entries) this.spec.entries = entries;
    if (subtitle !== undefined) this.spec.subtitle = subtitle;
    this.render();
  }

  hide(): void {
    this.open = false;
    this.panel.style.display = 'none';
    if (this.ownsRoot) this.root.style.display = 'none';
  }

  /** ESC·B — 닫고 onClose 를 부른다. closable=false 면 무시 */
  close(): void {
    if (!this.open || !this.spec || this.spec.closable === false) return;
    const spec = this.spec;
    this.hide();
    spec.onClose?.();
  }

  padMove(step: number): void {
    if (this.open) this.move(step);
  }
  padActivate(): void {
    if (this.open) this.activate(this.selected);
  }
  padClose(): void {
    this.close();
  }

  private move(step: number): void {
    if (!this.spec) return;
    const n = this.spec.entries.length;
    if (n === 0) return;
    for (let i = 1; i <= n; i++) {
      const next = (this.selected + step * i + n * n) % n;
      if (this.spec.entries[next]!.enabled !== false) {
        this.selected = next;
        break;
      }
    }
    this.render();
  }

  private activate(index: number): void {
    if (!this.spec) return;
    const entry = this.spec.entries[index];
    if (!entry || entry.enabled === false) return;
    this.selected = index;
    const spec = this.spec;
    if (spec.closeOnPick !== false) this.hide();
    spec.onPick(entry.id);
    if (this.open) this.render();
  }

  private rebuildRows(): void {
    const spec = this.spec!;
    const key = spec.entries.map((en) => `${en.id}:${en.label}:${en.sub ?? ''}:${en.enabled === false ? 0 : 1}:${en.current ? 1 : 0}`).join('|');
    if (key === this.rowsKey) return;
    this.rowsKey = key;
    this.listEl.textContent = '';
    this.rows = [];
    const holy = spec.tone === 'holy';
    spec.entries.forEach((en, i) => {
      const row = document.createElement('div');
      row.style.cssText =
        `padding:7px 12px;border-left:2px solid transparent;border-top:1px solid ${holy ? '#e2d9c4' : '#23232b'};`;
      const label = document.createElement('span');
      label.style.cssText = 'font-size:15px;';
      label.textContent = `${i + 1}. ${en.label}`;
      const sub = document.createElement('span');
      sub.style.cssText = 'display:block;font-size:11px;white-space:pre-line;';
      sub.textContent = en.sub ?? '';
      row.appendChild(label);
      row.appendChild(sub);
      row.addEventListener('mouseenter', () => {
        if (this.padMode || en.enabled === false || this.selected === i) return;
        this.selected = i;
        this.render();
      });
      row.addEventListener('click', () => this.activate(i));
      this.listEl.appendChild(row);
      this.rows.push({ row, label, sub });
    });
  }

  private render(): void {
    const spec = this.spec;
    if (!spec) return;
    const holy = spec.tone === 'holy';
    this.titleEl.textContent = spec.title;
    this.titleEl.style.display = spec.title ? 'block' : 'none';
    this.subtitleEl.textContent = spec.subtitle ?? '';
    this.subtitleEl.style.display = spec.subtitle ? 'block' : 'none';
    this.rebuildRows();
    const accent = holy ? '#8a6a14' : '#e8c76a';
    const normal = holy ? '#3a3226' : '#cfd2da';
    const dim = holy ? '#b0a58c' : '#4a4f5a';
    const subNormal = holy ? '#6c5f48' : '#6c7280';
    const subDim = holy ? '#c4b99e' : '#454a54';
    spec.entries.forEach((en, i) => {
      const r = this.rows[i]!;
      const enabled = en.enabled !== false;
      const here = enabled && i === this.selected;
      r.row.style.borderLeftColor = here ? accent : 'transparent';
      r.row.style.background = here ? (holy ? 'rgba(138,106,20,0.10)' : 'rgba(232,199,106,0.08)') : 'transparent';
      r.row.style.cursor = enabled ? 'pointer' : 'default';
      r.label.style.color = !enabled ? dim : here ? accent : en.current ? '#5fae4a' : normal;
      r.sub.style.color = enabled ? subNormal : subDim;
    });
    const canClose = spec.closable !== false;
    this.footEl.textContent =
      spec.footer ??
      (this.padMode
        ? `D-패드 ↑↓ 선택   A 결정${canClose ? '   B 닫기' : ''}`
        : `W/S·↑↓ 선택   Enter·클릭 결정   숫자키 바로 고르기${canClose ? '   E / Esc 닫기' : ''}`);
  }
}
