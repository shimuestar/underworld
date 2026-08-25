// 적 AI. 모든 근접 적은 공통 공격 상태 머신을 가진다 — docs/systems/combat.md §2.
//
//   idle → chase → windup → active_perfect(6t) → active_normal(12t) → impact → recover → chase
//                                                                  (패링 시 staggered / recover)
//
// 패링 불가 공격(적색)은 판정 창 없이 windup → impact.
// 원거리 캐스터(warden)는 windup 종료 시 투사체를 발사하고 recover로 간다.
// windup 진입 시 enemy_windup(오디오), 종료 visualLeadTicks 전에 telegraph_flash(섬광).

import { balance } from '../core/Balance';
import { attackReaches, currentAttack, enemyDef, type EnemyAttackDef } from '../core/Entities';
import { rayVsAabb } from '../core/Ray';
import { alertEnemy, playerBlocks, pushPlayer, type EnemyState, type World } from '../core/World';

let nextProjectileId = 100000; // 적 투사체 id 대역 (플레이어 투사체와 구분)

export function tick(world: World, dt: number): void {
  // 처형 연출 중 — 모든 적이 멈춘다. 플레이어의 마무리 동작이 온전히 보이도록
  if (world.executeFocusTicks > 0) {
    world.executeFocusTicks--;
    return;
  }

  for (const enemy of world.enemies) {
    if (!enemy.alive) continue;
    // 빙결 — AI 를 아예 안 돌린다: 이동·회전·공격 예고·돌진·방패 추적 전부 멈춘다.
    // 하던 동작은 얼음이 풀리면 그 자리에서 이어진다
    if ((enemy.freezeTicks ?? 0) > 0) {
      enemy.freezeTicks = (enemy.freezeTicks ?? 0) - 1;
      enemy.prevX = enemy.x;
      enemy.prevZ = enemy.z;
      if (enemy.freezeTicks === 0) {
        world.events.emit('enemy_freeze_ended', { enemyId: enemy.id, enemyType: enemy.type, x: enemy.x, z: enemy.z });
      }
      if ((enemy.slowTicks ?? 0) > 0) enemy.slowTicks = (enemy.slowTicks ?? 0) - 1;
      continue;
    }
    tickEnemy(world, enemy, dt);
    // 피탄 경직 소진은 행동 뒤에 — 앞에서 줄이면 마지막 틱에 움직여버린다
    if ((enemy.flinchTicks ?? 0) > 0) enemy.flinchTicks = (enemy.flinchTicks ?? 0) - 1;
    if ((enemy.slowTicks ?? 0) > 0) {
      enemy.slowTicks = (enemy.slowTicks ?? 0) - 1;
      // 둔화까지 다 풀리는 순간 — 서리 겹도 사라진다 (다시 처음부터 쌓아야 언다)
      if (enemy.slowTicks === 0) {
        enemy.frostStacks = 0;
        world.events.emit('enemy_thawed', { enemyId: enemy.id, enemyType: enemy.type, x: enemy.x, z: enemy.z });
      }
    }
  }
  resolveEnemyOverlaps(world);
}

/** 서로 파고든 적들을 밀어낸다. 한 틱에 완전히 떼어내지 않고 절반씩 나눠 밀어
 *  좁은 통로에서 교착되지 않게 한다 (조향만으로는 몸통이 겹쳐 보인다) */
function resolveEnemyOverlaps(world: World): void {
  const ratio = balance.enemyAi.separation.pushRatio;
  const list = world.enemies.filter((e) => e.alive);
  for (let i = 0; i < list.length; i++) {
    const a = list[i]!;
    const ra = enemyDef(a.type).radius;
    for (let j = i + 1; j < list.length; j++) {
      const b = list[j]!;
      const minDist = ra + enemyDef(b.type).radius;
      let dx = b.x - a.x;
      let dz = b.z - a.z;
      let dist = Math.hypot(dx, dz);
      if (dist >= minDist) continue;
      if (dist < 1e-4) {
        dx = 1;
        dz = 0;
        dist = 1;
      }
      const push = (minDist - dist) * 0.5 * ratio;
      const nx = (dx / dist) * push;
      const nz = (dz / dist) * push;
      world.level.slideMove(a, ra, -nx, -nz);
      world.level.slideMove(b, enemyDef(b.type).radius, nx, nz);
    }
  }
}

