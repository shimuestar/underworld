// 마법 투사체 — 화염구 시전, 비행/충돌, 화상 DoT.
// 시전 수치는 sigils.json의 effects, 코스트는 balance.spellCost (tier 기준).
// 시전 시 cast_spell 이벤트 발행 → Mana가 연쇄를 리셋한다.

import { balance } from '../core/Balance';
import { barrierUp, enemyDef, shieldBlocksProjectile } from '../core/Entities';
import { rayVsAabb } from '../core/Ray';
import { sigilDef, type SigilDef } from '../core/SigilData';
import { alertEnemy, alertNearbyAt, breakGhoulHead, breakHeadsInRadius, breakPropsInRadius, damageProp, hitBarrel, igniteBarrel, playerBlocks, pushEnemy, pushPlayer, applyFrostOnHit, type BarrelState, type EnemyState, type ProjectileState, type PropState, type World } from '../core/World';

let nextProjectileId = 1;

/** 구독. 시작 시 1회 — 얼음이 깨지는 순간 예약된 피해를 넣는다 */
export function init(world: World): void {
  world.events.on('enemy_freeze_ended', (payload) => {
    const { enemyId } = payload as { enemyId: number };
    const enemy = world.enemies.find((e) => e.id === enemyId);
    if (!enemy || !enemy.alive) return;
    const damage = enemy.frozenDamage ?? 0;
    enemy.frozenDamage = 0;
    if (damage > 0) skillDamage(world, enemy, damage, 'frost');
  });
}

export function tick(world: World, dt: number): void {
  if (world.spell.cooldown > 0) world.spell.cooldown--;
  const cds = world.spell.cooldowns;
  if (cds) for (const id of Object.keys(cds)) if (cds[id]! > 0) cds[id]!--;

  const canCast =
    world.player.stunTicks <= 0 && world.player.dodgeTicks <= 0 && !world.player.blocking;

  // 채널형 스킬(관통 뇌창)은 엣지가 아니라 "붙들고 있는 칸"을 본다 — 떼면 그 틱에 끊긴다
  const heldSlot =
    world.input.skillHeld > 0
      ? world.input.skillHeld - 1
      : world.input.selectedSkillHeld
        ? world.selectedSkill
        : -1;
  tickChannel(world, heldSlot, canCast);

  // 칸 직접 지정(Z·X·C·V)이 우선, 없으면 선택한 칸(가운데 클릭 · 패드 Y)
  const slot = world.input.useSkill > 0 ? world.input.useSkill - 1 : world.input.useSelectedSkill ? world.selectedSkill : -1;
  if (slot >= 0 && canCast) tryCast(world, slot);

  moveProjectiles(world, dt);
  applyBurns(world);
}

/** 스킬 쿨다운 — 스킬별로 따로 돈다. 서리 볼트가 3초 쉰다고 화염구까지 막히면 안 된다 */
export function skillCooldown(world: World, id: string): number {
  return world.spell.cooldowns?.[id] ?? 0;
}

/** 시전 원점(눈)과 조준 방향 */
function aim(world: World): { ox: number; oy: number; oz: number; dx: number; dy: number; dz: number } {
  const p = world.player;
  const cosPitch = Math.cos(p.pitch);
  return {
    ox: p.x,
    oy: p.y + balance.player.eyeHeight,
    oz: p.z,
    dx: -Math.sin(p.yaw) * cosPitch,
    dy: Math.sin(p.pitch),
    dz: -Math.cos(p.yaw) * cosPitch,
  };
}

/** 스킬 퀵슬롯 index 의 액티브 스킬을 시전한다. 실패 사유는 cast_failed 로 알린다 */
function tryCast(world: World, slotIndex: number): void {
  const sigilId = world.skillSlots[slotIndex] ?? null;
  if (!sigilId) {
    world.events.emit('cast_failed', { reason: 'empty_slot', slot: slotIndex });
    return;
  }
  const def = sigilDef(sigilId);
  // 시전이 구현된 스킬만 나간다 — 데이터만 있는 스킬로 빈 투사체를 만들면 안 된다
  if (!def.cast) {
    world.events.emit('cast_failed', { reason: 'not_implemented', id: sigilId });
    return;
  }
  if (skillCooldown(world, sigilId) > 0) return; // 연타는 조용히 — 매번 뜨면 시끄럽다

  // 채널형(관통 뇌창)은 비용·쿨다운 규약이 다르다 — 마나는 한 타마다, 쿨다운은 끝날 때
  if (def.cast === 'beam') {
    startChannel(world, sigilId, def);
    return;
  }

  // 스킬이 manaCost 를 명시하면 그 값, 없으면 티어 기본값
  const cost =
    def.effects['manaCost'] ?? balance.spellCost[def.tier as keyof typeof balance.spellCost] ?? 0;
  if (world.mana.value < cost) {
    world.events.emit('cast_failed', { reason: 'no_mana', cost, current: world.mana.value });
    return;
  }

  world.mana.value -= cost;
  world.spell.cooldowns ??= {};
  world.spell.cooldowns[sigilId] = def.effects['cooldownTicks'] ?? 0;
  switch (def.cast) {
    case 'projectile':
      castProjectile(world, def.effects);
      break;
    case 'nova':
      castNova(world, def.effects);
      break;
    case 'icebolt':
      castIceBolt(world, def.effects);
      break;
    case 'blink':
      castBlink(world, def.effects);
      break;
  }
  world.events.emit('cast_spell', { sigil: sigilId, cost, cast: def.cast });
}

/** 폭발이 닿은 균열 벽(C)을 부순다 — 반경 안의 C 셀을 열고 붕괴 이벤트를 낸다.
 *  수류탄·화염구가 같이 쓴다. 폭발 1방이면 충분하다 (누적 없음) */
export function breakCrackWalls(world: World, x: number, z: number, radius: number): void {
  const level = world.level;
  const cs = level.cellSize;
  const cellRadius = Math.ceil(radius / cs);
  const centerCol = Math.floor(x / cs);
  const centerRow = Math.floor(z / cs);
  for (let row = centerRow - cellRadius; row <= centerRow + cellRadius; row++) {
    for (let col = centerCol - cellRadius; col <= centerCol + cellRadius; col++) {
      if (level.charAt(col, row) !== 'C') continue;
      const cx = (col + 0.5) * cs;
      const cz = (row + 0.5) * cs;
      if (Math.hypot(cx - x, cz - z) > radius + cs * 0.5) continue;
      level.openCell(col, row);
      world.events.emit('crack_wall_broken', { row, col, x: cx, z: cz });
    }
  }
}

/** 화염구 — 직선 투사체. 맞으면 터지고 화상을 남긴다 (explodeFireball) */
function castProjectile(world: World, effects: Record<string, number>): void {
  const { ox, oy, oz, dx, dy, dz } = aim(world);
  const speed = effects['speed'] ?? 20;
  world.projectiles.push({
    id: nextProjectileId++,
    owner: 'player',
    x: ox, y: oy, z: oz,
    prevX: ox, prevY: oy, prevZ: oz,
    vx: dx * speed, vy: dy * speed, vz: dz * speed,
    lifeTicks: effects['lifeTicks'] ?? 120,
    damage: effects['damage'] ?? 0,
    burnTicks: effects['burnTicks'] ?? 0,
    burnDamagePerTick: effects['burnDamagePerTick'] ?? 0,
    radius: effects['radius'] ?? 0.3,
    kind: 'fireball',
  });
}

/** 스킬 피해 — 처치면 spell_kill + enemy_died. 여러 시전이 같은 규약을 쓴다 */
function skillDamage(world: World, enemy: EnemyState, damage: number, source: string): void {
  if (enemy.ai === 'idle') enemy.ai = 'chase';
  // 서리 자신의 피해는 얼음을 깨지 않는다 — 다른 스킬(뇌창 등)은 깬다
  const dealt = source === 'frost' ? damage : applyFrostOnHit(world.events, enemy, damage);
  enemy.health -= dealt;
  world.events.emit('enemy_damaged', { enemyId: enemy.id, amount: dealt, source });
  // 피격음 — 맞은 적 코앞의 동료도 깬다. 등 뒤에서 쏴도 바로 옆 놈은 듣는다
  alertNearbyAt(world, enemy.x, enemy.z, balance.enemyAi.hitNoiseRadius, balance.enemyAi.noticeDelayTicks);
  if (enemy.health <= 0 && enemy.alive) {
    enemy.alive = false;
    world.events.emit('spell_kill', { enemyType: enemy.type, source });
    world.events.emit('enemy_died', { enemyType: enemy.type, x: enemy.x, z: enemy.z });
  }
}

/** 채널 시작 — 붙들고 있는 동안 pulseTicks 마다 한 타씩 나간다.
 *  마나는 한 타마다 깎이고, 쿨다운은 채널이 끝날 때 걸린다 (붙들고 있는 내내 쉬는 건 말이 안 된다) */
function startChannel(world: World, sigilId: string, def: SigilDef): void {
  if (world.spell.channel?.sigilId === sigilId) return; // 이미 뻗고 있다
  const cost = def.effects['manaCost'] ?? 0;
  if (world.mana.value < cost) {
    world.events.emit('cast_failed', { reason: 'no_mana', cost, current: world.mana.value });
    return;
  }
  world.spell.channel = { sigilId, pulse: 0 };
  // 시전음·연쇄 리셋은 채널당 한 번 — 한 타마다 울리면 기관총이 된다
  world.events.emit('cast_spell', { sigil: sigilId, cost, cast: def.cast, channel: true });
  firePulse(world, def);
}

