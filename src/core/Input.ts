// 입력 수집기. DOM 이벤트를 누적했다가 틱 시작 시 sample()로 스냅샷을 넘긴다.
// 게임 로직은 이 스냅샷(world.input)만 읽는다 — DOM 이벤트를 직접 읽지 않는다.
// 그 덕에 패드 지원은 여기서 스냅샷을 한 번 더 채우는 일로 끝난다 (core/Gamepad).

import { balance } from './Balance';
import { GamepadInput } from './Gamepad';

export interface InputSnapshot {
  /** -1(A) ~ +1(D) */
  moveX: number;
  /** -1(S) ~ +1(W, 전방) */
  moveForward: number;
  sprint: boolean;
  /** 이번 틱에 질주 키(Space)를 새로 눌렀는가 (엣지 — 연타 회피 판정용) */
  sprintPressed: boolean;
  /** 회피를 직접 요청했는가 (엣지). 키보드는 질주 키 연타로 만들고,
   *  패드는 버튼 하나로 만든다 — 연타는 스틱·버튼에 어울리는 입력이 아니다 */
  dodgePressed: boolean;
  /** 이번 틱 동안 누적된 마우스 이동량 (포인터 락 중에만) */
  lookDX: number;
  lookDY: number;
  /** 이번 틱에 랜턴 토글 키가 눌렸는가 (엣지) */
  lanternToggle: boolean;
  /** 이번 틱에 배터리 교체 키가 눌렸는가 (엣지) */
  batterySwap: boolean;
  /** 이번 틱에 근접 공격(우클릭)이 있었는가 (엣지) */
  meleePressed: boolean;
  /** 근접 버튼을 누르고 있는가 */
  meleeHeld: boolean;
  /** 이번 틱에 원거리 공격(좌클릭)이 있었는가 (엣지, 세미오토) */
  rangedPressed: boolean;
  /** 원거리 버튼을 누르고 있는가 (홀드 — 수류탄 차징) */
  rangedHeld: boolean;
  /** 이번 틱에 재장전 키가 눌렸는가 (엣지) */
  reload: boolean;
  /** 이번 틱에 반응 키(Shift)가 눌렸는가 (엣지) */
  reactionPressed: boolean;
  /** 반응 키(Shift)를 누르고 있는가 (홀드 = 방패 방어) */
  reactionHeld: boolean;
  /** 이번 틱에 반응 키를 뗐는가 (엣지 — 짧은 탭이었으면 패링 판정) */
  reactionReleased: boolean;
  /** 이번 틱에 시전 키(Q)가 눌렸는가 (엣지) */
  castPressed: boolean;
  /** 이번 틱에 상호작용 키(E)가 눌렸는가 (엣지) */
  interactPressed: boolean;
  /** 원거리 무기 교체 (휠) — -1/0/+1 */
  cycleRanged: number;
  /** 이번 틱에 누른 퀵슬롯 번호 (1~5, 없으면 0) */
  useSlot: number;
}

/** 퀵슬롯 키 — 순서대로 1~5 번 칸 */
const DIGIT_CODES = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5'];
/** 반응(패링·방어) 키 — 좌·우 시프트를 한 키로 본다 */
const SHIFT_CODES = ['ShiftLeft', 'ShiftRight'];

export class Input {
  /** 패드 입력 — 키보드·마우스와 같은 스냅샷에 얹는다.
   *  둘을 동시에 써도 되게 OR 로 합친다 (한쪽만 쓰라고 강요할 이유가 없다) */
  readonly gamepad = new GamepadInput();
  private keys = new Set<string>();
  private dx = 0;
  private dy = 0;
  private sprintPresses = 0;
  private lanternToggles = 0;
  private batterySwaps = 0;
  private meleeClicks = 0;
  private meleeDown = false;
  private rangedClicks = 0;
  private rangedDown = false;
  private reloads = 0;
  private reactionClicks = 0;
  private reactionDown = false;
  private reactionReleases = 0;
  private casts = 0;
  private interacts = 0;
  private cycleRanged = 0;
  private useSlot = 0;

