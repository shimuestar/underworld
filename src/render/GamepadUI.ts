// 키 설정 화면 — 키보드 화면과 패드 화면을 따로 연다 (일시정지 메뉴의 두 항목).
//
// 조작 규약: 줄을 고르고 "설정"에 들어가면 대기 상태가 되고, 그때 누른
// 키보드 키(키보드 줄) 또는 패드 버튼(패드 줄)이 그 기능에 걸린다.
// 패드만 쓰는 사람도 여기까지 올 수 있어야 하므로 D-패드·A 만으로 전부 돌아가고
// (이 화면의 조작 버튼만은 리매핑과 무관하게 고정), 마우스 클릭도 함께 받는다.

import {
  buttonName,
  DEFAULT_BINDINGS,
  PAD_ACTIONS,
  type GamepadInput,
  type PadAction,
} from '../core/Gamepad';
import {
  KEY_ACTIONS,
  keyBindings,
  keyName,
  type KeyAction,
} from '../core/KeyBindings';

const CELL = 'display:flex;gap:12px;padding:4px 10px;align-items:baseline;border-top:1px solid #23232b;';
const HEADER = 'margin:10px 0 2px;font-size:12px;letter-spacing:1px;color:#8fb7e0;';

/** 패드 화면의 그룹 머리글 — 이 기능 줄 앞에 끼워 넣는다 (조합은 묶어서 보여 준다) */
const PAD_GROUP_HEADERS: Partial<Record<PadAction, string>> = {
  ranged: '── 기본 ──',
  skillSelect: '── 스킬 조합 — 선택 버튼 + 스킬 버튼 ──',
  itemSelect: '── 소모품 조합 — 선택 버튼 + D-패드 ──',
};

/** 한 줄 = 한 기능 — 화면 모드에 따라 키보드 목록 또는 패드 목록만 보여 준다 */
type Row = { kind: 'kb'; id: KeyAction; label: string } | { kind: 'pad'; id: PadAction; label: string };
export type BindingsMode = 'kb' | 'pad';

const KB_ROWS: Row[] = KEY_ACTIONS.map((a) => ({ kind: 'kb' as const, id: a.id, label: a.label }));
const PAD_ROWS: Row[] = PAD_ACTIONS.map((a) => ({ kind: 'pad' as const, id: a.id, label: a.label }));

/** 다이어그램용 짧은 기능 이름 — 콜아웃 한 줄에 여러 개가 붙는다 */
const SHORT_LABEL: Record<PadAction, string> = {
  ranged: '조준', melee: '근접·발사', reaction: '반응', dodge: '회피', sprint: '질주', lockOn: '락온',
  cycleWeapon: '무기 교체', interact: '상호작용', reload: '재장전', lantern: '랜턴',
  battery: '배터리', inventory: '가방', pause: '일시정지',
  skillSelect: '스킬 선택', skill1: '스킬 1', skill2: '스킬 2', skill3: '스킬 3', skill4: '스킬 4',
  itemSelect: '소모품 선택', slot1: '퀵슬롯 1', slot2: '퀵슬롯 2', slot3: '퀵슬롯 3', slot4: '퀵슬롯 4',
};

/** 버튼 이름 축약 — 콜아웃 접두사용 ('D-패드 ↑' → '↑') */
function shortBtn(index: number): string {
  return buttonName(index).replace('D-패드 ', '');
}

/** 엑스박스 패드 다이어그램 SVG — 프리미티브만으로 그린다 (에셋 금지 규칙).
 *  각 버튼 옆 콜아웃에 지금 걸린 기능들을 적는다: 단독 먼저, 조합(선택+대상)은
 *  선택 버튼 이름을 접두사로. highlight 버튼은 파랗게 테두리를 두른다 */