/** 채널 한 타 — 마나를 깎고 피해를 넣은 뒤 다음 타까지의 간격을 잰다.
 *  빔이 뻗는 그림 자체는 매 틱이다 — 피해만 이 간격으로 들어간다 */
function firePulse(world: World, def: SigilDef): void {
  world.mana.value -= def.effects['manaCost'] ?? 0;
  castBeam(world, def.effects, true);
  const channel = world.spell.channel;
  if (channel) channel.pulse = Math.max(1, def.effects['pulseTicks'] ?? 6);
}

/** 붙들고 있는 동안만 이어진다 — 손을 떼거나, 마나가 마르거나, 경직·회피·방어에 걸리면 끊긴다 */
function tickChannel(world: World, heldSlot: number, canCast: boolean): void {
  const channel = world.spell.channel;
  if (!channel) return;
  const def = sigilDef(channel.sigilId);
  if (!canCast || heldSlot < 0 || world.skillSlots[heldSlot] !== channel.sigilId) {
    endChannel(world, 'released');
    return;
  }
  const cost = def.effects['manaCost'] ?? 0;
  if (world.mana.value < cost) {
    world.events.emit('cast_failed', { reason: 'no_mana', cost, current: world.mana.value });
    endChannel(world, 'no_mana');
    return;
  }
  if (channel.pulse > 0) channel.pulse--;
  if (channel.pulse <= 0) firePulse(world, def);
  else castBeam(world, def.effects, false); // 타 사이에도 빔은 붙어 있다 — 그림만 갱신
}

/** 채널을 끊는다. 여기서 비로소 쿨다운이 걸린다 — 일시정지·사망처럼 밖에서도 끊는다 */
export function endChannel(world: World, reason = 'released'): void {
  const channel = world.spell.channel;
  if (!channel) return;
  world.spell.channel = null;
  world.spell.cooldowns ??= {};
  world.spell.cooldowns[channel.sigilId] = sigilDef(channel.sigilId).effects['cooldownTicks'] ?? 0;
  world.events.emit('channel_ended', { sigil: channel.sigilId, reason });
}

/** 조준 보정 대상 — 조준선에서 maxDeg 안, 벽에 안 가린 적 중 가장 가까운 하나.
 *  정확히 겨누지 않아도 빔이 그쪽으로 휜다. 벽 너머로는 휘지 않는다 */
function assistTarget(
  world: World,
  ox: number,
  oz: number,
  hx: number,
  hz: number,
  range: number,
  maxDeg: number,
): EnemyState | null {
  if (maxDeg <= 0) return null;
  const minCos = Math.cos((maxDeg * Math.PI) / 180);
  let best: EnemyState | null = null;
  let bestDist = Infinity;
  for (const enemy of world.enemies) {
    if (!enemy.alive) continue;
    const rx = enemy.x - ox;
    const rz = enemy.z - oz;
    const dist = Math.hypot(rx, rz);
    if (dist < 0.001 || dist > range || dist >= bestDist) continue;
    if ((rx * hx + rz * hz) / dist < minCos) continue; // 조준 원뿔 밖
    if (!world.level.hasLineOfSight(ox, oz, enemy.x, enemy.z)) continue;
    best = enemy;
    bestDist = dist;
  }
  return best;
}

/** 연쇄가 옮겨붙는 대상 — 적과 폭발통을 가리지 않는다.
 *  통도 전기를 먹고(지져진 시간이 쌓인다) 그 자리에서 남에게 넘긴다 */
type ChainNode =
  | { kind: 'enemy'; enemy: EnemyState }
  | { kind: 'barrel'; barrel: BarrelState };

function nodeId(node: ChainNode): number {
  return node.kind === 'enemy' ? node.enemy.id : node.barrel.id;
}
function nodeX(node: ChainNode): number {
  return node.kind === 'enemy' ? node.enemy.x : node.barrel.x;
}
function nodeZ(node: ChainNode): number {
  return node.kind === 'enemy' ? node.enemy.z : node.barrel.z;
}
/** 번개가 옮겨붙는 높이 — 몸(통) 가운데 */
function nodeY(node: ChainNode): number {
  return node.kind === 'enemy'
    ? enemyDef(node.enemy.type).height * 0.55
    : balance.barrel.height * 0.6;
}

/** 연쇄 — 처음 맞은 대상을 기준으로 반경 chainRange 안에서 가장 가까운 순으로 옮겨붙는다.
 *  반경을 매번 새 대상 기준으로 재면 사슬이 맵 끝까지 뻗어 나가므로 기준은 하나로 고정한다.
 *  한 번 옮길 때마다 피해가 chainFalloff 배로 줄고, 벽에 가린 것과 이미 맞은 것은 건너뛴다.
 *  적의 방패도 마법 방어막도 사슬을 끊지 못한다 (전기다) — 방어막은 피해만 막고 전기는 거쳐 간다.
 *  통에 옮겨붙으면 피해 대신 지져진 시간이 쌓인다 — 계속 이어 대면 직격과 같은 1.5초에 터진다 */
function chainLightning(
  world: World,
  effects: Record<string, number>,
  origin: ChainNode,
  hitEnemies: Set<number>,
  hitBarrels: Set<number>,
): void {
  const chainRange = effects['chainRange'] ?? 0;
  if (chainRange <= 0) return;
  const falloff = effects['chainFalloff'] ?? 1;
  // 한 번 옮길 때 통이 먹는 시간 — 한 타 간격만큼. 초당 pulseTicks × 10 = 60틱이라
  // 사슬을 계속 대고 있으면 직접 지지는 것과 같은 속도로 찬다
  const zapPerLink = Math.max(1, effects['pulseTicks'] ?? 6);
  const links: { ax: number; ay: number; az: number; bx: number; by: number; bz: number }[] = [];
  const zapped: number[] = [];
  const shocked: number[] = [];
  const originX = nodeX(origin);
  const originZ = nodeZ(origin);
  let from = origin;
  let damage = (effects['damage'] ?? 0) * falloff; // 첫 전이부터 이미 한 번 깎인다

  for (;;) {
    // 아직 안 맞은 적·통을 한 줄로 놓고 그중 가장 가까운 하나를 고른다
    const candidates: ChainNode[] = [];
    for (const enemy of world.enemies) {
      if (enemy.alive && !hitEnemies.has(enemy.id)) candidates.push({ kind: 'enemy', enemy });
    }
    for (const barrel of world.barrels) {
      if (barrel.alive && !hitBarrels.has(barrel.id)) candidates.push({ kind: 'barrel', barrel });
    }
    const fromX = nodeX(from);
    const fromZ = nodeZ(from);
    let node: ChainNode | null = null;
    let nodeDist = Infinity;
    for (const candidate of candidates) {
      const x = nodeX(candidate);
      const z = nodeZ(candidate);
      if (Math.hypot(x - originX, z - originZ) > chainRange) continue;
      const dist = Math.hypot(x - fromX, z - fromZ);
      if (dist >= nodeDist) continue;
      if (!world.level.hasLineOfSight(fromX, fromZ, x, z)) continue;
      node = candidate;
      nodeDist = dist;
    }
    if (!node) break;

    let blocked = false;
    if (node.kind === 'enemy') {
      hitEnemies.add(nodeId(node));
      const def = enemyDef(node.enemy.type);
      // 마법 방어막은 피해를 막을 뿐 전기를 끊지는 못한다 — 사슬은 이 적을 거쳐 계속 간다
      if (def.magicBarrier?.blocksMagic && barrierUp(def, node.enemy)) {
        world.events.emit('barrier_blocked', { enemyId: node.enemy.id, kind: 'magic' });
        blocked = true;
      }
    } else {
      hitBarrels.add(nodeId(node));
    }

    links.push({
      ax: nodeX(from), ay: nodeY(from), az: nodeZ(from),
      bx: nodeX(node), by: nodeY(node), bz: nodeZ(node),
    });
    if (node.kind === 'enemy') {
      if (!blocked) {
        skillDamage(world, node.enemy, damage, 'lightning_chain');
        shockEnemy(world, node.enemy, zapPerLink, effects); // 통과 같은 셈법 — 초당 60틱
      }
      shocked.push(node.enemy.id); // 막혀도 몸에 전기는 흐른다
    } else {
      zapBarrel(world, node.barrel, zapPerLink);
      zapped.push(node.barrel.id);
    }
    damage *= falloff;
    from = node;
  }
  if (links.length > 0) world.events.emit('lightning_chain', { links, hits: shocked, barrels: zapped });
}

/** 적이 지져진 시간을 쌓는다 — 끊기지 않고 shockChargeTicks(2.5초) 이어지면 감전 경직.
 *  빙결과 같은 규약이라 하던 동작은 그대로 멈췄다가 풀리는 순간 이어진다.
 *  마법 방어막이 살아 있는 적은 전기를 흘려보낼 뿐 감전되지 않는다 */
function shockEnemy(
  world: World,
  enemy: EnemyState,
  ticks: number,
  effects: Record<string, number>,
): void {
  const need = effects['shockChargeTicks'] ?? 0;
  if (need <= 0) return;
  enemy.shockGrace = Math.max(1, effects['shockGraceTicks'] ?? 12);
  if ((enemy.shockTicks ?? 0) > 0) return; // 이미 떨고 있다 — 그 위에 겹쳐 쌓지 않는다
  enemy.shockCharge = (enemy.shockCharge ?? 0) + ticks;
  if (enemy.shockCharge < need) return;
  enemy.shockCharge = 0; // 풀리면 처음부터 다시 쌓아야 한다
  enemy.shockTicks = effects['shockTicks'] ?? 60;
  world.events.emit('enemy_shocked', {
    enemyId: enemy.id, enemyType: enemy.type, x: enemy.x, z: enemy.z, ticks: enemy.shockTicks,
  });
}

