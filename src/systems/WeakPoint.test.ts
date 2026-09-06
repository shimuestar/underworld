// 낫뿔 거수 B2-1 — 약점 구체 판정 코어 검증 (기획서 §4).
// 권총·화살은 몸 AABB 보다 약점 구체를 우선한다("구체 승") — 단 정면 원뿔(facing·coneDeg)을 만족할 때만.
// 정면에서 눈 ×3.0 / 후면에서 눈은 몸통 0.8× / 우측면에서 joint_r ○·joint_l × / 관절 내구 132 → 파열 → 판정 닫힘 /
// hitZonesImmune(부위 배율·헤드샷 억제) / 부위 높이 비율의 jumpY 버그 수정. 기존 몸통 사격 테스트는 Weapons.test 그대로.
// B2-2 부터 약점은 조건부 노출이다 — 노출 타이머(enemy.exposure[id])나 자세(exposedStates)로 열려 있을 때만 판정이 있다.
// 여기서는 노출 타이머를 직접 세워(expose) 판정 규칙만 본다. 패링 → 노출·자세 흐름은 Boss.test.

import { beforeEach, describe, expect, it } from 'vitest';
import { balance } from '../core/Balance';
import { Events } from '../core/Events';
import { Input } from '../core/Input';
import { enemyDef, rayHitsWeakPoint, weakPointOffset, weakPointOpen, weakPointWorldPos, type WeakPointDef } from '../core/Entities';
import { World, type EnemyState } from '../core/World';
import { Level } from '../level/GridLoader';
import { spawnEnemyAt } from '../level/Spawner';
import * as Projectiles from './Projectiles';
import * as Sigils from './Sigils';
import * as Weapons from './Weapons';

const DT = 1 / 60;
const pistol = balance.weapons.pistol;
const BOW = balance.weapons.bow;
const TYPE = 'scythe_behemoth';
const def = enemyDef(TYPE);
const EYE_H = balance.player.eyeHeight;

function makeWorld(ranged: 'pistol' | 'bow' = 'pistol'): World {
  const level = new Level({
    id: 'range',
    name: 'range',
    cellSize: 4,
    ceiling: 4,
    // 사격장 — +X 로 긴 복도 (거수 몸이 들어가게 3칸 폭)
    grid: ['#'.repeat(40), '#' + '.'.repeat(38) + '#', '#S' + '.'.repeat(37) + '#', '#' + '.'.repeat(38) + '#', '#'.repeat(40)],
    lighting: { ambient: 0.04, torches: [] },
  });
  return new World(new Events(), {
    input: Input.emptySnapshot(),
    player: {
      x: 6, y: 0, z: 10, prevX: 6, prevY: 0, prevZ: 10,
      yaw: -Math.PI / 2, pitch: 0, health: 100, // +X 를 본다
      stunTicks: 0, dodgeTicks: 0, dodgeDirX: 0, dodgeDirZ: 0,
      iframeTicks: 0, reactionBufferTicks: 0, blocking: false, reactionHeldTicks: 0,
    },
    lantern: { on: true, battery: 100, spares: 0 },
    weapon: {
      melee: 'hammer', ranged, mag: 12, reserve: 60, cooldown: 0, reloading: 0,
      muzzleFlash: 0, grenades: 3, arrows: 10, bowDraw: 0, meleeCooldown: 0,
      grenadeCharge: 0, comboStep: 0, comboTimer: 0, swingImpact: 0, swingHeavy: false,
    },
    mana: { value: 0, chainIndex: 0, outOfCombatTicks: 0, inCombat: false },
    sigils: {
      inventory: [],
      equipped: { eye: null, rightArm: null, leftArm: null, heart: null, spine: null },
    },
    modifiers: Sigils.defaultModifiers(),
    corruption: { applied: 0, pending: 0 },
    enemies: [],
    level,
  });
}

let world: World;
beforeEach(() => {
  world = makeWorld();
});

/** 거수를 (x, z) 에 yaw 로 놓는다. yaw π/2 = 정면(-z 로컬)이 -X → 플레이어(서쪽)를 본다.
 *  약점 다섯을 노출 타이머로 전부 열어 둔다(판정 규칙 검증용 — 실제 노출 조건은 Boss.test) */
