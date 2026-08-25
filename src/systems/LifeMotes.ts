// 생명 입자 — 적이 죽으면 그 자리에 흩뿌려지고, 플레이어가 가까이 가면 빨려 들어와
// HP 를 조금 채운다. 멀리서 죽이면 그 자리에 남았다가 lifeTicks 뒤 사라진다.
// 수치는 전부 balance.lifeMotes. 회복은 흡수된 틱에 한 번에 더한다.

import { balance } from '../core/Balance';
import { enemyDef } from '../core/Entities';
import type { World } from '../core/World';

let nextId = 1;

/** 처치 구독. 시작 시 1회 호출 */
export function init(world: World): void {
  world.events.on('enemy_died', (payload) => {
    const { enemyType, x, z } = payload as { enemyType: string; x: number; z: number };
    spawn(world, enemyType, x, z);
  });
}

/** 체급에 따라 몇 개를 흩뿌린다 — 무거운 적일수록 많이 */
export function spawn(world: World, enemyType: string, x: number, z: number): void {
  const cfg = balance.lifeMotes;
  const count = cfg.countByWeight[enemyDef(enemyType).weight] ?? cfg.countByWeight.light;
  for (let i = 0; i < count; i++) {
    const ang = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * cfg.scatterRadius; // 원판에 고르게
    world.lifeMotes.push({
      id: nextId++,
      x: x + Math.cos(ang) * r,
      y: cfg.hoverHeight + Math.random() * 0.4,
      z: z + Math.sin(ang) * r,
      ageTicks: 0,
      homing: false,
      speed: 0,
    });
  }
  world.events.emit('life_motes_spawned', { count, x, z });
}

export function tick(world: World, dt: number): void {
  const cfg = balance.lifeMotes;
  const p = world.player;
  let absorbed = 0;
  let expired = 0;
  for (let i = world.lifeMotes.length - 1; i >= 0; i--) {
    const m = world.lifeMotes[i]!;
    const dx = p.x - m.x;
    const dz = p.z - m.z;
    const dist = Math.hypot(dx, dz);
    if (!m.homing && dist <= cfg.magnetRadius) m.homing = true;

    if (m.homing) {
      if (dist <= cfg.absorbRadius) {
        world.lifeMotes.splice(i, 1);
        absorbed++;
        continue;
      }
      // 점점 빨라지며 가슴께로 모인다. 빨려드는 동안은 늙지 않는다 — 코앞에서 꺼지면 억울하다
      m.speed = Math.min(cfg.magnetSpeed, m.speed + cfg.magnetAccel);
      const step = Math.min(dist, m.speed * dt);
      m.x += (dx / dist) * step;
      m.z += (dz / dist) * step;
      m.y += (cfg.absorbHeight - m.y) * 0.15;
      continue;
    }

    m.ageTicks++;
    if (m.ageTicks >= cfg.lifeTicks) {
      world.lifeMotes.splice(i, 1);
      expired++;
    }
  }

  if (absorbed > 0) {
    const before = p.health;
    p.health = Math.min(balance.player.healthMax, p.health + absorbed * cfg.healPerMote);
    world.events.emit('life_mote_absorbed', { count: absorbed, healed: p.health - before });
  }
  if (expired > 0) world.events.emit('life_mote_expired', { count: expired });
}