/** 통을 ticks 만큼 지진다 — 때리는 게 아니라 시간이 쌓이는 방식이라
 *  빔으로 직접 지지든 사슬이 옮겨붙든 같은 저금통에 들어간다 */
function zapBarrel(world: World, barrel: BarrelState, ticks: number): void {
  const need = balance.barrel.zapTicks;
  barrel.zapTicks = (barrel.zapTicks ?? 0) + ticks;
  world.events.emit('barrel_zapped', {
    id: barrel.id, x: barrel.x, z: barrel.z,
    ticks: barrel.zapTicks, needTicks: need,
  });
  if (barrel.zapTicks >= need && barrel.fuseTicks < 0) igniteBarrel(barrel);
}

/** 뻗어 있는 빔을 한 틱 갱신한다. 조준선 위의 적을 앞에서부터 pierce 명까지 꿰뚫고,
 *  벽·폭발통에서 멈추고, 마법 방어막에 막히면 거기서 끊긴다 (방패는 전기를 못 막는다).
 *  겨눈 방향에 아무도 없어도 aimAssistDeg 안에 적이 있으면 그쪽으로 휜다.
 *  damaging 이 false 면 어디까지 닿는지만 계산한다 — 피해는 pulseTicks 마다 한 번 */
function castBeam(world: World, effects: Record<string, number>, damaging = true): void {
  const { ox, oy, oz } = aim(world);
  const range = effects['range'] ?? 20;
  const width = effects['width'] ?? 0.5;

  let hx0 = -Math.sin(world.player.yaw);
  let hz0 = -Math.cos(world.player.yaw);
  // 위아래 기울기는 순전히 겨눈 각도다 — 보정은 좌우로만 휜다.
  // 세로까지 보정하면 가까운 적 가슴을 향하느라 빔이 그 뒤 바닥에 처박혀 관통이 죽는다
  const cosPitch = Math.max(0.2, Math.cos(world.player.pitch));
  const slopeY = Math.sin(world.player.pitch) / cosPitch;

  const target = assistTarget(world, ox, oz, hx0, hz0, range, effects['aimAssistDeg'] ?? 0);
  if (target) {
    const rx = target.x - ox;
    const rz = target.z - oz;
    const dist = Math.hypot(rx, rz);
    hx0 = rx / dist;
    hz0 = rz / dist;
  }

  // 빔이 어디서 멈추는가 — 벽·바닥·천장 중 가장 가까운 면. 무엇에도 안 닿으면 사거리 끝.
  // 바닥·천장을 안 보면 아래를 겨눴을 때 빔이 땅을 뚫고 들어간다
  const wall = world.level.wallRayHit(ox, oz, hx0, hz0);
  let maxT = range;
  let surface: 'wall' | 'floor' | 'ceiling' | null = null;
  let axis: 'x' | 'z' | null = null;
  if (wall.t > 0 && wall.t < maxT) {
    maxT = wall.t;
    surface = 'wall';
    axis = wall.axis;
  }
  if (slopeY < 0) {
    const t = oy / -slopeY;
    if (t < maxT) {
      maxT = t;
      surface = 'floor';
      axis = null;
    }
  } else if (slopeY > 0) {
    const t = (world.level.ceiling - oy) / slopeY;
    if (t < maxT) {
      maxT = t;
      surface = 'ceiling';
      axis = null;
    }
  }

  // 폭발통 — 빔은 통에 막혀 멈춘다 (총알과 같은 규약). 다만 때리는 게 아니라 지지는 거라
  // 한 방에 도화선이 짧아지지 않고, 닿아 있는 시간이 zapTicks 만큼 쌓여야 점화된다
  const bcfg = balance.barrel;
  let zapTarget: BarrelState | null = null;
  for (const barrel of world.barrels) {
    if (!barrel.alive) continue;
    const t = rayVsAabb(ox, oy, oz, hx0, slopeY, hz0, {
      minX: barrel.x - bcfg.collisionRadius,
      minY: 0,
      minZ: barrel.z - bcfg.collisionRadius,
      maxX: barrel.x + bcfg.collisionRadius,
      maxY: bcfg.height,
      maxZ: barrel.z + bcfg.collisionRadius,
    });
    if (t === null || t >= maxT) continue;
    maxT = t;
    surface = null; // 통에 막혔으니 그 뒤 벽은 안 그을린다
    axis = null;
    zapTarget = barrel;
  }
  // 매 틱 쌓는다 — 피해 타(pulse)와 무관하게 "닿아 있는 시간"이 기준이다
  if (zapTarget) zapBarrel(world, zapTarget, 1);

  const candidates: { enemy: EnemyState; t: number }[] = [];
  for (const enemy of world.enemies) {
    if (!enemy.alive) continue;
    const rx = enemy.x - ox;
    const rz = enemy.z - oz;
    const t = rx * hx0 + rz * hz0;
    if (t < 0 || t > maxT) continue;
    const perp = Math.abs(rx * hz0 - rz * hx0);
    if (perp > width + enemyDef(enemy.type).radius) continue;
    candidates.push({ enemy, t });
  }
  candidates.sort((a, b) => a.t - b.t);

  const hits: number[] = [];
  const struck: EnemyState[] = []; // 연쇄의 출발점이 될 "처음 맞은 적"을 알아야 한다
  /** 방어막에 막혔지만 전기는 통한 적 — 피해는 0 이어도 사슬의 시작점이 된다 */
  let conductor: EnemyState | null = null;
  const pierce = Math.max(1, effects['pierce'] ?? 1);
  for (const { enemy, t } of candidates) {
    if (hits.length >= pierce) break;
    // 나무·쇠 방패는 물리를 받아 내는 물건이라 전기는 그냥 타고 들어간다 — 뇌창은 방패를 무시한다.
    // 다만 마법 방어막(수호주술사)은 마법을 막는 물건이라 피해가 안 들어가고 빔도 여기서 멈춘다.
    // 그래도 전기는 통한다 — 막힌 그 자리를 시작점으로 옆으로 옮겨붙는다
    const def = enemyDef(enemy.type);
    if (def.magicBarrier?.blocksMagic && barrierUp(def, enemy)) {
      if (damaging) world.events.emit('barrier_blocked', { enemyId: enemy.id, kind: 'magic' });
      maxT = t; // 방어막이 빔을 받아 낸다 — 뒤의 적은 무사
      surface = null;
      axis = null;
      conductor = enemy;
      break;
    }
    if (damaging) skillDamage(world, enemy, effects['damage'] ?? 0, 'lightning');
    hits.push(enemy.id);
    struck.push(enemy);
    shockEnemy(world, enemy, 1, effects); // 닿아 있는 시간이 기준 — 타(pulse)와 무관하다
  }
  // 구울 머리 소품 — 빔 폭에 걸리면 지져 터진다 (스폰 직후 잠깐은 총과 같은 규약으로 무적)
  if (damaging && world.ghoulHeads?.length) {
    const hcfg = balance.ghoulHead;
    for (const head of [...world.ghoulHeads]) {
      if ((head.graceTicks ?? 0) > 0) continue;
      const rx = head.x - ox;
      const rz = head.z - oz;
      const t = rx * hx0 + rz * hz0;
      if (t < 0 || t > maxT) continue;
      if (Math.abs(rx * hz0 - rz * hx0) > width + hcfg.radius) continue;
      breakGhoulHead(world, head.id, false);
    }
  }

  // 연쇄 — 처음 맞은 대상을 기준으로 옮겨붙는다. 적을 못 맞히고 통에서 멈춘 빔이면
  // 그 통이 시작점이다 (통에 쏴서 주변 적을 지지는 쓰임)
  if (damaging) {
    const zappedBarrels = new Set<number>();
    if (zapTarget) zappedBarrels.add(zapTarget.id);
    const hitEnemies = new Set(hits);
    if (conductor) hitEnemies.add(conductor.id); // 다시 노릴 대상은 아니다
    const origin: ChainNode | null = struck[0]
      ? { kind: 'enemy', enemy: struck[0] }
      : conductor
        ? { kind: 'enemy', enemy: conductor }
        : zapTarget
          ? { kind: 'barrel', barrel: zapTarget }
          : null;
    if (origin) chainLightning(world, effects, origin, hitEnemies, zappedBarrels);
  }
  // 매 틱 나간다 — 렌더는 이걸 받아 빔을 붙여 두고, pulse 인 틱에만 밝게 튄다
  world.events.emit('lightning_beam', {
    sx: ox, sy: oy, sz: oz,
    ex: ox + hx0 * maxT, ey: oy + slopeY * maxT, ez: oz + hz0 * maxT,
    hits, assisted: target !== null, pulse: damaging,
    surface, axis, dx: hx0, dz: hz0,
  });
}

/** 서리 볼트(icebolt) — 얼음 화살을 쏜다. 무엇에 닿든 그 자리에서 frostBurst 가 터진다.
 *  직격 피해는 없다 — 피해는 광역 빙결이 깨질 때 들어간다 */
function castIceBolt(world: World, effects: Record<string, number>): void {
  const { ox, oy, oz, dx, dy, dz } = aim(world);
  const speed = effects['speed'] ?? 30;
  world.projectiles.push({
    id: nextProjectileId++,
    owner: 'player',
    x: ox, y: oy, z: oz,
    prevX: ox, prevY: oy, prevZ: oz,
    vx: dx * speed, vy: dy * speed, vz: dz * speed,
    lifeTicks: effects['lifeTicks'] ?? 90,
    damage: 0,
    burnTicks: 0,
    burnDamagePerTick: 0,
    radius: effects['boltRadius'] ?? 0.2,
    kind: 'frost',
  });
}