export function padDiagramSvg(bindOf: (a: PadAction) => number, highlight: number): string {
  // 물리 버튼 → 걸린 기능 라벨들
  const byButton = new Map<number, string[]>();
  const add = (b: number, label: string): void => {
    if (b < 0) return;
    if (!byButton.has(b)) byButton.set(b, []);
    byButton.get(b)!.push(label);
  };
  const skillSel = bindOf('skillSelect');
  const itemSel = bindOf('itemSelect');
  for (const { id } of PAD_ACTIONS) {
    const b = bindOf(id);
    if (b < 0) continue;
    if (id.startsWith('skill') && id !== 'skillSelect') {
      add(b, `${shortBtn(skillSel)}+${SHORT_LABEL[id]}`);
    } else if (id.startsWith('slot')) {
      add(b, `${shortBtn(itemSel)}+${SHORT_LABEL[id]}`);
    } else {
      // 단독 기능이 조합보다 먼저 읽히게 앞에 끼운다
      if (!byButton.has(b)) byButton.set(b, []);
      byButton.get(b)!.unshift(SHORT_LABEL[id]);
    }
  }

  const BTN = '#33333c';
  const EDGE = '#4a4a55';
  const TXT = '#cfd2da';
  const LINE = '#55555f';
  const parts: string[] = [];
  const esc = (t: string): string => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');

  // ── 몸통 (실루엣 — 획 없이 면으로만)
  parts.push('<rect x="198" y="78" width="244" height="140" rx="36" fill="#26262e"/>');
  parts.push('<circle cx="230" cy="210" r="56" fill="#26262e"/>');
  parts.push('<circle cx="410" cy="210" r="56" fill="#26262e"/>');

  // 버튼 기하 — [버튼번호, 종류, 좌표…, 표기]
  type Shape =
    | { b: number; kind: 'rect'; x: number; y: number; w: number; h: number; t: string }
    | { b: number; kind: 'circle'; x: number; y: number; r: number; t: string; fill?: string; dark?: boolean };
  const shapes: Shape[] = [
    { b: 6, kind: 'rect', x: 180, y: 14, w: 64, h: 22, t: 'LT' },
    { b: 7, kind: 'rect', x: 396, y: 14, w: 64, h: 22, t: 'RT' },
    { b: 4, kind: 'rect', x: 170, y: 46, w: 84, h: 20, t: 'LB' },
    { b: 5, kind: 'rect', x: 386, y: 46, w: 84, h: 20, t: 'RB' },
    { b: 10, kind: 'circle', x: 245, y: 128, r: 24, t: 'L3' },
    { b: 11, kind: 'circle', x: 365, y: 200, r: 24, t: 'R3' },
    { b: 3, kind: 'circle', x: 405, y: 100, r: 13, t: 'Y', fill: '#b9a23f', dark: true },
    { b: 2, kind: 'circle', x: 377, y: 128, r: 13, t: 'X', fill: '#4f7fc0', dark: true },
    { b: 1, kind: 'circle', x: 433, y: 128, r: 13, t: 'B', fill: '#c05555', dark: true },
    { b: 0, kind: 'circle', x: 405, y: 156, r: 13, t: 'A', fill: '#62a852', dark: true },
    { b: 8, kind: 'circle', x: 304, y: 118, r: 7, t: '' },
    { b: 9, kind: 'circle', x: 336, y: 118, r: 7, t: '' },
    { b: 12, kind: 'rect', x: 271, y: 168, w: 24, h: 24, t: '↑' },
    { b: 14, kind: 'rect', x: 247, y: 192, w: 24, h: 24, t: '←' },
    { b: 13, kind: 'rect', x: 271, y: 216, w: 24, h: 24, t: '↓' },
    { b: 15, kind: 'rect', x: 295, y: 192, w: 24, h: 24, t: '→' },
  ];
  for (const s of shapes) {
    const hl = s.b === highlight;
    const stroke = hl ? '#7fbfff' : EDGE;
    const sw = hl ? 2.5 : 1;
    if (s.kind === 'rect') {
      parts.push(`<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" rx="6" fill="${BTN}" stroke="${stroke}" stroke-width="${sw}"/>`);
      if (s.t) parts.push(`<text x="${s.x + s.w / 2}" y="${s.y + s.h / 2 + 4}" text-anchor="middle" fill="${TXT}" font-size="11" font-family="monospace">${s.t}</text>`);
    } else {
      parts.push(`<circle cx="${s.x}" cy="${s.y}" r="${s.r}" fill="${s.fill ?? BTN}" stroke="${stroke}" stroke-width="${sw}"/>`);
      if (s.t) parts.push(`<text x="${s.x}" y="${s.y + 4}" text-anchor="middle" fill="${s.dark ? '#101014' : TXT}" font-size="11" font-weight="bold" font-family="monospace">${s.t}</text>`);
    }
  }
  parts.push(`<text x="304" y="137" text-anchor="middle" fill="#8a8f99" font-size="7" font-family="monospace">View</text>`);
  parts.push(`<text x="336" y="137" text-anchor="middle" fill="#8a8f99" font-size="7" font-family="monospace">Menu</text>`);

  // 콜아웃 — 왼쪽 열(끝 정렬)과 오른쪽 열(시작 정렬). [버튼, 라벨 y, 버튼쪽 선 끝 x·y]
  const callouts: Array<[number, 'l' | 'r', number, number, number]> = [
    [6, 'l', 25, 180, 25],
    [4, 'l', 56, 170, 56],
    [10, 'l', 128, 221, 128],
    [12, 'l', 172, 271, 180],
    [14, 'l', 204, 247, 204],
    [13, 'l', 236, 271, 228],
    [15, 'l', 266, 307, 218],
    [7, 'r', 25, 460, 25],
    [5, 'r', 56, 470, 56],
    [3, 'r', 96, 418, 100],
    [1, 'r', 128, 446, 128],
    [0, 'r', 158, 418, 156],
    [2, 'r', 192, 381, 140],
    [11, 'r', 226, 387, 206],
    [8, 'r', 258, 306, 126],
    [9, 'r', 288, 338, 126],
  ];
  for (const [b, side, ly, bx, by] of callouts) {
    const labels = byButton.get(b);
    if (!labels || labels.length === 0) continue;
    const tx = side === 'l' ? 145 : 500;
    const lx = side === 'l' ? 150 : 495;
    parts.push(`<line x1="${lx}" y1="${ly}" x2="${bx}" y2="${by}" stroke="${LINE}" stroke-width="1"/>`);
    parts.push(`<text x="${tx}" y="${ly + 3}" text-anchor="${side === 'l' ? 'end' : 'start'}" fill="${TXT}" font-size="10" font-family="monospace">${esc(labels.join(' · '))}</text>`);
  }

  return `<svg viewBox="0 0 640 340" width="560" style="display:block">${parts.join('')}</svg>`;
}

