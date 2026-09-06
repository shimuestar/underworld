// 적 AI. 모든 근접 적은 공통 공격 상태 머신을 가진다 — docs/systems/combat.md §2.
//
//   idle → chase → windup → active_perfect(6t) → active_normal(12t) → impact → recover → chase
//                                                                  (패링 시 staggered / recover)
//
// 패링 불가 공격(적색)은 판정 창 없이 windup → impact.
// 원거리 캐스터(warden)는 windup 종료 시 투사체를 발사하고 recover로 간다.
// windup 진입 시 enemy_windup(오디오), 종료 visualLeadTicks 전에 telegraph_flash(섬광).
//
// 거수(약점 보스) 상태 장부(tickWeakPointStatus): 노출 타이머(exposure) 감소·닫힘, 자세(pose) 비추기(stunned ↔ staggered,
// charge ↔ 돌격), 눈 누적(weakAccum.eye) ≥ dazeThreshold → 혼절(staggered + boss_staggered), 혼절 종료 → dazeCooldown,
// 관절 내구 0 → 파열(비틀거림 + 그 낫 잠김 bladeLock, 양 낫 잠김 = 절뚝 limp — 이속·돌격 속도 배율, 낫 없이 들이받기·돌격만·물러서기).
// 돌격 완벽 회피(impact 의 reaches && iframeTicks > 0) → charge_dodged + 미끄러짐(pose skid) + 양 관절 노출.
// 돌격 질주 중 플레이어 ≤ blindRangeM 이면 눈 노출(노출 타이머) → 누적 blindThreshold → 눈멂(blind: 목표 무시·직진 + 오버런), 질주가 지형에 막히면
// (chargeStuckTicks) 부딛힌 셀 문자로 전도(P·C → head_down toppleTicks, pillar_hit / 균열벽 개방) 또는 헛돌격(벽·문 → wallWhiffRecoverTicks) — B2-5.
// 포즈 타이머(poseTicks, head_down·skid·roar)는 오버라이드 순서 넉백 > brace > attackFreeze > 포즈 > 돌격 캔슬 > notice (기획서 §9.1).
// 페이즈(tickPhase, B2-6, 기획서 §8): healthBarState.index 가 enemy.phase 보다 낮아진 틱에 phase_shift(beginPhaseShift — recover phaseShiftTicks + pose roar,
// 진행 중 공격 취소, 약점 전부 닫힘(molting), 갑각 재생 = 관절 hp 회복·ruptured 삭제·낫 잠김·절뚝 해제·공격 쿨다운 × phaseShiftCooldownMul, 무적 아님) → boss_phase.
// 혼절·포즈 타이머·눈멂·넉백 중이면 phaseTarget 에 큐잉하고 풀리는 틱에 한 번 — 두 경계를 넘었으면 P2 를 건너 P3. 페이즈 표(phases[]) 의 speedMul·attackOverrides 는
// moveSpeed·Entities.currentAttack/attackInPhase 가 읽고, unlock 은 slotUnlocked 가 가른다.
// 발구르기(B3-1, 기획서 §7 P2·§9.2): P2 해금 slotUnlocked('slam') — 2.5 < dist ≤ 6·쿨 420 에서 attackMode 'slam'(trySlam), 예고 rearPose 구간엔 pose 'rear'(④ — 배 심장 열림),
// 그 창 안 심장 누적 heartThreshold → 역류(beginBackflow: 발구르기 취소 + 자해 + head_down backflowTicks(cause 'backflow' — 혼절 누적 없음) + 심장 weakCooldown).
// 기상 발구르기(wakeSlam): 머리 내림(전 원인)·혼절이 끝나는 자리(endPose·③)에서 wakeSlamPending 을 세우고 다음 추격 틱에 확정(미끄러짐 뒤는 아님, 전환이 끼면 취소).
// 발구르기 직격은 플레이어 절뚝(statusOnHit 'hobble'), 착지는 ground_slam + slam_landed(웅덩이는 B3-2).
// P3 기술(B3-4, 기획서 §7 P3·§9.2): 포효(tryRoar — P3 복귀 첫 선택 firstPick + intervalTicks 마다, 다른 공격보다 우선; 예고 동안 pose roar 로 눈이 열리고 누적 roarCancelThreshold 면
// beginRoarBackflow 취소; 발동은 impact 파이프가 아닌 resolveRoar — aoeRadius 안 pushM 밀림 + 위압 cowed, 회피 무적이면 면제; 체력 ≤ despairHealthFrac 면 절망의 포효 — pull 끌림 뒤 발구르기
// 즉시 연계 despairSlam), 삼연낫(tryCombo — 낫 사거리 안 단발보다 먼저, attackMode 'combo' + comboStep, 한 타가 끝나면 recover → 다음 타 startWindup, 패링 연계·탈진은 Reaction),
// 광란 돌격(chainCharge — 첫 질주 impact 뒤 beginChainTurn 선회 turnTicks(꼬리 채기 tickChainTurn) → windup 끝에 새 자리로 두 번째 질주; 완벽 회피·눈멂이면 없음).
// 완벽 회피는 회피 무적(iframeSource 'dodge')만 — 블링크·탈출 무적은 옛 경로(B2-3 검토).

import { balance } from '../core/Balance';
import { VENT_WEAK_POINT, attackInPhase, attackReaches, bladeLocked, bladeOfJoint, bothBladesLocked, comboChain, comboStepAttack, currentAttack, enemyDef, headDownPose, healthBarState, jointOfBlade, poolsOn, resolvePhase, slotUnlocked, type BladeSide, type EnemyAttackDef } from '../core/Entities';
import { shedShellPlates } from '../core/ShellPlates';
import { rayVsAabb } from '../core/Ray';
import { alertEnemy, alertNearbyAt, beginPose, breakCrackWalls, closeExposure, findWallNormal, noiseField, openExposure, playerBlocks, pushEnemy, pushPlayer, scatterAwayFromPlayer, setPlayerStatus, statusDurationOf, PLAYER_STATUS_CFG, type EnemyState, type World, damagePlayer } from '../core/World';

/** 혼절 임계를 재는 약점 id — 기획서 §4.1 "혼절은 눈 누적 66 으로만". 돌격 중 6m 안 노출·눈멂(B2-5)도 같은 눈이다 */
const DAZE_WEAK_POINT = 'eye';
/** 역류 임계를 재는 약점 id(B3-1) — 발구르기 앞발 들기(pose rear)에 열리는 배 심장. 임계는 balance.weakPoint.heartThreshold */
const HEART_WEAK_POINT = 'heart';
/** 발구르기 앞발 들기 자세 id — slamAttack.rearPose 구간에 ④ 가 비추고, 심장의 exposedStates 가 이 이름을 읽는다 */
const REAR_POSE = 'rear';
/** 포효 자세 id(B3-4) — 포효(roarAttack) 예고 동안 ④ 가 비추고(머리 치켜듦 — 눈의 exposedStates 가 이 이름을 읽어 열린다), 페이즈 전환(molt)도 같은 자세를 포즈 타이머로 쓴다 */
const ROAR_POSE = 'roar';
/** 돌격 중 눈 노출 타이머를 매 틱 되살리는 값 — 장부 ① 이 1 로 깎아도 이 틱 내내 열려 있고, 범위를 벗어나면 그 틱에 닫힌다 (튜닝값 아님) */
const CHARGE_EYE_REFRESH = 2;
/** 돌격 지형 충돌 — 막힌 몸의 선두 면을 이만큼 넘어 그 칸의 문자를 읽는 여유(m, Level.blockedAhead 의 SKIN 위 수치 오차 방지 — 튜닝값 아님) */
const CHARGE_PROBE_EPS = 0.01;
/** 갑각 떨기(volley) 예고·시전 중 분출공(vent) 노출 타이머를 매 틱 되살리는 값(B3-2) — 돌격 중 눈(CHARGE_EYE_REFRESH)과 같은 문. 시전이 끝나면 그 틱에 닫힌다 (튜닝값 아님) */
const VENT_OPEN_REFRESH = 2;

let nextProjectileId = 100000; // 적 투사체 id 대역 (플레이어 투사체와 구분)

/** 구독. 시작 시 1회 — 공격 행동의 소음. 마법 시전과 해머 휘두름은 빗나가도
 *  코앞(attackNoiseRadius)의 대기 적을 깨운다. 총성·활시위는 Weapons 가 제 값으로 낸다 */
export function init(world: World): void {
  const wake = (): void =>
    alertNearbyAt(
      world,
      world.player.x,
      world.player.z,
      balance.enemyAi.attackNoiseRadius,
      balance.enemyAi.noticeDelayTicks,
    );
  world.events.on('cast_spell', wake);
  world.events.on('hammer_swing', wake);
  // 질주 발소리·회피 대시 — 몸이 내는 소리는 조금 조용하다 (moveNoiseRadius)
  const moveWake = (): void =>
    alertNearbyAt(
      world,
      world.player.x,
      world.player.z,
      balance.enemyAi.moveNoiseRadius,
      balance.enemyAi.noticeDelayTicks,
    );
  // 걷기 발소리는 작아서 못 듣는다 — 질주 발걸음만 반경 안에 울린다
  world.events.on('footstep', (payload) => {
    if ((payload as { sprint?: boolean }).sprint) moveWake();
  });
  world.events.on('dodge_step', moveWake);
}

