// 함정 — 압력판 다트·가시 (이후 그물·기름·문양·가스·낙석·진자). 플레이어와 적 모두에게 작동한다.
// 상태 머신: armed(대기) → telegraph(예고: 소리·동작) → firing(작동 중) → cooldown → armed.
// 1회용은 spent, 플레이어가 해체하면 disarmed. 판정은 몸 중심↔함정 중심 반경(점액 장판과 같은 규약).
// 적은 함정을 모른다(피하지 않는다) — 쫓기면서 함정 위로 유도하는 것이 정답 플레이다.
// 수치는 전부 balance.traps.types[type]. 예고는 UI 가 아니라 이벤트→소리·모형 동작으로만.

import { balance } from '../core/Balance';
import { enemyDef } from '../core/Entities';
import {
  alertNearbyAt,
  applyFrostOnHit,
  igniteOilInRadius,
  playerBlocks,
  pushEnemy,
  pushPlayer,
  spendStamina,
  type EnemyState,
  type TrapState,
  type World,
  type DotKind,
} from '../core/World';

let nextTrapProjId = 870000; // 매복(850000)·상자 골드(900000) 대역 사이

export type TrapCfg = Record<string, number>;

/** 종별 수치 — 데이터에 없는 타입은 undefined (Spawner 가 이미 걸러낸다) */
export function trapCfg(type: string): TrapCfg | undefined {
  return (balance.traps.types as unknown as Record<string, TrapCfg | undefined>)[type];
}

/** 이 적이 함정을 밟을 수 있는가 — 천장·벽에 붙은 놈, 죽은 척, 공중, 플레이어에 매달린 놈은 아니다 */
export function canTriggerTrap(enemy: EnemyState): boolean {
  if (!enemy.alive || enemy.lurking || enemy.feigning || enemy.wallCling) return false;
  if (enemy.ai === 'latched') return false; // 플레이어와 좌표가 겹친다 — 이중 트리거·그래플 꼬임 방지
  if ((enemy.jumpY ?? 0) > balance.flyoverHeight) return false; // 날거나 뛰어넘는 중
  return true;
}

function victimInRadius(world: World, trap: TrapState, radius: number): 'player' | 'enemy' | null {
  const p = world.player;
  // 대시(회피)·그림자 질주로 지나가는 몸은 판을 누르지 않는다 — 함정 위를 '넘어가는' 수단
  const passing = (p.blinkLeft ?? 0) > 0 || p.dodgeTicks > 0;
  if (!world.dead && !passing && Math.hypot(p.x - trap.x, p.z - trap.z) <= radius) {
    return 'player';
  }
  for (const enemy of world.enemies) {
    if (!canTriggerTrap(enemy)) continue;
    if (Math.hypot(enemy.x - trap.x, enemy.z - trap.z) <= radius) return 'enemy';
  }
  return null;
}

/** 플레이어 피해 — main 의 피해 관용구. blockable=false 는 아래·위에서 오는 공격(가시·낙석) */
function hurtPlayer(
  world: World,
  trap: TrapState,
  raw: number,
  opt: {
    blockable: boolean; source: string; knockback?: number; knockbackTicks?: number;
    /** 참 = 회피 무적(iframe)도 못 막는다 — 서 있는 가시에 몸을 들이미는 경우 */
    ignoreIframes?: boolean;
  },
): void {
  const p = world.player;
  if (world.dead || (p.iframeTicks > 0 && !opt.ignoreIframes)) return;
  let amount = raw;
  let blocked = false;
  if (opt.blockable) {
    blocked = playerBlocks(world, trap.x, trap.z, balance.block.arcDeg);
    if (blocked) amount = raw * balance.block.chipDamageRatio;
  }
  p.health -= amount;
  if (opt.knockback && opt.knockbackTicks) {
    const dx = p.x - trap.x;
    const dz = p.z - trap.z;
    const d = Math.hypot(dx, dz);
    if (d > 0.001) pushPlayer(p, dx / d, dz / d, opt.knockback, opt.knockbackTicks);
  }
  world.events.emit('player_damaged', {
    amount, health: p.health, blocked, srcX: trap.x, srcZ: trap.z, source: opt.source,
  });
  world.events.emit('trap_hit_player', { id: trap.id, type: trap.type, amount });
  if (p.health <= 0) {
    p.health = 0;
    world.dead = true;
    world.events.emit('player_died', { tick: world.tick });
  }
}