function behemothAt(x: number, z: number, yaw: number, exposeAll = true): EnemyState {
  const boss = spawnEnemyAt(TYPE, x, z, 1);
  boss.yaw = yaw;
  if (exposeAll) expose(boss, 'eye', 'joint_r', 'joint_l', 'heart', 'vent');
  world.enemies.push(boss);
  return boss;
}

/** 노출 타이머를 길게 세운다 — Reaction/Enemies 가 여는 것과 같은 필드 */
function expose(enemy: { exposure?: Record<string, number> }, ...ids: string[]): void {
  enemy.exposure ??= {};
  for (const id of ids) enemy.exposure[id] = 10_000;
}

/** 월드 점을 겨눈다 — yaw 는 정면 (-sin yaw, -cos yaw) 규약, pitch 는 눈높이 기준 */
function aimAt(tx: number, ty: number, tz: number): void {
  const p = world.player;
  const dx = tx - p.x;
  const dz = tz - p.z;
  p.yaw = Math.atan2(-dx, -dz);
  p.pitch = Math.atan2(ty - EY(), Math.hypot(dx, dz));
}
function EY(): number {
  return world.player.y + EYE_H;
}

function firePistol(): void {
  world.weapon.cooldown = 0;
  world.input = { ...Input.emptySnapshot(), rangedPressed: true };
  Weapons.tick(world, DT);
  world.input = Input.emptySnapshot();
}

/** 활 — 풀당김으로 쏘고 화살이 사라질 때까지 투사체를 돌린다 */
function fireArrow(): void {
  for (let i = 0; i < BOW.maxDrawTicks; i++) {
    world.input = { ...Input.emptySnapshot(), rangedHeld: true };
    Weapons.tick(world, DT);
  }
  world.input = Input.emptySnapshot();
  Weapons.tick(world, DT);
  expect(world.projectiles.length).toBe(1);
  for (let i = 0; i < 120 && world.projectiles.length > 0; i++) Projectiles.tick(world, DT);
  expect(world.projectiles.length).toBe(0);
}

function collect(name: string): unknown[] {
  const out: unknown[] = [];
  world.events.on(name, (p) => out.push(p));
  return out;
}

/** 약점 정의 */
function wp(id: string): WeakPointDef {
  const found = def.weakPoints!.find((w) => w.id === id);
  if (!found) throw new Error(`약점 없음: ${id}`);
  return found;
}