export function tick(world: World, dt: number): void {
  // 처형 연출 중 — 모든 적이 멈춘다. 플레이어의 마무리 동작이 온전히 보이도록
  if (world.executeFocusTicks > 0) {
    world.executeFocusTicks--;
    return;
  }

  // 점액 장판 수명 — 슬라임 시스템의 일부라 여기서 마른다
  if (world.gooPuddles?.length) {
    for (const goo of world.gooPuddles) goo.ticks--;
    world.gooPuddles = world.gooPuddles.filter((goo) => goo.ticks > 0);
  }

  for (const enemy of world.enemies) {
    if (!enemy.alive) {
      if (world.grappleEnemyId === enemy.id) releaseGrapple(world, enemy, false); // 죽으면 놓는다
      if (world.faceLeechId === enemy.id) world.faceLeechId = null; // 얼굴에서 흘러내린다
      handleSplit(world, enemy); // 슬라임 분열 — 어디서 어떻게 죽었든 여기서 한 번만 가른다
      endPhaseOnDeath(world, enemy); // 페이즈 보스(거수) — 마지막 페이즈의 소요 시간을 한 번 알린다(boss_phase{phase 0})
      continue;
    }
    // 죽은 척인데 이미 깨어 있다 — 피격·폭발·함정이 idle→chase 로만 넘기고 feigning 을 안 지워
    // 누운 채 돌아다니며 공격하던 버그(2026-09-03). 어떤 경로로 깼든 일어나는 건 여기서 한 번에
    if (enemy.feigning && enemy.ai !== 'idle') {
      enemy.feigning = false;
      world.events.emit('ghoul_rise', { enemyId: enemy.id, enemyType: enemy.type, x: enemy.x, z: enemy.z });
    }
    // 감전 누적은 전기가 닿아 있는 동안만 산다 — 유예가 다하면 처음부터 다시 쌓아야 한다.
    // "끊기지 않고 2.5초" 라는 규칙이 이 유예로 표현된다
    if ((enemy.shockGrace ?? 0) > 0) enemy.shockGrace = (enemy.shockGrace ?? 0) - 1;
    else if ((enemy.shockCharge ?? 0) > 0) enemy.shockCharge = 0;
    // 빙결 — AI 를 아예 안 돌린다: 이동·회전·공격 예고·돌진·방패 추적 전부 멈춘다.
    // 하던 동작은 얼음이 풀리면 그 자리에서 이어진다
    if ((enemy.freezeTicks ?? 0) > 0) {
      if (world.grappleEnemyId === enemy.id) releaseGrapple(world, enemy, false); // 얼면 놓는다
      enemy.freezeTicks = (enemy.freezeTicks ?? 0) - 1;
      enemy.prevX = enemy.x;
      enemy.prevZ = enemy.z;
      if (enemy.freezeTicks === 0) {
        world.events.emit('enemy_freeze_ended', { enemyId: enemy.id, enemyType: enemy.type, x: enemy.x, z: enemy.z });
      }
      if ((enemy.slowTicks ?? 0) > 0) enemy.slowTicks = (enemy.slowTicks ?? 0) - 1;
      continue;
    }
    // 감전 — 빙결과 같은 규약. AI 를 안 돌리니 하던 동작이 풀릴 때 그 자리에서 이어진다.
    // 공격 중이었다면 떨림이 끝나는 순간 그 공격을 이어서 마친다
    if ((enemy.shockTicks ?? 0) > 0) {
      if (world.grappleEnemyId === enemy.id) releaseGrapple(world, enemy, false); // 감전에도 놓는다
      enemy.shockTicks = (enemy.shockTicks ?? 0) - 1;
      enemy.prevX = enemy.x;
      enemy.prevZ = enemy.z;
      if (enemy.shockTicks === 0) {
        world.events.emit('enemy_shock_ended', { enemyId: enemy.id, enemyType: enemy.type, x: enemy.x, z: enemy.z });
      }
      if ((enemy.slowTicks ?? 0) > 0) enemy.slowTicks = (enemy.slowTicks ?? 0) - 1;
      continue;
    }
    tickEnemy(world, enemy, dt);
    dropGoo(world, enemy);
    eatNearbyItems(world, enemy);
    emitBrood(world, enemy);
    // 사출된 새끼의 낙하 — 돌진 도약(charging)·거머리 수직 구간은 제 코드가 높이를 관리한다
    if (
      enemy.ai !== 'charging' &&
      enemy.ai !== 'latched' &&
      !enemy.lurking &&
      !enemyDef(enemy.type).flying &&
      !enemy.wallCling &&
      (enemy.wallClimbTicks ?? 0) <= 0 &&
      (enemy.wallWindupTicks ?? 0) <= 0 &&
      (enemy.wallPounceTicks ?? 0) <= 0 &&
      (enemy.dropTicks ?? 0) <= 0 &&
      (enemy.ascendTicks ?? 0) <= 0 &&
      (enemy.jumpY ?? 0) > 0
    ) {
      enemy.jumpY = Math.max(0, (enemy.jumpY ?? 0) - BROOD_FALL);
    }
    tickLeechGround(world, enemy);
    tickGhoulMoan(world, enemy);
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

/** 새끼가 튕겨 나가는 데 쓰는 틱 — 거리(flingDistance)는 데이터, 이건 연출 속도다.
 *  바로 옆에서 태어나면 부모를 죽인 해머 한 방에 같이 죽어 분열의 의미가 없다 */
const FLING_TICKS = 18;
/** 분열·사출 흩뿌림 — 각도 지터(rad)·거리 배율 폭·튀어오르는 높이(m).
 *  값이 일정하면 늘 같은 두 갈래로 갈라져 기계처럼 보인다 (연출 전용 랜덤) */
const SCATTER_ANG_JITTER = 0.9;
const SCATTER_HOP_MIN = 0.4;
const SCATTER_HOP_SPAN = 0.7;

/** 슬라임 분열 대역 id — 투사체(100000)·열쇠(950000) 대역과 겹치지 않는다 */
let nextSplitId = 700000;
let nextGooId = 1;

/** 죽은 슬라임을 절반 둘로 가른다 — 화상 중(말라붙음)·빙결 중(통째로 깨짐) 사망은 예외.
 *  총알로 잡으면 몸값이 배가 되고 불·서리·광역이 정답이라는 상성이 이 두 예외로 표현된다 */
/** 동료의 죽음을 목격한다 — 정면 반구(등 뒤만 사각) + 시야선 + 시야 거리 안이면
 *  대기 중이던 적이 깬다. 소리(피격음 2m)와 별개의 '눈' 규칙이다: 격자 한 칸이 4m 라
 *  피격음만으로는 같은 방 동료도 못 들었다. 등 뒤나 벽 너머에서 죽이면 여전히 모른다 —
 *  보이지 않는 곳에서 하나씩 처리하는 은신 플레이는 그대로 성립한다 */
function alertWitnesses(world: World, corpse: EnemyState): void {
  for (const watcher of world.enemies) {
    if (!watcher.alive || watcher.ai !== 'idle' || watcher.id === corpse.id) continue;
    if (watcher.feigning) continue; // 죽은 척 — 눈을 감고 있다 (기척·소음·피격만 깨운다)
    if (watcher.lurking) continue; // 천장 잠복 — 매달린 채 미동도 없다
    const def = enemyDef(watcher.type);
    if (def.blind) continue; // 장님(슬라임)은 눈이 없다 — 소리로만 산다
    const dx = corpse.x - watcher.x;
    const dz = corpse.z - watcher.z;
    const dist = Math.hypot(dx, dz);
    if (dist <= 0.001 || dist > def.aggroRange) continue;
    const fx = -Math.sin(watcher.yaw);
    const fz = -Math.cos(watcher.yaw);
    if ((fx * dx + fz * dz) / dist <= 0) continue; // 등 뒤 반구 — 못 본다
    if (!world.level.hasLineOfSight(watcher.x, watcher.z, corpse.x, corpse.z)) continue;
    alertEnemy(watcher, balance.enemyAi.noticeDelayTicks);
    world.events.emit('enemy_alerted', {
      enemyId: watcher.id, enemyType: watcher.type, witnessed: true,
    });
  }
}

function handleSplit(world: World, enemy: EnemyState): void {
  if (enemy.splitHandled) return;
  enemy.splitHandled = true;
  alertWitnesses(world, enemy); // 눈앞에서 동료가 터졌다 — 본 놈들은 깬다
  // 먹은 것을 게워 낸다 — 배 속 아이템은 죽으면 전부 그 자리에 쏟아진다 (금액 그대로)
  if (enemy.eatenItems?.length) {
    for (let i = 0; i < enemy.eatenItems.length; i++) {
      const item = enemy.eatenItems[i]!;
      // 공통 드랍 규칙 — 게워 낸 것도 플레이어 반대쪽으로, 착지 유예 뒤에 줍힌다
      const at = scatterAwayFromPlayer(
        world, enemy.x, enemy.z, 0.5 + i * 0.12, balance.pickups.awayArcDeg,
      );
      item.x = at.x;
      item.z = at.z;
      item.magnet = false;
      item.y = undefined;
      item.speed = undefined;
      item.noMagnetTicks = balance.pickups.landNoMagnetTicks;
      world.groundItems.push(item);
    }
    world.events.emit('slime_spilled', { count: enemy.eatenItems.length, x: enemy.x, z: enemy.z });
    enemy.eatenItems = undefined;
  }
  // 사망 점액 — 터지며 흘린 체액이 그 자리에 느려지는 장판으로 남는다.
  // 화상 중 사망(말라붙음)·빙결 중 사망(통째로 깨짐)엔 흘릴 체액이 없다 — 분열과 같은 예외
  const dying = enemyDef(enemy.type);
  const dried = enemy.burnTicks > 0 || (enemy.freezeTicks ?? 0) > 0;
  if ((dying.deathGoo ?? 0) > 0 && !dried) {
    const goo = balance.goo;
    const puddles = (world.gooPuddles ??= []);
    for (let i = 0; i < (dying.deathGoo ?? 0); i++) {
      const ang = Math.random() * Math.PI * 2;
      const r = Math.random() * goo.deathScatter;
      puddles.push({
        id: nextGooId++,
        x: enemy.x + Math.sin(ang) * r,
        z: enemy.z + Math.cos(ang) * r,
        ticks: goo.lifeTicks,
      });
      if (puddles.length > goo.maxPuddles) puddles.shift();
    }
  }
  const split = dying.split;
  if (!split) return;
  if (dried) return;
  const def = enemyDef(split.into);
  // 흩뿌림 — 쌍둥이 금지: 기준 방향부터 랜덤이고, '가까운 놈/먼 놈' 역할을 갈라 뽑아
  // (누가 먼 쪽인지도 랜덤) 거리·높이·속도를 각자 굴린다. 한 놈은 발치에 철퍽,
  // 한 놈은 저 멀리 날아가는 그림이 나와야 살덩이답다
  const farIndex = Math.random() < 0.5 ? 0 : 1;
  const baseAng = Math.random() * Math.PI * 2;
  for (let i = 0; i < split.count; i++) {
    const ang =
      baseAng + (Math.PI * 2 * i) / split.count +
      ((Math.random() - 0.5) * (Math.PI / split.count)) * 1.4;
    const far = i % 2 === farIndex;
    const distMul = far ? 1.0 + Math.random() * 0.6 : 0.35 + Math.random() * 0.4;
    const hop = SCATTER_HOP_MIN + Math.random() * SCATTER_HOP_SPAN;
    const x = enemy.x + Math.sin(ang) * 0.4;
    const z = enemy.z + Math.cos(ang) * 0.4;
    const child: EnemyState = {
      id: nextSplitId++,
      type: split.into,
      x, z, prevX: x, prevZ: z,
      yaw: enemy.yaw, homeYaw: enemy.yaw,
      health: def.health, alive: true,
      ai: 'chase', // 반으로 갈라진 몸은 이미 성나 있다
      timer: 0,
      noticeTicks: balance.enemyAi.noticeDelayTicks,
      burnTicks: 0, burnDamagePerTick: 0,
      hearingMul: def.hearingMul,
      jumpY: hop, // 살덩이가 튀어오르며 갈라진다 — 낙하는 틱 루프의 감쇠가 맡는다
      prevJumpY: hop,
    };
    // 튕겨 나가며 태어난다 — 부모 자리에 겹쳐 있으면 해머 한 방에 같이 죽는다
    pushEnemy(
      child,
      Math.sin(ang),
      Math.cos(ang),
      (split.flingDistance ?? 0) * distMul,
      FLING_TICKS + Math.floor(Math.random() * 7) - 3,
    );
    world.enemies.push(child);
  }
  world.events.emit('enemy_split', {
    parentType: enemy.type, into: split.into, count: split.count, x: enemy.x, z: enemy.z,
  });
}

/** 새끼 분리 — 큐만 건다. 실제 사출은 emitBrood 가 한 마리씩 머리에서 순차로.
 *  healthCost 는 5마리 기준 — 부족분만 낳으면 그에 비례해서만 깎인다
 *  (10초 박자마다 도는 충원이라, 정액으로 두면 어미가 제 소환에 말라 죽는다) */
function spawnBrood(world: World, enemy: EnemyState, attack: EnemyAttackDef): void {
  const brood = attack.brood;
  if (!brood) return;
  // 총량 상한 — 살아 있는 새끼 수를 빼고 부족분만 낳는다 (3마리 살아 있으면 2마리만)
  const aliveKids = world.enemies.filter((e) => e.alive && e.type === brood.type).length;
  const spawnCount = Math.min(brood.count, Math.max(0, brood.maxAlive - aliveKids));
  if (spawnCount <= 0) return;
  enemy.broodLeft = spawnCount;
  enemy.broodTicks = 1; // 다음 틱부터 튀어나오기 시작
  const cost = Math.ceil(brood.healthCost * (spawnCount / brood.count));
  enemy.health = Math.max(1, enemy.health - cost); // 제 몸을 떼어 준 값
  world.events.emit('boss_brood', {
    enemyId: enemy.id, enemyType: enemy.type, count: spawnCount, x: enemy.x, z: enemy.z,
  });
}

/** 새끼 사출 — 간격마다 한 마리씩 어미 머리에서 포물선으로 뛰쳐나온다.
 *  플레이어가 가까우면(aimRange) 그쪽으로(랜덤 퍼짐), 멀면 제 앞 사방으로 */
function emitBrood(world: World, enemy: EnemyState): void {
  if (!enemy.broodLeft) return;
  const brood = enemyDef(enemy.type).summonAttack?.brood;
  if (!brood) {
    enemy.broodLeft = 0;
    return;
  }
  enemy.broodTicks = (enemy.broodTicks ?? 1) - 1;
  if ((enemy.broodTicks ?? 0) > 0) return;
  enemy.broodTicks = brood.emitIntervalTicks ?? 6;
  enemy.broodLeft--;

  const motherDef = enemyDef(enemy.type);
  const def = enemyDef(brood.type);
  const p = world.player;
  const pdx = p.x - enemy.x;
  const pdz = p.z - enemy.z;
  const pdist = Math.hypot(pdx, pdz);
  let dirX: number;
  let dirZ: number;
  if (pdist > 0.001 && pdist <= (brood.aimRange ?? 0)) {
    // 가까우면 플레이어 쪽으로 — 랜덤 퍼짐을 섞어 다섯 마리가 부채꼴로 덮친다
    const spread = (((brood.aimSpreadDeg ?? 0) * Math.PI) / 180) * (Math.random() - 0.5);
    const cos = Math.cos(spread);
    const sin = Math.sin(spread);
    dirX = (pdx / pdist) * cos + (pdz / pdist) * sin;
    dirZ = -(pdx / pdist) * sin + (pdz / pdist) * cos;
  } else {
    const i = brood.count - enemy.broodLeft - 1;
    const ang =
      enemy.yaw + (Math.PI * 2 * i) / brood.count + (Math.random() - 0.5) * SCATTER_ANG_JITTER * 0.6;
    dirX = Math.sin(ang);
    dirZ = Math.cos(ang);
  }
  const x = enemy.x + dirX * motherDef.radius * 0.5;
  const z = enemy.z + dirZ * motherDef.radius * 0.5;
  const child: EnemyState = {
    id: nextSplitId++,
    type: brood.type,
    noLoot: true, // 소환수 — 죽여도 보상 없음 (생명 입자만). 무한 파밍 방지
    x, z, prevX: x, prevZ: z,
    yaw: Math.atan2(-dirX, -dirZ), homeYaw: Math.atan2(-dirX, -dirZ),
    health: def.health, alive: true,
    ai: 'chase',
    timer: 0,
    noticeTicks: balance.enemyAi.noticeDelayTicks,
    burnTicks: 0, burnDamagePerTick: 0,
    hearingMul: def.hearingMul,
    // 머리 높이에서 태어나 포물선으로 떨어진다 — 낙하는 틱 루프의 BROOD_FALL 감쇠
    jumpY: motherDef.height * 0.9,
    prevJumpY: motherDef.height * 0.9,
  };
  pushEnemy(
    child,
    dirX,
    dirZ,
    (brood.flingDistance ?? 0) * (0.8 + Math.random() * 0.4),
    FLING_TICKS + Math.floor(Math.random() * 5) - 2,
  );
  world.enemies.push(child);
  world.events.emit('brood_pop', {
    enemyId: child.id, enemyType: enemy.type, x: enemy.x, z: enemy.z, left: enemy.broodLeft,
  });
}

/** 사출된 새끼의 낙하 속도 (m/틱) — 렌더 전용 높이(jumpY)가 바닥까지 내려온다 */
const BROOD_FALL = 0.1;

/** 슬라임 식탐 — 바닥 아이템을 지나가며 삼킨다. 삼킨 것은 죽을 때 전부 게워 낸다.
 *  열쇠·비석·각인은 안 먹는다 (진행이 배 속에 갇히면 안 된다). 자석에 걸린 것
 *  (플레이어가 이미 문 것)도 가로채지 않는다 */
function eatNearbyItems(world: World, enemy: EnemyState): void {
  const def = enemyDef(enemy.type);
  if (!def.eatsItems) return;
  const reach = def.radius + balance.pickups.slimeEat.reach;
  for (let i = world.groundItems.length - 1; i >= 0; i--) {
    const item = world.groundItems[i]!;
    if (item.kind === 'key' || item.kind === 'grave' || item.kind === 'sigil') continue;
    if (item.magnet) continue;
    if (Math.hypot(item.x - enemy.x, item.z - enemy.z) > reach) continue;
    world.groundItems.splice(i, 1);
    (enemy.eatenItems ??= []).push(item);
    world.events.emit('slime_ate', { enemyId: enemy.id, kind: item.kind, x: enemy.x, z: enemy.z });
  }
}

/** 슬라임 궤적 — 기어가는 동안 일정 간격으로 점액을 떨군다 */
function dropGoo(world: World, enemy: EnemyState): void {
  if (!enemyDef(enemy.type).gooTrail) return;
  if (Math.hypot(enemy.x - enemy.prevX, enemy.z - enemy.prevZ) < 1e-4) return;
  enemy.gooDropTicks = (enemy.gooDropTicks ?? 0) - 1;
  if ((enemy.gooDropTicks ?? 0) > 0) return;
  const goo = balance.goo;
  enemy.gooDropTicks = goo.dropIntervalTicks;
  const puddles = (world.gooPuddles ??= []);
  puddles.push({ id: nextGooId++, x: enemy.x, z: enemy.z, ticks: goo.lifeTicks });
  if (puddles.length > goo.maxPuddles) puddles.shift(); // 오래된 것부터 마른 셈 친다
}

/** 들러붙기 시작 — 돌격이 맞으면 피해 대신 매달린다 (attack.latches) */
function startLatch(world: World, enemy: EnemyState): void {
  const p = world.player;
  const dx = enemy.x - p.x;
  const dz = enemy.z - p.z;
  const d = Math.hypot(dx, dz) || 1;
  enemy.latchDirX = dx / d;
  enemy.latchDirZ = dz / d;
  enemy.ai = 'latched';
  enemy.timer = balance.ghoulGrapple.biteIntervalTicks;
  enemy.jumpY = 0;
  world.grappleEnemyId = enemy.id;
  world.grappleMash = 0;
  world.events.emit('ghoul_latch', { enemyId: enemy.id, enemyType: enemy.type });
}

/** 손아귀 풀기 — shoved 면 플레이어가 밀쳐낸 것: 구울이 튕겨 나가 무방비가 되고
 *  플레이어는 잠깐 무적(연속 붙잡기 방지). 아니면(사망·빙결 등) 조용히 놓는다 */
function releaseGrapple(world: World, enemy: EnemyState, shoved: boolean): void {
  if (world.grappleEnemyId === enemy.id) {
    world.grappleEnemyId = null;
    world.grappleMash = 0;
  }
  if (enemy.ai !== 'latched') return;
  if (shoved) {
    const grip = balance.ghoulGrapple;
    pushEnemy(enemy, enemy.latchDirX ?? 1, enemy.latchDirZ ?? 0, grip.shoveDistance, 16);
    enemy.ai = 'recover';
    enemy.timer = enemyDef(enemy.type).chargeAttack?.recoverTicks ?? 45;
    enemy.whiffed = true; // 밀쳐낸 직후는 무방비 — 반격 창
    world.player.iframeTicks = Math.max(world.player.iframeTicks, grip.escapeIframeTicks);
    world.player.iframeSource = 'escape'; // 탈출 무적의 출처 — 거수 돌격의 완벽 회피(미끄러짐)는 회피 무적('dodge')만 치니 지난 회피의 출처를 여기서 덮어쓴다(World.ts 규약: 무적을 세우는 쪽이 적는다, B3-4 검토)
    world.events.emit('grapple_escape', { enemyId: enemy.id, enemyType: enemy.type });
  } else {
    enemy.ai = 'chase';
    enemy.timer = 0;
  }
}

/** 얼굴 부착 — 낙하 명중·할퀴기 명중이 여기로 모인다. 흡혈은 tickFaceSuck 이 잇는다 */
function attachFace(world: World, enemy: EnemyState, def: ReturnType<typeof enemyDef>): void {
  enemy.ai = 'latched';
  enemy.timer = def.faceSuck!.intervalTicks;
  enemy.suckCount = 0;
  enemy.jumpY = balance.player.eyeHeight;
  world.faceLeechId = enemy.id;
  world.faceLeechMash = 0;
  world.events.emit('leech_face_attach', { enemyId: enemy.id });
}

/** 얼굴 흡혈 틱 — 얼굴에 붙어 화면을 가리고 피를 빤다. 해머 한 방 = 떼어 걷어차기,
 *  maxSucks 번 빨면 배불러 스스로 뒤로 점프해 떨어진다 */
function tickFaceSuck(world: World, enemy: EnemyState, def: ReturnType<typeof enemyDef>): void {
  const fs = def.faceSuck!;
  const p = world.player;
  if (world.dead || world.faceLeechId !== enemy.id) {
    detachFace(world, enemy, def, 'drop');
    return;
  }
  // 얼굴 높이에 붙어 따라다닌다 — 모델은 Stage 가 숨기고 화면 가림(HUD)이 대신한다
  enemy.x = p.x;
  enemy.z = p.z;
  enemy.jumpY = balance.player.eyeHeight;
  // 움켜쥐기 — 근접 키를 누르고 있는 동안은 입을 틀어막아 피를 못 빤다 (타이머 정지)
  const gripping = world.input.meleeHeld || world.input.meleePressed;
  if (!gripping) enemy.timer--;
  if (enemy.timer <= 0) {
    enemy.timer = fs.intervalTicks;
    enemy.suckCount = (enemy.suckCount ?? 0) + 1;
    const suckDmg = damagePlayer(world, fs.damage);
    enemy.health = Math.min(def.health, enemy.health + fs.heal); // 빤 만큼 제 몸이 찬다
    world.events.emit('leech_suck', { count: enemy.suckCount, max: fs.maxSucks });
    world.events.emit('player_damaged', { amount: suckDmg, health: p.health, source: 'leech_suck' });
    if (p.health <= 0) {
      p.health = 0;
      world.dead = true;
      world.events.emit('player_died', { tick: world.tick });
      detachFace(world, enemy, def, 'drop');
      return;
    }
    if ((enemy.suckCount ?? 0) >= fs.maxSucks) {
      detachFace(world, enemy, def, 'self'); // 배불렀다 — 스스로 뛰어내린다
      return;
    }
  }
  // 떼어내기 — 좀비 파먹기처럼 연타다. mashToEscape 번 누르면 떼어서 발로 걷어찬다
  if (world.input.meleePressed) {
    world.faceLeechMash++;
    world.events.emit('leech_struggle', { count: world.faceLeechMash, need: fs.mashToEscape });
    if (world.faceLeechMash >= fs.mashToEscape) {
      detachFace(world, enemy, def, 'kick');
    }
  }
  // 움켜쥔 손은 해머를 못 휘두른다 — 이 키는 지금 거머리를 쥐어뜯는 중이다
  world.input = { ...world.input, meleePressed: false, meleeHeld: false };
}

/** 얼굴에서 떨어진다 — kick: 걷어차여 멀리 + 길게 뻗음 / self: 스스로 점프 / drop: 조용히 */
function detachFace(
  world: World,
  enemy: EnemyState,
  def: ReturnType<typeof enemyDef>,
  how: 'kick' | 'self' | 'drop',
): void {
  if (world.faceLeechId === enemy.id) world.faceLeechId = null;
  enemy.suckCount = 0;
  const p = world.player;
  const fx = -Math.sin(p.yaw);
  const fz = -Math.cos(p.yaw);
  enemy.x = p.x + fx * 0.8; // 얼굴 앞에서 출발
  enemy.z = p.z + fz * 0.8;
  enemy.jumpY = how === 'kick' ? 1.3 : 0.9;
  const fs = def.faceSuck!;
  if (how !== 'drop') {
    pushEnemy(enemy, fx, fz, how === 'kick' ? fs.kickDistance : fs.selfDetachHop, 16);
  }
  enemy.ai = how === 'drop' ? 'chase' : 'recover';
  enemy.timer = how === 'kick' ? fs.kickStunTicks : 30;
  enemy.whiffed = how === 'kick'; // 걷어차인 놈은 무방비로 뻗는다
  enemy.groundTicks = def.ceilingLurk?.groundTicks ?? 0;
  // 배불리 먹고 스스로 내려온 놈은 무거워서 천장에 다시 못 올라간다 —
  // 재상승 + 위장 때문에 '사라진 것처럼' 보이던 문제의 답이기도 하다
  if (how === 'self') enemy.gorged = true;
  if (how === 'kick') world.events.emit('leech_face_kick', { enemyId: enemy.id });
  else if (how === 'self') world.events.emit('leech_face_detach', { enemyId: enemy.id });
}

/** 거머리 낙하 시작 — stunnedFall 이면 제자리 추락(뻗음), 아니면 먹이 좌표로 덮친다 */
function startDrop(
  world: World,
  enemy: EnemyState,
  lurk: NonNullable<ReturnType<typeof enemyDef>['ceilingLurk']>,
  stunnedFall: boolean,
): void {
  enemy.lurking = false;
  enemy.dropTicks = lurk.dropDurTicks;
  enemy.dropFromY = enemy.jumpY ?? 0;
  enemy.dropStunned = stunnedFall;
  // 활공 상한 — 소음에 깬 거머리가 12m 를 날아와 덮치면 피할 방법이 없다.
  // 발밑 사냥 반경 언저리(dropRadius×1.15)까지만 유도하고, 그 밖이면 제자리로
  // 떨어져 지상전으로 잇는다 (지상 도약은 적색 예고가 있어 공정하다)
  const p2 = world.player;
  const gdx = p2.x - enemy.x;
  const gdz = p2.z - enemy.z;
  const gd = Math.hypot(gdx, gdz);
  const homing = !stunnedFall && gd <= lurk.dropRadius * 1.15;
  enemy.dropTargetX = homing ? p2.x : enemy.x;
  enemy.dropTargetZ = homing ? p2.z : enemy.z;
  enemy.ai = 'chase';
  enemy.noticeTicks = 0;
  world.events.emit(stunnedFall ? 'leech_fall' : 'leech_drop', {
    enemyId: enemy.id, x: enemy.x, z: enemy.z,
  });
}

/** 관통 접촉 타격 — 몸이 닿는 그 틱에 즉시 들어간다. 한 번의 강하에 한 번만 */
/** 돌격 반동 — 방패·패링에 부딪힌 박쥐는 제 몸도 상한다. true 면 그 자리에서 즉사 */
function batRecoilDamage(world: World, enemy: EnemyState, amount: number): boolean {
  enemy.health -= amount;
  world.events.emit('bat_recoil', { enemyId: enemy.id, x: enemy.x, z: enemy.z, amount });
  if (enemy.health > 0) return false;
  enemy.alive = false;
  world.events.emit('enemy_died', { enemyId: enemy.id, enemyType: enemy.type, x: enemy.x, z: enemy.z, noLoot: enemy.noLoot });
  return true;
}

function batGraze(
  world: World,
  enemy: EnemyState,
  def: ReturnType<typeof enemyDef>,
  fly: NonNullable<ReturnType<typeof enemyDef>['flying']>,
): void {
  const p = world.player;
  if (enemy.swoopHitDone || world.dead || p.iframeTicks > 0) return;
  const gdx = p.x - enemy.x;
  const gdz = p.z - enemy.z;
  if (Math.hypot(gdx, gdz) > def.attackRange) return;
  // 정확한 타이밍 패링 — 닿는 순간(직전 8틱 버퍼 포함) 반응 버튼이면 받아쳐 떨어뜨린다.
  // 방어(홀드)와 다르다: 누르는 '순간'만 성립 — 붉은 돌진의 유일한 반격 창
  if (world.input.reactionPressed || (p.parryBufferTicks ?? 0) > 0) {
    p.parryBufferTicks = 0;
    enemy.swoopHitDone = true;
    world.events.emit('bat_parried', { enemyId: enemy.id, x: enemy.x, z: enemy.z });
    // 반동 — 정확히 받아친 몸통에 박쥐도 상한다. 여기서 죽으면 추락할 몸도 없다
    const recP = fly.chargeRecoil?.parried ?? 0;
    if (recP > 0 && batRecoilDamage(world, enemy, recP)) return;
    enemy.ai = 'chase'; // 돌진 취소 — 아래 추락 블록이 이어받는다
    enemy.timer = 0;
    enemy.batFallTicks = fly.knockdown.fallTicks;
    enemy.flyFallFromY = enemy.jumpY ?? fly.strikeHeight;
    world.events.emit('bat_knockdown', { enemyId: enemy.id, x: enemy.x, z: enemy.z });
    return;
  }
  const blocked = playerBlocks(world, enemy.x, enemy.z, balance.block.arcDeg);
  const dmg = damagePlayer(world, blocked ? def.damage * balance.block.chipDamageRatio : def.damage);
  // 방패에 챙! — 칩 피해만 남기고 박쥐는 그대로 뚫고 지나간다
  if (blocked) world.events.emit('block_hit', { amount: dmg, kind: 'bat' });
  pushPlayer(p, gdx, gdz, def.chargeAttack?.playerKnockback ?? 1, balance.playerKnockback.ticks);
  world.events.emit('player_damaged', {
    amount: dmg, health: p.health, blocked,
    srcX: enemy.x, srcZ: enemy.z, srcId: enemy.id, source: 'bat_slam',
  });
  if (p.health <= 0) {
    p.health = 0;
    world.dead = true;
    world.events.emit('player_died', { tick: world.tick });
  }
  enemy.swoopHitDone = true;
  // 방패 반동 — 챙 소리와 함께 박쥐 몸도 상한다 (막기가 곧 반격이다)
  if (blocked) {
    const recB = fly.chargeRecoil?.blocked ?? 0;
    if (recB > 0 && batRecoilDamage(world, enemy, recB)) return;
  }
  if (!blocked && fly.slamHeal) {
    enemy.health = Math.min(def.health, enemy.health + fly.slamHeal);
    world.events.emit('bat_drain', { enemyId: enemy.id, x: enemy.x, z: enemy.z });
  }
}

/** 박치기 개시 — 예고(정지 비행)는 일반 windup 이 굴리고, 돌진은 전용 관통 대시가 잇는다 */
function startSwoop(world: World, enemy: EnemyState, ch: EnemyAttackDef): void {
  const p = world.player;
  enemy.swoopCooldown = ch.cooldownTicks ?? 160;
  enemy.attackMode = 'charge';
  enemy.noticeTicks = 0;
  enemy.swoopAnnounced = false; // 비명은 발사 순간에 — 예고는 조용한 정지 비행
  enemy.swoopHitDone = false;
  enemy.yaw = Math.atan2(-(p.x - enemy.x), -(p.z - enemy.z));
  startWindup(world, enemy, ch);
}

/** 비행체(박쥐) 틱 — 순항·추락·기절이 일반 AI 를 덮는다. true 면 이번 틱은 여기서 끝.
 *  급강하는 일반 chargeAttack 기계를 그대로 쓴다(패링·청색 예고·경직 규약 재사용):
 *  예고 동안 낙하 감쇠(BROOD_FALL)가 고도를 자연히 깎아 내려앉고, 도약 포물선과
 *  저공 경직(recover)이 근접의 창이 된다 */
function tickFlying(
  world: World,
  enemy: EnemyState,
  def: ReturnType<typeof enemyDef>,
  fly: NonNullable<ReturnType<typeof enemyDef>['flying']>,
  dt: number,
): boolean {
  const p = world.player;
  const kd = fly.knockdown;

  // 피해 누적 게이지 — 총·해머·마법·화상 무엇이든 체력 변화로 잡는다
  const last = enemy.flyLastHealth ?? enemy.health;
  const taken = last - enemy.health;
  enemy.flyLastHealth = enemy.health;
  const grounded = (enemy.downTicks ?? 0) > 0 || (enemy.batFallTicks ?? 0) > 0;
  if (!grounded) {
    enemy.knockdownGauge = Math.max(0, (enemy.knockdownGauge ?? 0) - kd.decayPerTick);
    if (taken > 0) enemy.knockdownGauge = (enemy.knockdownGauge ?? 0) + taken;
  }

  // 바닥 기절 — 뒤집혀 퍼덕인다. staggered 규약(황색·처형각)을 그대로 쓴다
  if ((enemy.downTicks ?? 0) > 0) {
    enemy.downTicks = (enemy.downTicks ?? 0) - 1;
    enemy.jumpY = 0;
    if ((enemy.downTicks ?? 0) <= 0) {
      enemy.knockdownGauge = 0; // 다시 날 기회 — 게이지는 처음부터
      enemy.ai = 'chase';
      enemy.timer = 0;
    }
    return true;
  }
  // 추락 중 — 그 자리에서 곤두박질
  if ((enemy.batFallTicks ?? 0) > 0) {
    enemy.batFallTicks = (enemy.batFallTicks ?? 0) - 1;
    const t = 1 - (enemy.batFallTicks ?? 0) / kd.fallTicks;
    enemy.jumpY = Math.max(0, (enemy.flyFallFromY ?? fly.cruiseHeight) * (1 - t * t));
    if ((enemy.batFallTicks ?? 0) <= 0) {
      enemy.jumpY = 0;
      enemy.downTicks = kd.stunTicks;
      enemy.ai = 'staggered';
      enemy.timer = kd.stunTicks;
      world.events.emit('bat_downed', { enemyId: enemy.id, x: enemy.x, z: enemy.z });
    }
    return true;
  }
  // 추락 조건 — 누적 게이지 / 큰 한 방 / 공중 스태거(패링)
  const airborne = (enemy.jumpY ?? 0) > 0.4;
  if (
    (enemy.knockdownGauge ?? 0) >= kd.damageThreshold ||
    taken >= kd.instantDamage ||
    (enemy.ai === 'staggered' && airborne)
  ) {
    enemy.ai = 'chase'; // 진행 중이던 강하·경직은 끊긴다
    enemy.timer = 0;
    enemy.attackFreezeTicks = 0;
    if (airborne) {
      enemy.batFallTicks = kd.fallTicks;
      enemy.flyFallFromY = enemy.jumpY ?? fly.cruiseHeight;
    } else {
      // 이미 저공 — 그 자리에서 뻗는다
      enemy.jumpY = 0;
      enemy.downTicks = kd.stunTicks;
      enemy.ai = 'staggered';
      enemy.timer = kd.stunTicks;
      world.events.emit('bat_downed', { enemyId: enemy.id, x: enemy.x, z: enemy.z });
      return true;
    }
    world.events.emit('bat_knockdown', { enemyId: enemy.id, x: enemy.x, z: enemy.z });
    return true;
  }

  // 공격 상태 — 이동·판정·패링은 일반 기계가 굴리고, 높이와 후퇴만 여기서 만든다
  if (enemy.ai !== 'chase' && enemy.ai !== 'idle') {
    // 관통 대시 — 일반 돌격 기계(판정 창·정지)를 쓰지 않는다. 몸이 닿는 그 틱에
    // 즉시 타격하고, 멈추지 않고 예고 좌표를 지나 직선으로 계속 나간다
    if (enemy.ai === 'charging') {
      if (!enemy.swoopAnnounced) {
        // 발사 비명 — 예고가 끝나고 돌진이 시작되는 바로 그 순간 ("암시와 동시에 박치기")
        enemy.swoopAnnounced = true;
        world.events.emit('bat_swoop', { enemyId: enemy.id, enemyType: enemy.type, x: enemy.x, z: enemy.z });
        // 진행 방향 — 예고 좌표(chargeTarget)로 고정. 이후 절대 꺾지 않는다 (회피 성립)
        const tdx = (enemy.chargeTargetX ?? p.x) - enemy.x;
        const tdz = (enemy.chargeTargetZ ?? p.z) - enemy.z;
        const td = Math.hypot(tdx, tdz) || 1;
        enemy.batDashDirX = tdx / td;
        enemy.batDashDirZ = tdz / td;
        enemy.yaw = Math.atan2(-(enemy.batDashDirX ?? 0), -(enemy.batDashDirZ ?? 0));
      }
      const ch2 = def.chargeAttack!;
      const sp2 = (ch2.chargeSpeed ?? 20) * slowFactor(enemy) * dt;
      world.level.slideMove(
        enemy, def.radius, (enemy.batDashDirX ?? 0) * sp2, (enemy.batDashDirZ ?? 0) * sp2,
      );
      enemy.jumpY = fly.strikeHeight; // 얼굴 높이 유지 — 해머가 닿는 관통 구간
      batGraze(world, enemy, def, fly); // 닿는 순간이 곧 타격이다
      enemy.timer--;
      if (enemy.timer <= 0) {
        enemy.ai = 'recover';
        enemy.timer = enemy.swoopHitDone ? ch2.recoverTicks : (ch2.whiffRecoverTicks ?? ch2.recoverTicks);
        if (!enemy.swoopHitDone) enemy.whiffed = true; // 허공을 갈랐다 — 반격 창
      }
      return true;
    }
    if (enemy.ai === 'windup') {
      // 제자리 준비자세 — 맹렬히 펄럭이며(시각은 Stage) 타격 높이(얼굴께)로 맞춘다
      const d = fly.strikeHeight - (enemy.jumpY ?? 0);
      enemy.jumpY = (enemy.jumpY ?? 0) + Math.max(-0.05, Math.min(0.12, d));
    } else if (enemy.ai === 'recover') {
      // 관통 비행 — 박은 방향 그대로 지나쳐 등 뒤로 빠진다. 플레이어가 몸을 돌려야
      // 다시 보인다. 고도가 해머 높이를 넘기 전까지가 근접의 창이다
      const fx2 = -Math.sin(enemy.yaw);
      const fz2 = -Math.cos(enemy.yaw);
      world.level.slideMove(
        enemy,
        def.radius,
        fx2 * fly.retreatSpeed * dt,
        fz2 * fly.retreatSpeed * dt,
      );
      enemy.jumpY = Math.min(fly.cruiseHeight, (enemy.jumpY ?? 0) + fly.retreatClimbPerTick);
      // 빠져나가는 동안에도 몸이 닿으면 그게 곧 박치기다 (한 강하 한 번)
      batGraze(world, enemy, def, fly);
    }
    return false;
  }

  // 순항 고도 — 목표(순항 + 출렁임)로 수렴. 낙하 감쇠(0.1/틱)보다 빨라야 떠 있는다
  // 랜턴 속박 중엔 느긋한 출렁임 대신 덜덜 떤다 — 작은 폭·빠른 주기 (빛에 짓눌린 공포)
  const tremble = (enemy.batLitTicks ?? 0) > 0 ? fly.lanternFreezeTremble : undefined;
  const bob = tremble
    ? Math.sin(((world.tick + enemy.id * 53) / tremble.periodTicks) * Math.PI * 2) * tremble.amp
    : Math.sin(((world.tick + enemy.id * 53) / fly.bobPeriodTicks) * Math.PI * 2) * fly.bobAmp;
  const targetY = fly.cruiseHeight + bob;
  const deltaY = targetY - (enemy.jumpY ?? 0);
  enemy.jumpY =
    (enemy.jumpY ?? 0) + Math.max(-fly.climbPerTick, Math.min(fly.climbPerTick, deltaY));

  if (enemy.ai === 'idle') return false; // 대기 부유 — 시야·소음 판정은 일반 idle

  const dx = p.x - enemy.x;
  const dz = p.z - enemy.z;
  const dist = Math.hypot(dx, dz);
  if ((enemy.swoopCooldown ?? 0) > 0) enemy.swoopCooldown = (enemy.swoopCooldown ?? 0) - 1;
  if ((enemy.packDiveCooldown ?? 0) > 0) enemy.packDiveCooldown = (enemy.packDiveCooldown ?? 0) - 1;

  // 랜턴 속박 — 빛기둥에 잡힌 박쥐는 눈이 멀어 그 자리에 얼어붙는다.
  // 비추는 동안 총으로 잡으라는 설계 — 빔이 벗어나면 즉시 풀리고,
  // 쿨다운은 속박 중에도 돌아 랜턴을 끄는 순간 반격이 온다
  if (
    fly.lanternFreeze &&
    litByLantern(world, dist, dx, dz) &&
    world.level.hasLineOfSight(enemy.x, enemy.z, p.x, p.z)
  ) {
    if ((enemy.batLitTicks ?? 0) <= 0) {
      world.events.emit('bat_transfixed', { enemyId: enemy.id, x: enemy.x, z: enemy.z });
    }
    enemy.batLitTicks = 2; // 비추는 동안 매 틱 갱신 — 빔이 떠나면 곧 풀린다
    if (dist > 0.001) enemy.yaw = Math.atan2(-dx, -dz);
    return true;
  }
  if ((enemy.batLitTicks ?? 0) > 0) enemy.batLitTicks = (enemy.batLitTicks ?? 0) - 1;

  // 비명 여운 — 파문이 다 퍼질 때까지 제자리에서 먹이를 노려본다 (선회·강하 없음)
  if ((enemy.screamHoldTicks ?? 0) > 0) {
    enemy.screamHoldTicks = (enemy.screamHoldTicks ?? 0) - 1;
    if (dist > 0.001) enemy.yaw = Math.atan2(-dx, -dz);
    return true;
  }

  // 박치기 개시 — 무리 강하 조건이면 곁의 준비된 박쥐들이 함께 몸을 던진다
  const ch = def.chargeAttack;
  if (
    ch &&
    (enemy.swoopCooldown ?? 0) <= 0 &&
    dist >= (ch.minRange ?? 0) &&
    dist <= (ch.maxRange ?? 99) &&
    world.level.hasLineOfSight(enemy.x, enemy.z, p.x, p.z)
  ) {
    // 무리 모으기 — 반경 안에서 강하 준비가 끝난(쿨다운 0·비행 중) 동료들
    const pack = fly.packDive;
    let packed: EnemyState[] | null = null;
    if (pack && (enemy.packDiveCooldown ?? 0) <= 0) {
      // 신호를 받은 동료는 제 박치기 쿨다운과 무관하게 합류한다 — 쿨다운을 요구하면
      // 각자 솔로 박치기로 쿨다운이 어긋나 무리 강하가 영영 안 나온다 (실측 버그).
      // 무리 참가 자체의 빈도는 packDiveCooldown 이 따로 막는다
      const others = world.enemies.filter(
        (o) =>
          o !== enemy &&
          o.alive &&
          enemyDef(o.type).flying !== undefined &&
          (o.ai === 'chase' || o.ai === 'idle') &&
          (o.packDiveCooldown ?? 0) <= 0 &&
          (o.downTicks ?? 0) <= 0 &&
          (o.batFallTicks ?? 0) <= 0 &&
          (o.batLitTicks ?? 0) <= 0 && // 랜턴 속박 우선 — 빛에 짓눌린 몸은 무리 신호에도 못 뜬다

          Math.hypot(o.x - enemy.x, o.z - enemy.z) <= pack.radius,
      );
      if (others.length + 1 >= pack.minCount) packed = others;
    }
    startSwoop(world, enemy, ch);
    if (packed) {
      for (const o of packed) {
        startSwoop(world, o, enemyDef(o.type).chargeAttack ?? ch);
        o.packDiveCooldown = pack!.cooldownTicks;
      }
      enemy.packDiveCooldown = pack!.cooldownTicks;
      // 무리 신호음은 모이는 순간에 — 각자의 발사 비명(bat_swoop)은 돌진 순간에 따로 난다
      world.events.emit('bat_pack_dive', {
        count: packed.length + 1, x: enemy.x, z: enemy.z,
      });
    }
    return true;
  }

  // 초음파 비명 — 몸을 못 던지는 동안(강하 쿨다운) 성가시게 조준을 흔든다
  const sc = fly.scream;
  if (sc) {
    enemy.screamCooldown =
      (enemy.screamCooldown ?? Math.floor(Math.random() * sc.cooldownTicks)) - 1;
    if (
      (enemy.screamCooldown ?? 0) <= 0 &&
      dist <= sc.radius &&
      world.level.hasLineOfSight(enemy.x, enemy.z, p.x, p.z)
    ) {
      enemy.screamCooldown = sc.cooldownTicks;
      enemy.screamHoldTicks = sc.shakeTicks; // 파문이 퍼지는 동안 제자리에 떠 있는다
      p.aimShakeTicks = Math.max(p.aimShakeTicks ?? 0, sc.shakeTicks);
      p.aimShakeAmp = sc.shakeAmp;
      world.events.emit('bat_scream', { enemyId: enemy.id, x: enemy.x, z: enemy.z });
    }
  }

  // 선회 — 거리 밴드 유지 + 갈지자. 벽은 slideMove 가 밀어낸다
  enemy.flyJinkTicks = (enemy.flyJinkTicks ?? 0) - 1;
  if ((enemy.flyJinkTicks ?? 0) <= 0) {
    enemy.flyJinkTicks = fly.jinkTicks + Math.floor(Math.random() * fly.jinkTicks);
    enemy.flyOrbitDir = Math.random() < 0.5 ? -1 : 1;
  }
  if (dist > 0.001) {
    const ux = dx / dist;
    const uz = dz / dist;
    let radial = 0;
    if (dist > fly.orbitMax) radial = 1;
    else if (dist < fly.orbitMin) radial = -1;
    const tdir = enemy.flyOrbitDir ?? 1;
    const mx = ux * radial + -uz * tdir * 0.9;
    const mz = uz * radial + ux * tdir * 0.9;
    const ml = Math.hypot(mx, mz) || 1;
    const sp = def.speed * slowFactor(enemy) * dt;
    world.level.slideMove(enemy, def.radius, (mx / ml) * sp, (mz / ml) * sp);
    enemy.yaw = Math.atan2(-dx, -dz); // 몸은 날아도 눈은 먹이를 본다
  }
  // 날갯짓 — 위치를 흘리는 상시 단서 (들리는 거리에서만, 패닝은 main)
  enemy.flapTicks =
    (enemy.flapTicks ?? Math.floor(Math.random() * fly.flapIntervalTicks)) - 1;
  if ((enemy.flapTicks ?? 0) <= 0) {
    enemy.flapTicks = fly.flapIntervalTicks;
    if (dist <= 16) world.events.emit('bat_flap', { enemyId: enemy.id, x: enemy.x, z: enemy.z });
  }
  return true;
}

/** 벽거미 틱 — 붙기·기기·도약이 일반 AI 를 덮는다. true 면 이번 틱은 여기서 끝 */
/** 도약 타격 — 비행 접촉·착지 광역이 공유한다. 막으면 칩 피해만 (붉은 예고라 패링 불가) */
function pounceStrike(
  world: World,
  enemy: EnemyState,
  wc: NonNullable<ReturnType<typeof enemyDef>['wallCrawl']>,
): void {
  const p = world.player;
  const idx = p.x - enemy.x;
  const idz = p.z - enemy.z;
  const blocked = playerBlocks(world, enemy.x, enemy.z, balance.block.arcDeg);
  const dmg = damagePlayer(world, blocked ? wc.pounceDamage * balance.block.chipDamageRatio : wc.pounceDamage);
  if (blocked) world.events.emit('block_hit', { amount: dmg, kind: 'wall_pounce' });
  pushPlayer(p, idx, idz, wc.pounceKnockback, balance.playerKnockback.ticks);
  world.events.emit('player_damaged', {
    amount: dmg, health: p.health, blocked, srcX: enemy.x, srcZ: enemy.z, srcId: enemy.id, source: 'wall_pounce',
  });
  if (p.health <= 0) {
    p.health = 0;
    world.dead = true;
    world.events.emit('player_died', { tick: world.tick });
  }
  enemy.wallPounceHitDone = true;
}

function tickWallSpider(
  world: World,
  enemy: EnemyState,
  def: ReturnType<typeof enemyDef>,
  wc: NonNullable<ReturnType<typeof enemyDef>['wallCrawl']>,
  dt: number,
): boolean {
  const p = world.player;
  if ((enemy.wallPounceCooldown ?? 0) > 0) {
    enemy.wallPounceCooldown = (enemy.wallPounceCooldown ?? 0) - 1;
  }
  if ((enemy.wallAttachCooldown ?? 0) > 0) {
    enemy.wallAttachCooldown = (enemy.wallAttachCooldown ?? 0) - 1;
  }

  // 도약 비행 — 예고 '시점'의 먹이 좌표로 하강 곡선 (옆으로 비키면 헛짚는다)
  if ((enemy.wallPounceTicks ?? 0) > 0) {
    enemy.wallPounceTicks = (enemy.wallPounceTicks ?? 0) - 1;
    const remain = Math.max(1, enemy.wallPounceTicks ?? 0);
    const stepX = ((enemy.wallPounceTX ?? enemy.x) - enemy.x) / remain;
    const stepZ = ((enemy.wallPounceTZ ?? enemy.z) - enemy.z) / remain;
    world.level.slideMove(enemy, def.radius, stepX, stepZ);
    if (Math.hypot(stepX, stepZ) > 1e-3) enemy.yaw = Math.atan2(-stepX, -stepZ);
    const t = 1 - (enemy.wallPounceTicks ?? 0) / wc.pounceAirTicks;
    enemy.jumpY = Math.max(0, (enemy.wallPounceFromY ?? wc.height) * (1 - t * t));
    // 관통 접촉 — 내리꽂는 몸이 스치면 그 순간이 곧 타격이다. 착지까지 기다리면
    // 몸을 뚫고 지나가고도 노딜이 된다 (실측 체감 버그). 머리 위를 넘는 초반
    // 고공 구간(jumpY > 키)은 닿은 게 아니다
    if (
      !(enemy.wallPounceHitDone ?? false) &&
      !world.dead &&
      p.iframeTicks <= 0 &&
      (enemy.jumpY ?? 0) <= balance.player.height &&
      Math.hypot(p.x - enemy.x, p.z - enemy.z) <= (wc.pounceContactRadius ?? 0) + balance.player.radius
    ) {
      pounceStrike(world, enemy, wc);
    }
    if ((enemy.wallPounceTicks ?? 0) > 0) return true;
    // 착지 — 광역 판정 (비행에서 이미 맞혔으면 중복 타격 없이 명중 착지로 처리).
    // 회피 무적이면 통째로 헛디딘다
    enemy.jumpY = 0;
    const idist = Math.hypot(p.x - enemy.x, p.z - enemy.z);
    const hit =
      (enemy.wallPounceHitDone ?? false) ||
      (idist <= wc.pounceRadius && p.iframeTicks <= 0 && !world.dead);
    if (hit) {
      if (!(enemy.wallPounceHitDone ?? false)) pounceStrike(world, enemy, wc);
      enemy.ai = 'recover';
      enemy.timer = wc.pounceRecoverTicks;
    } else {
      enemy.ai = 'recover';
      enemy.timer = wc.pounceWhiffTicks;
      enemy.whiffed = true; // 허공을 덮치고 뻗었다 — 반격 창
    }
    enemy.wallPounceCooldown = wc.cooldownTicks;
    world.events.emit('wall_pounce_land', { enemyId: enemy.id, x: enemy.x, z: enemy.z, hit });
    return true;
  }

  // 도약 예고 — 벽에 붙은 채 웅크린다. 적색 발광은 Stage 가 wallWindupTicks 로 그린다
  if ((enemy.wallWindupTicks ?? 0) > 0) {
    enemy.wallWindupTicks = (enemy.wallWindupTicks ?? 0) - 1;
    if ((enemy.wallWindupTicks ?? 0) > 0) return true;
    enemy.wallCling = false;
    enemy.wallPounceTicks = wc.pounceAirTicks;
    enemy.wallPounceFromY = enemy.jumpY ?? wc.height;
    enemy.wallPounceHitDone = false;
    // 발사 순간 재조준 — 예고 '시작' 좌표로 던지면 예고+비행 0.87초 내내 걷기만 해도
    // 벗어나 거의 늘 헛디뎠다 (점프→착지→일반 예고→공격의 맥빠진 패턴). 이제 회피
    // 요구는 비행 0.3초 — 발사 비명을 듣고 대시로 비켜야 한다
    enemy.wallPounceTX = p.x;
    enemy.wallPounceTZ = p.z;
    enemy.yaw = Math.atan2(-(p.x - enemy.x), -(p.z - enemy.z));
    world.events.emit('wall_pounce', { enemyId: enemy.id, enemyType: enemy.type, x: enemy.x, z: enemy.z });
    return true;
  }

  // 오르내리기/추락 전이 — jumpY 를 벽 높이로/바닥으로 보간
  if ((enemy.wallClimbTicks ?? 0) > 0) {
    enemy.wallClimbTicks = (enemy.wallClimbTicks ?? 0) - 1;
    const total = enemy.wallFalling ? wc.fallTicks : wc.climbTicks;
    const t = 1 - (enemy.wallClimbTicks ?? 0) / total;
    enemy.jumpY = enemy.wallCling ? wc.height * t : (enemy.wallClimbFromY ?? wc.height) * (1 - t);
    // 오르는 동안 벽에 몸을 눌러 붙인다 — 전이 전체로 탐침 거리(attachRange)를 닫으므로
    // 셀 가운데서 시작해도 반드시 벽면에 닿는다 (벽이 먼저 멈춰 세운다)
    if (enemy.wallCling && enemy.wallNX !== undefined) {
      const press = wc.attachRange / wc.climbTicks;
      world.level.slideMove(enemy, def.radius, -(enemy.wallNX ?? 0) * press, -(enemy.wallNZ ?? 0) * press);
    }
    if ((enemy.wallClimbTicks ?? 0) > 0) return true;
    if (!enemy.wallCling) {
      enemy.jumpY = 0;
      if (enemy.wallFalling) {
        // 붙은 채 맞아 떨어졌다 — 뻗는다 (올려친 플레이어의 보상. 매달린 거머리와 같은 규칙)
        enemy.wallFalling = false;
        enemy.ai = 'recover';
        enemy.timer = wc.fallStunTicks;
        enemy.whiffed = true;
      }
    }
    return true;
  }

  if (!enemy.wallCling) {
    // 지상 → 벽 붙기: 추격 중 + 벽이 탐침에 닿음 + 먹이가 도약 최소거리 밖 + 재사용 대기 없음
    if (enemy.ai !== 'chase' || (enemy.kbTicks ?? 0) > 0 || (enemy.flinchTicks ?? 0) > 0) return false;
    if ((enemy.wallPounceCooldown ?? 0) > 0) return false;
    if ((enemy.wallAttachCooldown ?? 0) > 0) return false; // 방금 내려왔다 — 바닥으로 간다
    const adx = p.x - enemy.x;
    const adz = p.z - enemy.z;
    if (Math.hypot(adx, adz) <= wc.pounceMinRange) return false;
    const n = findWallNormal(world.level, enemy.x, enemy.z, def.radius, wc.attachRange, 0.75);
    if (!n) return false;
    enemy.wallCling = true;
    enemy.wallNX = n.nx;
    enemy.wallNZ = n.nz;
    enemy.wallClimbTicks = wc.climbTicks;
    world.events.emit('wall_attach', { enemyId: enemy.id, x: enemy.x, z: enemy.z });
    return true;
  }

  // ── 벽에 붙어 있음 ──
  // 맞거나 밀리거나 얼면 떨어진다 — 매달린 거머리와 같은 규칙
  if ((enemy.flinchTicks ?? 0) > 0 || (enemy.kbTicks ?? 0) > 0 || (enemy.freezeTicks ?? 0) > 0) {
    enemy.wallCling = false;
    enemy.wallFalling = true;
    enemy.wallClimbFromY = enemy.jumpY ?? wc.height;
    enemy.wallClimbTicks = wc.fallTicks;
    world.events.emit('wall_fall', { enemyId: enemy.id, x: enemy.x, z: enemy.z });
    return true;
  }
  // 매복(idle) — 붙은 채 가만히. 시야·소음 판정은 일반 idle 이 그대로 한다
  if (enemy.ai !== 'chase') return false;

  const dx = p.x - enemy.x;
  const dz = p.z - enemy.z;
  const dist = Math.hypot(dx, dz);
  // 벽 확인(짧은 탐침) — 문·모퉁이에서 벽이 끊겼으면 내려간다
  const n = findWallNormal(world.level, enemy.x, enemy.z, def.radius, 0.9, 0.6);
  if (!n || dist < wc.pounceMinRange) {
    // 벽이 없거나 먹이가 코앞 — 내려와 일반 전투. 곧장 다시 붙으면 문 앞에서
    // 오르내리기만 반복하므로 잠시 바닥 우회(흐름장)에게 맡긴다
    enemy.wallCling = false;
    enemy.wallClimbFromY = enemy.jumpY ?? wc.height;
    enemy.wallClimbTicks = wc.climbTicks;
    enemy.wallAttachCooldown = wc.reattachDelayTicks ?? 0;
    return true;
  }
  enemy.wallNX = n.nx;
  enemy.wallNZ = n.nz;
  // 도약 — 사거리 안 + 시야선. 예고 시점의 먹이 좌표를 기억한다
  if (
    dist <= wc.pounceMaxRange &&
    (enemy.wallPounceCooldown ?? 0) <= 0 &&
    world.level.hasLineOfSight(enemy.x, enemy.z, p.x, p.z)
  ) {
    enemy.wallWindupTicks = wc.pounceWindupTicks;
    enemy.wallPounceTX = p.x;
    enemy.wallPounceTZ = p.z;
    enemy.yaw = Math.atan2(-dx, -dz);
    world.events.emit('enemy_windup', { enemyId: enemy.id, enemyType: enemy.type, telegraph: 'red' });
    return true;
  }
  // 접선 이동 — 법선에 수직인 두 방향 중 먹이에 가까워지는 쪽. 벽쪽으로도 살짝 눌러 붙는다
  const tx = -n.nz;
  const tz = n.nx;
  const side = tx * dx + tz * dz >= 0 ? 1 : -1;
  const sp = def.speed * wc.speedMul * slowFactor(enemy) * dt;
  if ((enemy.stuckCount ?? 0) === 0) {
    enemy.stuckFromX = enemy.x;
    enemy.stuckFromZ = enemy.z;
  }
  world.level.slideMove(enemy, def.radius, (tx * side - n.nx * 0.6) * sp, (tz * side - n.nz * 0.6) * sp);
  enemy.yaw = Math.atan2(-tx * side, -tz * side);
  // 끼임 감지 — 먹이와 최단인 벽 지점(문 옆)에서 접선이 매 틱 반전하며 제자리
  // 진동하면 순변위가 바닥난다. 벽을 포기하고 내려가 바닥 우회(흐름장)로 잇는다
  {
    const un = balance.enemyAi.unstick;
    enemy.stuckExpect = (enemy.stuckExpect ?? 0) + sp;
    enemy.stuckCount = (enemy.stuckCount ?? 0) + 1;
    if ((enemy.stuckCount ?? 0) >= un.checkTicks) {
      const net = Math.hypot(
        enemy.x - (enemy.stuckFromX ?? enemy.x),
        enemy.z - (enemy.stuckFromZ ?? enemy.z),
      );
      const wedged = net < (enemy.stuckExpect ?? 0) * un.minProgress;
      enemy.stuckExpect = 0;
      enemy.stuckCount = 0;
      if (wedged) {
        enemy.wallCling = false;
        enemy.wallClimbFromY = enemy.jumpY ?? wc.height;
        enemy.wallClimbTicks = wc.climbTicks;
        enemy.wallAttachCooldown = wc.reattachDelayTicks ?? 0;
        enemy.unstickTicks = un.ticks; // 착지하자마자 흐름장 우회를 시작한다
        world.events.emit('wall_fall', { enemyId: enemy.id, x: enemy.x, z: enemy.z });
        return true;
      }
    }
  }
  // 사각사각 — 위치를 흘리는 단서 (구울 흐느낌과 같은 역할, 들리는 거리에서만)
  enemy.skitterTicks = (enemy.skitterTicks ?? Math.floor(Math.random() * wc.skitterIntervalTicks)) - 1;
  if ((enemy.skitterTicks ?? 0) <= 0) {
    enemy.skitterTicks = wc.skitterIntervalTicks;
    if (dist <= 16) world.events.emit('spider_skitter', { enemyId: enemy.id, x: enemy.x, z: enemy.z });
  }
  return true;
}

/** 거머리 지상 체류 — 오래 머물렀고 먹이가 멀면 천장으로 되돌아간다 */
function tickLeechGround(world: World, enemy: EnemyState): void {
  const def = enemyDef(enemy.type);
  const lurk = def.ceilingLurk;
  if (!lurk || enemy.lurking) return;
  if (enemy.gorged) return; // 배불리 먹었다 — 무거워서 못 올라간다. 지상전뿐
  if ((enemy.dropTicks ?? 0) > 0 || (enemy.ascendTicks ?? 0) > 0) return;
  if (enemy.ai !== 'chase') return; // 공격·경직 중에는 재지 않는다
  enemy.groundTicks = (enemy.groundTicks ?? lurk.groundTicks) - 1;
  if ((enemy.groundTicks ?? 0) > 0) return;
  const p = world.player;
  if (Math.hypot(p.x - enemy.x, p.z - enemy.z) < lurk.reascendMinDist) return; // 아직 붙어 있다
  enemy.ascendTicks = lurk.ascendDurTicks;
  enemy.groundTicks = 0;
  world.events.emit('leech_ascend', { enemyId: enemy.id, x: enemy.x, z: enemy.z });
}

/** 대기 배회 — 생성 지점 반경 안 아무 데나 골라 걷고, 도착하면 잠깐 멈춘다 */
function wanderIdle(
  world: World,
  enemy: EnemyState,
  def: ReturnType<typeof enemyDef>,
  dt: number,
): void {
  const w = def.idleWander!;
  if ((enemy.wanderPause ?? 0) > 0) {
    enemy.wanderPause = (enemy.wanderPause ?? 0) - 1;
    return;
  }
  // 벽에 막혀 영영 못 가는 목적지는 이따금 포기한다
  if (world.tick % 300 === enemy.id % 300) {
    enemy.wanderX = undefined;
    return;
  }
  const dxw = (enemy.wanderX ?? enemy.x) - enemy.x;
  const dzw = (enemy.wanderZ ?? enemy.z) - enemy.z;
  const dw = Math.hypot(dxw, dzw);
  if (enemy.wanderX === undefined || dw < 0.3) {
    const ang = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * w.radius;
    enemy.wanderX = (enemy.homeX ?? enemy.x) + Math.sin(ang) * r;
    enemy.wanderZ = (enemy.homeZ ?? enemy.z) + Math.cos(ang) * r;
    enemy.wanderPause = Math.floor(w.pauseTicks * (0.5 + Math.random()));
    return;
  }
  enemy.yaw = Math.atan2(-dxw, -dzw);
  moveAvoiding(world, enemy, def, dxw / dw, dzw / dw, def.speed * w.speedMul * slowFactor(enemy) * dt);
}

/** 흐느낌 — 걷는 동안 이따금. 위치를 소리로 흘리는 단서라 들리는 거리에서만 낸다 */
function tickGhoulMoan(world: World, enemy: EnemyState): void {
  const interval = enemyDef(enemy.type).moanIntervalTicks;
  if (!interval || enemy.feigning) return;
  if (Math.hypot(enemy.x - enemy.prevX, enemy.z - enemy.prevZ) < 1e-4) return; // 걷는 동안만
  enemy.moanTicks = (enemy.moanTicks ?? Math.floor(interval * Math.random())) - 1;
  if ((enemy.moanTicks ?? 0) > 0) return;
  enemy.moanTicks = interval;
  const p = world.player;
  if (Math.hypot(p.x - enemy.x, p.z - enemy.z) > 14) return;
  world.events.emit('ghoul_moan', { enemyId: enemy.id, x: enemy.x, z: enemy.z });
}

/** 약점 보스(거수) 상태 장부 — 매 틱, 넉백·경직보다 먼저(창은 플레이어 시간이라 적의 사정으로 멈추지 않는다).
 *  ① 노출 타이머 감소 → 0 이면 closeExposure(exposure_closed{id, hits}).
 *  ② 혼절 쿨다운 감소. ③ 혼절(dazed)이 끝났으면(시간·처형 어느 경로든 ai 가 staggered 를 벗어남) dazeCooldownTicks 를 건다.
 *  ④ 자세 비추기: staggered ↔ pose 'stunned' / 돌격(예고·질주·타격·헛돌격 경직) ↔ pose 'charge' — 포즈 타이머(head_down)가 없을 때만.
 *  ⑤ 눈 누적: head_down 중·쿨다운 아님·혼절 아님일 때만 weakAccum.eye 가 혼절로 산다(아니면 매 틱 0 — 쿨다운 중 맞힌 것은 안 쌓인다).
 *     dazeThreshold 에 닿으면 혼절: staggered(reaction.staggerTicks) + pose stunned + boss_staggered{cause 'eye'}, 눈 노출은 닫힌다.
 *     돌격 질주 중 6m 안(⑩)이면 같은 누적이 blindThreshold 로 눈멂(beginBlind)이 된다 — 혼절 누적엔 안 들어간다(B2-5).
 *  ⑨ 눈멂 안전망: 질주(charging)가 어떤 경로로든 끝났는데 blind 가 남아 있으면 지운다. ⑩ 돌격 중 눈 노출: 질주 중 플레이어 ≤ blindRangeM 이면
 *     눈 노출 타이머를 매 틱 되살리고(처음 여는 틱만 openExposure — 장부 0), 멀어지면 닫는다. 눈멂 뒤에는 열지 않는다.
 *  ⑥ 낫 잠김(bladeLock) 감소 → 0 이면 해제(boss_status rupture off). ⑦ 관절(낫 짝이 있는 약점) 내구 0 이 새로 생겼으면 파열(ruptureJoint).
 *  ⑧ 절뚝(limping) = 양 낫 잠김 — 바뀌는 틱에 boss_status limp on/off.
 *  약점 정의가 없는 적(족장·잡몹)은 아무것도 하지 않는다. 혼절로 넘어간 틱은 true — 그 틱의 나머지 행동은 건너뛴다
 *  (Reaction 의 패링 스태거와 같이 staggerTicks 가 온전히 남는다) */
function tickWeakPointStatus(world: World, enemy: EnemyState, def: ReturnType<typeof enemyDef>): boolean {
  if (!def.weakPoints) return false;
  const wpCfg = balance.weakPoint;
  // 처형 연출(world.executeFocusTicks) 동안은 tick 이 첫머리에서 돌아가 이 장부도 멈춘다 — 노출 타이머·혼절 쿨다운이 그만큼 늦게 흐른다.
  // '모든 적이 멈춘다' 규약과 같고 그 동안 플레이어 입력도 막혀 있어 이득은 없다(의도, B2-2 검토)
  // ① 노출 타이머
  if (enemy.exposure) {
    for (const id in enemy.exposure) {
      const left = (enemy.exposure[id] ?? 0) - 1;
      if (left > 0) enemy.exposure[id] = left;
      else closeExposure(world, enemy, id);
    }
  }
  // ⑫ 약점 봉인 쿨다운(역류 뒤 심장, B3-1) — 다하면 지운다. 봉인 중엔 weakPointOpen 이 닫는다(자세 자리에 있어도 판정 없음)
  if (enemy.weakCooldown) {
    for (const id in enemy.weakCooldown) {
      const left = (enemy.weakCooldown[id] ?? 0) - 1;
      if (left > 0) enemy.weakCooldown[id] = left;
      else delete enemy.weakCooldown[id];
    }
  }
  // ⑪ 심장 누적 → 역류(B3-1, 기획서 §4.1 heart) — 지난 틱까지 앞발 들기(rear)로 열려 있던 심장의 한 노출 안 누적이 heartThreshold 에 닿았다.
  //    ④ 가 자세를 갱신하기 전에 본다 — 앞발 들기 마지막 틱에 채운 66 도 역류가 된다. 봉인(쿨다운) 중엔 판정이 없었으니 누적도 없다
  if (enemy.pose === REAR_POSE && (enemy.weakCooldown?.[HEART_WEAK_POINT] ?? 0) <= 0 && (enemy.weakAccum?.[HEART_WEAK_POINT] ?? 0) >= wpCfg.heartThreshold) {
    beginBackflow(world, enemy, def);
    return true;
  }
  // ⑬ 질식(choke, B3-2) — 타이머가 다하면 분출공 hp 가 돌아온다(갑각 재생은 이 타이머를 건드리지 않는다)
  if ((enemy.chokeTicks ?? 0) > 0) {
    enemy.chokeTicks = (enemy.chokeTicks ?? 0) - 1;
    if ((enemy.chokeTicks ?? 0) <= 0) endChoke(world, enemy, def);
  }
  // ⑭ 분출공 내구 0 → 질식 — 반사 자가 피격 33 × 4(또는 직격 누적)로 hp 가 0 에 닿은 첫 틱에 한 번. 낫 짝이 없으니 ⑦ 파열이 아니다
  const ventWp = def.weakPoints.find((wp) => wp.id === VENT_WEAK_POINT);
  if (ventWp?.hp !== undefined && (enemy.weakHp?.[VENT_WEAK_POINT] ?? 1) <= 0 && (enemy.chokeTicks ?? 0) <= 0) {
    beginChoke(world, enemy, def);
  }
  // ⑯ 분출공 노출(B3-2, 기획서 §4.1 vent) — 갑각 떨기(volley) 예고·시전 중 분출공이 열린다(직격 ×openMul). 돌격 중 눈과 같은 노출 타이머 문
  //    (판정 weakPointOpen·그림 Stage·장부 exposure_closed 가 하나) — 질식(hp 0)이면 openExposure 가 거른다. 시전이 끊기면 다음 틱 여기서 닫힌다
  const venting = ventWp !== undefined && enemy.attackMode === 'volley' && (enemy.ai === 'windup' || enemy.ai === 'volley');
  if (venting) {
    if ((enemy.exposure?.[VENT_WEAK_POINT] ?? 0) > 0) enemy.exposure![VENT_WEAK_POINT] = VENT_OPEN_REFRESH;
    else openExposure(world, enemy, VENT_WEAK_POINT, VENT_OPEN_REFRESH);
  } else if (ventWp !== undefined && (enemy.exposure?.[VENT_WEAK_POINT] ?? 0) > 0) {
    closeExposure(world, enemy, VENT_WEAK_POINT);
  }
  // ⑮ 분출공 직격 누적 → 역류(B3-2) — 갑각 떨기 예고(windup) 중 열린 분출공의 한 노출 안 누적이 ventGagThreshold 에 닿았다: 시전 취소 + 머리 내림(자해·봉인 없음).
  //    시전(volley) 중 직격은 피해·정화만(역류 없음 — 예고 안 66 이 취소의 창이다)
  if (venting && enemy.ai === 'windup' && (enemy.weakAccum?.[VENT_WEAK_POINT] ?? 0) >= wpCfg.ventGagThreshold) {
    beginVentBackflow(world, enemy, def);
    return true;
  }
  // ⑥ 낫 잠김 — 먼저 깎고(파열 틱에 새로 잠긴 낫은 다음 틱부터 줄어 bladeLockTicks 뒤에 풀린다) 0 이면 해제. 관절 hp 는 그대로 0(갑각 재생 B2-6 만 되돌린다)
  if (enemy.bladeLock) {
    for (const blade of ['r', 'l'] as const) {
      const left = enemy.bladeLock[blade];
      if (left === undefined) continue;
      if (left > 1) {
        enemy.bladeLock[blade] = left - 1;
      } else {
        delete enemy.bladeLock[blade];
        world.events.emit('boss_status', { enemyId: enemy.id, enemyType: enemy.type, kind: 'rupture', id: jointOfBlade(def, blade), blade, on: false });
      }
    }
  }
  // ⑦ 관절 파열 — 내구가 0 에 닿은(Weapons/Projectiles 의 hitWeakPoint 가 깎는다) 관절을 처음 보는 틱에 한 번.
  //    낫 짝(bladeOfJoint)이 있는 약점만 — 분출공(vent) 내구 0 은 파열이 아니라 질식(choke, B3-2)이 따로 가른다
  if (enemy.weakHp) {
    for (const wp of def.weakPoints) {
      if (wp.hp === undefined || bladeOfJoint(def, wp.id) === undefined) continue;
      if ((enemy.weakHp[wp.id] ?? 1) > 0 || enemy.ruptured?.[wp.id]) continue;
      ruptureJoint(world, enemy, def, wp.id);
    }
  }
  // ⑧ 절뚝 — 양 낫 잠김이면 켜지고 하나라도 풀리면 꺼진다(bladeLock 을 밖에서 세워도 같은 문을 지난다)
  const limp = bothBladesLocked(enemy);
  if (limp !== (enemy.limping ?? false)) {
    enemy.limping = limp;
    world.events.emit('boss_status', { enemyId: enemy.id, enemyType: enemy.type, kind: 'limp', on: limp });
  }
  // ② 혼절 쿨다운
  if ((enemy.dazeCooldown ?? 0) > 0) enemy.dazeCooldown = (enemy.dazeCooldown ?? 0) - 1;
  // ③ 혼절 종료 → 쿨다운. 일어서는 자리라 기상 발구르기(P2+, wakeSlam)를 예약한다 — 시간 만료든 처형이든 같은 문(기획서 §9.2 2번)
  if (enemy.dazed && enemy.ai !== 'staggered') {
    enemy.dazed = false;
    enemy.dazeCooldown = wpCfg.dazeCooldownTicks;
    if (def.wakeSlam) enemy.wakeSlamPending = true;
    world.events.emit('boss_status', { enemyId: enemy.id, enemyType: enemy.type, kind: 'daze', on: false });
  }
  // ④ 자세 비추기 (포즈 타이머가 있으면 그 자세가 우선)
  if ((enemy.poseTicks ?? 0) <= 0) {
    if (enemy.ai === 'staggered') {
      enemy.pose = 'stunned';
    } else if (enemy.pose === 'stunned') {
      enemy.pose = undefined;
    }
    if (enemy.pose !== 'stunned') {
      const charging =
        enemy.attackMode === 'charge' &&
        (enemy.ai === 'windup' || enemy.ai === 'charging' || enemy.ai === 'impact' || (enemy.ai === 'recover' && enemy.whiffed === true));
      // 눈먼 질주는 pose blind(머리 휘저음, 표의 눈 1.2m) — 질주가 끝나면 charge(헛돌격 경직의 웅크림)로 돌아온다
      if (charging) enemy.pose = enemy.blind && enemy.ai === 'charging' ? 'blind' : 'charge';
      else if (enemy.pose === 'charge' || enemy.pose === 'blind') enemy.pose = undefined;
      // 발구르기 앞발 들기(B3-1) — 예고 시작 후 경과 틱이 rearPose 구간(from ≤ t < to)이면 rear(배 심장이 표 자리로 나와 열린다), 벗어나면 닫힌다.
      // 경과는 이 틱의 예고 감소(아래 windup case)까지 친 값 — "예고 8틱째" 에 이 틱의 사격이 열린 심장을 맞는다. 예고가 끊겨도(경직·전환·넉백) 다음 틱 여기서 닫힌다
      const slamWindup = enemy.attackMode === 'slam' && enemy.ai === 'windup';
      const slamAttack = slamWindup ? currentAttack(def, enemy) : undefined;
      const rp = slamAttack?.rearPose;
      const elapsed = slamAttack ? slamAttack.windupTicks - enemy.timer + 1 : 0;
      const rearing = rp !== undefined && elapsed >= rp.from && elapsed < rp.to;
      if (rearing && enemy.pose !== REAR_POSE) enterRear(world, enemy);
      else if (!rearing && enemy.pose === REAR_POSE) exitRear(world, enemy);
      // 포효 예고(B3-4) — attackMode 'roar' 의 예고 동안 pose roar(머리 치켜들고 입 벌림 — 눈이 위로 드러나 열린다). 예고가 끊기면(경직·넉백) 다음 틱 여기서 닫힌다.
      // 발동·취소는 resolveRoar·beginRoarBackflow 가 그 자리에서 닫는다. 페이즈 전환의 roar 는 포즈 타이머라 여기 오지 않는다
      const roaring = enemy.attackMode === 'roar' && enemy.ai === 'windup';
      if (roaring && enemy.pose !== ROAR_POSE) enterRoar(world, enemy);
      else if (!roaring && enemy.pose === ROAR_POSE) exitRoar(world, enemy);
    }
  }
  // ⑨ 눈멂 안전망 — impact·지형 충돌은 그 자리에서 endBlind 를 부르지만, 다른 경로(넉백·빙결 뒤 상태 바뀜)로 질주가 끊겨도 남지 않게.
  //    impact 틱은 건너뛴다 — impact 가 스스로 닫으며 '눈먼 질주였는가'(광란 돌격 2차 판단, B3-4)를 먼저 읽어야 한다
  if (enemy.blind && enemy.ai !== 'charging' && enemy.ai !== 'impact') endBlind(world, enemy);
  // ⑩ 돌격 중 눈 노출(B2-5, 기획서 §4.1 B) — 질주 중 플레이어 ≤ blindRangeM 이면 눈(pose charge 표 1.1m)이 열린다. 패링·완벽 회피가
  //    관절을 여는 것과 같은 노출 타이머라 판정(weakPointOpen)·그림(Stage)·장부(hits)가 한 문을 지난다. 눈멂 뒤에는 열지 않는다 —
  //    눈먼 거수의 눈은 표적이 아니다(보상은 전도의 머리 내림). 질주 종료는 impact·chargeCollide 가 endChargeEye 로 닫는다
  const chargeEye = enemy.ai === 'charging' && enemy.attackMode === 'charge' && !enemy.blind && chargeEyeInRange(world, enemy, def);
  if (chargeEye) {
    if ((enemy.exposure?.[DAZE_WEAK_POINT] ?? 0) > 0) enemy.exposure![DAZE_WEAK_POINT] = CHARGE_EYE_REFRESH;
    else openExposure(world, enemy, DAZE_WEAK_POINT, CHARGE_EYE_REFRESH);
  } else {
    endChargeEye(world, enemy);
  }
  // ⑤ 눈 누적 → 혼절(머리 내림) / 눈멂(돌격 중 6m 안). 포즈 타이머를 깎기 전에 본다 — 머리 내림 마지막 틱에 채운 66 도 혼절이 된다.
  //    역류(cause 'backflow')로 내려온 머리는 눈 ×3.0 피해만 — 혼절 누적 없음(기획서 §4.1 heart·§5 backflow)
  const eyeCounts =
    headDownPose(enemy.pose) && (enemy.poseTicks ?? 0) > 0 && (enemy.dazeCooldown ?? 0) <= 0 && enemy.ai !== 'staggered' && enemy.poseCause !== 'backflow';
  // 포효 예고 중 위로 드러난 눈(B3-4, 기획서 §4.1 eye C) — 누적 roarCancelThreshold 면 포효 취소(역류). 혼절 쿨다운과 무관(혼절 누적이 아니다)
  const roarEye = enemy.pose === ROAR_POSE && enemy.attackMode === 'roar' && enemy.ai === 'windup' && !enemy.molting;
  const accum = enemy.weakAccum?.[DAZE_WEAK_POINT] ?? 0;
  if (eyeCounts) {
    if (accum >= wpCfg.dazeThreshold) {
      // 혼절 — 머리 내림(또는 탈진, B3-4)은 여기서 끝나고(눈 판정 닫힘) 처형 창이 열린다. 자세 이름으로 off 를 낸다(exhaust 는 분출공도 함께 닫힌다)
      const endedPose = enemy.pose ?? 'head_down';
      world.events.emit('boss_status', { enemyId: enemy.id, enemyType: enemy.type, kind: endedPose, on: false });
      if (endedPose !== 'head_down') for (const wp of def.weakPoints) if (wp.id !== DAZE_WEAK_POINT && wp.exposedStates?.includes(endedPose)) closeExposure(world, enemy, wp.id);
      closeExposure(world, enemy, DAZE_WEAK_POINT);
      enemy.poseTicks = 0;
      enemy.pose = 'stunned';
      enemy.ai = 'staggered';
      enemy.timer = balance.reaction.staggerTicks;
      enemy.dazed = true;
      enemy.whiffed = false;
      enemy.recoiled = false;
      world.events.emit('boss_status', { enemyId: enemy.id, enemyType: enemy.type, kind: 'daze', on: true, ticks: enemy.timer });
      world.events.emit('boss_staggered', { enemyId: enemy.id, enemyType: enemy.type, cause: 'eye' });
      return true;
    }
  } else if (chargeEye) {
    // 눈멂 — 이 노출 안 누적이 임계에 닿았다(권총 2발). 혼절 쿨다운과 무관(혼절 누적이 아니다)
    if (accum >= wpCfg.blindThreshold) beginBlind(world, enemy);
  } else if (roarEye) {
    if (accum >= wpCfg.roarCancelThreshold) {
      beginRoarBackflow(world, enemy, def);
      return true;
    }
  } else if (accum > 0 && enemy.weakAccum) {
    enemy.weakAccum[DAZE_WEAK_POINT] = 0;
  }
  return false;
}

/** 포효 예고 시작(B3-4) — pose roar 로 눈이 위로 드러나 열린다(exposedStates). 이번 노출의 눈 장부(누적·명중)를 0 부터. boss_status{kind 'roar', on, despair} — 소리·문구는 main */
function enterRoar(world: World, enemy: EnemyState): void {
  enemy.pose = ROAR_POSE;
  enemy.weakAccum ??= {};
  enemy.weakAccum[DAZE_WEAK_POINT] = 0;
  enemy.exposureHits ??= {};
  enemy.exposureHits[DAZE_WEAK_POINT] = 0;
  world.events.emit('boss_status', { enemyId: enemy.id, enemyType: enemy.type, kind: ROAR_POSE, on: true, despair: enemy.despairRoar === true, x: enemy.x, z: enemy.z });
}

/** 포효 예고 끝(발동·취소·끊김) — 눈 노출을 닫는다(exposure_closed{eye, hits}) + boss_status roar off */
function exitRoar(world: World, enemy: EnemyState): void {
  if (enemy.pose === ROAR_POSE) enemy.pose = undefined;
  closeExposure(world, enemy, DAZE_WEAK_POINT);
  world.events.emit('boss_status', { enemyId: enemy.id, enemyType: enemy.type, kind: ROAR_POSE, on: false });
}

/** 포효 취소 — 역류(B3-4, 기획서 §4.1 eye C·§5 backflow): 예고 중 눈 누적 roarCancelThreshold. 위압은 걸리지 않고 머리 내림 headDown.backflowTicks(cause 'backflow' — 눈 ×3.0 피해만,
 *  혼절 누적 없음). 자해·봉인은 없다(심장 원인만). 취소된 포효도 간격은 새로 센다 — 머리 내림 뒤 곧바로 다시 포효하지 않게. boss_status{kind 'backflow', cause 'eye'} */
function beginRoarBackflow(world: World, enemy: EnemyState, def: ReturnType<typeof enemyDef>): void {
  const wpCfg = balance.weakPoint;
  exitRoar(world, enemy);
  enemy.attackMode = 'melee';
  enemy.despairRoar = false;
  enemy.strikeProgress = 0;
  if (def.roarAttack?.intervalTicks !== undefined) enemy.roarCooldown = def.roarAttack.intervalTicks;
  world.events.emit('boss_status', {
    enemyId: enemy.id, enemyType: enemy.type, kind: 'backflow', on: true, cause: 'eye', ticks: wpCfg.headDown.backflowTicks, selfDamage: 0, x: enemy.x, z: enemy.z,
  });
  beginPose(world, enemy, 'head_down', wpCfg.headDown.backflowTicks, 'backflow');
  if (!def.flying) enemy.jumpY = 0;
}

/** 포효 선택(B3-4, 기획서 §9.2 1번) — 슬롯 'roar' 가 열려 있고, P3 복귀 직후 첫 선택(firstPick — 쿨다운 무관)이거나 간격(intervalTicks)이 다했을 때. 거리·시야 조건 없음.
 *  전환 없이 P3 에 들어온 경우(첫 추격 틱에 roarCooldown 이 없다)는 간격부터 센다. 체력 ≤ despairHealthFrac × health 면 절망의 포효(despair 정의 — 예고 36) */
function tryRoar(world: World, enemy: EnemyState, def: ReturnType<typeof enemyDef>): boolean {
  const roar = def.roarAttack;
  if (!roar || !slotUnlocked(def, enemy, 'roar')) return false;
  if (enemy.roarCooldown === undefined) enemy.roarCooldown = roar.intervalTicks ?? 0;
  const pick = enemy.firstPick === 'roar';
  if (enemy.firstPick !== undefined && !pick) enemy.firstPick = undefined; // 포효 말고는 첫 선택 슬롯이 없다 — 남겨 두지 않는다
  if (!pick && (enemy.roarCooldown ?? 0) > 0) return false;
  enemy.firstPick = undefined;
  enemy.roarCooldown = roar.intervalTicks ?? 0;
  enemy.despairRoar = roar.despair !== undefined && roar.despairHealthFrac !== undefined && enemy.health <= def.health * roar.despairHealthFrac;
  enemy.attackMode = 'roar';
  const p = world.player;
  enemy.yaw = Math.atan2(-(p.x - enemy.x), -(p.z - enemy.z));
  startWindup(world, enemy, currentAttack(def, enemy));
  enterRoar(world, enemy); // 예고 첫 틱부터 눈이 열린다 — ④ 는 이 틱 첫머리에 이미 돌았다
  world.events.emit('enemy_roar_start', { enemyId: enemy.id, enemyType: enemy.type, despair: enemy.despairRoar, ticks: enemy.timer, x: enemy.x, z: enemy.z });
  return true;
}

/** 포효 발동(B3-4, 기획서 §7 P3 roar) — 예고가 끝났다. impact 파이프를 타지 않는 별도 분기: 피해·방어 판정·player_damaged 없이 aoeRadius 안 플레이어를 pushM 밀고(절망은 pull 만큼
 *  끌어당긴다 — 몸 접촉 거리 안으로는 아니다) statusOnHit(위압 cowed)을 세운다. 회피 무적(iframeTicks > 0)이면 안 걸린다(빨강 = 회피 문법). enemy_roar(소리·카메라 킥)·boss_roar_hit.
 *  절망의 포효는 곧바로 followUp 슬롯('slam')을 예고 followUpWindupTicks·앞발 들기 followUpRearPose 로 즉시 연계(쿨다운·거리 무관, P3 덮어쓰기 그대로) */
function resolveRoar(world: World, enemy: EnemyState, def: ReturnType<typeof enemyDef>, attack: EnemyAttackDef): void {
  const p = world.player;
  const despair = enemy.despairRoar === true && attack.despair !== undefined;
  exitRoar(world, enemy);
  const dx = p.x - enemy.x;
  const dz = p.z - enemy.z;
  const dist = Math.hypot(dx, dz);
  const radius = attack.aoeRadius ?? 0;
  world.events.emit('enemy_roar', { enemyId: enemy.id, enemyType: enemy.type, despair, radius, dist, x: enemy.x, z: enemy.z });
  if (dist <= radius && !world.dead && p.iframeTicks <= 0) {
    const ticks = attack.playerKnockbackTicks ?? balance.playerKnockback.ticks;
    let pull = 0;
    let push = 0;
    if (despair && attack.despair!.pull > 0) {
      pull = Math.min(attack.despair!.pull, Math.max(0, dist - contactDist(def)));
      if (pull > 0) pushPlayer(p, -dx, -dz, pull, ticks);
    } else if ((attack.pushM ?? 0) > 0) {
      push = attack.pushM!;
      pushPlayer(p, dx, dz, push, ticks);
    }
    const status = attack.statusOnHit;
    if (status) setPlayerStatus(p, status, statusDurationOf(balance.status[PLAYER_STATUS_CFG[status]]));
    world.events.emit('boss_roar_hit', { enemyId: enemy.id, enemyType: enemy.type, status, pull, push, dist, despair });
  }
  enemy.despairRoar = false;
  const followUp = despair ? attack.despair!.followUp : undefined;
  if (followUp === 'slam' && def.slamAttack && slotUnlocked(def, enemy, 'slam')) {
    enemy.wakeSlamPending = false; // 연계 발구르기가 일어서기의 발구르기를 대신한다
    enemy.attackMode = 'slam';
    enemy.slamCooldown = Math.max(enemy.slamCooldown ?? 0, attackInPhase(def, enemy, 'slam', def.slamAttack).cooldownTicks ?? 0);
    startWindup(world, enemy, currentAttack(def, { ...enemy, despairSlam: true, wakeSlam: false }));
    enemy.despairSlam = true;
    enemy.wakeSlam = false;
    world.events.emit('enemy_slam_start', { enemyId: enemy.id, enemyType: enemy.type, wake: false, despair: true, dist });
    return;
  }
  enemy.attackMode = 'melee';
  enemy.ai = 'recover';
  enemy.timer = attack.recoverTicks;
  enemy.whiffed = false;
  enemy.recoiled = false;
}

/** 삼연낫 선택(B3-4, 기획서 §9.2 4번) — 슬롯 'combo' 가 열려 있고 쿨다운이 끝났으며 양 낫이 다 자유일 때(한 낫이라도 잠겼으면 단발로). ① 의 예고에 들어가고 완벽 카운트를 0 으로 */
function tryCombo(world: World, enemy: EnemyState, def: ReturnType<typeof enemyDef>): boolean {
  const combo = def.comboAttack;
  if (!combo || !slotUnlocked(def, enemy, 'combo') || (enemy.comboCooldown ?? 0) > 0) return false;
  if (bladeLocked(enemy, 'r') || bladeLocked(enemy, 'l')) return false;
  enemy.attackMode = 'combo';
  enemy.comboStep = 0;
  enemy.comboPerfects = 0;
  enemy.comboCooldown = attackInPhase(def, enemy, 'combo', combo).cooldownTicks ?? 0;
  startWindup(world, enemy, currentAttack(def, enemy));
  world.events.emit('enemy_combo_start', { enemyId: enemy.id, enemyType: enemy.type, steps: comboChain(def).length, x: enemy.x, z: enemy.z });
  return true;
}

/** 광란 돌격 선회 시작(B3-4, 기획서 §7 P3 double_charge) — 첫 질주가 끝난 자리에서 turnTicks 동안 제자리 선회(= 2차 예고: 꼬리·뿔 tailTelegraph, tail_whirl 은 main).
 *  windup 상태(attackMode 'charge')로 두어 끝나는 틱에 windup 의 chargeRunTicks 분기가 플레이어의 새 자리로 두 번째 질주를 낸다(예고 없이) */
function beginChainTurn(world: World, enemy: EnemyState, def: ReturnType<typeof enemyDef>, chain: NonNullable<EnemyAttackDef['chainCharge']>): void {
  enemy.chainLeg = 1;
  enemy.chainTurn = true;
  enemy.chainTailHit = false;
  enemy.ai = 'windup';
  enemy.timer = Math.max(1, Math.round(chain.turnTicks));
  enemy.whiffed = false;
  enemy.recoiled = false;
  enemy.strikeProgress = 0;
  if (!def.flying) enemy.jumpY = 0;
  world.events.emit('enemy_chain_turn', { enemyId: enemy.id, enemyType: enemy.type, ticks: enemy.timer, x: enemy.x, z: enemy.z });
}

/** 선회 한 틱 — 남은 틱에 나눠 플레이어의 새 자리로 몸을 돌리고, tailRadius 안이면 이번 선회에 한 번 꼬리 채기(패링 불가, 막으면 칩 + 방어 경직, 밀림은 contact 급).
 *  회피 무적이면 스친다. 죽으면 다른 사망 경로와 같은 player_died */
function tickChainTurn(world: World, enemy: EnemyState, chain: NonNullable<EnemyAttackDef['chainCharge']>, distX: number, distZ: number, dist: number): void {
  const p = world.player;
  if (dist > 0.001) {
    let diff = Math.atan2(-distX, -distZ) - enemy.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    enemy.yaw += diff / Math.max(1, enemy.timer);
  }
  if (enemy.chainTailHit || world.dead || p.iframeTicks > 0 || dist > chain.tailRadius) return;
  const blocked = playerBlocks(world, enemy.x, enemy.z, balance.block.arcDeg);
  const dmg = damagePlayer(world, blocked ? chain.tailDamage * balance.block.chipDamageRatio : chain.tailDamage);
  const kb = balance.playerKnockback as unknown as Record<string, number>;
  pushPlayer(p, distX, distZ, kb['contact']! * (blocked ? kb['blockedMul']! : 1), balance.playerKnockback.ticks);
  if (blocked) {
    p.stunTicks = Math.max(p.stunTicks, Math.round(balance.block.clashPlayerStunTicks * world.modifiers.stunMul));
    world.events.emit('block_hit', { amount: dmg, kind: 'melee' });
  }
  enemy.chainTailHit = true;
  world.events.emit('player_damaged', { amount: dmg, health: p.health, blocked, srcX: enemy.x, srcZ: enemy.z, srcId: enemy.id, source: 'tail_whirl' });
  if (p.health <= 0) {
    p.health = 0;
    world.dead = true;
    world.events.emit('player_died', { tick: world.tick });
  }
}

/** 돌격 중 눈 노출 조건(B2-5) — 눈 약점이 있고 플레이어와 거리 ≤ balance.weakPoint.blindRangeM */
function chargeEyeInRange(world: World, enemy: EnemyState, def: ReturnType<typeof enemyDef>): boolean {
  if (!def.weakPoints?.some((wp) => wp.id === DAZE_WEAK_POINT)) return false;
  const p = world.player;
  return Math.hypot(p.x - enemy.x, p.z - enemy.z) <= balance.weakPoint.blindRangeM;
}

/** 돌격 중 열린 눈 노출 타이머를 닫는다(질주 종료·범위 이탈·눈멂) — exposure_closed{eye, hits}. 눈 타이머는 돌격만 세우므로 다른 노출을 건드리지 않는다 */
function endChargeEye(world: World, enemy: EnemyState): void {
  if ((enemy.exposure?.[DAZE_WEAK_POINT] ?? 0) > 0) closeExposure(world, enemy, DAZE_WEAK_POINT);
}

/** 눈멂(기획서 §5 blind) — 질주 중 눈 누적 blindThreshold. 목표 좌표를 잊고(charging 이 yaw 방향 직진) 남은 질주에 blindOverrunTicks 를 더한다.
 *  눈은 닫힌다(표적이 아니다), 접촉 피해는 그대로. boss_status{kind 'blind', on: true, ticks} — 비명·머리 휘저음은 main/Stage */
function beginBlind(world: World, enemy: EnemyState): void {
  enemy.blind = true;
  enemy.chargeStuck = 0;
  endChargeEye(world, enemy);
  enemy.timer += balance.weakPoint.blindOverrunTicks;
  enemy.pose = 'blind';
  world.events.emit('boss_status', { enemyId: enemy.id, enemyType: enemy.type, kind: 'blind', on: true, ticks: enemy.timer, x: enemy.x, z: enemy.z });
}

/** 눈멂 해제 — 질주가 끝났다(impact·지형 충돌·안전망). 자세는 charge 로(다음 틱 ④ 가 상태에 맞춘다) */
function endBlind(world: World, enemy: EnemyState): void {
  if (!enemy.blind) return;
  enemy.blind = false;
  if (enemy.pose === 'blind') enemy.pose = 'charge';
  world.events.emit('boss_status', { enemyId: enemy.id, enemyType: enemy.type, kind: 'blind', on: false });
}

/** 돌격 지형 충돌(B2-5, 기획서 §9.3) — 막힌 몸의 진행 축 선두 면 바로 너머를 몸 폭(AABB 반폭 def.radius) 전체로 읽어(Level.blockedAhead — slideMove 와
 *  같은 기하) 부딛힌 셀 문자를 고른다: 몸 중심이 든 칸이 막혔으면 그 칸, 아니면 모서리를 스친 칸(기둥 P 를 0.2m 만 겹쳐도 전도 — 레이 몇 줄은 이 틈을 놓쳐
 *  몸은 막혔는데 벽은 못 찾고 질주 시간이 다할 때까지 굳어 있었다, 2026-09-06 검토).
 *  기둥 P·균열벽 C → 전도: head_down toppleTicks(눈 0.9m 노출·혼절 누적 가능, cause 'topple') + toppleReboundM 튕김 + pillar_hit{row, col}(내구 −1 은 B3 Arena) /
 *  균열벽은 World.breakCrackWalls 로 그 칸만 개방(crack_wall_broken). 그 외(일반 벽 #·문·문설주) → wallWhiffRecoverTicks 헛돌격 — 박히지 않고
 *  눈도 안 열린다(enemy_whiffed{wall: true}). 벽이 아닌 것(아군·소품·잔해)에 막혀 섰다면 면 너머에 막힌 칸이 없다(그 몸통 두께만큼 벽이 멀다) → false,
 *  질주는 계속 — 뒤 기둥에 '박힌' 것으로 오판하지 않는다 */
function chargeCollide(
  world: World,
  enemy: EnemyState,
  def: ReturnType<typeof enemyDef>,
  attack: EnemyAttackDef,
  dirX: number,
  dirZ: number,
): boolean {
  const level = world.level;
  const cs = level.cellSize;
  const hit = level.blockedAhead(enemy, def.radius, dirX, dirZ, CHARGE_PROBE_EPS);
  enemy.chargeStuck = 0;
  if (!hit) return false;
  const { col, row, ch } = hit;
  endBlind(world, enemy);
  endChargeEye(world, enemy);
  enemy.chainLeg = 0; // 광란 돌격(B3-4) — 지형에 박힌 질주 뒤엔 두 번째가 없다
  enemy.chainTurn = false;
  if (!def.flying) enemy.jumpY = 0;
  if (ch === 'P' || ch === 'C') {
    const cx = (col + 0.5) * cs;
    const cz = (row + 0.5) * cs;
    if (ch === 'P') world.events.emit('pillar_hit', { enemyId: enemy.id, enemyType: enemy.type, row, col, x: cx, z: cz });
    else breakCrackWalls(world, cx, cz, 0);
    const hd = balance.weakPoint.headDown;
    world.events.emit('boss_status', {
      enemyId: enemy.id, enemyType: enemy.type, kind: 'topple', on: true, ticks: hd.toppleTicks, cell: ch, row, col, x: enemy.x, z: enemy.z,
    });
    beginPose(world, enemy, 'head_down', hd.toppleTicks, 'topple');
    // 박힌 몸이 튕겨 물러난다(넉백 — 포즈 시계는 그 동안 멈춘다) — 내려온 머리(눈)가 벽 안에 묻히지 않고 기둥 앞에 서서 쏠 수 있게
    pushEnemy(enemy, -dirX, -dirZ, hd.toppleReboundM, hd.toppleReboundTicks);
  } else {
    enemy.ai = 'recover';
    enemy.whiffed = true;
    enemy.recoiled = false;
    enemy.timer = attack.wallWhiffRecoverTicks ?? attack.whiffRecoverTicks ?? attack.recoverTicks;
    world.events.emit('enemy_whiffed', { enemyId: enemy.id, enemyType: enemy.type, ticks: enemy.timer, wall: true });
  }
  return true;
}

/** 관절 파열(기획서 §4.1·§5 rupture) — 관절 내구 0: 노출 장부를 닫고(판정은 hp 0 으로 이미 닫혔다), 그 관절의 낫(bladeOfJoint — 패링 표의 역)을
 *  bladeLockTicks 동안 잠근다. 비틀거림 staggerTicks 는 recover 로 — 진행 중인 낫·돌격 예고는 끊긴다. 머리 내림·미끄러짐(포즈 타이머)·혼절 중이면
 *  이미 굳어 있으니 덧붙이지 않는다(눈 창을 빼앗지 않는다). boss_status{kind 'rupture', id, blade, on: true} — 소리·파편·문구는 main/Stage */
function ruptureJoint(world: World, enemy: EnemyState, def: ReturnType<typeof enemyDef>, jointId: string): void {
  const cfg = balance.weakPoint.rupture;
  enemy.ruptured ??= {};
  enemy.ruptured[jointId] = true;
  closeExposure(world, enemy, jointId);
  const blade: BladeSide | undefined = bladeOfJoint(def, jointId);
  if (blade) {
    enemy.bladeLock ??= {};
    enemy.bladeLock[blade] = cfg.bladeLockTicks;
  }
  if ((enemy.poseTicks ?? 0) <= 0 && enemy.ai !== 'staggered') {
    const remaining = enemy.ai === 'recover' ? enemy.timer : 0;
    enemy.ai = 'recover';
    enemy.timer = Math.max(remaining, cfg.staggerTicks);
    enemy.recoiled = true; // 튕긴 자세로 굳는다 — 비틀거림의 그림
    enemy.whiffed = false;
    enemy.strikeProgress = 0;
  }
  if (enemy.attackMode === 'combo') enemy.attackMode = 'melee'; // 삼연낫(B3-4) 도중 관절이 터지면 콤보는 거기서 끊긴다(비틀거림 뒤 이어지지 않는다)
  world.events.emit('boss_status', {
    enemyId: enemy.id, enemyType: enemy.type, kind: 'rupture', id: jointId, blade, on: true, ticks: cfg.bladeLockTicks, x: enemy.x, z: enemy.z,
  });
}

/** 앞발 들기 시작(B3-1) — 발구르기 예고의 rearPose 구간에 들어섰다. pose rear 로 심장이 열리니(exposedStates) 이번 노출의 장부(누적·명중)를 0 부터.
 *  봉인(쿨다운) 중이면 자세만 서고 판정은 weakPointOpen 이 닫는다(장부는 그대로 0). 발광·맥동은 Stage 가 weakPointOpen 으로 그린다 */
function enterRear(world: World, enemy: EnemyState): void {
  enemy.pose = REAR_POSE;
  const sealed = (enemy.weakCooldown?.[HEART_WEAK_POINT] ?? 0) > 0;
  enemy.weakAccum ??= {};
  enemy.weakAccum[HEART_WEAK_POINT] = 0;
  enemy.exposureHits ??= {};
  enemy.exposureHits[HEART_WEAK_POINT] = 0;
  world.events.emit('boss_status', { enemyId: enemy.id, enemyType: enemy.type, kind: REAR_POSE, on: true, sealed, x: enemy.x, z: enemy.z });
}

/** 앞발 들기 끝(구간 밖·예고 끊김) — 심장 노출을 닫는다(exposure_closed{heart, hits} — 봉인 중이었으면 판정이 없었으니 장부만 비운다) */
function exitRear(world: World, enemy: EnemyState): void {
  enemy.pose = undefined;
  if ((enemy.weakCooldown?.[HEART_WEAK_POINT] ?? 0) <= 0) closeExposure(world, enemy, HEART_WEAK_POINT);
  else if (enemy.weakAccum) enemy.weakAccum[HEART_WEAK_POINT] = 0;
  world.events.emit('boss_status', { enemyId: enemy.id, enemyType: enemy.type, kind: REAR_POSE, on: false });
}

/** 역류(B3-1, 기획서 §4.1 heart·§5 backflow) — 앞발 들기 창에 심장 누적이 heartThreshold 에 닿았다. 발구르기 취소(AoE 안 떨어짐 — attackMode 를 비우고
 *  포즈 타이머가 예고를 덮는다) + 자해 backflow.selfDamage(damage_pop) + 머리 내림 headDown.backflowTicks(cause 'backflow' — 눈 ×3.0 피해만, 혼절 누적 없음)
 *  + 심장 heartCooldownTicks 봉인(weakCooldown — 어둡게·판정 없음). boss_status{kind 'backflow', on: true} — 몸 들썩·vent_gag 는 Stage/main.
 *  자해로 죽으면 다른 사망 경로와 같은 enemy_died 하나만 낸다 */
function beginBackflow(world: World, enemy: EnemyState, def: ReturnType<typeof enemyDef>): void {
  const wpCfg = balance.weakPoint;
  closeExposure(world, enemy, HEART_WEAK_POINT);
  enemy.weakCooldown ??= {};
  enemy.weakCooldown[HEART_WEAK_POINT] = wpCfg.heartCooldownTicks;
  world.events.emit('boss_status', { enemyId: enemy.id, enemyType: enemy.type, kind: REAR_POSE, on: false });
  // 발구르기 취소
  enemy.attackMode = 'melee';
  enemy.wakeSlam = false;
  enemy.despairSlam = false;
  enemy.strikeProgress = 0;
  // 자해
  const selfDamage = wpCfg.backflow.selfDamage;
  enemy.health -= selfDamage;
  world.events.emit('damage_pop', { enemyId: enemy.id, amount: selfDamage });
  world.events.emit('boss_status', {
    enemyId: enemy.id, enemyType: enemy.type, kind: 'backflow', on: true, cause: 'heart', ticks: wpCfg.headDown.backflowTicks, selfDamage, x: enemy.x, z: enemy.z,
  });
  if (enemy.health <= 0) {
    enemy.health = 0;
    enemy.alive = false;
    enemy.pose = undefined;
    world.events.emit('enemy_died', { enemyId: enemy.id, enemyType: enemy.type, x: enemy.x, z: enemy.z, noLoot: enemy.noLoot });
    return;
  }
  beginPose(world, enemy, 'head_down', wpCfg.headDown.backflowTicks, 'backflow');
  if (!def.flying) enemy.jumpY = 0;
}

/** 갑각 떨기 취소(B3-2) — 역류·질식이 진행 중인 갑각 떨기(예고·시전)를 접는다: 남은 발수는 버리고 쿨다운은 문다(붙어 와서 접는 abortRange 와 같은 결 — 안 물면 머리 내림 뒤 곧바로
 *  다시 떨어 역류 농사가 된다). 분출공 노출도 닫는다(exposure_closed{vent, hits}) */
function cancelVolley(world: World, enemy: EnemyState, def: ReturnType<typeof enemyDef>): void {
  if ((enemy.exposure?.[VENT_WEAK_POINT] ?? 0) > 0) closeExposure(world, enemy, VENT_WEAK_POINT);
  if (enemy.attackMode !== 'volley') return;
  const volley = def.volleyAttack;
  enemy.attackMode = 'melee';
  enemy.volleyLeft = 0;
  enemy.strikeProgress = 0;
  if (volley && (enemy.ai === 'windup' || enemy.ai === 'volley')) enemy.volleyCooldown = Math.max(enemy.volleyCooldown ?? 0, attackInPhase(def, enemy, 'volley', volley).cooldownTicks ?? 0);
}

/** 분출공 역류(B3-2, 기획서 §4.1 vent·§5 backflow) — 갑각 떨기 예고 중 분출공 직격 누적 ventGagThreshold: 시전 취소(구슬 안 나감) + 머리 내림 headDown.backflowTicks
 *  (cause 'backflow' — 눈 ×3.0 피해만, 혼절 누적 없음). 심장 원인과 달리 자해·봉인 쿨다운은 없다. boss_status{kind 'backflow', cause 'vent', selfDamage 0} */
function beginVentBackflow(world: World, enemy: EnemyState, def: ReturnType<typeof enemyDef>): void {
  const wpCfg = balance.weakPoint;
  cancelVolley(world, enemy, def);
  world.events.emit('boss_status', {
    enemyId: enemy.id, enemyType: enemy.type, kind: 'backflow', on: true, cause: 'vent', ticks: wpCfg.headDown.backflowTicks, selfDamage: 0, x: enemy.x, z: enemy.z,
  });
  beginPose(world, enemy, 'head_down', wpCfg.headDown.backflowTicks, 'backflow');
  if (!def.flying) enemy.jumpY = 0;
}

/** 질식(B3-2, 기획서 §5 choke) — 분출공 내구 0: 갑각 떨기가 choke.sealTicks 동안 봉인되고(진행 중이었으면 접는다) 모든 예고가 windupPenalty 만큼 늘어진다(startWindup),
 *  아레나 웅덩이는 Hazards 가 boss_status choke on 을 받아 전부 증발시킨다. 분출공 판정은 hp 0 으로 이미 닫혔다(weakPointOpen). 갑각 재생이 풀지 않는다 */
function beginChoke(world: World, enemy: EnemyState, def: ReturnType<typeof enemyDef>): void {
  const ticks = balance.weakPoint.choke.sealTicks;
  const casting = enemy.attackMode === 'volley' && (enemy.ai === 'windup' || enemy.ai === 'volley');
  cancelVolley(world, enemy, def);
  if (casting) {
    // 떨던 몸이 컥 막힌다 — 시전 자리에서 후딜만 남긴다(포즈는 없다 — 머리 내림 창을 공짜로 주지 않는다)
    enemy.ai = 'recover';
    enemy.timer = def.volleyAttack?.recoverTicks ?? def.attack.recoverTicks;
    enemy.whiffed = false;
    enemy.recoiled = false;
  }
  enemy.chokeTicks = ticks;
  world.events.emit('boss_status', { enemyId: enemy.id, enemyType: enemy.type, kind: 'choke', on: true, ticks, x: enemy.x, z: enemy.z });
}

/** 질식 종료 — 분출공 hp 가 정의값으로 돌아오고 갑각 떨기가 다시 열린다(boss_status choke off) */
function endChoke(world: World, enemy: EnemyState, def: ReturnType<typeof enemyDef>): void {
  enemy.chokeTicks = 0;
  const ventWp = def.weakPoints?.find((wp) => wp.id === VENT_WEAK_POINT);
  if (ventWp?.hp !== undefined && enemy.weakHp) enemy.weakHp[VENT_WEAK_POINT] = ventWp.hp;
  world.events.emit('boss_status', { enemyId: enemy.id, enemyType: enemy.type, kind: 'choke', on: false });
}

/** 발구르기 선택(B3-1, 기획서 §9.2) — wake 면 기상 발구르기(거리·쿨다운 무관, 슬롯 'wakeSlam' 해금), 아니면 minRange < dist ≤ maxRange 에서 쿨다운이 끝났을 때
 *  (슬롯 'slam' 해금, 페이즈 덮어쓰기 attackInPhase). 골랐으면 예고에 들어가고 true. 슬롯이 없는 적은 늘 false(옛 경로) */
function trySlam(world: World, enemy: EnemyState, def: ReturnType<typeof enemyDef>, dist: number, wake: boolean): boolean {
  const slam = def.slamAttack;
  if (!slam || !slotUnlocked(def, enemy, 'slam')) return false;
  if (wake) {
    if (!def.wakeSlam || !slotUnlocked(def, enemy, 'wakeSlam')) return false;
  } else {
    const a = attackInPhase(def, enemy, 'slam', slam);
    if ((enemy.slamCooldown ?? 0) > 0 || dist <= (a.minRange ?? 0) || dist > (a.maxRange ?? Infinity)) return false;
    enemy.slamCooldown = a.cooldownTicks ?? 0;
  }
  enemy.attackMode = 'slam';
  startWindup(world, enemy, currentAttack(def, { ...enemy, wakeSlam: wake }));
  enemy.wakeSlam = wake;
  world.events.emit('enemy_slam_start', { enemyId: enemy.id, enemyType: enemy.type, wake, dist });
  return true;
}

/** 페이즈 전환을 미뤄야 하는 창(기획서 §8 큐잉) — 혼절(처형 창)·포즈 타이머(머리 내림·미끄러짐·전환 자체)·눈멂 질주·넉백(처형 넉백) 중.
 *  플레이어의 처형·노출 창을 빼앗지 않는다. 그 밖(추격·예고·타격·경직)이면 즉시 전환하고 진행 중 공격은 취소된다 */
function phaseShiftBlocked(enemy: EnemyState): boolean {
  return enemy.ai === 'staggered' || (enemy.poseTicks ?? 0) > 0 || enemy.blind === true || (enemy.kbTicks ?? 0) > 0;
}

/** 페이즈 훅(B2-6, 기획서 §8) — 매 틱 healthBarState.index 를 enemy.phase(게임플레이 페이즈)와 비교한다. 낮아졌으면(칸이 비었으면) 목표 index 를
 *  phaseTarget 에 두고, 막는 창이 아니면 그 틱에 beginPhaseShift. 창 안에서 두 경계를 넘으면 목표만 더 낮아져 한 번의 전환으로 P3 까지 간다.
 *  페이즈 표가 없는 적(족장·어미 슬라임 — 체력 칸은 표시만)은 아무것도 하지 않는다. 잠든 보스는 깨어난 뒤부터(phaseSince 도 그때 찍는다) */
function tickPhase(world: World, enemy: EnemyState, def: ReturnType<typeof enemyDef>): void {
  if (!def.phases || enemy.ai === 'idle') return;
  if (enemy.phase === undefined) enemy.phase = healthBarState(def, def.health).index; // Spawner 를 안 거친 상태(옛 세이브)의 안전망
  if (enemy.phaseSince === undefined) enemy.phaseSince = world.tick;
  const idx = healthBarState(def, enemy.health).index;
  if (idx < enemy.phase && idx < (enemy.phaseTarget ?? Infinity)) enemy.phaseTarget = idx;
  if (enemy.phaseTarget === undefined || enemy.phaseTarget >= enemy.phase) {
    enemy.phaseTarget = undefined;
    return;
  }
  if (phaseShiftBlocked(enemy)) return;
  beginPhaseShift(world, enemy, def, enemy.phaseTarget);
}

/** 페이즈 전환 = 갑각 재생(molt, 기획서 §5·§8) — recover phaseShiftTicks 동안 pose roar(머리 치켜듦·입 벌림)로 굳는다. 진행 중 공격 취소, 노출 전부 닫힘
 *  (molting 동안 판정도 닫힘 — Entities.weakPointOpen), 관절 hp 회복 + ruptured 삭제(다시 0 이 되면 다시 파열) + 낫 잠김 해제(절뚝은 ⑧ 이 다음 틱 끈다),
 *  남은 공격 쿨다운 × phaseShiftCooldownMul. 무적은 아니다(몸통 0.8× 는 들어간다). 질식·전도·눈멂은 건드리지 않는다(전도·눈멂은 막는 창이라 여기 올 일이 없다).
 *  boss_phase{phase, from, skipped, fromTicks} + boss_status{kind 'molt', on} + (P3) plate_shed — 소리·문구·HUD 는 main, 균열 발광·판 탈락·홍채는 Stage */
function beginPhaseShift(world: World, enemy: EnemyState, def: ReturnType<typeof enemyDef>, target: number): void {
  const wpCfg = balance.weakPoint;
  const from = enemy.phase ?? target;
  const before = resolvePhase(def, from);
  const after = resolvePhase(def, target);
  enemy.phase = target;
  enemy.phaseTarget = undefined;
  const fromTicks = world.tick - (enemy.phaseSince ?? world.tick);
  enemy.phaseSince = world.tick;
  // 진행 중 공격 취소 — 예고·타격·질주·연사 어느 것이든 여기서 끊긴다. endBlind 는 안전망(도달 불가 — 눈멂은 phaseShiftBlocked 가 막아 여기 오지 않는다)
  endBlind(world, enemy);
  if (enemy.pose === REAR_POSE) exitRear(world, enemy); // 발구르기 앞발 들기 중이었으면 심장 노출을 닫는다(B3-1)
  if (enemy.pose === ROAR_POSE && !enemy.molting) exitRoar(world, enemy); // 포효 예고 중이었으면 눈 노출을 닫는다(B3-4)
  enemy.attackMode = 'melee';
  enemy.wakeSlam = false;
  enemy.wakeSlamPending = false; // 일어서며 예약한 기상 발구르기도 전환이 삼킨다(P3 복귀 첫 선택은 포효, B3-4)
  enemy.despairRoar = false;
  enemy.despairSlam = false;
  enemy.chainLeg = 0;
  enemy.chainTurn = false;
  enemy.firstPick = after?.firstPick; // 복귀 후 첫 선택(P3 'roar', B3-4) — 첫 추격 틱이 쿨다운·거리 무관하게 소모한다
  enemy.volleyLeft = 0;
  enemy.chargeHealthRef = undefined;
  enemy.chargeStuck = 0;
  enemy.wantsCharge = false;
  enemy.wantsBash = false;
  enemy.braceTicks = 0;
  if (!def.flying) enemy.jumpY = 0;
  // 약점 전부 닫힘 — 타이머 노출은 장부까지 닫고(exposure_closed), 자세 노출은 molting 이 판정을 막는다
  if (enemy.exposure) for (const id of Object.keys(enemy.exposure)) closeExposure(world, enemy, id);
  if (enemy.weakAccum) for (const id in enemy.weakAccum) enemy.weakAccum[id] = 0;
  // 갑각 재생 — 낫 짝이 있는 관절만 hp 회복 + 파열 표식 삭제(분출공은 질식이 따로 관리, B3-2). 잠긴 낫은 풀린다(rupture off)
  for (const wp of def.weakPoints ?? []) {
    if (wp.hp === undefined || bladeOfJoint(def, wp.id) === undefined) continue;
    if (enemy.weakHp) enemy.weakHp[wp.id] = wp.hp;
    if (enemy.ruptured) delete enemy.ruptured[wp.id];
  }
  if (enemy.bladeLock) {
    for (const blade of ['r', 'l'] as const) {
      if (enemy.bladeLock[blade] === undefined) continue;
      delete enemy.bladeLock[blade];
      world.events.emit('boss_status', { enemyId: enemy.id, enemyType: enemy.type, kind: 'rupture', id: jointOfBlade(def, blade), blade, on: false });
    }
  }
  // 쿨다운 절반 — 공격 쿨다운만(혼절 쿨다운은 플레이어 쪽 박자)
  const mul = wpCfg.phaseShiftCooldownMul;
  if (enemy.chargeCooldown) enemy.chargeCooldown = Math.round(enemy.chargeCooldown * mul);
  if (enemy.closeCooldown) enemy.closeCooldown = Math.round(enemy.closeCooldown * mul);
  if (enemy.volleyCooldown) enemy.volleyCooldown = Math.round(enemy.volleyCooldown * mul);
  if (enemy.summonCooldown) enemy.summonCooldown = Math.round(enemy.summonCooldown * mul);
  if (enemy.slamCooldown) enemy.slamCooldown = Math.round(enemy.slamCooldown * mul);
  if (enemy.comboCooldown) enemy.comboCooldown = Math.round(enemy.comboCooldown * mul); // 포효 간격은 공격 쿨다운이 아니다(복귀 첫 선택이 포효) — 건드리지 않는다
  // 포효 자세로 굳는다 — 포즈 타이머(head_down·skid 와 같은 문)
  enemy.molting = true;
  enemy.pose = 'roar';
  enemy.poseTicks = Math.max(1, Math.round(wpCfg.phaseShiftTicks));
  enemy.ai = 'recover';
  enemy.timer = enemy.poseTicks;
  enemy.recoiled = false;
  enemy.whiffed = false;
  enemy.strikeProgress = 0;
  world.events.emit('boss_phase', {
    enemyId: enemy.id, enemyType: enemy.type, phase: target, from, skipped: from - target > 1, fromTicks, tick: world.tick,
    name: after?.name, shiftText: after?.shiftText, x: enemy.x, z: enemy.z,
  });
  world.events.emit('boss_status', { enemyId: enemy.id, enemyType: enemy.type, kind: 'molt', on: true, ticks: enemy.poseTicks, phase: target, from });
  // 등갑판 탈락(P3) — 남은 판(platesLeft, B3-3 hp 풀에서 안 부서진 것)이 골드 없이 튕겨 나간다(plate_shed — 파편은 Stage, 소리는 main). 다 부서졌으면 조용히
  if (after?.shedPlates && !before?.shedPlates) shedShellPlates(world, enemy);
}

/** 페이즈 보스가 죽었다 — 마지막 페이즈의 소요 시간을 boss_phase{phase 0, from, fromTicks} 로 한 번 알린다(계측: 페이즈별 시간). 두 번 내지 않는다 */
function endPhaseOnDeath(world: World, enemy: EnemyState): void {
  if (enemy.phase === undefined || enemy.phaseSince === undefined) return;
  const fromTicks = world.tick - enemy.phaseSince;
  enemy.phaseSince = undefined;
  world.events.emit('boss_phase', {
    enemyId: enemy.id, enemyType: enemy.type, phase: 0, from: enemy.phase, skipped: false, fromTicks, tick: world.tick, death: true, x: enemy.x, z: enemy.z,
  });
}

/** 포즈 타이머가 다했다(head_down·skid·roar 종료) — 자세로 열려 있던 약점(눈)을 닫고 추격으로 돌아간다. 페이즈 전환(molting)이었으면 molt off.
 *  머리 내림(모든 원인 — 낫 박힘·역류·전도·탈진)이 끝나 일어서는 자리면 기상 발구르기(P2+, wakeSlam)를 예약한다 — 미끄러짐(skid) 뒤는 아니다(기획서 §9.2 2번).
 *  역류 원인이었으면 boss_status backflow off 도 함께 */
function endPose(world: World, enemy: EnemyState, def: ReturnType<typeof enemyDef>): void {
  const pose = enemy.pose;
  const cause = enemy.poseCause;
  const molt = enemy.molting === true;
  enemy.poseTicks = 0;
  enemy.pose = undefined;
  enemy.poseCause = undefined;
  enemy.molting = false;
  if (pose !== undefined) {
    if (!molt) {
      for (const wp of def.weakPoints ?? []) {
        if (wp.exposedStates?.includes(pose)) closeExposure(world, enemy, wp.id);
      }
    }
    world.events.emit('boss_status', { enemyId: enemy.id, enemyType: enemy.type, kind: molt ? 'molt' : pose, on: false });
    if (cause === 'backflow') world.events.emit('boss_status', { enemyId: enemy.id, enemyType: enemy.type, kind: 'backflow', on: false });
    if (headDownPose(pose) && def.wakeSlam) enemy.wakeSlamPending = true; // 머리 내림(전 원인)·탈진(exhaust, B3-4)이 끝나 일어서는 자리
  }
  enemy.ai = 'chase';
  enemy.timer = 0;
  enemy.whiffed = false;
  enemy.recoiled = false;
}

function tickEnemy(world: World, enemy: EnemyState, dt: number): void {
  const def = enemyDef(enemy.type);
  const p = world.player;

  enemy.prevX = enemy.x;
  enemy.prevZ = enemy.z;
  enemy.prevJumpY = enemy.jumpY ?? 0;

  // 약점 보스 장부 — 노출·혼절·자세 비추기. 넉백·경직보다 먼저(노출 창은 플레이어의 시간이다). 혼절로 넘어간 틱은 여기서 끝
  if (tickWeakPointStatus(world, enemy, def)) return;
  // 페이즈(거수, B2-6) — 칸이 비었으면 전환(또는 큐잉). 전환 틱은 아래 포즈 타이머(roar)가 이어받는다
  tickPhase(world, enemy, def);

  // ── 거머리 수직 구간 — 낙하·재상승은 일반 AI 를 덮는다 ──
  const lurk = def.ceilingLurk;
  if (lurk && (enemy.dropTicks ?? 0) > 0) {
    enemy.dropTicks = (enemy.dropTicks ?? 0) - 1;
    const remain = Math.max(1, enemy.dropTicks ?? 0);
    // 목표 좌표로 미끄러지며(벽은 밀어낸다) 가속 낙하
    world.level.slideMove(
      enemy,
      def.radius,
      ((enemy.dropTargetX ?? enemy.x) - enemy.x) / remain,
      ((enemy.dropTargetZ ?? enemy.z) - enemy.z) / remain,
    );
    const t = 1 - (enemy.dropTicks ?? 0) / lurk.dropDurTicks;
    enemy.jumpY = Math.max(0, (enemy.dropFromY ?? 0) * (1 - t * t));
    if ((enemy.dropTicks ?? 0) > 0) return;
    enemy.jumpY = 0;
    enemy.groundTicks = lurk.groundTicks;
    if (enemy.dropStunned) {
      // 매달린 채 맞아 떨어졌다 — 길게 뻗는다 (올려다본 플레이어의 보상)
      enemy.ai = 'recover';
      enemy.timer = lurk.fallStunTicks;
      enemy.whiffed = true;
      world.events.emit('leech_splat', { enemyId: enemy.id, x: enemy.x, z: enemy.z });
      return;
    }
    // 내려찍기 — 낙하점 광역. 회피 무적이면 통째로 헛디딘다
    const idx = p.x - enemy.x;
    const idz = p.z - enemy.z;
    const idist = Math.hypot(idx, idz);
    if (idist <= lurk.dropAoeRadius && p.iframeTicks <= 0) {
      const blocked = playerBlocks(world, enemy.x, enemy.z, balance.block.arcDeg);
      // 명중 + 방어 실패 + 얼굴이 비어 있으면 — 들러붙어 흡혈 시작 (내려찍기 피해 대신)
      if (!blocked && def.faceSuck && world.faceLeechId === null) {
        attachFace(world, enemy, def);
        return;
      }
      const dmg = damagePlayer(world, blocked ? lurk.dropDamage * balance.block.chipDamageRatio : lurk.dropDamage);
      pushPlayer(p, idx, idz, 1.6, balance.playerKnockback.ticks);
      world.events.emit('player_damaged', {
        amount: dmg, health: p.health, blocked, srcX: enemy.x, srcZ: enemy.z, srcId: enemy.id, source: 'leech_drop',
      });
      if (p.health <= 0) {
        p.health = 0;
        world.dead = true;
        world.events.emit('player_died', { tick: world.tick });
      }
      enemy.ai = 'recover';
      enemy.timer = def.attack.recoverTicks;
    } else {
      enemy.ai = 'recover';
      enemy.timer = lurk.dropWhiffTicks;
      enemy.whiffed = true; // 바닥을 헛찍고 뻗었다 — 반격 창
    }
    world.events.emit('leech_land', { enemyId: enemy.id, x: enemy.x, z: enemy.z, hit: idist <= lurk.dropAoeRadius });
    return;
  }
  if (lurk && (enemy.ascendTicks ?? 0) > 0) {
    enemy.ascendTicks = (enemy.ascendTicks ?? 0) - 1;
    const hang = world.level.ceiling - def.height - 0.05;
    enemy.jumpY = hang * (1 - (enemy.ascendTicks ?? 0) / lurk.ascendDurTicks);
    if ((enemy.ascendTicks ?? 0) === 0) {
      enemy.lurking = true; // 다시 매달렸다 — 이름표도 다시 숨는다
      enemy.ai = 'idle';
      enemy.noticeTicks = 0;
    }
    return;
  }
  // 매달린 채 들켰다(소음·피격) — 어차피 내려와야 한다. 다친 채면 추락해 뻗는다
  if (lurk && enemy.lurking && enemy.ai !== 'idle') {
    startDrop(world, enemy, lurk, enemy.health < def.health);
    return;
  }

  // ── 벽거미 수직 구간 (wallCrawl) — 붙기·기기·도약이 일반 AI 를 덮는다 ──
  if (def.wallCrawl && tickWallSpider(world, enemy, def, def.wallCrawl, dt)) return;

  // ── 비행체 (flying, 박쥐) — 순항·추락·기절이 일반 AI 를 덮는다 ──
  if (def.flying && tickFlying(world, enemy, def, def.flying, dt)) return;

  // 밀려난 뒤 돌격 — chase 진입을 기다리지 않는다 (공격 도중 밀려나면 그 상태로 남아
  // 영영 돌격하지 못했다). 밀리는 중에는 판단하지 않는다 — 아직 가까워서 취소돼 버린다
  // chargeOnKnockback false(거수)는 이 우회 경로를 타지 않는다 — 돌격은 chase 의 거리·쿨다운 규칙으로만
  if (enemy.wantsCharge && def.chargeAttack && def.chargeOnKnockback !== false && (enemy.kbTicks ?? 0) <= 0) {
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
  if ((enemy.summonCooldown ?? 0) > 0) enemy.summonCooldown = (enemy.summonCooldown ?? 0) - 1;
  if ((enemy.chargeCooldown ?? 0) > 0) enemy.chargeCooldown = (enemy.chargeCooldown ?? 0) - 1;
  if ((enemy.closeCooldown ?? 0) > 0) enemy.closeCooldown = (enemy.closeCooldown ?? 0) - 1;
  if ((enemy.slamCooldown ?? 0) > 0) enemy.slamCooldown = (enemy.slamCooldown ?? 0) - 1;
  if ((enemy.roarCooldown ?? 0) > 0) enemy.roarCooldown = (enemy.roarCooldown ?? 0) - 1;
  if ((enemy.comboCooldown ?? 0) > 0) enemy.comboCooldown = (enemy.comboCooldown ?? 0) - 1;

  // 새끼 분리 — 타이머 구동 (2026-09-01): 전투에 들어오면 즉시 5마리, 그 뒤로는
  // 10초 박자(cooldownTicks)마다 살아 있는 새끼를 빼고 부족분만 시전 없이 충원한다.
  // 무엇을 하던 중이든(근접·돌진·경직) 박자는 지킨다 — 예측 가능한 리듬이 정보다.
  // 화상(말라붙음)·빙결(통째로 얼음) 중엔 박자를 미루고, 풀리는 즉시 낳는다
  const beatBrood = def.summonAttack?.brood;
  if (
    beatBrood &&
    enemy.ai !== 'idle' &&
    (enemy.summonCooldown ?? 0) <= 0 &&
    !enemy.broodLeft &&
    enemy.burnTicks <= 0 &&
    (enemy.freezeTicks ?? 0) <= 0
  ) {
    spawnBrood(world, enemy, def.summonAttack!); // 부족분 0 이면 조용히 지나간다
    enemy.summonCooldown = beatBrood.cooldownTicks;
  }

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

  // 포즈 타이머(거수 head_down — 낫이 바닥에 박혀 머리가 내려온 동안 / skid — 완벽 회피에 미끄러진 동안) — 이동·회전·공격 전부 없다.
  // head_down 은 눈(0.9m)이 열려 있고 해머도 닿는다. 다하면 추격으로(기획서 §9.1: attackFreeze 다음, 돌격 캔슬·notice 앞)
  if ((enemy.poseTicks ?? 0) > 0) {
    enemy.poseTicks = (enemy.poseTicks ?? 0) - 1;
    if ((enemy.poseTicks ?? 0) <= 0) endPose(world, enemy, def);
    return;
  }

  const distX = p.x - enemy.x;
  const distZ = p.z - enemy.z;
  const dist = Math.hypot(distX, distZ);
  const attack = currentAttack(def, enemy);

  // 돌진 캔슬(cancelOnHit) — 물어뜯으려 달려드는 몸에 한 발이라도 박히면 끊긴다.
  // 뒤로 고꾸라져 잠깐 무방비 — 달려오는 구울을 침착하게 쏘는 보상
  const chargingNow =
    enemy.attackMode === 'charge' && (enemy.ai === 'windup' || enemy.ai === 'charging');
  if (chargingNow && def.chargeAttack?.cancelOnHit && enemy.chargeHealthRef !== undefined) {
    if (enemy.health < enemy.chargeHealthRef) {
      enemy.chargeHealthRef = undefined;
      enemy.ai = 'recover';
      enemy.timer = def.chargeAttack.cancelStaggerTicks ?? 40;
      enemy.attackFreezeTicks = 0;
      enemy.whiffed = true; // 끊긴 직후는 무방비 — 반격 창
      if (dist > 0.001) pushEnemy(enemy, -distX / dist, -distZ / dist, 1.3, 14); // 뒤로 고꾸라진다
      world.events.emit('charge_broken', {
        enemyId: enemy.id, enemyType: enemy.type, x: enemy.x, z: enemy.z,
      });
    } else {
      enemy.chargeHealthRef = enemy.health;
    }
  } else if (!chargingNow) {
    enemy.chargeHealthRef = undefined;
  }

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
      if (def.idleWander && !enemy.feigning && !enemy.wallCling) {
        // 배회(구울) — 생성 지점을 중심으로 어슬렁거린다. 걷는 쪽을 보므로
        // 아래 시야 판정도 걷는 방향 기준이다 (시선 훑기 대신)
        wanderIdle(world, enemy, def, dt);
      } else {
        const scan = balance.enemyAi.vision;
        enemy.yaw =
          (enemy.homeYaw ?? 0) +
          Math.sin(((world.tick + enemy.id * 37) / scan.scanTicks) * Math.PI * 2) *
            ((scan.scanArcDeg * Math.PI) / 360);
      }

      // 랜턴 빔에 잡히면 시야각과 무관하게 즉시 알아챈다 — 어둠 속에서 빛을
      // 든 쪽이 먼저 들킨다. 단 등진 적은 빛이 등을 비춰도 못 알아챈다 (은신).
      // 벽 너머는 안 보이므로 시야선은 그대로 요구한다
      const facingX = -Math.sin(enemy.yaw);
      const facingZ = -Math.cos(enemy.yaw);
      // 천장 잠복(거머리) — 밑을 지나는 먹이만 노린다. 단서는 점액 방울·찌륵거림
      if (enemy.lurking && def.ceilingLurk) {
        const lk = def.ceilingLurk;
        if (dist < 14 && world.tick % lk.dripIntervalTicks === enemy.id % lk.dripIntervalTicks) {
          world.events.emit('leech_drip', { x: enemy.x, z: enemy.z });
        }
        if (dist <= lk.chitterRadius && world.tick % 90 === (enemy.id * 7) % 90) {
          world.events.emit('leech_chitter', { x: enemy.x, z: enemy.z });
        }
        if (dist <= lk.dropRadius) startDrop(world, enemy, lk, false);
        break;
      }
      // 죽은 척(구울) — 엎어져서 아무것도 보지 않는다. 코앞 기척만 몸으로 느낀다.
      // 소음(alertNearbyAt)·피격(alertEnemy)은 밖에서 깨운다
      if (enemy.feigning) {
        // 그림자 질주 중엔 기척도 없다 — 죽은 척 위를 스쳐 지나가도 안 깬다
        if (dist <= (def.feignWakeRadius ?? 0) && (p.blinkLeft ?? 0) <= 0 && (p.blinkShroudTicks ?? 0) <= 0) {
          alertEnemy(enemy, balance.enemyAi.noticeDelayTicks);
          world.events.emit('ghoul_rise', { enemyId: enemy.id, enemyType: enemy.type, x: enemy.x, z: enemy.z });
          world.events.emit('enemy_alerted', { enemyId: enemy.id, enemyType: enemy.type });
          // 시체 더미 — 하나가 일어나면 곁(4m)의 죽은 척들도 함께 벌떡 일어난다 (떼 매복)
          for (const buddy of world.enemies) {
            if (!buddy.alive || !buddy.feigning || buddy.id === enemy.id) continue;
            if (Math.hypot(buddy.x - enemy.x, buddy.z - enemy.z) > 4) continue;
            alertEnemy(buddy, balance.enemyAi.noticeDelayTicks);
            world.events.emit('ghoul_rise', { enemyId: buddy.id, enemyType: buddy.type, x: buddy.x, z: buddy.z });
            world.events.emit('enemy_alerted', { enemyId: buddy.id, enemyType: buddy.type });
          }
        }
        break;
      }
      const behind = dist > 0.001 && (facingX * distX + facingZ * distZ) / dist <= 0;
      // 장님(슬라임)은 시야·인기척·랜턴 어느 것으로도 못 알아챈다 — 소리(alertNearbyAt)와
      // 피격, 그리고 진동 감각(tremorSense)만이 깨운다
      const blind = def.blind ?? false;
      const lit = !behind && !blind && litByLantern(world, dist, distX, distZ);
      // 진동 감각 — 반경 안에서 '움직이는' 플레이어는 걷기(무음)라도 발밑 울림으로 느낀다.
      // 가만히 서 있으면 여전히 모른다 — 몰래 지나가기는 반경 밖으로 돌면 유지된다
      const tremor =
        blind &&
        def.tremorSense !== undefined &&
        dist <= def.tremorSense &&
        Math.hypot(p.x - p.prevX, p.z - p.prevZ) > 1e-4;
      if (
        (p.blinkLeft ?? 0) <= 0 && (p.blinkShroudTicks ?? 0) <= 0 && // 그림자 질주·여운 — 눈·빛·발밑 어느 것에도 안 걸린다
        (lit || tremor || (dist <= def.aggroRange && !blind && seesPlayer(enemy, dist, distX, distZ))) &&
        world.level.hasLineOfSight(enemy.x, enemy.z, p.x, p.z)
      ) {
        alertEnemy(enemy, balance.enemyAi.noticeDelayTicks);
        world.events.emit('enemy_alerted', { enemyId: enemy.id, enemyType: enemy.type, lantern: lit });
        // 보스가 깨면 포효로 방 전체가 함께 깬다 — 벽 너머라도 소리는 들린다. 반경은 def.alertRadius 로 재정의 가능(거수 18)
        if (def.boss) wakeAround(world, enemy, def.alertRadius ?? balance.enemyAi.bossAlertRadius);
      }
      break;
    }

    case 'chase': {
      enemy.yaw = Math.atan2(-distX, -distZ);

      // 포효(거수 P3, B3-4) — P3 복귀 직후 첫 선택(firstPick) + intervalTicks 마다, 다른 공격보다 우선·거리 조건 없음(기획서 §9.2 1번)
      if (tryRoar(world, enemy, def)) break;

      // 기상 발구르기(거수 P2+, B3-1) — 머리 내림·혼절이 끝나 일어서는 첫 추격 틱에 거리·쿨다운 무관하게 확정(기획서 §9.2 2번).
      // 예약은 여기서 소모된다 — P1(슬롯 미해금)이면 조용히 지워지고 평소 선택으로
      if (enemy.wakeSlamPending) {
        enemy.wakeSlamPending = false;
        if (trySlam(world, enemy, def, dist, true)) break;
      }

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
          const ad = approachDir(world, enemy, distX, distZ, dist);
          if (ad.pursuing) enemy.yaw = Math.atan2(-ad.x, -ad.z);
          moveAvoiding(world, enemy, def, ad.x, ad.z, moveSpeed(enemy, def) * dt);
        }
        break;
      }

      if (dist <= def.attackRange) {
        // 교대 공격 — 예고 자리가 꽉 찼으면 파고들지 않고 옆걸음으로 포위한다.
        // 동시 예고는 패링할 수 없고, 한 점에 뭉친 무리는 광역 한 방에 다 쓸린다
        if (!def.boss && engagedCount(world, enemy) >= balance.enemyAi.engage.maxSimultaneous) {
          circleAround(world, enemy, def, distX, distZ, dist, dt);
          break;
        }
        // 들이받기(closeAttack, 거수) — 코앞(maxRange)에 붙은 플레이어는 낫보다 먼저 머리로 밀어낸다.
        // 배 밑에 눌러앉는 플레이 방지. 쿨다운이 돌고 있으면 낫으로 (기획서 §9.2 3번). 슬롯이 없는 적은 옛 경로
        const close = def.closeAttack && attackInPhase(def, enemy, 'close', def.closeAttack);
        if (close && dist <= (close.maxRange ?? def.attackRange) && (enemy.closeCooldown ?? 0) <= 0) {
          enemy.attackMode = 'close';
          enemy.closeCooldown = close.cooldownTicks ?? 0;
          startWindup(world, enemy, close);
          break;
        }
        // 삼연낫(거수 P3, B3-4) — 낫 사거리 안에선 단발 낫보다 먼저(기획서 §9.2 4번), 쿨 600, 양 낫이 자유일 때
        if (tryCombo(world, enemy, def)) break;
        const bladeMode = pickMeleeMode(def, enemy);
        if (bladeMode === null) {
          // 양 낫 잠김(절뚝) — 낫이 없다. 들이받기(위)·발구르기(P2+, 2.5m 밖)·돌격(아래 거리 조건)만 남으니 붙은 플레이어에게서 물러나 거리를 유지한다(기획서 §9.2)
          if (trySlam(world, enemy, def, dist, false)) break;
          holdDisarmedRange(world, enemy, def, distX, distZ, dist, dt);
          break;
        }
        enemy.attackMode = bladeMode;
        startWindup(world, enemy, currentAttack(def, enemy));
        break;
      }
      // 발구르기(거수 P2+, B3-1, 기획서 §9.2 5번) — 낫 사거리 밖 2.5 < dist ≤ 6, 쿨 420. 돌격(4.5~15)보다 먼저 본다
      if (trySlam(world, enemy, def, dist, false)) break;
      // (새끼 분리는 AI 선택이 아니라 10초 박자 타이머가 돈다 — 위 beatBrood 블록)
      // 굶주림(구울) — 생명 입자가 플레이어보다 가까우면 먹으러 간다.
      // 처치가 구울 곁에서 나면 입자를 놓고 플레이어와 경쟁하게 된다
      const hunger = def.eatsMotes;
      if (hunger) {
        let mote = null as { x: number; z: number } | null;
        let moteDist = hunger.senseRadius;
        for (const m of world.lifeMotes) {
          if (m.homing) continue; // 플레이어에게 이미 빨려가는 것은 못 뺏는다
          const d = Math.hypot(m.x - enemy.x, m.z - enemy.z);
          if (d < moteDist) {
            moteDist = d;
            mote = m;
          }
        }
        if (mote && moteDist < dist) {
          if (moteDist <= 0.9) {
            world.lifeMotes.splice(world.lifeMotes.indexOf(mote as never), 1);
            enemy.health = Math.min(def.health, enemy.health + hunger.healPerMote);
            enemy.frenzyStacks = Math.min(hunger.frenzyMax, (enemy.frenzyStacks ?? 0) + 1);
            world.events.emit('ghoul_ate_mote', {
              enemyId: enemy.id, stacks: enemy.frenzyStacks, x: enemy.x, z: enemy.z,
            });
          } else {
            const mdx = mote.x - enemy.x;
            const mdz = mote.z - enemy.z;
            moveAvoiding(world, enemy, def, mdx / moteDist, mdz / moteDist, moveSpeed(enemy, def) * dt);
          }
          break;
        }
      }
      // 돌격 — 중거리(minRange~maxRange)에 들어오면 달려들며 내리찍는다.
      // maxRange 가 있는 돌격만 거리로 발동한다 (창병처럼 wantsCharge 로 쓰는 쪽과 구분)
      const ch = def.chargeAttack && attackInPhase(def, enemy, 'charge', def.chargeAttack); // 페이즈 쿨다운(P2 360 / P3 300)·피해
      if (
        ch?.maxRange !== undefined &&
        (enemy.chargeCooldown ?? 0) <= 0 &&
        // 이미 누가 물고(구울)·빨고(거머리) 있으면 달려들지 않는다 — 번갈아 붙으면 못 빠져나온다
        !(ch.latches && (def.faceSuck ? world.faceLeechId !== null : world.grappleEnemyId !== null)) &&
        dist >= (ch.minRange ?? 0) &&
        dist <= ch.maxRange &&
        world.level.hasLineOfSight(enemy.x, enemy.z, p.x, p.z)
      ) {
        enemy.attackMode = 'charge';
        enemy.chargeCooldown = ch.cooldownTicks ?? 0;
        enemy.chargeHealthRef = enemy.health; // 캔슬 기준 — 개시 순간의 체력
        enemy.chainLeg = 0; // 광란 돌격(B3-4) — 새 돌격의 첫 질주
        enemy.chainTurn = false;
        startWindup(world, enemy, ch);
        world.events.emit('enemy_charge', { enemyId: enemy.id, enemyType: enemy.type, dist });
        break;
      }

      // 화살 세례 — 큰 기술이라 쿨다운이 돌고, 붙어 있으면 쓰지 않는다
      if (
        def.volleyAttack &&
        slotUnlocked(def, enemy, 'volley') && // 페이즈 해금(거수 P2 갑각 떨기, B3-2) — 표가 없는 족장은 늘 열려 있다
        (enemy.chokeTicks ?? 0) <= 0 && // 질식 봉인(B3-2, 기획서 §9.2 7번) — 분출공이 막힌 동안은 갑각을 떨지 못한다
        (enemy.volleyCooldown ?? 0) <= 0 &&
        dist >= (def.volleyAttack.minRange ?? 0) &&
        world.level.hasLineOfSight(enemy.x, enemy.z, p.x, p.z)
      ) {
        enemy.attackMode = 'volley';
        startWindup(world, enemy, def.volleyAttack);
        // 분출공(거수, B3-2)은 예고 첫 틱부터 열린다 — 장부(⑯)는 이 틱 첫머리에 이미 돌았으니 여기서 한 번 열고, 다음 틱부터 ⑯ 이 되살린다
        if (def.weakPoints?.some((wp) => wp.id === VENT_WEAK_POINT)) openExposure(world, enemy, VENT_WEAK_POINT, VENT_OPEN_REFRESH);
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
      // 절뚝(양 낫 잠김) — 돌격이 안 나갔으면 유지 거리(retreatWhenDisarmed.max) 안에서는 더 다가가지 않는다
      if (holdDisarmedRange(world, enemy, def, distX, distZ, dist, dt)) break;
      if (dist > 0) {
        // 살금살금 — stalk 이 있으면 달려들기 사정거리 밖에서는 천천히 걸어온다 (구울)
        const stalkMul = def.stalk && dist > def.stalk.untilRange ? def.stalk.speedMul : 1;
        const un = balance.enemyAi.unstick;
        let ad: { x: number; z: number; pursuing: boolean };
        let stepMul = 1;
        if ((enemy.unstickTicks ?? 0) > 0) {
          // 끼임 탈출 — 시야와 무관하게 흐름장을 따라가되 지름길(lookahead) 없이
          // 바로 다음 칸 중심만 겨눈다. 모서리 끊기는 레이 기준이라 문설주에
          // 몸이 걸리는 대각선을 골라 제자리에 얼어붙는다 (실측: 슬라임 문 끼임)
          const pd = pursuitDir(world, enemy, 1);
          const leader = pd ? unstickLeader(world, enemy) : null;
          if (pd && leader) {
            // 외길 양보 — 앞선 동료가 빠져나갈 때까지 반걸음 물러난다 (모드 유지)
            ad = { x: -pd.x, z: -pd.z, pursuing: false };
            stepMul = 0.5;
          } else {
            enemy.unstickTicks = (enemy.unstickTicks ?? 0) - 1;
            ad = pd
              ? { x: pd.x, z: pd.z, pursuing: true }
              : { x: distX / dist, z: distZ / dist, pursuing: false };
          }
        } else {
          // 시야 트임 = 산개 접근, 벽에 막힘 = 흐름장 따라 문·통로로 우회
          ad = approachDir(world, enemy, distX, distZ, dist);
        }
        if (ad.pursuing) enemy.yaw = Math.atan2(-ad.x, -ad.z); // 가는 쪽을 본다
        const step = moveSpeed(enemy, def) * stalkMul * dt * stepMul;
        const bx = enemy.x;
        const bz = enemy.z;
        moveAvoiding(world, enemy, def, ad.x, ad.z, step, (enemy.unstickTicks ?? 0) > 0 ? un.sepMul : 1);
        // 끼임 감지 — 창(checkTicks) 시작점에서의 순변위가 기대 이동에 크게 못 미치면
        // 탈출 모드로. 순변위라서 문설주에 갈리는 것도, 제자리 진동도 잡힌다
        if ((enemy.stuckCount ?? 0) === 0) {
          enemy.stuckFromX = bx;
          enemy.stuckFromZ = bz;
        }
        enemy.stuckExpect = (enemy.stuckExpect ?? 0) + step;
        enemy.stuckCount = (enemy.stuckCount ?? 0) + 1;
        if ((enemy.stuckCount ?? 0) >= un.checkTicks) {
          const net = Math.hypot(
            enemy.x - (enemy.stuckFromX ?? enemy.x),
            enemy.z - (enemy.stuckFromZ ?? enemy.z),
          );
          if ((enemy.unstickTicks ?? 0) <= 0 && net < (enemy.stuckExpect ?? 0) * un.minProgress) {
            enemy.unstickTicks = un.ticks;
          }
          enemy.stuckExpect = 0;
          enemy.stuckCount = 0;
        }
      }
      break;
    }

    case 'windup': {
      // 광란 돌격 선회(B3-4) — 2차 예고: 플레이어의 새 자리로 몸을 돌리며 꼬리를 휘두른다. 끝나면 아래 chargeRunTicks 분기가 그 자리로 두 번째 질주를 낸다
      if (enemy.chainTurn && def.chargeAttack?.chainCharge) tickChainTurn(world, enemy, def.chargeAttack.chainCharge, distX, distZ, dist);
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

      // 포효(거수 P3, B3-4) — impact 파이프를 타지 않는 별도 분기(피해·방어 판정·player_damaged 없음)
      if (attack.type === 'roar') {
        resolveRoar(world, enemy, def, attack);
        break;
      }
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
        if (enemy.chargeStuck) enemy.chargeStuck = 0; // 지난 질주의 막힘 장부(거수)를 비운다 — 없던 적에겐 생기지 않는다
        if (enemy.chainTurn) enemy.chainTurn = false; // 광란 돌격(B3-4) — 선회가 끝나 새 자리로 두 번째 질주
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
      // 닿는 순간 판정(hitOnContact) — 창이 끝나길 기다리지 않는다. 이 틱은 아직 타격 창이라
      // 같은 틱의 반응(Reaction 은 Enemies 뒤)은 패링이 되고, 다음 틱에 impact 로 넘어간다
      if (attack.hitOnContact && strikeContacts(world, enemy, def, attack, dist)) {
        enemy.ai = 'active_normal';
        enemy.timer = 1;
        break;
      }
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
      if (attack.hitOnContact && enemy.timer > 1 && strikeContacts(world, enemy, def, attack, dist)) enemy.timer = 1; // 닿았다 — 다음 틱에 친다
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
      // 고정된 목표 지점으로만 달린다 (플레이어를 다시 보지 않는다). 눈멂(B2-5)이면 목표도 잊는다 — yaw 그대로 조향 없이 직진
      let dirX = 0;
      let dirZ = 0;
      let tdist = Infinity;
      if (enemy.blind) {
        dirX = -Math.sin(enemy.yaw);
        dirZ = -Math.cos(enemy.yaw);
      } else {
        const tx = enemy.chargeTargetX ?? p.x;
        const tz = enemy.chargeTargetZ ?? p.z;
        const tdx = tx - enemy.x;
        const tdz = tz - enemy.z;
        tdist = Math.hypot(tdx, tdz);
        if (tdist > 0.01) {
          enemy.yaw = Math.atan2(-tdx, -tdz);
          dirX = tdx / tdist;
          dirZ = tdz / tdist;
        }
      }
      const step = attack.chargeSpeed! * slowFactor(enemy) * limpChargeMul(enemy) * dt;
      const running = dirX !== 0 || dirZ !== 0;
      if (running) moveAvoiding(world, enemy, def, dirX, dirZ, step);
      // 지형 충돌(거수, 기획서 §9.3) — 이 틱 이동이 기대(step)의 unstick.minProgress 에도 못 미친 틱이 chargeStuckTicks 연속이면 부딛혔다.
      // 피탄 움찔(flinchTicks)로 선 틱은 세지 않는다 — 벽이 아니다. 부딛힌 셀 문자로 결과가 갈린다(chargeCollide — 벽이 없으면 계속 달린다)
      if (def.weakPoints && running && (enemy.flinchTicks ?? 0) <= 0) {
        const moved = Math.hypot(enemy.x - enemy.prevX, enemy.z - enemy.prevZ);
        enemy.chargeStuck = moved < step * balance.enemyAi.unstick.minProgress ? (enemy.chargeStuck ?? 0) + 1 : 0;
        if ((enemy.chargeStuck ?? 0) >= balance.weakPoint.chargeStuckTicks && chargeCollide(world, enemy, def, attack, dirX, dirZ)) break;
      }
      // 겨눈 자리에 닿았거나(몸 반경 — 눈멂이면 겨눈 자리가 없다: 시간이 다하거나 부딛칠 때까지), 플레이어가 그대로 서 있어 이미 사거리거나,
      // 시간이 다하면 친다. hitOnContact(구울 물어뜯기)는 사거리가 아니라 몸이 부딛친 순간이다 — 옆을 스쳐 지나가면 물지 않는다
      const nearEnough = attack.hitOnContact ? dist <= contactDist(def) : dist <= def.attackRange;
      if ((!enemy.blind && tdist <= def.radius) || nearEnough || enemy.timer <= 0) {
        // 착지 — 몸통 박치기는 땅에 닿는 순간 들어간다. 비행체(박쥐)는 공중에서 치므로 유지
        if (!def.flying) enemy.jumpY = 0;
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

    // 파먹기 — 플레이어에게 매달려 일정 간격으로 물어뜯는다. 시선만 자유롭고
    // 이동·공격·스킬·회피는 전부 잠긴다. 근접 키 연타(mashToEscape)로 밀쳐내야 풀린다
    case 'latched': {
      // 거머리 — 얼굴에 붙어 흡혈한다 (구울 파먹기와 다른 규칙)
      if (def.faceSuck) {
        tickFaceSuck(world, enemy, def);
        break;
      }
      const grip = balance.ghoulGrapple;
      if (world.dead || world.grappleEnemyId !== enemy.id || dist > 4) {
        releaseGrapple(world, enemy, false);
        break;
      }
      // 플레이어 몸에 붙어 있는다 — 붙잡은 방향을 유지한 채
      // 몸부림이 쌓일수록 팔 길이만큼 밀려난다 — 힘겨루기가 그림으로 보인다
      const hold = balance.player.radius + def.radius + 0.1 + world.grappleMash * grip.pryPerMash;
      enemy.x = p.x + (enemy.latchDirX ?? 0) * hold;
      enemy.z = p.z + (enemy.latchDirZ ?? 0) * hold;
      enemy.yaw = Math.atan2(-(p.x - enemy.x), -(p.z - enemy.z));
      // 물어뜯기
      enemy.timer--;
      if (enemy.timer <= 0) {
        enemy.timer = grip.biteIntervalTicks;
        const bite = damagePlayer(world, grip.biteDamage);
        world.events.emit('ghoul_bite', { enemyId: enemy.id });
        world.events.emit('player_damaged', {
          amount: bite, health: p.health, srcX: enemy.x, srcZ: enemy.z, srcId: enemy.id, source: 'ghoul_bite',
        });
        if (p.health <= 0) {
          p.health = 0;
          world.dead = true;
          world.events.emit('player_died', { tick: world.tick });
          releaseGrapple(world, enemy, false);
          break;
        }
      }
      // 몸부림 — 근접 키 연타로 밀쳐낸다. 한 키 체계가 근접을 상호작용으로
      // 바꿔치기한 채 들어와도 몸부림으로 친다 (이중 안전망)
      if (world.input.meleePressed || world.input.interactPressed) {
        world.grappleMash++;
        world.events.emit('grapple_struggle', { count: world.grappleMash, need: grip.mashToEscape });
        if (world.grappleMash >= grip.mashToEscape) {
          releaseGrapple(world, enemy, true);
          break;
        }
      }
      // 남은 시스템(무기·스킬·반응·아이템)이 이번 틱에 아무것도 못 하게 입력을 비운다.
      // 시선(lookDX/DY)만 남긴다 — 얼굴을 파먹는 걸 보는 것까지 막을 이유는 없다
      world.input = {
        ...world.input,
        moveX: 0, moveForward: 0, sprint: false, sprintPressed: false, dodgePressed: false,
        meleePressed: false, meleeHeld: false, rangedPressed: false, rangedHeld: false,
        reload: false, reactionPressed: false, reactionHeld: false, reactionReleased: false,
        castPressed: false, useSkill: 0, skillHeld: 0, selectedSkillHeld: false,
        cycleSkill: false, useSelectedSkill: false, interactPressed: false,
        cycleRanged: 0, useSlot: 0, batterySwap: false,
      };
      break;
    }

    case 'impact': {
      const wasBlind = enemy.blind === true; // 광란 돌격(B3-4) 2차 판단용 — 눈먼 첫 질주 뒤엔 두 번째가 없다. 아래 endBlind 가 지우기 전에 읽는다
      // 돌격 질주가 끝났다(닿았든 헛쳤든, B2-5) — 눈멂과 돌격 중 눈 노출은 여기서 닫힌다. 완벽 회피(아래 미끄러짐)보다 먼저 — skid 자세에서 눈은 닫혀 있다
      if (attack.chargeRunTicks !== undefined) {
        endBlind(world, enemy);
        endChargeEye(world, enemy);
      }
      // 돌격의 hitOnContact 는 몸 접촉이 곧 명중 — 달리기가 끝난 자리에서 사거리(2m 남짓)로 물던 것을 없앤다.
      // 휘두르기의 hitOnContact 는 무기 끝 모델 그대로(끝까지 뻗은 자리 = 사거리)
      const reaches =
        attack.hitOnContact && attack.chargeRunTicks !== undefined
          ? dist <= contactDist(def)
          : attackReaches(def, enemy, attack, p.x, p.z);
      const connected = reaches && p.iframeTicks <= 0;
      const dodgeExpose = attack.perfectDodgeExposes;
      if (reaches && p.iframeTicks > 0 && p.iframeSource === 'dodge' && dodgeExpose) {
        // 완벽 회피(거수 돌격, 기획서 §9.3) — 몸이 닿은 순간이 회피 무적(iframeSource 'dodge') 안이다. 피해 0, 거수는 헛돌격이 아니라 미끄러져 굳고(pose skid)
        // 양 어깨 관절이 짧게 열린다(마나 0 — 노출이 보상). 파열한(내구 0) 관절은 openExposure 가 거른다. 눈멂(B2-5)보다 우선.
        // 블링크·그래플 탈출 무적으로 스친 것은 회피 보상이 아니다(B2-3 검토) — 아래 connected 가 거짓이라 헛돌격(옛 경로)
        world.events.emit('charge_dodged', { enemyId: enemy.id, enemyType: enemy.type, x: enemy.x, z: enemy.z });
        for (const id of dodgeExpose.joints) openExposure(world, enemy, id, dodgeExpose.ticks);
        beginPose(world, enemy, 'skid', balance.weakPoint.skid.ticks);
        // 미끄러진 자리에 진액 웅덩이(P2+, B3-2 — 기획서 §7 P2 "미끄러진 자리에 웅덩이"). Hazards 가 spawn_pool 을 받아 만든다
        if (dodgeExpose.poolKind && poolsOn(def, enemy)) {
          world.events.emit('spawn_pool', { kind: dodgeExpose.poolKind, x: enemy.x, z: enemy.z, enemyId: enemy.id, enemyType: enemy.type });
        }
        break;
      }
      if (connected) {
        // 방어(정면) — 칩 데미지만 관통. 피해가 있으므로 연쇄는 여전히 리셋된다
        const blocked = playerBlocks(world, enemy.x, enemy.z, balance.block.arcDeg);
        // 들러붙기 — 맞으면 피해·밀침 대신 몸에 붙는다. 구울은 붙잡기(그래플),
        // 거머리는 얼굴로 기어올라 흡혈이다. 방어로 막았으면 평소처럼 흘려보낸다
        if (attack.latches && !blocked) {
          if (def.faceSuck) {
            if (world.faceLeechId === null) {
              attachFace(world, enemy, def);
              break;
            }
            // 얼굴이 이미 찼다 — 평범한 타격으로 흘러간다
          } else {
            startLatch(world, enemy);
            break;
          }
        }
        const base = attack.damage ?? def.damage; // 공격별 피해 재정의 (방패 밀쳐내기 등)
        // 방어 관통 비율도 공격별로 열어 둔다 — 돌격처럼 몸으로 받으면 안 되는 기술은 더 아프다
        const chip = attack.blockedDamageRatio ?? balance.block.chipDamageRatio;
        const damage = damagePlayer(world, blocked ? base * chip : base);
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
          p.stunTicks = Math.max(p.stunTicks, Math.round(clash.clashPlayerStunTicks * world.modifiers.stunMul)); // 쇠 투구·인내 반지
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
        // 플레이어 상태(B2-4, 기획서 §6) — 막았으면 statusOnBlock(낫 → 팔 저림), 직격이면 statusOnHit(돌격 → 진탕).
        // 값만 세운다 — 감소·상한·_applied/_ended 는 Status.ts. 지속은 balance.status 블록(ticks / 오염 진액은 lingerTicks — World.statusDurationOf)
        const status = blocked ? attack.statusOnBlock : attack.statusOnHit;
        if (status) setPlayerStatus(p, status, statusDurationOf(balance.status[PLAYER_STATUS_CFG[status]]));
        world.events.emit('player_damaged', {
          amount: damage, health: p.health, blocked,
          srcX: enemy.x, srcZ: enemy.z, srcId: enemy.id,
        });
        // 흡혈 박치기(박쥐) — 몸으로 친 만큼 제 피를 채운다. 막히면 못 빤다.
        // 정식 판정이 들어갔으면 관통 스침은 다시 치지 않는다
        if (def.flying) enemy.swoopHitDone = true;
        if (!blocked && def.flying?.slamHeal) {
          enemy.health = Math.min(def.health, enemy.health + def.flying.slamHeal);
          world.events.emit('bat_drain', { enemyId: enemy.id, x: enemy.x, z: enemy.z });
        }
        if (p.health <= 0) {
          p.health = 0;
          world.dead = true;
          world.events.emit('player_died', { tick: world.tick });
        }
      }
      // 진액 웅덩이(거수 P2+, B3-2 — attack.poolKind, 페이즈 poolsOn) — 낫은 착지한 낫끝(무기 끝 거리만큼 앞: 헛치면 사거리 끝, 맞았으면 맞은 자리 — 밀린 플레이어는
      // 대개 반경 밖, 막은 플레이어는 안에 남는다), 원형 강타(발구르기)는 착지 중심. 패링된 낫은 impact 에 오지 않으니 웅덩이도 없다. Hazards 가 spawn_pool 을 받는다
      if (attack.poolKind && poolsOn(def, enemy)) {
        const tip = attack.aoeRadius !== undefined ? 0 : enemy.weaponTipDist ?? fullReach(def, attack);
        world.events.emit('spawn_pool', {
          kind: attack.poolKind, x: enemy.x - Math.sin(enemy.yaw) * tip, z: enemy.z - Math.cos(enemy.yaw) * tip, enemyId: enemy.id, enemyType: enemy.type, hit: connected,
        });
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
        // 발구르기 착지(거수 B3-1) — 착지점 웅덩이(B3-2 Hazards)가 이 이벤트를 받는다. 기상 발구르기도 같다
        if (enemy.attackMode === 'slam') {
          world.events.emit('slam_landed', { enemyId: enemy.id, enemyType: enemy.type, x: enemy.x, z: enemy.z, radius: attack.aoeRadius, wake: enemy.wakeSlam === true, despair: enemy.despairSlam === true, hit: connected });
          enemy.wakeSlam = false;
          enemy.despairSlam = false;
        }
      }

      // 광란 돌격(거수 P3, B3-4) — 첫 질주가 끝났다(맞았든 헛쳤든): 물러서지 않고 제자리 선회(2차 예고) 뒤 새 자리로 두 번째 질주. 완벽 회피는 위에서 미끄러졌고,
      // 눈먼 질주(wasBlind)·지형 충돌(chargeCollide)·두 번째 질주(chainLeg 1) 뒤엔 없다
      const chain = def.chargeAttack?.chainCharge;
      const leg = enemy.chainLeg ?? 0;
      enemy.chainLeg = 0;
      if (chain && enemy.attackMode === 'charge' && attack.chargeRunTicks !== undefined && leg === 0 && !wasBlind && !world.dead && slotUnlocked(def, enemy, 'chainCharge')) {
        beginChainTurn(world, enemy, def, chain);
        break;
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
        // 삼연낫 연쇄(거수 P3, B3-4) — 이음(recoverTicks)이 끝났다: 다음 타가 있으면 플레이어 쪽으로 다시 겨눠 예고(맞았든 막혔든 헛쳤든 패링됐든 이어진다),
        // 마지막 타였으면 콤보를 접고 추격으로
        if (enemy.attackMode === 'combo' && def.comboAttack) {
          const nextStep = (enemy.comboStep ?? 0) + 1;
          if (comboStepAttack(def, nextStep)) {
            enemy.comboStep = nextStep;
            if (dist > 0.001) enemy.yaw = Math.atan2(-distX, -distZ);
            const step = currentAttack(def, enemy);
            startWindup(world, enemy, step);
            world.events.emit('enemy_combo_step', { enemyId: enemy.id, enemyType: enemy.type, step: nextStep, steps: comboChain(def).length, perfectOnly: step.perfectOnly === true, x: enemy.x, z: enemy.z });
            break;
          }
          enemy.attackMode = 'melee';
        }
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
  if (dist <= 0.001) return true;
  const facingX = -Math.sin(enemy.yaw);
  const facingZ = -Math.cos(enemy.yaw);
  const dot = (facingX * distX + facingZ * distZ) / dist;
  // 등 뒤 반구(180도)는 완전한 사각이다 — 인기척(noticeRadius)도 앞에서만 친다.
  // 등에 붙어 백스탭할 길을 연다 (2026-08-27). 맞는 순간에는 어디서든 즉시 깬다
  if (dot <= 0) return false;
  if (dist <= vision.noticeRadius) return true; // 앞쪽 코앞 — 시야각 밖이라도 인기척
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
  // 포효도 열린 칸을 따라 흐른다 — 닫힌 문 안쪽 방은 별세계다
  const cs = world.level.cellSize;
  const field = noiseField(world.level, source.x, source.z, radius + cs);
  for (const other of world.enemies) {
    if (other === source || !other.alive || other.ai !== 'idle') continue;
    if (other.lurking) continue; // 천장 잠복(거머리) — 포효에도 초연하다 (기습 담당)
    if (Math.hypot(other.x - source.x, other.z - source.z) > radius) continue;
    const pd = field.get(Math.floor(other.z / cs) * 4096 + Math.floor(other.x / cs));
    if (pd === undefined || pd > radius + cs) continue;
    alertEnemy(other, balance.enemyAi.noticeDelayTicks);
    world.events.emit('enemy_alerted', { enemyId: other.id, enemyType: other.type });
  }
}

const strafeCfg = balance.enemyAi.strafe;

/** 추격 흐름장 캐시 — 플레이어가 칸을 옮기거나 recomputeTicks 가 지나면 다시 판다.
 *  한 틱에 몇 마리가 묻어도 BFS 는 한 번이다 */
let pursuitCache: { level: unknown; key: number; tick: number; field: Map<number, number> } | null =
  null;
function getPursuitField(world: World): Map<number, number> {
  const cs = world.level.cellSize;
  const key = Math.floor(world.player.z / cs) * 4096 + Math.floor(world.player.x / cs);
  const pc = pursuitCache;
  if (
    pc &&
    pc.level === world.level &&
    pc.key === key &&
    Math.abs(world.tick - pc.tick) < balance.enemyAi.pursuit.recomputeTicks
  ) {
    return pc.field;
  }
  // 잔해(낙석)로 막힌 칸은 벽처럼 돌아간다 — 소음 전파와 달리 몸이 지나가야 하는 길이라서
  const level = world.level;
  const walkable = {
    cellSize: level.cellSize,
    solidAt: (c: number, r: number): boolean => level.solidAt(c, r) || level.pathBlockedAt(c, r),
  };
  const field = noiseField(walkable, world.player.x, world.player.z, balance.enemyAi.pursuit.range);
  pursuitCache = { level: world.level, key, tick: world.tick, field };
  return field;
}

/** 벽 너머 추격 경유 방향 — 흐름장의 내리막을 따라 문·통로로 돌아간다.
 *  lookaheadCells 칸 앞까지 내리막을 걷되 시야가 트인 마지막 칸 중심을 겨눈다
 *  (모서리 끊기 — 칸 중심을 일일이 밟는 지그재그를 편다). 장이 안 닿으면(문 닫힘·
 *  range 밖) null — 예전처럼 직진해 벽에 붙는 폴백 */
function pursuitDir(
  world: World,
  enemy: EnemyState,
  lookahead = balance.enemyAi.pursuit.lookaheadCells,
): { x: number; z: number } | null {
  const field = getPursuitField(world);
  const cs = world.level.cellSize;
  let cx = Math.floor(enemy.x / cs);
  let cz = Math.floor(enemy.z / cs);
  let cur = field.get(cz * 4096 + cx);
  if (cur === undefined) return null;
  let tx: number | null = null;
  let tz = 0;
  for (let step = 0; step < lookahead; step++) {
    let bx = cx;
    let bz = cz;
    let best: number = cur;
    for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const v = field.get((cz + oz) * 4096 + (cx + ox));
      if (v !== undefined && v < best) {
        best = v;
        bx = cx + ox;
        bz = cz + oz;
      }
    }
    if (bx === cx && bz === cz) break; // 바닥 — 플레이어 칸까지 내려왔다
    cx = bx;
    cz = bz;
    cur = best;
    const wx = (cx + 0.5) * cs;
    const wz = (cz + 0.5) * cs;
    const visible = world.level.hasLineOfSight(enemy.x, enemy.z, wx, wz);
    if (tx === null) {
      // 첫 내리막 칸은 무조건 겨눈다 — 이웃 칸이라 슬라이드로 닿는다
      tx = wx;
      tz = wz;
      if (!visible) break;
    } else if (visible) {
      tx = wx;
      tz = wz;
    } else {
      break;
    }
  }
  if (tx === null) return null;
  const dx = tx - enemy.x;
  const dz = tz - enemy.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.05) return null;
  return { x: dx / d, z: dz / d };
}

/** 외길 양보 상대 — 같이 끼임 탈출 중인 동료 중 더 앞선(플레이어에 가까운) 쪽.
 *  문 개구부(2.1m)는 둘이 나란히 못 들어가 대칭 압력으로 교착된다(실측: 슬라임 둘이
 *  각자 문설주에 짓눌려 정지). 뒤진 쪽이 물러나야 풀린다 — 거리, 동률이면 id 순 */
function unstickLeader(world: World, enemy: EnemyState): EnemyState | null {
  const un = balance.enemyAi.unstick;
  const p = world.player;
  const myDist = Math.hypot(p.x - enemy.x, p.z - enemy.z);
  for (const other of world.enemies) {
    if (other === enemy || !other.alive) continue;
    if ((other.unstickTicks ?? 0) <= 0) continue;
    if (Math.hypot(other.x - enemy.x, other.z - enemy.z) > un.yieldRadius) continue;
    const od = Math.hypot(p.x - other.x, p.z - other.z);
    if (od < myDist - 0.01 || (Math.abs(od - myDist) <= 0.01 && other.id < enemy.id)) {
      return other;
    }
  }
  return null;
}

/** 추격 접근 방향 — 시야가 트이면 산개(부채꼴), 벽에 막히면 흐름장으로 돌아간다 */
function approachDir(
  world: World,
  enemy: EnemyState,
  distX: number,
  distZ: number,
  dist: number,
): { x: number; z: number; pursuing: boolean } {
  if (world.level.hasLineOfSight(enemy.x, enemy.z, world.player.x, world.player.z)) {
    const fd = flankDir(enemy, distX / dist, distZ / dist, dist);
    // 편각이 한 발 앞 벽 칸을 향하면 접는다 — 문 옆 벽에 몸을 갈며 낭비하는 그림 방지
    const cs = world.level.cellSize;
    const probe = 1.2 + (enemyDef(enemy.type).radius ?? 0.5);
    const px = enemy.x + fd.x * probe;
    const pz = enemy.z + fd.z * probe;
    if (world.level.solidAt(Math.floor(px / cs), Math.floor(pz / cs))) {
      return { x: distX / dist, z: distZ / dist, pursuing: false };
    }
    return { x: fd.x, z: fd.z, pursuing: false };
  }
  const pd = pursuitDir(world, enemy);
  if (pd) return { x: pd.x, z: pd.z, pursuing: true };
  return { x: distX / dist, z: distZ / dist, pursuing: false };
}

/** 산개 접근 — id 로 정해지는 고유 편각으로 접근 방향을 튼다. 멀수록 크게 벌어지고
 *  convergeRange 안에서는 정면으로 수렴한다. 무리가 같은 최단 직선을 공유해 한 줄
 *  종대가 되는 것을 막는 값싼 우회다 — 경로탐색이 아니라서 통로에선 벽을 타고 만다 */
function flankDir(
  enemy: EnemyState,
  dirX: number,
  dirZ: number,
  dist: number,
): { x: number; z: number } {
  const fl = balance.enemyAi.flank;
  const t = Math.min(1, Math.max(0, (dist - fl.convergeRange) / (fl.fullRange - fl.convergeRange)));
  if (t <= 0) return { x: dirX, z: dirZ };
  // id 해시 → [-1, 1) 고정 편향 — 같은 무리라도 제각각 다른 각으로 벌어진다
  const h = (((enemy.id * 2654435761) >>> 0) % 1000) / 500 - 1;
  const ang = h * ((fl.maxOffsetDeg * Math.PI) / 180) * t;
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  return { x: dirX * c - dirZ * s, z: dirX * s + dirZ * c };
}

/** 플레이어 곁에서 공격 동작(예고·돌진) 중인 적 수 — 교대 공격의 자리 계산 */
function engagedCount(world: World, self: EnemyState): number {
  const eg = balance.enemyAi.engage;
  const p = world.player;
  let n = 0;
  for (const other of world.enemies) {
    if (other === self || !other.alive) continue;
    if (other.ai !== 'windup' && other.ai !== 'charging') continue;
    if (Math.hypot(other.x - p.x, other.z - p.z) > eg.countRadius) continue;
    n++;
  }
  return n;
}

/** 차례 기다리기 — 사거리 언저리에서 플레이어를 중심으로 옆걸음 포위. 붙박이로 서면
 *  한 점에 뭉치고 그 뭉치가 광역 한 방에 쓸린다 — 도는 동안 등·옆으로 번져 나간다 */
function circleAround(
  world: World,
  enemy: EnemyState,
  def: ReturnType<typeof enemyDef>,
  distX: number,
  distZ: number,
  dist: number,
  dt: number,
): void {
  if (dist <= 0) return;
  if (enemy.strafeDir === undefined) enemy.strafeDir = enemy.id % 2 === 0 ? 1 : -1;
  const perpX = -distZ / dist;
  const perpZ = distX / dist;
  const step = moveSpeed(enemy, def) * balance.enemyAi.engage.circleSpeedMul * dt;
  const bx = enemy.x;
  const bz = enemy.z;
  moveAvoiding(world, enemy, def, perpX * enemy.strafeDir, perpZ * enemy.strafeDir, step);
  // 벽·아군에 막혀 제자리면 반대쪽으로 돈다
  if (Math.hypot(enemy.x - bx, enemy.z - bz) < step * 0.3) enemy.strafeDir = -enemy.strafeDir;
}

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

/** 이동 속도 — 둔화 배율을 곱한다 (공격 리듬은 그대로다). 절뚝(거수 양 낫 잠김)이면 limp.speedMul, 페이즈 표의 speedMul(P3 ×1.2 — 걷기만, 돌격 속도는 그대로) */
function moveSpeed(enemy: EnemyState, def: ReturnType<typeof enemyDef>): number {
  return def.speed * slowFactor(enemy) * frenzyMul(enemy, def) * limpMul(enemy) * (resolvePhase(def, enemy.phase)?.speedMul ?? 1);
}

/** 절뚝 이속 배율 — 양 낫 잠김이면 balance.weakPoint.limp.speedMul, 아니면 1 */
function limpMul(enemy: EnemyState): number {
  return bothBladesLocked(enemy) ? balance.weakPoint.limp.speedMul : 1;
}

/** 절뚝 돌격 속도 배율 — 양 낫 잠김이면 limp.chargeSpeedMul */
function limpChargeMul(enemy: EnemyState): number {
  return bothBladesLocked(enemy) ? balance.weakPoint.limp.chargeSpeedMul : 1;
}

/** 절뚝(양 낫 잠김) 중 거리 유지(기획서 §9.2 retreatWhenDisarmed) — min 안이면 뒤로 물러나고, min~max 는 제자리에서 마주 보고,
 *  max 밖(또는 절뚝이 아님·설정 없음)이면 false 를 돌려 평소 접근으로. 물러날 때도 이속은 절뚝 배율이다 */
function holdDisarmedRange(
  world: World,
  enemy: EnemyState,
  def: ReturnType<typeof enemyDef>,
  distX: number,
  distZ: number,
  dist: number,
  dt: number,
): boolean {
  const rr = def.retreatWhenDisarmed;
  if (!rr || !bothBladesLocked(enemy) || dist <= 0) return false;
  if (dist > rr.max) return false;
  enemy.yaw = Math.atan2(-distX, -distZ);
  if (dist < rr.min) moveAvoiding(world, enemy, def, -distX / dist, -distZ / dist, moveSpeed(enemy, def) * dt);
  return true;
}

/** 광란 배율 — 생명 입자를 먹은 만큼 빨라진다 (이속·공속 공용, 구울) */
function frenzyMul(enemy: EnemyState, def: ReturnType<typeof enemyDef>): number {
  if (!def.eatsMotes || !enemy.frenzyStacks) return 1;
  return 1 + def.eatsMotes.frenzyPerStack * enemy.frenzyStacks;
}

function moveAvoiding(
  world: World,
  enemy: EnemyState,
  def: ReturnType<typeof enemyDef>,
  dirX: number,
  dirZ: number,
  step: number,
  sepMul = 1, // 좁은 문을 줄지어 지날 때(끼임 탈출)는 서로 밀어내는 힘을 줄인다
): void {
  if ((enemy.flinchTicks ?? 0) > 0) return; // 총에 맞아 움찔 — 이번 틱은 못 움직인다
  const sep = separation(world, enemy);
  const strength = balance.enemyAi.separation.strength * sepMul;
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

/** 몸 접촉 거리 — 적 반지름 + 플레이어 반지름 + 여유(contact.padM). hitOnContact 공격의 "부딛쳤다" */
export function contactDist(def: ReturnType<typeof enemyDef>): number {
  return def.radius + balance.player.radius + balance.contact.padM;
}

/** 타격 창에 들어선 뒤 흐른 틱 — 접촉 판정은 contact.minActiveTicks 뒤부터 열린다(코앞에서도 패링할 틈) */
function activeElapsed(enemy: EnemyState): number {
  return enemy.ai === 'active_perfect'
    ? balance.reaction.windowPerfectTicks - enemy.timer
    : balance.reaction.windowPerfectTicks + (balance.reaction.windowNormalTicks - enemy.timer);
}

/** 휘두르는 도중 닿았는가 — 무기 끝이 가드(몸) 안에 들었거나(gap<=0) 몸이 부딛쳤고, 공격이 나를 향한다(호·사거리).
 *  타격 창 경과가 minActiveTicks 미만이면 아직 아니다 */
function strikeContacts(
  world: World,
  enemy: EnemyState,
  def: ReturnType<typeof enemyDef>,
  attack: EnemyAttackDef,
  dist: number,
): boolean {
  const p = world.player;
  if (activeElapsed(enemy) < balance.contact.minActiveTicks) return false;
  const gap = dist - balance.player.radius - (enemy.weaponTipDist ?? 0);
  if (gap > 0 && dist > contactDist(def)) return false;
  return attackReaches(def, enemy, attack, p.x, p.z);
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

/** 근접 모드 선택 — attackAlt.alternate(거수 두 낫)가 있으면 오른낫('melee' = attack)·왼낫('alt' = attackAlt)을 번갈아
 *  낸다. 마지막으로 휘두른 낫은 enemy.lastBlade 가 기억한다(첫 낫은 오른낫). 관절 파열로 잠긴 낫(bladeLock)은 선택지에서 빠져
 *  남은 낫만 나가고(예측 가능해진다 — 통제 노선), 둘 다 잠겼으면 null(낫 없음 — 호출부가 물러선다).
 *  슬롯·플래그가 없는 적은 예전처럼 늘 'melee' */
function pickMeleeMode(def: ReturnType<typeof enemyDef>, enemy: EnemyState): 'melee' | 'alt' | null {
  if (!def.attackAlt?.alternate) return 'melee';
  const rLocked = bladeLocked(enemy, 'r');
  const lLocked = bladeLocked(enemy, 'l');
  if (rLocked && lLocked) return null;
  if (rLocked) enemy.lastBlade = 'l';
  else if (lLocked) enemy.lastBlade = 'r';
  else enemy.lastBlade = enemy.lastBlade === 'r' ? 'l' : 'r';
  return enemy.lastBlade === 'l' ? 'alt' : 'melee';
}

function startWindup(world: World, enemy: EnemyState, attack: EnemyAttackDef): void {
  enemy.ai = 'windup';
  enemy.timer = Math.max(1, Math.round(attack.windupTicks / frenzyMul(enemy, enemyDef(enemy.type))));
  // 질식(거수 B3-2, 기획서 §5 choke) — 분출공이 막혀 헐떡이는 동안 모든 예고가 windupPenalty 틱 늘어진다(패링 판정은 무기 끝 거리라 그대로, 읽을 시간만 는다)
  if ((enemy.chokeTicks ?? 0) > 0) enemy.timer += balance.weakPoint.choke.windupPenalty;
  enemy.whiffed = false;
  enemy.recoiled = false;
  enemy.wakeSlam = false; // 기상 발구르기 표식은 trySlam 이 이 뒤에 세운다 — 다른 공격이 시작되면 지워진다
  enemy.despairSlam = false; // 절망의 포효 연계 표식도 resolveRoar 가 이 뒤에 세운다(B3-4)
  enemy.strikeProgress = 0;
  enemy.weaponTipDist = fullReach(enemyDef(enemy.type), attack) * balance.parrySpace.pullbackRatio;
  world.events.emit('enemy_windup', {
    enemyId: enemy.id,
    enemyType: enemy.type,
    telegraph: attack.telegraph ?? 'blue',
    perfectOnly: attack.perfectOnly === true, // 완벽 전용 타(거수 삼연낫 ③) — main 이 예고음을 고음으로(결정 17)
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
      (attack.projectileKind as 'rock' | 'web' | 'goo' | undefined) ??
      ((attack.deflectable ?? false) ? 'magic' : 'arrow'),
    // 광역 효과는 투사체가 들고 간다 — 시전자가 먼저 죽어도, 반사돼도 그대로 터진다
    splash: attack.splash,
    appliesWeb: attack.appliesWeb,
    breakable: attack.breakable,
    // 거수 진액 구슬(B3-2) — 반사 자가 피격(분출공 고정 피해)·착탄 웅덩이·오염 진액·밀림 재정의도 투사체가 들고 간다(근접 impact 와 같은 공격별 재정의 규약)
    deflectSelfDamage: attack.deflectSelfDamage,
    poolKind: attack.poolKind,
    statusOnHit: attack.statusOnHit,
    statusOnBlock: attack.statusOnBlock,
    playerKnockback: attack.playerKnockback,
  });
  world.events.emit('enemy_cast', { enemyId: enemy.id, enemyType: enemy.type });
}
