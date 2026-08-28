// 단일 반응 버튼 (Space) — docs/systems/combat.md §1, §3.
// 상황에 따라 자동 분기: 패링 판정 > 반사(투사체) > 처형 > (windup 조기 입력 = 실패).
// 회피는 Shift+누르기 — 명시 입력이라 판정을 거치지 않는다 (빨강 공격 회피용).
//
// 판정도 방어도 "누르는 순간"이다 (2026-08 개정). 예전엔 뗄 때 판정하고
// 방어는 12틱 홀드 후에야 켜져서 체감 지연이 300ms를 넘었다.
//
// 패링은 "시간"이 아니라 "무기 끝 위치"로 판정한다:
//   gap = 적까지 거리 - 플레이어 반경 - 무기 끝 거리   (0 = 무기가 몸에 닿는 순간)
//   gap <= perfectBand → 완벽 / gap <= guardDepth → 일반 / 그보다 멀면 헛손질(경직 없음)
// 따라서 멀리 있는 적일수록 창이 도달하는 데 오래 걸려 패링 타이밍이 늦게 온다.
// Enemies 뒤에 실행된다 — 적의 공격 상태가 확정된 뒤 판정해야 하기 때문.
//
// 보스: 완벽/일반 패링 모두 공격을 끊지만, parriesToStagger 연속 성공해야 스태거.
//       스태거 중 처형은 즉사가 아니라 executeDamage 타격.

import { balance } from '../core/Balance';
import { attackReaches, currentAttack, enemyDef } from '../core/Entities';
import { pushEnemy, applyFrostOnHit, spendStamina } from '../core/World';
import type { EnemyState, ProjectileState, World } from '../core/World';