/** 적 피해 — 폭발(explodeAt)과 같은 규약. 처치는 trap_kill (마나 없음 — 총 처치와 같은 결) */
function hurtEnemy(
  world: World,
  trap: TrapState,
  enemy: EnemyState,
  raw: number,
  cfg: TrapCfg,
  knockback?: { distance: number; ticks: number },
): void {
  const def = enemyDef(enemy.type);
  const boss = def.boss || enemy.floorBoss === true;
  const amount = boss ? raw * (cfg['bossDamageMul'] ?? 1) : raw;
  if (enemy.ai === 'idle') enemy.ai = 'chase';
  const dealt = applyFrostOnHit(world.events, enemy, amount);
  enemy.health -= dealt;
  world.events.emit('damage_pop', { enemyId: enemy.id, amount: dealt });
  world.events.emit('trap_hit_enemy', { id: trap.id, type: trap.type, enemyId: enemy.id, amount: dealt });
  if (enemy.health <= 0) {
    enemy.alive = false;
    world.events.emit('trap_kill', { enemyType: enemy.type, trapType: trap.type });
    world.events.emit('enemy_died', {
      enemyId: enemy.id, enemyType: enemy.type, x: enemy.x, z: enemy.z, noLoot: enemy.noLoot,
    });
    return;
  }
  if (knockback) pushEnemy(enemy, enemy.x - trap.x, enemy.z - trap.z, knockback.distance, knockback.ticks);
}

/** 함정 둔화 — 서리 스택이 있는 적은 건너뛴다: slowTicks 만료가 서리 겹을 지우므로
 *  함정 둔화가 서리 볼트 콤보를 깎아먹지 않게. 있는 둔화보다 약하게 덮지도 않는다 */
function slowEnemy(enemy: EnemyState, ticks: number, mul: number): void {
  if ((enemy.frostStacks ?? 0) > 0) return;
  enemy.slowTicks = Math.max(enemy.slowTicks ?? 0, ticks);
  enemy.slowMul = Math.min(enemy.slowMul ?? 1, mul);
}

/** 그물 — 밟은 자리 반경 안: 플레이어는 거미줄 상태(기존 탈출 규칙 그대로), 적은 완전 둔화 */
function fireNet(world: World, trap: TrapState, cfg: TrapCfg): void {
  const r = cfg['hitRadius'] ?? 1.0;
  const p = world.player;
  if (!world.dead && Math.hypot(p.x - trap.x, p.z - trap.z) <= r) {
    p.webSwingsLeft = balance.web.breakSwings;
    world.events.emit('web_caught', { swings: p.webSwingsLeft });
    world.events.emit('trap_hit_player', { id: trap.id, type: trap.type, amount: 0 });
  }
  for (const enemy of world.enemies) {
    if (!canTriggerTrap(enemy)) continue;
    if (Math.hypot(enemy.x - trap.x, enemy.z - trap.z) > r) continue;
    slowEnemy(enemy, cfg['enemySlowTicks'] ?? 0, cfg['enemySlowMul'] ?? 1);
    world.events.emit('trap_hit_enemy', { id: trap.id, type: trap.type, enemyId: enemy.id, amount: 0 });
  }
}

/** 저주 문양 — 밟는 순간 터진다. 플레이어: 오염 pending + 시야 흔들림 (피해 없음 — 연쇄 유지).
 *  적: 경직 → 처형 가능. 어느 쪽이든 비명이 방을 깨운다 */
function fireGlyph(world: World, trap: TrapState, cfg: TrapCfg): void {
  const r = cfg['triggerRadius'] ?? 1.2;
  const p = world.player;
  if (!world.dead && Math.hypot(p.x - trap.x, p.z - trap.z) <= r) {
    world.corruption.pending += cfg['corruptionPending'] ?? 0;
    p.aimShakeTicks = Math.max(p.aimShakeTicks ?? 0, cfg['shakeTicks'] ?? 0);
    p.aimShakeAmp = Math.max(p.aimShakeAmp ?? 0, cfg['shakeAmp'] ?? 0);
    world.events.emit('trap_glyph_burst', { id: trap.id, x: trap.x, z: trap.z, victim: 'player' });
    world.events.emit('trap_hit_player', { id: trap.id, type: trap.type, amount: 0 });
  }
  let hitEnemy = false;
  for (const enemy of world.enemies) {
    if (!canTriggerTrap(enemy)) continue;
    if (Math.hypot(enemy.x - trap.x, enemy.z - trap.z) > r) continue;
    const boss = enemyDef(enemy.type).boss || enemy.floorBoss === true;
    // 패링 스태거와 같은 필드 — 진행 중이던 공격은 그 자리에서 굳는다 (Reaction 규약)
    enemy.ai = 'staggered';
    enemy.timer = Math.round((cfg['enemyStaggerTicks'] ?? 0) * (boss ? (cfg['bossStaggerMul'] ?? 1) : 1));
    enemy.attackFreezeTicks = 0;
    enemy.wantsBash = false;
    hitEnemy = true;
    world.events.emit('trap_hit_enemy', { id: trap.id, type: trap.type, enemyId: enemy.id, amount: 0 });
  }
  if (hitEnemy) world.events.emit('trap_glyph_burst', { id: trap.id, x: trap.x, z: trap.z, victim: 'enemy' });
}

