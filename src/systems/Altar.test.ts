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

/** 제단 옆(서쪽 1.2m)에 서서 제단(+X)을 바라본다 */
function standAtAltar(world: World, lookAway = false): void {
  const a = world.level.altarPos!;
  world.player.x = a.x - 1.2;
  world.player.z = a.z;
  world.player.yaw = lookAway ? Math.PI / 2 : -Math.PI / 2; // -π/2 = +X 방향
}

function enterAltar(world: World): void {
  standAtAltar(world);
  Altar.tick(world, DT); // 접근 감지
  pressInteract(world);
}

describe('제단 진입', () => {
  it('무료 보급은 없다 — 잔탄·수류탄이 그대로다 (2026-08 폐지)', () => {
    enterAltar(world);
    expect(world.weapon.mag).toBe(5); // 들고 온 그대로
    expect(world.weapon.reserve).toBe(12);
    expect(world.weapon.grenades).toBe(3);
  });

  it('부활 지점은 제단 중심이 아니라 서 있던 자리 — 기둥 안에 되살아나지 않게', () => {
    enterAltar(world);
    const a = world.level.altarPos!;
    expect(world.respawn).toEqual({ x: a.x - 1.2, z: a.z });
    expect(world.respawn).not.toEqual(a);
  });

  it('등지고 있으면 안내도 진입도 없다 — 바라봐야 한다', () => {
    standAtAltar(world, true); // 제단을 등짐
    Altar.tick(world, DT);
    expect(world.nearAltar).toBe(true); // 거리는 가깝지만
    expect(world.altarInView).toBe(false); // 시선이 아니다
    pressInteract(world);
    expect(world.respawn).toBeNull(); // E를 눌러도 진입하지 않는다

    standAtAltar(world); // 돌아서면
    Altar.tick(world, DT);
    expect(world.altarInView).toBe(true);
    pressInteract(world);
    expect(world.respawn).not.toBeNull();
  });

  it('제단 기둥은 뚫고 지나갈 수 없다', () => {
    const a = world.level.altarPos!;
    const body = { x: a.x - 3, z: a.z };
    world.level.slideMove(body, 0.4, 5, 0); // 제단을 향해 5m 돌진
    expect(body.x).toBeLessThan(a.x - 0.55 - 0.4 + 0.01); // 기둥 앞에서 막힌다
    expect(body.x).toBeGreaterThan(a.x - 3); // 그래도 앞으로 가긴 했다

    // 옆으로 비켜 가면 그대로 지나간다 (셀 전체가 막힌 게 아니다)
    const side = { x: a.x - 3, z: a.z + 1.4 };
    world.level.slideMove(side, 0.4, 5, 0);
    expect(side.x).toBeCloseTo(a.x + 2, 1);
  });

  it('접근 후 진입 없이 벗어나면 altar_bypassed', () => {
    const bypassed: unknown[] = [];
    world.events.on('altar_bypassed', (payload) => bypassed.push(payload));

    standAtAltar(world);
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

    // 상한 근처 — 넘치지 않고 상한에서 멈춘다 (재고가 남아 바로 살 수 있다)
    world.weapon.reserve = balance.weapons.pistol.ammoMax - 3;
    expect(Altar.purchase(world, 'ammo')).toBe(true);
    expect(world.weapon.reserve).toBe(balance.weapons.pistol.ammoMax);
  });

  it('재고를 다 쓰면 5분 재입고 — 품목별 재고 수가 다르다', () => {
    world.gold = 10000;
    world.weapon.reserve = 0;
    world.weapon.grenades = 0;
    world.lantern.spares = 0;
    const denied: { item: string; reason: string; cooldown: number }[] = [];
    world.events.on('shop_denied', (payload) =>
      denied.push(payload as { item: string; reason: string; cooldown: number }),
    );

    expect(shop.cooldownTicks).toBe(300 * 60); // 5분 = 18000틱
    expect([shop.ammo.stock, shop.grenade.stock, shop.battery.stock]).toEqual([3, 2, 1]);

    // 권총탄 3번까지는 산다 (탄약 상한에 걸리지 않게 매번 비워 둔다)
    for (let i = 0; i < shop.ammo.stock; i++) {
      world.weapon.reserve = 0;
      expect(Altar.purchase(world, 'ammo')).toBe(true);
      expect(Altar.shopState(world, 'ammo').stock).toBe(shop.ammo.stock - 1 - i);
    }
    world.weapon.reserve = 0;
    const goldAfter = world.gold;
    expect(Altar.purchase(world, 'ammo')).toBe(false); // 4번째 — 재입고 대기
    expect(world.gold).toBe(goldAfter);
    expect(denied[0]).toMatchObject({ item: 'ammo', reason: 'cooldown', cooldown: shop.cooldownTicks });

    // 수류탄은 2번, 배터리는 1번
    expect(Altar.purchase(world, 'grenade')).toBe(true);
    expect(Altar.purchase(world, 'grenade')).toBe(true);
    expect(Altar.purchase(world, 'grenade')).toBe(false);
    expect(Altar.purchase(world, 'battery')).toBe(true);
    expect(Altar.purchase(world, 'battery')).toBe(false);
  });

  it('재입고되면 재고가 가득 찬다 — 1틱 모자라면 아직', () => {
    world.gold = 10000;
    for (let i = 0; i < shop.ammo.stock; i++) {
      world.weapon.reserve = 0;
      Altar.purchase(world, 'ammo');
    }
    world.weapon.reserve = 0;
    expect(Altar.shopState(world, 'ammo').stock).toBe(0);

    world.tick += shop.cooldownTicks - 1;
    expect(Altar.shopState(world, 'ammo')).toMatchObject({ stock: 0, cooldown: 1 });
    expect(Altar.purchase(world, 'ammo')).toBe(false);

    world.tick += 1;
    expect(Altar.shopState(world, 'ammo')).toMatchObject({
      stock: shop.ammo.stock, // 하나가 아니라 가득
      cooldown: 0,
    });
    expect(Altar.purchase(world, 'ammo')).toBe(true);
    expect(Altar.shopState(world, 'ammo').stock).toBe(shop.ammo.stock - 1);
  });

  it('재입고 대기 거절은 골드·상한 거절보다 우선해 알려준다', () => {
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
      stock: shop.grenade.stock,
      stockMax: shop.grenade.stock,
      canBuy: false,
    });
  });
});

describe('오염 정산과 임계', () => {
  it('제단 진입 시 pending → applied, corruption_applied 발행', () => {
    world.corruption.pending = 13;
    enterAltar(world);
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
