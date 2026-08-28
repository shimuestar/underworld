// 구울 머리 — 목이 날아간 머리가 사라지지 않고 통통 튀며 돌아다니는 소품.
// 총(히트스캔)·화살(스윕)·해머(호)가 부수며, 아주 가까이서 해머를 휘두르면
// 밟아 터트리는 연출(stomp)이 된다 — 판정은 Weapons/Projectiles 가 하고
// (core/World.breakGhoulHead 규약), 여기는 스폰과 튀는 물리만 맡는다.

import { balance } from '../core/Balance';
import { breakGhoulHead, type World } from '../core/World';

let nextHeadId = 980000; // 비석(960000)·열쇠(950000) 대역과 구분

/** 구독. 시작 시 1회 — 구울이 목이 날아가는 방식으로 죽으면 머리가 소품으로 남는다 */
export function init(world: World): void {
  const spawn = (payload: unknown): void => {
    const kill = payload as { enemyType?: string; x?: number; z?: number };
    if (kill.enemyType !== 'ghoul' || kill.x === undefined || kill.z === undefined) return;
    const cfg = balance.ghoulHead;
    const heads = (world.ghoulHeads ??= []);
    // 죽인 사람 반대쪽(뒤)으로 날아간다 — 콤보 호 밖으로 빠져나가야 연타에 안 지워진다
    const p = world.player;
    const adx = kill.x - p.x;
    const adz = kill.z - p.z;
    const ad = Math.hypot(adx, adz);
    const ang = ad > 0.001 ? Math.atan2(adx, adz) : Math.random() * Math.PI * 2;
    const jitter = (Math.random() - 0.5) * 0.6;
    const speed = cfg.launchSpeedMin + Math.random() * cfg.launchSpeedSpan;
    heads.push({
      id: nextHeadId++,
      x: kill.x,
      z: kill.z,
      y: 1.4, // 어깨 높이에서 떨어져 나온다
      vy: cfg.hopVyMin + Math.random() * cfg.hopVySpan,
      vx: Math.sin(ang + jitter) * speed,
      vz: Math.cos(ang + jitter) * speed,
      graceTicks: cfg.spawnGraceTicks,
    });
    // 상한 — 넘치면 가장 오래된 머리가 조용히 터진다
    if (heads.length > cfg.max) {
      const oldest = heads[0]!;
      breakGhoulHead(world, oldest.id, false);
    }
  };
  world.events.on('melee_kill', spawn);
  world.events.on('headshot_kill', spawn);
}

export function tick(world: World, dt: number): void {
  const heads = world.ghoulHeads;
  if (!heads || heads.length === 0) return;
  const cfg = balance.ghoulHead;
  for (const head of heads) {
    if ((head.graceTicks ?? 0) > 0) head.graceTicks = (head.graceTicks ?? 0) - 1;
    // 수직 — 포물선. 땅에 닿으면 새 방향으로 다시 뛰어오른다 (영원히 통통)
    head.y += head.vy * dt;
    head.vy -= cfg.gravity * dt;
    if (head.y <= cfg.radius && head.vy < 0) {
      head.y = cfg.radius;
      head.vy = cfg.hopVyMin + Math.random() * cfg.hopVySpan;
      const ang = Math.random() * Math.PI * 2;
      const speed = cfg.moveSpeedMin + Math.random() * cfg.moveSpeedSpan;
      head.vx = Math.sin(ang) * speed;
      head.vz = Math.cos(ang) * speed;
      world.events.emit('ghoul_head_hop', { x: head.x, z: head.z });
    }
    // 수평 — 벽은 밀어내며 미끄러진다 (slideMove 는 {x,z,prevX,prevZ} 만 요구한다)
    const proxy = { x: head.x, z: head.z, prevX: head.x, prevZ: head.z };
    world.level.slideMove(proxy, cfg.radius, head.vx * dt, head.vz * dt);
    head.x = proxy.x;
    head.z = proxy.z;
  }
}
