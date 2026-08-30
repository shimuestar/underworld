// 소모품 사용 — 퀵슬롯 1~5 키를 받아 마신다.
// 가방·퀵슬롯의 상태 조작 자체는 core/Inventory 에 있다 (줍는 쪽도 같은 규칙을 써야 해서).
//
// 즉발이 아니라 시전이다. 누르면 channelTicks 동안 마시고, 그 시간을 다 채워야 효과가 난다.
// 맞아서 굳거나·회피하거나·공격하거나·죽으면 끊기고, 끊기면 아이템은 소모되지 않는다 —
// 잃는 것은 시간이다. 방패를 들고 있으면 아예 시작되지 않는다 (가드를 내려야 마신다).
// 즉발로 두면 "위험할 때 아무 때나 부어 버리면 그만"이라 안전한 자리를 만들 이유가 없다.

import { balance } from '../core/Balance';
import { countOf, isUseful, itemDef, takeItem } from '../core/Inventory';
import type { ItemKind, World } from '../core/World';

export function tick(world: World, _dt: number): void {
  if (world.itemCooldown > 0) world.itemCooldown--;

  // 음식 지속 회복 — 30초 동안 HP 가 아주 천천히 찬다 (스태미너 가속은 Stamina 가 읽는다)
  if (world.foodRegenTicks > 0) {
    world.foodRegenTicks--;
    const rg = itemDef('food').regen;
    if (rg && !world.dead && world.player.health < balance.player.healthMax) {
      world.player.health = Math.min(
        balance.player.healthMax,
        world.player.health + rg.healPerTick,
      );
    }
    if (world.foodRegenTicks === 0) world.events.emit('food_regen_ended', {});
  }

  // 먼저 진행분을 흘린 뒤에 이번 틱 입력을 받는다 —
  // 순서를 뒤집으면 시작한 그 틱이 한 번 더 세어져 channelTicks 보다 한 틱 짧아진다
  advanceChannel(world);

  const key = world.input.useSlot;
  if (key >= 1 && key <= world.quickslots.length) use(world, key - 1);
}

/** 마시던 것을 끊는 행동 — 이번 틱에 다른 걸 했는가 */
function acted(world: World): boolean {
  const input = world.input;
  return (
    input.rangedPressed || input.meleePressed || input.castPressed || input.reactionPressed
  );
}

function advanceChannel(world: World): void {
  const channel = world.itemChannel;
  if (!channel) return;
  const p = world.player;

  const broken =
    world.dead || p.stunTicks > 0 || p.dodgeTicks > 0 || p.blocking || acted(world);
  if (broken) {
    world.itemChannel = null;
    world.events.emit('item_channel_broken', { kind: channel.kind, index: channel.index });
    return;
  }

  channel.ticks++;
  if (channel.ticks < channel.total) return;

  world.itemChannel = null;
  drink(world, channel.kind, channel.index);
}

/** 다 마셨다 — 여기서 비로소 소모되고 효과가 난다 */
function drink(world: World, kind: ItemKind, index: number): void {
  // 마시는 사이에 버려졌을 수도 있다 (Tab 창은 시뮬레이션을 멈추지만 방어적으로 본다)
  if (!takeItem(world, kind)) {
    world.events.emit('item_denied', { index, kind, reason: 'none' });
    return;
  }
  world.itemCooldown = balance.items.useCooldownTicks;

  const def = itemDef(kind);
  const p = world.player;
  const hpBefore = p.health;
  const manaBefore = world.mana.value;
  if (def.heal > 0) p.health = Math.min(balance.player.healthMax, p.health + def.heal);
  if (def.restore > 0) {
    world.mana.value = Math.min(balance.mana.max, world.mana.value + def.restore);
  }
  if (def.regen) world.foodRegenTicks = def.regen.durationTicks; // 겹치면 갱신 — 중첩 없음
  world.events.emit('item_used', {
    kind,
    index,
    healed: p.health - hpBefore,
    restored: world.mana.value - manaBefore,
    left: countOf(world, kind),
  });
}

/** 퀵슬롯 하나를 쓰기 시작한다. 실패 이유는 item_denied 로 알린다 —
 *  "왜 안 마셔지지"를 화면에서 바로 읽을 수 있어야 한다 */
export function use(world: World, index: number): boolean {
  const kind = world.quickslots[index] ?? null;
  if (!kind) {
    world.events.emit('item_denied', { index, reason: 'empty' });
    return false;
  }
  if (world.itemChannel) {
    world.events.emit('item_denied', { index, kind, reason: 'busy' });
    return false;
  }
  if (world.itemCooldown > 0) {
    world.events.emit('item_denied', { index, kind, reason: 'cooldown' });
    return false;
  }
  if (countOf(world, kind) <= 0) {
    world.events.emit('item_denied', { index, kind, reason: 'none' });
    return false;
  }
  if (!isUseful(world, kind)) {
    world.events.emit('item_denied', { index, kind, reason: 'full' });
    return false;
  }
  if (world.player.blocking) {
    world.events.emit('item_denied', { index, kind, reason: 'blocking' });
    return false;
  }

  world.itemChannel = { kind, index, ticks: 0, total: balance.items.channelTicks };
  world.events.emit('item_channel_started', { kind, index, ticks: balance.items.channelTicks });
  return true;
}

/** 마시는 진행률 0~1 — HUD 와 손 연출이 읽는다 */
export function channelFrac(world: World): number {
  const channel = world.itemChannel;
  if (!channel) return 0;
  return Math.min(1, channel.ticks / channel.total);
}
