// 게임패드 입력 — 폴링·데드존·키 매핑. 게임 로직은 이 파일을 모른다.
//
// 시스템들은 InputSnapshot 만 읽으므로(Space↔Shift 를 맞바꿀 때 증명됐다) 패드 지원은
// "스냅샷을 채우는 방법을 하나 더 만드는 일"이다. 여기서 버튼을 뜻으로 바꿔 주면
// Input 이 그대로 스냅샷에 얹는다.
//
// 브라우저 Gamepad API 는 이벤트가 아니라 폴링이다. poll() 을 sample() 이 틱당 한 번
// 부르므로 고정 60Hz 와 자연히 맞는다.

import { balance } from './Balance';

/** 패드에 걸 수 있는 기능. 라벨은 리매핑 화면이 그대로 쓴다 */
export const PAD_ACTIONS = [
  { id: 'ranged', label: '원거리 발사 / 활 당기기' },
  { id: 'melee', label: '근접 · 처형' },
  { id: 'reaction', label: '반응 (패링 · 방패)' },
  { id: 'dodge', label: '회피' },
  { id: 'sprint', label: '질주' },
  { id: 'cycleWeapon', label: '원거리 무기 교체' },
  { id: 'interact', label: '상호작용 (문 · 제단 · 상자)' },
  { id: 'reload', label: '재장전 / 시위 내리기' },
  { id: 'cast', label: '선택한 스킬 사용 (가운데 클릭)' },
  { id: 'cycleSkill', label: '스킬 교체 — 퀵슬롯 회전 (Q)' },
  { id: 'skill1', label: '스킬 1 (Z)' },
  { id: 'skill2', label: '스킬 2 (X)' },
  { id: 'skill3', label: '스킬 3 (C)' },
  { id: 'skill4', label: '스킬 4 (V)' },
  { id: 'lantern', label: '랜턴 켜기 · 끄기 (길게 = 배터리 교체)' },
  { id: 'battery', label: '배터리 교체 (기본은 랜턴 길게)' },
  { id: 'inventory', label: '가방 · 스킬 열기' },
  { id: 'pause', label: '일시정지 (메뉴 · 이 설정 화면)' },
  { id: 'slot1', label: '퀵슬롯 1' },
  { id: 'slot2', label: '퀵슬롯 2' },
  { id: 'slot3', label: '퀵슬롯 3' },
  { id: 'slot4', label: '퀵슬롯 4' },
] as const;

export type PadAction = (typeof PAD_ACTIONS)[number]['id'];

/** Xbox 호환 패드(W3C standard gamepad) 버튼 이름. 리매핑 화면이 보여 준다 */
export const BUTTON_NAMES: Record<number, string> = {
  0: 'A', 1: 'B', 2: 'X', 3: 'Y',
  4: 'LB', 5: 'RB', 6: 'LT', 7: 'RT',
  8: 'View', 9: 'Menu', 10: 'L3', 11: 'R3',
  12: 'D-패드 ↑', 13: 'D-패드 ↓', 14: 'D-패드 ←', 15: 'D-패드 →',
  16: 'Guide',
};

export function buttonName(index: number): string {
  if (index < 0) return '(없음)';
  return BUTTON_NAMES[index] ?? `버튼 ${index}`;
}

/** 기본 매핑 (Xbox 배치 기준).
 *  - 가장 많이 쓰는 발사·근접은 오른쪽 트리거·범퍼로
 *  - 패링은 타이밍이 생명이라 트리거(행정 있음)보다 LB 가 낫지만, 방패를 "당겨 든다"는
 *    감각이 LT 쪽이 강해 LT 로 뒀다. 늦게 들어간다고 느끼면 리매핑에서 LB 로 바꾸면 된다
 *  - 회피는 소울류 관례대로 B
 *  - 퀵슬롯은 D-패드 ↑→↓ 셋 (소모품이 3종류라 충분하다). 남은 ← 는 스킬 교체
 *  - 배터리 교체는 R3 를 길게 — 랜턴 조작 둘을 한 버튼에
 *  - View 는 일시정지에 남겨 둔다 — 패드만 쓰는 사람이 메뉴·이 설정 화면에 오는
 *    유일한 길이라, 다른 기능을 걸면 스스로를 가둔다 */
