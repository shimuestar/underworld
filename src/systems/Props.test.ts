// 기믹(파괴물) — 롤 가중치, 판정(해머·총·석관 2방), 파괴 소음(문 차음), 매복, 심지 폭발, 전리품 픽업.

import { beforeEach, describe, expect, it } from 'vitest';
import { balance } from '../core/Balance';
import { Events } from '../core/Events';
import { Input } from '../core/Input';
import { breakProp, damageProp, World, type PropState } from '../core/World';
import { Level } from '../level/GridLoader';
import * as Barrels from './Barrels';
import * as Pickups from './Pickups';
import * as Props from './Props';
import * as Sigils from './Sigils';
import * as Stamina from './Stamina';
import * as Weapons from './Weapons';

const DT = 1 / 60;
const TYPES = balance.props.types;

function makeLevel(): Level {
  return new Level({
    id: 'proprange',
    name: 'proprange',
    cellSize: 4,
    ceiling: 4,
    grid: ['#'.repeat(30), '#S' + '.'.repeat(27) + '#', '#'.repeat(30)],
    lighting: { ambient: 0.04, torches: [] },
  });
}

function makeWorld(): World {
  const level = makeLevel();
  const world = new World(new Events(), {
    input: Input.emptySnapshot(),
    player: {
      x: 6, y: 0, z: 6, prevX: 6, prevY: 0, prevZ: 6,
      yaw: -Math.PI / 2, pitch: 0, health: balance.player.healthMax, // +X 를 본다
      stunTicks: 0, dodgeTicks: 0, dodgeDirX: 0, dodgeDirZ: 0,
      iframeTicks: 0, reactionBufferTicks: 0, blocking: false, reactionHeldTicks: 0,
    },
    lantern: { on: true, battery: 100, spares: 0 },
    weapon: { melee: 'hammer', ranged: 'pistol', mag: 12, reserve: 60, cooldown: 0, reloading: 0, muzzleFlash: 0, grenades: 3, meleeCooldown: 0, grenadeCharge: 0, comboStep: 0, comboTimer: 0, swingImpact: 0, swingHeavy: false },
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
  Stamina.init(world);
  return world;
}

let nextId = 1;
function putProp(world: World, type: string, x: number, z: number): PropState {
  const prop: PropState = { id: nextId++, type, x, z, alive: true, hits: 0, fuseTicks: -1 };
  world.props.push(prop);
  return prop;
}

describe('기믹 — 파괴 롤과 판정', () => {
  let world: World;
  beforeEach(() => {
    world = makeWorld();
  });

  it('rollOutcome — 주입한 난수에 따라 가중치 구간이 정확히 갈린다', () => {
    const cfg = TYPES.prop_jar; // empty 52 / loot 33 / ambush 10 / explode 5 (합 100)
    const total = cfg.empty + cfg.loot + cfg.ambush + cfg.explode;
    expect(Props.rollOutcome(cfg, () => 0)).toBe('empty');
    expect(Props.rollOutcome(cfg, () => (cfg.empty + 1) / total)).toBe('loot');
    expect(Props.rollOutcome(cfg, () => (cfg.empty + cfg.loot + 1) / total)).toBe('ambush');
    expect(Props.rollOutcome(cfg, () => (cfg.empty + cfg.loot + cfg.ambush + 1) / total)).toBe('explode');
    // 석관은 폭발 없음(돌) — 가중치 0 이 데이터로 보장된다
    expect(TYPES.prop_sarcophagus.explode).toBe(0);
  });

  it('타격량 — 일반 기믹은 총알 2발·해머 1방, 석관은 해머 2방', () => {
    const jar = putProp(world, 'prop_jar', 10, 6);
    damageProp(world, jar, TYPES.prop_jar.hp, 1); // 총알 1점
    expect(jar.alive).toBe(true); // 첫 발엔 금만 간다
    damageProp(world, jar, TYPES.prop_jar.hp, 1);
    expect(jar.alive).toBe(false); // 총알 2발
    const jar2 = putProp(world, 'prop_jar', 12, 6);
    damageProp(world, jar2, TYPES.prop_jar.hp, 2); // 해머 한 방 몫
    expect(jar2.alive).toBe(false);
    const sar = putProp(world, 'prop_sarcophagus', 14, 6);
    const evs: string[] = [];
    world.events.on('prop_hit', () => evs.push('hit'));
    world.events.on('prop_broken', () => evs.push('broken'));
    damageProp(world, sar, TYPES.prop_sarcophagus.hp, 2);
    expect(sar.alive).toBe(true);
    damageProp(world, sar, TYPES.prop_sarcophagus.hp, 2);
    expect(sar.alive).toBe(false);
    expect(evs).toEqual(['hit', 'broken']);
  });

  it('해머 부채꼴이 항아리를 부순다 — 헛스윙 아님', () => {
    Props.init(world);
    const prop = putProp(world, 'prop_jar', 7.4, 6); // 정면 1.4m
    world.input = { ...Input.emptySnapshot(), meleePressed: true };
    Weapons.tick(world, DT);
    for (let i = 0; i < 30; i++) {
      world.input = Input.emptySnapshot();
      Weapons.tick(world, DT);
    }
    expect(prop.alive).toBe(false);
  });

  it('파괴음은 크다 — 반경 안 대기 적이 깬다, 닫힌 문 너머는 못 듣는다', () => {
    Props.init(world);
    // 롤을 빈손으로 고정 — Math.random 을 잠깐 0 으로 (empty 가 첫 구간)
    const orig = Math.random;
    Math.random = () => 0;
    const near = putProp(world, 'prop_jar', 10, 6);
    const enemy = {
      id: 7001, type: 'spider_large', x: 16, z: 6, prevX: 16, prevZ: 6,
      yaw: 0, homeYaw: 0, health: 75, alive: true, ai: 'idle',
      timer: 0, noticeTicks: 0, burnTicks: 0, burnDamagePerTick: 0,
    } as import('../core/World').EnemyState;
    world.enemies.push(enemy);
    breakProp(world, near); // 10m 소음 — 6m 거리라 들린다
    Math.random = orig;
    expect(enemy.ai).toBe('chase');
  });

  it('매복 롤 — 항아리에서 새끼 거미가 튀어나와 곧장 성나 있다', () => {
    Props.init(world);
    const prop = putProp(world, 'prop_jar', 12, 6);
    const cfg = TYPES.prop_jar;
    const total = cfg.empty + cfg.loot + cfg.ambush + cfg.explode;
    const orig = Math.random;
    Math.random = () => (cfg.empty + cfg.loot + 1) / total; // ambush 구간 고정
    breakProp(world, prop);
    Math.random = orig;
    const spawned = world.enemies.filter((e) => e.type === 'spider_small');
    expect(spawned.length).toBeGreaterThanOrEqual(cfg.ambushMin);
    expect(spawned.length).toBeLessThanOrEqual(cfg.ambushMax);
    for (const s of spawned) expect(s.ai).toBe('chase');
  });

  it('폭발 롤 — 심지가 붙고 fuseTicks 뒤 터져 곁의 폭발통을 점화한다', () => {
    Props.init(world);
    const prop = putProp(world, 'prop_crate', 12, 6);
    const barrel = { id: 900, x: 14, z: 6, alive: true, hits: 0, fuseTicks: -1 };
    world.barrels.push(barrel);
    const cfg = TYPES.prop_crate;
    const total = cfg.empty + cfg.loot + cfg.ambush + cfg.explode;
    const orig = Math.random;
    Math.random = () => (total - 1) / total; // explode 구간 고정
    breakProp(world, prop);
    Math.random = orig;
    expect(prop.fuseTicks).toBe(balance.props.fuseTicks); // 치익
    for (let i = 0; i < balance.props.fuseTicks + 2; i++) Props.tick(world, DT);
    expect(prop.fuseTicks).toBe(-1); // 터졌다
    expect(barrel.fuseTicks).toBe(0); // 곁의 통이 즉발로 걸렸다 (2m — 반경 5 안)
    Barrels.tick(world, DT);
    expect(barrel.alive).toBe(false);
  });

  it('몬스터 드랍도 같은 규칙 — 플레이어 반대쪽 + 착지 유예', () => {
    const orig = Math.random;
    Math.random = () => 0; // 물약 드랍 확정 + 호의 한쪽 끝
    Pickups.rollDrops(world, 'goblin_runner', 10, 6); // 플레이어(6,6)에서 +X 쪽 4m
    Math.random = orig;
    const drop = world.groundItems.find((g) => g.kind === 'potion');
    expect(drop).toBeTruthy();
    expect(drop!.x).toBeGreaterThan(10); // 반대쪽(+X)으로 밀려 떨어졌다
    expect(drop!.noMagnetTicks).toBe(balance.pickups.landNoMagnetTicks);
  });

  it('noExplode(작은방 배치) — 폭발 롤이 나와도 심지가 붙지 않는다', () => {
    Props.init(world);
    const prop = putProp(world, 'prop_crate', 12, 6);
    prop.noExplode = true;
    const cfg = TYPES.prop_crate;
    const total = cfg.empty + cfg.loot + cfg.ambush + cfg.explode;
    const orig = Math.random;
    Math.random = () => (total - 1) / total; // explode 구간 고정
    breakProp(world, prop);
    Math.random = orig;
    expect(prop.fuseTicks).toBe(-1); // 빈손으로 바뀐다 — 좁은 방 폭발은 없다
  });

  it('전리품 롤 — 탄약이 떨어지고, 밟으면 예비 탄약으로 들어간다', () => {
    Props.init(world);
    const prop = putProp(world, 'prop_jar', 8, 6);
    const cfg = TYPES.prop_jar;
    const total = cfg.empty + cfg.loot + cfg.ambush + cfg.explode;
    const lt = balance.props.loot;
    const lootTotal = lt.gold + lt.potion + lt.mana + lt.ammo + lt.grenade + lt.battery;
    const rolls = [
      (cfg.empty + 1) / total, // 결과 = 전리품
      (lt.gold + lt.potion + lt.mana + 1) / lootTotal, // 종류 = 탄약
      0.5, // 흩뿌림 각
      0.5, // 흩뿌림 거리
    ];
    let call = 0;
    const orig = Math.random;
    Math.random = () => rolls[Math.min(call++, rolls.length - 1)]!;
    breakProp(world, prop);
    Math.random = orig;
    const drop = world.groundItems.find((g) => g.kind === 'ammo');
    expect(drop).toBeTruthy();
    // 플레이어(6,6) 반대쪽으로 떨어졌다 — 기믹(8,6) 기준 +X 쪽
    expect(drop!.x).toBeGreaterThan(8);
    // 바닥에 놓이기 전(noMagnetTicks)엔 코앞이라도 못 줍는다
    expect(drop!.noMagnetTicks).toBe(balance.props.lootNoMagnetTicks);
    const reserve0 = world.weapon.reserve;
    drop!.x = world.player.x;
    drop!.z = world.player.z;
    for (let i = 0; i < 10; i++) Pickups.tick(world, DT);
    expect(world.weapon.reserve).toBe(reserve0); // 아직 낙하 유예
    for (let i = 0; i < balance.props.lootNoMagnetTicks + 90; i++) Pickups.tick(world, DT);
    expect(world.weapon.reserve).toBe(reserve0 + lt.ammoAmount); // 완전히 놓인 뒤에 먹힌다
  });
});