function tickEnemy(world: World, enemy: EnemyState, dt: number): void {
  const def = enemyDef(enemy.type);
  const p = world.player;

  enemy.prevX = enemy.x;
  enemy.prevZ = enemy.z;
  enemy.prevJumpY = enemy.jumpY ?? 0;

  // 밀려난 뒤 돌격 — chase 진입을 기다리지 않는다 (공격 도중 밀려나면 그 상태로 남아
  // 영영 돌격하지 못했다). 밀리는 중에는 판단하지 않는다 — 아직 가까워서 취소돼 버린다
  if (enemy.wantsCharge && def.chargeAttack && (enemy.kbTicks ?? 0) <= 0) {
    const cdx = p.x - enemy.x;
    const cdz = p.z - enemy.z;
    const cdist = Math.hypot(cdx, cdz);
    if (cdist < (def.chargeAttack.minRange ?? 0)) {
      enemy.wantsCharge = false; // 이미 붙었으면 취소
    } else if (world.level.hasLineOfSight(enemy.x, enemy.z, p.x, p.z)) {
      enemy.wantsCharge = false;
      enemy.braceTicks = 0;
      enemy.attackFreezeTicks = 0;
      enemy.attackMode = 'charge';
      enemy.yaw = Math.atan2(-cdx, -cdz);
      startWindup(world, enemy, def.chargeAttack);
      world.events.emit('enemy_charge', {
        enemyId: enemy.id,
        enemyType: enemy.type,
        dist: cdist,
      });
      return;
    }
  }

  // 방패 밀쳐내기 — 버티기보다 우선한다 (웅크린 자세를 풀고 밀어낸다)
  if (enemy.wantsBash && def.shieldBash) {
    enemy.wantsBash = false;
    enemy.braceTicks = 0;
    enemy.attackFreezeTicks = 0;
    enemy.attackMode = 'bash';
    enemy.yaw = Math.atan2(-(p.x - enemy.x), -(p.z - enemy.z));
    startWindup(world, enemy, def.shieldBash);
    world.events.emit('shield_bash_start', { enemyId: enemy.id, enemyType: enemy.type });
    return;
  }

  if ((enemy.volleyCooldown ?? 0) > 0) enemy.volleyCooldown = (enemy.volleyCooldown ?? 0) - 1;
  if ((enemy.chargeCooldown ?? 0) > 0) enemy.chargeCooldown = (enemy.chargeCooldown ?? 0) - 1;

  // 연타를 멈추면 막아낸 기록이 사라진다 (붙어서 계속 때릴 때만 밀쳐내기가 나간다)
  if ((enemy.blockedStreakTicks ?? 0) > 0) {
    enemy.blockedStreakTicks = (enemy.blockedStreakTicks ?? 0) - 1;
    if (enemy.blockedStreakTicks === 0) enemy.blockedStreak = 0;
  }

  // 넉백 — 떠밀리는 동안은 버티기·경직보다 우선한다 (벽에는 막힘)
  // 밀려나는 동안은 휘청여서 다른 행동을 못 한다 (벽에는 막힘)
  if ((enemy.kbTicks ?? 0) > 0) {
    enemy.kbTicks = (enemy.kbTicks ?? 0) - 1;
    world.level.slideMove(enemy, def.radius, enemy.kbX ?? 0, enemy.kbZ ?? 0);
    return;
  }

  // 방패로 버티는 중 — 웅크린 채 아무 행동도 하지 않는다 (해머 연타를 받아내는 동안)
  if ((enemy.braceTicks ?? 0) > 0) {
    enemy.braceTicks = (enemy.braceTicks ?? 0) - 1;
    enemy.yaw = Math.atan2(-(p.x - enemy.x), -(p.z - enemy.z)); // 방패는 계속 플레이어를 향한다
    return;
  }

  // 강타 경직 — 예비동작이든 타격 중이든 그 상태 그대로 멈춘다.
  // 상태도 타이머도 진행하지 않으므로 공격이 취소되지 않고 "얼어붙는다"
  if ((enemy.attackFreezeTicks ?? 0) > 0) {
    enemy.attackFreezeTicks = (enemy.attackFreezeTicks ?? 0) - 1;
    return;
  }

  const distX = p.x - enemy.x;
  const distZ = p.z - enemy.z;
  const dist = Math.hypot(distX, distZ);
  const attack = currentAttack(def, enemy);

  // 알아챈 직후 멈칫 — 몸은 플레이어 쪽으로 돌리되 발도 무기도 나가지 않는다.
  // 느낌표가 뜨자마자 달려들면 표시를 읽을 틈이 없다
  if ((enemy.noticeTicks ?? 0) > 0) {
    enemy.noticeTicks = (enemy.noticeTicks ?? 0) - 1;
    enemy.yaw = Math.atan2(-distX, -distZ);
    return;
  }

  switch (enemy.ai) {
    case 'idle': {
      // 가만히 서 있어도 천천히 좌우를 살핀다 — 사각이 고정되면 한 자리에서
      // 영영 안 들킨다. id 로 위상을 흩어 전원이 같은 방향을 보지 않게 한다
      const scan = balance.enemyAi.vision;
      enemy.yaw =
        (enemy.homeYaw ?? 0) +
        Math.sin(((world.tick + enemy.id * 37) / scan.scanTicks) * Math.PI * 2) *
          ((scan.scanArcDeg * Math.PI) / 360);

      // 랜턴 빔에 잡히면 시야각과 무관하게 즉시 알아챈다 — 어둠 속에서 빛을
      // 든 쪽이 먼저 들킨다. 벽 너머는 안 보이므로 시야선은 그대로 요구한다
      const lit = litByLantern(world, dist, distX, distZ);
      if (
        (lit || (dist <= def.aggroRange && seesPlayer(enemy, dist, distX, distZ))) &&
        world.level.hasLineOfSight(enemy.x, enemy.z, p.x, p.z)
      ) {
        alertEnemy(enemy, balance.enemyAi.noticeDelayTicks);
        world.events.emit('enemy_alerted', { enemyId: enemy.id, enemyType: enemy.type, lantern: lit });
        // 보스가 깨면 포효로 방 전체가 함께 깬다 — 벽 너머라도 소리는 들린다
        if (def.boss) wakeAround(world, enemy, balance.enemyAi.bossAlertRadius);
      }
      break;
    }

    case 'chase': {
      enemy.yaw = Math.atan2(-distX, -distZ);

      if (def.behavior === 'caster_kite') {
        // 너무 가까우면 물러나고, 시야가 트이면 시전
        if (dist < (def.kiteMinRange ?? 0) && dist > 0) {
          moveAvoiding(world, enemy, def, -distX / dist, -distZ / dist, moveSpeed(enemy, def) * dt);
        } else if (
          dist <= def.attackRange &&
          world.level.hasLineOfSight(enemy.x, enemy.z, p.x, p.z)
        ) {
          // 아군이 사선을 막으면 쏘지 않고 옆으로 이동해 각을 잡는다.
          // giveUpTicks(10초)는 아군이 영영 비켜주지 않는 교착을 푸는 안전장치일 뿐이다 —
          // 일부러 아군을 쏘게 하면 적이 바보처럼 보인다
          const blocker = blockingAlly(world, enemy, def, attack);
          const blockedTicks = enemy.strafeBlockedTicks ?? 0;
          if (blocker && blockedTicks < strafeCfg.giveUpTicks) {
            strafeForAngle(world, enemy, def, blocker, distX, distZ, dist, dt);
            break;
          }
          if (!blocker) enemy.strafeBlockedTicks = 0; // 각이 났다 (막힌 채면 포기 상태 유지)
          startWindup(world, enemy, attack);
        } else if (dist > 0) {
          moveAvoiding(world, enemy, def, distX / dist, distZ / dist, moveSpeed(enemy, def) * dt);
        }
        break;
      }

      if (dist <= def.attackRange) {
        enemy.attackMode = 'melee';
        startWindup(world, enemy, currentAttack(def, enemy));
        break;
      }
      // 돌격 — 중거리(minRange~maxRange)에 들어오면 달려들며 내리찍는다.
      // maxRange 가 있는 돌격만 거리로 발동한다 (창병처럼 wantsCharge 로 쓰는 쪽과 구분)
      const ch = def.chargeAttack;
      if (
        ch?.maxRange !== undefined &&
        (enemy.chargeCooldown ?? 0) <= 0 &&
        dist >= (ch.minRange ?? 0) &&
        dist <= ch.maxRange &&
        world.level.hasLineOfSight(enemy.x, enemy.z, p.x, p.z)
      ) {
        enemy.attackMode = 'charge';
        enemy.chargeCooldown = ch.cooldownTicks ?? 0;
        startWindup(world, enemy, ch);
        world.events.emit('enemy_charge', { enemyId: enemy.id, enemyType: enemy.type, dist });
        break;
      }

      // 화살 세례 — 큰 기술이라 쿨다운이 돌고, 붙어 있으면 쓰지 않는다
      if (
        def.volleyAttack &&
        (enemy.volleyCooldown ?? 0) <= 0 &&
        dist >= (def.volleyAttack.minRange ?? 0) &&
        world.level.hasLineOfSight(enemy.x, enemy.z, p.x, p.z)
      ) {
        enemy.attackMode = 'volley';
        startWindup(world, enemy, def.volleyAttack);
        world.events.emit('enemy_volley_start', {
          enemyId: enemy.id,
          enemyType: enemy.type,
          shots: def.volleyAttack.shots ?? 1,
        });
        break;
      }
      // 원거리 보조 공격 (족장 바위 투척) — 근접 거리 밖 + 시야 확보 시
      if (
        def.rangedAttack &&
        dist >= (def.rangedAttack.minRange ?? 0) &&
        world.level.hasLineOfSight(enemy.x, enemy.z, p.x, p.z)
      ) {
        enemy.attackMode = 'ranged';
        startWindup(world, enemy, def.rangedAttack);
        break;
      }
      if (dist > 0) {
        moveAvoiding(world, enemy, def, distX / dist, distZ / dist, moveSpeed(enemy, def) * dt);
      }
      break;
    }

    case 'windup': {
      // 붙었으면 던지기를 접고 해머로 바꾼다 — 코앞에서 화살을 쏘고 있으면 안 된다
      if (attack.abortRange !== undefined && dist <= attack.abortRange) {
        enemy.ai = 'chase';
        enemy.attackMode = 'melee';
        world.events.emit('enemy_hold_fire', { enemyId: enemy.id, enemyType: enemy.type });
        break;
      }
      // 원거리 시전은 발사 순간의 플레이어 위치로 날아간다 — 시전 중 몸이 굳어 있으면
      // 충전 구체와 실제 발사 방향이 어긋난다. 근접 공격은 그대로 둔다
      // (시전 중에도 몸을 돌리면 옆으로 비켜 피하는 플레이가 죽는다)
      if (attack.type === 'projectile' && dist > 0) enemy.yaw = Math.atan2(-distX, -distZ);
      enemy.timer--;
      if (enemy.timer === balance.telegraph.visualLeadTicks) {
        world.events.emit('telegraph_flash', { enemyId: enemy.id, enemyType: enemy.type });
      }
      if (enemy.timer > 0) break;

      if (attack.type === 'projectile') {
        // 쏘기 직전 사선을 한 번 더 확인 — 겨누는 0.5초 사이 아군이 끼어들 수 있다.
        // 끼어들었으면 쏘지 않고 내린다 (아군 등에 쏘는 것보다 훨씬 낫다)
        // (교착을 풀려고 포기한 상태라면 그대로 쏜다 — 안전장치)
        const givenUp = (enemy.strafeBlockedTicks ?? 0) >= strafeCfg.giveUpTicks;
        if (!givenUp && blockingAlly(world, enemy, def, attack)) {
          enemy.ai = 'chase';
          enemy.strafeBlockedTicks = 1; // 바로 다시 겨누지 말고 각부터 잡는다
          world.events.emit('enemy_hold_fire', { enemyId: enemy.id, enemyType: enemy.type });
          break;
        }
        // 시전 완료 — 연사면 첫 발부터 volley 상태로, 아니면 한 발 쏘고 후딜
        enemy.strafeBlockedTicks = 0;
        if ((attack.shots ?? 1) > 1) {
          enemy.ai = 'volley';
          enemy.volleyLeft = attack.shots!;
          enemy.timer = 0; // 예고가 끝나는 즉시 첫 발
          break;
        }
        fireProjectile(world, enemy, attack);
        enemy.ai = 'recover';
        enemy.timer = attack.recoverTicks;
      } else if (attack.chargeRunTicks) {
        // 돌격 — 타격 전에 따로 달리는 구간.
        // 겨냥은 여기서 한 번만 한다: 예고가 끝나는 순간의 플레이어 자리로 고정.
        // 달리면서 추적하면 옆으로 비켜도 따라와 회피가 성립하지 않는다
        enemy.ai = 'charging';
        enemy.timer = attack.chargeRunTicks;
        enemy.chargeTargetX = p.x;
        enemy.chargeTargetZ = p.z;
      } else if (attack.parryable) {
        enemy.ai = 'active_perfect';
        enemy.timer = balance.reaction.windowPerfectTicks;
      } else {
        // 패링 불가 — 판정 창 없이 즉시 타격
        enemy.ai = 'impact';
      }
      break;
    }

    // active_perfect / active_normal 은 이제 "타격 이동 구간"의 앞·뒤 절반일 뿐이다.
    // 완벽/일반 판정은 상태가 아니라 무기 끝과 가드의 거리(Reaction)가 정한다.
    case 'active_perfect': {
      enemy.timer--;
      advanceStrike(enemy, def, attack);
      chargeForward(world, enemy, def, attack, distX, distZ, dist, dt);
      if (enemy.timer <= 0) {
        enemy.ai = 'active_normal';
        enemy.timer = balance.reaction.windowNormalTicks;
      }
      break;
    }

    case 'active_normal': {
      enemy.timer--;
      advanceStrike(enemy, def, attack);
      chargeForward(world, enemy, def, attack, distX, distZ, dist, dt);
      if (enemy.timer <= 0) enemy.ai = 'impact';
      break;
    }

    // 돌격 달리기 — 사거리에 들거나 시간이 다하면 타격으로 넘어간다.
    // 이 구간은 패링 대상이 아니다 (판정은 붙은 뒤 타격 창에서 열린다)
    case 'charging': {
      enemy.timer--;
      // 도약 — 달리는 구간 내내 포물선으로 뜬다. 착지(t=1)에 정확히 0이 되게
      // 4t(1-t) 를 쓴다. 판정은 XZ 그대로라 높이는 순전히 "몸을 던진다"는 그림이다
      if (attack.leapHeight) {
        const total = attack.chargeRunTicks ?? 1;
        const t = Math.min(1, Math.max(0, 1 - enemy.timer / total));
        enemy.jumpY = attack.leapHeight * 4 * t * (1 - t);
      }
      // 고정된 목표 지점으로만 달린다 (플레이어를 다시 보지 않는다)
      const tx = enemy.chargeTargetX ?? p.x;
      const tz = enemy.chargeTargetZ ?? p.z;
      const tdx = tx - enemy.x;
      const tdz = tz - enemy.z;
      const tdist = Math.hypot(tdx, tdz);
      if (tdist > 0.01) {
        enemy.yaw = Math.atan2(-tdx, -tdz);
        moveAvoiding(world, enemy, def, tdx / tdist, tdz / tdist, attack.chargeSpeed! * slowFactor(enemy) * dt);
      }
      // 겨눈 자리에 닿았거나(몸 반경), 플레이어가 그대로 서 있어 이미 사거리거나, 시간이 다하면 친다
      if (tdist <= def.radius || dist <= def.attackRange || enemy.timer <= 0) {
        enemy.jumpY = 0; // 착지 — 몸통 박치기는 땅에 닿는 순간 들어간다
        if (attack.parryable) {
          enemy.ai = 'active_perfect';
          enemy.timer = balance.reaction.windowPerfectTicks;
        } else {
          enemy.ai = 'impact';
        }
      }
      break;
    }

    // 연사 — 제자리에서 계속 조준하며 일정 간격으로 쏜다. 옆으로 계속 움직여 피한다
    case 'volley': {
      // 붙어 오면 연사를 끊고 해머로 — 남은 발수는 버리고 쿨다운은 그대로 문다
      if (attack.abortRange !== undefined && dist <= attack.abortRange) {
        enemy.ai = 'chase';
        enemy.attackMode = 'melee';
        enemy.volleyLeft = 0;
        enemy.volleyCooldown = attack.cooldownTicks ?? 0;
        world.events.emit('enemy_hold_fire', { enemyId: enemy.id, enemyType: enemy.type });
        break;
      }
      if (dist > 0) enemy.yaw = Math.atan2(-distX, -distZ);
      if (enemy.timer > 0) {
        enemy.timer--;
        break;
      }
      fireProjectile(world, enemy, attack);
      enemy.volleyLeft = (enemy.volleyLeft ?? 1) - 1;
      world.events.emit('enemy_volley_shot', {
        enemyId: enemy.id,
        enemyType: enemy.type,
        left: enemy.volleyLeft,
      });
      if (enemy.volleyLeft <= 0) {
        enemy.ai = 'recover';
        enemy.timer = attack.recoverTicks;
        enemy.volleyCooldown = attack.cooldownTicks ?? 0;
        enemy.attackMode = 'melee';
      } else {
        enemy.timer = attack.shotIntervalTicks ?? 30;
      }
      break;
    }

    case 'impact': {
      const connected = attackReaches(def, enemy, attack, p.x, p.z) && p.iframeTicks <= 0;
      if (connected) {
        // 방어(정면) — 칩 데미지만 관통. 피해가 있으므로 연쇄는 여전히 리셋된다
        const blocked = playerBlocks(world, enemy.x, enemy.z, balance.block.arcDeg);
        const base = attack.damage ?? def.damage; // 공격별 피해 재정의 (방패 밀쳐내기 등)
        // 방어 관통 비율도 공격별로 열어 둔다 — 돌격처럼 몸으로 받으면 안 되는 기술은 더 아프다
        const chip = attack.blockedDamageRatio ?? balance.block.chipDamageRatio;
        const damage = blocked ? base * chip : base;
        p.health -= damage;
        if (enemy.parryStreak !== undefined) enemy.parryStreak = 0; // 연속 패링 끊김

        // 뒤로 밀림 — 무기가 무거울수록 크게. 방어 중이면 버티므로 1/3
        const kb = balance.playerKnockback as unknown as Record<string, number>;
        const pushBase = attack.playerKnockback ?? kb[attack.type] ?? kb['contact']!;
        const blockedMul = attack.blockedKnockbackMul ?? kb['blockedMul']!;
        const push = pushBase * (blocked ? blockedMul : 1);
        pushPlayer(
          p,
          p.x - enemy.x,
          p.z - enemy.z,
          push,
          attack.playerKnockbackTicks ?? balance.playerKnockback.ticks,
        );

        if (blocked) {
          // 방패 격돌 — 양쪽이 잠깐 굳는다. 적이 더 오래 굳어 반격 창이 열린다.
          // 단 blockCannotStagger(족장)는 튕기지 않는다 — 막아도 공격이 끊기지 않고
          // 플레이어만 굳는다. 보스는 패링하거나 비켜야 한다
          const clash = balance.block;
          p.stunTicks = Math.max(p.stunTicks, clash.clashPlayerStunTicks);
          world.events.emit('block_hit', { amount: damage, kind: 'melee' });
          if (!def.blockCannotStagger) {
            enemy.recoiled = true;
            world.freezeTicks = Math.max(world.freezeTicks, clash.clashHitstopTicks);
            world.events.emit('guard_clash', {
              kind: 'block',
              enemyId: enemy.id,
              enemyType: enemy.type,
              x: enemy.x,
              z: enemy.z,
            });
          }
        }
        world.events.emit('player_damaged', { amount: damage, health: p.health, blocked });
        if (p.health <= 0) {
          p.health = 0;
          world.dead = true;
          world.events.emit('player_died', { tick: world.tick });
        }
      }
      // 지면 강타 — 맞았든 빗나갔든 땅은 울린다. 소리·화면 흔들림은 main 이 붙인다
      if (attack.aoeRadius !== undefined) {
        world.events.emit('ground_slam', {
          enemyId: enemy.id,
          enemyType: enemy.type,
          x: enemy.x,
          z: enemy.z,
          radius: attack.aoeRadius,
          dist: Math.hypot(p.x - enemy.x, p.z - enemy.z),
        });
      }

      // 헛쳤으면 긴 경직 — 마지막 동작 그대로 굳어 무방비가 된다 (반격 창)
      enemy.ai = 'recover';
      enemy.whiffed = !connected && attack.whiffRecoverTicks !== undefined;
      enemy.timer = enemy.whiffed ? attack.whiffRecoverTicks! : attack.recoverTicks;
      // 방패에 막혔으면 튕겨 나가 후딜이 더 붙는다 (기본 후딜에 가산)
      if (enemy.recoiled) enemy.timer += balance.block.clashEnemyRecoilTicks;
      if (enemy.whiffed) {
        world.events.emit('enemy_whiffed', {
          enemyId: enemy.id,
          enemyType: enemy.type,
          ticks: enemy.timer,
        });
      }
      break;
    }

    case 'recover': {
      enemy.timer--;
      if (enemy.timer <= 0) {
        enemy.ai = 'chase';
        enemy.whiffed = false;
        enemy.recoiled = false;
      }
      break;
    }

    case 'staggered': {
      enemy.timer--;
      if (enemy.timer <= 0) {
        enemy.ai = 'recover';
        enemy.timer = attack.recoverTicks;
      }
      break;
    }
  }
}