export class GamepadUI {
  private readonly root: HTMLDivElement;
  open = false;
  private mode: BindingsMode = 'pad';
  private selected = 0;
  /** 입력을 기다리는 중인 줄 (null 이면 대기 아님) */
  private capturing: Row | null = null;
  /** 닫힐 때 main 이 일시정지 메뉴로 되돌린다 */
  onClose: (() => void) | null = null;

  constructor(private readonly pad: GamepadInput) {
    this.root = document.createElement('div');
    this.root.id = 'gamepadui';
    this.root.style.cssText =
      'position:fixed;inset:0;display:none;align-items:center;justify-content:center;' +
      'background:rgba(0,0,0,0.82);color:#cfd2da;font:13px/1.6 monospace;user-select:none;z-index:12;';
    document.body.appendChild(this.root);

    window.addEventListener('keydown', (e) => {
      if (!this.open) return;
      if (this.capturing) {
        e.preventDefault();
        // 대기 중 Esc 는 취소 — 키보드로도 빠져나올 수 있어야 한다
        if (e.code === 'Escape') {
          this.capturing = null;
        } else if (this.capturing.kind === 'kb') {
          // 키보드 줄 — 지금 누른 키가 걸린다
          keyBindings.bind(this.capturing.id, e.code);
          this.capturing = null;
        }
        this.rebuild();
        return;
      }
      if (e.code === 'ArrowUp') {
        e.preventDefault();
        this.move(-1);
      } else if (e.code === 'ArrowDown') {
        e.preventDefault();
        this.move(1);
      } else if (e.code === 'Enter' || e.code === 'NumpadEnter') {
        e.preventDefault();
        this.beginCapture();
      } else if (e.code === 'Delete' || e.code === 'Backspace') {
        e.preventDefault();
        const row = this.rows()[this.selected]!;
        if (row.kind === 'kb') keyBindings.unbind(row.id);
        else this.pad.unbind(row.id);
        this.rebuild();
      } else if (e.code === 'Escape' || e.code === 'Tab') {
        e.preventDefault();
        this.hide();
        this.onClose?.();
      }
    });
  }

