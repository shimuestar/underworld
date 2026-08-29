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
import { alertEnemy, alertNearbyAt, playerBlocks, pushEnemy, pushPlayer, type EnemyState, type World } from '../core/World';

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
      continue;
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
      const ang = (Math.PI * 2 * i) / enemy.eatenItems.length;
      item.x = enemy.x + Math.sin(ang) * 0.5;
      item.z = enemy.z + Math.cos(ang) * 0.5;
      item.magnet = false;
      item.y = undefined;
      item.speed = undefined;
      world.groundItems.push(item);
    }
    world.events.emit('slime_spilled', { count: enemy.eatenItems.length, x: enemy.x, z: enemy.z });
    enemy.eatenItems = undefined;
  }
  const split = enemyDef(enemy.type).split;
  if (!split) return;
  if (enemy.burnTicks > 0 || (enemy.freezeTicks ?? 0) > 0) return;
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

/** 새끼 분리 — 시전이 끝나면 큐만 건다. 실제 사출은 emitBrood 가 한 마리씩,
 *  머리에서 순차적으로 뛰쳐나오게 한다. healthCost 는 여기서 한 번에 치른다 */
function spawnBrood(world: World, enemy: EnemyState, attack: EnemyAttackDef): void {
  const brood = attack.brood;
  if (!brood) return;
  enemy.broodLeft = brood.count;
  enemy.broodTicks = 1; // 다음 틱부터 튀어나오기 시작
  enemy.health = Math.max(1, enemy.health - brood.healthCost); // 제 몸을 떼어 준 값
  world.events.emit('boss_brood', {
    enemyId: enemy.id, enemyType: enemy.type, count: brood.count, x: enemy.x, z: enemy.z,
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
    p.health -= fs.damage;
    enemy.health = Math.min(def.health, enemy.health + fs.heal); // 빤 만큼 제 몸이 찬다
    world.events.emit('leech_suck', { count: enemy.suckCount, max: fs.maxSucks });
    world.events.emit('player_damaged', { amount: fs.damage, health: p.health, source: 'leech_suck' });
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

function tickEnemy(world: World, enemy: EnemyState, dt: number): void {
  const def = enemyDef(enemy.type);
  const p = world.player;

  enemy.prevX = enemy.x;
  enemy.prevZ = enemy.z;
  enemy.prevJumpY = enemy.jumpY ?? 0;

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
      const dmg = blocked ? lurk.dropDamage * balance.block.chipDamageRatio : lurk.dropDamage;
      p.health -= dmg;
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
  if ((enemy.summonCooldown ?? 0) > 0) enemy.summonCooldown = (enemy.summonCooldown ?? 0) - 1;
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
      if (def.idleWander && !enemy.feigning) {
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
        if (dist <= (def.feignWakeRadius ?? 0)) {
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
      // 피격만이 깨운다. 걸어서(무음) 지나가면 코앞이라도 무해하다
      const blind = def.blind ?? false;
      const lit = !behind && !blind && litByLantern(world, dist, distX, distZ);
      if (
        (lit || (dist <= def.aggroRange && !blind && seesPlayer(enemy, dist, distX, distZ))) &&
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
      // 새끼 분리 — 몸에서 슬라임 다섯을 떼어 무리를 만든다 (어미 슬라임).
      // 제 체력을 대가로 치르고, 살아 있는 새끼가 많으면 아껴 둔다.
      // 화상 중엔 말라붙어 떼어낼 몸이 없다 — 불이 무리를 끊는 정답
      const brood = def.summonAttack?.brood;
      if (
        def.summonAttack &&
        brood &&
        (enemy.summonCooldown ?? 0) <= 0 &&
        enemy.burnTicks <= 0 &&
        world.enemies.filter((e) => e.alive && e.type === brood.type).length < brood.maxAlive
      ) {
        enemy.attackMode = 'summon';
        enemy.summonCooldown = brood.cooldownTicks;
        startWindup(world, enemy, def.summonAttack);
        break;
      }
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
      const ch = def.chargeAttack;
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

      if (attack.type === 'summon') {
        // 시전 완료 — 부풀었던 몸에서 새끼들이 떨어져 나간다
        spawnBrood(world, enemy, attack);
        enemy.ai = 'recover';
        enemy.timer = attack.recoverTicks;
      } else if (attack.type === 'projectile') {
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
        p.health -= grip.biteDamage;
        world.events.emit('ghoul_bite', { enemyId: enemy.id });
        world.events.emit('player_damaged', {
          amount: grip.biteDamage, health: p.health, srcX: enemy.x, srcZ: enemy.z, srcId: enemy.id, source: 'ghoul_bite',
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
      const connected = attackReaches(def, enemy, attack, p.x, p.z) && p.iframeTicks <= 0;
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
        world.events.emit('player_damaged', {
          amount: damage, health: p.health, blocked,
          srcX: enemy.x, srcZ: enemy.z, srcId: enemy.id,
        });
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
  for (const other of world.enemies) {
    if (other === source || !other.alive || other.ai !== 'idle') continue;
    if (other.lurking) continue; // 천장 잠복(거머리) — 포효에도 초연하다 (기습 담당)
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
  return def.speed * slowFactor(enemy) * frenzyMul(enemy, def);
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
  enemy.timer = Math.max(1, Math.round(attack.windupTicks / frenzyMul(enemy, enemyDef(enemy.type))));
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
