// 권총(9mm) — 세미오토 히트스캔. 탄창/예비탄, 장전, 총구 화염 상태를 관리한다.
//
// ⚠ 하드 룰: 총기로 적을 죽여도 마나 이벤트를 발행하지 않는다 (weapon_kill만).
//    두 자원 경제를 분리하는 유일한 규칙이다 — docs/systems/combat.md §5.

import { balance } from '../core/Balance';
import { enemyDef, shieldBlocks } from '../core/Entities';
import { rayVsAabb } from '../core/Ray';
import { RANGED_WEAPONS, type World } from '../core/World';

export function tick(world: World, _dt: number): void {
  const w = world.weapon;
  const pistol = balance.weapons.pistol;

  if (w.muzzleFlash > 0) w.muzzleFlash--;
  if (w.cooldown > 0) w.cooldown--;
  if (w.meleeCooldown > 0) w.meleeCooldown--;
  // 연속타 유지 시간 — 끊기면 1타부터 다시
  if (w.comboTimer > 0) {
    w.comboTimer--;
    if (w.comboTimer === 0) w.comboStep = 0;
  }

  // 원거리 무기 교체 (휠) — 장전·차징은 취소된다
  if (world.input.cycleRanged !== 0) {
    const i = RANGED_WEAPONS.indexOf(w.ranged);
    const next =
      RANGED_WEAPONS[(i + world.input.cycleRanged + RANGED_WEAPONS.length) % RANGED_WEAPONS.length]!;
    if (next !== w.ranged) {
      w.ranged = next;
      w.reloading = 0;
      w.grenadeCharge = 0;
      world.events.emit('weapon_switched', { weapon: next, slot: 'ranged' });
    }
  }

  // 경직/회피 대시 중에는 아무것도 못 한다
  if (world.player.stunTicks > 0 || world.player.dodgeTicks > 0) return;

  // 근접 공격(우클릭, 오른손 해머) — 방어 중에도 나간다. 방패는 왼팔이니까
  if (world.input.meleePressed && w.meleeCooldown <= 0) {
    swingHammer(world);
    w.grenadeCharge = 0; // 근접을 섞으면 차징은 끊긴다
    return;
  }

  // 원거리(좌클릭)는 왼손 = 방패 손이라 방어 중에는 쓸 수 없다
  if (world.player.blocking) {
    w.grenadeCharge = 0;
    return;
  }

  if (w.reloading > 0) {
    w.reloading--;
    if (w.reloading === 0) {
      const need = pistol.magSize - w.mag;
      const take = Math.min(need, w.reserve);
      w.mag += take;
      w.reserve -= take;
      world.events.emit('reload_finished', { mag: w.mag, reserve: w.reserve });
    }
    return; // 장전 중에는 발사/재장전 입력 무시
  }

  if (w.ranged === 'grenade') {
    // 홀드 차징 — 누르는 동안 힘을 모으고, 놓으면 던진다
    if (w.grenades <= 0) {
      if (world.input.rangedPressed) world.events.emit('weapon_empty');
      w.grenadeCharge = 0;
      return;
    }
    if (w.meleeCooldown > 0) {
      w.grenadeCharge = 0;
      return;
    }
    const grenade = balance.weapons.grenade;
    if (world.input.rangedHeld) {
      w.grenadeCharge = Math.min(w.grenadeCharge + 1, grenade.maxChargeTicks);
    } else if (w.grenadeCharge > 0) {
      throwGrenade(world, w.grenadeCharge / grenade.maxChargeTicks);
      w.grenadeCharge = 0;
    }
    return;
  }

  // ---- 권총 ----
  if (world.input.reload && w.mag < pistol.magSize && w.reserve > 0) {
    startReload(world);
    return;
  }

  if (!world.input.rangedPressed) return;

  if (w.mag === 0) {
    // 빈 탄창 — 예비탄이 있으면 자동 장전, 없으면 불발
    if (w.reserve > 0) startReload(world);
    else world.events.emit('weapon_empty');
    return;
  }

  if (w.cooldown > 0) return;

  fire(world);
}