/** 서리 — 내 주위에서 터지는 옛 방식 (데이터가 cast: nova 를 쓰면 이쪽) */
function castNova(world: World, effects: Record<string, number>): void {
  frostBurst(world, world.player.x, world.player.z, effects);
}

/** 서리 볼트의 실체 — (cx,cz) 주위 radius 안, 벽에 가리지 않은 적에게 서리를 한 겹 쌓는다.
 *  피해는 겹마다 damageFirst + damageStep×(겹-1) 을 즉시 받고(damageCapStack 에서 멈춤), 겹 수에 따라: 1 = 약한 둔화 / 2 = 완전 둔화 /
 *  3 = 빙결(깨질 때 breakDamage 한 번 더) / 4+ = 빙결 freezeExtraTicks 씩 연장.
 *  겹은 둔화가 다 풀리면(Enemies) 0 으로 돌아간다.
 *  이펙트 크기(scale)는 연속 시전 수로 정한다 — 첫 타는 작게, 둘째부터 제 크기 */
function frostBurst(world: World, cx: number, cz: number, effects: Record<string, number>): number {
  const radius = effects['radius'] ?? 5;
  const slowed: number[] = [];
  const frozen: number[] = [];
  for (const enemy of world.enemies) {
    if (!enemy.alive) continue;
    if (Math.hypot(enemy.x - cx, enemy.z - cz) > radius) continue;
    if (!world.level.hasLineOfSight(cx, cz, enemy.x, enemy.z)) continue;
    const stacks = (enemy.frostStacks ?? 0) + 1;
    enemy.frostStacks = stacks;
    // 겹마다 damageStep 씩 세진다 — damageCapStack 겹에서 멈춘다 (4·6·8·10, 그 뒤 10)
    const capped = Math.min(stacks, effects['damageCapStack'] ?? stacks);
    const damage = (effects['damageFirst'] ?? 0) + (capped - 1) * (effects['damageStep'] ?? 0);
    if (stacks >= 3) {
      const freeze = (effects['freezeTicks'] ?? 0) + (stacks - 3) * (effects['freezeExtraTicks'] ?? 0);
      // 겹이 쌓여도 freezeMaxTicks 를 넘지 않는다 — 계속 얼려 두는 건 없다
      enemy.freezeTicks = Math.min(effects['freezeMaxTicks'] ?? Infinity, Math.max(enemy.freezeTicks ?? 0, freeze));
      enemy.slowTicks = Math.max(enemy.slowTicks ?? 0, enemy.freezeTicks + (effects['afterFreezeSlowTicks'] ?? 0));
      enemy.slowMul = effects['slowMul'] ?? 0.5;
      enemy.frozenDamage = effects['breakDamage'] ?? damage; // 깨질 때 한 번 — 겹이 쌓여도 같다
      frozen.push(enemy.id);
      // 얼어붙는 순간(연장 포함) — 적마다 연출이 붙는다
      world.events.emit('enemy_frozen', { enemyId: enemy.id, enemyType: enemy.type, x: enemy.x, z: enemy.z, stacks });
    } else {
      enemy.slowTicks = Math.max(enemy.slowTicks ?? 0, effects['slowTicks'] ?? 0);
      enemy.slowMul = stacks === 1 ? (effects['slowMulLight'] ?? 0.7) : (effects['slowMul'] ?? 0.5);
    }
    slowed.push(enemy.id);
    world.events.emit('enemy_slowed', { enemyId: enemy.id, ticks: enemy.slowTicks, stacks });
    if (damage > 0) skillDamage(world, enemy, damage, 'frost'); // 겹이 쌓일수록 아프다
  }
  // 연속 시전 — 창 안에 이어지면 겹, 아니면 처음부터
  const combo = world.frostCombo;
  combo.count = world.tick - combo.lastTick <= (effects['comboWindowTicks'] ?? 0) ? combo.count + 1 : 1;
  combo.lastTick = world.tick;
  const scale = combo.count === 1 ? (effects['firstHitFxScale'] ?? 1) : 1;
  world.events.emit('frost_nova', { x: cx, z: cz, radius, slowed, frozen, scale, combo: combo.count });
  return scale;
}

/** 그림자 이동 — 보는 방향으로 range 까지 순간이동. 벽에 막히면 그 앞에서 멈춘다.
 *  잠깐 무적이라 포위를 빠져나가는 용도다 */
function castBlink(world: World, effects: Record<string, number>): void {
  const p = world.player;
  const hx = -Math.sin(p.yaw);
  const hz = -Math.cos(p.yaw);
  const range = effects['range'] ?? 10;
  const step = balance.skills.blinkStep;
  const fromX = p.x;
  const fromZ = p.z;
  let travelled = 0;
  while (travelled < range) {
    const len = Math.min(step, range - travelled);
    const bx = p.x;
    const bz = p.z;
    world.level.slideMove(p, balance.player.radius, hx * len, hz * len);
    const moved = Math.hypot(p.x - bx, p.z - bz);
    if (moved < len * 0.5) break; // 벽 — 더 못 간다
    travelled += len;
  }
  // 보간 잔상 방지 — 이전 위치도 도착점으로 맞춘다 (렌더가 prev→now 를 섞는다)
  p.prevX = p.x;
  p.prevZ = p.z;
  p.iframeTicks = Math.max(p.iframeTicks, effects['iframeTicks'] ?? 0);
  world.events.emit('blink', { fromX, fromZ, toX: p.x, toZ: p.z, distance: travelled });
}

/** 부순 적 투사체를 배열에서 뺀다. 자기 자신을 먼저 지운 뒤 호출해야 한다 —
 *  뒤에서 앞으로 도는 루프라 아래쪽 원소가 빠지면 남은 인덱스가 당겨진다.
 *  다음 회차가 배열 밖을 보거나 하나를 건너뛰지 않게 맞춘 인덱스를 돌려준다 */
function removeBroken(world: World, broken: ProjectileState | null, i: number): number {
  if (!broken) return i;
  const j = world.projectiles.indexOf(broken);
  if (j >= 0) world.projectiles.splice(j, 1);
  return Math.min(i, world.projectiles.length);
}