/** 기름 웅덩이 — 밟는 것으론 안 터진다. 둔화는 매 틱, 불이 붙으면 burnTicks 동안 화염 지대 */
function tickOil(world: World, trap: TrapState, cfg: TrapCfg): void {
  if (trap.phase !== 'armed' && trap.phase !== 'firing') return;
  const r = cfg['radius'] ?? 1.5;
  const burning = trap.phase === 'firing';
  for (const enemy of world.enemies) {
    if (!canTriggerTrap(enemy)) continue;
    if (Math.hypot(enemy.x - trap.x, enemy.z - trap.z) > r) continue;
    slowEnemy(enemy, 3, cfg['enemySlowMul'] ?? 1); // 매 틱 갱신 — 나가면 곧 풀린다
    if (burning) {
      // 화상은 기존 DoT 파이프라인(Projectiles.applyBurns)이 피해·처치를 맡는다
      enemy.burnTicks = Math.max(enemy.burnTicks, cfg['enemyBurnTicks'] ?? 0);
      enemy.burnDamagePerTick = Math.max(enemy.burnDamagePerTick, cfg['enemyBurnDamagePerTick'] ?? 0);
    } else if (enemy.burnTicks > 0) {
      // 불타는 적이 기름을 밟았다 — 옮겨붙는다
      igniteOilInRadius(world, trap.x, trap.z, 0.01, cfg['burnTicks'] ?? 0);
      return; // 다음 틱부터 화염 지대
    }
  }
  if (!burning) return;
  const p = world.player;
  if (!world.dead && Math.hypot(p.x - trap.x, p.z - trap.z) <= r) {
    // 불이 옮겨붙는다 — 화염 상태(초기 피해 뒤 도트). 서 있는 동안은 시간만 갱신된다
    applyDot(world, trap, 'burn', {
      initial: cfg['playerBurnInitial'] ?? 0,
      total: cfg['playerBurnTotal'] ?? 0,
      duration: cfg['playerBurnDurationTicks'] ?? 240,
      interval: cfg['playerBurnTickIntervalTicks'] ?? 30,
    });
  }
  // 옮겨붙기 — 근처의 안 붙은 기름
  igniteOilInRadius(world, trap.x, trap.z, cfg['chainRadius'] ?? 0, cfg['burnTicks'] ?? 0);
  if (--trap.timer <= 0) {
    trap.phase = 'spent';
    trap.timer = 0;
    world.events.emit('trap_spent', { id: trap.id, type: trap.type, x: trap.x, z: trap.z });
  }
}

/** 지속 피해 상태(독·화염) 공통 — 처음이면 즉시 피해(막기 불가, 연쇄 끊김) 뒤 도트가 시작되고,
 *  이미 걸려 있으면 시간만 갱신된다 (초기 피해 반복 없음 — 구름·불길 안에 서 있어도 누적 타격은 아니다).
 *  회피 무적·그림자 이동 중에는 새로 걸리지 않는다 (불길을 대시로 가르는 건 컨셉대로 무사) */
interface DotSpec { initial: number; total: number; duration: number; interval: number }
function applyDot(world: World, trap: TrapState, kind: DotKind, spec: DotSpec): void {
  const p = world.player;
  const duration = Math.max(1, Math.round(spec.duration));
  const dots = (p.dots ??= {});
  const cur = dots[kind];
  if (cur && cur.ticks > 0) {
    cur.ticks = Math.max(cur.ticks, duration);
    return;
  }
  if (p.iframeTicks > 0 || (p.blinkLeft ?? 0) > 0) return;
  const interval = Math.max(1, Math.round(spec.interval));
  dots[kind] = { ticks: duration, duration, perTick: spec.total / duration, accum: 0, interval, next: interval };
  hurtPlayer(world, trap, spec.initial, { blockable: false, source: kind });
  world.events.emit(`${kind}_applied`, { ticks: duration, total: spec.total });
}