/** 해머 — 전방 부채꼴 내리치기. 근접 처치는 마나를 준다 (총과의 결정적 차이) */
function swingHammer(world: World): void {
  const hammer = balance.weapons.hammer;
  const combo = hammer.combo;
  const w = world.weapon;
  const p = world.player;

  // 연속타 단계 진행 — 창이 끊겼으면 1타부터
  w.comboStep = (w.comboTimer > 0 ? w.comboStep : 0) + 1;
  const heavy = w.comboStep >= combo.finisherStep;
  const damage = heavy ? hammer.damage * combo.damageMul : hammer.damage;
  const range = heavy ? hammer.range * combo.rangeMul : hammer.range;
  const arcDeg = heavy ? hammer.arcDeg * combo.arcMul : hammer.arcDeg;
  const knockback = heavy ? hammer.knockback * combo.knockbackMul : hammer.knockback;

  world.events.emit('hammer_swing', { heavy, step: w.comboStep });
  alertNearby(world, p.x, p.z, hammer.noiseRadius * (heavy ? 2 : 1));

  const facingX = -Math.sin(p.yaw);
  const facingZ = -Math.cos(p.yaw);
  const arcCos = Math.cos(((arcDeg / 2) * Math.PI) / 180);
  let hitAny = false;

  for (const enemy of world.enemies) {
    if (!enemy.alive) continue;
    const def = enemyDef(enemy.type);
    const toX = enemy.x - p.x;
    const toZ = enemy.z - p.z;
    const dist = Math.hypot(toX, toZ);
    if (dist > range + def.radius || dist === 0) continue;
    if ((facingX * toX + facingZ * toZ) / dist < arcCos) continue;

    // 상성 — warden 방어막은 근접 무효, 보스 장갑은 실탄 전용
    if (enemyDef(enemy.type).magicBarrier?.blocksMelee && enemy.ai !== 'staggered') {
      world.events.emit('barrier_blocked', { enemyId: enemy.id, kind: 'melee' });
      continue;
    }
    if (enemy.phase === 'armored' && (enemy.armorHealth ?? 0) > 0) {
      world.events.emit('barrier_blocked', { enemyId: enemy.id, kind: 'armor' });
      continue;
    }

    enemy.health -= damage;
    if (enemy.ai === 'idle') enemy.ai = 'chase';
    // 넉백 — 타격 방향으로 밀려난다 (보스는 밀리지 않는다)
    if (!enemyDef(enemy.type).boss) {
      enemy.kbTicks = hammer.knockbackTicks;
      enemy.kbX = (toX / dist) * (knockback / hammer.knockbackTicks);
      enemy.kbZ = (toZ / dist) * (knockback / hammer.knockbackTicks);
    }
    hitAny = true;
    world.events.emit('melee_hit', { enemyId: enemy.id, damage, heavy });
    if (enemy.health <= 0) {
      enemy.alive = false;
      // 근접 처치 — Mana가 melee_kill(비처형)을 구독해 마나를 지급한다
      world.events.emit('melee_kill', {
        enemyType: enemy.type,
        execution: false,
        x: enemy.x,
        z: enemy.z,
      });
      world.events.emit('enemy_died', { enemyType: enemy.type, x: enemy.x, z: enemy.z });
    }
  }

  // 1·2타는 짧은 후딜로 바로 이어칠 수 있게 하고(연결), 마무리 강타만 크게 쉰다.
  // 헛스윙이면 추가 후딜 — 마구 휘두르기 억제
  const base = heavy ? hammer.cooldownTicks * combo.cooldownMul : combo.chainCooldownTicks;
  w.meleeCooldown = Math.round(hitAny ? base : base + hammer.whiffExtraCooldownTicks);

  if (heavy) {
    w.comboStep = 0; // 마무리 — 다음은 다시 1타부터
    w.comboTimer = 0;
    if (hitAny) world.freezeTicks = Math.max(world.freezeTicks, combo.hitstopTicks);
  } else {
    // 다음 타를 이어갈 수 있는 시간 (후딜이 끝난 뒤부터 세는 게 아니라 총 여유)
    w.comboTimer = w.meleeCooldown + combo.windowTicks;
  }
}

/** 수류탄 투척 속도 — 차징 비율(0~1)에 따라 min~max 선형 */
export function grenadeThrowSpeed(chargeFrac: number): number {
  const grenade = balance.weapons.grenade;
  return (
    grenade.throwSpeedMin +
    (grenade.throwSpeedMax - grenade.throwSpeedMin) * Math.min(1, Math.max(0, chargeFrac))
  );
}