export function tick(world: World, _dt: number): void {
  const p = world.player;
  const reaction = balance.reaction;

  // 진행 중인 상태 카운트다운
  if (p.iframeTicks > 0) p.iframeTicks--;
  if (p.reactionBufferTicks > 0) p.reactionBufferTicks--;

  // 방어 (Shift 홀드) — 누른 첫 틱부터 즉시 성립한다. 경직/대시 중 불가.
  // 피해 처리는 Enemies/Projectiles가 playerBlocks()로 판정 (정면 한정, 칩 데미지 관통)
  p.reactionHeldTicks = world.input.reactionHeld ? p.reactionHeldTicks + 1 : 0;
  p.blocking = world.input.reactionHeld && p.stunTicks <= 0 && p.dodgeTicks <= 0;

  if (p.stunTicks > 0) {
    p.stunTicks--;
    return; // 경직 중에는 반응 불가 (입력은 버려진다)
  }

  if (p.dodgeTicks > 0) {
    p.dodgeTicks--;
    const step =
      (reaction.dodgeDistance * world.modifiers.dodgeDistanceMul * (p.dodgeDistMul ?? 1)) /
      reaction.dodgeDashTicks;
    world.level.slideMove(p, balance.player.radius, p.dodgeDirX * step, p.dodgeDirZ * step);
    return; // 대시 중 추가 반응 불가
  }

  // Space 연타 = 회피. 반응 키와 무관하게 여기서 먼저 본다 —
  // 빨강(패링 불가) 공격의 windup 중에도 실패 경직 없이 빠져나갈 수 있어야 한다.
  // 첫 타는 창만 열고, 창이 열려 있는 동안 한 번 더 누르면 나간다
  if (p.sprintTapTicks && p.sprintTapTicks > 0) p.sprintTapTicks--;
  // 패드처럼 회피 버튼이 따로 있는 입력은 연타를 거치지 않는다
  if (world.input.dodgePressed) {
    p.sprintTapTicks = 0;
    if (tryDodge(world)) return;
  }
  if (world.input.sprintPressed) {
    if ((p.sprintTapTicks ?? 0) > 0) {
      p.sprintTapTicks = 0; // 세 번째 타로 또 나가지 않게 창을 닫는다
      if (tryDodge(world)) return;
    } else {
      p.sprintTapTicks = reaction.dodgeDoubleTapTicks;
    }
  }

  // 판정은 버튼을 "누르는 순간" 한 번. 계속 누르고 있어도 다시 판정되지 않는다
  // (누른 채로 두면 그냥 방어 상태가 유지된다)
  const freshPress = world.input.reactionPressed || p.reactionBufferTicks > 0;
  // 조금 이르게 눌렀다면 그 입력을 잠깐 살려둔다 — 무기가 도달하는 순간 성립시킨다
  const buffered = (p.parryBufferTicks ?? 0) > 0;
  if (buffered) p.parryBufferTicks = (p.parryBufferTicks ?? 0) - 1;
  // 처형은 근접 키로도 나간다 — 스태거를 보고 "때린다"가 자연스럽다.
  // 패링·방어·회피·반사는 여전히 반응 버튼 전용이라 아래에서 freshPress 로 가른다.
  //
  // 단 이미 해머를 휘두르는 중이면 처형으로 가로채지 않는다. 반응 반경(4.6)이
  // 해머 사거리(3.9)보다 넓어 "경직한 적을 해머로 두들긴다"가 아예 불가능해지기
  // 때문 — 연결을 시작했으면 3타까지 이어 칠 수 있어야 한다. Shift 는 항상 처형이다
  const swinging = world.weapon.comboTimer > 0 || world.weapon.swingImpact > 0;
  const executePress = world.input.meleePressed && !swinging;
  if (!freshPress && !buffered && !executePress) return;
  if (freshPress) p.reactionBufferTicks = 0;

  // 반경 내 적을 우선순위로 분류 (같은 우선순위면 가장 가까운 적)
  const space = balance.parrySpace;
  let parryTarget: { enemy: EnemyState; gap: number } | null = null;
  let incoming = false; // 반경 안에서 무기가 날아오는 중인 적이 있는가
  let executeTarget: { enemy: EnemyState; dist: number } | null = null;
  let windupTarget: { enemy: EnemyState; dist: number } | null = null;

  for (const enemy of world.enemies) {
    if (!enemy.alive) continue;
    const dist = Math.hypot(p.x - enemy.x, p.z - enemy.z);
    if (dist > reaction.radius) continue;
    const attack = currentAttack(enemyDef(enemy.type), enemy);

    if (enemy.ai === 'active_perfect' || enemy.ai === 'active_normal') {
      const def = enemyDef(enemy.type);
      // 애초에 나를 향하지 않는 공격은 막을 것도 없다 (옆으로 비켰으면 그냥 빗나간다)
      if (!attackReaches(def, enemy, attack, p.x, p.z)) continue;
      // 무기 끝이 가드 안까지 왔는가.
      // perfectParryOnly(족장)는 일반 대역을 받지 않는다 — 정확히 닿는 순간만 성립한다
      const band = def.perfectParryOnly ? space.perfectBand : space.guardDepth;
      const gap = dist - balance.player.radius - (enemy.weaponTipDist ?? 0);
      if (gap <= band && (!parryTarget || gap < parryTarget.gap)) {
        parryTarget = { enemy, gap };
      } else if (gap > band) {
        // 아직 오는 중 — 이르게 눌렀다면 버퍼로 살려 두고, 대역에 들어오는 순간 성립시킨다
        incoming = true;
      }
    } else if (enemy.ai === 'staggered') {
      if (!executeTarget || dist < executeTarget.dist) executeTarget = { enemy, dist };
    } else if (enemy.ai === 'windup' && attack.type !== 'projectile') {
      // 원거리 시전(warden)의 windup은 근접 판정 대상이 아니다 (반사로 대응)
      if (!windupTarget || dist < windupTarget.dist) windupTarget = { enemy, dist };
    }
  }

  // 반사 대상 — 반경 내 접근 중인 적 투사체. 화살(deflectable=false)은 반사 불가 → 회피로
  let deflectTarget: { proj: ProjectileState; dist: number } | null = null;
  for (const proj of world.projectiles) {
    if (proj.owner !== 'enemy' || !proj.deflectable) continue;
    const dist = Math.hypot(p.x - proj.x, p.z - proj.z);
    if (dist > reaction.radius) continue;
    if (!deflectTarget || dist < deflectTarget.dist) deflectTarget = { proj, dist };
  }

  if (parryTarget && (freshPress || buffered)) {
    const enemy = parryTarget.enemy;
    const def = enemyDef(enemy.type);
    const attack = currentAttack(def, enemy);
    // 무기가 방패에 닿은 순간 = 완벽. 단 parryAlwaysNormal(족장)은 완벽 대역에서만
    // 패링이 성립하므로(perfectParryOnly) 매번 완벽 판정이 나온다 — 그러면 "완벽"이
    // 특별하지 않고, 연쇄·마나까지 매 패링마다 최대로 붙는다. 결과는 일반 패링으로 낮춘다
    const perfect = parryTarget.gap <= space.perfectBand && !def.parryAlwaysNormal;
    world.freezeTicks = perfect ? reaction.hitstopPerfectTicks : reaction.hitstopNormalTicks;

    if (def.boss && def.parriesToStagger) {
      // 보스 — 연속 패링 누적, 도달 시에만 스태거
      enemy.parryStreak = (enemy.parryStreak ?? 0) + 1;
      if (enemy.parryStreak >= def.parriesToStagger) {
        enemy.parryStreak = 0;
        enemy.ai = 'staggered';
        enemy.timer = reaction.staggerTicks;
        world.events.emit('boss_staggered', { enemyId: enemy.id });
      } else {
        enemy.ai = 'recover';
        enemy.timer = attack.recoverTicks + reaction.parryRecoilTicks;
        enemy.recoiled = true;
      }
    } else if (perfect) {
      // 완벽 패링 — 적 스태거 → 처형 가능
      enemy.ai = 'staggered';
      enemy.timer = reaction.staggerTicks;
    } else {
      // 일반 패링 — 스태거는 없지만 크게 튕겨 후딜이 붙는다 (막기보다 큰 보상)
      enemy.ai = 'recover';
      enemy.timer = attack.recoverTicks + reaction.parryRecoilTicks;
      enemy.recoiled = true;
    }
    p.parryBufferTicks = 0;
    world.events.emit('parry_attempt', {
      result: perfect ? 'perfect' : 'normal',
      chain: 0,
      enemyType: enemy.type,
    });
    // 격돌 연출 — 막기와 같은 계열이되 플레이어는 경직되지 않는다 (패링의 보상)
    world.events.emit('guard_clash', {
      kind: perfect ? 'parry_perfect' : 'parry_normal',
      enemyId: enemy.id,
      enemyType: enemy.type,
      x: enemy.x,
      z: enemy.z,
    });
    return;
  }

  if (deflectTarget && (freshPress || buffered)) {
    // 반사 — 투사체 반전, 위력 ×1.5, 방어막 무시. 마나·연쇄는 Mana가 구독
    const proj = deflectTarget.proj;
    const caster = world.enemies.find((e) => e.id === proj.casterId && e.alive);
    if (caster) {
      const dx = caster.x - proj.x;
      const dy = enemyDef(caster.type).height * 0.6 - proj.y;
      const dz = caster.z - proj.z;
      const len = Math.hypot(dx, dy, dz) || 1;
      const speed = Math.hypot(proj.vx, proj.vy, proj.vz);
      proj.vx = (dx / len) * speed;
      proj.vy = (dy / len) * speed;
      proj.vz = (dz / len) * speed;
    } else {
      proj.vx = -proj.vx;
      proj.vy = -proj.vy;
      proj.vz = -proj.vz;
    }
    proj.owner = 'player';
    proj.deflected = true;
    proj.damage *= 1.5;
    world.freezeTicks = reaction.hitstopNormalTicks;
    world.events.emit('deflect', { casterId: proj.casterId });
    return;
  }

  if (executeTarget) {
    const enemy = executeTarget.enemy;
    const def = enemyDef(enemy.type);
    // 근접 키로 들어왔으면 그 입력은 여기서 쓴다 — 같은 틱에 해머까지 휘두르면
    // 처형 연출을 스윙이 덮어쓰고 스태미너도 이중으로 나간다.
    // (Weapons 는 이 뒤에 돈다 — 입력 스냅샷을 비워 두면 버퍼에도 안 남는다)
    if (executePress) world.input.meleePressed = false;
    if (def.boss && def.executeDamage) {
      // 보스 처형 — 즉사가 아니라 큰 타격. 한 번의 스태거는 처형 한 번으로 소모된다
      enemy.health -= applyFrostOnHit(world.events, enemy, def.executeDamage);
      world.freezeTicks = reaction.hitstopExecuteTicks;
      world.executeFocusTicks = reaction.executeFocusTicks;
      world.events.emit('boss_execute', { enemyId: enemy.id, damage: def.executeDamage });
      if (enemy.health <= 0) {
        enemy.alive = false;
        world.events.emit('melee_kill', {
          enemyId: enemy.id,
          enemyType: enemy.type,
          execution: true,
          x: enemy.x,
          z: enemy.z,
        });
        world.events.emit('enemy_died', { enemyType: enemy.type, x: enemy.x, z: enemy.z });
      } else {
        // 스태거는 처형 한 번으로 끝난다 — 여기서 바로 후딜로 넘긴다.
        // timer 만 1로 줄이면 "다음 틱"이 오지 않는다: 처형 연출 동안
        // (executeFocusTicks 32틱) Enemies 가 통째로 멈춰 staggered 가 그대로 남고,
        // 연타하면 한 번의 스태거에 처형이 6번 들어가 840이 통째로 날아갔다(실측)
        enemy.ai = 'recover';
        enemy.timer = currentAttack(def, enemy).recoverTicks;
        // 한 방에 250을 꽂는다 — 몸이 안 움직이면 무게가 안 실린다. 뒤로 크게 날린다.
        // 밀리는 동안은 아무것도 못 하므로(Enemies 가 넉백을 최우선으로 처리) 다시 붙을 틈은 준다
        pushEnemyBack(world, enemy, reaction.executeKnockback, reaction.executeKnockbackTicks);
      }
      return;
    }
    // 일반 적 — 처형 즉사. 마나는 Mana가, 각인 드랍은 Sigils가 이 이벤트를 구독해 처리
    enemy.alive = false;
    world.freezeTicks = reaction.hitstopExecuteTicks; // 마무리 일격의 무게
    world.executeFocusTicks = reaction.executeFocusTicks; // 그동안 적 전체 정지
    world.events.emit('melee_kill', {
      enemyId: enemy.id,
      enemyType: enemy.type,
      execution: true,
      x: enemy.x,
      z: enemy.z,
    });
    world.events.emit('enemy_died', { enemyType: enemy.type, x: enemy.x, z: enemy.z });
    return;
  }

  if (windupTarget && freshPress) {
    // 조기 입력 — 실패. 경직 20t (마나 절반 소실은 Mana)
    p.stunTicks = reaction.failStunTicks;
    world.events.emit('parry_attempt', {
      result: 'fail',
      chain: 0,
      enemyType: windupTarget.enemy.type,
    });
    return;
  }

  // 아직 무기가 오는 중이면 이 입력을 잠깐 살려둔다 (도달하는 순간 패링 성립).
  // 이게 없으면 "조금 일찍 누름"이 전부 헛손질이 되어 타이밍이 가혹해진다
  if (freshPress && incoming) p.parryBufferTicks = reaction.parryBufferTicks;
}

