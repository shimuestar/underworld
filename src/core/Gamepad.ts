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
  { id: 'ranged', label: '조준 — 누른 채 근접 버튼 = 발사 (에임 보정)' },
  { id: 'melee', label: '근접 · 처형 (조준 중엔 발사)' },
  { id: 'reaction', label: '반응 (패링 · 방패)' },
  { id: 'dodge', label: '회피' },
  { id: 'sprint', label: '질주' },
  { id: 'cycleWeapon', label: '원거리 무기 교체' },
  { id: 'interact', label: '상호작용 (문 · 제단 · 상자)' },
  { id: 'reload', label: '재장전 / 시위 내리기' },
  { id: 'lockOn', label: '타겟 락온 켜기 · 끄기' },
  { id: 'lantern', label: '랜턴 켜기 · 끄기 (길게 = 배터리 교체)' },
  { id: 'battery', label: '배터리 교체 (기본은 랜턴 길게)' },
  { id: 'inventory', label: '가방 · 스킬 열기' },
  { id: 'pause', label: '일시정지 (메뉴 · 이 설정 화면)' },
  // ── 스킬 조합 — 선택 버튼을 누른 채 대상 버튼 (설정 화면이 이 순서로 묶어 보여 준다)
  { id: 'skillSelect', label: '스킬 선택 (누른 채 아래 버튼)' },
  { id: 'skill1', label: '스킬 1 = 선택 + 이 버튼' },
  { id: 'skill2', label: '스킬 2 = 선택 + 이 버튼' },
  { id: 'skill3', label: '스킬 3 = 선택 + 이 버튼' },
  { id: 'skill4', label: '스킬 4 = 선택 + 이 버튼' },
  // ── 소모품 조합
  { id: 'itemSelect', label: '소모품 선택 (누른 채 아래 버튼)' },
  { id: 'slot1', label: '퀵슬롯 1 = 선택 + 이 버튼' },
  { id: 'slot2', label: '퀵슬롯 2 = 선택 + 이 버튼' },
  { id: 'slot3', label: '퀵슬롯 3 = 선택 + 이 버튼' },
  { id: 'slot4', label: '퀵슬롯 4 = 선택 + 이 버튼' },
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

/** 기본 매핑 (Xbox 배치 기준) — 칩(조합) 방식. 2026-08-31 사용자 실측 배치를 기본으로 승격:
 *  - 조준 = LT · 근접/발사 = RT, 반응 = Y, 회피 = A, 상호작용 = B, 재장전 = X (2026-09-01 스왑)
 *  - 스킬: skillSelect(RB)를 누른 채 Y·B·A·X = 스킬 1~4 — 회전 선택 대신 직접 시전.
 *    조합 레이어 중엔 그 버튼들의 평상시 기능(회피·상호작용 등)이 눌리지 않는다
 *  - 소모품: itemSelect(LB)를 누른 채 D-패드 ↑→↓← = 퀵슬롯 1~4
 *  - 평상시 D-패드: ← 원거리 무기 교체, ↓ 배터리 교체 (랜턴 R3 길게로도 가능)
 *  - View 는 일시정지에 남겨 둔다 — 패드만 쓰는 사람이 메뉴·키 설정 화면에 오는
 *    유일한 길이라, 다른 기능을 걸면 스스로를 가둔다 */
export const DEFAULT_BINDINGS: Record<PadAction, number> = {
  ranged: 6, // LT
  melee: 7, // RT
  reaction: 3, // Y
  dodge: 0, // A
  sprint: 10, // L3
  cycleWeapon: 14, // D-패드 ← (평상시)
  interact: 1, // B
  reload: 2, // X
  skillSelect: 5, // RB — 누른 채 스킬 버튼
  skill1: 3, // 선택 + Y
  skill2: 1, // 선택 + B
  skill3: 0, // 선택 + A
  skill4: 2, // 선택 + X
  itemSelect: 4, // LB — 누른 채 D-패드
  lockOn: 11, // R3 — 소울라이크 관례
  lantern: 12, // D-패드 ↑ (평상시. 소모품 선택+↑ 퀵슬롯 1과는 단독/조합 공존)
  battery: 13, // D-패드 ↓ (평상시). 랜턴(R3) 길게로도 된다
  inventory: 9, // Menu
  pause: 8, // View — 이게 없으면 패드만 쓰는 사람은 이 설정 화면에 영영 못 온다
  slot1: 12, // 선택 + D-패드 ↑
  slot2: 15, // 선택 + D-패드 →
  slot3: 13, // 선택 + D-패드 ↓
  slot4: 14, // 선택 + D-패드 ←
};

