// 제단·오염 검증 — 골드 상점(무료 보급 폐지), 우회 계측, 정산·임계, 흉터.

import { beforeEach, describe, expect, it } from 'vitest';
import { balance } from '../core/Balance';
import { Events } from '../core/Events';
import { Input } from '../core/Input';
import { World } from '../core/World';
import { Level } from '../level/GridLoader';
import * as Altar from './Altar';
import * as Corruption from './Corruption';
import * as Sigils from './Sigils';

const DT = 1 / 60;

function makeWorld(): World {
  const level = new Level({
    id: 'arena',
    name: 'arena',
    cellSize: 4,
    ceiling: 4,
    grid: ['######', '#S.A.#', '######'],
    lighting: { ambient: 0.04, torches: [] },
  });
  const world = new World(new Events(), {
    input: Input.emptySnapshot(),
    player: {
      x: 6, y: 0, z: 6, prevX: 6, prevY: 0, prevZ: 6,
      yaw: 0, pitch: 0, health: 100,
      stunTicks: 0, dodgeTicks: 0, dodgeDirX: 0, dodgeDirZ: 0,
      iframeTicks: 0, reactionBufferTicks: 0, blocking: false, reactionHeldTicks: 0,
    },
    lantern: { on: true, battery: 100, spares: 0 },
    weapon: { melee: 'hammer', ranged: 'pistol', mag: 5, reserve: 12, cooldown: 0, reloading: 0, muzzleFlash: 0, grenades: 3, meleeCooldown: 0, grenadeCharge: 0, comboStep: 0, comboTimer: 0, swingImpact: 0, swingHeavy: false },
    mana: { value: 0, chainIndex: 0, outOfCombatTicks: 0, inCombat: false },
    sigils: {
      inventory: [],
      equipped: { eye: null, rightArm: null, leftArm: null, heart: null, spine: null },
      scars: { eye: 0, rightArm: 0, leftArm: 0, heart: 0, spine: 0 },
    },
    modifiers: Sigils.defaultModifiers(),
    corruption: { applied: 0, pending: 0 },
    enemies: [],
    level,
  });
  Corruption.init(world);
  return world;
}

function pressInteract(world: World): void {
  world.input = { ...Input.emptySnapshot(), interactPressed: true };
  Altar.tick(world, DT);
  world.input = Input.emptySnapshot();
}

let world: World;
beforeEach(() => {
  world = makeWorld();
});

function enterAltar(world: World): void {
  world.player.x = world.level.altarPos!.x;
  world.player.z = world.level.altarPos!.z;
  Altar.tick(world, DT); // 접근 감지
  pressInteract(world);
}

describe('제단 진입', () => {
  it('무료 보급은 없다 — 잔탄·수류탄이 그대로다 (2026-08 폐지)', () => {
    enterAltar(world);
    expect(world.weapon.mag).toBe(5); // 들고 온 그대로
    expect(world.weapon.reserve).toBe(12);
    expect(world.weapon.grenades).toBe(3);
    expect(world.respawn).toEqual(world.level.altarPos); // 세이브는 그대로 동작
  });

  it('접근 후 진입 없이 벗어나면 altar_bypassed', () => {
    const bypassed: unknown[] = [];
    world.events.on('altar_bypassed', (payload) => bypassed.push(payload));

    world.player.x = world.level.altarPos!.x;
    world.player.z = world.level.altarPos!.z;
    Altar.tick(world, DT); // 접근
    world.player.x = 6; // 멀어짐
    Altar.tick(world, DT);
    expect(bypassed).toHaveLength(1);
    expect(bypassed[0]).toMatchObject({
      ammoLeftRatio: (5 + 12) / (balance.weapons.pistol.magSize + balance.weapons.pistol.ammoMax),
    });
  });
});

