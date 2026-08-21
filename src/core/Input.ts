// 입력 수집기. DOM 이벤트를 누적했다가 틱 시작 시 sample()로 스냅샷을 넘긴다.
// 게임 로직은 이 스냅샷(world.input)만 읽는다 — DOM 이벤트를 직접 읽지 않는다.

export interface InputSnapshot {
  /** -1(A) ~ +1(D) */
  moveX: number;
  /** -1(S) ~ +1(W, 전방) */
  moveForward: number;
  sprint: boolean;
  /** 이번 틱 동안 누적된 마우스 이동량 (포인터 락 중에만) */
  lookDX: number;
  lookDY: number;
  /** 이번 틱에 랜턴 토글 키가 눌렸는가 (엣지) */
  lanternToggle: boolean;
  /** 이번 틱에 배터리 교체 키가 눌렸는가 (엣지) */
  batterySwap: boolean;
  /** 이번 틱에 발사 클릭이 있었는가 (엣지, 세미오토) */
  firePressed: boolean;
  /** 이번 틱에 재장전 키가 눌렸는가 (엣지) */
  reload: boolean;
  /** 이번 틱에 반응 버튼(우클릭)이 눌렸는가 (엣지) */
  reactionPressed: boolean;
  /** 이번 틱에 시전 키(Q)가 눌렸는가 (엣지) */
  castPressed: boolean;
}

export class Input {
  private keys = new Set<string>();
  private dx = 0;
  private dy = 0;
  private lanternToggles = 0;
  private batterySwaps = 0;
  private fireClicks = 0;
  private reloads = 0;
  private reactionClicks = 0;
  private casts = 0;

  constructor(private readonly lockTarget: HTMLElement) {
    lockTarget.addEventListener('click', () => {
      if (!this.pointerLocked) lockTarget.requestPointerLock();
    });

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'KeyF') this.lanternToggles++;
      if (e.code === 'KeyB') this.batterySwaps++;
      if (e.code === 'KeyR') this.reloads++;
      if (e.code === 'KeyQ') this.casts++;
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());

    window.addEventListener('mousemove', (e) => {
      if (!this.pointerLocked) return;
      this.dx += e.movementX;
      this.dy += e.movementY;
    });

    // 포인터 락을 얻는 그 클릭은 발사로 치지 않는다 (mousedown 시점엔 아직 미잠금)
    window.addEventListener('mousedown', (e) => {
      if (!this.pointerLocked) return;
      if (e.button === 0) this.fireClicks++;
      if (e.button === 2) this.reactionClicks++;
    });
    window.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  get pointerLocked(): boolean {
    return document.pointerLockElement === this.lockTarget;
  }

  /** 누적 입력을 스냅샷으로 반환하고 엣지/델타를 리셋한다. 틱당 1회 호출. */
  sample(): InputSnapshot {
    const snapshot: InputSnapshot = {
      moveX: (this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0),
      moveForward: (this.keys.has('KeyW') ? 1 : 0) - (this.keys.has('KeyS') ? 1 : 0),
      sprint: this.keys.has('ShiftLeft') || this.keys.has('ShiftRight'),
      lookDX: this.dx,
      lookDY: this.dy,
      lanternToggle: this.lanternToggles > 0,
      batterySwap: this.batterySwaps > 0,
      firePressed: this.fireClicks > 0,
      reload: this.reloads > 0,
      reactionPressed: this.reactionClicks > 0,
      castPressed: this.casts > 0,
    };
    this.dx = 0;
    this.dy = 0;
    this.lanternToggles = 0;
    this.batterySwaps = 0;
    this.fireClicks = 0;
    this.reloads = 0;
    this.reactionClicks = 0;
    this.casts = 0;
    return snapshot;
  }

  static emptySnapshot(): InputSnapshot {
    return {
      moveX: 0,
      moveForward: 0,
      sprint: false,
      lookDX: 0,
      lookDY: 0,
      lanternToggle: false,
      batterySwap: false,
      firePressed: false,
      reload: false,
      reactionPressed: false,
      castPressed: false,
    };
  }
}
