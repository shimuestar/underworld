// 활 — 당김에 따른 피해·속도, 화살 상한, 벽·적에게서 회수, 부러짐.
// 권총 fall-through 와 재장전 가드도 여기서 못박는다 (둘 다 타입이 안 잡아준다).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { balance } from '../core/Balance';
import { Events } from '../core/Events';
import { Input } from '../core/Input';
import { World, type EnemyState, type ProjectileState } from '../core/World';
import { Level } from '../level/GridLoader';
import { enemyDef } from '../core/Entities';
import { spawnEnemyAt } from '../level/Spawner';
import * as Pickups from './Pickups';
import * as Projectiles from './Projectiles';
import * as Sigils from './Sigils';
import * as Weapons from './Weapons';

const DT = 1 / 60;
const BOW = balance.weapons.bow;

function makeWorld(): World {
  const level = new Level({
    id: 'range',
    name: 'range',
    cellSize: 4,
    // 사격장 — +X 로 긴 복도
    ceiling: 4,
    grid: ['#'.repeat(40), '#S' + '.'.repeat(37) + '#', '#'.repeat(40)],
    lighting: { ambient: 0.04, torches: [] },
  });
  return new World(new Events(), {
    input: Input.emptySnapshot(),
    player: {
      x: 6, y: 0, z: 6, prevX: 6, prevY: 0, prevZ: 6,
      yaw: -Math.PI / 2, pitch: 0, health: 100, // +X 를 본다
      stunTicks: 0, dodgeTicks: 0, dodgeDirX: 0, dodgeDirZ: 0,
      iframeTicks: 0, reactionBufferTicks: 0, blocking: false, reactionHeldTicks: 0,
    },
    lantern: { on: true, battery: 100, spares: 0 },
    weapon: {
      melee: 'hammer', ranged: 'bow', mag: 12, reserve: 60, cooldown: 0, reloading: 0,
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
afterEach(() => {
  vi.restoreAllMocks();
});

/** n 틱 동안 시위를 당긴 뒤 놓는다. 발사된 화살을 반환 (안 나갔으면 null) */
function shoot(world: World, drawTicks: number): ProjectileState | null {
  const before = world.projectiles.length;
  for (let i = 0; i < drawTicks; i++) {
    world.input = { ...Input.emptySnapshot(), rangedHeld: true };
    Weapons.tick(world, DT);
  }
  world.input = Input.emptySnapshot(); // 놓는다
  Weapons.tick(world, DT);
  return world.projectiles.length > before ? world.projectiles[before]! : null;
}

describe('당겨 쏘기', () => {
  it('당긴 만큼 빠르다, 피해는 balance 구간을 따른다 — 최소·최대가 값과 맞는다', () => {
    const weak = shoot(world, BOW.minDrawTicks)!;
    expect(weak).not.toBeNull();
    // 최소 당김이 곧 damageMin 이다 — 당김 비율을 minDrawTicks 부터 세기 때문
    expect(weak.damage).toBeCloseTo(BOW.damageMin, 5);
    const weakSpeed = Math.hypot(weak.vx, weak.vy, weak.vz);

    world = makeWorld();
    const full = shoot(world, BOW.maxDrawTicks)!;
    expect(full.damage).toBeCloseTo(BOW.damageMax, 5);
    expect(Math.hypot(full.vx, full.vy, full.vz)).toBeCloseTo(BOW.speedMax, 4);
    // 지금은 피해가 고정(min==max, 권총의 2배)이라 당김의 보상은 속도다.
    // 피해 경사를 되살리면(min<max) 피해도 함께 늘어야 한다
    expect(full.damage).toBeGreaterThanOrEqual(weak.damage);
    expect(Math.hypot(full.vx, full.vy, full.vz)).toBeGreaterThan(weakSpeed);
  });

  it('당김 구간이 damageMin~damageMax 를 벗어나지 않는다 — 중간값도 구간 안', () => {
    const mid = Math.round((BOW.minDrawTicks + BOW.maxDrawTicks) / 2);
    const arrow = shoot(world, mid)!;
    expect(arrow.damage).toBeGreaterThanOrEqual(BOW.damageMin);
    expect(arrow.damage).toBeLessThanOrEqual(BOW.damageMax);
  });

  it('maxDrawTicks 를 넘겨 당겨도 더 세지지 않는다', () => {
    const full = shoot(world, BOW.maxDrawTicks + 40)!;
    expect(full.damage).toBeCloseTo(BOW.damageMax, 5);
  });

  it('짧게 스쳐 누르면 안 나가고 화살도 안 준다 — 오발 방지', () => {
    const arrow = shoot(world, BOW.minDrawTicks - 1);
    expect(arrow).toBeNull();
    expect(world.weapon.arrows).toBe(10);
    expect(world.weapon.bowDraw).toBe(0);
  });

  it('쏜 화살은 회수 표식과 직선 궤도를 갖는다 (중력 없음)', () => {
    const arrow = shoot(world, BOW.maxDrawTicks)!;
    expect(arrow.kind).toBe('arrow');
    expect(arrow.owner).toBe('player');
    expect(arrow.recoverable).toBe(true);
    const vy0 = arrow.vy;
    for (let i = 0; i < 5; i++) Projectiles.tick(world, DT);
    expect(world.projectiles[0]?.vy ?? vy0).toBeCloseTo(vy0, 5); // 안 떨어진다
  });

  it('화살을 다 쓰면 안 나가고 weapon_empty 를 알린다', () => {
    world.weapon.arrows = 0;
    const empty: unknown[] = [];
    world.events.on('weapon_empty', (p) => empty.push(p));
    world.input = { ...Input.emptySnapshot(), rangedPressed: true, rangedHeld: true };
    Weapons.tick(world, DT);
    expect(world.weapon.bowDraw).toBe(0);
    expect(empty[0]).toMatchObject({ weapon: 'bow' });
  });

  it('쏜 뒤 쿨다운 동안은 당겨지지도 않는다', () => {
    shoot(world, BOW.maxDrawTicks);
    expect(world.weapon.cooldown).toBe(BOW.cooldownTicks);
    world.input = { ...Input.emptySnapshot(), rangedHeld: true };
    Weapons.tick(world, DT);
    expect(world.weapon.bowDraw).toBe(0);
  });
});

describe('권총과 섞이지 않는다', () => {
  it('활을 든 채 쏴도 권총 탄창이 줄지 않는다 — fall-through 방지', () => {
    // 무기 분기에서 활을 안 가르면 아래 권총 코드로 흘러내린다.
    // TypeScript 가 잡아주지 않는 종류의 버그라 여기서 못박는다
    const shots: unknown[] = [];
    world.events.on('shot_fired', (p) => shots.push(p));
    shoot(world, BOW.maxDrawTicks);
    expect(world.weapon.mag).toBe(12);
    expect(shots).toHaveLength(0);
    expect(world.weapon.arrows).toBe(9);
  });

  it('활로 바꾸면 남아 있던 재장전이 권총 탄창을 채우지 않는다', () => {
    world.weapon.ranged = 'pistol';
    world.weapon.mag = 0;
    world.input = { ...Input.emptySnapshot(), reload: true };
    Weapons.tick(world, DT);
    expect(world.weapon.reloading).toBeGreaterThan(0);

    world.weapon.ranged = 'bow'; // 장전 도중 휠로 교체
    world.input = Input.emptySnapshot();
    for (let i = 0; i < balance.weapons.pistol.reloadTicks + 5; i++) Weapons.tick(world, DT);
    expect(world.weapon.mag).toBe(0); // 안 채워졌다
    expect(world.weapon.reserve).toBe(60);
  });
});

describe('회수', () => {
  /** 화살 한 대를 바닥에 놓는다 (벽에 꽂힌 것과 같은 상태) */
  function dropArrowNear(world: World): void {
    world.groundItems.push({ id: 600001, kind: 'arrow', amount: 1, x: 6 + 1, z: 6 });
  }
  /** 흡수될 때까지 돌린다 */
  function absorb(world: World, max = 200): void {
    for (let i = 0; i < max && world.groundItems.length > 0; i++) Pickups.tick(world, DT);
  }

  it('벽에 꽂힌 화살은 못 뽑는다 — 박힌 채 남기만 한다', () => {
    const stuck: { dx: number; dy: number; dz: number }[] = [];
    world.events.on('arrow_stuck', (p) => stuck.push(p as { dx: number; dy: number; dz: number }));
    shoot(world, BOW.maxDrawTicks);
    for (let i = 0; i < 300 && world.projectiles.length > 0; i++) Projectiles.tick(world, DT);

    // 회수는 적을 맞힌 화살에서만 나온다
    expect(world.groundItems.filter((g) => g.kind === 'arrow')).toHaveLength(0);
    // 대신 꽂힌 자세(날아온 방향)를 실어 보낸다 — 정면(+X)으로 쐈다
    expect(stuck).toHaveLength(1);
    expect(stuck[0]!.dx).toBeGreaterThan(0.9);
    expect(Math.hypot(stuck[0]!.dx, stuck[0]!.dy, stuck[0]!.dz)).toBeCloseTo(1, 3);
  });

  it('적 궁수의 화살은 바닥에 남지 않는다 — 회수 대상이 아니다', () => {
    world.projectiles.push({
      id: 100001, owner: 'enemy', kind: 'arrow',
      // 동쪽 벽(x≈156) 가까이서 쏴야 lifeTicks 안에 실제로 꽂힌다
      x: 140, y: 1.2, z: 6, prevX: 140, prevY: 1.2, prevZ: 6,
      vx: 30, vy: 0, vz: 0, lifeTicks: 240, damage: 15,
      burnTicks: 0, burnDamagePerTick: 0, radius: 0.15,
    });
    const stuckEvents: unknown[] = [];
    world.events.on('arrow_stuck', (p) => stuckEvents.push(p));
    for (let i = 0; i < 300 && world.projectiles.length > 0; i++) Projectiles.tick(world, DT);
    expect(world.groundItems.filter((g) => g.kind === 'arrow')).toHaveLength(0);
    expect(stuckEvents).toHaveLength(1); // 대신 렌더 잔존물로는 남는다
  });

  it('주우면 화살이 는다 — 가방을 거치지 않는다', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0); // 반드시 살아남는다
    world.weapon.arrows = 3;
    const got: { arrows: number }[] = [];
    world.events.on('arrow_recovered', (p) => got.push(p as { arrows: number }));

    dropArrowNear(world);
    absorb(world);
    expect(world.weapon.arrows).toBe(4);
    expect(got[0]).toMatchObject({ arrows: 4 });
    expect(world.inventory.some((s) => s !== null)).toBe(false); // 가방은 그대로
  });

  it('일정 확률로 부러진다 — 줍긴 줍되 안 는다', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999); // 반드시 부러진다
    world.weapon.arrows = 3;
    const broken: unknown[] = [];
    world.events.on('arrow_broken', (p) => broken.push(p));

    dropArrowNear(world);
    absorb(world);
    expect(world.groundItems).toHaveLength(0); // 바닥에서는 사라진다
    expect(world.weapon.arrows).toBe(3); // 안 늘었다
    expect(broken).toHaveLength(1);
  });

  it('상한이 차면 자석이 안 문다 — 권총탄과 같은 규약', () => {
    world.weapon.arrows = BOW.ammoMax;
    dropArrowNear(world);
    for (let i = 0; i < 60; i++) Pickups.tick(world, DT);
    expect(world.groundItems).toHaveLength(1);
    expect(world.groundItems[0]!.magnet).toBeUndefined();
    expect(world.weapon.arrows).toBe(BOW.ammoMax);
  });

  it('상한을 넘겨 담기지 않는다', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    world.weapon.arrows = BOW.ammoMax - 1;
    dropArrowNear(world);
    absorb(world);
    expect(world.weapon.arrows).toBe(BOW.ammoMax);
  });
});