export const DEFAULT_BINDINGS: Record<PadAction, number> = {
  ranged: 7, // RT
  melee: 5, // RB
  reaction: 6, // LT
  dodge: 1, // B
  sprint: 10, // L3
  cycleWeapon: 4, // LB
  interact: 0, // A
  reload: 2, // X
  cast: 3, // Y — 선택한 스킬 칸 사용. 칸 직접 지정(skill2~4)은 버튼이 모자라 비워 뒀다
  cycleSkill: 14, // D-패드 ← — 스킬 칸 회전. 배터리가 있던 자리다
  skill1: -1,
  skill2: -1,
  skill3: -1,
  skill4: -1,
  lantern: 11, // R3
  battery: -1, // 랜턴(R3) 길게 누르기가 맡는다 — 버튼이 모자라 한 버튼에 둘을 얹었다
  inventory: 9, // Menu
  pause: 8, // View — 이게 없으면 패드만 쓰는 사람은 이 설정 화면에 영영 못 온다
  slot1: 12, // D-패드 ↑
  slot2: 15, // D-패드 →
  slot3: 13, // D-패드 ↓
  slot4: -1, // 자리가 없다. 슬라이스의 소모품은 3종류라 셋이면 충분하고,
  //             필요하면 이 화면에서 직접 걸면 된다
};

const STORAGE_KEY = 'underworld.gamepad.bindings';

/** 축 데드존 + 응답 곡선. 중앙부를 눌러 정밀 조준을 살린다 */
function curve(value: number, deadzone: number, exponent: number): number {
  const mag = Math.abs(value);
  if (mag <= deadzone) return 0;
  // 데드존 바깥을 0~1 로 다시 편다 — 안 그러면 데드존 경계에서 값이 튄다
  const scaled = (mag - deadzone) / (1 - deadzone);
  return Math.sign(value) * Math.pow(scaled, exponent);
}

export interface PadAxes {
  moveX: number;
  moveY: number;
  lookX: number;
  lookY: number;
}

export class GamepadInput {
  private bindings: Record<PadAction, number> = { ...DEFAULT_BINDINGS };
  /** 직전 폴링에서 눌려 있던 버튼 — 엣지 계산용 */
  private prev = new Set<number>();
  private now = new Set<number>();
  private axesRaw: number[] = [];
  private padIndex: number | null = null;
  private lastInputMs = 0;

  constructor() {
    this.load();
  }

  // ---- 폴링 ----

  /** 틱당 한 번. 버튼 상태와 축을 갱신한다 */
  poll(): void {
    const pads = navigator.getGamepads?.() ?? [];
    // 가장 먼저 연결된 살아 있는 패드를 쓴다 (여러 개를 붙일 이유가 없다)
    let pad: Gamepad | null = null;
    for (const p of pads) {
      if (p && p.connected) {
        pad = p;
        break;
      }
    }
    this.padIndex = pad ? pad.index : null;

    this.prev = this.now;
    this.now = new Set<number>();
    this.axesRaw = pad ? [...pad.axes] : [];
    if (!pad) return;

    const threshold = balance.input.gamepad.triggerThreshold;
    pad.buttons.forEach((b, i) => {
      // 트리거는 아날로그다 — pressed 만 보면 브라우저마다 문턱이 달라진다
      if (b.pressed || b.value >= threshold) this.now.add(i);
    });

    this.sawInput = this.now.size > 0 || this.axesRaw.some((a) => Math.abs(a) > 0.5);
    if (this.sawInput) this.lastInputMs = performance.now();
  }

