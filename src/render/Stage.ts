// Three.js 렌더 셋업 전용. 게임 로직 금지.
// World 상태(플레이어, 랜턴, 무기, 적)를 읽어 씬에 반영만 한다.

import * as THREE from 'three';
import { balance } from '../core/Balance';
import { currentAttack, enemyDef } from '../core/Entities';
import { glyphTexture } from '../level/GridLoader';
import type { EnemyState, GroundItemState, ProjectileState } from '../core/World';
import { HandModel } from './HandModel';

// 적 타입별 몸통 색 (시각 팔레트 — 튜닝값 아님)
const ENEMY_COLORS: Record<string, number> = {
  goblin_runner: 0x4a8f3c,
  goblin_spear: 0x3c7a8f,
  goblin_archer: 0x8a8a3a,
  warden: 0x5a4470,
  goblin_chieftain: 0x8f5a30,
};
const ENEMY_COLOR_FALLBACK = 0x8f3c3c;
const BARRIER_COLOR = 0x9db8e8;
const ARMOR_COLOR = 0x777d88;
const ENEMY_BOLT_COLOR = 0xa855f7; // 마법 투사체 색 규약 (balance.telegraph.colorProjectile)

// 텔레그래프 이외 상태 표시색 (텔레그래프 3색과 겹치지 않게 — 색이 곧 문법)
const STAGGER_COLOR = 0xcc9922; // 스태거 = 처형 가능 표시
const WINDUP_TINT = 0x0e2440; // 예비 동작의 옅은 예고 (본 섬광은 종료 4t 전)
const BURN_TINT = 0x8f3300; // 화상 중
const FIREBALL_COLOR = 0xff7733;
const GROUND_ITEM_COLOR = 0xe8c76a; // 바닥 각인 — 어둠 속 금색 발광

// 트레이서 시각 상수 (튜닝값 아님 — 순수 연출)
const TRACER_COLOR = 0xffe9b8;
const MUZZLE_OFFSET = { x: 0.16, y: -0.1, z: -0.66 }; // 카메라 로컬: 권총 총구 끝

// 적 부속물 색
const SHIELD_COLOR = 0x6f7480;
const SPEAR_TIP = 0x9aa2ad;
const HEAD_DARKEN = 0.72;

// 근접 무기 규격 (시각 — 실제 사거리는 entities.json attackRange가 결정)
// style: smash = 치켜들었다 내리침 / thrust = 수평 견착 후 내지름
const MELEE_WEAPONS: Record<
  string,
  {
    length: number;
    width: number;
    color: number;
    style: 'smash' | 'thrust';
    tip?: boolean;
    headSize?: number;
  }
> = {
  goblin_runner: { length: 1.0, width: 0.11, color: 0x6b5233, style: 'smash' },
  goblin_spear: { length: 2.0, width: 0.07, color: 0x5c4a33, style: 'thrust', tip: true },
  goblin_chieftain: { length: 2.0, width: 0.26, color: 0x4a3826, style: 'smash', headSize: 0.5 },
};
/** smash 팔 각도: 휴식/치켜듦/내리침 */
const ARM_REST = 0.55;
const ARM_RAISED = -2.0;
const ARM_SMASH = 1.3;
/** thrust: 수평 견착 각도, 당김/내지름 거리 */
const THRUST_LEVEL = 0.05;
const THRUST_PULL = 0.6;
const THRUST_LUNGE = -1.0;

interface EnemyVisual {
  group: THREE.Group;
  /** 몸통+머리 서브그룹 — 공격 모션(기울임/내지름)의 피벗 (발 기준) */
  torso: THREE.Group;
  /** 텔레그래프 발광을 적용할 머티리얼들 (몸통/머리/창끝) */
  flashMaterials: THREE.MeshLambertMaterial[];
  shield?: THREE.Mesh;
  shieldMaterial?: THREE.MeshLambertMaterial;
  /** 근접 무기 팔 피벗 — 치켜들었다 내리찍는다 */
  arm?: THREE.Group;
  shieldFlashUntil: number;
  /** warden 방어막 셸 */
  barrier?: THREE.Mesh;
  barrierMaterial?: THREE.MeshLambertMaterial;
  barrierFlashUntil: number;
  /** 보스 장갑판 (armored 페이즈에만 표시) */
  armorPlates?: THREE.Mesh;
  /** 시전 충전 구체 (warden) */
  chargeOrb?: THREE.Mesh;
  /** 활 (archer) */
  bow?: THREE.Mesh;
  /** 머리 위 이름표 + HP 바 */
  plate: THREE.Sprite;
  plateTexture: THREE.CanvasTexture;
  plateCanvas: HTMLCanvasElement;
  /** 마지막으로 그린 상태 키 — 변화 시에만 다시 그린다 */
  plateKey: string;
}

const PLATE_W = 256;
const PLATE_H = 72;

