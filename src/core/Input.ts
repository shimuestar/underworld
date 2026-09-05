// 입력 수집기. DOM 이벤트를 누적했다가 틱 시작 시 sample()로 스냅샷을 넘긴다.
// 게임 로직은 이 스냅샷(world.input)만 읽는다 — DOM 이벤트를 직접 읽지 않는다.
// 그 덕에 패드 지원은 여기서 스냅샷을 한 번 더 채우는 일로 끝난다 (core/Gamepad).

import { balance } from './Balance';
import { GamepadInput } from './Gamepad';
import { keyBindings } from './KeyBindings';

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
  /** 패드 오른스틱 시선 — 마우스와 분리해 싣는다 (에임 어시스트는 스틱에만 걸린다) */
  padLookDX: number;
  padLookDY: number;
  /** 패드 왼스틱(이동)이 움직이는 중 — 자석은 스틱을 젓는 동안에만 끌어야 한다 */
  padMoveActive: boolean;
  /** 오른스틱 X 원시값(-1~1, 데드존 적용) — 락온 대상 전환 튕김 판정용 */
  padLookAxisX: number;
  /** 패드 조준(ADS) — 조준 버튼(기본 LT)을 붙들고 있다. 에임 보정은 이때만 산다 */
  padAiming: boolean;
  /** 이번 틱에 조준 버튼을 뗐는가 (엣지) — 활을 당긴 채 LT 를 놓으면 쏘지 않고 시위를 내린다 */
  aimReleased: boolean;
  /** 이번 틱에 락온 토글(R3·키보드 설정 키)이 눌렸는가 (엣지) */
  lockOnPressed: boolean;
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
  /** 스킬 시전 — castPressed 는 "어떤 스킬이든 눌렀다", useSkill 은 몇 번 칸인지 (1~4, 0 = 없음) */
  castPressed: boolean;
  useSkill: number;
  /** 스킬 키를 붙들고 있는가 (1~4, 0 = 없음) — 채널형 스킬(관통 뇌창)이 이걸 본다 */
  skillHeld: number;
  /** 선택한 스킬 칸의 키(가운데 클릭 · 패드 cast)를 붙들고 있는가 */
  selectedSkillHeld: boolean;
  /** 스킬 교체 — 선택 칸을 다음 칸으로 (Q · 패드 cycleSkill) */
  cycleSkill: boolean;
  /** 선택한 스킬 칸 사용 (가운데 클릭 · 패드 cast) */
  useSelectedSkill: boolean;
  /** 이번 틱에 상호작용 키(E)가 눌렸는가 (엣지) */
  interactPressed: boolean;
  /** 상호작용 키를 붙들고 있는가 — 계단 오르내림 같은 홀드 동작용 */
  interactHeld: boolean;
  /** 원거리 무기 교체 (휠) — -1/0/+1 */
  cycleRanged: number;
  /** 이번 틱에 누른 퀵슬롯 번호 (1~5, 없으면 0) */
  useSlot: number;
}

// 키 코드는 전부 core/KeyBindings 에서 온다 — 설정 화면에서 바꾸면 즉시 여기 반영된다

export class Input {
  /** 패드 입력 — 키보드·마우스와 같은 스냅샷에 얹는다.
   *  둘을 동시에 써도 되게 OR 로 합친다 (한쪽만 쓰라고 강요할 이유가 없다) */
  readonly gamepad = new GamepadInput();