  /** 이번 poll 에서 실제 입력이 있었나 — "마지막으로 쓴 장치" 판정용 */
  private sawInput = false;
  get touched(): boolean {
    return this.sawInput;
  }

  get connected(): boolean {
    return this.padIndex !== null;
  }

  /** 최근에 실제로 만진 패드인가 — 포인터 락 없이도 게임을 돌릴지 판단하는 데 쓴다.
   *  꽂혀만 있고 키보드로 노는 사람에게 일시정지가 안 걸리면 그게 더 곤란하다 */
  get active(): boolean {
    if (!this.connected) return false;
    return performance.now() - this.lastInputMs < balance.input.gamepad.activeTimeoutMs;
  }

  // ---- 버튼 ----

  held(action: PadAction): boolean {
    return this.now.has(this.bindings[action]);
  }

  pressed(action: PadAction): boolean {
    const b = this.bindings[action];
    return this.now.has(b) && !this.prev.has(b);
  }

  released(action: PadAction): boolean {
    const b = this.bindings[action];
    return !this.now.has(b) && this.prev.has(b);
  }

  /** 매핑을 거치지 않은 버튼 번호로 직접 묻는다 — 리매핑 화면 자신은 고정 버튼을
   *  써야 한다. 매핑을 잘못 걸어 놓고 그 화면에서 못 빠져나오면 손쓸 방법이 없다 */
  rawPressed(button: number): boolean {
    return this.now.has(button) && !this.prev.has(button);
  }

  /** 이번 폴링에 새로 눌린 버튼 하나 — 리매핑 화면이 "아무 버튼이나 누르세요"에 쓴다 */
  firstNewButton(): number | null {
    for (const b of this.now) if (!this.prev.has(b)) return b;
    return null;
  }

  // ---- 축 ----

  axes(): PadAxes {
    const cfg = balance.input.gamepad;
    const a = this.axesRaw;
    return {
      moveX: curve(a[0] ?? 0, cfg.moveDeadzone, 1), // 이동은 선형 — 곡선을 주면 걷기가 어렵다
      moveY: curve(a[1] ?? 0, cfg.moveDeadzone, 1),
      lookX: curve(a[2] ?? 0, cfg.lookDeadzone, cfg.lookCurve),
      lookY: curve(a[3] ?? 0, cfg.lookDeadzone, cfg.lookCurve),
    };
  }

  // ---- 매핑 ----

  binding(action: PadAction): number {
    return this.bindings[action];
  }

  allBindings(): Record<PadAction, number> {
    return { ...this.bindings };
  }

  /** 같은 버튼을 두 기능에 걸면 먼저 쓰던 쪽을 비운다 — 눌렀는데 둘이 같이 나가면
   *  어느 쪽이 의도인지 알 수 없다. 비워진 쪽은 -1 (안 걸림) */
  bind(action: PadAction, button: number): void {
    for (const key of Object.keys(this.bindings) as PadAction[]) {
      if (key !== action && this.bindings[key] === button) this.bindings[key] = -1;
    }
    this.bindings[action] = button;
    this.save();
  }

  unbind(action: PadAction): void {
    this.bindings[action] = -1;
    this.save();
  }

  resetToDefaults(): void {
    this.bindings = { ...DEFAULT_BINDINGS };
    this.save();
  }

  private save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.bindings));
    } catch {
      // 저장이 막힌 브라우저(사생활 보호 모드 등) — 이번 판만 유지된다
    }
  }

  private load(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as Partial<Record<PadAction, number>>;
      // 저장본에 없는 기능은 기본값을 쓴다 — 나중에 기능이 늘어도 설정이 깨지지 않는다
      for (const { id } of PAD_ACTIONS) {
        const v = saved[id];
        if (typeof v === 'number') this.bindings[id] = v;
      }
    } catch {
      this.bindings = { ...DEFAULT_BINDINGS };
    }
  }
}
