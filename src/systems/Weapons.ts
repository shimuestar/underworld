// 권총(9mm) — 세미오토 히트스캔. 탄창/예비탄, 장전, 총구 화염 상태를 관리한다.
//
// ⚠ 하드 룰: 총기로 적을 죽여도 마나 이벤트를 발행하지 않는다 (weapon_kill만).
//    두 자원 경제를 분리하는 유일한 규칙이다 — docs/systems/combat.md §5.

import { balance } from '../core/Balance';
import { enemyDef, shieldBlocks, shieldBlocksProjectile } from '../core/Entities';
import { rayVsAabb } from '../core/Ray';
import { RANGED_WEAPONS, type World } from '../core/World';

export function tick(world: World, _dt: number): void {
  const w = world.weapon;
  const pistol = balance.weapons.pistol;

  if (w.muzzleFlash > 0) w.muzzleFlash--;
  if (w.cooldown > 0) w.cooldown--;
  if (w.meleeCooldown > 0) w.meleeCooldown--;
  if ((w.meleeBufferTicks ?? 0) > 0) w.meleeBufferTicks = (w.meleeBufferTicks ?? 0) - 1;
  if ((w.meleeRushTicks ?? 0) > 0) w.meleeRushTicks = (w.meleeRushTicks ?? 0) - 1;
  // 연속타 유지 시간 — 끊기면 1타부터 다시
  if (w.comboTimer > 0) {
    w.comboTimer--;
    if (w.comboTimer === 0) w.comboStep = 0;
  }

  // 휘두르는 중 — 해머가 실제로 닿는 틱에 판정한다 (뷰모델과 같은 시점).
  // 경직에 걸리면 스윙이 취소된다
  if (w.swingImpact > 0) {
    if (world.player.stunTicks > 0) {
      w.swingImpact = 0;
    } else {
      w.swingImpact--;
      if (w.swingImpact === 0) resolveHammerHit(world, w.swingHeavy);
    }
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

  // 경직/회피 대시 중에는 아무것도 못 한다 (기억해 둔 입력도 버린다)
  if (world.player.stunTicks > 0 || world.player.dodgeTicks > 0) {
    w.meleeBufferTicks = 0;
    return;
  }

  // 근접 공격(우클릭, 오른손 해머) — 방어 중에도 나간다. 방패는 왼팔이니까.
  // 후딜 중에 누른 입력은 버리지 않고 기억했다가 풀리는 즉시 내보낸다 —
  // 안 그러면 자연스러운 속도로 두 번 클릭했을 때 2타가 통째로 사라진다
  const wantsMelee = world.input.meleePressed || (w.meleeBufferTicks ?? 0) > 0;
  if (wantsMelee && w.meleeCooldown <= 0 && w.swingImpact === 0) {
    w.meleeBufferTicks = 0;
    startHammerSwing(world);
    w.grenadeCharge = 0; // 근접을 섞으면 차징은 끊긴다
    return;
  }
  if (world.input.meleePressed) {
    w.meleeBufferTicks = balance.weapons.hammer.combo.bufferTicks;
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
      if (world.input.rangedPressed) world.events.emit('weapon_empty', { weapon: 'grenade' });
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
    // 빈 탄창 — 예비탄이 있으면 자동 장전, 예비까지 없으면 공이만 딸깍 (불발)
    if (w.reserve > 0) startReload(world);
    else world.events.emit('weapon_empty', { weapon: 'pistol' });
    return;
  }

  if (w.cooldown > 0) return;

  fire(world);
}

/** 해머 — 전방 부채꼴 내리치기. 근접 처치는 마나를 준다 (총과의 결정적 차이) */
/** 휘두르기 시작 — 모션과 소리만 내고, 실제 판정은 impactTicks 뒤에 한다 */
function startHammerSwing(world: World): void {
  const hammer = balance.weapons.hammer;
  const combo = hammer.combo;
  const w = world.weapon;
  const p = world.player;

  // 연속타 단계 진행 — 창이 끊겼으면 1타부터
  w.comboStep = (w.comboTimer > 0 ? w.comboStep : 0) + 1;
  const heavy = w.comboStep >= combo.finisherStep;
  w.swingHeavy = heavy;
  // 적중 가속 — 직전 타가 실제로 적을 때렸으면 예비동작이 짧아진다.
  // 뷰모델도 같은 배율로 빨라져야 해머가 닿는 시점과 그림이 어긋나지 않는다
  const rush = (w.meleeRushTicks ?? 0) > 0;
  const speedMul = rush ? 1 / combo.hitImpactMul : 1;
  const impact = heavy ? combo.heavyImpactTicks : hammer.impactTicks;
  w.swingImpact = rush ? Math.max(1, Math.round(impact * combo.hitImpactMul)) : impact;
  // 닿기 전에는 다시 휘두를 수 없다 (한 스윙에 두 번 들어가는 것을 막는다)
  w.meleeCooldown = w.swingImpact;

  // 거미줄 — 휘두를 때마다 한 겹씩 걷어낸다 (적을 맞힐 필요는 없다).
  // 시간·이동으로는 안 풀리므로 이게 유일한 해제 수단이다
  if ((p.webSwingsLeft ?? 0) > 0) {
    p.webSwingsLeft = (p.webSwingsLeft ?? 0) - 1;
    world.events.emit('web_torn', {
      left: p.webSwingsLeft,
      total: balance.web.breakSwings,
    });
    if (p.webSwingsLeft <= 0) world.events.emit('web_broken', { reason: 'hammer' });
  }

  world.events.emit('hammer_swing', { heavy, step: w.comboStep, speedMul, rush });
  alertNearby(world, p.x, p.z, hammer.noiseRadius * (heavy ? 2 : 1));
}

/** 해머가 닿는 순간의 판정 — 이 시점의 위치로 다시 잰다 (그 사이 빠져나갔으면 헛침) */
function resolveHammerHit(world: World, heavy: boolean): void {
  const hammer = balance.weapons.hammer;
  const combo = hammer.combo;
  const w = world.weapon;
  const p = world.player;

  const damage = heavy ? hammer.damage * combo.damageMul : hammer.damage;
  const range = heavy ? hammer.range * combo.rangeMul : hammer.range;
  const arcDeg = heavy ? hammer.arcDeg * combo.arcMul : hammer.arcDeg;
  const knockback = heavy ? hammer.knockback * combo.knockbackMul : hammer.knockback;
  let blockedRecoil = 0; // 방패에 튕긴 만큼 다음 스윙이 늦어진다

  const facingX = -Math.sin(p.yaw);
  const facingZ = -Math.cos(p.yaw);
  const arcCos = Math.cos(((arcDeg / 2) * Math.PI) / 180);
  let hitAny = false;
  let damagedAny = false; // 방패에 튕긴 것은 제외 — 적중 가속은 살을 때렸을 때만

  for (const enemy of world.enemies) {
    if (!enemy.alive) continue;
    const def = enemyDef(enemy.type);
    const toX = enemy.x - p.x;
    const toZ = enemy.z - p.z;
    const dist = Math.hypot(toX, toZ);
    if (dist > range + def.radius || dist === 0) continue;
    if ((facingX * toX + facingZ * toZ) / dist < arcCos) continue;

    // 정면 방패 — 해머는 피해를 주지 못하고 방패에 막힌다. 대신 방패병은 웅크려
    // 버티느라 아무 행동도 못 하고, 마무리 3타만 방패를 깎는다
    if (shieldBlocks(def, enemy, p.x, p.z)) {
      const sb = balance.shieldBreak;
      if (enemy.ai === 'idle') enemy.ai = 'chase';

      blockedRecoil += sb.blockedRecoilTicks; // 아래 후딜 계산에 더한다 (여기서 대입하면 덮어써진다)

      // 연타를 멈추지 않으면 방패로 밀쳐낸다 — 얼굴에 붙어 무한히 때리지 못하게
      // 마무리 타도 막아낸 것으로 센다 — 콤보를 이어 붙이면 결국 밀쳐낸다
      enemy.blockedStreak = (enemy.blockedStreak ?? 0) + 1;
      enemy.blockedStreakTicks = sb.blockedStreakDecayTicks;
      if (!heavy && enemy.blockedStreak >= sb.bashAfterBlocks && def.shieldBash) {
        // 실행은 Enemies가 한다 (시스템끼리 직접 부르지 않는다 — World 상태로만 전달)
        enemy.blockedStreak = 0;
        enemy.wantsBash = true;
        hitAny = true;
        continue;
      }
      enemy.braceTicks = Math.max(enemy.braceTicks ?? 0, sb.braceTicks);
      if (heavy) {
        // 마무리 타는 방패째 크게 밀어낸다 — 안 밀리면 제자리에서 무한 연타가 된다.
        // 밀리는 동안은 버티기 자세도 풀린다 (가드를 잃고 떠밀린다)
        enemy.braceTicks = 0;
        // 밀려난 뒤 확률적으로 달려들며 반격한다 (멀리서 걸어오면 위협이 없다)
        enemy.wantsCharge = Math.random() < balance.enemyAi.chargeChanceAfterKnockback;
        const kbTicks = sb.finisherKnockbackTicks;
        enemy.kbTicks = kbTicks;
        enemy.kbX = (toX / dist) * (sb.finisherKnockback / kbTicks);
        enemy.kbZ = (toZ / dist) * (sb.finisherKnockback / kbTicks);

        enemy.shieldHits = (enemy.shieldHits ?? 0) + 1;
        if (enemy.shieldHits >= sb.finisherHitsToBreak) {
          enemy.shieldBroken = true;
          world.events.emit('shield_broken', {
            enemyId: enemy.id,
            enemyType: enemy.type,
            x: enemy.x,
            z: enemy.z,
          });
        } else {
          world.events.emit('shield_cracked', {
            enemyId: enemy.id,
            hits: enemy.shieldHits,
            remaining: sb.finisherHitsToBreak - enemy.shieldHits,
          });
        }
      } else {
        world.events.emit('shield_braced', { enemyId: enemy.id, x: enemy.x, z: enemy.z });
      }
      hitAny = true; // 방패에 맞은 것도 헛스윙은 아니다
      continue;
    }

    // 상성 — warden 방어막은 근접 무효
    if (enemyDef(enemy.type).magicBarrier?.blocksMelee && enemy.ai !== 'staggered') {
      world.events.emit('barrier_blocked', { enemyId: enemy.id, kind: 'melee' });
      continue;
    }

    enemy.health -= damage;
    if (enemy.ai === 'idle') enemy.ai = 'chase';
    if (heavy) {
      // 마무리 강타에서만 밀어낸다 (보스는 밀리지 않는다)
      // 체급이 무거울수록 덜 밀린다 (경량 1.0 / 중량 0.5 / 중장 0.25)
      const byWeight = combo.knockbackByWeight as unknown as Record<string, number>;
      const weightMul = byWeight[def.weight] ?? 1;
      // 크게 밀려난 적은 확률적으로 달려들며 반격한다 (방패가 깨진 뒤에도 동일)
      if (def.chargeAttack) {
        enemy.wantsCharge = Math.random() < balance.enemyAi.chargeChanceAfterKnockback;
      }
      if (weightMul > 0) {
        // 멀리 밀되 미는 시간도 함께 늘린다 — 같은 속도로 더 멀리 (순간이동 방지)
        const kbTicks = Math.round(hammer.knockbackTicks * combo.knockbackTicksMul);
        enemy.kbTicks = kbTicks;
        enemy.kbX = (toX / dist) * ((knockback * weightMul) / kbTicks);
        enemy.kbZ = (toZ / dist) * ((knockback * weightMul) / kbTicks);
      }
    } else {
      // 1·2타는 밀치지 않고 그 자리에 굳힌다 — 밀려나면 연속타가 이어지지 않는다.
      // 공격 중이었다면 그 동작 그대로 얼어붙는다 (해머는 흐름을 끊을 수 있다)
      enemy.attackFreezeTicks = Math.max(enemy.attackFreezeTicks ?? 0, combo.chainFlinchTicks);
    }
    hitAny = true;
    damagedAny = true;
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
  // 헛쳤을 때의 추가 후딜은 마무리 3타에만 크게 붙인다. 1·2타에 그대로 물리면
  // 후딜이 연결 창보다 길어져 헛친 1타에서 2타가 아예 안 나간다 (실측으로 확인)
  const base = heavy ? hammer.cooldownTicks * combo.cooldownMul : combo.chainCooldownTicks;
  const whiffExtra = hitAny
    ? 0
    : heavy
      ? hammer.whiffExtraCooldownTicks
      : combo.chainWhiffExtraTicks;
  // 적중 가속 — 때린 만큼 후딜이 줄고, 그 상태가 rushWindowTicks 동안 이어진다.
  // 놓치면 즉시 원속도로 (때리는 손맛만 빨라지고 헛손질은 벌을 그대로 받는다)
  w.meleeRushTicks = damagedAny ? combo.rushWindowTicks : 0;
  const rushMul = damagedAny ? combo.hitCooldownMul : 1;
  w.meleeCooldown = Math.round(base * rushMul + whiffExtra + blockedRecoil);

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
  world.weapon.reloading = Math.round(
    balance.weapons.pistol.reloadTicks,
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
    if (shieldBlocksProjectile(def, hit.enemy, p.x, p.z)) {
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
