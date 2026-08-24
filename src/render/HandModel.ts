// 1인칭 뷰모델 — 오른손+권총, 왼팔 브레이서(패링). 전부 프리미티브 + 단색.
// 게임 로직 금지: 이벤트/상태를 받아 애니메이션만 한다.
// 오염 시각 단계(economy.md §3)가 생기면 이 파일에서 머티리얼/모델을 단계별로 바꾼다.

import * as THREE from 'three';

// 시각 상수 (튜닝값 아님)
const SKIN = 0xb08a63;
const SLEEVE = 0x2a2a30;
const GUN_DARK = 0x3a3a40;
const GRIP = 0x2b2320;
const BRACER = 0x555c66;

const RECOIL_MS = 130;
/** 불발 — 발사 반동의 1/5 크기로 딸깍 튀고, 탄약 표시가 잠깐 붉어진다 */
const DRY_FIRE_MS = 220;
const DRY_FIRE_TINT = 0xff6a6a;
const PARRY_SWING_MS = 340;
const BLOCK_FLASH_MS = 260; // 방어 성공 섬광 (2회 깜빡임)
// 처형 마무리 — 어깨 뒤로 크게 젖혔다 대각선으로 분쇄한다.
// 평타 3타(정면 수직 강타)와 구분되게 뒤로 빼는 예비동작과 비트는 궤적을 준다
export const FINISHER_MS = 560;
const FINISHER_COCK_T = 0.3; // 젖히기 완료 지점
const FINISHER_CRUSH_T = 0.44; // 해머가 닿는 지점 — 연출·판정 타이밍의 기준
const FINISHER_BURY_T = 0.6; // 박아 누르기 종료
/** 처형 애니메이션 시작 후 해머가 실제로 닿기까지의 시간(ms) */
export const FINISHER_CONTACT_MS = Math.round(FINISHER_MS * FINISHER_CRUSH_T);
const SHIELD_ARROW_MS = 4000; // 방패에 꽂힌 화살 유지 시간
const BLOCK_FLASH_COLOR = 0xbfd4ff;

function easeOutCubic(x: number): number {
  return 1 - Math.pow(1 - x, 3);
}
function easeInCubic(x: number): number {
  return x * x * x;
}

// 패링 결과별 브레이서 발광색 — 텔레그래프 3색 규약과 겹치는 청색은 '패링 가능'의
// 연장선이라 의도적으로 공유한다
const PARRY_GLOW: Record<string, number> = {
  perfect: 0x4a9eff,
  normal: 0x2a5f99,
  fail: 0x553333,
};

// 오염 시각 단계별 피부색 (economy.md §3 — 슬라이스는 0~2단계)
const SKIN_BY_STAGE = [0xb08a63, 0x96866a, 0x7a8068];

/** 손에 붙는 작은 표시판 — 캔버스 텍스처. 값이 바뀔 때만 다시 그린다 */
class HandLabel {
  readonly mesh: THREE.Mesh;
  private readonly canvas = document.createElement('canvas');
  private readonly texture: THREE.CanvasTexture;
  private last = '';

  constructor(width: number, height: number, private readonly color: string) {
    this.canvas.width = 128;
    this.canvas.height = 64;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(width, height),
      new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, depthTest: false }),
    );
    this.mesh.renderOrder = 10; // 무기에 가리지 않게
  }

  set(text: string): void {
    if (text === this.last) return;
    this.last = text;
    const ctx = this.canvas.getContext('2d')!;
    ctx.clearRect(0, 0, 128, 64);
    ctx.font = 'bold 44px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillText(text, 66, 35);
    ctx.fillStyle = this.color;
    ctx.fillText(text, 64, 33);
    this.texture.needsUpdate = true;
  }
}

function box(w: number, h: number, d: number, color: number): THREE.Mesh {
  return new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshLambertMaterial({ color }),
  );
}

export class HandModel {
  readonly group = new THREE.Group();
  private readonly rightArm = new THREE.Group();
  private readonly leftArm = new THREE.Group();
  private readonly bracerMaterial: THREE.MeshLambertMaterial;
  private bracer!: THREE.Mesh;
  private ammoLabel!: HandLabel;

