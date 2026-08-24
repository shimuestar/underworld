// 마법 투사체 — 화염구 시전, 비행/충돌, 화상 DoT.
// 시전 수치는 sigils.json의 effects, 코스트는 balance.spellCost (tier 기준).
// 시전 시 cast_spell 이벤트 발행 → Mana가 연쇄를 리셋한다.

import { balance } from '../core/Balance';
import { barrierUp, enemyDef, shieldBlocksProjectile } from '../core/Entities';
import { rayVsAabb } from '../core/Ray';
import { sigilDef } from '../core/SigilData';
import { type EnemyState, pushEnemy, alertEnemy,
  hitBarrel,
  igniteBarrel,
  playerBlocks,
  pushPlayer,
  type BarrelState,
  type ProjectileState,
  type World,
} from '../core/World';

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
        }
      }
    }

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
          hitBarrelTarget = null; // 적이 통보다 앞이다
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
          hitEnemy !== null || hitPlayer || hitBarrelTarget !== null || hitProjectile !== null;
        if (!bodyHit && (hitSurface === 'wall' || hitSurface === 'ceiling')) {
          if (bounceGrenade(world, proj, hitSurface, wall.axis, dirX, dirY, dirZ)) continue;
        }
        explodeGrenade(world, proj);
        world.projectiles.splice(i, 1);
        i = removeBroken(world, hitProjectile, i);
        continue;
      }
      // 폭발통에 꽂혔다 — 마법·화염구는 즉발이다 (총·해머의 누적 규칙과 다르다)
      if (hitBarrelTarget) {
        const bx = proj.x + dirX * hitT;
        const by = proj.y + dirY * hitT;
        const bz = proj.z + dirZ * hitT;
        if (proj.kind === 'arrow') {
          // 화살은 운동 에너지다 — 총알·해머와 같은 규약으로 도화선만 짧아진다.
          // 즉발로 두면 조용한 활이 시끄러운 권총(3발)보다 나아져 역할이 무너진다
          hitBarrel(hitBarrelTarget, balance.barrel.fuseByHits);
          world.events.emit('barrel_hit', {
            id: hitBarrelTarget.id,
            hits: hitBarrelTarget.hits,
            fuseTicks: hitBarrelTarget.fuseTicks,
            x: hitBarrelTarget.x,
            z: hitBarrelTarget.z,
          });
          world.events.emit('arrow_impact', { x: bx, y: by, z: bz, hitEnemy: true });
          if (proj.recoverable) dropArrow(world, bx, bz, true);
        } else {
          igniteBarrel(hitBarrelTarget);
          world.events.emit('spell_impact', { x: bx, y: by, z: bz, hitEnemy: true });
        }
        world.projectiles.splice(i, 1);
        continue;
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

      // 화살은 벽·바닥에 꽂힌 채 남는다 (렌더 전용 잔존물 — 적 화살도 포함)
      if (proj.kind === 'arrow' && !hitEnemy && !hitPlayer) {
        const sx = proj.x + dirX * hitT;
        const sy = proj.y + dirY * hitT;
        const sz = proj.z + dirZ * hitT;
        if (proj.recoverable) {
          // 주울 수 있는 화살은 바닥 아이템이 진짜 물건이다 — 데칼까지 그리면
          // 벽에 꽂힌 화살과 그 앞에 떨어진 화살이 겹쳐 두 대로 보인다.
          // 벽면에 딱 붙여 두면 자석이 벽 안쪽을 향하므로 날아온 방향으로 물려 놓는다
          dropArrow(world, sx - dirX * balance.pickups.arrow.stickPullback, sz - dirZ * balance.pickups.arrow.stickPullback);
        } else {
          world.events.emit('arrow_stuck', { x: sx, y: sy, z: sz, dx: dirX, dy: dirY, dz: dirZ });
        }
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
          world.events.emit('player_damaged', { amount: damage, health: p.health, blocked });
          if (p.health <= 0) {
            p.health = 0;
            world.dead = true;
            world.events.emit('player_died', { tick: world.tick });
          }
        }
      } else if (hitEnemy) {
        applyProjectileHit(world, proj, hitEnemy, shieldedAtImpact);
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
): void {
  const def = enemyDef(enemy.type);

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
  enemy.health -= damage;
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
  // 맞았으면 깬다 — 활은 소리가 작을 뿐(noiseRadius 4) 맞은 놈까지 자면 곤란하다
  if (proj.owner === 'player' && enemy.health > 0 && enemy.ai === 'idle') {
    alertEnemy(enemy, balance.enemyAi.noticeDelayTicks);
    world.events.emit('enemy_alerted', { enemyId: enemy.id, enemyType: enemy.type });
  }
  if (enemy.health <= 0) {
    enemy.alive = false;
    if (proj.owner === 'player') {
      // 활은 마법이 아니라 무기다 — 여기서 안 가르면 활 처치가 마법 처치로 집계된다.
      // 어느 쪽이든 마나는 0 이다 (Mana 는 두 이벤트를 모두 구독하지 않는다)
      if (proj.kind === 'arrow') {
        world.events.emit('weapon_kill', { weapon: 'bow', enemyType: enemy.type });
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

    enemy.health -= damage;
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

  // 폭발통 — 폭풍에 닿으면 함께 터진다 (즉발)
  for (const barrel of world.barrels) {
    if (!barrel.alive) continue;
    if (Math.hypot(barrel.x - proj.x, barrel.z - proj.z) > grenade.radius) continue;
    igniteBarrel(barrel);
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