function moveProjectiles(world: World, dt: number): void {
  const level = world.level;
  for (let i = world.projectiles.length - 1; i >= 0; i--) {
    const proj = world.projectiles[i]!;
    proj.prevX = proj.x;
    proj.prevY = proj.y;
    proj.prevZ = proj.z;

    proj.lifeTicks--;
    if (proj.lifeTicks <= 0) {
      // 얼음 화살은 힘이 다해 떨어지는 자리에서도 터진다
      if (proj.kind === 'frost' && proj.owner === 'player') {
        frostBurst(world, proj.x, proj.z, sigilDef('sig_frost').effects);
      }
      if (proj.kind === 'grenade') explodeGrenade(world, proj); // 신관 만료
      world.projectiles.splice(i, 1);
      continue;
    }

    if (proj.kind === 'grenade') proj.vy -= balance.weapons.grenade.gravity * dt; // 포물선

    const stepX = proj.vx * dt;
    const stepY = proj.vy * dt;
    const stepZ = proj.vz * dt;
    const stepLen = Math.hypot(stepX, stepY, stepZ);
    const dirX = stepX / stepLen;
    const dirY = stepY / stepLen;
    const dirZ = stepZ / stepLen;

    // 이번 틱 이동 구간의 가장 가까운 충돌 (벽/바닥/천장/표적).
    // 수류탄은 무엇에 맞았는지로 튕길지 터질지가 갈리므로 종류를 따로 들고 간다
    const wall = level.wallRayHit(proj.x, proj.z, dirX, dirZ);
    let hitT = wall.t;
    let hitSurface: 'wall' | 'floor' | 'ceiling' = 'wall';
    if (dirY < 0) {
      const t = proj.y / -dirY;
      if (t < hitT) {
        hitT = t;
        hitSurface = 'floor';
      }
    } else if (dirY > 0) {
      const t = (level.ceiling - proj.y) / dirY;
      if (t < hitT) {
        hitT = t;
        hitSurface = 'ceiling';
      }
    }
    let hitEnemy: (typeof world.enemies)[number] | null = null;
    let hitPlayer = false;

    // 폭발통 — 플레이어 투사체만 반응한다. 화염구가 통에 닿으면 즉발,
    // 수류탄은 통에 부딪혀 터지고(바닥 규칙과 별개) 그 폭풍이 통을 잇는다
    let hitBarrelTarget: BarrelState | null = null;
    if (proj.owner === 'player') {
      const bcfg = balance.barrel;
      for (const barrel of world.barrels) {
        if (!barrel.alive) continue;
        const t = rayVsAabb(proj.x, proj.y, proj.z, dirX, dirY, dirZ, {
          minX: barrel.x - bcfg.collisionRadius - proj.radius,
          minY: -proj.radius,
          minZ: barrel.z - bcfg.collisionRadius - proj.radius,
          maxX: barrel.x + bcfg.collisionRadius + proj.radius,
          maxY: bcfg.height + proj.radius,
          maxZ: barrel.z + bcfg.collisionRadius + proj.radius,
        });
        if (t !== null && t < hitT) {
          hitT = t;
          hitBarrelTarget = barrel;
          hitSurface = 'wall'; // 수류탄은 벽처럼 취급하지 않는다 — 아래에서 따로 가른다
        }
      }
    }

    // 기믹 — 플레이어 투사체가 부순다 (통과 같은 규약, 석관은 2방)
    let hitPropTarget: PropState | null = null;
    if (proj.owner === 'player') {
      const ptypes = balance.props.types as Record<
        string,
        { hp: number; collisionRadius: number; height: number }
      >;
      for (const prop of world.props) {
        if (!prop.alive) continue;
        const pcfg = ptypes[prop.type];
        if (!pcfg) continue;
        const t = rayVsAabb(proj.x, proj.y, proj.z, dirX, dirY, dirZ, {
          minX: prop.x - pcfg.collisionRadius - proj.radius,
          minY: -proj.radius,
          minZ: prop.z - pcfg.collisionRadius - proj.radius,
          maxX: prop.x + pcfg.collisionRadius + proj.radius,
          maxY: pcfg.height + proj.radius,
          maxZ: prop.z + pcfg.collisionRadius + proj.radius,
        });
        if (t !== null && t < hitT) {
          hitT = t;
          hitPropTarget = prop;
          hitSurface = 'wall';
        }
      }
    }

    // 튀는 구울 머리 — 화살이 맞으면 터진다
    let hitHead: number | null = null;
    // 플레이어 투사체는 종류를 가리지 않고 머리 소품을 맞힌다 — 화살·화염구·서리 공통
    if (proj.owner === 'player' && world.ghoulHeads?.length) {
      const hcfg = balance.ghoulHead;
      for (const head of world.ghoulHeads) {
        if ((head.graceTicks ?? 0) > 0) continue; // 갓 날아가는 중
        const pad = hcfg.radius + proj.radius;
        const t = rayVsAabb(proj.x, proj.y, proj.z, dirX, dirY, dirZ, {
          minX: head.x - pad,
          minY: head.y - pad,
          minZ: head.z - pad,
          maxX: head.x + pad,
          maxY: head.y + pad,
          maxZ: head.z + pad,
        });
        if (t !== null && t < hitT) {
          hitT = t;
          hitHead = head.id;
          hitBarrelTarget = null; // 머리가 통보다 앞이다
        }
      }
    }

    // 부술 수 있는 적 투사체 — 화염구·수류탄이 공중에서 맞히면 함께 사라진다.
    // 히트스캔인 총알은 이 경로를 타지 않는다 (Weapons 는 투사체를 만들지 않는다)
    let hitProjectile: ProjectileState | null = null;
    if (proj.owner === 'player') {
      for (const other of world.projectiles) {
        if (other === proj || other.owner !== 'enemy' || !other.breakable) continue;
        const pad = proj.radius + other.radius;
        const t = rayVsAabb(proj.x, proj.y, proj.z, dirX, dirY, dirZ, {
          minX: other.x - pad,
          minY: other.y - pad,
          minZ: other.z - pad,
          maxX: other.x + pad,
          maxY: other.y + pad,
          maxZ: other.z + pad,
        });
        if (t !== null && t < hitT) {
          hitT = t;
          hitProjectile = other;
          hitBarrelTarget = null; // 돌이 통보다 앞이다
          hitHead = null;
        }
      }
    }

    if (proj.owner === 'player') {
      for (const enemy of world.enemies) {
        if (!enemy.alive) continue;
        const def = enemyDef(enemy.type);
        const pad = proj.radius;
        // 공중의 적(천장 거머리·도약 중) — 몸이 뜬 만큼(jumpY) 피격 박스도 떠 있어야 맞는다
        const yBase = enemy.jumpY ?? 0;
        const t = rayVsAabb(proj.x, proj.y, proj.z, dirX, dirY, dirZ, {
          minX: enemy.x - def.radius - pad,
          minY: yBase - pad,
          minZ: enemy.z - def.radius - pad,
          maxX: enemy.x + def.radius + pad,
          maxY: yBase + def.height + pad,
          maxZ: enemy.z + def.radius + pad,
        });
        if (t !== null && t < hitT) {
          hitT = t;
          hitEnemy = enemy;
          hitBarrelTarget = null; // 적이 통보다 앞이다
          hitHead = null;
          hitProjectile = null;
        }
      }
    } else {
      // 동료 오사 — 시전자를 제외한 다른 적의 몸에 막힌다. 사선이 막힌 궁수는 아군을 쏜다
      for (const enemy of world.enemies) {
        if (!enemy.alive || enemy.id === proj.casterId) continue;
        const def = enemyDef(enemy.type);
        const pad = proj.radius;
        const t = rayVsAabb(proj.x, proj.y, proj.z, dirX, dirY, dirZ, {
          minX: enemy.x - def.radius - pad,
          minY: -pad,
          minZ: enemy.z - def.radius - pad,
          maxX: enemy.x + def.radius + pad,
          maxY: def.height + pad,
          maxZ: enemy.z + def.radius + pad,
        });
        if (t !== null && t < hitT) {
          hitT = t;
          hitEnemy = enemy;
        }
      }

      const p = world.player;
      const r = balance.player.radius + proj.radius;
      const t = rayVsAabb(proj.x, proj.y, proj.z, dirX, dirY, dirZ, {
        minX: p.x - r,
        minY: -proj.radius,
        minZ: p.z - r,
        maxX: p.x + r,
        maxY: balance.player.height + proj.radius,
        maxZ: p.z + r,
      });
      if (t !== null && t < hitT) {
        hitT = t;
        hitPlayer = true;
        hitEnemy = null; // 적보다 플레이어가 앞
      }
    }

    if (hitT <= stepLen) {
      // 부순 적 투사체 — 화염구든 수류탄이든 같은 취급. 알리는 건 여기서 한 번만
      if (hitProjectile) {
        world.events.emit('projectile_broken', {
          x: hitProjectile.x,
          y: hitProjectile.y,
          z: hitProjectile.z,
          kind: hitProjectile.kind,
          radius: hitProjectile.radius,
        });
      }

      // 수류탄 — 벽·천장은 튕기고, 바닥에 닿거나 몸(·폭발통·부술 것)에 맞으면 터진다
      if (proj.kind === 'grenade') {
        proj.x += dirX * hitT;
        proj.y += dirY * hitT;
        proj.z += dirZ * hitT;
        const bodyHit =
          hitEnemy !== null || hitPlayer || hitBarrelTarget !== null || hitPropTarget !== null || hitProjectile !== null || hitHead !== null;
        // 금 간 벽(C)에는 튕기지 않고 부딪히는 즉시 터진다 — 튕기는 수류탄으로
        // 균열 벽을 맞히기가 고역이라, 벽 쪽이 받아 준다
        if (!bodyHit && hitSurface === 'wall') {
          const wallCol = Math.floor((proj.x + dirX * hitT + dirX * 0.05) / level.cellSize);
          const wallRow = Math.floor((proj.z + dirZ * hitT + dirZ * 0.05) / level.cellSize);
          if (level.charAt(wallCol, wallRow) === 'C') {
            proj.x += dirX * hitT;
            proj.y += dirY * hitT;
            proj.z += dirZ * hitT;
            explodeGrenade(world, proj);
            world.projectiles.splice(i, 1);
            i = removeBroken(world, hitProjectile, i);
            continue;
          }
        }
        if (!bodyHit && (hitSurface === 'wall' || hitSurface === 'ceiling')) {
          if (bounceGrenade(world, proj, hitSurface, wall.axis, dirX, dirY, dirZ)) continue;
        }
        explodeGrenade(world, proj);
        world.projectiles.splice(i, 1);
        i = removeBroken(world, hitProjectile, i);
        continue;
      }
      // 폭발통에 꽂혔다 — 마법·화염구는 즉발이다 (총·해머의 누적 규칙과 다르다)
      if (hitHead !== null) {
        breakGhoulHead(world, hitHead, false);
        world.events.emit('arrow_impact', {
          x: proj.x + dirX * hitT, y: proj.y + dirY * hitT, z: proj.z + dirZ * hitT, hitEnemy: true,
        });
        world.projectiles.splice(i, 1);
        continue;
      }

      if (hitPropTarget) {
        const ptypes = balance.props.types as Record<string, { hp: number }>;
        damageProp(world, hitPropTarget, ptypes[hitPropTarget.type]?.hp ?? 1);
        world.events.emit(proj.kind === 'arrow' ? 'arrow_impact' : 'spell_impact', {
          x: proj.x + dirX * hitT, y: proj.y + dirY * hitT, z: proj.z + dirZ * hitT, hitEnemy: true,
        });
        world.projectiles.splice(i, 1);
        continue;
      }

      if (hitBarrelTarget) {
        const bx = proj.x + dirX * hitT;
        const by = proj.y + dirY * hitT;
        const bz = proj.z + dirZ * hitT;
        if (proj.kind === 'arrow') {
          // 화살은 통을 한 방에 터뜨린다 (weapons.bow.ignitesBarrel).
          // false 로 두면 총알·해머와 같은 누적 규칙으로 돌아간다
          if (balance.weapons.bow.ignitesBarrel) {
            igniteBarrel(hitBarrelTarget);
          } else {
            hitBarrel(hitBarrelTarget, balance.barrel.fuseByHits);
            world.events.emit('barrel_hit', {
              id: hitBarrelTarget.id,
              hits: hitBarrelTarget.hits,
              fuseTicks: hitBarrelTarget.fuseTicks,
              x: hitBarrelTarget.x,
              z: hitBarrelTarget.z,
            });
          }
          world.events.emit('arrow_impact', { x: bx, y: by, z: bz, hitEnemy: true });
          // 통에 박힌 화살은 곧 폭발에 휩쓸린다 — 회수 대상이 아니다
        } else {
          igniteBarrel(hitBarrelTarget);
          world.events.emit('spell_impact', { x: bx, y: by, z: bz, hitEnemy: true });
          // 얼음 화살 — 통도 터지지만 그 자리에서 서리 볼트도 같이 터진다.
          // 얼어 선 적들이 그 자리에서 폭발을 맞는 조합이다 (Barrels 는 이 뒤에 돈다)
          if (proj.kind === 'frost' && proj.owner === 'player') {
            const fx = sigilDef('sig_frost').effects;
            const scale = frostBurst(world, bx, bz, fx);
            world.events.emit('frost_impact', {
              x: hitBarrelTarget.x, y: 0, z: hitBarrelTarget.z,
              surface: 'floor', axis: null, dirX, dirY, dirZ, scale,
            });
          }
        }
        world.projectiles.splice(i, 1);
        continue;
      }

      // 얼음 화살 — 무엇에 닿든 그 자리에서 광역 서리. 직격 피해는 없다 (피해는 광역으로).
      // 착탄 이벤트보다 먼저 — 이펙트 크기(연속 시전 수)를 자국 이벤트에 실어야 한다
      let frostFxScale = 1;
      if (proj.kind === 'frost' && proj.owner === 'player') {
        // 폭발 중심은 닿은 지점에서 날아온 쪽으로 조금 물린다 — 벽 경계에 딱 놓으면 중심이
        // 벽 셀 안에 들어가 모든 적에게 시야 판정이 실패한다 (실측: 28.00 에서 아무도 안 얼었다)
        const fx = sigilDef('sig_frost').effects;
        const back = fx['burstPullback'] ?? 0.3;
        frostFxScale = frostBurst(world, proj.x + dirX * (hitT - back), proj.z + dirZ * (hitT - back), fx);
      }

      // 착탄 — 화살은 마법 착탄음(spell_impact)이 아니라 제 소리를 낸다.
      // 이 갈래가 없으면 적 궁수의 화살까지 무음이 된다
      const impact = {
        x: proj.x + dirX * hitT,
        y: proj.y + dirY * hitT,
        z: proj.z + dirZ * hitT,
        hitEnemy: hitEnemy !== null || hitPlayer || hitProjectile !== null,
      };
      // 허공이 아니라 무언가에 닿았다 — 착탄 연출이 붙어야 한다
      world.events.emit(proj.kind === 'arrow' ? 'arrow_impact' : 'spell_impact', impact);
      // 얼음 화살 — 벽·바닥·천장에 닿았으면 그 면이, 적을 맞혔으면 그 적의 발밑 바닥이 얼어붙는다
      if (proj.kind === 'frost' && proj.owner === 'player') {
        if (hitEnemy) {
          world.events.emit('frost_impact', {
            x: hitEnemy.x, y: 0, z: hitEnemy.z,
            surface: 'floor', axis: null, dirX, dirY, dirZ, scale: frostFxScale,
          });
        } else if (!impact.hitEnemy) {
          world.events.emit('frost_impact', {
            x: impact.x, y: impact.y, z: impact.z,
            surface: hitSurface,
            axis: wall.axis,
            dirX, dirY, dirZ, scale: frostFxScale,
          });
        }
      }

      // 벽·바닥에 꽂힌 화살은 누가 쐈든 못 뽑는다 — 박힌 채로 남기만 한다.
      // 회수는 적을 맞힌 화살에서만 나온다 (한 마리당 한 대)
      if (proj.kind === 'arrow' && !hitEnemy && !hitPlayer) {
        world.events.emit('arrow_stuck', {
          x: proj.x + dirX * hitT,
          y: proj.y + dirY * hitT,
          z: proj.z + dirZ * hitT,
          dx: dirX,
          dy: dirY,
          dz: dirZ,
        });
      }

      // 방패 판정은 폭발보다 먼저 확정한다 — 폭풍/흡인이 kbTicks 를 세우면
      // "밀리는 중이라 가드가 풀렸다"로 오판해 화염구가 방패를 못 깨게 된다
      const shieldedAtImpact =
        hitEnemy !== null && shieldBlocksProjectile(enemyDef(hitEnemy.type), hitEnemy, proj.x, proj.z);

      // 화염구는 무엇에 닿든 그 자리에서 터진다 (벽·바닥·적 모두)
      if (proj.kind === 'fireball' && proj.owner === 'player') {
        explodeFireball(
          world,
          proj,
          proj.x + dirX * hitT,
          proj.y + dirY * hitT,
          proj.z + dirZ * hitT,
          hitEnemy,
        );
      }

      // 광역 효과를 든 투사체(수호주술사 마법탄)는 그 자리에서 내파한다.
      // 직격 밀림보다 먼저 걸어야 한다 — 직격이면 밀림이 이 당김을 덮어써야 하므로
      if (proj.splash) {
        implodeBolt(
          world,
          proj,
          proj.x + dirX * hitT,
          proj.y + dirY * hitT,
          proj.z + dirZ * hitT,
          hitEnemy,
          hitPlayer,
        );
      }

      if (hitPlayer) {
        const p = world.player;
        if (p.iframeTicks <= 0) {
          // 방어(정면) — 투사체는 종류별 칩 비율. 화살은 방패가 완전 차단(비율 0)
          const blocked = playerBlocks(world, proj.x, proj.z, balance.block.arcDeg);
          const chipRatio =
            (balance.block.chipRatioByKind as Record<string, number>)[proj.kind ?? ''] ??
            balance.block.chipDamageRatio;
          const damage = blocked ? proj.damage * chipRatio : proj.damage;
          p.health -= damage;

          // 뒤로 밀림 — 날아온 방향으로. 마법이 가장 세고 화살은 거의 없다
          const kb = balance.playerKnockback as unknown as Record<string, number>;
          // 방어 감쇠는 종류별 예외를 먼저 본다 — 던진 바위는 방패로 받아도 그대로 민다
          const byKind = balance.playerKnockback.blockedMulByKind as Record<string, number>;
          const blockedMul = byKind[proj.kind ?? ''] ?? kb['blockedMul']!;
          const push = (kb[proj.kind ?? 'arrow'] ?? kb['arrow']!) * (blocked ? blockedMul : 1);
          pushPlayer(p, dirX, dirZ, push, balance.playerKnockback.ticks);

          if (blocked) world.events.emit('block_hit', { amount: damage, kind: proj.kind });
          // 거미줄 — 막아도 들러붙는다. 방패로는 끈끈이를 못 막는다
          if (proj.appliesWeb) {
            p.webSwingsLeft = balance.web.breakSwings;
            world.events.emit('web_caught', { swings: p.webSwingsLeft });
          }
          // 출처 방향 = 날아온 방향의 반대 — 투사체는 이미 몸에 닿아 있어 속도로 되짚는다
          world.events.emit('player_damaged', {
            amount: damage, health: p.health, blocked,
            srcX: p.x - proj.vx, srcZ: p.z - proj.vz,
          });
          if (p.health <= 0) {
            p.health = 0;
            world.dead = true;
            world.events.emit('player_died', { tick: world.tick });
          }
        }
      } else if (hitEnemy && proj.kind !== 'frost') {
        // 착탄 높이를 넘긴다 — 화살 헤드샷 판정 (얼음 화살은 위에서 터졌다)
        applyProjectileHit(world, proj, hitEnemy, shieldedAtImpact, proj.y + dirY * hitT);
      }
      world.projectiles.splice(i, 1);
      i = removeBroken(world, hitProjectile, i);
      continue;
    }

    proj.x += stepX;
    proj.y += stepY;
    proj.z += stepZ;
  }
}

