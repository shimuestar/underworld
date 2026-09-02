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

/** 구독 자리 — 지금은 없음. 이벤트 구독이 필요한 종(기름 점화 등)이 오면 여기 */
export function init(_world: World): void {}

export function tick(world: World, _dt: number): void {
  for (const trap of world.traps) {
    const cfg = trapCfg(trap.type);
    if (!cfg) continue;
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
