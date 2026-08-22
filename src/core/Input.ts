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
  /** 이번 틱에 반응 키(Space)가 눌렸는가 (엣지) */
  reactionPressed: boolean;
  /** 반응 키(Space)를 누르고 있는가 (홀드 = 방패 방어) */
  reactionHeld: boolean;
  /** 이번 틱에 반응 키를 뗐는가 (엣지 — 짧은 탭이었으면 패링 판정) */
  reactionReleased: boolean;
  /** 이번 틱에 시전 키(Q)가 눌렸는가 (엣지) */
  castPressed: boolean;
  /** 이번 틱에 상호작용 키(E)가 눌렸는가 (엣지) */
  interactPressed: boolean;
  /** 원거리 무기 교체 (휠) — -1/0/+1 */
  cycleRanged: number;
}

export class Input {
  private keys = new Set<string>();
  private dx = 0;
  private dy = 0;
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
      if (e.code === 'KeyE') this.interacts++;
      // 반응(패링/방어) — 스페이스. 누른 순간과 뗀 순간을 모두 엣지로 잡는다
      if (e.code === 'Space') {
        e.preventDefault();
        this.reactionClicks++;
        this.reactionDown = true;
      }
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      if (e.code === 'Space' && this.reactionDown) {
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
      meleePressed: this.meleeClicks > 0,
      meleeHeld: this.meleeDown,
      rangedPressed: this.rangedClicks > 0,
      rangedHeld: this.rangedDown,
      reload: this.reloads > 0,
      reactionPressed: this.reactionClicks > 0,
      reactionHeld: this.reactionDown,
      reactionReleased: this.reactionReleases > 0,
      castPressed: this.casts > 0,
      interactPressed: this.interacts > 0,
      cycleRanged: this.cycleRanged,
    };
    this.dx = 0;
    this.dy = 0;
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
    };
  }
}
