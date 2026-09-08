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
// parryOutcome 'expose'(거수): 패링은 스태거 대신 약점을 연다 — 일반 = 그 낫의 어깨 관절 36틱(recover),
//       완벽 = 관절 90틱 + 낫이 바닥에 박혀 머리 내림(pose head_down 90틱, 눈 노출). 혼절은 Enemies 가 눈 누적으로 건다.
// 팔 저림(numb_arm, B2-4 — 거수 낫을 방패로 막음): 완벽 대역 ×perfectBandMul(0 = 정직하게 일반만 — 완벽 전용 타(족장 perfectParryOnly·삼연낫 ③ perfectOnly)도 성립 대역은
//       완벽 대역 그대로, 결과만 일반으로 낮아진다: ③ 은 그래서 저림 중 완벽 대역 입력이 콤보를 끊는 일반 패링이 된다 — 기획서 §7 소표), 패링 실패의 마나 소실 면제
//       (parry_attempt 에 noManaLoss — Mana 가 읽는다), 일반 패링 1회 성립 시 즉시 해제(카운터 0 → Status 가 _ended 를 낸다).
// 절뚝(hobble, B3-1 — 거수 발구르기 직격): 회피 스태미너 ×dodgeStaminaMul(tryDodge). 회피 거리·무적 틱은 어느 상태도 건드리지 않는다.
// 위압(cowed, B3-4 — 거수 P3 포효): 일반 패링이 관절을 열지 못하고(balance.status.cowed.normalParryOpensJoint false — 완벽만), 일반 패링 마나가 준다(parry_attempt.cowed → Mana),
//       완벽 패링 1회 성립 시 즉시 해제 — 어느 적의 완벽 패링이든(팔 저림 해제와 같은 공용 성공 경로, 기획서 §6 — 거수 한정이 아니다). 삼연낫(comboAttack, B3-4): continueOnParry 타는 패링해도 끊기지 않고 recoverTicks 뒤 다음 타로(Enemies recover → startWindup),
//       ①② 완벽은 관절 perfectTicks(60)·완벽 카운트, ③(perfectOnly + noParryBuffer — 완벽 대역 밖에 누르면 실패 규약)은 완벽 카운트가 타 수와 같으면 탈진(pose exhaust,
//       headDown.exhaustTicks — 눈 + 분출공 동시 노출) 아니면 단발 완벽과 같은 머리 내림.

import { balance } from '../core/Balance';
import { attackReaches, comboChain, currentAttack, enemyDef } from '../core/Entities';
import { beginPose, openExposure, pushEnemy, applyFrostOnHit, playerStatusTicks, setPlayerStatus, spendStamina } from '../core/World';
import type { EnemyState, ProjectileState, World } from '../core/World';