  show(mode: BindingsMode): void {
    this.open = true;
    this.mode = mode;
    this.selected = 0;
    this.capturing = null;
    this.root.style.display = 'flex';
    this.rebuild();
  }

  private rows(): Row[] {
    return this.mode === 'kb' ? KB_ROWS : PAD_ROWS;
  }

  hide(): void {
    this.open = false;
    this.capturing = null;
    this.root.style.display = 'none';
  }

  /** 프레임마다 main 이 부른다 — 패드 줄 대기 중이면 눌린 버튼을 잡아 매핑한다.
   *  일시정지 중이라 시뮬레이션이 안 도는 상태에서도 여기만은 돌아야 한다 */
  poll(): void {
    if (!this.open) return;
    if (this.capturing) {
      if (this.capturing.kind !== 'pad') return; // 키보드 줄 — keydown 이 잡는다
      const button = this.pad.firstNewButton();
      if (button === null) return;
      this.pad.bind(this.capturing.id, button);
      this.pad.rumble(160, 0.8, 0.8); // 걸렸다는 응답 — 안 울리면 이 브라우저·연결이 진동 미지원
      this.capturing = null;
      this.rebuild();
      return;
    }
    // 대기가 아니면 D-패드로 커서를 옮기고 A 로 설정에 들어간다.
    // 매핑을 바꿔도 이 화면만은 고정 버튼을 쓴다 — 잘못 걸어 놓고 못 빠져나오면 안 된다
    if (this.pad.rawPressed(12)) this.move(-1); // D-패드 ↑
    else if (this.pad.rawPressed(13)) this.move(1); // D-패드 ↓
    else if (this.pad.rawPressed(0)) this.beginCapture(); // A
    else if (this.pad.rawPressed(1)) { // B — 닫기
      this.hide();
      this.onClose?.();
    } else if (this.pad.rawPressed(3)) { // Y — 이 화면의 장치만 기본값으로
      if (this.mode === 'pad') this.pad.resetToDefaults();
      else keyBindings.resetToDefaults();
      this.rebuild();
    }
  }

  private move(step: number): void {
    const n = this.rows().length;
    this.selected = (this.selected + step + n) % n;
    this.rebuild();
  }

  private beginCapture(): void {
    this.capturing = this.rows()[this.selected]!;
    this.rebuild();
  }