function drawPlate(
  canvas: HTMLCanvasElement,
  name: string,
  healthFrac: number,
  armorFrac: number | null,
): void {
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, PLATE_W, PLATE_H);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 24px monospace';
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillText(name, 129, 19);
  ctx.fillStyle = '#e8e8ee';
  ctx.fillText(name, 128, 18);

  // HP 바
  const barX = 28;
  const barW = 200;
  const barY = 40;
  const barH = 16;
  ctx.fillStyle = 'rgba(0,0,0,0.65)';
  ctx.fillRect(barX - 2, barY - 2, barW + 4, barH + 4);
  const frac = Math.max(0, Math.min(1, healthFrac));
  ctx.fillStyle = frac > 0.5 ? '#3fae5a' : frac > 0.25 ? '#c9a227' : '#e04444';
  ctx.fillRect(barX, barY, barW * frac, barH);

  // 보스 장갑 바 (armored 페이즈)
  if (armorFrac !== null) {
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillRect(barX - 2, barY + barH + 4, barW + 4, 10);
    ctx.fillStyle = '#9aa2ad';
    ctx.fillRect(barX, barY + barH + 6, barW * Math.max(0, Math.min(1, armorFrac)), 6);
  }
}
const TRACER_START_PUSH = 0.5; // 총구에서 이만큼 전진한 지점부터 그린다 (근접부 왜곡 방지)
const TRACER_WIDTH = 0.022;

// 사망 파편 (시각 상수)
const DEATH_PARTICLE_COUNT = 14;
const DEATH_PARTICLE_LIFE_MS = 650;
const DEATH_GRAVITY = 14;

interface Particle {
  mesh: THREE.Mesh;
  ox: number;
  oy: number;
  oz: number;
  vx: number;
  vy: number;
  vz: number;
  bornMs: number;
}

interface Tracer {
  group: THREE.Group;
  beam: THREE.Mesh;
  spark: THREE.Mesh;
  bornMs: number;
  lifeMs: number;
}