describe('데이터 — weakPoints·poseOffsets·hitZonesImmune (기획서 §2·§4)', () => {
  it('거수는 약점 5개(눈·관절 둘·심장·분출공), 좌표·반지름·배율·내구·facing 이 표와 같다. 다른 적은 없다', () => {
    expect(def.hitZonesImmune).toBe(true);
    expect(def.weakPoints!.map((w) => w.id)).toEqual(['eye', 'joint_r', 'joint_l', 'heart', 'vent']);
    expect(wp('eye')).toMatchObject({ offset: { x: 0, y: 2.35, z: -1.88 }, radius: 0.26, damageMul: 3.0, facing: { x: 0, y: 0, z: -1 } });
    expect(wp('joint_r')).toMatchObject({ offset: { x: 1.15, y: 2.5, z: -0.8 }, radius: 0.3, damageMul: 2.0, hp: 132, facing: { x: 1, y: 0.4, z: -0.4 } });
    expect(wp('joint_l')).toMatchObject({ offset: { x: -1.15, y: 2.5, z: -0.8 }, radius: 0.3, damageMul: 2.0, hp: 132, facing: { x: -1, y: 0.4, z: -0.4 } });
    expect(wp('heart')).toMatchObject({ offset: { x: 0, y: 0.6, z: -0.4 }, radius: 0.35, damageMul: 3.0 });
    expect(wp('vent')).toMatchObject({ offset: { x: 0, y: 1.65, z: -1.55 }, radius: 0.3, damageMul: 3.0 });
    expect(wp('eye').coneDeg).toBeUndefined(); // 기본 원뿔은 balance.weakPoint.defaultConeDeg
    expect(balance.weakPoint.defaultConeDeg).toBe(100);
    // 자세 표 — 8 자세 × 5 약점, normal 은 정의의 offset 과 같다
    const poses = ['normal', 'charge', 'rear', 'head_down', 'skid', 'stunned', 'roar', 'blind'];
    expect(Object.keys(def.poseOffsets!)).toEqual(poses);
    for (const pose of poses) expect(Object.keys(def.poseOffsets![pose]!)).toEqual(['eye', 'joint_r', 'joint_l', 'heart', 'vent']);
    for (const w of def.weakPoints!) expect(def.poseOffsets!['normal']![w.id]).toEqual(w.offset);
    expect(def.poseOffsets!['charge']!['eye']).toEqual({ x: 0, y: 1.1, z: -1.95 });
    expect(def.poseOffsets!['head_down']!['eye']).toEqual({ x: 0, y: 0.9, z: -1.9 });
    expect(def.poseOffsets!['rear']!['heart']).toEqual({ x: 0, y: 1.15, z: -1.0 });
    // 약점 좌표 = 외형 표의 눈·관절·심장·분출공 자리 (판정 = 그림)
    const v = def.visual!;
    const R = def.radius;
    const H = def.height;
    expect([v.eye.pos[0] * R, v.eye.pos[1] * H, v.eye.pos[2] * R].map((n) => +n.toFixed(3))).toEqual([0, 2.35, -1.88]);
    expect([v.joints.pos[0] * R, v.joints.pos[1] * H, v.joints.pos[2] * R].map((n) => +n.toFixed(3))).toEqual([1.15, 2.5, -0.8]);
    expect(+(v.eye.radius * R).toFixed(3)).toBe(0.26);
    expect(+(v.joints.radius * R).toFixed(3)).toBe(0.3);
    for (const other of ['goblin_chieftain', 'slime_mother', 'goblin_runner', 'bat']) {
      expect(enemyDef(other).weakPoints).toBeUndefined();
      expect(enemyDef(other).hitZonesImmune).toBeUndefined();
    }
  });

  it('Spawner — 내구가 있는 약점(관절 둘)만 weakHp 장부에 오른다. 족장은 장부가 없다', () => {
    const boss = spawnEnemyAt(TYPE, 20, 10, 1);
    expect(boss.weakHp).toEqual({ joint_r: 132, joint_l: 132 });
    expect(spawnEnemyAt('goblin_chieftain', 20, 10, 2).weakHp).toBeUndefined();
  });

  it('weakPointOpen(B2-2) — 갓 태어난 거수는 다섯 약점이 전부 닫혀 있다. 노출 타이머 또는 exposedStates 자세만 연다, 파열은 어느 쪽이든 닫는다', () => {
    const boss = spawnEnemyAt(TYPE, 20, 10, 1);
    for (const w of def.weakPoints!) expect(weakPointOpen(boss, w), w.id).toBe(false);
    // 자세 — 눈은 head_down 에서만, 심장은 rear 에서만, 관절·분출공은 자세로 안 열린다
    boss.pose = 'head_down';
    expect(weakPointOpen(boss, wp('eye'))).toBe(true);
    expect(weakPointOpen(boss, wp('heart'))).toBe(false);
    expect(weakPointOpen(boss, wp('joint_r'))).toBe(false);
    boss.pose = 'rear';
    expect(weakPointOpen(boss, wp('eye'))).toBe(false);
    expect(weakPointOpen(boss, wp('heart'))).toBe(true);
    boss.pose = 'stunned'; // 혼절 — 눈 닫힘
    expect(weakPointOpen(boss, wp('eye'))).toBe(false);
    boss.pose = 'charge'; // 돌격 중 6m 안 노출은 B2-5 — 지금은 닫힘
    expect(weakPointOpen(boss, wp('eye'))).toBe(false);
    boss.pose = undefined;
    // 타이머
    boss.exposure = { joint_l: 1 };
    expect(weakPointOpen(boss, wp('joint_l'))).toBe(true);
    expect(weakPointOpen(boss, wp('joint_r'))).toBe(false);
    boss.exposure = { joint_l: 0 };
    expect(weakPointOpen(boss, wp('joint_l'))).toBe(false);
    // 파열 — 타이머가 있어도 닫힘
    boss.exposure = { joint_l: 50 };
    boss.weakHp!['joint_l'] = 0;
    expect(weakPointOpen(boss, wp('joint_l'))).toBe(false);
  });
});