export function tick(world: World, _dt: number): void {
  const p = world.player;
  const reaction = balance.reaction;

  // 진행 중인 상태 카운트다운
  if (p.iframeTicks > 0 && --p.iframeTicks === 0) p.iframeSource = undefined; // 무적이 다한 틱에 출처도 지운다 — 지난 회피의 'dodge' 가 다음 무적(그래플 탈출·블링크)에 묻어가지 않게(B3-4 검토)
  if (p.reactionBufferTicks > 0) p.reactionBufferTicks--;

  // 방어 (Shift 홀드) — 누른 첫 틱부터 즉시 성립한다. 경직/대시 중 불가.
  // 피해 처리는 Enemies/Projectiles가 playerBlocks()로 판정 (정면 한정, 칩 데미지 관통)
  p.reactionHeldTicks = world.input.reactionHeld ? p.reactionHeldTicks + 1 : 0;
  p.blocking = world.input.reactionHeld && p.stunTicks <= 0 && p.dodgeTicks <= 0;

  if (p.stunTicks > 0) {
    p.stunTicks--;
    return; // 경직 중에는 반응 불가 (입력은 버려진다)
  }

  // Space 연타 = 회피. 반응 키와 무관하게 여기서 먼저 본다 —
  // 빨강(패링 불가) 공격의 windup 중에도 실패 경직 없이 빠져나갈 수 있어야 한다.
  // 첫 타는 창만 열고, 창이 열려 있는 동안 한 번 더 누르면 나간다.
  //
  // 대시 이동보다 먼저 본다 — 대시 중(6틱)의 탭이 통째로 버려지면 연속 회피가
  // "한 박자 늦게" 나간다 (탭 하나가 증발해 세 번째 탭이 필요해진다).
  // 대시 중의 탭은 창만 열어 두고, 회피 시작 자체는 대시가 끝난 뒤에만 된다
  if (p.sprintTapTicks && p.sprintTapTicks > 0) p.sprintTapTicks--;
  const dashing = p.dodgeTicks > 0;
  // 패드처럼 회피 버튼이 따로 있는 입력은 연타를 거치지 않는다
  if (world.input.dodgePressed && !dashing) {
    p.sprintTapTicks = 0;
    if (tryDodge(world)) return;
  }
  if (world.input.sprintPressed) {
    if (!dashing && (p.sprintTapTicks ?? 0) > 0) {
      p.sprintTapTicks = 0; // 세 번째 타로 또 나가지 않게 창을 닫는다
      if (tryDodge(world)) return;
    } else {
      p.sprintTapTicks = reaction.dodgeDoubleTapTicks;
    }
  }

  if (p.dodgeTicks > 0) {
    p.dodgeTicks--;
    const step =
      (reaction.dodgeDistance * world.modifiers.dodgeDistanceMul * (p.dodgeDistMul ?? 1)) /
      reaction.dodgeDashTicks;
    world.level.slideMove(p, balance.player.radius, p.dodgeDirX * step, p.dodgeDirZ * step);
    return; // 대시 중 추가 반응 불가
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
  // 버퍼 없는 완벽 전용 타(거수 삼연낫 ③, noParryBuffer)의 판정 창 안인데 완벽 대역 밖 — 누르면 실패(조기 입력과 같은 규약)
  let bandFailTarget: { enemy: EnemyState; dist: number } | null = null;

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
      // perfectParryOnly(족장)·attack.perfectOnly(거수 삼연낫 ③)는 일반 대역을 받지 않는다 — 정확히 닿는 순간만 성립한다
      const band = def.perfectParryOnly || attack.perfectOnly ? space.perfectBand + world.modifiers.perfectBandBonus : space.guardDepth;
      const gap = dist - balance.player.radius - (enemy.weaponTipDist ?? 0);
      if (gap <= band && (!parryTarget || gap < parryTarget.gap)) {
        parryTarget = { enemy, gap };
      } else if (gap > band) {
        if (attack.noParryBuffer) {
          // 버퍼 없는 타(삼연낫 ③) — 완벽 대역 밖에 누른 입력은 살려 두지 않고 실패로 떨어진다(실효 창 ≈ 완벽 대역 2~3틱, 기획서 §7 소표)
          if (!bandFailTarget || dist < bandFailTarget.dist) bandFailTarget = { enemy, dist };
        } else {
          // 아직 오는 중 — 이르게 눌렀다면 버퍼로 살려 두고, 대역에 들어오는 순간 성립시킨다
          incoming = true;
        }
      }
    } else if (enemy.ai === 'staggered') {
      if (!executeTarget || dist < executeTarget.dist) executeTarget = { enemy, dist };
    } else if (enemy.ai === 'windup' && attack.type !== 'projectile') {
      // 원거리 시전(warden)의 windup은 근접 판정 대상이 아니다 (반사로 대응)
      if (!windupTarget || dist < windupTarget.dist) windupTarget = { enemy, dist };
    }
  }

  // 반사 대상 — 반경 내 접근 중인 적 투사체. 적 화살(deflectable=false)은 반사 불가 → 회피로.
  // 함정 다트는 kind 'arrow' 지만 deflectable=true — 받아치면 마나가 들어오는 훈련장이다
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
    // 특별하지 않고, 연쇄·마나까지 매 패링마다 최대로 붙는다. 결과는 일반 패링으로 낮춘다.
    // 팔 저림 중엔 완벽 대역이 perfectBandMul 배(0 = 대역 없음 → 완벽 불가). perfectParryOnly(족장)·attack.perfectOnly(삼연낫 ③) 의 성립 대역은 그대로 둔다 —
    // 저림은 "완벽을 일반으로 낮춘다" 이지 패링 자체를 막지 않는다. 그래서 ③ 은 저림 중 완벽 대역 입력이 일반 패링(관절 없음·콤보 끊김·저림 해제)이 된다 — 기획서 §7 소표
    const numb = (p.numbArmTicks ?? 0) > 0;
    const perfectBand = (space.perfectBand + world.modifiers.perfectBandBonus) * (numb ? balance.status.numbArm.perfectBandMul : 1);
    const perfect = perfectBand > 0 && parryTarget.gap <= perfectBand && !def.parryAlwaysNormal; // 가죽 투구
    world.freezeTicks = perfect ? reaction.hitstopPerfectTicks : reaction.hitstopNormalTicks;

    const cowed = playerStatusTicks(p, 'cowed') > 0;
    if (def.parryOutcome === 'expose') {
      // 거수(기획서 §4.1) — 패링은 약점을 연다. 어느 낫이었는지는 공격 정의(exposeOnParry.joint)가 안다:
      // 오른낫(attack) → joint_r, 왼낫(attackAlt) → joint_l. 삼연낫(attackMode 'combo', B3-4)은 continueOnParry 타면 패링해도 다음 타로 이어진다
      const ex = attack.exposeOnParry;
      const combo = enemy.attackMode === 'combo';
      const comboContinues = combo && attack.continueOnParry === true && attack.comboNext !== undefined;
      if (perfect) {
        // 완벽 — 관절이 길게 열린다(눈과 양자택일)
        if (ex) openExposure(world, enemy, ex.joint, ex.perfectTicks);
        if (combo) enemy.comboPerfects = (enemy.comboPerfects ?? 0) + 1;
        if (comboContinues) {
          // 삼연낫 ①② — 낫이 박히지 않고 콤보가 이어진다. 짧은 이음(recoverTicks) 뒤 Enemies 가 다음 타의 예고를 낸다
          enemy.ai = 'recover';
          enemy.timer = attack.recoverTicks;
          enemy.recoiled = true;
        } else if (combo && (enemy.comboPerfects ?? 0) >= comboChain(def).length) {
          // 삼연낫 ③ — 세 타 전부 완벽: 탈진. 양낫이 박혀 머리가 내려오고 분출공도 열린다(exposedStates 'exhaust') — 처형(눈)과 정화(분출공)의 양자택일
          enemy.attackMode = 'melee';
          beginPose(world, enemy, 'exhaust', balance.weakPoint.headDown.exhaustTicks);
        } else {
          // 단발 완벽(또는 ③ 완벽인데 앞 타에 완벽이 모자람) — 낫이 바닥에 박혀 머리가 내려온다(눈 0.9m 노출, 이동·공격 불가)
          if (combo) enemy.attackMode = 'melee';
          beginPose(world, enemy, 'head_down', balance.weakPoint.headDown.stuckTicks);
        }
      } else {
        // 일반 — 그 낫의 관절만 짧게(통제 노선). 위압 중엔 열리지 않는다(balance.status.cowed.normalParryOpensJoint)
        if (ex && !(cowed && !balance.status.cowed.normalParryOpensJoint)) openExposure(world, enemy, ex.joint, ex.normalTicks);
        enemy.ai = 'recover';
        if (comboContinues) {
          // 삼연낫 ①② — 튕기되 콤보는 이어진다(짧은 이음)
          enemy.timer = attack.recoverTicks;
        } else {
          // 적은 크게 튕겨 후딜(기존 일반 패링과 같은 결)
          enemy.timer = attack.recoverTicks + reaction.parryRecoilTicks;
        }
        enemy.recoiled = true;
      }
    } else if (def.boss && def.parriesToStagger) {
      // 보스 — 연속 패링 누적, 도달 시에만 스태거
      enemy.parryStreak = (enemy.parryStreak ?? 0) + 1;
      if (enemy.parryStreak >= def.parriesToStagger) {
        enemy.parryStreak = 0;
        enemy.ai = 'staggered';
        enemy.timer = reaction.staggerTicks;
        world.events.emit('boss_staggered', { enemyId: enemy.id, enemyType: enemy.type, cause: 'parry' });
      } else {
        enemy.ai = 'recover';
        enemy.timer = attack.recoverTicks + reaction.parryRecoilTicks;
        enemy.recoiled = true;
      }
    } else if (perfect) {
      // 완벽 패링 — 적 스태거 → 처형 가능. 콤보(해골 검사 이연격)는 무너짐으로 끝난다 — recover 가 다음 타를 잇지 않게 모드를 접는다
      enemy.ai = 'staggered';
      enemy.timer = reaction.staggerTicks;
      if (enemy.attackMode === 'combo') enemy.attackMode = 'melee';
    } else {
      // 일반 패링 — 스태거는 없지만 크게 튕겨 후딜이 붙는다 (막기보다 큰 보상).
      // 콤보 타가 continueOnParry 면(이연격 ①) 튕기되 짧은 이음(recoverTicks)만 두고 다음 타가 온다 — 두 번 막아야 한다
      enemy.ai = 'recover';
      const comboContinues = enemy.attackMode === 'combo' && attack.continueOnParry === true && attack.comboNext !== undefined;
      enemy.timer = comboContinues ? attack.recoverTicks : attack.recoverTicks + reaction.parryRecoilTicks;
      enemy.recoiled = true;
    }
    p.parryBufferTicks = 0;
    // 일반 패링 1회 성립 = 팔 저림 해제("패링하면 풀린다"), 완벽 패링 1회 성립 = 위압 해제("완벽만이 답이다"). 둘 다 어느 적이든 — 위압을 건 것은 거수지만
    // 푸는 완벽 패링은 시험방의 고블린이어도 된다(기획서 §6, B3-4 검토). 0 만 세우고 _ended 는 Status 가 낸다
    if (!perfect && numb) setPlayerStatus(p, 'numb_arm', 0);
    if (perfect && cowed) setPlayerStatus(p, 'cowed', 0);
    world.events.emit('parry_attempt', {
      result: perfect ? 'perfect' : 'normal',
      chain: 0,
      enemyType: enemy.type,
      // 위압 중 일반 패링 — 마나가 준다(balance.status.cowed.normalParryMana, Mana 가 읽는다). 완벽은 위압을 푼 것이라 온전히
      cowed: cowed && !perfect,
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
      const executeDealt = applyFrostOnHit(world.events, enemy, def.executeDamage);
      enemy.health -= executeDealt;
      world.events.emit('damage_pop', { enemyId: enemy.id, amount: executeDealt });
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
        // execution: 처형으로 마무리했다 — Corruption 이 사망 정화(−10)가 아니라 처형 정화(−15)를 낸다, boss: Metrics 가 데이터를 읽지 않고 처형 마무리를 센다(B3-6, 기획서 §11·§12)
        world.events.emit('enemy_died', { enemyId: enemy.id, enemyType: enemy.type, x: enemy.x, z: enemy.z, noLoot: enemy.noLoot, execution: true, boss: true, phased: (enemyDef(enemy.type).phases?.length ?? 0) > 0 });
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
    world.events.emit('enemy_died', { enemyId: enemy.id, enemyType: enemy.type, x: enemy.x, z: enemy.z, noLoot: enemy.noLoot });
    return;
  }

  const failTarget = windupTarget ?? bandFailTarget;
  if (failTarget && freshPress) {
    // 조기 입력(또는 버퍼 없는 완벽 전용 타의 완벽 대역 밖 입력) — 실패. 경직 20t (마나 절반 소실은 Mana — 팔 저림 중엔 noManaLoss 로 면제를 알린다)
    p.stunTicks = Math.round(reaction.failStunTicks * world.modifiers.stunMul); // 쇠 투구·인내 반지
    const numbCfg = balance.status.numbArm;
    world.events.emit('parry_attempt', {
      result: 'fail',
      chain: 0,
      enemyType: failTarget.enemy.type,
      noManaLoss: (p.numbArmTicks ?? 0) > 0 && numbCfg.noManaLossOnFail,
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

/** 스태미너를 내고 회피에 들어간다. 모자라면 알리고 false.
 *  절뚝(hobble, B3-1 — 거수 발구르기 직격) 중엔 값이 balance.status.hobble.dodgeStaminaMul 배 — 회피 거리·무적 틱은 그대로("언제나 반응 버튼으로 답할 수 있다") */
function tryDodge(world: World): boolean {
  const stam = balance.player.stamina;
  const cost = stam.dodgeCost * ((world.player.hobbleTicks ?? 0) > 0 ? balance.status.hobble.dodgeStaminaMul : 1);
  if (world.stamina.value < cost) {
    world.events.emit('stamina_blocked', { action: 'dodge', need: cost });
    return false;
  }
  if (spendStamina(world.stamina, cost, stam.regenDelayTicks)) {
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
  p.iframeSource = 'dodge'; // 회피 무적 — 거수 돌격의 완벽 회피(미끄러짐)는 이 출처만 친다(B2-3 검토)
  world.events.emit('dodge_step', {});
}