/** 도트 진행 — interval 마다 누적분을 한 번에 깎는다(그때마다 '윽'). player_damaged 를 쓰지 않는다
 *  (붉은 화면·진동 도배 방지 — main 이 `${kind}_tick` 에 신음만 얹는다). 박자는 시간 갱신과 무관하다 */
function tickDots(world: World): void {
  const p = world.player;
  if (!p.dots || world.dead) return;
  for (const kind of Object.keys(p.dots) as DotKind[]) {
    const d = p.dots[kind];
    if (!d || d.ticks <= 0) continue;
    d.ticks--;
    d.accum += d.perTick;
    const last = d.ticks <= 0;
    if (--d.next <= 0 || last) {
      d.next = d.interval;
      const amount = d.accum;
      d.accum = 0;
      if (amount > 0) {
        p.health -= amount;
        world.events.emit(`${kind}_tick`, { amount, health: p.health });
        if (p.health <= 0) {
          p.health = 0;
          world.dead = true;
          world.events.emit('player_died', { tick: world.tick });
          return;
        }
      }
    }
    if (last) {
      delete p.dots[kind];
      world.events.emit(`${kind}_ended`, {});
    }
  }
}

/** 포자 구름 — 도는 동안 매 틱. 시야가 흔들리고 숨이 막히고(스태미너), 기침이 방을 깨우고, 독이 든다 */
function tickGasCloud(world: World, trap: TrapState, cfg: TrapCfg): void {
  const r = cfg['cloudRadius'] ?? 3;
  const p = world.player;
  if (!world.dead && Math.hypot(p.x - trap.x, p.z - trap.z) <= r) {
    applyDot(world, trap, 'poison', {
      initial: cfg['poisonInitial'] ?? 0,
      total: cfg['poisonTotal'] ?? 0,
      duration: cfg['poisonDurationTicks'] ?? 1800,
      interval: cfg['poisonTickIntervalTicks'] ?? 30,
    });
    p.aimShakeTicks = Math.max(p.aimShakeTicks ?? 0, cfg['shakeTicks'] ?? 0);
    p.aimShakeAmp = Math.max(p.aimShakeAmp ?? 0, cfg['shakeAmp'] ?? 0);
    if (spendStamina(world.stamina, cfg['staminaDrainPerTick'] ?? 0, balance.player.stamina.regenDelayTicks)) {
      world.events.emit('stamina_empty', {});
    }
    const cough = Math.max(1, cfg['coughIntervalTicks'] ?? 60);
    if (trap.timer % cough === 0) {
      alertNearbyAt(world, p.x, p.z, cfg['coughNoiseRadius'] ?? 0, balance.enemyAi.noticeDelayTicks);
      world.events.emit('trap_gas_cough', { id: trap.id, x: p.x, z: p.z });
    }
  }
  for (const enemy of world.enemies) {
    if (!canTriggerTrap(enemy)) continue;
    if (Math.hypot(enemy.x - trap.x, enemy.z - trap.z) > r) continue;
    slowEnemy(enemy, 3, cfg['enemySlowMul'] ?? 1); // 기침하는 고블린 — 매 틱 갱신
  }
}

/** 낙석 — 반경 안 전원에 감쇠 피해·바깥으로 밀림. 잔해는 몸을 막는 저지대로 남는다
 *  (총알·소리는 넘어간다). 적 추격 경로도 막는다 — 안 그러면 잔해에 몸을 박는다 */
function fireRockfall(world: World, trap: TrapState, cfg: TrapCfg): void {
  const R = cfg['damageRadius'] ?? 4;
  const falloff = (d: number): number => 1 - (1 - (cfg['damageFalloffMin'] ?? 1)) * Math.min(1, d / R);
  const p = world.player;
  const pd = Math.hypot(p.x - trap.x, p.z - trap.z);
  if (pd <= R) {
    hurtPlayer(world, trap, (cfg['damage'] ?? 0) * falloff(pd), {
      blockable: false, source: 'trap_rockfall',
      knockback: cfg['playerKnockback'], knockbackTicks: cfg['playerKnockbackTicks'],
    });
  }
  for (const enemy of world.enemies) {
    if (!enemy.alive) continue; // 천장에서 떨어진다 — 매달린 놈도 맞는다
    const d = Math.hypot(enemy.x - trap.x, enemy.z - trap.z);
    if (d > R) continue;
    hurtEnemy(world, trap, enemy, (cfg['enemyDamage'] ?? 0) * falloff(d), cfg, {
      distance: (cfg['enemyKnockback'] ?? 0) * falloff(d), ticks: cfg['enemyKnockbackTicks'] ?? 12,
    });
  }
  trap.blocker = world.level.addBlocker(trap.x, trap.z, cfg['rubbleHalf'] ?? 1.5);
  world.level.setPathBlocked(trap.col, trap.row);
}