/** 회수 가능한 화살 한 대를 바닥에 남긴다.
 *  부러짐 판정은 여기서 하지 않는다 — 줍는 순간에 굴려야 "왜 안 늘었지"를
 *  안내로 설명할 수 있다. 여기서 굴리면 화살이 애초에 안 생겨 보이지도 않는다 */
let nextArrowItemId = 600000; // 처치 드랍(500000~)과 가방 버리기(700000~) 사이
function dropArrow(world: World, x: number, z: number, scatter = false): void {
  const cfg = balance.pickups.arrow;
  // 적에게서 떨어진 화살은 처치 드랍(골드·물약)과 같은 점에 놓이므로 흩는다
  const angle = scatter ? Math.random() * Math.PI * 2 : 0;
  const r = scatter ? cfg.scatterRadius : 0;
  world.groundItems.push({
    id: nextArrowItemId++,
    kind: 'arrow',
    amount: 1,
    x: x + Math.cos(angle) * r,
    z: z + Math.sin(angle) * r,
    // 코앞에서 쏘면 뽑기도 전에 빨려 들어가 회수가 순간이동으로 보인다
    noMagnetTicks: cfg.noMagnetTicks,
  });
}

function applyProjectileHit(
  world: World,
  proj: (typeof world.projectiles)[number],
  enemy: (typeof world.enemies)[number],
  /** 착탄 순간의 방패 상태. 폭발이 상태를 바꾸기 전에 확정해 넘긴다 */
  shielded: boolean,
  /** 착탄 높이(y) — 화살 헤드샷 판정에 쓴다 */
  impactY = 0,
): void {
  const def = enemyDef(enemy.type);
  // 화살 헤드샷 — 부위 경계는 권총과 같은 값(hitZones.headFrac)을 쓴다.
  // 피해 보정은 없다 (활은 당김이 아니라 자리로 승부하는 무기가 아니다) — 연출·판정만
  const headHit =
    proj.kind === 'arrow' &&
    proj.owner === 'player' &&
    impactY / def.height >= balance.weapons.pistol.hitZones.headFrac;
  if (headHit) world.events.emit('headshot', { enemyId: enemy.id });

  // 정면 방패 — 화염구가 명중하면 방패가 부서진다. 방패가 화염을 일부 먹으므로 피해 감소
  if (shielded) {
    if (proj.kind === 'fireball') {
      enemy.shieldBroken = true;
      proj.damage *= balance.shieldBreak.damageRatio;
      world.events.emit('shield_broken', {
        enemyId: enemy.id,
        enemyType: enemy.type,
        x: enemy.x,
        z: enemy.z,
      });
    } else {
      // 그 외 투사체(반사된 마법 등)는 방패에 막힌다.
      // 화살은 방패에 그대로 꽂힌다 — 판에 박힌 것이라 뽑아 쓸 수 없다.
      // "방패를 쏘면 화살을 잃는다"가 곧 정면을 피할 이유가 된다
      if (proj.kind === 'arrow') {
        world.events.emit('arrow_shielded', {
          enemyId: enemy.id,
          enemyType: enemy.type,
          x: enemy.x,
          z: enemy.z,
        });
      }
      world.events.emit('barrier_blocked', { enemyId: enemy.id, kind: 'shield' });
      return;
    }
  }

  // 마법 방어막(warden) — 반사된 투사체가 아니면 무효 (7.2 피드백)
  if (def.magicBarrier?.blocksMagic && barrierUp(def, enemy) && !proj.deflected) {
    world.events.emit('barrier_blocked', { enemyId: enemy.id, kind: 'magic' });
    return;
  }
  // 동료 오사는 위력이 줄어든다 — 사고로 보이되 한 방에 죽지는 않게
  const damage =
    proj.owner === 'enemy' ? proj.damage * balance.enemyAi.friendlyFireDamageMul : proj.damage;
  enemy.health -= applyFrostOnHit(world.events, enemy, damage);
  enemy.burnTicks = Math.max(enemy.burnTicks, proj.burnTicks);
  if (proj.burnDamagePerTick > 0) enemy.burnDamagePerTick = proj.burnDamagePerTick;
  // 맞은 화살은 그 자리에 떨어진다 (적이 죽어도 시체 자리에 남는다).
  // 단 한 마리가 내주는 건 한 대까지다 — 몇 대를 박아 죽였든 회수는 하나.
  // 안 그러면 체력 높은 적이 화살 무한 순환 장치가 된다
  if (proj.recoverable && !enemy.arrowDropped) {
    enemy.arrowDropped = true;
    // 처치 드랍도 같은 점에 쏟아지므로 조금 흩어 놓는다
    dropArrow(world, enemy.x, enemy.z, true);
  }
  // 맞았으면 깬다 — 활은 소리가 작을 뿐(noiseRadius 4) 맞은 놈까지 자면 곤란하다.
  // 피격음은 맞은 적 코앞(hitNoiseRadius)의 동료도 깨운다
  if (proj.owner === 'player') {
    if (enemy.health > 0 && enemy.ai === 'idle') {
      alertEnemy(enemy, balance.enemyAi.noticeDelayTicks);
      world.events.emit('enemy_alerted', { enemyId: enemy.id, enemyType: enemy.type });
    }
    alertNearbyAt(world, enemy.x, enemy.z, balance.enemyAi.hitNoiseRadius, balance.enemyAi.noticeDelayTicks);
  }
  if (enemy.health <= 0) {
    enemy.alive = false;
    if (proj.owner === 'player') {
      // 활은 마법이 아니라 무기다 — 여기서 안 가르면 활 처치가 마법 처치로 집계된다.
      // 어느 쪽이든 마나는 0 이다 (Mana 는 두 이벤트를 모두 구독하지 않는다)
      if (proj.kind === 'arrow') {
        world.events.emit('weapon_kill', { weapon: 'bow', enemyType: enemy.type });
        if (headHit) {
          // 헤드샷 처치 — 잠깐 시간이 멎고(패링 히트스톱과 같은 결) 크게 터진다
          world.freezeTicks = Math.max(world.freezeTicks, balance.weapons.headshotKillFreezeTicks);
          world.events.emit('headshot_kill', { enemyType: enemy.type, x: enemy.x, z: enemy.z });
        }
      } else {
        // 마법 처치도 마나 0 — 마나는 패링/처형 경로로만 (combat.md §5)
        world.events.emit('spell_kill', { enemyType: enemy.type });
      }
    } else {
      // 동료 오사 — 플레이어 전과가 아니므로 처치 통계·마나 경로에서 제외
      world.events.emit('friendly_fire_kill', { enemyType: enemy.type });
    }
    world.events.emit('enemy_died', { enemyType: enemy.type, x: enemy.x, z: enemy.z });
  }
}