  /** 마지막으로 실제 입력이 온 장치. 안내 문구를 키보드/패드 표기 중 무엇으로
   *  띄울지 이걸로 정한다 — 꽂아만 두고 키보드로 노는 사람에겐 키보드를 보여준다 */
  private prevPadAiming = false; // 조준 해제 엣지(aimReleased) 판정용
  private device: 'kb' | 'pad' = 'kb';
  get usingPad(): boolean {
    return this.device === 'pad' && this.gamepad.connected;
  }
  /** 마지막으로 쓴 장치 — 패드가 브라우저에 가려져(포커스 상실) connected 가 꺼진 뒤에도 "패드 사용자"였는지 안다 */
  get lastDevice(): 'kb' | 'pad' {
    return this.device;
  }
  /** 틱(sample) 밖에서 패드를 폴링하는 곳(일시정지 메뉴)이 '패드를 만졌다'를 알린다 — 곧바로 패드 표기로 바뀐다 */
  notePadInput(): void {
    if (this.gamepad.touched) this.device = 'pad';
  }
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
  private useSkill = 0;
  private cycleSkills = 0;
  private useSelected = 0;
  private useSelectedDown = false;
  /** 패드 랜턴 버튼을 붙든 틱 — holdTicks 를 넘기면 배터리 교체, 짧게 떼면 켜고 끄기 */
  private padLanternHeld = 0;
  private padLanternSwapped = false;
  private interacts = 0;
  private lockOnPresses = 0;
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
        if ((e.target as HTMLElement | null)?.closest?.('#menuui, #shopui, #lootui, #pause .menu, #gamepadui')) return;
        this.tryLock(0);
      },
      { capture: true },
    );
    document.addEventListener('pointerlockchange', () => {
      if (this.pointerLocked) this.lockRetry = 0; // 성공 — 재시도 중단
    });

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.device = 'kb';
      this.keys.add(e.code);
      const kb = keyBindings;
      // 질주 — 기본 스페이스. 브라우저 기본 스크롤을 막는다
      if (e.code === kb.code('sprint')) {
        e.preventDefault();
        this.sprintPresses++;
      }
      if (e.code === kb.code('lantern')) this.lanternToggles++;
      if (e.code === kb.code('battery')) this.batterySwaps++;
      if (e.code === kb.code('reload')) this.reloads++;
      // 스킬 퀵슬롯 (기본 Z·X·C·V) — 마지막에 누른 것 하나만
      const skill = [kb.code('skill1'), kb.code('skill2'), kb.code('skill3'), kb.code('skill4')].indexOf(e.code);
      if (skill >= 0) this.useSkill = skill + 1;
      if (e.code === kb.code('cycleSkill')) this.cycleSkills++; // 스킬 교체 — 선택 칸 회전
      if (e.code === kb.code('interact')) this.interacts++;
      if (kb.code('lockOn') !== '' && e.code === kb.code('lockOn')) this.lockOnPresses++;
      // 퀵슬롯 1~5 — 마지막에 누른 것 하나만 남긴다 (한 틱에 두 개를 쓸 일은 없다)
      const digit = [kb.code('slot1'), kb.code('slot2'), kb.code('slot3'), kb.code('slot4'), kb.code('slot5')].indexOf(e.code);
      if (digit >= 0) this.useSlot = digit + 1;
      // 반응(패링/방어) — 기본 시프트. 누른 순간과 뗀 순간을 모두 엣지로 잡는다.
      // 시프트에 걸었을 땐 좌·우를 한 키처럼 다룬다 (KeyBindings.codesOf)
      if (kb.codesOf('reaction').includes(e.code) && !this.reactionDown) {
        this.reactionClicks++;
        this.reactionDown = true;
      }
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      if (
        keyBindings.codesOf('reaction').includes(e.code) &&
        this.reactionDown &&
        !this.shiftHeld()
      ) {
        this.reactionDown = false;
        this.reactionReleases++;
      }
    });
    window.addEventListener('blur', () => this.keys.clear());

    window.addEventListener('mousemove', (e) => {
      if (!this.pointerLocked) {
        // 창(루팅·가방·메뉴) 위에서 마우스를 실제로 움직이면 마우스 사용자로 돌아온다 —
        // 패드 때문에 숨긴 커서(html.padcursor)가 다시 나타나고 안내도 키보드 표기로 바뀐다
        if (e.movementX !== 0 || e.movementY !== 0) this.device = 'kb';
        return;
      }
      this.dx += e.movementX;
      this.dy += e.movementY;
    });

    // 포인터 락을 얻는 그 클릭은 발사로 치지 않는다 (mousedown 시점엔 아직 미잠금)
    window.addEventListener('mousedown', (e) => {
      this.device = 'kb'; // 창 안을 클릭한 것도 마우스 사용이다 (커서를 되살린다)
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
      // 가운데 클릭 = 선택한 스킬 사용. 기본 동작(자동 스크롤)은 막는다
      if (e.button === 1) {
        e.preventDefault();
        this.useSelected++;
        this.useSelectedDown = true;
      }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.rangedDown = false;
      if (e.button === 2) this.meleeDown = false;
      if (e.button === 1) this.useSelectedDown = false;
    });
    window.addEventListener('wheel', (e) => {
      if (!this.pointerLocked) return;
      this.cycleRanged = e.deltaY > 0 ? 1 : -1;
    });
    window.addEventListener('blur', () => {
      this.meleeDown = false;
      this.rangedDown = false;
      this.reactionDown = false;
      this.useSelectedDown = false;
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
    return keyBindings.codesOf('reaction').some((c) => this.keys.has(c));
  }

  /** 눌린 상태를 전부 해제 — 일시정지·포커스 상실 시 키가 눌린 채 남지 않게 */
  releaseHeld(): void {
    this.keys.clear();
    this.meleeDown = false;
    this.rangedDown = false;
    this.reactionDown = false;
    this.useSelectedDown = false;
  }

  get pointerLocked(): boolean {
    return document.pointerLockElement === this.lockTarget;
  }

  /** 누적 입력을 스냅샷으로 반환하고 엣지/델타를 리셋한다. 틱당 1회 호출. */
  sample(): InputSnapshot {
    // 패드는 이벤트가 아니라 폴링이다 — 틱당 한 번인 여기가 제자리
    const pad = this.gamepad;
    pad.poll();
    if (pad.touched) this.device = 'pad';
    const axes = pad.axes();
    const lookMul = balance.input.gamepad.lookSpeed / balance.loop.tickRate;
    // 스틱은 위치, 마우스는 델타 — 축 값을 틱당 회전량으로 바꿔 같은 필드에 넣는다.
    // 마우스 감도로 나눠 두면 PlayerMove 가 곱할 때 원래 뜻으로 돌아온다
    const padLookX = (axes.lookX * lookMul) / balance.input.mouseSensitivity;
    const padLookY = (axes.lookY * lookMul) / balance.input.mouseSensitivity;
    /** 퀵슬롯 — 패드는 D-패드 4방향까지만 (5번은 자리가 없다) */
    // 칩(조합) 레이어 — 스킬 선택을 붙들면 스킬 버튼(기본 Y·X·A·B)이 시전이 되고,
    // 소모품 선택을 붙들면 D-패드가 퀵슬롯이 된다. 레이어 중엔 그 버튼들의
    // 평상시 기능(회피·상호작용·재장전 등)이 눌리지 않는다 — 시프트 같은 개념.
    // 두 선택을 같이 누르면 스킬 쪽이 이긴다
    const skillLayer = pad.held('skillSelect');
    const itemLayer = !skillLayer && pad.held('itemSelect');
    const padPlain = !skillLayer && !itemLayer;
    // 조준(ADS) — 조준 버튼(기본 LT)을 붙든 동안 근접 버튼(RT)이 발사가 된다.
    // 조준 없이 근접 버튼만 누르면 평소처럼 해머다.
    // 조준 자체는 레이어와 무관하게 유지된다 — 조준한 채 스킬(RB+버튼)을 끼워 넣어도
    // 줌·견착이 안 풀린다 (2026-09-01 사용자 결정). 발사만 레이어 중에 잠긴다
    const padAiming = pad.held('ranged');
    const aimReleased = this.prevPadAiming && !padAiming;
    this.prevPadAiming = padAiming;

    // 패드 랜턴 버튼: 짧게 떼면 켜고 끄기, holdTicks 넘게 붙들면 배터리 교체 (한 번만)
    let padLanternTap = false;
    let padLanternHold = false;
    if (padPlain && pad.held('lantern')) {
      this.padLanternHeld++;
      if (this.padLanternHeld === balance.input.gamepad.holdTicks) {
        padLanternHold = true;
        this.padLanternSwapped = true;
      }
    } else if (pad.released('lantern')) {
      padLanternTap = !this.padLanternSwapped;
      this.padLanternHeld = 0;
      this.padLanternSwapped = false;
    }
    let padSkill = 0;
    let padSkillHeld = 0;
    if (skillLayer) {
      if (pad.pressed('skill1')) padSkill = 1;
      else if (pad.pressed('skill2')) padSkill = 2;
      else if (pad.pressed('skill3')) padSkill = 3;
      else if (pad.pressed('skill4')) padSkill = 4;
      // 붙들고 있는 스킬 칸 — 채널형 스킬은 엣지가 아니라 이걸 본다
      if (pad.held('skill1')) padSkillHeld = 1;
      else if (pad.held('skill2')) padSkillHeld = 2;
      else if (pad.held('skill3')) padSkillHeld = 3;
      else if (pad.held('skill4')) padSkillHeld = 4;
    }
    const keySkillHeld =
      [
        keyBindings.code('skill1'),
        keyBindings.code('skill2'),
        keyBindings.code('skill3'),
        keyBindings.code('skill4'),
      ].findIndex((code) => code !== '' && this.keys.has(code)) + 1;
    let padSlot = 0;
    if (itemLayer) {
      if (pad.pressed('slot1')) padSlot = 1;
      else if (pad.pressed('slot2')) padSlot = 2;
      else if (pad.pressed('slot3')) padSlot = 3;
      else if (pad.pressed('slot4')) padSlot = 4;
    }

    // 키보드·마우스와 패드를 OR 로 합친다 — 한쪽만 쓰라고 강요할 이유가 없다.
    // 이동은 키(±1)와 스틱(아날로그) 중 더 크게 민 쪽을 쓴다
    const keyX =
      (this.keys.has(keyBindings.code('right')) ? 1 : 0) -
      (this.keys.has(keyBindings.code('left')) ? 1 : 0);
    const keyZ =
      (this.keys.has(keyBindings.code('forward')) ? 1 : 0) -
      (this.keys.has(keyBindings.code('back')) ? 1 : 0);
    const snapshot: InputSnapshot = {
      moveX: Math.abs(axes.moveX) > Math.abs(keyX) ? axes.moveX : keyX,
      // 스틱 Y 는 위로 밀 때 음수다 — 전진(+)과 부호가 반대라 뒤집는다
      moveForward: Math.abs(axes.moveY) > Math.abs(keyZ) ? -axes.moveY : keyZ,
      sprint: this.keys.has(keyBindings.code('sprint')) || pad.held('sprint'),
      sprintPressed: this.sprintPresses > 0,
      // 회피는 패드에선 버튼 하나 — 연타는 스틱·버튼에 어울리는 입력이 아니다
      dodgePressed: padPlain && pad.pressed('dodge'),
      lookDX: this.dx,
      lookDY: this.dy,
      padLookDX: padLookX,
      padLookDY: padLookY,
      padMoveActive: Math.abs(axes.moveX) + Math.abs(axes.moveY) > 0,
      padLookAxisX: axes.lookX,
      padAiming,
      aimReleased,
      lockOnPressed: this.lockOnPresses > 0 || (padPlain && pad.pressed('lockOn')),
      lanternToggle: this.lanternToggles > 0 || padLanternTap,
      batterySwap: this.batterySwaps > 0 || (padPlain && pad.pressed('battery')) || padLanternHold,
      meleePressed: this.meleeClicks > 0 || (padPlain && !padAiming && pad.pressed('melee')),
      meleeHeld: this.meleeDown || (padPlain && !padAiming && pad.held('melee')),
      rangedPressed: this.rangedClicks > 0 || (padAiming && padPlain && pad.pressed('melee')),
      rangedHeld: this.rangedDown || (padAiming && padPlain && pad.held('melee')),
      reload: this.reloads > 0 || (padPlain && pad.pressed('reload')),
      reactionPressed: this.reactionClicks > 0 || (padPlain && pad.pressed('reaction')),
      reactionHeld: this.reactionDown || (padPlain && pad.held('reaction')),
      reactionReleased: this.reactionReleases > 0 || (padPlain && pad.released('reaction')),
      castPressed: this.useSkill !== 0 || padSkill !== 0 || this.useSelected > 0,
      useSkill: this.useSkill !== 0 ? this.useSkill : padSkill,
      skillHeld: keySkillHeld !== 0 ? keySkillHeld : padSkillHeld,
      selectedSkillHeld: this.useSelectedDown,
      cycleSkill: this.cycleSkills > 0,
      useSelectedSkill: this.useSelected > 0,
      interactPressed: this.interacts > 0 || (padPlain && pad.pressed('interact')),
      interactHeld:
        this.keys.has(keyBindings.code('interact')) || (padPlain && pad.held('interact')),
      cycleRanged: this.cycleRanged !== 0 ? this.cycleRanged : padPlain && pad.pressed('cycleWeapon') ? 1 : 0,
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
    this.useSkill = 0;
    this.cycleSkills = 0;
    this.useSelected = 0;
    this.interacts = 0;
    this.lockOnPresses = 0;
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
      padLookDX: 0,
      padLookDY: 0,
      padMoveActive: false,
      padLookAxisX: 0,
      padAiming: false,
      aimReleased: false,
      lockOnPressed: false,
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
      useSkill: 0,
      skillHeld: 0,
      selectedSkillHeld: false,
      cycleSkill: false,
      useSelectedSkill: false,
      interactPressed: false,
      interactHeld: false,
      cycleRanged: 0,
      useSlot: 0,
    };
  }
}
