// 제단·오염 검증 — 골드 상점(무료 보급 폐지), 우회 계측, 정산·임계, 흉터.

import { beforeEach, describe, expect, it } from 'vitest';
import { balance } from '../core/Balance';
import { Events } from '../core/Events';
import { Input } from '../core/Input';
import { addItem, countOf, initInventory } from '../core/Inventory';
import { World } from '../core/World';
import { Level } from '../level/GridLoader';
import { spawnEnemies } from '../level/Spawner';
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
  initInventory(world); // 상점의 물약은 가방으로 들어간다 — 칸이 없으면 살 수도 없다
});

/** 제단 옆(서쪽 1.2m)에 서서 제단(+X)을 바라본다 */
function standAtAltar(world: World, lookAway = false): void {
  const a = world.level.altarPos!;
  world.player.x = a.x - 1.2;
  world.player.z = a.z;
  world.player.yaw = lookAway ? Math.PI / 2 : -Math.PI / 2; // -π/2 = +X 방향
}

/** 붙들기 — 처음 활성화는 계단처럼 activateHoldTicks 동안 상호작용을 붙들어야 한다 (2026-09-07 사용자) */
function holdInteract(world: World, ticks: number): void {
  world.input = { ...Input.emptySnapshot(), interactHeld: true };
  for (let i = 0; i < ticks; i++) Altar.tick(world, DT);
  world.input = Input.emptySnapshot();
}

function enterAltar(world: World): void {
  standAtAltar(world);
  Altar.tick(world, DT); // 접근 감지
  holdInteract(world, balance.altar.activateHoldTicks);
}

