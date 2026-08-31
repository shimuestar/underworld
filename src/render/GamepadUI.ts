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
      'background:#15151b;border:1px solid #3a3a44;padding:18px 26px;min-width:560px;max-height:84vh;overflow:auto;';

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

    let selectedRowEl: HTMLDivElement | null = null;
    this.rows().forEach((row, i) => {
      if (row.kind === 'pad') {
        const headerText = PAD_GROUP_HEADERS[row.id];
        if (headerText) {
          const h = document.createElement('div');
          h.textContent = headerText;
          h.style.cssText = HEADER;
          panel.appendChild(h);
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
      panel.appendChild(el);
      if (here) selectedRowEl = el;
    });

    const hint = document.createElement('div');
    hint.textContent =
      '패드: D-패드 ↑↓ 선택 · A 설정 · Y 기본값 · B 닫기   |   ' +
      '키보드: ↑↓ 선택 · Enter 설정 · Delete 해제 · Esc 닫기';
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