describe('weakPointWorldPos / weakPointOffset / rayHitsWeakPoint (순수 판정)', () => {
  it('적 yaw 로 돌고 jumpY 만큼 뜬다 — 정면(-z 로컬)이 (-sin yaw, -cos yaw)', () => {
    const w: WeakPointDef = { id: 't', offset: { x: 1, y: 2, z: -3 }, radius: 0.2, damageMul: 1, facing: { x: 0, y: 0, z: -1 } };
    // yaw 0: 로컬 = 월드 방향
    expect(weakPointWorldPos({ x: 10, z: 20, yaw: 0 }, {}, w)).toEqual({ x: 11, y: 2, z: 17 });
    // yaw π/2: 정면이 -X. 로컬 +x → 월드 -z, 로컬 -z → 월드 -x
    const p = weakPointWorldPos({ x: 10, z: 20, yaw: Math.PI / 2, jumpY: 0.5 }, {}, w);
    expect(p.x).toBeCloseTo(10 - 3, 6);
    expect(p.y).toBeCloseTo(2.5, 6);
    expect(p.z).toBeCloseTo(20 - 1, 6);
  });

  it('enemy.pose 가 있으면 poseOffsets 표가 우선, 표에 없는 자세·없는 약점은 정의의 offset', () => {
    const eye = wp('eye');
    expect(weakPointOffset(def, eye, undefined)).toEqual(eye.offset);
    expect(weakPointOffset(def, eye, 'charge')).toEqual({ x: 0, y: 1.1, z: -1.95 });
    expect(weakPointOffset(def, eye, 'no_such_pose')).toEqual(eye.offset);
    expect(weakPointOffset({}, eye, 'charge')).toEqual(eye.offset);
    const at = weakPointWorldPos({ x: 0, z: 0, yaw: 0, pose: 'head_down' }, def, eye);
    expect(at).toEqual({ x: 0, y: 0.9, z: -1.9 });
  });

  it('정면 원뿔 — coneDeg 없으면 기본 100°(반각 50°): 45° 비스듬히는 성립, 55° 는 불성립. coneDeg 재정의면 그 각', () => {
    const wpDef: WeakPointDef = { id: 'e', offset: { x: 0, y: 1, z: -1 }, radius: 0.3, damageMul: 3, facing: { x: 0, y: 0, z: -1 } };
    const enemy = { x: 0, z: 0, yaw: 0, exposure: { e: 100 } };
    const shootAt = (deg: number, d: { weakPoints: WeakPointDef[] }) => {
      const th = (deg * Math.PI) / 180;
      const dx = Math.sin(th);
      const dz = Math.cos(th); // +z 로 나아가며(정면을 마주 보며) 중심을 지난다
      return rayHitsWeakPoint(0 - dx * 5, 1, -1 - dz * 5, dx, 0, dz, enemy, d, 0);
    };
    expect(shootAt(0, { weakPoints: [wpDef] })?.wp.id).toBe('e');
    expect(shootAt(45, { weakPoints: [wpDef] })?.wp.id).toBe('e');
    expect(shootAt(55, { weakPoints: [wpDef] })).toBeNull();
    expect(shootAt(180, { weakPoints: [wpDef] })).toBeNull(); // 등 뒤
    expect(shootAt(55, { weakPoints: [{ ...wpDef, coneDeg: 180 }] })?.wp.id).toBe('e');
    expect(shootAt(45, { weakPoints: [{ ...wpDef, coneDeg: 60 }] })).toBeNull();
    // 진입 t = 중심 거리 5 − 반지름
    expect(shootAt(0, { weakPoints: [wpDef] })!.t).toBeCloseTo(5 - 0.3, 6);
    // pad(투사체 반지름)는 구를 그만큼 키운다 — 정면(+z 로 나아감)에서 중심 위 0.35 를 스치는 레이
    expect(rayHitsWeakPoint(0, 1 + 0.35, -6, 0, 0, 1, enemy, { weakPoints: [wpDef] }, 0)).toBeNull();
    expect(rayHitsWeakPoint(0, 1 + 0.35, -6, 0, 0, 1, enemy, { weakPoints: [wpDef] }, 0.1)?.wp.id).toBe('e');
    // 옆(+x 로 나아감)에서는 구를 지나도 원뿔(정면 반구) 밖 — 성립하지 않는다
    expect(rayHitsWeakPoint(-5, 1, -1, 1, 0, 0, enemy, { weakPoints: [wpDef] }, 0)).toBeNull();
  });

  it('여러 약점 중 가장 가까운 것, 내구 0(파열)·노출 아닌 약점은 판정이 닫힌다, 약점이 없는 적은 null', () => {
    const near: WeakPointDef = { id: 'near', offset: { x: 0, y: 1, z: -2 }, radius: 0.3, damageMul: 2, facing: { x: 0, y: 0, z: -1 } };
    const far: WeakPointDef = { id: 'far', offset: { x: 0, y: 1, z: -1 }, radius: 0.3, damageMul: 3, facing: { x: 0, y: 0, z: -1 } };
    const d = { weakPoints: [far, near] };
    const enemy = { x: 0, z: 0, yaw: 0, exposure: { near: 100, far: 100 } };
    expect(rayHitsWeakPoint(0, 1, -10, 0, 0, 1, enemy, d, 0)?.wp.id).toBe('near');
    expect(rayHitsWeakPoint(0, 1, -10, 0, 0, 1, { ...enemy, weakHp: { near: 0 } }, d, 0)?.wp.id).toBe('far');
    expect(rayHitsWeakPoint(0, 1, -10, 0, 0, 1, { ...enemy, weakHp: { near: 5 } }, d, 0)?.wp.id).toBe('near');
    expect(rayHitsWeakPoint(0, 1, -10, 0, 0, 1, enemy, {}, 0)).toBeNull();
    expect(rayHitsWeakPoint(0, 1, -10, 0, 0, 1, { ...enemy, feigning: true }, d, 0)).toBeNull();
    // 노출 아닌 약점은 없는 것과 같다 — near 만 닫으면 far, 둘 다 닫으면 null
    expect(rayHitsWeakPoint(0, 1, -10, 0, 0, 1, { ...enemy, exposure: { far: 100 } }, d, 0)?.wp.id).toBe('far');
    expect(rayHitsWeakPoint(0, 1, -10, 0, 0, 1, { x: 0, z: 0, yaw: 0 }, d, 0)).toBeNull();
    // 자세 노출 — exposedStates 에 든 자세일 때만
    const eyeLike: WeakPointDef = { ...near, id: 'e', exposedStates: ['head_down'] };
    expect(rayHitsWeakPoint(0, 1, -10, 0, 0, 1, { x: 0, z: 0, yaw: 0, pose: 'head_down' }, { weakPoints: [eyeLike] }, 0)?.wp.id).toBe('e');
    expect(rayHitsWeakPoint(0, 1, -10, 0, 0, 1, { x: 0, z: 0, yaw: 0, pose: 'stunned' }, { weakPoints: [eyeLike] }, 0)).toBeNull();
  });
});

