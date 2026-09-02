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
  type EnemyState,
  type TrapState,
  type World,
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
  // 그림자 질주 중엔 무게가 없다 — 판이 눌리지 않는다
  if (!world.dead && (p.blinkLeft ?? 0) <= 0 && Math.hypot(p.x - trap.x, p.z - trap.z) <= radius) {
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
  opt: { blockable: boolean; source: string; knockback?: number; knockbackTicks?: number },
): void {
  const p = world.player;
  if (world.dead || p.iframeTicks > 0) return;
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
  const interval = Math.max(1, cfg['playerDamageIntervalTicks'] ?? 30);
  if (trap.timer % interval === 0 && Math.hypot(p.x - trap.x, p.z - trap.z) <= r) {
    hurtPlayer(world, trap, cfg['playerDamagePerHit'] ?? 0, { blockable: false, source: 'trap_fire' });
  }
  // 옮겨붙기 — 근처의 안 붙은 기름
  igniteOilInRadius(world, trap.x, trap.z, cfg['chainRadius'] ?? 0, cfg['burnTicks'] ?? 0);
  if (--trap.timer <= 0) {
    trap.phase = 'spent';
    trap.timer = 0;
    world.events.emit('trap_spent', { id: trap.id, type: trap.type, x: trap.x, z: trap.z });
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

/** 가시 — 반경 안 전원. 플레이어는 아래서 오는 공격이라 막을 수 없다 (회피 무적만) */
function fireSpikes(world: World, trap: TrapState, cfg: TrapCfg): void {
  const r = cfg['hitRadius'] ?? 1.5;
  const p = world.player;
  if (Math.hypot(p.x - trap.x, p.z - trap.z) <= r) {
    hurtPlayer(world, trap, cfg['damage'] ?? 0, { blockable: false, source: 'trap_spike' });
  }
  for (const enemy of world.enemies) {
    if (!canTriggerTrap(enemy)) continue;
    if (Math.hypot(enemy.x - trap.x, enemy.z - trap.z) > r) continue;
    hurtEnemy(world, trap, enemy, cfg['enemyDamage'] ?? 0, cfg);
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
      fireSpikes(world, trap, cfg);
      firingTicks = cfg['upTicks'] ?? 0; // 가시가 솟아 있는 시간 — 모형이 따라간다
      break;
    case 'trap_net':
      fireNet(world, trap, cfg);
      firingTicks = cfg['dropTicks'] ?? 0; // 그물이 떨어지는 연출 시간
      break;
    case 'trap_glyph':
      fireGlyph(world, trap, cfg);
      break;
    default:
      break;
  }
  alertNearbyAt(world, trap.x, trap.z, cfg['noiseRadius'] ?? 0, balance.enemyAi.noticeDelayTicks);
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

/** 구독. 시작 시 1회 — 기름에 불이 붙는 순간(어디서 붙었든) 불길 소리에 방이 깬다 */
export function init(world: World): void {
  world.events.on('trap_ignited', (payload) => {
    const info = payload as { x: number; z: number };
    const cfg = trapCfg('trap_oil');
    alertNearbyAt(world, info.x, info.z, cfg?.['noiseRadius'] ?? 0, balance.enemyAi.noticeDelayTicks);
  });
}

export function tick(world: World, _dt: number): void {
  for (const trap of world.traps) {
    const cfg = trapCfg(trap.type);
    if (!cfg) continue;
    if (trap.type === 'trap_oil') {
      tickOil(world, trap, cfg); // 밟는 트리거가 없다 — 불이 트리거다
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
        if (--trap.timer <= 0) afterFire(world, trap, cfg);
        break;
      case 'cooldown':
        if (--trap.timer <= 0) {
          trap.phase = 'armed';
          trap.timer = 0;
        }
        break;
      default:
        break; // spent / disarmed
    }
  }
}