/** 수류탄 — 포물선 투척 (차징 비율만큼 멀리). 폭발은 Projectiles가 처리 */
function throwGrenade(world: World, chargeFrac: number): void {
  const w = world.weapon;
  const grenade = balance.weapons.grenade;
  const p = world.player;
  w.grenades--;
  w.meleeCooldown = grenade.cooldownTicks;

  const speed = grenadeThrowSpeed(chargeFrac);
  const cosPitch = Math.cos(p.pitch);
  const dx = -Math.sin(p.yaw) * cosPitch;
  const dy = Math.sin(p.pitch);
  const dz = -Math.cos(p.yaw) * cosPitch;
  const oy = p.y + balance.player.eyeHeight;

  world.projectiles.push({
    id: 200000 + world.tick, // 수류탄 id 대역
    owner: 'player',
    kind: 'grenade',
    x: p.x, y: oy, z: p.z,
    prevX: p.x, prevY: oy, prevZ: p.z,
    vx: dx * speed,
    vy: dy * speed + grenade.throwUpBias,
    vz: dz * speed,
    lifeTicks: grenade.fuseTicks,
    damage: grenade.damage,
    burnTicks: 0,
    burnDamagePerTick: 0,
    radius: 0.22,
  });
  world.events.emit('grenade_thrown', { remaining: w.grenades, chargeFrac });
}

/** 소음 전파 — 반경 내 대기(idle) 적들이 추격을 시작한다 */
function alertNearby(world: World, x: number, z: number, radius: number): void {
  for (const enemy of world.enemies) {
    if (!enemy.alive || enemy.ai !== 'idle') continue;
    if (Math.hypot(enemy.x - x, enemy.z - z) > radius) continue;
    enemy.ai = 'chase';
    world.events.emit('enemy_alerted', {
      enemyId: enemy.id,
      enemyType: enemy.type,
      noise: true,
    });
  }
}

function startReload(world: World): void {
  // 오른팔 각인 페널티 — 재장전 시간 배율 (M5 완료 조건: 부착하면 느려진 게 체감돼야 한다)
  world.weapon.reloading = Math.round(
    balance.weapons.pistol.reloadTicks * world.modifiers.reloadTimeMul,
  );
  world.events.emit('reload_started', { ticks: world.weapon.reloading });
}