/** 대기 중인 적이 플레이어를 '보는가' — 전방 시야각 안이거나 코앞이면 본다.
 *  소리(총성·폭발·포효)는 이 함수를 거치지 않는다. 각과 무관하게 깨우는 게 맞다 */
function seesPlayer(
  enemy: EnemyState,
  dist: number,
  distX: number,
  distZ: number,
): boolean {
  const vision = balance.enemyAi.vision;
  if (dist <= vision.noticeRadius) return true; // 등에 붙어 있으면 인기척으로 안다
  if (dist <= 0.001) return true;
  const facingX = -Math.sin(enemy.yaw);
  const facingZ = -Math.cos(enemy.yaw);
  const dot = (facingX * distX + facingZ * distZ) / dist;
  return dot >= Math.cos((vision.arcDeg * Math.PI) / 360);
}

/** 플레이어의 랜턴 빔이 이 적을 비추고 있는가.
 *  빔 축은 시선(yaw) — 위아래(pitch)는 보지 않는다. 빔이 세로로도 퍼지고
 *  적은 키가 있어서, 고개를 조금 숙였다고 안 비친 것으로 치면 어색하다 */
function litByLantern(world: World, dist: number, distX: number, distZ: number): boolean {
  const lp = balance.lantern;
  const lantern = world.lantern;
  if (!lantern.on || lantern.battery <= 0) return false;
  if (dist > lp.noticeRange || dist <= 0.001) return false;
  const p = world.player;
  const beamX = -Math.sin(p.yaw);
  const beamZ = -Math.cos(p.yaw);
  // distX/distZ 는 적 → 플레이어 방향이므로 뒤집어서 쓴다
  const dot = (beamX * -distX + beamZ * -distZ) / dist;
  return dot >= Math.cos((lp.angleDeg * Math.PI) / 180);
}