describe('제단 진입', () => {
  it('처음 활성화는 한 번 눌러서는 안 되고 activateHoldTicks 동안 붙들어야 한다 — 놓으면 게이지가 0 으로', () => {
    standAtAltar(world);
    Altar.tick(world, DT);
    pressInteract(world);
    expect(world.altars).toHaveLength(0); // 한 번 누른 것으로는 활성화되지 않는다
    holdInteract(world, balance.altar.activateHoldTicks - 1);
    expect(world.altarHoldTicks).toBe(balance.altar.activateHoldTicks - 1);
    expect(world.altars).toHaveLength(0);
    Altar.tick(world, DT); // 놓았다
    expect(world.altarHoldTicks).toBe(0);
    holdInteract(world, balance.altar.activateHoldTicks);
    expect(world.altars).toHaveLength(1);
    expect(world.altarHoldTicks).toBe(0);
    expect(Altar.isActivated(world)).toBe(true);
  });

  it('피격(breakHold)이 붙들기를 끊는다 — 게이지 0, 다시 붙들어야 한다 (2026-09-08)', () => {
    standAtAltar(world);
    Altar.tick(world, DT);
    expect(Altar.breakHold(world)).toBe(false); // 붙들고 있지 않다
    holdInteract(world, 20);
    expect(world.altarHoldTicks).toBe(20);
    expect(Altar.breakHold(world)).toBe(true);
    expect(world.altarHoldTicks).toBe(0);
    expect(world.altars).toHaveLength(0);
    holdInteract(world, balance.altar.activateHoldTicks - 1);
    expect(world.altars).toHaveLength(0); // 이어지지 않고 처음부터
  });

  it('활성화한 층의 제단은 다음부터 한 번 눌러 진입(상점)한다', () => {
    enterAltar(world);
    const entered: unknown[] = [];
    world.events.on('altar_entered', (p) => entered.push(p));
    world.nearAltar = false;
    world.altarEnteredThisApproach = false;
    Altar.tick(world, DT);
    pressInteract(world);
    expect(entered).toHaveLength(1);
  });

  it('무료 보급은 없다 — 잔탄·수류탄이 그대로다 (2026-08 폐지)', () => {
    enterAltar(world);
    expect(world.weapon.mag).toBe(5); // 들고 온 그대로
    expect(world.weapon.reserve).toBe(12);
    expect(world.weapon.grenades).toBe(3);
  });

  it('부활 지점은 제단 중심이 아니라 서 있던 자리 — 기둥 안에 되살아나지 않게', () => {
    enterAltar(world);
    const a = world.level.altarPos!;
    expect(world.respawn).toEqual({ floor: 0, x: a.x - 1.2, z: a.z });
    expect(world.respawn).not.toMatchObject({ x: a.x, z: a.z });
  });

  it('진입한 제단은 층 번호와 함께 활성화 목록(altars)에 오른다 — 층마다 하나, 다시 들르면 자리만 갱신 (로비 대제단 워프)', () => {
    world.floorIndex = 2;
    enterAltar(world);
    expect(world.respawn!.floor).toBe(2);
    expect(world.altars).toHaveLength(1);
    expect(world.altars[0]).toEqual(world.respawn);
    // 다른 자리에서 다시 진입 — 목록은 늘지 않고 자리만 바뀐다
    world.nearAltar = false;
    world.altarEnteredThisApproach = false;
    world.player.z += 0.5;
    Altar.tick(world, DT);
    pressInteract(world);
    expect(world.altars).toHaveLength(1);
    expect(world.altars[0]!.z).toBe(world.level.altarPos!.z + 0.5);
  });

  it('성소 로비의 대제단 — 저장도 상점도 아니다: respawn·altars 를 건드리지 않고 lobby_altar_entered 만 낸다', () => {
    world.lobby = true;
    const seen: string[] = [];
    world.events.on('lobby_altar_entered', () => seen.push('warp'));
    world.events.on('altar_entered', () => seen.push('shop'));
    standAtAltar(world);
    Altar.tick(world, DT);
    pressInteract(world); // 대제단은 붙들기가 아니라 한 번 눌러서 (활성화 개념이 없다)
    expect(seen).toEqual(['warp']);
    expect(world.respawn).toBeNull();
    expect(world.altars).toHaveLength(0);
    expect(world.altarEnteredThisApproach).toBe(true); // 같은 접근에서 두 번 열리지 않는다
  });

  it('등지고 있으면 안내도 진입도 없다 — 바라봐야 한다', () => {
    standAtAltar(world, true); // 제단을 등짐
    Altar.tick(world, DT);
    expect(world.nearAltar).toBe(true); // 거리는 가깝지만
    expect(world.altarInView).toBe(false); // 시선이 아니다
    holdInteract(world, balance.altar.activateHoldTicks);
    expect(world.respawn).toBeNull(); // E를 붙들어도 진입하지 않는다

    standAtAltar(world); // 돌아서면
    Altar.tick(world, DT);
    expect(world.altarInView).toBe(true);
    holdInteract(world, balance.altar.activateHoldTicks);
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

describe('제단 안전 반경', () => {
  it('제단 주변에는 적이 스폰되지 않는다 — 부활 지점이라 즉시 전투가 붙으면 안 된다', () => {
    const level = world.level;
    const a = level.altarPos!;
    const cs = level.cellSize;
    const cell = (x: number, z: number): number[] => [Math.floor(z / cs), Math.floor(x / cs)];

    const onAltar = cell(a.x, a.z);
    const far = cell(a.x + balance.altar.safeRadius + cs * 2, a.z);
    const spawned = spawnEnemies(
      [
        { type: 'goblin_runner', cell: onAltar }, // 제단 바로 위
        { type: 'goblin_runner', cell: far }, // 반경 밖
      ],
      level,
    );
    expect(spawned).toHaveLength(1);
    expect(Math.hypot(spawned[0]!.x - a.x, spawned[0]!.z - a.z)).toBeGreaterThan(
      balance.altar.safeRadius,
    );
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
    for (let i = 0; i < shop.heal.stock; i++) {
      expect(Altar.purchase(world, 'heal')).toBe(true); // 재고를 다 산다
    }
    world.gold = 0; // 돈까지 없는 상태
    const denied: { reason: string }[] = [];
    world.events.on('shop_denied', (payload) => denied.push(payload as { reason: string }));
    expect(Altar.purchase(world, 'heal')).toBe(false);
    expect(denied[0]!.reason).toBe('cooldown');
  });

  it('물약·수류탄·배터리도 각각 산다 — 물약은 회복이 아니라 가방으로', () => {
    world.gold = 1000;
    world.player.health = 40;
    world.mana.value = 10;
    world.weapon.grenades = 1;
    world.lantern.spares = 0;

    expect(Altar.purchase(world, 'heal')).toBe(true);
    expect(countOf(world, 'potion')).toBe(shop.heal.amount);
    expect(world.player.health).toBe(40); // 그 자리에서 낫지는 않는다
    expect(Altar.purchase(world, 'mana')).toBe(true);
    expect(countOf(world, 'mana')).toBe(shop.mana.amount);
    expect(world.mana.value).toBe(10);
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
    world.weapon.grenades = balance.weapons.grenade.ammoMax;
    const denied: { reason: string }[] = [];
    world.events.on('shop_denied', (payload) => denied.push(payload as { reason: string }));

    expect(Altar.purchase(world, 'grenade')).toBe(false);
    expect(world.gold).toBe(1000);
    expect(denied[0]!.reason).toBe('full');
  });

  it('만피여도 물약은 산다 — 지금 낫자는 게 아니라 챙겨 두는 것이다', () => {
    world.gold = 1000;
    world.player.health = balance.player.healthMax;
    world.mana.value = balance.mana.max;
    expect(Altar.purchase(world, 'heal')).toBe(true);
    expect(Altar.purchase(world, 'mana')).toBe(true);
    expect(countOf(world, 'potion')).toBe(shop.heal.amount);
    expect(countOf(world, 'mana')).toBe(shop.mana.amount);
  });

  it('가방이 가득이면 물약을 못 산다 — 여기서의 full 은 체력이 아니라 가방이다', () => {
    world.gold = 1000;
    world.player.health = 10;
    const per = balance.items.stackMax;
    const kinds = ['potion', 'mana', 'food'] as const;
    for (let i = 0; i < world.inventory.length * per; i++) {
      addItem(world, kinds[Math.floor(i / per) % kinds.length]!);
    }
    const denied: { reason: string }[] = [];
    world.events.on('shop_denied', (payload) => denied.push(payload as { reason: string }));

    expect(Altar.shopState(world, 'heal').full).toBe(true);
    expect(Altar.purchase(world, 'heal')).toBe(false);
    expect(denied[0]!.reason).toBe('full');
    expect(world.gold).toBe(1000);
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