function fire(world: World): void {
  const w = world.weapon;
  const p = world.player;
  const pistol = balance.weapons.pistol;

  w.mag--;
  w.cooldown = pistol.fireIntervalTicks;
  w.muzzleFlash = pistol.muzzleFlash.ticks;
  world.events.emit('ammo_spent', { type: '9mm', amount: 1 });

  // 시선 방향 레이
  const cosPitch = Math.cos(p.pitch);
  const dx = -Math.sin(p.yaw) * cosPitch;
  const dy = Math.sin(p.pitch);
  const dz = -Math.cos(p.yaw) * cosPitch;
  const oy = p.y + balance.player.eyeHeight;

  // 벽 (2D DDA) + 바닥/천장 중 가까운 쪽이 레이의 끝
  let wallT = world.level.wallRayT(p.x, p.z, dx, dz);
  if (dy < 0) wallT = Math.min(wallT, oy / -dy);
  else if (dy > 0) wallT = Math.min(wallT, (world.level.ceiling - oy) / dy);

  // 가장 가까운 적 히트박스
  let hit: { enemy: (typeof world.enemies)[number]; t: number } | null = null;
  let hitT = wallT;
  for (const enemy of world.enemies) {
    if (!enemy.alive) continue;
    const def = enemyDef(enemy.type);
    const t = rayVsAabb(p.x, oy, p.z, dx, dy, dz, {
      minX: enemy.x - def.radius,
      minY: 0,
      minZ: enemy.z - def.radius,
      maxX: enemy.x + def.radius,
      maxY: def.height,
      maxZ: enemy.z + def.radius,
    });
    if (t !== null && t < wallT && (!hit || t < hit.t)) hit = { enemy, t };
  }

  if (hit) hitT = hit.t;

  // 소음 전파 — 총성(사수 위치)과 착탄 지점 주변의 대기 중인 적들이 나를 인지한다.
  // 맞은 적은 거리와 무관하게 무조건 인지.
  alertNearby(world, p.x, p.z, pistol.noiseRadius);
  alertNearby(world, p.x + dx * hitT, p.z + dz * hitT, pistol.noiseRadius);
  if (hit && hit.enemy.ai === 'idle') {
    hit.enemy.ai = 'chase';
    world.events.emit('enemy_alerted', {
      enemyId: hit.enemy.id,
      enemyType: hit.enemy.type,
      noise: true,
    });
  }

  // 정면 방패 — 전방 호 안에서 맞은 투사체는 무효 (스태거 중에는 방패 무력화)
  if (hit) {
    const def = enemyDef(hit.enemy.type);
    if (shieldBlocks(def, hit.enemy, p.x, p.z)) {
      world.events.emit('shot_blocked', { enemyId: hit.enemy.id, enemyType: hit.enemy.type });
      world.events.emit('shot_fired', {
        sx: p.x, sy: oy, sz: p.z,
        ex: p.x + dx * hit.t, ey: oy + dy * hit.t, ez: p.z + dz * hit.t,
        hitEnemy: false,
        blocked: true, // 착탄음 대신 shot_blocked의 방패 클랭이 재생된다
      });
      return;
    }
  }

  // 렌더용 궤적 (시작점 = 눈 위치, 끝점 = 착탄점)
  world.events.emit('shot_fired', {
    sx: p.x,
    sy: oy,
    sz: p.z,
    ex: p.x + dx * hitT,
    ey: oy + dy * hitT,
    ez: p.z + dz * hitT,
    hitEnemy: hit !== null,
  });

  if (!hit) return;

  // 부위 판정 (명중 높이) + 거리 감쇠
  const def = enemyDef(hit.enemy.type);
  const zones = pistol.hitZones;
  const heightFrac = (oy + dy * hit.t) / def.height;
  let zone: 'head' | 'body' | 'limb';
  let zoneMul: number;
  if (heightFrac >= zones.headFrac) {
    zone = 'head';
    zoneMul = zones.headMul;
  } else if (heightFrac >= zones.bodyFrac) {
    zone = 'body';
    zoneMul = zones.bodyMul;
  } else {
    zone = 'limb';
    zoneMul = zones.limbMul;
  }
  // 거리 감쇠 — startDist까지 100%, endDist에서 minMul, farDist 이상은 farMul(사실상 무효)
  const falloff = pistol.falloff;
  let falloffMul: number;
  if (hit.t <= falloff.startDist) falloffMul = 1;
  else if (hit.t <= falloff.endDist)
    falloffMul =
      1 - (1 - falloff.minMul) * ((hit.t - falloff.startDist) / (falloff.endDist - falloff.startDist));
  else if (hit.t <= falloff.farDist)
    falloffMul =
      falloff.minMul -
      (falloff.minMul - falloff.farMul) * ((hit.t - falloff.endDist) / (falloff.farDist - falloff.endDist));
  else falloffMul = falloff.farMul;
  const damage = pistol.damage * zoneMul * falloffMul;

  if (zone === 'head') world.events.emit('headshot', { enemyId: hit.enemy.id });

  // 보스 장갑 페이즈 — 실탄은 장갑을 깎는다. 장갑 파괴 시 melee 페이즈 복귀
  if (hit.enemy.phase === 'armored' && (hit.enemy.armorHealth ?? 0) > 0) {
    hit.enemy.armorHealth = (hit.enemy.armorHealth ?? 0) - damage;
    world.events.emit('armor_hit', { enemyId: hit.enemy.id, armor: hit.enemy.armorHealth });
    if (hit.enemy.armorHealth <= 0) {
      hit.enemy.armorHealth = 0;
      hit.enemy.phase = 'melee';
      world.events.emit('boss_phase', { enemyId: hit.enemy.id, phase: 'melee' });
    }
    return;
  }

  hit.enemy.health -= damage;
  // 피탄 경직 — 잠깐 발이 묶인다. 공격 상태 머신은 그대로 진행되므로
  // 총으로 공격을 끊거나 스턴락할 수는 없다 (패링 게임을 지우지 않는다)
  hit.enemy.flinchTicks = pistol.flinchTicks;
  if (hit.enemy.health <= 0) {
    hit.enemy.alive = false;
    // 총기 처치는 마나 0 — 여기서 마나 이벤트를 발행하지 않는다 (하드 룰)
    world.events.emit('weapon_kill', { weapon: 'pistol', enemyType: hit.enemy.type, zone });
    world.events.emit('enemy_died', {
      enemyType: hit.enemy.type,
      x: hit.enemy.x,
      z: hit.enemy.z,
    });
  } else {
    world.events.emit('enemy_damaged', {
      enemyId: hit.enemy.id,
      enemyType: hit.enemy.type,
      health: hit.enemy.health,
      zone,
      damage,
    });
  }
}