/** 포효 — 반경 안에서 자고 있던 적을 전부 깨운다. 시야는 보지 않는다(소리로 듣는다).
 *  보스 조우가 곧 방 전체와의 조우가 되게 하는 장치다 */
function wakeAround(world: World, source: EnemyState, radius: number): void {
  for (const other of world.enemies) {
    if (other === source || !other.alive || other.ai !== 'idle') continue;
    if (Math.hypot(other.x - source.x, other.z - source.z) > radius) continue;
    alertEnemy(other, balance.enemyAi.noticeDelayTicks);
    world.events.emit('enemy_alerted', { enemyId: other.id, enemyType: other.type });
  }
}

const strafeCfg = balance.enemyAi.strafe;

/** 주변 아군에게서 밀려나는 방향 — 일렬로 겹쳐 서지 않게 한다 (반환값은 정규화 전) */
function separation(world: World, enemy: EnemyState): { x: number; z: number } {
  const cfg = balance.enemyAi.separation;
  let sx = 0;
  let sz = 0;
  for (const other of world.enemies) {
    if (other === enemy || !other.alive) continue;
    const dx = enemy.x - other.x;
    const dz = enemy.z - other.z;
    const d = Math.hypot(dx, dz);
    if (d === 0 || d > cfg.radius) continue;
    const weight = (cfg.radius - d) / cfg.radius; // 가까울수록 세게
    sx += (dx / d) * weight;
    sz += (dz / d) * weight;
  }
  return { x: sx, z: sz };
}