  constructor(private readonly lockTarget: HTMLElement) {
    // 화면 어디를 클릭하든 락을 시도한다 (일시정지 오버레이 위를 눌러도 재개되도록).
    // 캡처 단계에서 잡는 이유: 상점 줄을 클릭하면 그 핸들러가 목록을 다시 그려
    // 버블 단계에 도달할 즈음 e.target 이 DOM 에서 떨어져 나간다. 그러면 아래 closest 가
    // 조상을 못 찾아 오버레이 안 클릭인데도 락을 걸어 커서가 사라진다 (실측으로 확인)
    window.addEventListener(
      'click',
      (e) => {
        if (this.pointerLocked) return;
        // UI 오버레이 안을 클릭할 때는 제외 — 거기선 커서를 써야 한다
        if ((e.target as HTMLElement | null)?.closest?.('#sigilui, #shopui, #pause .menu')) return;
        this.tryLock(0);
      },
      { capture: true },
    );
    document.addEventListener('pointerlockchange', () => {
      if (this.pointerLocked) this.lockRetry = 0; // 성공 — 재시도 중단
    });

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      // 질주 — 스페이스. 브라우저 기본 스크롤을 막는다
      if (e.code === 'Space') {
        e.preventDefault();
        this.sprintPresses++;
      }
      if (e.code === 'KeyF') this.lanternToggles++;
      if (e.code === 'KeyB') this.batterySwaps++;
      if (e.code === 'KeyR') this.reloads++;
      if (e.code === 'KeyQ') this.casts++;
      if (e.code === 'KeyE') this.interacts++;
      // 퀵슬롯 1~5 — 마지막에 누른 것 하나만 남긴다 (한 틱에 두 개를 쓸 일은 없다)
      const digit = DIGIT_CODES.indexOf(e.code);
      if (digit >= 0) this.useSlot = digit + 1;
      // 반응(패링/방어) — 시프트. 누른 순간과 뗀 순간을 모두 엣지로 잡는다.
      // 좌·우 시프트를 한 키처럼 다룬다: 왼쪽을 쥔 채 오른쪽을 눌렀다 떼도
      // "손을 뗐다"가 되면 안 되므로, 둘 다 떨어진 순간에만 릴리즈로 친다
      if (SHIFT_CODES.includes(e.code) && !this.reactionDown) {
        this.reactionClicks++;
        this.reactionDown = true;
      }
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      if (SHIFT_CODES.includes(e.code) && this.reactionDown && !this.shiftHeld()) {
        this.reactionDown = false;
        this.reactionReleases++;
      }
    });
    window.addEventListener('blur', () => this.keys.clear());

    window.addEventListener('mousemove', (e) => {
      if (!this.pointerLocked) return;
      this.dx += e.movementX;
      this.dy += e.movementY;
    });

    // 포인터 락을 얻는 그 클릭은 발사로 치지 않는다 (mousedown 시점엔 아직 미잠금)
    window.addEventListener('mousedown', (e) => {
      if (!this.pointerLocked) return;
      // 좌클릭 = 원거리 / 우클릭 = 근접
      if (e.button === 0) {
        this.rangedClicks++;
        this.rangedDown = true;
      }
      if (e.button === 2) {
        this.meleeClicks++;
        this.meleeDown = true;
      }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.rangedDown = false;
      if (e.button === 2) this.meleeDown = false;
    });
    window.addEventListener('wheel', (e) => {
      if (!this.pointerLocked) return;
      this.cycleRanged = e.deltaY > 0 ? 1 : -1;
    });
    window.addEventListener('blur', () => {
      this.meleeDown = false;
      this.rangedDown = false;
      this.reactionDown = false;
    });
    window.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** 포인터 락을 다시 잡는다 — 메뉴를 닫았을 때처럼 클릭 없이 조작으로 돌아가야 할 때 */
  requestLock(): void {
    this.tryLock(0);
  }

  /** 포인터 락 요청. ESC로 빠져나온 직후에는 브라우저가 잠시 거부하므로
   *  (Chrome 약 1.25초) 실패하면 짧은 간격으로 다시 시도한다 */
  private lockRetry = 0;
  private tryLock(attempt: number): void {
    if (this.pointerLocked || attempt > 10) return;
    this.lockRetry = attempt;
    let promise: unknown;
    try {
      promise = this.lockTarget.requestPointerLock();
    } catch {
      promise = undefined;
    }
    const retry = (): void => {
      if (this.pointerLocked) return;
      window.setTimeout(() => {
        if (!this.pointerLocked && this.lockRetry === attempt) this.tryLock(attempt + 1);
      }, 250);
    };
    if (promise && typeof (promise as Promise<void>).then === 'function') {
      (promise as Promise<void>).then(() => undefined).catch(retry);
    } else {
      retry(); // 구형 API — 성공했으면 위 pointerlockchange가 재시도를 끊는다
    }
  }

  private shiftHeld(): boolean {
    return this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
  }

  /** 눌린 상태를 전부 해제 — 일시정지·포커스 상실 시 키가 눌린 채 남지 않게 */
  releaseHeld(): void {
    this.keys.clear();
    this.meleeDown = false;
    this.rangedDown = false;
    this.reactionDown = false;
  }

  get pointerLocked(): boolean {
    return document.pointerLockElement === this.lockTarget;
  }

  /** 누적 입력을 스냅샷으로 반환하고 엣지/델타를 리셋한다. 틱당 1회 호출. */
  sample(): InputSnapshot {
    // 패드는 이벤트가 아니라 폴링이다 — 틱당 한 번인 여기가 제자리
    const pad = this.gamepad;
    pad.poll();
    const axes = pad.axes();
    const lookMul = balance.input.gamepad.lookSpeed / balance.loop.tickRate;
    // 스틱은 위치, 마우스는 델타 — 축 값을 틱당 회전량으로 바꿔 같은 필드에 넣는다.
    // 마우스 감도로 나눠 두면 PlayerMove 가 곱할 때 원래 뜻으로 돌아온다
    const padLookX = (axes.lookX * lookMul) / balance.input.mouseSensitivity;
    const padLookY = (axes.lookY * lookMul) / balance.input.mouseSensitivity;
    /** 퀵슬롯 — 패드는 D-패드 4방향까지만 (5번은 자리가 없다) */
    let padSlot = 0;
    if (pad.pressed('slot1')) padSlot = 1;
    else if (pad.pressed('slot2')) padSlot = 2;
    else if (pad.pressed('slot3')) padSlot = 3;
    else if (pad.pressed('slot4')) padSlot = 4;

    // 키보드·마우스와 패드를 OR 로 합친다 — 한쪽만 쓰라고 강요할 이유가 없다.
    // 이동은 키(±1)와 스틱(아날로그) 중 더 크게 민 쪽을 쓴다
    const keyX = (this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0);
    const keyZ = (this.keys.has('KeyW') ? 1 : 0) - (this.keys.has('KeyS') ? 1 : 0);
    const snapshot: InputSnapshot = {
      moveX: Math.abs(axes.moveX) > Math.abs(keyX) ? axes.moveX : keyX,
      // 스틱 Y 는 위로 밀 때 음수다 — 전진(+)과 부호가 반대라 뒤집는다
      moveForward: Math.abs(axes.moveY) > Math.abs(keyZ) ? -axes.moveY : keyZ,
      sprint: this.keys.has('Space') || pad.held('sprint'),
      sprintPressed: this.sprintPresses > 0,
      // 회피는 패드에선 버튼 하나 — 연타는 스틱·버튼에 어울리는 입력이 아니다
      dodgePressed: pad.pressed('dodge'),
      lookDX: this.dx + padLookX,
      lookDY: this.dy + padLookY,
      lanternToggle: this.lanternToggles > 0 || pad.pressed('lantern'),
      batterySwap: this.batterySwaps > 0 || pad.pressed('battery'),
      meleePressed: this.meleeClicks > 0 || pad.pressed('melee'),
      meleeHeld: this.meleeDown || pad.held('melee'),
      rangedPressed: this.rangedClicks > 0 || pad.pressed('ranged'),
      rangedHeld: this.rangedDown || pad.held('ranged'),
      reload: this.reloads > 0 || pad.pressed('reload'),
      reactionPressed: this.reactionClicks > 0 || pad.pressed('reaction'),
      reactionHeld: this.reactionDown || pad.held('reaction'),
      reactionReleased: this.reactionReleases > 0 || pad.released('reaction'),
      castPressed: this.casts > 0 || pad.pressed('cast'),
      interactPressed: this.interacts > 0 || pad.pressed('interact'),
      cycleRanged: this.cycleRanged !== 0 ? this.cycleRanged : pad.pressed('cycleWeapon') ? 1 : 0,
      useSlot: this.useSlot !== 0 ? this.useSlot : padSlot,
    };
    this.dx = 0;
    this.dy = 0;
    this.sprintPresses = 0;
    this.lanternToggles = 0;
    this.batterySwaps = 0;
    this.meleeClicks = 0;
    this.rangedClicks = 0;
    this.reloads = 0;
    this.reactionClicks = 0;
    this.reactionReleases = 0;
    this.casts = 0;
    this.interacts = 0;
    this.cycleRanged = 0;
    this.useSlot = 0;
    return snapshot;
  }

  static emptySnapshot(): InputSnapshot {
    return {
      moveX: 0,
      moveForward: 0,
      sprint: false,
      sprintPressed: false,
      dodgePressed: false,
      lookDX: 0,
      lookDY: 0,
      lanternToggle: false,
      batterySwap: false,
      meleePressed: false,
      meleeHeld: false,
      rangedPressed: false,
      rangedHeld: false,
      reload: false,
      reactionPressed: false,
      reactionHeld: false,
      reactionReleased: false,
      castPressed: false,
      interactPressed: false,
      cycleRanged: 0,
      useSlot: 0,
    };
  }
}