/** 진자 칼날 — 항시 작동. 최저점(칸 중심 통과) 창에서 몸당 1회. 플레이어는 완벽 패링으로 흘릴 수 있다 */
function tickPendulum(world: World, trap: TrapState, cfg: TrapCfg): void {
  const period = Math.max(2, Math.round(cfg['periodTicks'] ?? 120));
  const half = Math.max(1, Math.floor(period / 2));
  trap.phase = 'firing';
  // 처음엔 진폭 끝(반주기의 절반 지점)에서 시작 — 층에 들어서자마자 최저점에 서 있는 사고 방지
  if (trap.cycleTick === undefined) trap.cycleTick = Math.floor(half / 2);
  trap.cycleTick = (trap.cycleTick + 1) % period;
  const inHalf = trap.cycleTick % half; // 0 = 최저점
  const toLowest = inHalf === 0 ? 0 : half - inHalf; // 다음 최저점까지
  const windowHalf = Math.floor((cfg['hitWindowTicks'] ?? 6) / 2);
  const inWindow = Math.min(inHalf, half - inHalf) <= windowHalf;
  const p = world.player;
  const r = cfg['hitRadius'] ?? 1.2;
  const near = !world.dead && Math.hypot(p.x - trap.x, p.z - trap.z) <= r;
  // 진폭 끝(방향이 바뀌는 순간) — 쇠사슬이 삐걱인다. 최저점의 '휭'과 번갈아 나 움직임이 내내 들린다
  if (inHalf === Math.floor(half / 2)) {
    const pd = Math.hypot(p.x - trap.x, p.z - trap.z);
    if (pd <= (cfg['whooshRadius'] ?? 0)) world.events.emit('trap_creak', { id: trap.id, x: trap.x, z: trap.z });
  }

  // 창 밖 — 리드 안에서 누른 반응은 버퍼로 살려 둔다 (Reaction 의 incoming 규약과 같은 장치)
  if (!inWindow) {
    trap.hitIds = undefined;
    if (near && toLowest <= (cfg['parryLeadTicks'] ?? 0) && world.input.reactionPressed) {
      p.parryBufferTicks = balance.reaction.parryBufferTicks;
    }
    return;
  }
  const hit = (trap.hitIds ??= []);
  // 칼날 진행 방향 — 복도 축(dir)에 수직, 반주기마다 반대로
  const sign = Math.floor(trap.cycleTick / half) % 2 === 0 ? 1 : -1;
  const swingX = -trap.dirZ * sign;
  const swingZ = trap.dirX * sign;
  if (inHalf === 0) {
    const pd = Math.hypot(p.x - trap.x, p.z - trap.z);
    if (pd <= (cfg['whooshRadius'] ?? 0)) world.events.emit('trap_whoosh', { id: trap.id, x: trap.x, z: trap.z });
  }
  if (near && !hit.includes(-1)) {
    hit.push(-1);
    if (world.input.reactionPressed || (p.parryBufferTicks ?? 0) > 0) {
      // 완벽 패링 — 피해 0, 히트스톱, 마나(Mana 가 parry_attempt 를 듣는다)
      p.parryBufferTicks = 0;
      world.freezeTicks = Math.max(world.freezeTicks, balance.reaction.hitstopPerfectTicks);
      world.events.emit('parry_attempt', { result: 'perfect', chain: 0, enemyType: 'trap_pendulum' });
      world.events.emit('trap_parried', { id: trap.id, x: trap.x, z: trap.z });
    } else {
      const before = p.health;
      hurtPlayer(world, trap, cfg['damage'] ?? 0, { blockable: true, source: 'trap_pendulum' });
      if (p.health < before && (cfg['playerKnockback'] ?? 0) > 0) {
        pushPlayer(p, swingX, swingZ, cfg['playerKnockback'] ?? 0, cfg['playerKnockbackTicks'] ?? 12);
      }
    }
  }
  for (const enemy of world.enemies) {
    if (!canTriggerTrap(enemy) || hit.includes(enemy.id)) continue;
    if (Math.hypot(enemy.x - trap.x, enemy.z - trap.z) > r) continue;
    hit.push(enemy.id);
    hurtEnemy(world, trap, enemy, cfg['enemyDamage'] ?? 0, cfg);
    if (enemy.alive) {
      pushEnemy(enemy, swingX, swingZ, cfg['enemyKnockback'] ?? 0, cfg['enemyKnockbackTicks'] ?? 12);
    }
  }
}