/** 목표 방향 + 아군 회피를 합쳐 한 발짝 이동. 피탄 경직 중에는 발이 묶인다 */
/** 서리 둔화 배율 — 빙결이 풀린 뒤 slowTicks 가 남아 있는 동안 slowMul, 아니면 1.
 *  걷기·옆걸음·돌진이 전부 이걸 탄다 (돌진만 빠지면 "얼렸는데 달려든다"가 된다) */
function slowFactor(enemy: EnemyState): number {
  return (enemy.slowTicks ?? 0) > 0 ? (enemy.slowMul ?? 1) : 1;
}

/** 이동 속도 — 둔화 배율을 곱한다 (공격 리듬은 그대로다) */
function moveSpeed(enemy: EnemyState, def: ReturnType<typeof enemyDef>): number {
  return def.speed * slowFactor(enemy);
}

function moveAvoiding(
  world: World,
  enemy: EnemyState,
  def: ReturnType<typeof enemyDef>,
  dirX: number,
  dirZ: number,
  step: number,
): void {
  if ((enemy.flinchTicks ?? 0) > 0) return; // 총에 맞아 움찔 — 이번 틱은 못 움직인다
  const sep = separation(world, enemy);
  const strength = balance.enemyAi.separation.strength;
  let mx = dirX + sep.x * strength;
  let mz = dirZ + sep.z * strength;
  const len = Math.hypot(mx, mz);
  if (len === 0) return;
  mx /= len;
  mz /= len;
  world.level.slideMove(enemy, def.radius, mx * step, mz * step);

  // 플레이어 몸통을 통과할 수 없다 — 파고들었으면 자기가 물러난다
  const p = world.player;
  const minDist = balance.player.radius + def.radius;
  const dx = enemy.x - p.x;
  const dz = enemy.z - p.z;
  const d = Math.hypot(dx, dz);
  if (d > 0 && d < minDist) {
    world.level.slideMove(enemy, def.radius, (dx / d) * (minDist - d), (dz / d) * (minDist - d));
  }
}