  private rebuild(): void {
    const panel = document.createElement('div');
    panel.style.cssText =
      'background:#15151b;border:1px solid #3a3a44;padding:18px 26px;min-width:560px;max-height:88vh;overflow:auto;';

    const title = document.createElement('div');
    if (this.mode === 'kb') {
      title.textContent = '키보드 키 설정';
      title.style.cssText = 'color:#8fb7e0;margin-bottom:2px;font-size:15px;';
    } else {
      title.textContent = `패드 키 설정   ${this.pad.connected ? '' : '(패드가 연결되지 않았다)'}`;
      title.style.cssText = `color:${this.pad.connected ? '#9fe870' : '#a05050'};margin-bottom:2px;font-size:15px;`;
    }
    panel.appendChild(title);

    const sub = document.createElement('div');
    sub.textContent =
      this.mode === 'kb'
        ? '마우스(좌=원거리 · 우=근접 · 휠클릭=스킬 · 휠=무기)는 고정'
        : '이동 = 왼쪽 스틱 · 시선 = 오른쪽 스틱 (고정)';
    sub.style.cssText = 'color:#6c7280;margin-bottom:8px;font-size:11px;';
    panel.appendChild(sub);

    // 패드 모드는 2단 — 왼쪽 목록, 오른쪽 패드 다이어그램 (지금 걸린 키가 그림으로 보인다)
    let rowsHost: HTMLElement = panel;
    if (this.mode === 'pad') {
      const split = document.createElement('div');
      split.style.cssText = 'display:flex;gap:22px;align-items:flex-start;';
      rowsHost = document.createElement('div');
      rowsHost.style.cssText = 'min-width:430px;';
      const diagram = document.createElement('div');
      const selRow = this.rows()[this.selected];
      const hl = selRow && selRow.kind === 'pad' ? this.pad.binding(selRow.id) : -1;
      diagram.innerHTML = padDiagramSvg((a) => this.pad.binding(a), hl);
      diagram.style.cssText = 'position:sticky;top:0;';
      split.appendChild(rowsHost);
      split.appendChild(diagram);
      panel.appendChild(split);
    }

    let selectedRowEl: HTMLDivElement | null = null;
    this.rows().forEach((row, i) => {
      if (row.kind === 'pad') {
        const headerText = PAD_GROUP_HEADERS[row.id];
        if (headerText) {
          const h = document.createElement('div');
          h.textContent = headerText;
          h.style.cssText = HEADER;
          rowsHost.appendChild(h);
        }
      }
      const here = i === this.selected;
      const waiting = this.capturing === row;
      const el = document.createElement('div');
      el.style.cssText =
        CELL +
        (here ? 'background:#242a36;box-shadow:inset 2px 0 0 #7fbfff;' : '') +
        'cursor:pointer;';
      el.onmousemove = () => {
        if (this.selected === i || this.capturing) return;
        this.selected = i;
        this.rebuild();
      };
      el.onclick = () => {
        if (this.capturing) return;
        this.selected = i;
        this.beginCapture();
      };

      const name = document.createElement('span');
      name.textContent = row.label;
      name.style.cssText = 'width:260px;';
      el.appendChild(name);

      const value = document.createElement('span');
      if (waiting) {
        value.textContent = row.kind === 'kb' ? '키보드 키를 누르세요…' : '패드 버튼을 누르세요…';
        value.style.color = '#e8c76a';
      } else if (row.kind === 'kb') {
        const code = keyBindings.code(row.id);
        value.textContent = keyName(code);
        value.style.color = !code ? '#a05050' : keyBindings.isDefault(row.id) ? '#cfd2da' : '#7fbfff';
      } else {
        const bound = this.pad.binding(row.id);
        if (bound < 0) {
          value.textContent = '(없음)';
          value.style.color = '#a05050';
        } else {
          value.textContent = buttonName(bound);
          // 기본값에서 바뀐 줄은 눈에 띄게 — 뭘 만졌는지 한눈에 보이게
          value.style.color = bound === DEFAULT_BINDINGS[row.id] ? '#cfd2da' : '#7fbfff';
        }
      }
      value.style.width = '150px';
      el.appendChild(value);
      rowsHost.appendChild(el);
      if (here) selectedRowEl = el;
    });

    const hint = document.createElement('div');
    hint.textContent =
      '패드: D-패드 ↑↓ 선택 · A 설정 · Y 기본값 · B 닫기   |   ' +
      '키보드: ↑↓ 선택 · Enter 설정 · Delete 해제 · Esc 닫기' +
      (this.mode === 'pad' ? '   |   버튼을 걸면 진동으로 응답한다 (진동 테스트)' : '');
    hint.style.cssText = 'margin-top:12px;color:#6c7280;font-size:11px;';
    panel.appendChild(hint);

    const note = document.createElement('div');
    note.textContent =
      this.mode === 'kb'
        ? '같은 키를 다른 기능에 걸면 먼저 쓰던 쪽이 (없음)이 된다. 설정은 이 브라우저에 저장된다.'
        : '단독 기능과 조합 기능은 같은 버튼을 나눠 쓸 수 있다 (예: B = 회피 · 선택+B = 스킬 4). ' +
          '단독끼리·같은 조합끼리 겹치면 먼저 쓰던 쪽이 (없음)이 된다. 설정은 이 브라우저에 저장된다.';
    note.style.cssText = 'margin-top:4px;color:#555c66;font-size:11px;';
    panel.appendChild(note);

    this.root.replaceChildren(panel);
    // 선택 줄이 항상 보이게 — 목록이 두 구역이라 길다
    (selectedRowEl as HTMLDivElement | null)?.scrollIntoView({ block: 'nearest' });
  }
}