describe('적을 맞혔을 때', () => {
  function runnerAt(x: number): EnemyState {
    const enemy = spawnEnemyAt('goblin_runner', x, 6, 1);
    enemy.health = 1000;
    enemy.yaw = Math.atan2(-(6 - enemy.x), -(6 - enemy.z));
    world.enemies.push(enemy);
    return enemy;
  }

  it('맞은 자리에 화살이 떨어지고 피해가 들어간다', () => {
    const enemy = runnerAt(14);
    const arrow = shoot(world, BOW.maxDrawTicks)!;
    void arrow;
    for (let i = 0; i < 300 && world.projectiles.length > 0; i++) Projectiles.tick(world, DT);
    expect(enemy.health).toBeLessThan(1000);
    const dropped = world.groundItems.filter((g) => g.kind === 'arrow');
    expect(dropped).toHaveLength(1);
    // 처치 드랍(골드·물약)이 같은 점에 쏟아지므로 화살은 조금 흩어 놓는다
    const away = Math.hypot(dropped[0]!.x - enemy.x, dropped[0]!.z - enemy.z);
    expect(away).toBeCloseTo(balance.pickups.arrow.scatterRadius, 5);
    // 코앞에서 쏴도 뽑기 전에 빨려 들어가지 않게 유예가 걸린다
    expect(dropped[0]!.noMagnetTicks).toBe(balance.pickups.arrow.noMagnetTicks);
  });

  it('한 마리가 내주는 화살은 한 대까지 — 몇 대를 박아 죽였든', () => {
    // 안 막으면 체력 높은 적이 화살 무한 순환 장치가 된다
    const enemy = runnerAt(14);
    enemy.health = 1000; // 여러 대를 견딘다
    for (let n = 0; n < 4; n++) {
      world.weapon.cooldown = 0;
      shoot(world, BOW.maxDrawTicks);
      for (let i = 0; i < 300 && world.projectiles.length > 0; i++) Projectiles.tick(world, DT);
    }
    expect(enemy.health).toBeLessThan(1000 - BOW.damageMax * 3); // 네 대 다 맞았다
    expect(world.groundItems.filter((g) => g.kind === 'arrow')).toHaveLength(1);
    expect(enemy.arrowDropped).toBe(true);
  });

  it('죽이는 마지막 한 방까지 쏴도 한 대뿐이다', () => {
    const enemy = runnerAt(14);
    enemy.health = BOW.damageMax * 2.5; // 세 대째에 죽는다
    for (let n = 0; n < 3; n++) {
      world.weapon.cooldown = 0;
      shoot(world, BOW.maxDrawTicks);
      for (let i = 0; i < 300 && world.projectiles.length > 0; i++) Projectiles.tick(world, DT);
    }
    expect(enemy.alive).toBe(false);
    expect(world.groundItems.filter((g) => g.kind === 'arrow')).toHaveLength(1);
  });

  it('방패에 막힌 화살은 판에 꽂힌 채 남는다 — 바닥으로 안 떨어진다', () => {
    const spear = spawnEnemyAt('goblin_spear', 6 + 8, 6, 1);
    spear.health = 1000;
    spear.ai = 'chase'; // 방패를 든 상태 (찌르는 중이면 내려간다)
    spear.yaw = Math.atan2(-(6 - spear.x), -(6 - spear.z));
    world.enemies.push(spear);
    const shielded: { enemyId: number }[] = [];
    const blocked: { kind: string }[] = [];
    world.events.on('arrow_shielded', (p) => shielded.push(p as { enemyId: number }));
    world.events.on('barrier_blocked', (p) => blocked.push(p as { kind: string }));

    shoot(world, BOW.maxDrawTicks);
    for (let i = 0; i < 300 && world.projectiles.length > 0; i++) Projectiles.tick(world, DT);

    expect(spear.health).toBe(1000); // 막혔다
    expect(shielded[0]).toMatchObject({ enemyId: spear.id });
    expect(blocked[0]).toMatchObject({ kind: 'shield' });
    expect(world.groundItems.filter((g) => g.kind === 'arrow')).toHaveLength(0);
    expect(spear.arrowDropped).toBeFalsy(); // 몸에 안 맞았으니 회수분도 안 썼다
  });

  it('창을 내지르는 중에는 방패가 내려가 화살이 들어간다', () => {
    const spear = spawnEnemyAt('goblin_spear', 6 + 8, 6, 1);
    spear.health = 1000;
    spear.ai = 'active_normal'; // 방패를 내린 구간
    spear.yaw = Math.atan2(-(6 - spear.x), -(6 - spear.z));
    world.enemies.push(spear);
    const shielded: unknown[] = [];
    world.events.on('arrow_shielded', (p) => shielded.push(p));

    shoot(world, BOW.maxDrawTicks);
    for (let i = 0; i < 300 && world.projectiles.length > 0; i++) Projectiles.tick(world, DT);

    expect(spear.health).toBeLessThan(1000);
    expect(shielded).toHaveLength(0);
    expect(world.groundItems.filter((g) => g.kind === 'arrow')).toHaveLength(1);
  });

  it('활 처치는 무기 처치다 — 마법 처치로 새지 않고 마나도 안 준다', () => {
    const enemy = runnerAt(14);
    enemy.health = 1;
    const weaponKills: { weapon: string }[] = [];
    const spellKills: unknown[] = [];
    world.events.on('weapon_kill', (p) => weaponKills.push(p as { weapon: string }));
    world.events.on('spell_kill', (p) => spellKills.push(p));

    shoot(world, BOW.maxDrawTicks);
    for (let i = 0; i < 300 && world.projectiles.length > 0; i++) Projectiles.tick(world, DT);

    expect(enemy.alive).toBe(false);
    expect(weaponKills[0]).toMatchObject({ weapon: 'bow' });
    expect(spellKills).toHaveLength(0);
    expect(world.mana.value).toBe(0); // 설계 의도 #1
  });
});

