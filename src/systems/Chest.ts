// 보물상자 — E로 한 번 열면 골드 한 무더기와 각인 하나가 쏟아진다.
//
// 제단·문과 같은 상호작용 규약: 반경 안 + 상자를 보고 있어야 E가 먹는다
// (등지고 서 있는데 열리면 "왜 열렸지"가 된다).
// 전리품은 손에 바로 쥐여 주지 않고 바닥에 흩뿌린다 — 줍는 맛과 자석 연출을
// Pickups·Sigils 가 이미 갖고 있어서, 상자만의 획득 경로를 새로 만들 이유가 없다.

import { balance } from '../core/Balance';
import { sigilDef } from '../core/SigilData';
import sigilsJson from '../../data/sigils.json';
import type { ChestState, World } from '../core/World';

// 다른 드랍과 id 대역을 겹치지 않게 나눈다 (각인 1~ / 픽업 500000~)
let nextGoldId = 900000;
let nextSigilId = 800000;

export function tick(world: World, _dt: number): void {
  const cfg = balance.chest;
  const p = world.player;
  const fx = -Math.sin(p.yaw);
  const fz = -Math.cos(p.yaw);
  const arcCos = Math.cos((cfg.facingArcDeg * Math.PI) / 360);

  let target: ChestState | null = null;
  let best = Infinity;
  for (const chest of world.chests) {
    if (chest.opened) continue;
    const toX = chest.x - p.x;
    const toZ = chest.z - p.z;
    const dist = Math.hypot(toX, toZ);
    if (dist > cfg.radius || dist >= best) continue;
    if (dist > 0.001 && (toX * fx + toZ * fz) / dist < arcCos) continue;
    target = chest;
    best = dist;
  }
  world.chestInView = target;

  if (target && world.input.interactPressed) open(world, target);
}

export function open(world: World, chest: ChestState): void {
  if (chest.opened) return;
  const cfg = balance.chest;
  chest.opened = true;

  // 골드 — 한 덩어리로 주면 그냥 숫자가 오르고 끝이다. 여러 무더기로 쏟아
  // 자석이 하나씩 빨아들이는 그림을 만든다
  const span = Math.max(0, cfg.gold.max - cfg.gold.min);
  const total = cfg.gold.min + Math.round(Math.random() * span);
  const piles = Math.max(1, cfg.goldPiles);
  let left = total;
  for (let i = 0; i < piles; i++) {
    const amount = i === piles - 1 ? left : Math.round(total / piles);
    left -= amount;
    if (amount <= 0) continue;
    const angle = (i / piles) * Math.PI * 2 + Math.random() * 0.6;
    const r = cfg.scatterRadius * (0.4 + Math.random() * 0.6);
    world.groundItems.push({
      id: nextGoldId++,
      kind: 'gold',
      amount,
      x: chest.x + Math.cos(angle) * r,
      z: chest.z + Math.sin(angle) * r,
    });
  }

  // 각인 하나 — 아직 없는 것 중에서 뽑는다
  const sigilId = rollSigil(world);
  if (sigilId) {
    world.groundItems.push({
      id: nextSigilId++,
      kind: 'sigil',
      sigilId,
      x: chest.x,
      z: chest.z + cfg.scatterRadius * 0.5,
    });
    world.events.emit('sigil_dropped', { id: sigilId });
  }

  world.events.emit('chest_opened', {
    id: chest.id,
    x: chest.x,
    z: chest.z,
    gold: total,
    sigilId,
  });
}

/** 뽑을 각인 — 이미 가진 것은 뺀다. 이 빌드에서 실제로 효과가 도는
 *  slice 각인을 먼저 주고, 그게 다 떨어지면 나머지에서 뽑는다.
 *  (효과가 아직 없는 각인만 나오면 "상자를 열었는데 아무 일도 없다"가 된다) */
function rollSigil(world: World): string | null {
  const owned = new Set<string>(world.sigils.inventory);
  for (const id of Object.values(world.sigils.equipped)) if (id) owned.add(id);

  const all = (sigilsJson.sigils as { id: string }[]).map((s) => s.id);
  const fresh = all.filter((id) => !owned.has(id));
  if (fresh.length === 0) return null;
  const pool = fresh.filter((id) => sigilDef(id).slice);
  const from = pool.length > 0 ? pool : fresh;
  return from[Math.floor(Math.random() * from.length)] ?? null;
}
