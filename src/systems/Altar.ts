// 제단 — 접근 감지, 진입(세이브/정산 트리거), 우회 계측, 골드 상점.
// docs/systems/economy.md §1~2.
//
// ⚠ 2026-08 변경: 무료 보급 폐지. 제단에 들어가도 탄약·수류탄이 저절로 차지 않는다.
//    전부 골드로 산다 (purchase). 직전 구간 전투 평가 배율(공격성 보너스)도 함께 제거됐다.
//    되살리려면 git 이력의 aggressionMultiplier / enter()의 상한 SET 블록을 참조할 것.

import { balance } from '../core/Balance';
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
  /** 재구매 쿨타임 남은 틱 (0이면 준비됨) */
  cooldown: number;
  canBuy: boolean;
}

export function shopState(world: World, item: ShopItem): ShopState {
  const shop = balance.altar.shop;
  const p = world.player;
  const w = world.weapon;
  let price: number;
  let amount: number;
  let have: number;
  let max: number;

  switch (item) {
    case 'heal':
      ({ price, amount } = shop.heal);
      have = Math.round(p.health);
      max = balance.player.healthMax;
      break;
    case 'mana':
      ({ price, amount } = shop.mana);
      have = Math.round(world.mana.value);
      max = balance.mana.max;
      break;
    case 'ammo':
      ({ price, amount } = shop.ammo);
      have = w.reserve;
      max = balance.weapons.pistol.ammoMax;
      break;
    case 'grenade':
      ({ price, amount } = shop.grenade);
      have = w.grenades;
      max = balance.weapons.grenade.ammoMax;
      break;
    case 'battery':
      ({ price, amount } = shop.battery);
      have = world.lantern.spares;
      max = shop.battery.sparesMax;
      break;
  }

  const full = have >= max;
  const poor = world.gold < price;
  const cooldown = Math.max(0, (world.shopReadyTick[item] ?? 0) - world.tick);
  return { price, amount, have, max, full, poor, cooldown, canBuy: !full && !poor && cooldown === 0 };
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
      gold: world.gold,
    });
    return false;
  }

  world.gold -= state.price;
  const p = world.player;
  const w = world.weapon;
  switch (item) {
    case 'heal':
      p.health = Math.min(state.max, p.health + state.amount);
      break;
    case 'mana':
      world.mana.value = Math.min(state.max, world.mana.value + state.amount);
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

  // 같은 품목은 한동안 다시 못 산다 — 제단 하나에서 물자를 통째로 사 모으지 못하게
  world.shopReadyTick[item] = world.tick + balance.altar.shop.cooldownTicks;

  world.events.emit('shop_purchased', {
    item,
    price: state.price,
    amount: state.amount,
    gold: world.gold,
    cooldown: balance.altar.shop.cooldownTicks,
  });
  return true;
}