  private recoilUntil = 0;
  private dryFireUntil = 0;
  private parryUntil = 0;
  private parryGlow = 0x000000;
  private blockBlend = 0;
  private readonly gunParts: THREE.Mesh[] = [];
  private readonly hammerParts: THREE.Mesh[] = [];
  private readonly grenadeParts: THREE.Mesh[] = [];
  private swingUntil = 0;
  private swingStart = 0;
  private swingIndex = 0;
  private swingSpeed = 1;
  private swingFrom: SwingPose | null = null;
  private baseRotX = 0;
  /** 왼팔(총) 자세 보간값 — 가드 블렌드와 별도로 유지된다 */
  private gunPoseY = 0;
  private gunPoseRot = 0;
  private throwUntil = 0;
  private blockFlashUntil = 0;
  private finisherUntil = 0;
  private finisherStart = 0;
  private readonly shieldArrows: { group: THREE.Group; until: number }[] = [];
  private shieldArrowSlot = 0;
  private readonly skinMaterials: THREE.MeshLambertMaterial[] = [];
  private corruptionStage = -1;

  constructor() {
    // ---- 오른팔 = 해머 (근접, 우클릭) ----
    // 피벗 = 손목. 팔뚝은 +z(카메라 쪽)로 뻗어 화면 밖에서 들어오는 팔처럼 보이고,
    // 해머는 -z(정면)로 뻗는다. 이렇게 해야 팔을 돌려도 팔뚝이 늘 몸쪽에 남는다
    const forearm = box(0.058, 0.058, 0.26, SLEEVE);
    forearm.position.set(0, -0.008, 0.15);
    this.rightArm.add(forearm);

    const hand = box(0.062, 0.058, 0.075, SKIN);
    hand.position.set(0, 0, 0.01);
    this.skinMaterials.push(hand.material as THREE.MeshLambertMaterial);
    this.rightArm.add(hand);

    // 자루는 손 앞뒤로 걸쳐 잡는다 (손에서 뒤로 조금, 앞으로 길게)
    const hammerShaft = box(0.03, 0.03, 0.4, 0x5c4a33);
    hammerShaft.position.set(0, 0.012, -0.16);
    const hammerHead = box(0.115, 0.085, 0.145, 0x7a7d84);
    hammerHead.position.set(0, 0.012, -0.37);
    const hammerBand = box(0.034, 0.034, 0.04, 0x3b3f45); // 자루-머리 이음쇠
    hammerBand.position.set(0, 0.012, -0.29);
    this.hammerParts.push(hammerShaft, hammerHead, hammerBand);
    this.rightArm.add(hammerShaft);
    this.rightArm.add(hammerHead);
    this.rightArm.add(hammerBand);

    this.rightArm.position.copy(REST_RIGHT.pos);
    this.rightArm.rotation.set(HAMMER_REST_ROT, REST_RIGHT.rotY, REST_RIGHT.rotZ);
    this.baseRotX = HAMMER_REST_ROT;
    this.group.add(this.rightArm);

    // ---- 왼팔 = 총/수류탄 (원거리, 좌클릭) + 팔뚝 브레이서 (방어·패링) ----
    // 총을 든 손이 곧 방패 손이라 방어 중에는 사격할 수 없다 (Weapons가 강제)
    const lForearm = box(0.048, 0.048, 0.19, SLEEVE);
    lForearm.position.set(0, 0, 0.015);
    this.leftArm.add(lForearm);

    const lFist = box(0.06, 0.056, 0.06, SKIN);
    lFist.position.set(0, 0.004, -0.11);
    this.skinMaterials.push(lFist.material as THREE.MeshLambertMaterial);
    this.leftArm.add(lFist);

    const slide = box(0.03, 0.038, 0.17, GUN_DARK);
    slide.position.set(0, 0.04, -0.17);
    this.gunParts.push(slide);
    this.leftArm.add(slide);

    const grip = box(0.026, 0.07, 0.038, GRIP);
    grip.position.set(0, -0.02, -0.1);
    grip.rotation.x = -0.25;
    this.gunParts.push(grip);
    this.leftArm.add(grip);

    const grenadeBall = new THREE.Mesh(
      new THREE.SphereGeometry(0.05, 8, 8),
      new THREE.MeshLambertMaterial({ color: 0x3d4a2e }),
    );
    grenadeBall.position.set(0, 0.03, -0.15);
    this.grenadeParts.push(grenadeBall);
    this.leftArm.add(grenadeBall);

    // 왼손 총 옆 — 남은 탄약
    this.ammoLabel = new HandLabel(0.13, 0.065, '#ffe9b8');
    this.ammoLabel.mesh.position.set(-0.055, 0.075, -0.11);
    this.ammoLabel.mesh.rotation.y = 0.35;
    this.leftArm.add(this.ammoLabel.mesh);

    this.setWeapon('pistol');

    this.bracerMaterial = new THREE.MeshLambertMaterial({ color: BRACER });
    // 평소엔 팔뚝 보호대 크기로 접혀 있다가 가드할 때 방패로 펼쳐진다 —
    // 상시 방패 크기면 총이 가려진다
    // 가로(z 0.21)는 유지, 세로(y)를 크게 — 가드 시 화면을 세로로도 넉넉히 가리도록
    const bracer = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.24, 0.21), this.bracerMaterial);
    bracer.position.set(-0.05, 0.02, 0);
    this.bracer = bracer;
    this.leftArm.add(bracer);

    // 방패에 꽂히는 화살 3슬롯 — 평소엔 숨김, 화살을 막으면 순환 표시.
    // 가드 자세에서 방패 바깥면(-x)은 카메라 반대쪽이라 판 뒤로 숨는다.
    // 그래서 판 위쪽 가장자리(y ≒ +0.14)에 꽂고 tilt 로 샤프트를 세워 위로 솟게 한다 —
    // 기울기가 얕으면(-0.6 대) 커진 방패에 통째로 먹힌다 (실측으로 확인)
    const arrowSpots: [number, number, number][] = [
      [0.06, -0.07, -1.0], // [높이, 좌우, 기울기]
      [0.09, 0.0, -1.22],
      [0.05, 0.075, -0.86],
    ];
    for (const [dy, dz, tilt] of arrowSpots) {
      const stuck = new THREE.Group();
      // 박힌 화살이라 대부분 판에 먹혀 있다 — 뒷동강만 보인다.
      // 온전한 길이(0.17)면 조준점 높이까지 솟아 시야를 가린다
      const shaft = box(0.1, 0.016, 0.016, 0x6b5233);
      shaft.position.set(-0.05, 0, 0); // 꽂힌 지점에서 바깥으로 뻗는다
      stuck.add(shaft);
      const fletch = box(0.035, 0.032, 0.007, 0x9b3535);
      fletch.position.set(-0.092, 0, 0);
      stuck.add(fletch);
      stuck.position.set(-0.048, 0.02 + dy, dz);
      stuck.rotation.z = tilt;
      stuck.visible = false;
      this.leftArm.add(stuck);
      this.shieldArrows.push({ group: stuck, until: 0 });
    }

    this.leftArm.position.copy(REST_LEFT.pos);
    this.leftArm.rotation.set(REST_LEFT.rotX, REST_LEFT.rotY, REST_LEFT.rotZ);
    this.group.add(this.leftArm);
  }

  triggerRecoil(): void {
    this.recoilUntil = performance.now() + RECOIL_MS;
  }

  /** 불발 — 총이 살짝 들썩이기만 하고 나가지 않는다 */
  triggerDryFire(): void {
    this.dryFireUntil = performance.now() + DRY_FIRE_MS;
  }

  /** 왼손에 든 원거리 무기 교체 (해머는 항상 오른손에 있다) */
  setWeapon(kind: 'hammer' | 'grenade' | 'pistol'): void {
    for (const mesh of this.gunParts) mesh.visible = kind !== 'grenade';
    for (const mesh of this.grenadeParts) mesh.visible = kind === 'grenade';
  }

  /** step: 1·2·3 연속타 단계. 직전 타의 끝 자세에서 그대로 이어진다.
   *  speedMul>1 은 적중 가속 — 로직의 impactTicks 가 줄어든 만큼 그림도 빨라져야
   *  해머가 닿는 순간과 판정 시점이 어긋나지 않는다 */
  triggerHammerSwing(step = 1, speedMul = 1): void {
    this.swingIndex = Math.max(0, Math.min(COMBO_SWINGS.length - 1, step - 1));
    this.swingSpeed = Math.max(0.1, speedMul);
    const s = COMBO_SWINGS[this.swingIndex]!;
    // 지금 팔이 있는 위치를 출발점으로 삼는다 — 대기 자세로 되돌아갔다 오지 않는다
    this.swingFrom = {
      rotX: this.rightArm.rotation.x,
      rotY: this.rightArm.rotation.y,
      x: this.rightArm.position.x,
      y: this.rightArm.position.y,
    };
    this.swingStart = performance.now();
    this.swingUntil =
      this.swingStart + (s.windupMs + s.strikeMs + s.holdMs + s.returnMs) / this.swingSpeed;
  }

  triggerGrenadeThrow(): void {
    this.throwUntil = performance.now() + 240;
  }

  /** 방어 성공 — 브레이서 섬광, 화살이면 방패에 꽂힌다 */
  triggerBlockHit(kind?: string): void {
    const now = performance.now();
    this.blockFlashUntil = now + BLOCK_FLASH_MS;
    if (kind === 'arrow') {
      const slot = this.shieldArrows[this.shieldArrowSlot % this.shieldArrows.length]!;
      this.shieldArrowSlot++;
      slot.group.visible = true;
      slot.until = now + SHIELD_ARROW_MS;
    }
  }

  /** 처형 마무리 — 어깨 뒤로 젖혔다 대각선으로 분쇄한다 (방패 강타를 대체) */
  triggerExecuteFinisher(): void {
    this.finisherStart = performance.now();
    this.finisherUntil = this.finisherStart + FINISHER_MS;
  }

  triggerParry(result: string): void {
    this.parryUntil = performance.now() + PARRY_SWING_MS;
    this.parryGlow = PARRY_GLOW[result] ?? PARRY_GLOW['fail']!;
  }

  /** 오염 시각 단계 — 피부색 변화 (구조 교체는 3/5/7단계, 슬라이스 밖) */
  setCorruptionStage(stage: number): void {
    const clamped = Math.max(0, Math.min(SKIN_BY_STAGE.length - 1, stage));
    if (clamped === this.corruptionStage) return;
    this.corruptionStage = clamped;
    for (const material of this.skinMaterials) material.color.set(SKIN_BY_STAGE[clamped]!);
  }

  /** 매 프레임 호출. 상태 기반 포즈 + 이벤트 기반 킥을 합성한다 */
  update(state: {
    reloading: boolean;
    stunned: boolean;
    blocking?: boolean;
    chargeFrac?: number;
    /** 문 잠금을 푸는 중 진행률 0~1 — 0 이면 손을 대지 않은 상태 */
    doorFrac?: number;
    /** 왼손에 띄울 탄약 수 */
    ammoText?: string;
  }): void {
    const now = performance.now();
    this.ammoLabel.set(state.ammoText ?? '');

    // ---- 오른팔 (해머) — 대기는 치켜든 자세, 좌클릭이 아니라 우클릭에 반응한다
    let targetY = REST_RIGHT.pos.y;
    let targetRotX = HAMMER_REST_ROT;
    if (state.stunned) {
      targetY -= 0.1;
      targetRotX -= 0.55;
    }

    // 스윙 — 치켜듦(예비 18%) → 내리침(37%) → 박힘(12%) → 회수(33%).
    // 절대 각도로 지정한다: 대기 각도가 바뀌어도 궤적이 흔들리지 않는다
    // 처형 마무리 — 다른 어떤 동작보다 우선한다 (보여주기 위한 시간이므로)
    let finisher: SwingPose | null = null;
    if (now < this.finisherUntil) {
      const t = (now - this.finisherStart) / FINISHER_MS;
      const restPose: SwingPose = {
        rotX: HAMMER_REST_ROT,
        rotY: REST_RIGHT.rotY,
        x: REST_RIGHT.pos.x,
        y: REST_RIGHT.pos.y,
        z: SMASH_RIGHT.z,
        rotZ: 0,
      };
      // 젖힘 — 해머를 오른쪽 어깨 너머로 넘긴다. z는 거의 건드리지 않는다:
      // 카메라 쪽으로 당기면 팔이 화면을 덮는 판때기가 된다 (+0.18에서 실측 확인)
      const cocked: SwingPose = {
        rotX: 1.98, rotY: -0.42, x: 0.3, y: -0.04, z: SMASH_RIGHT.z + 0.04, rotZ: 0.26,
      };
      // 분쇄 — 오른쪽 위 뒤에서 화면 중앙 아래 앞으로 대각선으로 찍어 내린다
      // 수직으로 깊이 찍으면(rotX −1.0 이하) 헤드가 화면 아래로 빠져 타격 순간이 안 보인다.
      // 그래서 오른쪽 위 → 왼쪽 아래로 몸을 가로지르는 대각선으로 내린다
      const crushed: SwingPose = {
        rotX: -0.52, rotY: 0.58, x: -0.06, y: -0.3, z: SMASH_RIGHT.z - 0.18, rotZ: -0.32,
      };
      // 박아 누르기 — 닿은 뒤 체중을 실어 조금 더 밀어 넣는다
      const buried: SwingPose = {
        rotX: -0.62, rotY: 0.66, x: -0.1, y: -0.34, z: SMASH_RIGHT.z - 0.22, rotZ: -0.4,
      };
      const mixF = (a: SwingPose, b: SwingPose, k: number): SwingPose => ({
        rotX: a.rotX + (b.rotX - a.rotX) * k,
        rotY: a.rotY + (b.rotY - a.rotY) * k,
        x: a.x + (b.x - a.x) * k,
        y: a.y + (b.y - a.y) * k,
        z: a.z! + (b.z! - a.z!) * k,
        rotZ: a.rotZ! + (b.rotZ! - a.rotZ!) * k,
      });
      if (t < FINISHER_COCK_T) {
        finisher = mixF(restPose, cocked, easeOutCubic(t / FINISHER_COCK_T));
      } else if (t < FINISHER_CRUSH_T) {
        const k = (t - FINISHER_COCK_T) / (FINISHER_CRUSH_T - FINISHER_COCK_T);
        finisher = mixF(cocked, crushed, easeInCubic(k));
      } else if (t < FINISHER_BURY_T) {
        const k = (t - FINISHER_CRUSH_T) / (FINISHER_BURY_T - FINISHER_CRUSH_T);
        finisher = mixF(crushed, buried, easeOutCubic(k));
      } else {
        finisher = mixF(buried, restPose, easeInCubic((t - FINISHER_BURY_T) / (1 - FINISHER_BURY_T)));
      }
    }

    // 스윙 — 감기 → 베기 → 버팀(이 구간에 다시 클릭하면 다음 타로 연결) → 복귀.
    // 출발 자세는 "지금 팔이 있는 곳"이라 1→2→3타가 끊기지 않고 이어진다
    let pose: SwingPose | null = null;
    if (now < this.swingUntil) {
      const step = COMBO_SWINGS[this.swingIndex]!;
      const from = this.swingFrom ?? {
        rotX: HAMMER_REST_ROT,
        rotY: REST_RIGHT.rotY,
        x: REST_RIGHT.pos.x,
        y: REST_RIGHT.pos.y,
      };
      const rest: SwingPose = {
        rotX: HAMMER_REST_ROT,
        rotY: REST_RIGHT.rotY,
        x: REST_RIGHT.pos.x,
        y: REST_RIGHT.pos.y,
      };
      const mix = (a: SwingPose, b: SwingPose, k: number): SwingPose => ({
        rotX: a.rotX + (b.rotX - a.rotX) * k,
        rotY: a.rotY + (b.rotY - a.rotY) * k,
        x: a.x + (b.x - a.x) * k,
        y: a.y + (b.y - a.y) * k,
      });
      // 경과 시간을 배속으로 늘려 읽는다 — 아래 구간 길이(ms)는 그대로 두고 전체가 빨라진다
      const e = (now - this.swingStart) * this.swingSpeed;
      // 이미 그 자세에 있으면 감는 시간을 줄인다 — 아래에 있던 손이 곧바로 올라간다
      const near =
        Math.abs(from.rotX - step.windup.rotX) +
        Math.abs(from.rotY - step.windup.rotY) +
        Math.abs(from.x - step.windup.x) +
        Math.abs(from.y - step.windup.y);
      const t1 = step.windupMs * Math.min(1, near / 0.9);
      const t2 = t1 + step.strikeMs;
      const t3 = t2 + step.holdMs;
      if (e < t1) pose = mix(from, step.windup, easeOutCubic(e / t1));
      else if (e < t2) pose = mix(step.windup, step.strike, easeInCubic((e - t1) / step.strikeMs));
      else if (e < t3) pose = step.strike; // 그대로 버틴다 — 연결 대기
      else pose = mix(step.strike, rest, easeOutCubic((e - t3) / step.returnMs));
    }

    // 문 조작 — 해머를 내리고 맨손을 문에 얹어 더듬는다.
    // 스윙·처형이 돌고 있으면 그쪽이 이긴다 (때리는 중에 문을 만질 일은 없다)
    const doorFrac = state.doorFrac ?? 0;
    // 잠금을 만지는 동안은 해머를 내려놓은 것으로 친다 — 자루가 화면을 가로질러
    // 정작 만지는 손을 가린다. 누른 순간 소리와 함께 사라지므로 의도한 동작으로 읽힌다
    const bareHand = doorFrac > 0 && !pose && !finisher;
    for (const mesh of this.hammerParts) mesh.visible = !bareHand;
    if (bareHand) {
      // 앞으로 뻗어 벽면에 붙인 자세. 손끝이 화면 중앙 살짝 아래에 오게 둔다
      const reach = easeOutCubic(Math.min(1, doorFrac / DOOR_REACH_T));
      // 더듬는 결 — 위아래로 훑으면서 가끔 짧게 눌러 넣는다. 두 주기를 겹쳐
      // 일정한 왕복이 아니라 "찾고 있는" 손짓으로 읽히게 한다
      const t = now / 1000;
      const probe = Math.sin(t * DOOR_PROBE_HZ * Math.PI * 2);
      const drift = Math.sin(t * DOOR_DRIFT_HZ * Math.PI * 2);
      const push = Math.max(0, Math.sin(t * DOOR_PUSH_HZ * Math.PI * 2));
      pose = {
        rotX: DOOR_TOUCH.rotX + probe * 0.14,
        rotY: DOOR_TOUCH.rotY + drift * 0.16,
        x: DOOR_TOUCH.x + drift * 0.07,
        y: DOOR_TOUCH.y + probe * 0.055,
        z: DOOR_TOUCH.z - push * 0.035,
        rotZ: DOOR_TOUCH.rotZ + drift * 0.2,
      };
      // 시작 순간 팔이 순간이동하지 않게 대기 자세에서 뻗어 나간다
      const rest: SwingPose = {
        rotX: HAMMER_REST_ROT,
        rotY: REST_RIGHT.rotY,
        x: REST_RIGHT.pos.x,
        y: REST_RIGHT.pos.y,
        z: REST_RIGHT.pos.z,
        rotZ: REST_RIGHT.rotZ,
      };
      pose = {
        rotX: rest.rotX + (pose.rotX - rest.rotX) * reach,
        rotY: rest.rotY + (pose.rotY - rest.rotY) * reach,
        x: rest.x + (pose.x - rest.x) * reach,
        y: rest.y + (pose.y - rest.y) * reach,
        z: rest.z! + (pose.z! - rest.z!) * reach,
        rotZ: rest.rotZ! + (pose.rotZ! - rest.rotZ!) * reach,
      };
    }

    if (finisher) pose = finisher; // 처형이 스윙을 덮어쓴다
    if (pose) {
      this.rightArm.position.set(pose.x, pose.y, pose.z ?? SMASH_RIGHT.z);
      this.rightArm.rotation.y = pose.rotY;
      this.rightArm.rotation.z = pose.rotZ ?? 0; // 평타는 손목 비틀림 없음
      this.baseRotX = pose.rotX;
    } else {
      this.rightArm.position.x = REST_RIGHT.pos.x;
      this.rightArm.position.z = REST_RIGHT.pos.z;
      this.rightArm.position.y += (targetY - this.rightArm.position.y) * 0.3;
      this.rightArm.rotation.y = REST_RIGHT.rotY;
      this.rightArm.rotation.z = REST_RIGHT.rotZ;
      this.baseRotX += (targetRotX - this.baseRotX) * 0.35;
    }
    this.rightArm.rotation.x = this.baseRotX;

    // ---- 왼팔 (총/수류탄 + 브레이서) — 반동·장전·차징·투척이 여기서 일어난다
    let gunY = 0;
    let gunRot = 0;
    let gunZ = 0;
    if (state.stunned) {
      gunY -= 0.1;
      gunRot -= 0.55;
    } else if (state.reloading) {
      gunY -= 0.13;
      gunRot -= 0.8;
    }
    if (now < this.recoilUntil) {
      const k = (this.recoilUntil - now) / RECOIL_MS;
      gunZ += 0.055 * k;
      gunRot += 0.3 * k;
    }
    // 불발 — 앞 30%만 딸깍 튀고 나머지는 힘없이 내려온다. 반동의 1/5 크기라
    // "쐈는데 안 나갔다"로 읽힌다
    if (now < this.dryFireUntil) {
      const t = 1 - (this.dryFireUntil - now) / DRY_FIRE_MS;
      const jolt = t < 0.3 ? t / 0.3 : 1 - (t - 0.3) / 0.7;
      gunZ += 0.011 * jolt;
      gunRot += 0.06 * jolt;
      gunY -= 0.008 * jolt;
    }
    const ammoMat = this.ammoLabel.mesh.material as THREE.MeshBasicMaterial;
    ammoMat.color.setHex(now < this.dryFireUntil ? DRY_FIRE_TINT : 0xffffff);
    // 수류탄 — 차징 중엔 뒤로 당기고, 투척 시 앞으로 밀기
    gunZ += 0.14 * (state.chargeFrac ?? 0);
    gunRot -= 0.35 * (state.chargeFrac ?? 0);
    if (now < this.throwUntil) {
      const t = 1 - (this.throwUntil - now) / 240;
      gunZ -= 0.2 * Math.sin(t * Math.PI);
      gunRot -= 0.5 * Math.sin(t * Math.PI);
    }
    this.gunPoseY += (gunY - this.gunPoseY) * 0.25;
    this.gunPoseRot += (gunRot - this.gunPoseRot) * 0.35;

    // 왼팔 패링 스윙 — 빠르게 올려 가로로 막고(28%), 잠깐 유지(27%), 천천히 내린다.
    // 방어 홀드(C) 중에는 가드 자세를 유지한다
    let swing = 0;
    if (now < this.parryUntil) {
      const t = 1 - (this.parryUntil - now) / PARRY_SWING_MS;
      if (t < 0.28) swing = easeOutCubic(t / 0.28);
      else if (t < 0.55) swing = 1;
      else swing = 1 - easeInCubic((t - 0.55) / 0.45);
    }
    // 올릴 때는 즉발에 가깝게(3프레임 내 84%), 내릴 때는 부드럽게 —
    // 방패가 늦게 나온다는 체감의 절반은 이 보간이 원인이었다
    let blockTarget = state.blocking ? 1 : 0;
    // 처형 중에는 왼팔을 내려 시야를 비운다 (해머 동작이 주인공)
    if (now < this.finisherUntil) blockTarget = 0;
    this.blockBlend += (blockTarget - this.blockBlend) * (blockTarget > this.blockBlend ? 0.6 : 0.22);
    swing = Math.max(swing, this.blockBlend);

    this.leftArm.position.lerpVectors(REST_LEFT.pos, GUARD_LEFT.pos, swing);
    this.leftArm.rotation.x = REST_LEFT.rotX + (GUARD_LEFT.rotX - REST_LEFT.rotX) * swing;
    this.leftArm.rotation.y = REST_LEFT.rotY + (GUARD_LEFT.rotY - REST_LEFT.rotY) * swing;
    this.leftArm.rotation.z = REST_LEFT.rotZ + (GUARD_LEFT.rotZ - REST_LEFT.rotZ) * swing;
    // 방패 펼침 — 접힌 상태(0.34)에서 가드 시 전체 크기로
    const spread = 0.34 + 0.66 * swing;
    this.bracer.scale.set(1, spread, spread);

    // 사격 자세(반동·장전·차징)는 가드를 올릴수록 옅어진다 — 가드 중엔 못 쏘니까
    const gunWeight = 1 - swing;
    this.leftArm.position.y += this.gunPoseY * gunWeight;
    this.leftArm.position.z += gunZ * gunWeight;
    this.leftArm.rotation.x += this.gunPoseRot * gunWeight;
    if (swing > 0) {
      this.bracerMaterial.emissive.set(this.parryGlow);
      this.bracerMaterial.emissiveIntensity = swing;
    } else {
      this.bracerMaterial.emissive.set(0x000000);
    }

    // 방어 성공 섬광 — 패링 발광 위에 덮어쓴다. 2회 깜빡이며 잦아든다
    if (now < this.blockFlashUntil) {
      const t = 1 - (this.blockFlashUntil - now) / BLOCK_FLASH_MS;
      const pulse = Math.abs(Math.sin(t * Math.PI * 2)) * (1 - t * 0.35);
      this.bracerMaterial.emissive.set(BLOCK_FLASH_COLOR);
      this.bracerMaterial.emissiveIntensity = pulse;
    }

    // 방패에 꽂힌 화살 — 시간이 지나면 사라진다
    for (const stuck of this.shieldArrows) {
      if (stuck.group.visible && now > stuck.until) stuck.group.visible = false;
    }
  }
}