describe('권총 — 약점 우선 판정 (거수, 근거리 감쇠 없음)', () => {
  it('노출 아닌 눈(B2-2) — 정면에서 눈 자리를 쏴도 판정이 없어 몸통 0.8×, 약점 장부 없음. 머리 내림(head_down)이면 그 자리(0.9m)의 눈이 열린다', () => {
    const boss = behemothAt(16, 10, Math.PI / 2, false);
    const eye = weakPointWorldPos(boss, def, wp('eye'));
    const weakHits = collect('weak_point_hit');
    const damaged = collect('enemy_damaged');
    aimAt(eye.x, eye.y, eye.z);
    firePistol();
    expect(weakHits).toHaveLength(0);
    expect(damaged[0]).toMatchObject({ zone: 'body' });
    expect(boss.health).toBeCloseTo(def.health - pistol.damage * pistol.hitZones.bodyMul, 5);
    // 머리 내림 — 눈이 표의 head_down 자리로 내려오고 열린다
    boss.pose = 'head_down';
    const low = weakPointWorldPos(boss, def, wp('eye'));
    expect(low.y).toBeCloseTo(0.9, 6);
    const before = boss.health;
    aimAt(low.x, low.y, low.z);
    firePistol();
    expect(weakHits).toHaveLength(1);
    expect(weakHits[0]).toMatchObject({ id: 'eye', damage: pistol.damage * 3.0 });
    expect(boss.health).toBeCloseTo(before - pistol.damage * 3.0, 5);
    expect(boss.weakAccum).toEqual({ eye: pistol.damage * 3.0 });
    expect(boss.exposureHits).toEqual({ eye: 1 });
  });

  it('정면에서 눈 → ×3.0 = 33, zone weak, weak_point_hit{eye}, 헤드샷 없음', () => {
    const boss = behemothAt(16, 10, Math.PI / 2); // 플레이어를 본다 — 눈이 (14.12, 2.35, 10)
    const eye = weakPointWorldPos(boss, def, wp('eye'));
    expect(eye.x).toBeCloseTo(14.12, 6);
    expect(eye.z).toBeCloseTo(10, 6);
    const weakHits = collect('weak_point_hit');
    const headshots = collect('headshot');
    const damaged = collect('enemy_damaged');
    aimAt(eye.x, eye.y, eye.z);
    firePistol();
    expect(boss.health).toBeCloseTo(def.health - pistol.damage * 3.0, 5);
    expect(weakHits).toHaveLength(1);
    expect(weakHits[0]).toMatchObject({ enemyId: boss.id, enemyType: TYPE, id: 'eye', damage: pistol.damage * 3.0 });
    const hitAt = weakHits[0] as { x: number; y: number; z: number };
    expect(Math.hypot(hitAt.x - eye.x, hitAt.y - eye.y, hitAt.z - eye.z)).toBeCloseTo(wp('eye').radius, 2); // 착탄점은 구 표면
    expect(headshots).toHaveLength(0);
    expect(damaged[0]).toMatchObject({ zone: 'weak', damage: pistol.damage * 3.0 });
    // 눈은 내구가 없다 — 장부 그대로
    expect(boss.weakHp).toEqual({ joint_r: 132, joint_l: 132 });
  });

  it('후면에서 눈을 겨눠도 원뿔에 막혀 몸통 0.8× — 몸을 뚫고 눈을 맞힐 수 없다', () => {
    const boss = behemothAt(16, 10, -Math.PI / 2); // 등을 보인다 — 눈이 (17.88, 2.35, 10), 몸 상자 x 14.15~17.85
    const eye = weakPointWorldPos(boss, def, wp('eye'));
    expect(eye.x).toBeCloseTo(17.88, 6);
    const weakHits = collect('weak_point_hit');
    const damaged = collect('enemy_damaged');
    aimAt(eye.x, eye.y, eye.z);
    firePistol();
    expect(boss.health).toBeCloseTo(def.health - pistol.damage * pistol.hitZones.bodyMul, 5);
    expect(weakHits).toHaveLength(0);
    expect(damaged[0]).toMatchObject({ zone: 'body' });
  });

  it('우측면에서 joint_r ○(×2.0 = 22, 내구 132 → 110) · joint_l ×(몸통 0.8×) — 오른콽에서 왼 관절을 맞힐 수 없다', () => {
    const boss = behemothAt(16, 9.2, Math.PI); // 정면 +Z, 오른 옆구리(+x 로컬)가 플레이어 쪽(-X) — 관절이 (14.85 / 17.15, 2.5, 10)
    const jr = weakPointWorldPos(boss, def, wp('joint_r'));
    const jl = weakPointWorldPos(boss, def, wp('joint_l'));
    expect([jr.x, jr.z].map((n) => +n.toFixed(3))).toEqual([14.85, 10]);
    expect([jl.x, jl.z].map((n) => +n.toFixed(3))).toEqual([17.15, 10]);
    const weakHits = collect('weak_point_hit');
    aimAt(jr.x, jr.y, jr.z);
    firePistol();
    expect(boss.health).toBeCloseTo(def.health - pistol.damage * 2.0, 5);
    expect(weakHits).toHaveLength(1);
    expect(weakHits[0]).toMatchObject({ id: 'joint_r', damage: pistol.damage * 2.0 });
    expect(boss.weakHp!['joint_r']).toBeCloseTo(132 - 22, 5);
    expect(boss.weakHp!['joint_l']).toBe(132);
    // 왼 관절 — 오른 관절 구를 비껴(0.25m 아래) 몸을 뚫고 왼 관절 구에 닿지만 원뿔이 막는다 → 몸통
    const before = boss.health;
    aimAt(jl.x, jl.y - 0.25, jl.z);
    firePistol();
    expect(boss.health).toBeCloseTo(before - pistol.damage * pistol.hitZones.bodyMul, 5);
    expect(weakHits).toHaveLength(1);
    expect(boss.weakHp!['joint_l']).toBe(132);
  });

  it('관절 내구 — 6발(22×6 = 132)에 weak_point_broken 한 번, 그 뒤 같은 자리는 판정이 닫혀 몸통 0.8×', () => {
    const boss = behemothAt(16, 9.2, Math.PI);
    const jr = weakPointWorldPos(boss, def, wp('joint_r'));
    const broken = collect('weak_point_broken');
    const weakHits = collect('weak_point_hit');
    aimAt(jr.x, jr.y, jr.z);
    for (let i = 0; i < 6; i++) firePistol();
    expect(weakHits).toHaveLength(6);
    expect(boss.weakHp!['joint_r']).toBe(0);
    expect(broken).toHaveLength(1);
    expect(broken[0]).toMatchObject({ enemyId: boss.id, enemyType: TYPE, id: 'joint_r' });
    expect(boss.health).toBeCloseTo(def.health - 22 * 6, 5);
    const before = boss.health;
    firePistol(); // 7발째 — 파열한 관절은 닫혔다
    expect(weakHits).toHaveLength(6);
    expect(broken).toHaveLength(1);
    expect(boss.health).toBeCloseTo(before - pistol.damage * pistol.hitZones.bodyMul, 5);
  });

  it('hitZonesImmune — 약점 아닌 머리 높이(≥82%) 명중도 body 0.8×, 헤드샷 이벤트 없음. 족장(면역 없음)은 그대로 ×1.5 헤드샷', () => {
    const boss = behemothAt(16, 10, Math.PI / 2); // 몸 상자 앞면 x 14.15, z 8.75~11.25
    const headshots = collect('headshot');
    const weakHits = collect('weak_point_hit');
    aimAt(14.15, 2.9, 10.8); // 상자 앞면 위쪽(0.967h), 눈(z 10)·관절(z 8.85/11.15) 구는 피한다
    firePistol();
    expect(weakHits).toHaveLength(0);
    expect(headshots).toHaveLength(0);
    expect(boss.health).toBeCloseTo(def.health - pistol.damage * pistol.hitZones.bodyMul, 5);
    // 족장 — 같은 높이 비율이면 머리 ×1.5 + headshot
    world = makeWorld();
    const chief = spawnEnemyAt('goblin_chieftain', 16, 10, 2);
    chief.health = 1000;
    world.enemies.push(chief);
    const chiefHead = collect('headshot');
    aimAt(16 - enemyDef('goblin_chieftain').radius, enemyDef('goblin_chieftain').height * 0.9, 10);
    firePistol();
    expect(chiefHead).toHaveLength(1);
    expect(chief.health).toBeCloseTo(1000 - pistol.damage * pistol.hitZones.headMul, 5);
  });

  it('jumpY 버그 수정 — 공중의 박쥐(2.4m) 발치(높이 20%)를 맞히면 하반신 ×0.6 (예전엔 절대 높이로 재서 무엇을 맞아도 머리였다)', () => {
    const bat = spawnEnemyAt('bat', 12, 10, 3);
    const bdef = enemyDef('bat');
    bat.jumpY = bdef.flying!.cruiseHeight; // 2.4
    world.enemies.push(bat);
    const headshots = collect('headshot');
    const damaged = collect('enemy_damaged');
    aimAt(12 - bdef.radius, bat.jumpY + bdef.height * 0.2, 10);
    firePistol();
    expect(headshots).toHaveLength(0);
    expect(damaged[0]).toMatchObject({ zone: 'limb' });
    expect(bat.health).toBeCloseTo(bdef.health - pistol.damage * pistol.hitZones.limbMul, 5);
  });

  it('구체 승 — 몸 상자에 먼저 들어가고 그 안의 구체(심장, 상자 앞면 뒤 1.45m)에 닿아도 약점이 이긴다 → ×3.0', () => {
    const boss = behemothAt(16, 10, Math.PI / 2); // 상자 앞면 x 14.15, 심장 (15.6, 0.6, 10)
    const heart = weakPointWorldPos(boss, def, wp('heart'));
    expect([heart.x, heart.y, heart.z].map((n) => +n.toFixed(3))).toEqual([15.6, 0.6, 10]);
    const weakHits = collect('weak_point_hit');
    const damaged = collect('enemy_damaged');
    aimAt(heart.x, heart.y, heart.z);
    firePistol();
    expect(weakHits).toHaveLength(1);
    expect(weakHits[0]).toMatchObject({ id: 'heart', damage: pistol.damage * 3.0 });
    expect(damaged[0]).toMatchObject({ zone: 'weak' });
    expect(boss.health).toBeCloseTo(def.health - pistol.damage * 3.0, 5);
    // 분출공도 같은 규칙(가슴 앞, 상자 앞면 뒤 0.3m)
    const vent = weakPointWorldPos(boss, def, wp('vent'));
    aimAt(vent.x, vent.y, vent.z);
    firePistol();
    expect(weakHits).toHaveLength(2);
    expect(weakHits[1]).toMatchObject({ id: 'vent', damage: pistol.damage * 3.0 });
  });
});

