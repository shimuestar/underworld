// 제단 — 접근 감지, 진입(세이브/정산 트리거), 우회 계측, 골드 상점.
// docs/systems/economy.md §1~2.
//
// ⚠ 2026-08 변경: 무료 보급 폐지. 제단에 들어가도 탄약·수류탄이 저절로 차지 않는다.
//    전부 골드로 산다 (purchase). 직전 구간 전투 평가 배율(공격성 보너스)도 함께 제거됐다.
//    되살리려면 git 이력의 aggressionMultiplier / enter()의 상한 SET 블록을 참조할 것.

import { balance } from '../core/Balance';
import { addItem, countOf, hasRoom } from '../core/Inventory';
import type { World } from '../core/World';

/** 제단 상점 품목 */
export type ShopItem = 'heal' | 'mana' | 'ammo' | 'grenade' | 'battery';

export const SHOP_ITEMS: ShopItem[] = ['heal', 'mana', 'ammo', 'grenade', 'battery'];

export function tick(world: World, _dt: number): void {
  const altar = world.level.altarPos;
  if (!altar) return;

  const p = world.player;
  const toX = altar.x - p.x;
  const toZ = altar.z - p.z;
  const dist = Math.hypot(toX, toZ);
  const near = dist <= balance.altar.radius;

  // 등지고 서 있으면 안내도 진입도 없다 — 시선이 제단을 향해야 한다.
  // (yaw 기준 전방 벡터. PlayerMove의 이동 기준과 같은 규약)
  const fx = -Math.sin(p.yaw);
  const fz = -Math.cos(p.yaw);
  const facing =
    dist <= 0.001 ||
    (toX * fx + toZ * fz) / dist >= Math.cos((balance.altar.facingArcDeg * Math.PI) / 360);
  world.altarInView = near && facing;

  if (near && !world.nearAltar) {
    world.nearAltar = true;
    world.altarEnteredThisApproach = false;
  } else if (!near && world.nearAltar) {
    world.nearAltar = false;
    if (!world.altarEnteredThisApproach) {
      world.events.emit('altar_bypassed', { ammoLeftRatio: ammoLeftRatio(world) });
    }
  }

  if (world.altarInView && world.input.interactPressed && !world.altarEnteredThisApproach) {
    enter(world);
  }
}

function ammoLeftRatio(world: World): number {
  const pistol = balance.weapons.pistol;
  return (world.weapon.mag + world.weapon.reserve) / (pistol.magSize + pistol.ammoMax);
}

export function enter(world: World): void {
  // 보급 없음 — 상점에서 골드로 산다. 제단은 이제 "쉬는 곳"이 아니라 "쓰는 곳"이다.
  // 부활 지점은 제단 중심이 아니라 "지금 서 있는 자리" — 기둥이 막혀 있어서
  // 중심 좌표로 되살리면 구조물 안에 파묻힌다
  const spot = { x: world.player.x, z: world.player.z };
  world.respawn = spot;
  world.events.emit('respawn_registered', spot);

  world.altarEnteredThisApproach = true;

  // 오염 정산은 Corruption이, 상점 UI는 main이 이 이벤트를 구독해 처리
  world.events.emit('altar_entered', {
    ammoLeftRatio: ammoLeftRatio(world),
    pendingCorruption: world.corruption.pending,
    gold: world.gold,
  });
}

// ---- 상점 ----

export interface ShopState {
  price: number;
  /** 이 품목이 늘려주는 양 (HP/마나 회복량, 탄약 발수, 개수) */
  amount: number;
  /** 현재 보유량 / 상한 — UI 표시용 */
  have: number;
  max: number;
  /** 이미 가득 차 살 수 없다 */
  full: boolean;
  /** 골드가 모자란다 */
  poor: boolean;
  /** 남은 재고 (0이면 재입고 대기) */
  stock: number;
  /** 가득 찼을 때의 재고 */
  stockMax: number;
  /** 재입고까지 남은 틱 (재고가 있으면 0) */
  cooldown: number;
  canBuy: boolean;
}

