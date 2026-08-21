// 마법 투사체 — 화염구 시전, 비행/충돌, 화상 DoT.
// 시전 수치는 sigils.json의 effects, 코스트는 balance.spellCost (tier 기준).
// 시전 시 cast_spell 이벤트 발행 → Mana가 연쇄를 리셋한다.

import { balance } from '../core/Balance';
import { enemyDef } from '../core/Entities';
import { rayVsAabb } from '../core/Ray';
import { sigilDef } from '../core/SigilData';
import { playerBlocks, type World } from '../core/World';

let nextProjectileId = 1;

export function tick(world: World, dt: number): void {
  if (world.spell.cooldown > 0) world.spell.cooldown--;

  if (
    world.input.castPressed &&
    world.player.stunTicks <= 0 &&
    world.player.dodgeTicks <= 0 &&
    !world.player.blocking
  ) {
    tryCast(world);
  }

  moveProjectiles(world, dt);
  applyBurns(world);
}

function tryCast(world: World): void {
  const sigilId = world.sigils.equipped.rightArm;
  if (!sigilId) {
    world.events.emit('cast_failed', { reason: 'no_sigil' });
    return;
  }
  if (world.spell.cooldown > 0) return;

  const def = sigilDef(sigilId);
  const cost = balance.spellCost[def.tier as keyof typeof balance.spellCost] ?? 0;
  if (world.mana.value < cost) {
    world.events.emit('cast_failed', { reason: 'no_mana', cost, current: world.mana.value });
    return;
  }

  const p = world.player;
  const effects = def.effects;
  const cosPitch = Math.cos(p.pitch);
  const dx = -Math.sin(p.yaw) * cosPitch;
  const dy = Math.sin(p.pitch);
  const dz = -Math.cos(p.yaw) * cosPitch;
  const oy = p.y + balance.player.eyeHeight;
  const speed = effects['speed'] ?? 20;

  world.mana.value -= cost;
  world.spell.cooldown = effects['cooldownTicks'] ?? 0;
  world.projectiles.push({
    id: nextProjectileId++,
    owner: 'player',
    x: p.x, y: oy, z: p.z,
    prevX: p.x, prevY: oy, prevZ: p.z,
    vx: dx * speed, vy: dy * speed, vz: dz * speed,
    lifeTicks: effects['lifeTicks'] ?? 120,
    damage: effects['damage'] ?? 0,
    burnTicks: effects['burnTicks'] ?? 0,
    burnDamagePerTick: effects['burnDamagePerTick'] ?? 0,
    radius: effects['radius'] ?? 0.3,
    kind: 'fireball',
  });
  world.events.emit('cast_spell', { sigil: sigilId, cost });
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
      world.projectiles.splice(i, 1);
      continue;
    }

    const stepX = proj.vx * dt;
    const stepY = proj.vy * dt;
    const stepZ = proj.vz * dt;
    const stepLen = Math.hypot(stepX, stepY, stepZ);
    const dirX = stepX / stepLen;
    const dirY = stepY / stepLen;
    const dirZ = stepZ / stepLen;

    // 이번 틱 이동 구간의 가장 가까운 충돌 (벽/바닥/천장/표적)
    let hitT = level.wallRayT(proj.x, proj.z, dirX, dirZ);
    if (dirY < 0) hitT = Math.min(hitT, (proj.y - 0) / -dirY);
    else if (dirY > 0) hitT = Math.min(hitT, (level.ceiling - proj.y) / dirY);
    let hitEnemy: (typeof world.enemies)[number] | null = null;
    let hitPlayer = false;

    if (proj.owner === 'player') {
      for (const enemy of world.enemies) {
        if (!enemy.alive) continue;
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
    } else {
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
      }
    }

    if (hitT <= stepLen) {
      // 착탄
      world.events.emit('spell_impact', {
        x: proj.x + dirX * hitT,
        y: proj.y + dirY * hitT,
        z: proj.z + dirZ * hitT,
        hitEnemy: hitEnemy !== null || hitPlayer,
      });

      if (hitPlayer) {
        const p = world.player;
        if (p.iframeTicks <= 0) {
          // 방어(정면) — 투사체도 칩 데미지만 관통
          const blocked = playerBlocks(world, proj.x, proj.z, balance.block.arcDeg);
          const damage = blocked ? proj.damage * balance.block.chipDamageRatio : proj.damage;
          p.health -= damage;
          if (blocked) world.events.emit('block_hit', { amount: damage });
          world.events.emit('player_damaged', { amount: damage, health: p.health, blocked });
          if (p.health <= 0) {
            p.health = 0;
            world.dead = true;
            world.events.emit('player_died', { tick: world.tick });
          }
        }
      } else if (hitEnemy) {
        applyProjectileHit(world, proj, hitEnemy);
      }
      world.projectiles.splice(i, 1);
      continue;
    }

    proj.x += stepX;
    proj.y += stepY;
    proj.z += stepZ;
  }
}

function applyProjectileHit(
  world: World,
  proj: (typeof world.projectiles)[number],
  enemy: (typeof world.enemies)[number],
): void {
  const def = enemyDef(enemy.type);

  // 마법 방어막(warden) — 반사된 투사체가 아니면 무효 (7.2 피드백)
  if (def.magicBarrier?.blocksMagic && !proj.deflected) {
    world.events.emit('barrier_blocked', { enemyId: enemy.id, kind: 'magic' });
    return;
  }
  // 보스 장갑 페이즈 — 실탄만 유효, 마법은 튕긴다
  if (enemy.phase === 'armored' && !proj.deflected) {
    world.events.emit('barrier_blocked', { enemyId: enemy.id, kind: 'armor' });
    return;
  }

  enemy.health -= proj.damage;
  enemy.burnTicks = Math.max(enemy.burnTicks, proj.burnTicks);
  if (proj.burnDamagePerTick > 0) enemy.burnDamagePerTick = proj.burnDamagePerTick;
  if (enemy.health <= 0) {
    enemy.alive = false;
    // 마법 처치도 마나 0 — 마나는 패링/처형 경로로만 (combat.md §5)
    world.events.emit('spell_kill', { enemyType: enemy.type });
    world.events.emit('enemy_died', { enemyType: enemy.type, x: enemy.x, z: enemy.z });
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