/** 적을 플레이어 반대 방향으로 밀어낸다. 미는 시간을 함께 늘려야 순간이동처럼
 *  보이지 않는다 (Weapons 의 마무리 넉백과 같은 규약) */
function pushEnemyBack(
  world: World,
  enemy: EnemyState,
  distance: number,
  ticks: number,
): void {
  const p = world.player;
  pushEnemy(enemy, enemy.x - p.x, enemy.z - p.z, distance, ticks);
}

/** 스태미너를 내고 회피에 들어간다. 모자라면 알리고 false */
function tryDodge(world: World): boolean {
  const stam = balance.player.stamina;
  if (world.stamina.value < stam.dodgeCost) {
    world.events.emit('stamina_blocked', { action: 'dodge', need: stam.dodgeCost });
    return false;
  }
  if (spendStamina(world.stamina, stam.dodgeCost, stam.regenDelayTicks)) {
    world.events.emit('stamina_empty', {});
  }
  startDodge(world);
  return true;
}

/** 회피 스텝 — 이동 입력 방향, 없으면 뒤로 */
function startDodge(world: World): void {
  const p = world.player;
  const reaction = balance.reaction;
  const input = world.input;
  let dirX: number;
  let dirZ: number;
  const fx = -Math.sin(p.yaw);
  const fz = -Math.cos(p.yaw);
  const rx = Math.cos(p.yaw);
  const rz = -Math.sin(p.yaw);
  if (input.moveX !== 0 || input.moveForward !== 0) {
    dirX = fx * input.moveForward + rx * input.moveX;
    dirZ = fz * input.moveForward + rz * input.moveX;
  } else {
    dirX = -fx;
    dirZ = -fz;
  }
  const len = Math.hypot(dirX, dirZ);
  p.dodgeDirX = dirX / len;
  p.dodgeDirZ = dirZ / len;
  // 옆 대시는 짧다 — 적을 보면서 살짝 비켜 바로 반격하는 스텝.
  // 시선과 나란하면(앞뒤) 1배, 직각이면 dodgeSideDistanceMul, 대각선은 그 사이
  const along = Math.abs(p.dodgeDirX * fx + p.dodgeDirZ * fz);
  const sideMul = reaction.dodgeSideDistanceMul;
  p.dodgeDistMul = sideMul + (1 - sideMul) * along;
  p.dodgeTicks = reaction.dodgeDashTicks;
  p.iframeTicks = world.modifiers.dodgeIFrameTicks; // sig_dash 부착 시 연장
  world.events.emit('dodge_step', {});
}