/** 자동 순환 가시판 — 트리거 없이 내려감→덜컹→가시→회수를 돈다. 위상은 phaseOffset,
 *  없으면 (row+col) 짝홀로 반주기 어긋난다 — 인접 판이 서로 반대라 안전한 판을 골라 건넌다.
 *  phase·timer 는 일반 가시판과 같은 뜻으로 채워 모형·소리(이벤트)를 그대로 쓴다 */
function tickAutoSpike(world: World, trap: TrapState, cfg: TrapCfg): void {
  const down = Math.max(1, Math.round(cfg['downTicks'] ?? 60));
  const tele = Math.max(0, Math.round(cfg['telegraphTicks'] ?? 0));
  const up = Math.max(1, Math.round(cfg['upTicks'] ?? 60));
  const retract = Math.max(0, Math.round(cfg['cooldownTicks'] ?? 0));
  const cycle = down + tele + up + retract;
  if (trap.cycleTick === undefined) {
    trap.cycleTick =
      ((trap.phaseOffset ?? ((trap.row + trap.col) % 2) * Math.floor(cycle / 2)) % cycle + cycle) % cycle;
    trap.phase = 'armed';
  }
  trap.cycleTick = (trap.cycleTick + 1) % cycle;
  const t = trap.cycleTick;
  const at = { id: trap.id, type: trap.type, x: trap.x, z: trap.z };
  let phase: TrapState['phase'];
  if (t < down) {
    phase = 'armed';
    trap.timer = down - t;
  } else if (t < down + tele) {
    phase = 'telegraph';
    trap.timer = down + tele - t;
  } else if (t < down + tele + up) {
    phase = 'firing';
    trap.timer = down + tele + up - t;
  } else {
    phase = 'cooldown';
    trap.timer = cycle - t; // 회수 잔여 — 모형이 이 값으로 천천히 내려간다
  }
  if (phase !== trap.phase) {
    const prev = trap.phase;
    trap.phase = phase;
    if (phase === 'telegraph') world.events.emit('trap_telegraph', at);
    else if (phase === 'firing') {
      trap.hitIds = [];
      world.events.emit('trap_fired', { ...at, dirX: trap.dirX, dirZ: trap.dirZ });
    } else if (phase === 'cooldown') {
      trap.hitIds = undefined;
      world.events.emit('trap_retract', at);
    } else if (phase === 'armed' && prev === 'cooldown') world.events.emit('trap_rearmed', at);
  }
  if (phase === 'firing') spikeContact(world, trap, cfg);
}

/** 자동 순환 다트 발사기 — 트리거 없이 idle → telegraph(노즐 달아오름) → 발사를 돈다.
 *  위상은 phaseOffset, 없으면 (row+col) 짝홀 반주기 — 복도에 줄지어 놓으면 순차 발사 회랑이 된다 */
function tickAutoDart(world: World, trap: TrapState, cfg: TrapCfg): void {
  const idle = Math.max(1, Math.round(cfg['idleTicks'] ?? 120));
  const tele = Math.max(1, Math.round(cfg['telegraphTicks'] ?? 30));
  const cycle = idle + tele;
  if (trap.cycleTick === undefined) {
    trap.cycleTick =
      ((trap.phaseOffset ?? ((trap.row + trap.col) % 2) * Math.floor(cycle / 2)) % cycle + cycle) % cycle;
    trap.phase = 'armed';
  }
  trap.cycleTick = (trap.cycleTick + 1) % cycle;
  const t = trap.cycleTick;
  const at = { id: trap.id, type: trap.type, x: trap.x, z: trap.z };
  if (t === idle) {
    trap.phase = 'telegraph';
    trap.timer = tele;
    world.events.emit('trap_telegraph', at);
  } else if (t === 0) {
    fireDarts(world, trap, cfg);
    trap.phase = 'armed';
    trap.timer = 0;
    world.events.emit('trap_fired', { ...at, dirX: trap.dirX, dirZ: trap.dirZ });
  } else if (trap.phase === 'telegraph') {
    trap.timer = cycle - t;
  }
}