describe('화살 — 약점 우선 판정 (Projectiles.moveProjectiles → applyProjectileHit)', () => {
  beforeEach(() => {
    world = makeWorld('bow');
  });

  it('정면에서 눈 → 44 × 3.0 = 132, weak_point_hit{eye}, 화살 헤드샷 없음, 화살은 한 대 떨어진다', () => {
    const boss = behemothAt(16, 10, Math.PI / 2);
    const eye = weakPointWorldPos(boss, def, wp('eye'));
    const weakHits = collect('weak_point_hit');
    const headshots = collect('headshot');
    const pops = collect('damage_pop');
    aimAt(eye.x, eye.y, eye.z);
    fireArrow();
    expect(boss.health).toBeCloseTo(def.health - BOW.damageMax * 3.0, 5);
    expect(weakHits).toHaveLength(1);
    expect(weakHits[0]).toMatchObject({ id: 'eye', damage: BOW.damageMax * 3.0 });
    expect(headshots).toHaveLength(0);
    expect(pops[0]).toMatchObject({ enemyId: boss.id, amount: BOW.damageMax * 3.0 });
    expect(world.groundItems.some((g) => g.kind === 'arrow')).toBe(true);
  });

  it('후면에서 눈을 겨눈 화살은 몸통(배율 없음 44) — 헤드샷도 없다(hitZonesImmune)', () => {
    const boss = behemothAt(16, 10, -Math.PI / 2);
    const eye = weakPointWorldPos(boss, def, wp('eye'));
    const weakHits = collect('weak_point_hit');
    const headshots = collect('headshot');
    aimAt(eye.x, eye.y, eye.z);
    fireArrow();
    expect(boss.health).toBeCloseTo(def.health - BOW.damageMax, 5);
    expect(weakHits).toHaveLength(0);
    expect(headshots).toHaveLength(0);
  });

  it('우측면에서 joint_r 화살 → 88, 내구 132 → 44. 두 대면 파열', () => {
    const boss = behemothAt(16, 9.2, Math.PI);
    const jr = weakPointWorldPos(boss, def, wp('joint_r'));
    const broken = collect('weak_point_broken');
    aimAt(jr.x, jr.y, jr.z);
    fireArrow();
    expect(boss.weakHp!['joint_r']).toBeCloseTo(132 - 88, 5);
    expect(broken).toHaveLength(0);
    world.weapon.cooldown = 0;
    fireArrow();
    expect(boss.weakHp!['joint_r']).toBe(0);
    expect(broken).toHaveLength(1);
    expect(boss.health).toBeCloseTo(def.health - 88 * 2, 5);
  });

  it('족장 화살 헤드샷은 그대로 — jumpY 를 빼고 재도 지상 적은 같은 값', () => {
    const chief = spawnEnemyAt('goblin_chieftain', 16, 10, 2);
    chief.health = 1000;
    world.enemies.push(chief);
    const headshots = collect('headshot');
    const cdef = enemyDef('goblin_chieftain');
    aimAt(16 - cdef.radius, cdef.height * 0.9, 10);
    fireArrow();
    expect(headshots).toHaveLength(1);
    expect(chief.health).toBeCloseTo(1000 - BOW.damageMax, 5);
  });
});
