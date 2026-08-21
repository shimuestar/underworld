// 권총(9mm) — 세미오토 히트스캔. 탄창/예비탄, 장전, 총구 화염 상태를 관리한다.
//
// ⚠ 하드 룰: 총기로 적을 죽여도 마나 이벤트를 발행하지 않는다 (weapon_kill만).
//    두 자원 경제를 분리하는 유일한 규칙이다 — docs/systems/combat.md §5.

import { balance } from '../core/Balance';
import { enemyDef } from '../core/Entities';
import { rayVsAabb } from '../core/Ray';
import type { World } from '../core/World';

export function tick(world: World, _dt: number): void {
  const w = world.weapon;
  const pistol = balance.weapons.pistol;

  if (w.muzzleFlash > 0) w.muzzleFlash--;
  if (w.cooldown > 0) w.cooldown--;

  // 경직/회피 대시 중에는 사격·장전 불가
  if (world.player.stunTicks > 0 || world.player.dodgeTicks > 0) return;

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

  if (world.input.reload && w.mag < pistol.magSize && w.reserve > 0) {
    startReload(world);
    return;
  }

  if (!world.input.firePressed) return;

  if (w.mag === 0) {
    // 빈 탄창 — 예비탄이 있으면 자동 장전, 없으면 불발
    if (w.reserve > 0) startReload(world);
    else world.events.emit('weapon_empty');
    return;
  }

  if (w.cooldown > 0) return;

  fire(world);
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

  // 정면 방패 — 전방 호 안에서 맞은 투사체는 무효 (스태거 중에는 방패 무력화)
  if (hit) {
    const def = enemyDef(hit.enemy.type);
    if (def.frontalShieldBlocksProjectiles && hit.enemy.ai !== 'staggered') {
      const facingX = -Math.sin(hit.enemy.yaw);
      const facingZ = -Math.cos(hit.enemy.yaw);
      const toPlayerX = p.x - hit.enemy.x;
      const toPlayerZ = p.z - hit.enemy.z;
      const len = Math.hypot(toPlayerX, toPlayerZ);
      const dot = len > 0 ? (facingX * toPlayerX + facingZ * toPlayerZ) / len : 1;
      const halfArcCos = Math.cos(((def.shieldArcDeg ?? 120) / 2) * (Math.PI / 180));
      if (dot >= halfArcCos) {
        world.events.emit('shot_blocked', { enemyId: hit.enemy.id, enemyType: hit.enemy.type });
        world.events.emit('shot_fired', {
          sx: p.x, sy: oy, sz: p.z,
          ex: p.x + dx * hit.t, ey: oy + dy * hit.t, ez: p.z + dz * hit.t,
          hitEnemy: false,
        });
        return;
      }
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

  hit.enemy.health -= pistol.damage;
  if (hit.enemy.health <= 0) {
    hit.enemy.alive = false;
    // 총기 처치는 마나 0 — 여기서 마나 이벤트를 발행하지 않는다 (하드 룰)
    world.events.emit('weapon_kill', { weapon: 'pistol', enemyType: hit.enemy.type });
  } else {
    world.events.emit('enemy_damaged', {
      enemyId: hit.enemy.id,
      enemyType: hit.enemy.type,
      health: hit.enemy.health,
    });
  }
}