// v2 (2026-08-31): 칩(조합) 개편 — 구 저장본(skill1~4 = -1, cast/cycleSkill)이 새 기본값을
// 덮어쓰면 스킬 조합이 통째로 죽는다. 키를 올려 새 구조로 새로 시작한다
// v3 (2026-09-01): 락온(R3) 추가·랜턴 D-패드 ↑ 이동 — 구 저장본의 lantern=R3 가
// 새 lockOn 기본과 겹친다. 현 기본값이 곧 직전 사용자 배치라 리셋 손실이 없다
// v4 (2026-09-01): 반응 X→Y, 재장전 Y→X 스왑 — 구 저장본이 새 기본을 덮지 않게
const STORAGE_KEY = 'underworld.gamepad.bindings.v4';

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

const CHORD_SKILLS: readonly PadAction[] = ['skill1', 'skill2', 'skill3', 'skill4'];
const CHORD_SLOTS: readonly PadAction[] = ['slot1', 'slot2', 'slot3', 'slot4'];

/** 두 기능이 같은 버튼을 나눠 쓸 수 있는가 — 단독(평상시)과 조합(레이어) 하나씩은 공존한다.
 *  막는 것: 단독끼리 / 같은 레이어 조합끼리 / 선택 버튼과 그 선택이 무력화하는 대상.
 *  스킬 레이어가 소모품 레이어보다 우선하므로 skillSelect 는 스킬·퀵슬롯 대상 모두와
 *  못 겹치고, itemSelect 는 스킬 대상과는 겹쳐도 된다 — 기본값(Y = itemSelect = 스킬 1)이 그 예 */
export function bindingConflicts(a: PadAction, b: PadAction): boolean {
  const grp = (x: PadAction): 'skill' | 'slot' | 'plain' =>
    CHORD_SKILLS.includes(x) ? 'skill' : CHORD_SLOTS.includes(x) ? 'slot' : 'plain';
  const ga = grp(a);
  const gb = grp(b);
  if (ga === 'plain' && gb === 'plain') return true; // 단독끼리
  if (ga === gb) return true; // 같은 레이어 조합끼리
  const pair = (m: PadAction, g: 'skill' | 'slot'): boolean =>
    (a === m && gb === g) || (b === m && ga === g);
  if (pair('skillSelect', 'skill') || pair('skillSelect', 'slot')) return true;
  if (pair('itemSelect', 'slot')) return true;
  return false;
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

  /** 진동 — 지원 패드(dual-rumble)에서만, 실패는 조용히 무시. 새 효과가 이전 것을 덮는다 */
  rumble(ms: number, strong: number, weak: number): void {
    if (this.padIndex === null) return;
    const pad = navigator.getGamepads?.()[this.padIndex];
    const actuator = (
      pad as { vibrationActuator?: { playEffect?: (type: string, params: object) => Promise<unknown> } } | null
    )?.vibrationActuator;
    void actuator?.playEffect?.('dual-rumble', {
      duration: ms,
      strongMagnitude: strong,
      weakMagnitude: weak,
    })?.catch(() => {});
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
    // 충돌하는 기능만 뺏는다 — 단독(평상시)과 조합(레이어)은 같은 버튼을 나눠 쓴다
    for (const key of Object.keys(this.bindings) as PadAction[]) {
      if (key !== action && this.bindings[key] === button && bindingConflicts(action, key)) {
        this.bindings[key] = -1;
      }
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
