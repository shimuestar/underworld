// 마법 투사체 — 화염구 시전, 비행/충돌, 화상 DoT.
// 시전 수치는 sigils.json의 effects, 코스트는 balance.spellCost (tier 기준).
// 시전 시 cast_spell 이벤트 발행 → Mana가 연쇄를 리셋한다.

import { balance } from '../core/Balance';
import { enemyDef, shieldBlocks } from '../core/Entities';
import { rayVsAabb } from '../core/Ray';
import { sigilDef } from '../core/SigilData';
import { playerBlocks, pushPlayer, type World } from '../core/World';

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
  // 각인이 manaCost 를 명시하면 그 값, 없으면 티어 기본값
  const cost =
    def.effects['manaCost'] ?? balance.spellCost[def.tier as keyof typeof balance.spellCost] ?? 0;
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
      // 수류탄 — 무엇에 닿든 그 자리에서 폭발
      if (proj.kind === 'grenade') {
        proj.x += dirX * hitT;
        proj.y += dirY * hitT;
        proj.z += dirZ * hitT;
        explodeGrenade(world, proj);
        world.projectiles.splice(i, 1);
        continue;
      }
      // 착탄
      world.events.emit('spell_impact', {
        x: proj.x + dirX * hitT,
        y: proj.y + dirY * hitT,
        z: proj.z + dirZ * hitT,
        hitEnemy: hitEnemy !== null || hitPlayer,
      });

      // 화살은 벽·바닥에 꽂힌 채 남는다 (렌더 전용 잔존물)
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
          const push = (kb[proj.kind ?? 'arrow'] ?? kb['arrow']!) * (blocked ? kb['blockedMul']! : 1);
          pushPlayer(p, dirX, dirZ, push, balance.playerKnockback.ticks);

          if (blocked) world.events.emit('block_hit', { amount: damage, kind: proj.kind });
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

  // 정면 방패 — 화염구가 명중하면 방패가 부서진다. 방패가 화염을 일부 먹으므로 피해 감소
  if (shieldBlocks(def, enemy, proj.x, proj.z)) {
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
      // 그 외 투사체(반사된 마법 등)는 방패에 막힌다
      world.events.emit('barrier_blocked', { enemyId: enemy.id, kind: 'shield' });
      return;
    }
  }

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

  // 동료 오사는 위력이 줄어든다 — 사고로 보이되 한 방에 죽지는 않게
  const damage =
    proj.owner === 'enemy' ? proj.damage * balance.enemyAi.friendlyFireDamageMul : proj.damage;
  enemy.health -= damage;
  enemy.burnTicks = Math.max(enemy.burnTicks, proj.burnTicks);
  if (proj.burnDamagePerTick > 0) enemy.burnDamagePerTick = proj.burnDamagePerTick;
  if (enemy.health <= 0) {
    enemy.alive = false;
    if (proj.owner === 'player') {
      // 마법 처치도 마나 0 — 마나는 패링/처형 경로로만 (combat.md §5)
      world.events.emit('spell_kill', { enemyType: enemy.type });
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
    // 방어막·장갑은 폭발을 막지 못한다 (화염은 사방에서 온다)
    enemy.health -= damage;
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
  const p = world.player;
  const playerDist = Math.hypot(p.x - x, p.z - z);
  if (playerDist <= radius && p.iframeTicks <= 0) {
    const damage = damageAt(playerDist);
    p.health -= damage;
    world.events.emit('player_damaged', { amount: damage, health: p.health, source: 'fireball' });
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
    enemy.health -= sp.damage * falloff * mul;
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
  world.events.emit('player_damaged', { amount: damage, health: p.health, source: 'implode' });
  if (p.health <= 0) {
    p.health = 0;
    world.dead = true;
    world.events.emit('player_died', { tick: world.tick });
  }
}

/** 수류탄 폭발 — 반경 내 전원(플레이어 포함) 거리 감쇠 피해 + 균열 벽 파괴 */
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
    const damage = damageAt(dist);
    if (enemy.ai === 'idle') enemy.ai = 'chase';
    // 폭발은 물리 피해 — 보스 장갑은 깎고, 방어막은 무시한다
    if (enemy.phase === 'armored' && (enemy.armorHealth ?? 0) > 0) {
      enemy.armorHealth = Math.max(0, (enemy.armorHealth ?? 0) - damage);
      if (enemy.armorHealth <= 0) {
        enemy.phase = 'melee';
        world.events.emit('boss_phase', { enemyId: enemy.id, phase: 'melee' });
      }
      continue;
    }
    enemy.health -= damage;
    if (enemy.health <= 0) {
      enemy.alive = false;
      world.events.emit('weapon_kill', { weapon: 'grenade', enemyType: enemy.type });
      world.events.emit('enemy_died', { enemyType: enemy.type, x: enemy.x, z: enemy.z });
    }
  }

  // 자가 피해 — 가까이서 던지면 나도 다친다
  const p = world.player;
  const playerDist = Math.hypot(p.x - proj.x, p.z - proj.z);
  if (playerDist <= grenade.radius && p.iframeTicks <= 0) {
    const damage = damageAt(playerDist);
    p.health -= damage;
    world.events.emit('player_damaged', { amount: damage, health: p.health });
    if (p.health <= 0) {
      p.health = 0;
      world.dead = true;
      world.events.emit('player_died', { tick: world.tick });
    }
  }

  // 균열 벽(C) 파괴
  if (grenade.breaksCrackWall) {
    const level = world.level;
    const cs = level.cellSize;
    const cellRadius = Math.ceil(grenade.radius / cs);
    const centerCol = Math.floor(proj.x / cs);
    const centerRow = Math.floor(proj.z / cs);
    for (let row = centerRow - cellRadius; row <= centerRow + cellRadius; row++) {
      for (let col = centerCol - cellRadius; col <= centerCol + cellRadius; col++) {
        if (level.charAt(col, row) !== 'C') continue;
        const cx = (col + 0.5) * cs;
        const cz = (row + 0.5) * cs;
        if (Math.hypot(cx - proj.x, cz - proj.z) > grenade.radius + cs * 0.5) continue;
        level.openCell(col, row);
        world.events.emit('crack_wall_broken', { row, col });
      }
    }
  }

  // 소음 — 폭발음은 멀리 퍼진다
  for (const enemy of world.enemies) {
    if (!enemy.alive || enemy.ai !== 'idle') continue;
    if (Math.hypot(enemy.x - proj.x, enemy.z - proj.z) > grenade.noiseRadius) continue;
    enemy.ai = 'chase';
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