describe('제단 상점', () => {
  const shop = balance.altar.shop;

  it('골드를 내고 탄약을 산다 — 상한을 넘지 않는다', () => {
    world.gold = 100;
    world.weapon.reserve = 12;
    const bought: unknown[] = [];
    world.events.on('shop_purchased', (payload) => bought.push(payload));

    expect(Altar.purchase(world, 'ammo')).toBe(true);
    expect(world.weapon.reserve).toBe(12 + shop.ammo.amount);
    expect(world.gold).toBe(100 - shop.ammo.price);
    expect(bought).toHaveLength(1);

    // 상한 근처 — 넘치지 않고 상한에서 멈춘다 (쿨타임이 지난 뒤)
    world.tick += shop.cooldownTicks;
    world.weapon.reserve = balance.weapons.pistol.ammoMax - 3;
    expect(Altar.purchase(world, 'ammo')).toBe(true);
    expect(world.weapon.reserve).toBe(balance.weapons.pistol.ammoMax);
  });

  it('같은 품목은 쿨타임(5분) 동안 다시 못 산다 — 다른 품목은 영향 없다', () => {
    world.gold = 1000;
    world.weapon.reserve = 0;
    world.weapon.grenades = 0;
    const denied: { reason: string; cooldown: number }[] = [];
    world.events.on('shop_denied', (payload) =>
      denied.push(payload as { reason: string; cooldown: number }),
    );

    expect(shop.cooldownTicks).toBe(300 * 60); // 5분 = 18000틱
    expect(Altar.purchase(world, 'ammo')).toBe(true);

    // 같은 품목 — 거절, 골드도 그대로
    const goldAfter = world.gold;
    expect(Altar.purchase(world, 'ammo')).toBe(false);
    expect(world.gold).toBe(goldAfter);
    expect(denied[0]).toMatchObject({ reason: 'cooldown', cooldown: shop.cooldownTicks });

    // 다른 품목은 바로 살 수 있다
    expect(Altar.purchase(world, 'grenade')).toBe(true);

    // 1틱 모자라면 여전히 거절
    world.tick += shop.cooldownTicks - 1;
    expect(Altar.shopState(world, 'ammo').cooldown).toBe(1);
    expect(Altar.purchase(world, 'ammo')).toBe(false);

    // 딱 맞으면 풀린다
    world.tick += 1;
    expect(Altar.shopState(world, 'ammo').cooldown).toBe(0);
    expect(Altar.purchase(world, 'ammo')).toBe(true);
  });

  it('쿨타임 거절은 골드·상한 거절보다 우선해 알려준다', () => {
    world.gold = 1000;
    world.player.health = 10;
    expect(Altar.purchase(world, 'heal')).toBe(true);
    world.gold = 0; // 돈까지 없는 상태
    const denied: { reason: string }[] = [];
    world.events.on('shop_denied', (payload) => denied.push(payload as { reason: string }));
    expect(Altar.purchase(world, 'heal')).toBe(false);
    expect(denied[0]!.reason).toBe('cooldown');
  });

  it('HP·마나·수류탄·배터리도 각각 산다', () => {
    world.gold = 1000;
    world.player.health = 40;
    world.mana.value = 10;
    world.weapon.grenades = 1;
    world.lantern.spares = 0;

    expect(Altar.purchase(world, 'heal')).toBe(true);
    expect(world.player.health).toBe(40 + shop.heal.amount);
    expect(Altar.purchase(world, 'mana')).toBe(true);
    expect(world.mana.value).toBe(10 + shop.mana.amount);
    expect(Altar.purchase(world, 'grenade')).toBe(true);
    expect(world.weapon.grenades).toBe(1 + shop.grenade.amount);
    expect(Altar.purchase(world, 'battery')).toBe(true);
    expect(world.lantern.spares).toBe(shop.battery.amount);
  });

  it('골드가 모자라면 거절 — 아무것도 소모되지 않는다', () => {
    world.gold = shop.grenade.price - 1;
    world.weapon.grenades = 0;
    const denied: { reason: string }[] = [];
    world.events.on('shop_denied', (payload) => denied.push(payload as { reason: string }));

    expect(Altar.purchase(world, 'grenade')).toBe(false);
    expect(world.weapon.grenades).toBe(0);
    expect(world.gold).toBe(shop.grenade.price - 1);
    expect(denied[0]!.reason).toBe('no_gold');
  });

  it('이미 가득 차 있으면 거절 — 골드를 낭비하지 않는다', () => {
    world.gold = 1000;
    world.player.health = balance.player.healthMax;
    const denied: { reason: string }[] = [];
    world.events.on('shop_denied', (payload) => denied.push(payload as { reason: string }));

    expect(Altar.purchase(world, 'heal')).toBe(false);
    expect(world.gold).toBe(1000);
    expect(denied[0]!.reason).toBe('full');
  });

  it('shopState 가 UI 표시용 보유량·상한·구매 가능 여부를 준다', () => {
    world.gold = 0;
    world.weapon.grenades = 2;
    const s = Altar.shopState(world, 'grenade');
    expect(s).toMatchObject({
      price: shop.grenade.price,
      have: 2,
      max: balance.weapons.grenade.ammoMax,
      full: false,
      poor: true,
      cooldown: 0,
      canBuy: false,
    });
  });
});

describe('오염 정산과 임계', () => {
  it('제단 진입 시 pending → applied, corruption_applied 발행', () => {
    world.corruption.pending = 13;
    world.player.x = world.level.altarPos!.x;
    world.player.z = world.level.altarPos!.z;
    Altar.tick(world, DT);
    pressInteract(world);
    expect(world.corruption.applied).toBe(13);
    expect(world.corruption.pending).toBe(0);
  });

  it('임계 25를 넘는 순간 corruption_threshold + 문자 해독 활성화', () => {
    const thresholds: unknown[] = [];
    world.events.on('corruption_threshold', (payload) => thresholds.push(payload));
    world.corruption.applied = 20;
    world.corruption.pending = 10;
    Corruption.settle(world);
    expect(thresholds).toEqual([{ threshold: 25 }]);
    expect(world.canReadGlyphs).toBe(true);
  });

  it('임계는 걸치지 않으면 발행되지 않는다', () => {
    const thresholds: unknown[] = [];
    world.events.on('corruption_threshold', (payload) => thresholds.push(payload));
    world.corruption.applied = 26;
    world.corruption.pending = 5;
    Corruption.settle(world);
    expect(thresholds).toHaveLength(0);
  });
});

describe('흉터', () => {
  it('흉터는 기록되지만 더 이상 페널티를 남기지 않는다 (부착 페널티 폐지)', () => {
    world.sigils.inventory.push('sig_fireball');
    Sigils.attach(world, 'sig_fireball');

    Sigils.detach(world, 'rightArm');
    // 흉터 자체는 남는다 — 이후 다른 용도로 쓸 수 있게 기록만 유지
    expect(world.sigils.scars.rightArm).toBe(balance.sigil.scarRatio);
  });
});