describe('시위를 끊는 상황들', () => {
  // 조기 return 이 bowDraw 를 안 지우면 시위가 영영 당겨진 채 남는다.
  // 실제로 처음 구현에서 세 곳이 빠져 방패를 들면 소프트락이 됐다
  function drawTo(world: World, n: number): void {
    for (let i = 0; i < n; i++) {
      world.input = { ...Input.emptySnapshot(), rangedHeld: true };
      Weapons.tick(world, DT);
    }
    expect(world.weapon.bowDraw).toBe(n);
  }
  const step = (world: World, input: Partial<ReturnType<typeof Input.emptySnapshot>> = {}) => {
    world.input = { ...Input.emptySnapshot(), ...input };
    Weapons.tick(world, DT);
  };

  it('R 로 시위를 내린다 — 화살은 그대로 남는다', () => {
    // 8틱만 넘겨 당기면 손을 떼는 순간 나가 버려 "쏘지 않고 물러난다"가 안 됐다
    drawTo(world, 20);
    const before = world.weapon.arrows;
    const shots = world.projectiles.length;
    step(world, { reload: true, rangedHeld: true });
    expect(world.weapon.bowDraw).toBe(0);
    expect(world.weapon.arrows).toBe(before); // 안 썼다
    expect(world.projectiles).toHaveLength(shots); // 안 나갔다

    // 좌클릭을 쥔 채로 두어도 다시 당겨지지 않는다 —
    // 안 그러면 다음 틱에 재시작해 손을 뗄 때 그대로 발사된다
    for (let i = 0; i < 30; i++) step(world, { rangedHeld: true });
    expect(world.weapon.bowDraw).toBe(0);

    // 손을 떼도 그때 발사되지 않는다 (취소가 진짜 취소여야 한다)
    step(world);
    expect(world.projectiles).toHaveLength(shots);
    expect(world.weapon.arrows).toBe(before);
  });

  it('취소 뒤 다시 눌러 당기면 정상 발사된다 — 무기를 잠그는 게 아니다', () => {
    drawTo(world, 20);
    step(world, { reload: true, rangedHeld: true });
    step(world); // 손을 뗀다 (잠금 해제)
    for (let i = 0; i < BOW.maxDrawTicks; i++) step(world, { rangedHeld: true });
    expect(world.weapon.bowDraw).toBe(BOW.maxDrawTicks);
    step(world);
    expect(world.projectiles).toHaveLength(1);
  });

  it('R 은 활을 들었을 때만 취소다 — 권총 재장전을 막지 않는다', () => {
    world.weapon.ranged = 'pistol';
    world.weapon.mag = 0;
    step(world, { reload: true });
    expect(world.weapon.reloading).toBeGreaterThan(0);
  });

  it('방패를 들면 끊긴다 — 안 끊으면 영영 당겨진 채로 남는다', () => {
    drawTo(world, 20);
    world.player.blocking = true;
    step(world, { rangedHeld: true });
    expect(world.weapon.bowDraw).toBe(0);
  });

  it('경직되면 끊긴다', () => {
    drawTo(world, 20);
    world.player.stunTicks = 10;
    step(world, { rangedHeld: true });
    expect(world.weapon.bowDraw).toBe(0);
  });

  it('회피하면 끊긴다', () => {
    drawTo(world, 20);
    world.player.dodgeTicks = 6;
    step(world, { rangedHeld: true });
    expect(world.weapon.bowDraw).toBe(0);
  });

  it('해머를 섞으면 끊긴다', () => {
    drawTo(world, 20);
    step(world, { meleePressed: true });
    expect(world.weapon.bowDraw).toBe(0);
  });

  it('무기를 바꾸면 끊기고, 돌아와도 저절로 안 나간다', () => {
    drawTo(world, 20);
    step(world, { cycleRanged: 1 });
    expect(world.weapon.bowDraw).toBe(0);
    world.weapon.ranged = 'bow';
    const before = world.projectiles.length;
    step(world); // 손을 뗀 틱
    expect(world.projectiles).toHaveLength(before);
  });
});