/** 화염구 폭발 — 반경 내 적에게 거리 감쇠 피해와 화상, 가까운 적은 크게 날린다.
 *  직격당한 적(direct)은 이미 본 피해를 받았으므로 폭발 피해에서는 제외한다.
 *  플레이어도 반경 안이면 같은 감쇠로 맞는다 — 근접전에서 함부로 못 쏘게 하는 제약 */
function explodeFireball(
  world: World,
  proj: (typeof world.projectiles)[number],
  x: number,
  y: number,
  z: number,
  direct: (typeof world.enemies)[number] | null,
): void {
  const fx = sigilDef('sig_fireball').effects;
  const radius = fx['explodeRadius'] ?? 0;
  if (radius <= 0) return;
  const blastRadius = fx['blastRadius'] ?? 0;
  world.events.emit('explosion', { x, y, z, radius, kind: 'fireball' });
  // 화염구도 균열 벽을 1방에 부순다 — 수류탄과 같은 "폭발" 계열만 부순다.
  // 화살·총·해머 같은 물리 타격은 못 부순다 (그쪽엔 이 호출이 없다)
  breakCrackWalls(world, x, z, radius);

  // 폭심에서 멀어질수록 약해진다 (반경 끝에서 explodeFalloffMin 배)
  const damageAt = (dist: number): number =>
    (fx['explodeDamage'] ?? 0) *
    (1 - (1 - (fx['explodeFalloffMin'] ?? 0.3)) * Math.min(1, dist / radius));

  for (const enemy of world.enemies) {
    if (!enemy.alive) continue;
    const dist = Math.hypot(enemy.x - x, enemy.z - z);
    if (dist > radius) continue;

    // 가까우면 크게 밀려난다 (보스 제외) — 직격 대상 포함
    if (dist <= blastRadius && !enemyDef(enemy.type).boss) {
      const away = dist > 0.001 ? dist : 1;
      const kbTicks = fx['blastKnockbackTicks'] ?? 12;
      const push = (fx['blastKnockback'] ?? 0) / kbTicks;
      enemy.kbTicks = kbTicks;
      enemy.kbX = ((enemy.x - x) / away) * push;
      enemy.kbZ = ((enemy.z - z) / away) * push;
    }
    if (enemy === direct) continue; // 직격 피해와 중복되지 않게

    if (enemy.ai === 'idle') enemy.ai = 'chase';
    const damage = damageAt(dist);
    // 방어막은 폭발을 막지 못한다 (화염은 사방에서 온다)
    enemy.health -= applyFrostOnHit(world.events, enemy, damage);
    enemy.burnTicks = Math.max(enemy.burnTicks, proj.burnTicks);
    if (proj.burnDamagePerTick > 0) enemy.burnDamagePerTick = proj.burnDamagePerTick;
    if (enemy.health <= 0) {
      enemy.alive = false;
      world.events.emit('spell_kill', { enemyType: enemy.type, splash: true });
      world.events.emit('enemy_died', { enemyType: enemy.type, x: enemy.x, z: enemy.z });
    }
  }

  // 자가 피해 — 내가 쏜 화염구도 나를 태운다 (수류탄 자폭과 같은 규칙).
  // 방패로 막히지 않는다: 폭발은 사방에서 온다. 회피 무적 중에는 면제
  breakHeadsInRadius(world, x, z, radius); // 구울 머리 소품도 폭발에 터진다
  breakPropsInRadius(world, x, z, radius); // 기믹도 부서진다 (각자 롤)

  const p = world.player;
  const playerDist = Math.hypot(p.x - x, p.z - z);
  if (playerDist <= radius && p.iframeTicks <= 0) {
    const damage = damageAt(playerDist);
    p.health -= damage;
    world.events.emit('player_damaged', { amount: damage, health: p.health, source: 'fireball', srcX: x, srcZ: z });
    if (p.health <= 0) {
      p.health = 0;
      world.dead = true;
      world.events.emit('player_died', { tick: world.tick });
    }
  }
}

/** 마법탄 내파 — 착탄점으로 끌어당긴다. 화염구(밀어냄)의 정반대.
 *  피해는 작고 이동 강제가 본체다: 빗나가도 폭심으로 끌려가 근접 적의 사거리에 들어간다.
 *  반사되면 그대로 적들에게 터져 한곳에 뭉친다 — 광역 마무리로 이어지는 보상 */