/** 한 종류만으로 가방을 채웠을 때의 상한 — 상점 표시에 쓰는 값 */
function bagCap(): number {
  return balance.items.cols * balance.items.rows * balance.items.stackMax;
}

export function shopState(world: World, item: ShopItem): ShopState {
  const shop = balance.altar.shop;
  const w = world.weapon;
  let price: number;
  let amount: number;
  let stockMax: number;
  let have: number;
  let max: number;
  // 가방 품목은 '체력이 가득'이 아니라 '가방이 가득'으로 막힌다
  let bagFull = false;

  switch (item) {
    // 체력·마나는 즉시 회복이 아니라 물약을 판다 — 가방에 자리가 있어야 살 수 있다.
    // '가득'의 뜻도 체력이 아니라 가방이다 (만피여도 챙겨 둘 수 있어야 한다)
    case 'heal':
      ({ price, amount, stock: stockMax } = shop.heal);
      have = countOf(world, 'potion');
      max = bagCap();
      bagFull = !hasRoom(world, 'potion');
      break;
    case 'mana':
      ({ price, amount, stock: stockMax } = shop.mana);
      have = countOf(world, 'mana');
      max = bagCap();
      bagFull = !hasRoom(world, 'mana');
      break;
    case 'ammo':
      ({ price, amount, stock: stockMax } = shop.ammo);
      have = w.reserve;
      max = balance.weapons.pistol.ammoMax;
      break;
    case 'grenade':
      ({ price, amount, stock: stockMax } = shop.grenade);
      have = w.grenades;
      max = balance.weapons.grenade.ammoMax;
      break;
    case 'battery':
      ({ price, amount, stock: stockMax } = shop.battery);
      have = world.lantern.spares;
      max = shop.battery.sparesMax;
      break;
  }

  // 재입고 시각이 지났으면 가득 찬 것으로 본다 (여기서 쓰지는 않는다 — 조회는 순수하게)
  const readyTick = world.shopReadyTick[item] ?? 0;
  let stock = world.shopStock[item] ?? stockMax;
  if (stock <= 0 && world.tick >= readyTick) stock = stockMax;

  const full = bagFull || have >= max;
  const poor = world.gold < price;
  const cooldown = stock > 0 ? 0 : Math.max(0, readyTick - world.tick);
  return {
    price, amount, have, max, stock, stockMax, full, poor, cooldown,
    canBuy: !full && !poor && stock > 0,
  };
}

/** 구매 시도. 성공하면 true. 실패 사유는 shop_denied 로 알린다 */
export function purchase(world: World, item: ShopItem): boolean {
  const state = shopState(world, item);
  if (!state.canBuy) {
    world.events.emit('shop_denied', {
      item,
      // 쿨타임을 먼저 알린다 — 돈이 있어도 못 사는 이유가 그쪽이므로
      reason: state.cooldown > 0 ? 'cooldown' : state.full ? 'full' : 'no_gold',
      price: state.price,
      cooldown: state.cooldown,
      stock: state.stock,
      gold: world.gold,
    });
    return false;
  }

  world.gold -= state.price;
  const w = world.weapon;
  switch (item) {
    case 'heal':
      for (let i = 0; i < state.amount; i++) addItem(world, 'potion');
      break;
    case 'mana':
      for (let i = 0; i < state.amount; i++) addItem(world, 'mana');
      break;
    case 'ammo':
      w.reserve = Math.min(state.max, w.reserve + state.amount);
      break;
    case 'grenade':
      w.grenades = Math.min(state.max, w.grenades + state.amount);
      break;
    case 'battery':
      world.lantern.spares = Math.min(state.max, world.lantern.spares + state.amount);
      break;
  }

  // 재고를 하나 깎고, 다 떨어지면 재입고 타이머를 건다 —
  // 제단 하나에서 물자를 통째로 쓸어 담지 못하게
  const left = state.stock - 1;
  world.shopStock[item] = left;
  if (left <= 0) world.shopReadyTick[item] = world.tick + balance.altar.shop.cooldownTicks;

  world.events.emit('shop_purchased', {
    item,
    price: state.price,
    amount: state.amount,
    gold: world.gold,
    stock: left,
    stockMax: state.stockMax,
  });
  return true;
}