/** 작동 뒤 — 장전이 남으면 쿨다운, 다 썼으면 spent */
function afterFire(world: World, trap: TrapState, cfg: TrapCfg): void {
  if (trap.charges > 0) trap.charges--;
  if (trap.charges === 0) {
    trap.phase = 'spent';
    trap.timer = 0;
    world.events.emit('trap_spent', { id: trap.id, type: trap.type, x: trap.x, z: trap.z });
    return;
  }
  trap.phase = 'cooldown';
  trap.timer = cfg['cooldownTicks'] ?? 0;
}

/** 다트 — -dir 쪽 벽의 노즐에서 dir 방향으로 부채꼴. 적 소유·반사 가능·오사 감쇄 없음 */
function fireDarts(world: World, trap: TrapState, cfg: TrapCfg): void {
  const cs = world.level.cellSize;
  const ox = trap.x - trap.dirX * (cs / 2 - 0.05);
  const oz = trap.z - trap.dirZ * (cs / 2 - 0.05);
  const count = Math.max(1, Math.round(cfg['dartCount'] ?? 1));
  const spread = ((cfg['spreadDeg'] ?? 0) * Math.PI) / 180;
  const speed = cfg['speed'] ?? 25;
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0 : i / (count - 1) - 0.5; // -0.5 .. 0.5
    const ang = spread * t;
    const dx = trap.dirX * Math.cos(ang) - trap.dirZ * Math.sin(ang);
    const dz = trap.dirX * Math.sin(ang) + trap.dirZ * Math.cos(ang);
    world.projectiles.push({
      id: nextTrapProjId++,
      owner: 'enemy',
      x: ox, y: cfg['dartHeight'] ?? 1.0, z: oz,
      prevX: ox, prevY: cfg['dartHeight'] ?? 1.0, prevZ: oz,
      vx: dx * speed, vy: 0, vz: dz * speed,
      lifeTicks: cfg['lifeTicks'] ?? 90,
      damage: cfg['damage'] ?? 0,
      burnTicks: 0,
      burnDamagePerTick: 0,
      radius: cfg['dartRadius'] ?? 0.12,
      kind: 'arrow',
      deflectable: true,
      trapShot: true,
    });
  }
}

/** 가시 접촉 — 가시가 서 있는 동안 매 틱. 반경 안에 '들어온' 몸에게 한 번씩 (나갔다 다시 오면 또).
 *  플레이어는 막기도 대시 무적도 소용없다 — 서 있는 쇠에 몸을 들이민 것. 그림자 이동만 면제.
 *  hitIds 가 '지금 안에 있고 이미 맞은 몸' 목록이다 (플레이어 = -1) */
function spikeContact(world: World, trap: TrapState, cfg: TrapCfg): void {
  const r = cfg['hitRadius'] ?? 1.5;
  const inside = (trap.hitIds ??= []);
  const p = world.player;
  const playerIn =
    !world.dead && (p.blinkLeft ?? 0) <= 0 && Math.hypot(p.x - trap.x, p.z - trap.z) <= r;
  if (playerIn && !inside.includes(-1)) {
    inside.push(-1);
    hurtPlayer(world, trap, cfg['damage'] ?? 0, { blockable: false, source: 'trap_spike', ignoreIframes: true });
  } else if (!playerIn && inside.includes(-1)) {
    inside.splice(inside.indexOf(-1), 1);
  }
  for (const enemy of world.enemies) {
    const has = inside.includes(enemy.id);
    const enemyIn = canTriggerTrap(enemy) && Math.hypot(enemy.x - trap.x, enemy.z - trap.z) <= r;
    if (enemyIn && !has) {
      inside.push(enemy.id);
      hurtEnemy(world, trap, enemy, cfg['enemyDamage'] ?? 0, cfg);
    } else if (!enemyIn && has) {
      inside.splice(inside.indexOf(enemy.id), 1);
    }
  }
}