export class Stage {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly lantern: THREE.SpotLight;
  private lanternSpill!: THREE.PointLight;
  private readonly muzzleLight: THREE.PointLight;
  private readonly eyeHeight = balance.player.eyeHeight;
  private readonly enemyVisuals = new Map<number, EnemyVisual>();
  private readonly projectileVisuals = new Map<number, THREE.Group>();
  private readonly groundItemVisuals = new Map<number, THREE.Group>();
  private readonly tracers: Tracer[] = [];
  private readonly particles: Particle[] = [];
  private readonly hands = new HandModel();
  private ambientLight: THREE.AmbientLight | null = null;
  private levelAmbient = 0;

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: false });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000000);

    this.camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      200,
    );
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);

    // 랜턴 스포트라이트 — 카메라에 부착해 시선을 따라간다.
    // decay 0: distance 컷오프 감쇠만 사용 (balance intensity 스케일 유지)
    const lp = balance.lantern;
    this.lantern = new THREE.SpotLight(
      0xffffff,
      lp.intensity,
      lp.radius,
      (lp.angleDeg * Math.PI) / 180,
      lp.penumbra,
      0,
    );
    this.lantern.position.set(0, 0, 0);
    this.lantern.target.position.set(0, 0, -1);
    this.camera.add(this.lantern);
    this.camera.add(this.lantern.target);

    // 랜턴 잔광 — 좁은 빔 밖 발밑 주변의 약한 빛 (완전 암흑 방지)
    this.lanternSpill = new THREE.PointLight(0xffffff, lp.spillIntensity, lp.spillRadius, 0);
    this.camera.add(this.lanternSpill);

    // 총구 화염 — 강도/반경은 랜턴의 배율 (combat.md §6: 실질적 정찰 수단, 미묘하게 만들지 말 것)
    const mf = balance.weapons.pistol.muzzleFlash;
    this.muzzleLight = new THREE.PointLight(
      0xffd9a0,
      lp.intensity * mf.intensity,
      lp.radius * mf.radiusMul,
      0,
    );
    this.muzzleLight.visible = false;
    this.muzzleLight.position.set(MUZZLE_OFFSET.x, MUZZLE_OFFSET.y, MUZZLE_OFFSET.z);
    this.camera.add(this.muzzleLight);

    // 1인칭 뷰모델
    this.camera.add(this.hands.group);

    window.addEventListener('resize', this.onResize);
  }

  triggerRecoil(): void {
    this.hands.triggerRecoil();
  }

  setHandWeapon(kind: 'hammer' | 'grenade' | 'pistol'): void {
    this.hands.setWeapon(kind);
  }

  triggerHammerSwing(): void {
    this.hands.triggerHammerSwing();
  }

  /** 방어 성공 — 방패 섬광 + 화살이면 방패에 꽂힘 */
  triggerBlockHit(kind?: string): void {
    this.hands.triggerBlockHit(kind);
  }

  triggerGrenadeThrow(): void {
    this.hands.triggerGrenadeThrow();
  }

  triggerParry(result: string): void {
    this.hands.triggerParry(result);
  }

  flashShield(enemyId: number): void {
    const visual = this.enemyVisuals.get(enemyId);
    if (visual) visual.shieldFlashUntil = performance.now() + 120;
  }

  /** 방어막/장갑 튕김 번쩍 (7.2 피드백) */
  flashBarrier(enemyId: number): void {
    const visual = this.enemyVisuals.get(enemyId);
    if (visual) visual.barrierFlashUntil = performance.now() + 160;
  }

  updateHands(state: {
    reloading: boolean;
    stunned: boolean;
    blocking?: boolean;
    chargeFrac?: number;
  }): void {
    this.hands.update(state);
  }

  setLevel(group: THREE.Group, ambientIntensity: number): void {
    this.scene.add(group);
    this.levelAmbient = ambientIntensity;
    this.ambientLight = new THREE.AmbientLight(0xffffff, ambientIntensity);
    this.scene.add(this.ambientLight);
  }

  /** 암시야 각인 — ambient 가산. boost 0 = 레벨 기본값 */
  setAmbientBoost(boost: number): void {
    if (this.ambientLight) this.ambientLight.intensity = this.levelAmbient + boost * 0.22;
  }

  /** 왼팔 각인 페널티 — 랜턴 밝기 배율 (빔·잔광 모두) */
  setLanternIntensityMul(mul: number): void {
    this.lantern.intensity = balance.lantern.intensity * mul;
    this.lanternSpill.intensity = balance.lantern.spillIntensity * mul;
  }

  /** 오염 25 임계 — 벽 문자를 원문으로 교체 */
  setGlyphsReadable(readable: boolean): void {
    this.scene.traverse((obj) => {
      if (obj.name !== 'glyph' || !(obj instanceof THREE.Mesh)) return;
      const material = obj.material as THREE.MeshBasicMaterial;
      material.map?.dispose();
      material.map = glyphTexture(obj.userData['glyphText'] as string, readable);
      material.needsUpdate = true;
    });
  }

  /** 오염 시각 단계를 뷰모델에 전달 */
  setCorruptionStage(stage: number): void {
    this.hands.setCorruptionStage(stage);
  }

  /** 문 개방 — 해당 문 메시 제거 */
  openDoor(row: number, col: number): void {
    this.removeNamedCell(`door-${row}-${col}`);
  }

  /** 균열 벽 파괴 */
  breakCrack(row: number, col: number): void {
    this.removeNamedCell(`crack-${row}-${col}`);
  }

  private removeNamedCell(name: string): void {
    const mesh = this.scene.getObjectByName(name);
    if (mesh instanceof THREE.Mesh) {
      mesh.parent?.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
  }

  /** 벽에 꽂힌 화살 (잔존물 — 오래된 것부터 제거) */
  private readonly stuckArrows: THREE.Group[] = [];
  spawnStuckArrow(x: number, y: number, z: number, dx: number, dy: number, dz: number): void {
    const arrow = new THREE.Group();
    const shaft = new THREE.Mesh(
      new THREE.BoxGeometry(0.05, 0.05, 0.6),
      new THREE.MeshLambertMaterial({ color: 0x6b5233 }),
    );
    arrow.add(shaft);
    // 촉이 박힌 지점에서 꼬리가 튀어나오도록 뒤로 물림
    arrow.position.set(x - dx * 0.26, y - dy * 0.26, z - dz * 0.26);
    arrow.lookAt(x + dx, y + dy, z + dz);
    this.scene.add(arrow);
    this.stuckArrows.push(arrow);
    if (this.stuckArrows.length > 30) {
      const oldest = this.stuckArrows.shift()!;
      this.scene.remove(oldest);
      oldest.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          (obj.material as THREE.Material).dispose();
        }
      });
    }
  }

  /** 총알 탄흔 (잔존물) */
  private readonly bulletMarks: THREE.Mesh[] = [];
  spawnBulletMark(x: number, y: number, z: number): void {
    const mark = new THREE.Mesh(
      new THREE.SphereGeometry(0.07, 6, 5),
      new THREE.MeshBasicMaterial({ color: 0x121216 }),
    );
    mark.position.set(x, y, z);
    this.scene.add(mark);
    this.bulletMarks.push(mark);
    if (this.bulletMarks.length > 40) {
      const oldest = this.bulletMarks.shift()!;
      this.scene.remove(oldest);
      oldest.geometry.dispose();
      (oldest.material as THREE.Material).dispose();
    }
  }

  /** 수류탄 차징 궤적 미리보기 — 점선. null이면 숨김 */
  private readonly arcDots: THREE.Mesh[] = [];
  updateThrowArc(points: { x: number; y: number; z: number }[] | null): void {
    const count = points?.length ?? 0;
    while (this.arcDots.length < count) {
      const dot = new THREE.Mesh(
        new THREE.SphereGeometry(0.055, 6, 6),
        new THREE.MeshBasicMaterial({
          color: 0xffe9a0,
          transparent: true,
          opacity: 0.75,
          depthWrite: false,
        }),
      );
      this.arcDots.push(dot);
      this.scene.add(dot);
    }
    for (let i = 0; i < this.arcDots.length; i++) {
      const dot = this.arcDots[i]!;
      if (points && i < points.length) {
        dot.visible = true;
        dot.position.set(points[i]!.x, points[i]!.y, points[i]!.z);
      } else {
        dot.visible = false;
      }
    }
  }

  /** 수류탄 폭발 — 섬광 + 팽창 구 + 파편 */
  spawnExplosion(x: number, y: number, z: number, radius: number): void {
    const now = performance.now();
    const flash = new THREE.PointLight(0xffb040, 6, radius * 3, 0);
    flash.position.set(x, Math.max(0.5, y), z);
    this.scene.add(flash);
    const shell = new THREE.Mesh(
      new THREE.SphereGeometry(1, 12, 10),
      new THREE.MeshBasicMaterial({
        color: 0xff8830,
        transparent: true,
        opacity: 0.7,
        depthWrite: false,
      }),
    );
    shell.position.copy(flash.position);
    this.scene.add(shell);
    this.explosions.push({ light: flash, shell, bornMs: now, radius });
    // 파편 재활용 — 폭심에서 사방으로
    this.spawnDeathBurst(x, z, 'goblin_chieftain');
  }

  private readonly explosions: {
    light: THREE.PointLight;
    shell: THREE.Mesh;
    bornMs: number;
    radius: number;
  }[] = [];

  private updateExplosions(): void {
    const now = performance.now();
    for (let i = this.explosions.length - 1; i >= 0; i--) {
      const ex = this.explosions[i]!;
      const age = (now - ex.bornMs) / 380;
      if (age >= 1) {
        this.scene.remove(ex.light);
        this.scene.remove(ex.shell);
        ex.shell.geometry.dispose();
        (ex.shell.material as THREE.Material).dispose();
        this.explosions.splice(i, 1);
        continue;
      }
      const s = 0.4 + age * ex.radius;
      ex.shell.scale.set(s, s, s);
      (ex.shell.material as THREE.MeshBasicMaterial).opacity = 0.7 * (1 - age);
      ex.light.intensity = 6 * (1 - age);
    }
  }

  /** 레버 당김 — 손잡이 반대쪽으로 기울임 */
  pullLever(row: number, col: number): void {
    const handle = this.scene.getObjectByName(`lever-${row}-${col}`);
    if (handle) handle.rotation.z = -0.5;
  }

  /** 보간된 플레이어 상태를 카메라에 반영 */
  updateCamera(x: number, y: number, z: number, yaw: number, pitch: number): void {
    this.camera.position.set(x, y + this.eyeHeight, z);
    this.camera.rotation.y = yaw;
    this.camera.rotation.x = pitch;
  }

  setLanternOn(on: boolean): void {
    this.lantern.visible = on;
    this.lanternSpill.visible = on;
  }

  setMuzzleFlash(on: boolean): void {
    this.muzzleLight.visible = on;
  }

  /** 발사 궤적 — 총구(카메라 오른쪽 아래)에서 착탄점까지, tracerTicks 동안 페이드 아웃 */
  spawnTracer(ex: number, ey: number, ez: number): void {
    // 시작점은 판정 원점(눈)이 아니라 화면상 총구 위치 (순수 연출)
    const muzzle = new THREE.Vector3(MUZZLE_OFFSET.x, MUZZLE_OFFSET.y, MUZZLE_OFFSET.z);
    this.camera.localToWorld(muzzle);

    const group = new THREE.Group();
    const end = new THREE.Vector3(ex, ey, ez);

    // 총구 바로 앞은 화면에서 지나치게 크게 보이므로 조금 전진한 지점부터 시작
    const dir = end.clone().sub(muzzle);
    const fullLength = dir.length();
    dir.normalize();
    const start = muzzle.add(dir.clone().multiplyScalar(Math.min(TRACER_START_PUSH, fullLength * 0.5)));
    const length = start.distanceTo(end);

    // 굵기 있는 발광 빔 — 1px 라인은 정면 샷에서 보이지 않는다
    const beam = new THREE.Mesh(
      new THREE.BoxGeometry(TRACER_WIDTH, TRACER_WIDTH, length),
      new THREE.MeshBasicMaterial({
        color: TRACER_COLOR,
        transparent: true,
        opacity: 1,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    beam.position.copy(start).add(end).multiplyScalar(0.5);
    beam.lookAt(end);
    group.add(beam);

    const spark = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 6, 6),
      new THREE.MeshBasicMaterial({
        color: TRACER_COLOR,
        transparent: true,
        opacity: 1,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    spark.position.copy(end);
    group.add(spark);

    this.scene.add(group);
    this.tracers.push({
      group,
      beam,
      spark,
      bornMs: performance.now(),
      lifeMs: (balance.weapons.pistol.tracerTicks / balance.loop.tickRate) * 1000,
    });
  }

  private updateTracers(): void {
    const now = performance.now();
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const tracer = this.tracers[i]!;
      const age = (now - tracer.bornMs) / tracer.lifeMs;
      if (age >= 1) {
        this.scene.remove(tracer.group);
        tracer.beam.geometry.dispose();
        (tracer.beam.material as THREE.Material).dispose();
        tracer.spark.geometry.dispose();
        (tracer.spark.material as THREE.Material).dispose();
        this.tracers.splice(i, 1);
        continue;
      }
      const fade = 1 - age;
      (tracer.beam.material as THREE.MeshBasicMaterial).opacity = 0.9 * fade;
      (tracer.spark.material as THREE.MeshBasicMaterial).opacity = fade;
    }
  }

  /** 타입별 적 외형 조립 — 몸통+머리, 창병은 방패+창 추가 */
  private buildEnemyVisual(type: string): EnemyVisual {
    const def = enemyDef(type);
    const baseColor = ENEMY_COLORS[type] ?? ENEMY_COLOR_FALLBACK;
    const group = new THREE.Group();
    const flashMaterials: THREE.MeshLambertMaterial[] = [];

    // 몸통 서브그룹 — 발(y=0)을 피벗으로 기울여 공격 모션을 만든다
    const torso = new THREE.Group();
    group.add(torso);

    const bodyMat = new THREE.MeshLambertMaterial({ color: baseColor });
    flashMaterials.push(bodyMat);
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(def.radius * 2, def.height * 0.78, def.radius * 2),
      bodyMat,
    );
    body.position.y = (def.height * 0.78) / 2;
    torso.add(body);

    const headMat = new THREE.MeshLambertMaterial({
      color: new THREE.Color(baseColor).multiplyScalar(HEAD_DARKEN),
    });
    flashMaterials.push(headMat);
    const headSize = def.radius * 0.9;
    const head = new THREE.Mesh(new THREE.BoxGeometry(headSize, headSize, headSize), headMat);
    head.position.set(0, def.height - headSize / 2, -def.radius * 0.2);
    torso.add(head);

    // 이름표 + HP 바 (빌보드 스프라이트, 어그로 후에만 표시)
    const plateCanvas = document.createElement('canvas');
    plateCanvas.width = PLATE_W;
    plateCanvas.height = PLATE_H;
    const plateTexture = new THREE.CanvasTexture(plateCanvas);
    const plate = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: plateTexture, transparent: true, depthWrite: false }),
    );
    const plateScale = def.boss ? 2.6 : 1.9;
    plate.scale.set(plateScale, plateScale * (PLATE_H / PLATE_W), 1);
    plate.position.y = def.height + (def.boss ? 0.7 : 0.5);
    plate.visible = false;
    group.add(plate);

    const visual: EnemyVisual = {
      group,
      torso,
      flashMaterials,
      shieldFlashUntil: 0,
      barrierFlashUntil: 0,
      plate,
      plateTexture,
      plateCanvas,
      plateKey: '',
    };

    // 시전 충전 구체 (마법 투사체 캐스터)
    if (def.attack.type === 'projectile' && def.attack.deflectable) {
      visual.chargeOrb = new THREE.Mesh(
        new THREE.SphereGeometry(0.28, 10, 10),
        new THREE.MeshBasicMaterial({
          color: ENEMY_BOLT_COLOR,
          transparent: true,
          opacity: 0.9,
        }),
      );
      visual.chargeOrb.position.set(0.45, def.height * 0.62, -def.radius - 0.35);
      visual.chargeOrb.visible = false;
      torso.add(visual.chargeOrb);
    }

    // 활 (궁수)
    if (type === 'goblin_archer') {
      visual.bow = new THREE.Mesh(
        new THREE.BoxGeometry(0.06, 1.15, 0.08),
        new THREE.MeshLambertMaterial({ color: 0x5c4426 }),
      );
      visual.bow.position.set(0.15, def.height * 0.58, -def.radius - 0.25);
      torso.add(visual.bow);
    }

    if (def.magicBarrier) {
      visual.barrierMaterial = new THREE.MeshLambertMaterial({
        color: BARRIER_COLOR,
        transparent: true,
        opacity: 0.18,
        depthWrite: false,
      });
      visual.barrier = new THREE.Mesh(
        new THREE.SphereGeometry(def.radius + 0.7, 12, 10),
        visual.barrierMaterial,
      );
      visual.barrier.position.y = def.height * 0.55;
      group.add(visual.barrier);
    }

    if (def.boss) {
      visual.armorPlates = new THREE.Mesh(
        new THREE.BoxGeometry(def.radius * 2.4, def.height * 0.9, def.radius * 2.4),
        new THREE.MeshLambertMaterial({ color: ARMOR_COLOR }),
      );
      visual.armorPlates.position.y = def.height * 0.5;
      visual.armorPlates.visible = false;
      torso.add(visual.armorPlates); // 몸통과 함께 기울어진다
    }

    if (def.frontalShieldBlocksProjectiles) {
      visual.shieldMaterial = new THREE.MeshLambertMaterial({ color: SHIELD_COLOR });
      visual.shield = new THREE.Mesh(
        new THREE.BoxGeometry(def.radius * 2.3, def.height * 0.72, 0.09),
        visual.shieldMaterial,
      );
      visual.shield.position.set(-0.15, def.height * 0.5, -(def.radius + 0.12));
      group.add(visual.shield);
    }

    // 근접 무기 — 어깨 피벗 팔에 쥐고 치켜들었다 내리찍는다
    const weaponSpec = MELEE_WEAPONS[type];
    if (weaponSpec) {
      const arm = new THREE.Group();
      arm.position.set(def.radius * 0.85, def.height * 0.72, 0);
      const shaft = new THREE.Mesh(
        new THREE.BoxGeometry(weaponSpec.width, weaponSpec.width, weaponSpec.length),
        new THREE.MeshLambertMaterial({ color: weaponSpec.color }),
      );
      shaft.position.z = -weaponSpec.length / 2;
      arm.add(shaft);
      if (weaponSpec.tip) {
        const tipMat = new THREE.MeshLambertMaterial({ color: SPEAR_TIP });
        flashMaterials.push(tipMat);
        const tip = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.26), tipMat);
        tip.position.z = -weaponSpec.length - 0.1;
        arm.add(tip);
      }
      if (weaponSpec.headSize) {
        const clubHead = new THREE.Mesh(
          new THREE.BoxGeometry(weaponSpec.headSize, weaponSpec.headSize, weaponSpec.headSize),
          new THREE.MeshLambertMaterial({ color: 0x7a7d84 }),
        );
        clubHead.position.z = -weaponSpec.length + 0.15;
        arm.add(clubHead);
      }
      arm.rotation.x = weaponSpec.style === 'thrust' ? THRUST_LEVEL : ARM_REST;
      visual.arm = arm;
      torso.add(arm);
    }

    return visual;
  }

  /** 적 시각 생성/제거/이동을 world.enemies와 동기화 */
  syncEnemies(enemies: EnemyState[], alpha: number): void {
    const now = performance.now();
    const seen = new Set<number>();
    for (const enemy of enemies) {
      if (!enemy.alive) continue;
      seen.add(enemy.id);

      let visual = this.enemyVisuals.get(enemy.id);
      if (!visual) {
        visual = this.buildEnemyVisual(enemy.type);
        this.enemyVisuals.set(enemy.id, visual);
        this.scene.add(visual.group);
      }

      visual.group.position.set(
        enemy.prevX + (enemy.x - enemy.prevX) * alpha,
        0,
        enemy.prevZ + (enemy.z - enemy.prevZ) * alpha,
      );
      visual.group.rotation.y = enemy.yaw;

      // 텔레그래프 — 섬광은 windup 종료 visualLeadTicks 전부터 판정 창 내내.
      // 색은 공격 유형 규약: 청=패링 가능, 적=회피 전용, 보라=마법 투사체.
      // 그 전 windup은 옅은 예고 틴트. 스태거는 처형 가능 표시(황색).
      const def2 = enemyDef(enemy.type);
      const attack = currentAttack(def2, enemy);
      const telegraphColor =
        attack.telegraph === 'red'
          ? balance.telegraph.colorUnparryable
          : attack.telegraph === 'purple'
            ? balance.telegraph.colorProjectile
            : balance.telegraph.colorParryable;
      const flashing =
        (enemy.ai === 'windup' && enemy.timer <= balance.telegraph.visualLeadTicks) ||
        enemy.ai === 'active_perfect' ||
        enemy.ai === 'active_normal';
      let emissive = 0x000000;
      if (flashing) emissive = new THREE.Color(telegraphColor).getHex();
      else if (enemy.ai === 'windup') emissive = WINDUP_TINT;
      else if (enemy.ai === 'staggered') emissive = STAGGER_COLOR;
      else if (enemy.burnTicks > 0) emissive = BURN_TINT;
      for (const material of visual.flashMaterials) material.emissive.set(emissive);

      // 이름표 — 어그로 후에만. 체력/장갑이 바뀔 때만 다시 그린다
      visual.plate.visible = enemy.ai !== 'idle';
      if (visual.plate.visible) {
        const armored = enemy.phase === 'armored' && (enemy.armorHealth ?? 0) > 0;
        const key = `${Math.ceil(enemy.health)}|${armored ? Math.ceil(enemy.armorHealth ?? 0) : '-'}`;
        if (key !== visual.plateKey) {
          visual.plateKey = key;
          drawPlate(
            visual.plateCanvas,
            def2.name ?? enemy.type,
            enemy.health / def2.health,
            armored ? (enemy.armorHealth ?? 0) / (def2.armorHealth ?? 1) : null,
          );
          visual.plateTexture.needsUpdate = true;
        }
      }

      // warden 방어막 — 튕김 시 번쩍
      if (visual.barrier && visual.barrierMaterial) {
        const flashOn = now < visual.barrierFlashUntil;
        visual.barrierMaterial.opacity = flashOn ? 0.55 : 0.18;
        visual.barrierMaterial.emissive.set(flashOn ? BARRIER_COLOR : 0x000000);
      }

      // 보스 장갑판 — armored 페이즈에만
      if (visual.armorPlates) {
        visual.armorPlates.visible = enemy.phase === 'armored' && (enemy.armorHealth ?? 0) > 0;
        if (now < visual.barrierFlashUntil) {
          (visual.armorPlates.material as THREE.MeshLambertMaterial).emissive.set(0x444444);
        } else {
          (visual.armorPlates.material as THREE.MeshLambertMaterial).emissive.set(0x000000);
        }
      }

      // 공격 모션 — windup에 무기를 머리 위로 치켜들며 몸을 젖히고,
      // 타격 구간에 격하게 내리찍는다. 섬광 구간(마지막 4틱)에는 부르르 떨림.
      const inWindup = enemy.ai === 'windup';
      const striking =
        enemy.ai === 'active_perfect' || enemy.ai === 'active_normal' || enemy.ai === 'impact';
      const windupProgress = inWindup ? 1 - enemy.timer / attack.windupTicks : 0;
      const isMelee = attack.type !== 'projectile';
      const trembling = inWindup && enemy.timer <= balance.telegraph.visualLeadTicks;

      let leanTarget = striking && isMelee ? 0.4 : inWindup ? -0.28 * windupProgress : 0;
      if (trembling) leanTarget += Math.sin(now / 14) * 0.05;
      const lungeTarget = striking && isMelee ? -0.5 : 0;
      const snap = striking ? 0.55 : 0.3; // 타격은 빠르게, 복귀는 부드럽게
      visual.torso.rotation.x += (leanTarget - visual.torso.rotation.x) * snap;
      visual.torso.position.z += (lungeTarget - visual.torso.position.z) * snap;

      // 무기 팔 — smash: 치켜들었다 내리침 / thrust: 뒤로 당겼다 내지름
      if (visual.arm) {
        const style = MELEE_WEAPONS[enemy.type]?.style ?? 'smash';
        let armRotTarget: number;
        let armZTarget = 0;
        if (style === 'thrust') {
          armRotTarget = THRUST_LEVEL;
          if (isMelee && inWindup) {
            armZTarget = THRUST_PULL * windupProgress; // 뒤로 당김
            armRotTarget = THRUST_LEVEL - 0.08 * windupProgress;
            if (trembling) armZTarget += Math.sin(now / 12) * 0.05;
          } else if (isMelee && striking) {
            armZTarget = THRUST_LUNGE; // 내지름
          }
        } else {
          armRotTarget = ARM_REST;
          if (isMelee && inWindup) {
            armRotTarget = ARM_REST + (ARM_RAISED - ARM_REST) * windupProgress;
            if (trembling) armRotTarget += Math.sin(now / 12) * 0.08;
          } else if (isMelee && striking) {
            armRotTarget = ARM_SMASH;
          }
        }
        const armSnap = striking ? 0.6 : 0.25;
        visual.arm.rotation.x += (armRotTarget - visual.arm.rotation.x) * armSnap;
        visual.arm.position.z += (armZTarget - visual.arm.position.z) * armSnap;
      }

      // 시전 충전 구체 — windup 진행에 따라 커진다
      if (visual.chargeOrb) {
        visual.chargeOrb.visible = inWindup;
        const s = 0.15 + windupProgress * 0.95;
        visual.chargeOrb.scale.set(s, s, s);
      }

      // 활 시위 당기기 — windup에 활이 젖혀진다
      if (visual.bow) {
        const bowTilt = inWindup ? -0.35 * windupProgress : 0;
        visual.bow.rotation.x += (bowTilt - visual.bow.rotation.x) * 0.3;
      }

      // 방패 — 피격 시 흰 번쩍, 스태거 중엔 내려가서 열린다
      if (visual.shield && visual.shieldMaterial) {
        visual.shieldMaterial.emissive.set(now < visual.shieldFlashUntil ? 0xffffff : 0x000000);
        const def = enemyDef(enemy.type);
        const targetY = enemy.ai === 'staggered' ? def.height * 0.18 : def.height * 0.5;
        visual.shield.position.y += (targetY - visual.shield.position.y) * 0.2;
      }
    }

    for (const [id, visual] of this.enemyVisuals) {
      if (seen.has(id)) continue;
      this.scene.remove(visual.group);
      visual.group.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          (obj.material as THREE.Material).dispose();
        }
      });
      visual.plateTexture.dispose();
      visual.plate.material.dispose();
      this.enemyVisuals.delete(id);
    }
  }

  /** 투사체 — 화염구/마법탄은 발광 구+점광원, 화살은 어두운 화살대 (빛 없음) */
  syncProjectiles(projectiles: ProjectileState[], alpha: number): void {
    const seen = new Set<number>();
    for (const proj of projectiles) {
      seen.add(proj.id);
      let group = this.projectileVisuals.get(proj.id);
      if (!group) {
        group = new THREE.Group();
        if (proj.kind === 'grenade') {
          // 수류탄 — 작은 암록색 구
          group.add(
            new THREE.Mesh(
              new THREE.SphereGeometry(proj.radius, 8, 8),
              new THREE.MeshLambertMaterial({ color: 0x3d4a2e, emissive: 0x141a10 }),
            ),
          );
        } else if (proj.kind === 'rock') {
          // 바위 — 크고 어두운 덩어리, 무발광
          group.add(
            new THREE.Mesh(
              new THREE.DodecahedronGeometry(proj.radius),
              new THREE.MeshLambertMaterial({ color: 0x6a5a4a, emissive: 0x191410 }),
            ),
          );
        } else if (proj.kind === 'arrow') {
          // 화살 — 나무 화살대 + 회색 촉. 발광하지 않아 어둠 속에서 위협적
          const shaft = new THREE.Mesh(
            new THREE.BoxGeometry(0.05, 0.05, 0.75),
            new THREE.MeshLambertMaterial({ color: 0x6b5233 }),
          );
          group.add(shaft);
          const head = new THREE.Mesh(
            new THREE.BoxGeometry(0.09, 0.09, 0.14),
            new THREE.MeshLambertMaterial({
              color: 0xb9c0c9,
              emissive: 0x3a3f46,
            }),
          );
          head.position.z = -0.42;
          group.add(head);
        } else {
          // 적 마법탄은 보라(반사 가능 규약), 플레이어 화염구는 주황
          const color = proj.owner === 'enemy' ? ENEMY_BOLT_COLOR : FIREBALL_COLOR;
          group.add(
            new THREE.Mesh(
              new THREE.SphereGeometry(proj.radius, 8, 8),
              new THREE.MeshBasicMaterial({ color }),
            ),
          );
          group.add(new THREE.PointLight(color, 2.2, 9, 0));
        }
        this.projectileVisuals.set(proj.id, group);
        this.scene.add(group);
      }
      const px = proj.prevX + (proj.x - proj.prevX) * alpha;
      const py = proj.prevY + (proj.y - proj.prevY) * alpha;
      const pz = proj.prevZ + (proj.z - proj.prevZ) * alpha;
      group.position.set(px, py, pz);
      if (proj.kind === 'arrow') {
        // 화살대를 비행 방향으로 정렬 (로컬 -Z가 진행 방향)
        group.lookAt(px - proj.vx, py - proj.vy, pz - proj.vz);
      }
    }
    for (const [id, group] of this.projectileVisuals) {
      if (seen.has(id)) continue;
      this.scene.remove(group);
      group.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          (obj.material as THREE.Material).dispose();
        }
      });
      this.projectileVisuals.delete(id);
    }
  }

  /** 적 사망 파편 폭발 — 몸통 색 조각들이 튀어 흩어진다 */
  spawnDeathBurst(x: number, z: number, enemyType: string): void {
    const def = enemyDef(enemyType);
    const color = ENEMY_COLORS[enemyType] ?? ENEMY_COLOR_FALLBACK;
    const now = performance.now();
    for (let i = 0; i < DEATH_PARTICLE_COUNT; i++) {
      const size = 0.08 + Math.random() * 0.12;
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(size, size, size),
        new THREE.MeshLambertMaterial({ color, transparent: true, opacity: 1 }),
      );
      const angle = Math.random() * Math.PI * 2;
      const speed = 1.5 + Math.random() * 3.5;
      const particle: Particle = {
        mesh,
        ox: x,
        oy: def.height * (0.3 + Math.random() * 0.6),
        oz: z,
        vx: Math.cos(angle) * speed,
        vy: 2 + Math.random() * 4,
        vz: Math.sin(angle) * speed,
        bornMs: now,
      };
      mesh.position.set(particle.ox, particle.oy, particle.oz);
      mesh.rotation.set(Math.random() * 3, Math.random() * 3, 0);
      this.particles.push(particle);
      this.scene.add(mesh);
    }
  }

  private updateParticles(): void {
    const now = performance.now();
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]!;
      const age = (now - p.bornMs) / 1000;
      const lifeFrac = (now - p.bornMs) / DEATH_PARTICLE_LIFE_MS;
      if (lifeFrac >= 1) {
        this.scene.remove(p.mesh);
        p.mesh.geometry.dispose();
        (p.mesh.material as THREE.Material).dispose();
        this.particles.splice(i, 1);
        continue;
      }
      p.mesh.position.set(
        p.ox + p.vx * age,
        Math.max(0.04, p.oy + p.vy * age - 0.5 * DEATH_GRAVITY * age * age),
        p.oz + p.vz * age,
      );
      (p.mesh.material as THREE.MeshLambertMaterial).opacity = 1 - lifeFrac * lifeFrac;
    }
  }

  /** 바닥 각인 — 떠서 회전하는 금색 팔면체 + 점광원 */
  syncGroundItems(items: GroundItemState[]): void {
    const now = performance.now();
    const seen = new Set<number>();
    for (const item of items) {
      seen.add(item.id);
      let group = this.groundItemVisuals.get(item.id);
      if (!group) {
        group = new THREE.Group();
        const gem = new THREE.Mesh(
          new THREE.OctahedronGeometry(0.22),
          new THREE.MeshLambertMaterial({
            color: GROUND_ITEM_COLOR,
            emissive: GROUND_ITEM_COLOR,
            emissiveIntensity: 0.55,
          }),
        );
        gem.name = 'gem';
        group.add(gem);
        group.add(new THREE.PointLight(GROUND_ITEM_COLOR, 0.9, 5, 0));
        this.groundItemVisuals.set(item.id, group);
        this.scene.add(group);
      }
      const bob = 0.55 + Math.sin(now / 400 + item.id) * 0.1;
      group.position.set(item.x, bob, item.z);
      const gem = group.getObjectByName('gem');
      if (gem) gem.rotation.y = now / 700;
    }
    for (const [id, group] of this.groundItemVisuals) {
      if (seen.has(id)) continue;
      this.scene.remove(group);
      group.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          (obj.material as THREE.Material).dispose();
        }
      });
      this.groundItemVisuals.delete(id);
    }
  }

  private onResize = (): void => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  };

  render(): void {
    this.updateTracers();
    this.updateParticles();
    this.updateExplosions();
    this.renderer.render(this.scene, this.camera);
  }
}