/** 발사선을 가로막는 아군 — 실제 투사체와 같은 기하로 예측한다 (Projectiles와 동일 규칙) */
function blockingAlly(
  world: World,
  enemy: EnemyState,
  def: ReturnType<typeof enemyDef>,
  attack: EnemyAttackDef,
): EnemyState | null {
  const p = world.player;
  const originY = def.height * 0.7;
  const targetY = p.y + balance.player.eyeHeight * 0.8;
  const dx = p.x - enemy.x;
  const dy = targetY - originY;
  const dz = p.z - enemy.z;
  const len = Math.hypot(dx, dy, dz);
  if (len === 0) return null;
  const dirX = dx / len;
  const dirY = dy / len;
  const dirZ = dz / len;

  const projRadius = attack.projectileRadius ?? 0.3;
  const muzzle = def.radius + projRadius;
  const ox = enemy.x + dirX * muzzle;
  const oz = enemy.z + dirZ * muzzle;

  // 플레이어까지의 거리 — 이보다 앞에 있는 아군만 사선을 막는다
  const pr = balance.player.radius + projRadius;
  const playerT =
    rayVsAabb(ox, originY, oz, dirX, dirY, dirZ, {
      minX: p.x - pr,
      minY: -projRadius,
      minZ: p.z - pr,
      maxX: p.x + pr,
      maxY: balance.player.height + projRadius,
      maxZ: p.z + pr,
    }) ?? Infinity;

  let nearest: EnemyState | null = null;
  let nearestT = playerT;
  for (const other of world.enemies) {
    if (!other.alive || other.id === enemy.id) continue;
    const od = enemyDef(other.type);
    const t = rayVsAabb(ox, originY, oz, dirX, dirY, dirZ, {
      minX: other.x - od.radius - projRadius,
      minY: -projRadius,
      minZ: other.z - od.radius - projRadius,
      maxX: other.x + od.radius + projRadius,
      maxY: od.height + projRadius,
      maxZ: other.z + od.radius + projRadius,
    });
    if (t !== null && t < nearestT) {
      nearestT = t;
      nearest = other;
    }
  }
  return nearest;
}