// 해머 대기(치켜든) 각도와 내리침 호 크기 (+x 회전 = 무기 끝이 위로)
const HAMMER_REST_ROT = 0.95; // 헤드가 어깨 위 (완전히 세우면 화면 중앙을 가린다)
// 연속타 안무 — 1타 우상→좌하, 2타 좌하→우상(올려치기), 3타 위→아래(강타).
// 각도 규약: rotX + = 무기 끝이 위 / rotY + = 왼쪽, − = 오른쪽
interface SwingPose {
  rotX: number;
  rotY: number;
  x: number;
  y: number;
  /** 처형 마무리만 사용 — 앞뒤(z)와 손목 비틀기까지 준다 */
  z?: number;
  rotZ?: number;
}
interface SwingStep {
  /** 감기 / 베기 / 버팀(연결 대기) / 복귀 — 절대 시간(ms) */
  windupMs: number;
  strikeMs: number;
  holdMs: number;
  returnMs: number;
  windup: SwingPose;
  strike: SwingPose;
}
const COMBO_SWINGS: SwingStep[] = [
  {
    // 1타 — 오른쪽 위에서 왼쪽 아래로 베어 내린다
    windupMs: 80,
    strikeMs: 95,
    // 버팀 = 로직상 연결 가능한 시간(후딜 10틱 + 창 26틱 ≒ 600ms)과 맞춘다.
    // 짧으면 클릭 전에 팔이 복귀해 "정렬됐다가 다시 휘두르는" 그림이 된다
    holdMs: 430,
    returnMs: 260,
    windup: { rotX: 1.0, rotY: -0.75, x: 0.4, y: -0.2 },
    strike: { rotX: -0.85, rotY: 0.62, x: -0.06, y: -0.4 },
  },
  {
    // 2타 — 왼쪽 아래에서 오른쪽 위로 올려친다 (1타 끝 자세에서 그대로 출발)
    windupMs: 60,
    strikeMs: 95,
    holdMs: 430,
    returnMs: 260,
    windup: { rotX: -0.8, rotY: 0.62, x: -0.02, y: -0.46 },
    strike: { rotX: 1.05, rotY: -0.5, x: 0.34, y: -0.16 },
  },
  {
    // 3타 — 머리 위로 치켜들었다 정면 아래로 내리찍는다 (강타)
    windupMs: 130,
    strikeMs: 110,
    holdMs: 170,
    returnMs: 280,
    windup: { rotX: 1.6, rotY: 0.02, x: 0.16, y: -0.12 },
    strike: { rotX: -0.8, rotY: -0.02, x: 0.11, y: -0.42 },
  },
];


