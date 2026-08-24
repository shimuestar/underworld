// 패드 키 설정 화면 — 일시정지 메뉴에서 연다. DOM 오버레이.
//
// 조작 규약: 줄을 고르고 "설정"을 누르면 대기 상태가 되고, 그때 누른 패드 버튼이
// 그 기능에 걸린다. 패드만 쓰는 사람도 여기까지 올 수 있어야 하므로 마우스 없이
// D-패드·A 만으로 전부 돌아간다 (마우스 클릭도 함께 받는다).

import {
  buttonName,
  DEFAULT_BINDINGS,
  PAD_ACTIONS,
  type GamepadInput,
  type PadAction,
} from '../core/Gamepad';

const CELL = 'display:flex;gap:12px;padding:5px 10px;align-items:baseline;border-top:1px solid #23232b;';

export class GamepadUI {
  private readonly root: HTMLDivElement;
  open = false;
  private selected = 0;
  /** 버튼 입력을 기다리는 중인 기능 (null 이면 대기 아님) */
  private capturing: PadAction | null = null;
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
        // 대기 중 Esc 는 취소 — 키보드로도 빠져나올 수 있어야 한다
        if (e.code === 'Escape') {
          e.preventDefault();
          this.capturing = null;
          this.rebuild();
        }
        return;
      }
      if (e.code === 'ArrowUp' || e.code === 'KeyW') {
        e.preventDefault();
        this.move(-1);
      } else if (e.code === 'ArrowDown' || e.code === 'KeyS') {
        e.preventDefault();
        this.move(1);
      } else if (e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Space') {
        e.preventDefault();
        this.beginCapture();
      } else if (e.code === 'Delete' || e.code === 'Backspace') {
        e.preventDefault();
        this.pad.unbind(PAD_ACTIONS[this.selected]!.id);
        this.rebuild();
      } else if (e.code === 'Escape' || e.code === 'Tab') {
        e.preventDefault();
        this.hide();
        this.onClose?.();
      }
    });
  }

  show(): void {
    this.open = true;
    this.selected = 0;
    this.capturing = null;
    this.root.style.display = 'flex';
    this.rebuild();
  }

  hide(): void {
    this.open = false;
    this.capturing = null;
    this.root.style.display = 'none';
  }

  /** 프레임마다 main 이 부른다 — 대기 중이면 눌린 버튼을 잡아 매핑한다.
   *  일시정지 중이라 시뮬레이션이 안 도는 상태에서도 여기만은 돌아야 한다 */
  poll(): void {
    if (!this.open) return;
    if (this.capturing) {
      const button = this.pad.firstNewButton();
      if (button === null) return;
      this.pad.bind(this.capturing, button);
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
    } else if (this.pad.rawPressed(3)) { // Y — 기본값으로
      this.pad.resetToDefaults();
      this.rebuild();
    }
  }

  private move(step: number): void {
    const n = PAD_ACTIONS.length;
    this.selected = (this.selected + step + n) % n;
    this.rebuild();
  }

  private beginCapture(): void {
    this.capturing = PAD_ACTIONS[this.selected]!.id;
    this.rebuild();
  }

  private rebuild(): void {
    const panel = document.createElement('div');
    panel.style.cssText =
      'background:#15151b;border:1px solid #3a3a44;padding:20px 26px;min-width:520px;max-height:82vh;overflow:auto;';

    const title = document.createElement('div');
    title.textContent = `패드 키 설정   ${this.pad.connected ? '' : '(패드가 연결되지 않았다)'}`;
    title.style.cssText = `color:${this.pad.connected ? '#9fe870' : '#a05050'};margin-bottom:4px;font-size:15px;`;
    panel.appendChild(title);

    const sub = document.createElement('div');
    sub.textContent = '이동 = 왼쪽 스틱 · 시선 = 오른쪽 스틱 (고정)';
    sub.style.cssText = 'color:#6c7280;margin-bottom:12px;font-size:11px;';
    panel.appendChild(sub);

    PAD_ACTIONS.forEach((action, i) => {
      const here = i === this.selected;
      const bound = this.pad.binding(action.id);
      const waiting = this.capturing === action.id;
      const row = document.createElement('div');
      row.style.cssText =
        CELL +
        (here ? 'background:#242a36;box-shadow:inset 2px 0 0 #7fbfff;' : '') +
        'cursor:pointer;';
      row.onmousemove = () => {
        if (this.selected === i || this.capturing) return;
        this.selected = i;
        this.rebuild();
      };
      row.onclick = () => {
        if (this.capturing) return;
        this.selected = i;
        this.beginCapture();
      };

      const name = document.createElement('span');
      name.textContent = action.label;
      name.style.cssText = 'width:250px;';
      row.appendChild(name);

      const value = document.createElement('span');
      if (waiting) {
        value.textContent = '패드 버튼을 누르세요…';
        value.style.color = '#e8c76a';
      } else if (bound < 0) {
        value.textContent = '(없음)';
        value.style.color = '#a05050';
      } else {
        value.textContent = buttonName(bound);
        // 기본값에서 바뀐 줄은 눈에 띄게 — 뭘 만졌는지 한눈에 보이게
        value.style.color = bound === DEFAULT_BINDINGS[action.id] ? '#cfd2da' : '#7fbfff';
      }
      value.style.width = '110px';
      row.appendChild(value);
      panel.appendChild(row);
    });

    const hint = document.createElement('div');
    hint.textContent =
      '패드: D-패드 ↑↓ 선택 · A 설정 · Y 기본값 · B 닫기   |   ' +
      '키보드: ↑↓ 선택 · Enter 설정 · Delete 해제 · Esc 닫기';
    hint.style.cssText = 'margin-top:14px;color:#6c7280;font-size:11px;';
    panel.appendChild(hint);

    const note = document.createElement('div');
    note.textContent =
      '같은 버튼을 다른 기능에 걸면 먼저 쓰던 쪽이 (없음)이 된다. 설정은 이 브라우저에 저장된다.';
    note.style.cssText = 'margin-top:6px;color:#555c66;font-size:11px;';
    panel.appendChild(note);

    this.root.replaceChildren(panel);
  }
}