/** 사선이 트일 때까지 플레이어를 중심으로 옆걸음. 막힌 아군 반대쪽으로 시작한다 */
function strafeForAngle(
  world: World,
  enemy: EnemyState,
  def: ReturnType<typeof enemyDef>,
  blocker: EnemyState,
  distX: number,
  distZ: number,
  dist: number,
  dt: number,
): void {
  if ((enemy.flinchTicks ?? 0) > 0) return; // 움찔하는 동안은 각도 못 잡는다
  const perpX = -distZ / dist;
  const perpZ = distX / dist;
  const ticks = (enemy.strafeBlockedTicks ?? 0) + 1;
  enemy.strafeBlockedTicks = ticks;

  if (ticks === 1) {
    // 막은 아군의 반대쪽으로 — 더 빨리 트인다
    const lateral = perpX * (blocker.x - enemy.x) + perpZ * (blocker.z - enemy.z);
    enemy.strafeDir = lateral > 0 ? -1 : 1;
    world.events.emit('enemy_repositioning', {
      enemyId: enemy.id,
      enemyType: enemy.type,
      blockedBy: blocker.id,
    });
  } else if (ticks % strafeCfg.flipAfterTicks === 0) {
    // 그 방향으로 끝까지 가도 안 트이면 반대쪽으로 (우물쭈물하지 않고 크게 돈다)
    enemy.strafeDir = -(enemy.strafeDir ?? 1);
  }

  const dir = enemy.strafeDir ?? 1;
  const step = moveSpeed(enemy, def) * strafeCfg.speedMul * dt;
  const beforeX = enemy.x;
  const beforeZ = enemy.z;
  world.level.slideMove(enemy, def.radius, perpX * step * dir, perpZ * step * dir);
  // 벽에 막혀 제자리면 즉시 반대쪽으로
  if (Math.hypot(enemy.x - beforeX, enemy.z - beforeZ) < step * 0.3) {
    enemy.strafeDir = -dir;
  }
}

/** 돌격 공격의 타격 구간 — 플레이어를 향해 달려든다. 사거리 안에 들면 멈춘다 */
function chargeForward(
  world: World,
  enemy: EnemyState,
  def: ReturnType<typeof enemyDef>,
  attack: EnemyAttackDef,
  distX: number,
  distZ: number,
  dist: number,
  dt: number,
): void {
  if (!attack.chargeSpeed || dist <= 0) return;
  // 달리기 구간(charging)이 따로 있는 돌격은 거기서 이미 좁혔다. 타격 창에서까지
  // 플레이어를 향해 움직이면 고정 좌표로 달린 의미가 없어진다 — 비켜도 따라온다
  if (attack.chargeRunTicks !== undefined) return;
  if (dist <= def.attackRange) return; // 이미 닿는 거리 — 더 파고들지 않는다
  enemy.yaw = Math.atan2(-distX, -distZ); // 달려드는 동안은 방향을 갱신한다
  moveAvoiding(world, enemy, def, distX / dist, distZ / dist, attack.chargeSpeed * slowFactor(enemy) * dt);
}

