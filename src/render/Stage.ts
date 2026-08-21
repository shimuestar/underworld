// Three.js 렌더 셋업 전용. 게임 로직 금지.
// World 상태(플레이어, 랜턴, 무기, 적)를 읽어 씬에 반영만 한다.

import * as THREE from 'three';
import { balance } from '../core/Balance';
import { enemyDef } from '../core/Entities';
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
const SPEAR_SHAFT = 0x5c4a33;
const SPEAR_TIP = 0x9aa2ad;
const HEAD_DARKEN = 0.72;

interface EnemyVisual {
  group: THREE.Group;
  /** 텔레그래프 발광을 적용할 머티리얼들 (몸통/머리/창끝) */
  flashMaterials: THREE.MeshLambertMaterial[];
  shield?: THREE.Mesh;
  shieldMaterial?: THREE.MeshLambertMaterial;
  spear?: THREE.Object3D;
  shieldFlashUntil: number;
  /** warden 방어막 셸 */
  barrier?: THREE.Mesh;
  barrierMaterial?: THREE.MeshLambertMaterial;
  barrierFlashUntil: number;
  /** 보스 장갑판 (armored 페이즈에만 표시) */
  armorPlates?: THREE.Mesh;
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

  updateHands(state: { reloading: boolean; stunned: boolean }): void {
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

  /** 왼팔 각인 페널티 — 랜턴 밝기 배율 */
  setLanternIntensityMul(mul: number): void {
    this.lantern.intensity = balance.lantern.intensity * mul;
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
    const door = this.scene.getObjectByName(`door-${row}-${col}`);
    if (door instanceof THREE.Mesh) {
      door.parent?.remove(door);
      door.geometry.dispose();
      (door.material as THREE.Material).dispose();
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

    const bodyMat = new THREE.MeshLambertMaterial({ color: baseColor });
    flashMaterials.push(bodyMat);
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(def.radius * 2, def.height * 0.78, def.radius * 2),
      bodyMat,
    );
    body.position.y = (def.height * 0.78) / 2;
    group.add(body);

    const headMat = new THREE.MeshLambertMaterial({
      color: new THREE.Color(baseColor).multiplyScalar(HEAD_DARKEN),
    });
    flashMaterials.push(headMat);
    const headSize = def.radius * 0.9;
    const head = new THREE.Mesh(new THREE.BoxGeometry(headSize, headSize, headSize), headMat);
    head.position.set(0, def.height - headSize / 2, -def.radius * 0.2);
    group.add(head);

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
      flashMaterials,
      shieldFlashUntil: 0,
      barrierFlashUntil: 0,
      plate,
      plateTexture,
      plateCanvas,
      plateKey: '',
    };

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
      group.add(visual.armorPlates);
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

    if (type === 'goblin_spear') {
      const spear = new THREE.Group();
      const shaft = new THREE.Mesh(
        new THREE.BoxGeometry(0.055, 0.055, 1.7),
        new THREE.MeshLambertMaterial({ color: SPEAR_SHAFT }),
      );
      spear.add(shaft);
      const tipMat = new THREE.MeshLambertMaterial({ color: SPEAR_TIP });
      flashMaterials.push(tipMat);
      const tip = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.075, 0.24), tipMat);
      tip.position.z = -0.95;
      spear.add(tip);
      spear.position.set(def.radius + 0.15, def.height * 0.62, -0.3);
      visual.spear = spear;
      group.add(spear);
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
      const attack =
        enemy.phase === 'armored' && def2.armoredAttack ? def2.armoredAttack : def2.attack;
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

      // 창 찌르기 — windup에 당겼다가 판정 창~impact에 내지른다
      if (visual.spear) {
        let targetZ = -0.3;
        if (enemy.ai === 'windup') targetZ = 0.15;
        else if (enemy.ai.startsWith('active') || enemy.ai === 'impact') targetZ = -1.1;
        visual.spear.position.z += (targetZ - visual.spear.position.z) * 0.35;
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
        if (proj.kind === 'arrow') {
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
    this.renderer.render(this.scene, this.camera);
  }
}
