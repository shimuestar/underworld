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
const BLOCK_FLASH_MS = 260; // 방어 성공 섬광 (2회 깜빡임)
const BASH_MS = 420; // 처형 방패 강타
const BASH_GLOW = 0xfff0c0; // 강타 순간의 백금색 발광
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

  private recoilUntil = 0;
  private parryUntil = 0;
  private parryGlow = 0x000000;
  private blockBlend = 0;
  private readonly gunParts: THREE.Mesh[] = [];
  private readonly hammerParts: THREE.Mesh[] = [];
  private readonly grenadeParts: THREE.Mesh[] = [];
  private swingUntil = 0;
  private baseRotX = 0;
  /** 왼팔(총) 자세 보간값 — 가드 블렌드와 별도로 유지된다 */
  private gunPoseY = 0;
  private gunPoseRot = 0;
  private throwUntil = 0;
  private blockFlashUntil = 0;
  private bashUntil = 0;
  private readonly shieldArrows: { group: THREE.Group; until: number }[] = [];
  private shieldArrowSlot = 0;
  private readonly skinMaterials: THREE.MeshLambertMaterial[] = [];
  private corruptionStage = -1;

  constructor() {
    // ---- 오른팔 = 해머 (근접, 우클릭) ----
    const forearm = box(0.045, 0.045, 0.16, SLEEVE);
    forearm.position.set(0.015, -0.035, 0.08);
    forearm.rotation.x = 0.35;
    this.rightArm.add(forearm);

    const hand = box(0.055, 0.052, 0.065, SKIN);
    hand.position.set(0, -0.015, -0.01);
    this.skinMaterials.push(hand.material as THREE.MeshLambertMaterial);
    this.rightArm.add(hand);

    const hammerShaft = box(0.032, 0.032, 0.42, 0x5c4a33);
    hammerShaft.position.set(0, 0.03, -0.17);
    const hammerHead = box(0.13, 0.09, 0.17, 0x7a7d84);
    hammerHead.position.set(0, 0.03, -0.4);
    this.hammerParts.push(hammerShaft, hammerHead);
    this.rightArm.add(hammerShaft);
    this.rightArm.add(hammerHead);

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
    // 가드 자세에서 방패 바깥면(-x)은 카메라 반대쪽이라 그대로 두면 판에 가린다.
    // tilt(-z 회전)로 샤프트를 위로 세워 방패 위로 솟게 한다.
    const arrowSpots: [number, number, number][] = [
      [0.04, -0.06, -0.62], // [높이, 좌우, 기울기]
      [0.0, 0.02, -0.86],
      [-0.05, 0.07, -1.04],
    ];
    for (const [dy, dz, tilt] of arrowSpots) {
      const stuck = new THREE.Group();
      const shaft = box(0.17, 0.016, 0.016, 0x6b5233);
      shaft.position.set(-0.085, 0, 0); // 꽂힌 지점에서 바깥으로 뻗는다
      stuck.add(shaft);
      const fletch = box(0.035, 0.032, 0.007, 0x9b3535);
      fletch.position.set(-0.155, 0, 0);
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

  /** 왼손에 든 원거리 무기 교체 (해머는 항상 오른손에 있다) */
  setWeapon(kind: 'hammer' | 'grenade' | 'pistol'): void {
    for (const mesh of this.gunParts) mesh.visible = kind !== 'grenade';
    for (const mesh of this.grenadeParts) mesh.visible = kind === 'grenade';
  }

  triggerHammerSwing(): void {
    this.swingUntil = performance.now() + 170;
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

  /** 처형 방패 강타 — 살짝 당겼다 화면 밖으로 찍어누르듯 밀어친다 */
  triggerShieldBash(): void {
    this.bashUntil = performance.now() + BASH_MS;
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

    // ---- 오른팔 (해머) — 대기는 치켜든 자세, 좌클릭이 아니라 우클릭에 반응한다
    let targetY = REST_RIGHT.pos.y;
    let targetRotX = HAMMER_REST_ROT;
    if (state.stunned) {
      targetY -= 0.1;
      targetRotX -= 0.55;
    }

    let swingRot = 0; // 즉발 오프셋 — 보간을 거치지 않아 스냅이 살아있다
    let center = 0; // 0 = 어깨 너머 대기 / 1 = 화면 중앙으로 모은 타격 자세
    if (now < this.swingUntil) {
      const t = 1 - (this.swingUntil - now) / 170;
      if (t < 0.45) swingRot += HAMMER_SMASH_ARC * easeInCubic(t / 0.45);
      else if (t < 0.7) swingRot += HAMMER_SMASH_ARC;
      else swingRot += HAMMER_SMASH_ARC * (1 - (t - 0.7) / 0.3);
      // 대기 자세는 오른쪽으로 비껴 들지만, 내리칠 때는 정면으로 모아야
      // 판정(전방)과 보이는 궤적이 맞는다
      center = t < 0.6 ? Math.min(1, t / 0.18) : 1 - (t - 0.6) / 0.4;
      center = Math.max(0, Math.min(1, center));
    }

    this.rightArm.position.y += (targetY - this.rightArm.position.y) * 0.25;
    this.rightArm.position.x =
      REST_RIGHT.pos.x + (SMASH_RIGHT.x - REST_RIGHT.pos.x) * center;
    this.rightArm.position.z =
      REST_RIGHT.pos.z + (SMASH_RIGHT.z - REST_RIGHT.pos.z) * center;
    this.rightArm.rotation.y = REST_RIGHT.rotY * (1 - center);
    this.rightArm.rotation.z = REST_RIGHT.rotZ * (1 - center);
    this.baseRotX += (targetRotX - this.baseRotX) * 0.35;
    this.rightArm.rotation.x = this.baseRotX + swingRot;

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
    const blockTarget = state.blocking ? 1 : 0;
    this.blockBlend += (blockTarget - this.blockBlend) * (blockTarget > this.blockBlend ? 0.6 : 0.22);
    swing = Math.max(swing, this.blockBlend);

    // 처형 강타 — 가드 자세를 기준점으로 삼아 뒤로 당겼다(15%) 앞으로 찍고(35%) 회수
    let bash = 0;
    if (now < this.bashUntil) {
      const t = 1 - (this.bashUntil - now) / BASH_MS;
      if (t < 0.15) bash = -0.35 * easeOutCubic(t / 0.15); // 당김 (뒤로)
      else if (t < 0.35) bash = -0.35 + 1.35 * easeInCubic((t - 0.15) / 0.2); // 강타
      else bash = 1.0 * (1 - easeOutCubic((t - 0.35) / 0.65)); // 회수
      // 강타 내내 팔은 화면 안에 있어야 한다 — 당김 단계가 보이지 않으면 준비 동작이 죽는다
      const presence = t < 0.35 ? 0.88 : 0.72 + 0.28 * Math.max(0, bash);
      swing = Math.max(swing, presence);
    }

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
    if (bash !== 0) {
      // 가드 자세에서 화면 안쪽으로 밀어치며 방패면이 정면을 향하도록 비튼다
      this.leftArm.position.z -= 0.42 * bash;
      this.leftArm.position.x += 0.1 * bash;
      this.leftArm.position.y += 0.06 * bash;
      this.leftArm.rotation.y += 0.55 * bash;
      this.leftArm.rotation.z -= 0.25 * bash;
      // 오른팔은 반동으로 뒤로 빠진다
      this.rightArm.position.z += 0.12 * Math.max(0, bash);
      this.rightArm.rotation.x -= 0.25 * Math.max(0, bash);
    }
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

    // 강타 발광 — 당기는 동안 은은히 차오르다 찍는 순간 터진다
    if (bash < 0) {
      this.bracerMaterial.emissive.set(BASH_GLOW);
      this.bracerMaterial.emissiveIntensity = 0.35 * (-bash / 0.35);
    } else if (bash > 0) {
      this.bracerMaterial.emissive.set(BASH_GLOW);
      this.bracerMaterial.emissiveIntensity = bash;
    }

    // 방패에 꽂힌 화살 — 시간이 지나면 사라진다
    for (const stuck of this.shieldArrows) {
      if (stuck.group.visible && now > stuck.until) stuck.group.visible = false;
    }
  }
}

// 해머 대기(치켜든) 각도와 내리침 호 크기 (+x 회전 = 무기 끝이 위로)
const HAMMER_REST_ROT = 1.05; // 헤드가 어깨 위 (완전히 세우면 화면 중앙을 가린다)
const HAMMER_SMASH_ARC = -2.5; // +1.35 → -1.15 (머리 위에서 정면 아래로)

// 포즈 정의 (카메라 로컬 좌표)
// 오른팔 대기: 해머를 오른쪽 어깨 너머로 비껴 든다 (상시 표시라 시야를 최소로 가린다)
const REST_RIGHT = {
  pos: new THREE.Vector3(0.38, -0.4, -0.5),
  rotX: 0.06,
  rotY: -0.35,
  rotZ: 0.5,
};
/** 내리치는 순간 팔이 모이는 위치 — 화면 중앙 살짝 오른쪽 */
const SMASH_RIGHT = new THREE.Vector3(0.1, -0.24, -0.46);
// 대기: 화면 왼쪽 아래 밖. 가드: 팔뚝이 화면을 가로로 가로막는다 (rotY로 눕힘, 주먹이 오른쪽)
// 왼팔 대기: 총을 든 손. 각도는 총열이 화면 중앙(조준점)으로 수렴하도록 맞췄다 —
// 실측으로 좌 2.9°·상 3.4° 어긋나 있던 것을 보정한 값
const REST_LEFT = { pos: new THREE.Vector3(-0.17, -0.15, -0.5), rotX: 0.008, rotY: -0.013, rotZ: 0 };
// 가드 높이: 조준점(화면 중앙)을 가리지 않도록 하단에 배치 — 시야 확보 피드백
const GUARD_LEFT = { pos: new THREE.Vector3(0.02, -0.24, -0.44), rotX: 0.12, rotY: -1.3, rotZ: -0.3 };