// 포즈 정의 (카메라 로컬 좌표)
// 오른팔 대기: 손목은 화면 오른쪽 아래, 해머는 어깨 위로 걸쳐 든다.
// rotZ(손목 비틀기)는 거의 주지 않는다 — 크게 주면 팔이 꺾여 보인다
const REST_RIGHT = {
  pos: new THREE.Vector3(0.25, -0.33, -0.6),
  rotX: 0.06,
  rotY: -0.22,
  rotZ: 0.12,
};
/** 내리치는 동안 손목이 옮겨가는 위치 — 화면 중앙 살짝 오른쪽, 앞으로 */
const SMASH_RIGHT = new THREE.Vector3(0.1, -0.26, -0.56);
// 문 잠금을 더듬는 자세 — 손을 조준점 오른쪽 아래로 들어 올려 벽면에 붙인다.
// z 는 대기(-0.6)에서 거의 안 당긴다: 손목을 카메라 쪽으로 끌면 팔뚝이 근평면에
// 걸려 화면 절반을 덮는 판때기가 된다 (-0.42 에서 실측 확인)
const DOOR_TOUCH = { rotX: 0.08, rotY: 0.16, x: 0.13, y: -0.12, z: -0.56, rotZ: -0.12 };
/** 뻗는 데 쓰는 진행률 구간 — 채널 앞 15% 동안 손이 문에 닿는다 */
const DOOR_REACH_T = 0.15;
/** 더듬는 손짓 주파수(Hz) — 셋을 겹쳐 규칙적인 왕복으로 보이지 않게 한다 */
const DOOR_PROBE_HZ = 1.7;
const DOOR_DRIFT_HZ = 0.63;
const DOOR_PUSH_HZ = 1.1;
// 대기: 화면 왼쪽 아래 밖. 가드: 팔뚝이 화면을 가로로 가로막는다 (rotY로 눕힘, 주먹이 오른쪽)
// 왼팔 대기: 총을 든 손. 각도는 총열이 화면 중앙(조준점)으로 수렴하도록 맞췄다 —
// 실측으로 좌 2.9°·상 3.4° 어긋나 있던 것을 보정한 값
const REST_LEFT = { pos: new THREE.Vector3(-0.17, -0.15, -0.5), rotX: 0.008, rotY: -0.013, rotZ: 0 };
// 가드 높이: 조준점(화면 중앙)을 가리지 않도록 하단에 배치 — 시야 확보 피드백
const GUARD_LEFT = { pos: new THREE.Vector3(0.02, -0.24, -0.44), rotX: 0.12, rotY: -1.3, rotZ: -0.3 };