/** 무기가 닿는 최대 거리 (적 중심 기준) — impact 판정 거리와 같아야 한다 */
export function fullReach(def: ReturnType<typeof enemyDef>, attack: EnemyAttackDef): number {
  return def.attackRange * attack.impactRangeMul;
}

/** 타격 진행도에 따라 무기 끝 거리를 갱신. 예비동작에서 당겨진 위치부터 최대 사거리까지 */
function advanceStrike(
  enemy: EnemyState,
  def: ReturnType<typeof enemyDef>,
  attack: EnemyAttackDef,
): void {
  const total = balance.reaction.windowPerfectTicks + balance.reaction.windowNormalTicks;
  const elapsed =
    enemy.ai === 'active_perfect'
      ? balance.reaction.windowPerfectTicks - enemy.timer
      : balance.reaction.windowPerfectTicks + (balance.reaction.windowNormalTicks - enemy.timer);
  const t = Math.max(0, Math.min(1, elapsed / total));
  // 가속 곡선 — 판정 창(6+12틱)은 건드리지 않고 뻗는 속도만 바꾼다.
  // ease>1 이면 앞쪽에서 확 뻗으므로 창끝이 패링 대역에 일찍 들어와 더 오래 머문다
  const ease = attack.strikeEase ?? 1;
  const progress = ease === 1 ? t : 1 - Math.pow(1 - t, ease);
  const reach = fullReach(def, attack);
  const rest = reach * balance.parrySpace.pullbackRatio;
  enemy.strikeProgress = progress;
  enemy.weaponTipDist = rest + (reach - rest) * progress;
}

function startWindup(world: World, enemy: EnemyState, attack: EnemyAttackDef): void {
  enemy.ai = 'windup';
  enemy.timer = attack.windupTicks;
  enemy.whiffed = false;
  enemy.recoiled = false;
  enemy.strikeProgress = 0;
  enemy.weaponTipDist = fullReach(enemyDef(enemy.type), attack) * balance.parrySpace.pullbackRatio;
  world.events.emit('enemy_windup', {
    enemyId: enemy.id,
    enemyType: enemy.type,
    telegraph: attack.telegraph ?? 'blue',
  });
}

function fireProjectile(world: World, enemy: EnemyState, attack: EnemyAttackDef): void {
  const def = enemyDef(enemy.type);
  const p = world.player;
  // 무기 든 손 높이/옆 오프셋 — Stage 의 팔 피벗(radius×0.85, height×0.72)과 같은 값을
  // 데이터로 받는다. 없으면 예전처럼 몸 중심에서 나간다
  const originY = def.height * (attack.muzzleHeightMul ?? 0.7);
  const targetY = p.y + balance.player.eyeHeight * 0.8;
  const toX = p.x - enemy.x;
  const toZ = p.z - enemy.z;
  const flat = Math.hypot(toX, toZ);
  if (flat === 0) return;
  const speed = attack.projectileSpeed ?? 12;

  // 발사 지점 — 몸 밖으로 muzzle 만큼, 무기를 쥔 손 쪽으로 side 만큼.
  // 몸 밖에서 쏘는 건 밀착한 아군이 발사 즉시 삼키는 것을 막기 위한 것
  const radius = attack.projectileRadius ?? 0.3;
  const muzzle = def.radius + radius;
  const side = def.radius * (attack.muzzleSideMul ?? 0);
  const originX = enemy.x + (toX / flat) * muzzle + (-toZ / flat) * side;
  const originZ = enemy.z + (toZ / flat) * muzzle + (toX / flat) * side;

  // 조준은 반드시 "발사 지점에서" 다시 잰다. 몸 중심 기준 방향을 그대로 쓰면
  // 손만큼 옆으로 평행 이동한 채 날아가 계속 빗나간다 (실측 0.68m 어긋남)
  const dx = p.x - originX;
  const dy = targetY - originY;
  const dz = p.z - originZ;
  const len = Math.hypot(dx, dy, dz);
  if (len === 0) return;

  world.projectiles.push({
    id: nextProjectileId++,
    owner: 'enemy',
    x: originX,
    y: originY,
    z: originZ,
    prevX: originX,
    prevY: originY,
    prevZ: originZ,
    vx: (dx / len) * speed,
    vy: (dy / len) * speed,
    vz: (dz / len) * speed,
    lifeTicks: 240,
    // 공격별 피해 재정의 — 근접(impact)과 같은 규약. 화살 세례처럼 연사는 한 발이 약하다
    damage: attack.damage ?? def.damage,
    burnTicks: 0,
    burnDamagePerTick: 0,
    radius,
    casterId: enemy.id,
    deflectable: attack.deflectable ?? false,
    kind:
      (attack.projectileKind as 'rock' | 'web' | undefined) ??
      ((attack.deflectable ?? false) ? 'magic' : 'arrow'),
    // 광역 효과는 투사체가 들고 간다 — 시전자가 먼저 죽어도, 반사돼도 그대로 터진다
    splash: attack.splash,
    appliesWeb: attack.appliesWeb,
    breakable: attack.breakable,
  });
  world.events.emit('enemy_cast', { enemyId: enemy.id, enemyType: enemy.type });
}