describe('통·소음·인지', () => {
  it('화살은 통을 한 방에 터뜨린다 — 총알(3발)과 다른 규약', () => {
    expect(BOW.ignitesBarrel).toBe(true); // false 면 총알과 같은 누적으로 돌아간다
    const barrel = { id: 1, x: 6 + 6, z: 6, alive: true, hits: 0, fuseTicks: -1 };
    world.barrels.push(barrel);
    // 통은 1.3m 라 눈높이(1.6)에서 수평으로 쏘면 위로 지나간다 — 총알과 같은 성질
    world.player.pitch = -0.1;
    shoot(world, BOW.maxDrawTicks);
    for (let i = 0; i < 60 && world.projectiles.length > 0; i++) Projectiles.tick(world, DT);
    expect(barrel.fuseTicks).toBe(0); // 즉발
  });

  it('통에 박힌 화살은 회수 대상이 아니다 — 곧 폭발에 휩쓸린다', () => {
    const barrel = { id: 1, x: 6 + 6, z: 6, alive: true, hits: 0, fuseTicks: -1 };
    world.barrels.push(barrel);
    world.player.pitch = -0.1;
    shoot(world, BOW.maxDrawTicks);
    for (let i = 0; i < 60 && world.projectiles.length > 0; i++) Projectiles.tick(world, DT);
    expect(world.groundItems.filter((g) => g.kind === 'arrow')).toHaveLength(0);
  });

  it('맞은 적은 깬다 — 조용한 건 소리지 명중이 아니다', () => {
    const enemy = spawnEnemyAt('goblin_runner', 6 + 8, 6, 1);
    enemy.health = 1000;
    enemy.ai = 'idle';
    world.enemies.push(enemy);
    shoot(world, BOW.maxDrawTicks);
    for (let i = 0; i < 120 && world.projectiles.length > 0; i++) Projectiles.tick(world, DT);
    expect(enemy.health).toBeLessThan(1000);
    expect(enemy.ai).toBe('chase');
  });

  it('착탄이 마법음이 아니라 화살 소리를 낸다 (적 화살도 포함)', () => {
    const arrowHits: unknown[] = [];
    const spellHits: unknown[] = [];
    world.events.on('arrow_impact', (p) => arrowHits.push(p));
    world.events.on('spell_impact', (p) => spellHits.push(p));

    shoot(world, BOW.maxDrawTicks);
    for (let i = 0; i < 300 && world.projectiles.length > 0; i++) Projectiles.tick(world, DT);
    expect(arrowHits).toHaveLength(1);
    expect(spellHits).toHaveLength(0);
  });

  it('화살통이 가득이면 가방 안내가 아니라 화살통 안내가 뜬다', () => {
    world.weapon.arrows = BOW.ammoMax;
    const quiver: unknown[] = [];
    const bag: unknown[] = [];
    world.events.on('quiver_full', (p) => quiver.push(p));
    world.events.on('inventory_full', (p) => bag.push(p));
    world.groundItems.push({ id: 600009, kind: 'arrow', amount: 1, x: 6 + 1, z: 6 });
    Pickups.tick(world, DT);
    expect(quiver).toHaveLength(1);
    expect(bag).toHaveLength(0);
  });
});