function implodeBolt(
  world: World,
  proj: (typeof world.projectiles)[number],
  x: number,
  y: number,
  z: number,
  direct: (typeof world.enemies)[number] | null,
  directPlayer: boolean,
): void {
  const sp = proj.splash!;
  if (sp.radius <= 0) return;
  world.events.emit('explosion', { x, y, z, radius: sp.radius, kind: sp.kind });

  const falloffAt = (dist: number): number =>
    1 - (1 - sp.falloffMin) * Math.min(1, dist / sp.radius);

  for (const enemy of world.enemies) {
    if (!enemy.alive) continue;
    const dist = Math.hypot(enemy.x - x, enemy.z - z);
    if (dist > sp.radius) continue;
    const falloff = falloffAt(dist);

    // 끌림 — 폭심을 지나치지 않게 실제 거리까지만. 보스는 꿈쩍하지 않는다
    if (!enemyDef(enemy.type).boss && dist > 0.001 && sp.pullTicks > 0) {
      const pull = Math.min(sp.pullDistance * falloff, dist);
      enemy.kbTicks = sp.pullTicks;
      enemy.kbX = ((x - enemy.x) / dist) * (pull / sp.pullTicks);
      enemy.kbZ = ((z - enemy.z) / dist) * (pull / sp.pullTicks);
    }

    if (enemy === direct) continue; // 직격 피해와 중복되지 않게
    if (enemy.ai === 'idle') enemy.ai = 'chase';
    // 적이 쏜 것이면 동료 오사 규칙을 따른다 (사고로 보이되 한 방에 죽지 않게)
    const mul = proj.owner === 'enemy' ? balance.enemyAi.friendlyFireDamageMul : 1;
    enemy.health -= applyFrostOnHit(world.events, enemy, sp.damage * falloff * mul);
    if (enemy.health <= 0) {
      enemy.alive = false;
      world.events.emit(
        proj.owner === 'player' ? 'spell_kill' : 'friendly_fire_kill',
        { enemyType: enemy.type, splash: true },
      );
      world.events.emit('enemy_died', { enemyType: enemy.type, x: enemy.x, z: enemy.z });
    }
  }

  // 플레이어 — 반사한 내 탄이라도 폭심 안이면 똑같이 휘말린다
  const p = world.player;
  const dist = Math.hypot(p.x - x, p.z - z);
  if (dist > sp.radius || p.iframeTicks > 0) return;
  const falloff = falloffAt(dist);
  if (dist > 0.001 && sp.pullTicks > 0) {
    pushPlayer(p, x - p.x, z - p.z, Math.min(sp.pullDistance * falloff, dist), sp.pullTicks);
  }
  if (directPlayer) return; // 직격 피해와 중복되지 않게 (밀림은 직격 쪽이 덮어쓴다)
  const damage = sp.damage * falloff;
  p.health -= damage;
  world.events.emit('player_damaged', { amount: damage, health: p.health, source: 'implode', srcX: x, srcZ: z });
  if (p.health <= 0) {
    p.health = 0;
    world.dead = true;
    world.events.emit('player_died', { tick: world.tick });
  }
}

/** 수류탄 폭발 — 반경 내 전원(플레이어 포함) 거리 감쇠 피해 + 균열 벽 파괴 */
/** 벽·천장 튕김. 반사에 성공하면 true — 실패(출발점이 이미 벽 안)하면 그 자리에서 터진다.
 *  충돌 지점에 그대로 두면 다음 틱 DDA 가 벽 셀 안에서 시작해 t=0 으로 다시 맞는다.
 *  들어온 방향으로 SKIN 만큼 물러선 뒤 반사한다 */
const BOUNCE_SKIN = 0.06;
function bounceGrenade(
  world: World,
  proj: (typeof world.projectiles)[number],
  surface: 'wall' | 'ceiling',
  axis: 'x' | 'z' | null,
  dirX: number,
  dirY: number,
  dirZ: number,
): boolean {
  if (surface === 'wall' && axis === null) return false; // 벽 속에서 출발했다
  const g = balance.weapons.grenade;
  proj.x -= dirX * BOUNCE_SKIN;
  proj.y -= dirY * BOUNCE_SKIN;
  proj.z -= dirZ * BOUNCE_SKIN;

  if (surface === 'ceiling') {
    proj.vy = -proj.vy * g.bounceRestitution;
    proj.vx *= g.bounceFriction;
    proj.vz *= g.bounceFriction;
  } else if (axis === 'x') {
    proj.vx = -proj.vx * g.bounceRestitution;
    proj.vy *= g.bounceFriction;
    proj.vz *= g.bounceFriction;
  } else {
    proj.vz = -proj.vz * g.bounceRestitution;
    proj.vx *= g.bounceFriction;
    proj.vy *= g.bounceFriction;
  }

  world.events.emit('grenade_bounce', {
    x: proj.x,
    y: proj.y,
    z: proj.z,
    speed: Math.hypot(proj.vx, proj.vy, proj.vz),
  });
  return true;
}

/** 폭심에서 바깥으로 밀어낸다. 체급이 무거울수록 덜 밀린다 —
 *  폭발통(Barrels)과 같은 규약을 쓴다 (balance.explosionKnockback) */
function pushFromBlast(enemy: EnemyState, cx: number, cz: number, distance: number): void {
  const kb = balance.explosionKnockback;
  const byWeight = kb.byWeight as unknown as Record<string, number>;
  const weightMul = byWeight[enemyDef(enemy.type).weight] ?? 1;
  pushEnemy(enemy, enemy.x - cx, enemy.z - cz, distance * weightMul, kb.ticks);
}

function explodeGrenade(world: World, proj: (typeof world.projectiles)[number]): void {
  const grenade = balance.weapons.grenade;
  world.events.emit('explosion', { x: proj.x, y: proj.y, z: proj.z, radius: grenade.radius });

  const damageAt = (dist: number): number =>
    grenade.damage *
    (1 - (1 - grenade.damageFalloffMin) * Math.min(1, dist / grenade.radius));

  for (const enemy of world.enemies) {
    if (!enemy.alive) continue;
    const dist = Math.hypot(enemy.x - proj.x, enemy.z - proj.z);
    if (dist > grenade.radius) continue;
    let damage = damageAt(dist);
    if (enemy.ai === 'idle') enemy.ai = 'chase';

    // 정면 방패로 폭풍을 받아내면 방패가 부서진다 — 화염구와 같은 규칙.
    // 방패가 충격을 일부 먹으므로 피해도 그만큼 줄어든다
    if (shieldBlocksProjectile(enemyDef(enemy.type), enemy, proj.x, proj.z)) {
      enemy.shieldBroken = true;
      damage *= balance.shieldBreak.damageRatio;
      world.events.emit('shield_broken', {
        enemyId: enemy.id,
        enemyType: enemy.type,
        x: enemy.x,
        z: enemy.z,
      });
    }

    enemy.health -= applyFrostOnHit(world.events, enemy, damage);
    if (enemy.health <= 0) {
      enemy.alive = false;
      world.events.emit('weapon_kill', { weapon: 'grenade', enemyType: enemy.type });
      // 폭심 반대 방향을 함께 실어 보낸다 — 밀려날 몸이 안 남으니 파편이 대신 날아간다
      world.events.emit('enemy_died', {
        enemyType: enemy.type,
        x: enemy.x,
        z: enemy.z,
        blastX: enemy.x - proj.x,
        blastZ: enemy.z - proj.z,
      });
      continue; // 시체를 밀 수는 없다 (사망 즉시 모형이 사라진다)
    }
    // 폭풍에 밀린다 — 폭발통과 같은 규칙 (피해 감쇠 × 체급 배율)
    pushFromBlast(enemy, proj.x, proj.z, (grenade.enemyKnockback * damage) / grenade.damage);
  }

  breakHeadsInRadius(world, proj.x, proj.z, grenade.radius); // 구울 머리 소품도 터진다
  breakPropsInRadius(world, proj.x, proj.z, grenade.radius); // 기믹도 부서진다 (각자 롤)

  // 자가 피해 — 가까이서 던지면 나도 다친다
  const p = world.player;
  const playerDist = Math.hypot(p.x - proj.x, p.z - proj.z);
  if (playerDist <= grenade.radius && p.iframeTicks <= 0) {
    const damage = damageAt(playerDist);
    p.health -= damage;
    world.events.emit('player_damaged', { amount: damage, health: p.health, srcX: proj.x, srcZ: proj.z });
    if (p.health <= 0) {
      p.health = 0;
      world.dead = true;
      world.events.emit('player_died', { tick: world.tick });
    }
  }

  // 폭발통 — 폭풍에 닿으면 함께 터진다 (즉발)
  for (const barrel of world.barrels) {
    if (!barrel.alive) continue;
    if (Math.hypot(barrel.x - proj.x, barrel.z - proj.z) > grenade.radius) continue;
    igniteBarrel(barrel);
  }

  // 균열 벽(C) 파괴
  if (grenade.breaksCrackWall) breakCrackWalls(world, proj.x, proj.z, grenade.radius);

  // 소음 — 폭발음은 멀리 퍼진다
  for (const enemy of world.enemies) {
    if (!enemy.alive || enemy.ai !== 'idle') continue;
    if (Math.hypot(enemy.x - proj.x, enemy.z - proj.z) > grenade.noiseRadius) continue;
    alertEnemy(enemy, balance.enemyAi.noticeDelayTicks);
    world.events.emit('enemy_alerted', { enemyId: enemy.id, enemyType: enemy.type, noise: true });
  }
}

function applyBurns(world: World): void {
  for (const enemy of world.enemies) {
    if (!enemy.alive || enemy.burnTicks <= 0) continue;
    enemy.burnTicks--;
    enemy.health -= enemy.burnDamagePerTick;
    if (enemy.health <= 0) {
      enemy.alive = false;
      world.events.emit('spell_kill', { enemyType: enemy.type, burn: true });
      world.events.emit('enemy_died', { enemyType: enemy.type, x: enemy.x, z: enemy.z });
    }
  }
}
