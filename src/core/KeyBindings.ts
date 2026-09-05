// 키보드 키 설정 — 기능 → KeyboardEvent.code. 패드(core/Gamepad)와 같은 규약:
// localStorage 저장 · 기본값 복원 · 같은 키를 다른 기능에 걸면 먼저 쓰던 쪽이 (없음).
// 마우스(좌 = 원거리 · 우 = 근접 · 가운데 = 스킬 · 휠 = 무기)는 고정이다 —
// 조준 장치의 버튼까지 흔들면 얻는 것보다 잃는 게 많다.

export const KEY_ACTIONS = [
  { id: 'forward', label: '앞으로' },
  { id: 'back', label: '뒤로' },
  { id: 'left', label: '왼쪽' },
  { id: 'right', label: '오른쪽' },
  { id: 'sprint', label: '질주 (연타 = 회피)' },
  { id: 'reaction', label: '반응 (패링 · 방패)' },
  { id: 'interact', label: '상호작용 (문 · 제단 · 상자)' },
  { id: 'reload', label: '재장전 / 시위 내리기' },
  { id: 'lantern', label: '랜턴 켜기 · 끄기' },
  { id: 'battery', label: '배터리 교체' },
  { id: 'cycleSkill', label: '스킬 교체 — 선택 칸 회전' },
  { id: 'skill1', label: '스킬 1' },
  { id: 'skill2', label: '스킬 2' },
  { id: 'skill3', label: '스킬 3' },
  { id: 'skill4', label: '스킬 4' },
  { id: 'slot1', label: '퀵슬롯 1' },
  { id: 'slot2', label: '퀵슬롯 2' },
  { id: 'slot3', label: '퀵슬롯 3' },
  { id: 'slot4', label: '퀵슬롯 4' },
  { id: 'slot5', label: '퀵슬롯 5' },
  { id: 'inventory', label: '메뉴 창 — 가방 탭 열기' },
  { id: 'map', label: '메뉴 창 — 맵 탭 열기' },
  { id: 'lockOn', label: '타겟 락온 켜기 · 끄기 (기본 비움)' },
] as const;

export type KeyAction = (typeof KEY_ACTIONS)[number]['id'];

export const DEFAULT_KEY_BINDINGS: Record<KeyAction, string> = {
  forward: 'KeyW',
  back: 'KeyS',
  left: 'KeyA',
  right: 'KeyD',
  sprint: 'Space',
  reaction: 'ShiftLeft',
  interact: 'KeyE',
  reload: 'KeyR',
  lantern: 'KeyF',
  battery: 'KeyB',
  cycleSkill: 'KeyQ',
  skill1: 'KeyZ',
  skill2: 'KeyX',
  skill3: 'KeyC',
  skill4: 'KeyV',
  slot1: 'Digit1',
  slot2: 'Digit2',
  slot3: 'Digit3',
  slot4: 'Digit4',
  slot5: 'Digit5',
  inventory: 'KeyI',
  map: 'KeyM',
  lockOn: '', // 마우스 유저는 불필요 — 원하면 설정에서 건다
};

const STORAGE_KEY = 'underworld.keybindings.v1';

/** KeyboardEvent.code → 사람이 읽는 짧은 표기 */
export function keyName(code: string): string {
  if (!code) return '(없음)';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  const MAP: Record<string, string> = {
    Space: 'Space',
    ShiftLeft: 'LShift',
    ShiftRight: 'RShift',
    ControlLeft: 'LCtrl',
    ControlRight: 'RCtrl',
    AltLeft: 'LAlt',
    AltRight: 'RAlt',
    ArrowUp: '↑',
    ArrowDown: '↓',
    ArrowLeft: '←',
    ArrowRight: '→',
    Backquote: '`',
    Minus: '-',
    Equal: '=',
    BracketLeft: '[',
    BracketRight: ']',
    Semicolon: ';',
    Quote: "'",
    Comma: ',',
    Period: '.',
    Slash: '/',
    Backslash: '\\',
    CapsLock: 'Caps',
    Enter: 'Enter',
  };
  return MAP[code] ?? code;
}

export class KeyBindings {
  private bindings: Record<KeyAction, string> = { ...DEFAULT_KEY_BINDINGS };

  constructor() {
    this.load();
  }

  code(action: KeyAction): string {
    return this.bindings[action];
  }

  label(action: KeyAction): string {
    return keyName(this.bindings[action]);
  }

  isDefault(action: KeyAction): boolean {
    return this.bindings[action] === DEFAULT_KEY_BINDINGS[action];
  }

  /** 반응 키가 시프트면 좌·우를 한 키로 본다 — 한쪽을 쥔 채 반대쪽을
   *  눌렀다 떼도 "손을 뗐다"가 되지 않게 (기존 SHIFT_CODES 규칙 유지) */
  codesOf(action: KeyAction): string[] {
    const c = this.bindings[action];
    if (c === 'ShiftLeft' || c === 'ShiftRight') return ['ShiftLeft', 'ShiftRight'];
    return c ? [c] : [];
  }

  /** 같은 키를 다른 기능에 걸면 먼저 쓰던 기능이 (없음)이 된다 — 패드와 같은 규칙 */
  bind(action: KeyAction, code: string): void {
    for (const { id } of KEY_ACTIONS) {
      if (id !== action && this.bindings[id] === code) this.bindings[id] = '';
    }
    this.bindings[action] = code;
    this.save();
  }

  unbind(action: KeyAction): void {
    this.bindings[action] = '';
    this.save();
  }

  resetToDefaults(): void {
    this.bindings = { ...DEFAULT_KEY_BINDINGS };
    this.save();
  }

  private save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.bindings));
    } catch {
      // 저장이 막힌 환경(사생활 보호 모드·테스트) — 이번 판만 유지된다
    }
  }

  private load(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as Partial<Record<KeyAction, string>>;
      // 저장본에 없는 기능은 기본값을 쓴다 — 나중에 기능이 늘어도 설정이 깨지지 않는다
      for (const { id } of KEY_ACTIONS) {
        const v = saved[id];
        if (typeof v === 'string') this.bindings[id] = v;
      }
    } catch {
      this.bindings = { ...DEFAULT_KEY_BINDINGS };
    }
  }
}

/** 공용 인스턴스 — Input 과 설정 화면(GamepadUI)이 같은 것을 본다 */
export const keyBindings = new KeyBindings();