describe('화살통 드랍', () => {
  const ARCHER = enemyDef('goblin_archer').arrowDrop!;

  it('궁수는 최소 한 대를 확정으로 떨군다', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999); // extraChance 실패
    Pickups.rollDrops(world, 'goblin_archer', 20, 6);
    expect(world.groundItems.filter((g) => g.kind === 'arrow')).toHaveLength(ARCHER.min);
    expect(ARCHER.min).toBe(1);
  });

  it('드물게 한 대 더 — 최대치를 넘지 않는다', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0); // extraChance 항상 성공
    Pickups.rollDrops(world, 'goblin_archer', 20, 6);
    const arrows = world.groundItems.filter((g) => g.kind === 'arrow');
    expect(arrows).toHaveLength(ARCHER.max);
    expect(ARCHER.max).toBe(2);
  });

  it('한 점에 겹쳐 쌓이지 않는다 — 흩뿌린다', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    Pickups.rollDrops(world, 'goblin_archer', 20, 6);
    for (const a of world.groundItems.filter((g) => g.kind === 'arrow')) {
      expect(Math.hypot(a.x - 20, a.z - 6)).toBeCloseTo(balance.pickups.arrow.scatterRadius, 5);
    }
  });

  it('활을 안 든 적은 화살을 안 떨군다', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    for (const type of ['goblin_runner', 'goblin_spear', 'spider_small', 'warden']) {
      expect(enemyDef(type).arrowDrop).toBeUndefined();
      Pickups.rollDrops(world, type, 20, 6);
    }
    expect(world.groundItems.filter((g) => g.kind === 'arrow')).toHaveLength(0);
  });

  it('떨군 화살은 그대로 주울 수 있다 — 회수 규칙을 그대로 탄다', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0); // 두 대 + 회수도 성공
    world.weapon.arrows = 0;
    world.player.x = 20;
    world.player.z = 6;
    Pickups.rollDrops(world, 'goblin_archer', 20 + 1, 6);
    for (let i = 0; i < 200 && world.groundItems.length > 0; i++) Pickups.tick(world, DT);
    expect(world.weapon.arrows).toBe(ARCHER.max);
  });
});

describe('데이터', () => {
  it('활이 원거리 교체 순환에 들어 있다', () => {
    expect(balance.weapons.bow.ammoMax).toBeGreaterThan(0);
    expect(BOW.damageMin).toBeLessThanOrEqual(BOW.damageMax); // 고정 피해(min==max) 허용
    expect(BOW.damageMin).toBe(44); // 2026-08-25: 총알을 절반(11)으로 줄이며 '화살 = 총알 2배' 연결은 풀었다 — 화살은 44 그대로
    expect(BOW.speedMin).toBeLessThan(BOW.speedMax);
    expect(BOW.minDrawTicks).toBeLessThan(BOW.maxDrawTicks);
    expect(BOW.recoverChance).toBeGreaterThan(0);
    expect(BOW.recoverChance).toBeLessThan(1); // 1.0 이면 무한 순환
  });

  it('활은 권총보다 조용하다 — 그게 활의 값이다', () => {
    expect(BOW.noiseRadius).toBeLessThan(balance.weapons.pistol.noiseRadius);
  });
});