/** 작동 — 종별 효과 → 소음 → 다음 phase. 돌려주는 값은 '작동 중(firing)'으로 보여 줄 틱 수 */
function fire(world: World, trap: TrapState, cfg: TrapCfg): void {
  let firingTicks = 0;
  switch (trap.type) {
    case 'trap_dart':
      fireDarts(world, trap, cfg);
      break;
    case 'trap_spike':
      trap.hitIds = [];
      spikeContact(world, trap, cfg); // 솟는 순간 위에 있던 몸
      firingTicks = cfg['upTicks'] ?? 0; // 가시가 서 있는 시간 — 이 동안 들어오면 맞는다
      break;
    case 'trap_net':
      fireNet(world, trap, cfg);
      firingTicks = cfg['dropTicks'] ?? 0; // 그물이 떨어지는 연출 시간
      break;
    case 'trap_glyph':
      fireGlyph(world, trap, cfg);
      break;
    case 'trap_gas':
      firingTicks = cfg['cloudTicks'] ?? 0; // 구름이 도는 동안 tick 이 매 틱 효과를 준다
      break;
    case 'trap_rockfall':
      fireRockfall(world, trap, cfg);
      break;
    default:
      break;
  }
  if ((cfg['noiseRadius'] ?? 0) > 0) {
    alertNearbyAt(world, trap.x, trap.z, cfg['noiseRadius'] ?? 0, balance.enemyAi.noticeDelayTicks);
  }
  world.events.emit('trap_fired', {
    id: trap.id, type: trap.type, x: trap.x, z: trap.z, dirX: trap.dirX, dirZ: trap.dirZ,
  });
  if (firingTicks > 0) {
    trap.phase = 'firing';
    trap.timer = firingTicks;
  } else {
    afterFire(world, trap, cfg);
  }
}

/** 함정 감지 각인 — 반경 안에 들어온 함정을 알아챈다. 한 번 알아챈 것은 계속 안다 */
function revealTraps(world: World): void {
  const r = world.modifiers.revealTrapsRadius;
  if (r <= 0) return;
  const p = world.player;
  for (const trap of world.traps) {
    if (trap.revealed || trap.phase === 'spent' || trap.phase === 'disarmed') continue;
    if (Math.hypot(trap.x - p.x, trap.z - p.z) > r) continue;
    trap.revealed = true;
    world.events.emit('trap_revealed', { id: trap.id, type: trap.type, x: trap.x, z: trap.z });
  }
}

/** 구독. 시작 시 1회 — 기름에 불이 붙는 순간(어디서 붙었든) 불길 소리에 방이 깬다 */
export function init(world: World): void {
  world.events.on('trap_ignited', (payload) => {
    const info = payload as { x: number; z: number };
    const cfg = trapCfg('trap_oil');
    alertNearbyAt(world, info.x, info.z, cfg?.['noiseRadius'] ?? 0, balance.enemyAi.noticeDelayTicks);
  });
}

export function tick(world: World, _dt: number): void {
  revealTraps(world);
  tickDots(world);
  for (const trap of world.traps) {
    const cfg = trapCfg(trap.type);
    if (!cfg) continue;
    if (trap.type === 'trap_oil') {
      tickOil(world, trap, cfg); // 밟는 트리거가 없다 — 불이 트리거다
      continue;
    }
    if (trap.type === 'trap_pendulum') {
      tickPendulum(world, trap, cfg); // 트리거 없이 항시 흔들린다
      continue;
    }
    if (trap.type === 'trap_spike_auto') {
      tickAutoSpike(world, trap, cfg); // 트리거 없이 순환한다
      continue;
    }
    if (trap.type === 'trap_dart_auto') {
      tickAutoDart(world, trap, cfg); // 트리거 없이 주기마다 쏜다
      continue;
    }
    switch (trap.phase) {
      case 'armed': {
        const by = victimInRadius(world, trap, cfg['triggerRadius'] ?? 1.2);
        if (!by) break;
        trap.triggeredBy = by;
        world.events.emit('trap_triggered', { id: trap.id, type: trap.type, x: trap.x, z: trap.z, by });
        const tele = cfg['telegraphTicks'] ?? 0;
        if (tele > 0) {
          trap.phase = 'telegraph';
          trap.timer = tele;
          world.events.emit('trap_telegraph', { id: trap.id, type: trap.type, x: trap.x, z: trap.z });
        } else {
          fire(world, trap, cfg);
        }
        break;
      }
      case 'telegraph':
        if (--trap.timer <= 0) fire(world, trap, cfg);
        break;
      case 'firing':
        if (trap.type === 'trap_gas') tickGasCloud(world, trap, cfg);
        if (trap.type === 'trap_spike') spikeContact(world, trap, cfg);
        if (--trap.timer <= 0) {
          trap.hitIds = undefined;
          // 작동이 끝난다 — 가시가 들어가고, 구름이 걷힌다 (소리는 main 이 종별로)
          world.events.emit('trap_retract', { id: trap.id, type: trap.type, x: trap.x, z: trap.z });
          afterFire(world, trap, cfg);
        }
        break;
      case 'cooldown':
        if (--trap.timer <= 0) {
          trap.phase = 'armed';
          trap.timer = 0;
          world.events.emit('trap_rearmed', { id: trap.id, type: trap.type, x: trap.x, z: trap.z });
        }
        break;
      default:
        break; // spent / disarmed
    }
  }
}
