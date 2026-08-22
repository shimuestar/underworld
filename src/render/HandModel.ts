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
const PARRY_SWING_MS = 340;

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

  private recoilUntil = 0;
  private parryUntil = 0;
  private parryGlow = 0x000000;
  private blockBlend = 0;
  private readonly gunParts: THREE.Mesh[] = [];
  private readonly hammerParts: THREE.Mesh[] = [];
  private readonly grenadeParts: THREE.Mesh[] = [];
  private swingUntil = 0;
  private baseRotX = 0;
  private throwUntil = 0;
  private readonly skinMaterials: THREE.MeshLambertMaterial[] = [];
  private corruptionStage = -1;

  constructor() {
    // ---- 오른팔 + 권총 ----
    const forearm = box(0.045, 0.045, 0.16, SLEEVE);
    forearm.position.set(0.015, -0.035, 0.08);
    forearm.rotation.x = 0.35;
    this.rightArm.add(forearm);

    const hand = box(0.055, 0.052, 0.065, SKIN);
    hand.position.set(0, -0.015, -0.01);
    this.skinMaterials.push(hand.material as THREE.MeshLambertMaterial);
    this.rightArm.add(hand);

    const slide = box(0.03, 0.038, 0.17, GUN_DARK);
    slide.position.set(0, 0.035, -0.07);
    this.gunParts.push(slide);
    this.rightArm.add(slide);

    const grip = box(0.026, 0.07, 0.038, GRIP);
    grip.position.set(0, -0.022, -0.005);
    grip.rotation.x = -0.25;
    this.gunParts.push(grip);
    this.rightArm.add(grip);

    // 해머 (슬롯 1)
    const hammerShaft = box(0.035, 0.035, 0.5, 0x5c4a33);
    hammerShaft.position.set(0, 0.03, -0.2);
    const hammerHead = box(0.15, 0.1, 0.2, 0x7a7d84);
    hammerHead.position.set(0, 0.03, -0.46);
    this.hammerParts.push(hammerShaft, hammerHead);
    this.rightArm.add(hammerShaft);
    this.rightArm.add(hammerHead);

    // 수류탄 (슬롯 2)
    const grenadeBall = new THREE.Mesh(
      new THREE.SphereGeometry(0.05, 8, 8),
      new THREE.MeshLambertMaterial({ color: 0x3d4a2e }),
    );
    grenadeBall.position.set(0, 0.02, -0.06);
    this.grenadeParts.push(grenadeBall);
    this.rightArm.add(grenadeBall);

    this.setWeapon('pistol');

    this.rightArm.position.copy(REST_RIGHT.pos);
    this.rightArm.rotation.set(REST_RIGHT.rotX, 0, 0);
    this.group.add(this.rightArm);

    // ---- 왼팔 브레이서 (평소엔 화면 밖, 패링 시 올라온다) ----
    const lForearm = box(0.048, 0.048, 0.19, SLEEVE);
    lForearm.position.set(0, 0, 0.015);
    this.leftArm.add(lForearm);

    const lFist = box(0.06, 0.056, 0.06, SKIN);
    lFist.position.set(0, 0.004, -0.11);
    this.skinMaterials.push(lFist.material as THREE.MeshLambertMaterial);
    this.leftArm.add(lFist);

    this.bracerMaterial = new THREE.MeshLambertMaterial({ color: BRACER });
    const bracer = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.09, 0.21), this.bracerMaterial);
    bracer.position.set(-0.038, 0.008, 0);
    this.leftArm.add(bracer);

    this.leftArm.position.copy(REST_LEFT.pos);
    this.leftArm.rotation.set(REST_LEFT.rotX, REST_LEFT.rotY, REST_LEFT.rotZ);
    this.group.add(this.leftArm);
  }

  triggerRecoil(): void {
    this.recoilUntil = performance.now() + RECOIL_MS;
  }

  /** 무기 전환 — 오른손에 들린 모델 교체 */
  setWeapon(kind: 'hammer' | 'grenade' | 'pistol'): void {
    for (const mesh of this.gunParts) mesh.visible = kind === 'pistol';
    for (const mesh of this.hammerParts) mesh.visible = kind === 'hammer';
    for (const mesh of this.grenadeParts) mesh.visible = kind === 'grenade';
  }

  triggerHammerSwing(): void {
    this.swingUntil = performance.now() + 170;
  }

  triggerGrenadeThrow(): void {
    this.throwUntil = performance.now() + 240;
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
  }): void {
    const now = performance.now();

    // 오른팔 목표 포즈
    let targetY = REST_RIGHT.pos.y;
    let targetRotX = REST_RIGHT.rotX;
    if (state.stunned) {
      targetY -= 0.1;
      targetRotX -= 0.55;
    } else if (state.reloading) {
      targetY -= 0.13;
      targetRotX -= 0.8;
    }

    // 즉발 오프셋 — 보간을 거치지 않아 스냅이 살아있다 (반동/스윙/투척)
    let directRot = 0;
    let kickZ = 0;
    if (now < this.recoilUntil) {
      const k = (this.recoilUntil - now) / RECOIL_MS;
      kickZ = 0.055 * k;
      directRot += 0.3 * k;
    }

    // 해머 스윙 — 머리 위로 확 치켜들었다(35%) 격하게 내리찍고(35%) 복귀(30%)
    if (now < this.swingUntil) {
      const t = 1 - (this.swingUntil - now) / 170;
      if (t < 0.35) directRot += -1.7 * easeOutCubic(t / 0.35);
      else if (t < 0.7) directRot += -1.7 + 3.0 * easeInCubic((t - 0.35) / 0.35);
      else directRot += 1.3 * (1 - (t - 0.7) / 0.3);
    }
    // 수류탄 — 차징 중엔 뒤로 당기고(부드럽게), 투척 시 앞으로 밀기(즉발)
    kickZ += 0.14 * (state.chargeFrac ?? 0);
    targetRotX -= 0.35 * (state.chargeFrac ?? 0);
    if (now < this.throwUntil) {
      const t = 1 - (this.throwUntil - now) / 240;
      kickZ -= 0.2 * Math.sin(t * Math.PI);
      directRot -= 0.5 * Math.sin(t * Math.PI);
    }

    this.rightArm.position.y += (targetY - this.rightArm.position.y) * 0.25;
    this.rightArm.position.z = REST_RIGHT.pos.z + kickZ;
    this.baseRotX += (targetRotX - this.baseRotX) * 0.35;
    this.rightArm.rotation.x = this.baseRotX + directRot;

    // 왼팔 패링 스윙 — 빠르게 올려 가로로 막고(28%), 잠깐 유지(27%), 천천히 내린다.
    // 방어 홀드(C) 중에는 가드 자세를 유지한다
    let swing = 0;
    if (now < this.parryUntil) {
      const t = 1 - (this.parryUntil - now) / PARRY_SWING_MS;
      if (t < 0.28) swing = easeOutCubic(t / 0.28);
      else if (t < 0.55) swing = 1;
      else swing = 1 - easeInCubic((t - 0.55) / 0.45);
    }
    this.blockBlend += ((state.blocking ? 1 : 0) - this.blockBlend) * 0.3;
    swing = Math.max(swing, this.blockBlend);
    this.leftArm.position.lerpVectors(REST_LEFT.pos, GUARD_LEFT.pos, swing);
    this.leftArm.rotation.x = REST_LEFT.rotX + (GUARD_LEFT.rotX - REST_LEFT.rotX) * swing;
    this.leftArm.rotation.y = REST_LEFT.rotY + (GUARD_LEFT.rotY - REST_LEFT.rotY) * swing;
    this.leftArm.rotation.z = REST_LEFT.rotZ + (GUARD_LEFT.rotZ - REST_LEFT.rotZ) * swing;
    if (swing > 0) {
      this.bracerMaterial.emissive.set(this.parryGlow);
      this.bracerMaterial.emissiveIntensity = swing;
    } else {
      this.bracerMaterial.emissive.set(0x000000);
    }
  }
}

// 포즈 정의 (카메라 로컬 좌표)
const REST_RIGHT = { pos: new THREE.Vector3(0.16, -0.14, -0.5), rotX: 0.06 };
// 대기: 화면 왼쪽 아래 밖. 가드: 팔뚝이 화면을 가로로 가로막는다 (rotY로 눕힘, 주먹이 오른쪽)
const REST_LEFT = { pos: new THREE.Vector3(-0.42, -0.58, -0.5), rotX: 0.35, rotY: -0.15, rotZ: 0.45 };
const GUARD_LEFT = { pos: new THREE.Vector3(0.02, -0.09, -0.44), rotX: 0.12, rotY: -1.3, rotZ: -0.3 };
