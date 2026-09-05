// 보물상자 — E 로 뚜껑을 열면(1회 롤) 루팅 창이 열린다. 안에는 골드 한 줄과 각인 하나.
//
// 제단·문과 같은 상호작용 규약: 반경 안 + 상자를 보고 있어야 E가 먹는다
// (등지고 서 있는데 열리면 "왜 열렸지"가 된다).
// 2026-09-04: 바닥에 흩뿌리지 않는다 — 상자는 컨테이너다(chestItems). 가져가는 규칙은
// systems/Loot(takeOne·takeAll·stash·dropToFloor)이 주머니와 똑같이 처리하고, 각인 줄은
// 가져가는 순간 Sigils 가 loot_taken 을 받아 습득한다. 남긴 것은 상자에 그대로 있고,
// 다 비운 상자는 뚜껑 열린 채 남되 대상에서 빠진다. 부활해도 다시 잠기지 않는다.

import { balance } from '../core/Balance';
import { allEquipIds } from '../core/EquipData';
import { bagSigilIds, bagEquipIds } from '../core/Inventory';
import { sigilDef } from '../core/SigilData';
import sigilsJson from '../../data/sigils.json';
import type { ChestState, LootEntry, World } from '../core/World';

export function tick(world: World, _dt: number): void {
  const cfg = balance.chest;
  const p = world.player;
  const fx = -Math.sin(p.yaw);
  const fz = -Math.cos(p.yaw);
  const arcCos = Math.cos((cfg.facingArcDeg * Math.PI) / 360);

  let target: ChestState | null = null;
  let best = Infinity;
  for (const chest of world.chests) {
    if (chest.opened && (chest.chestItems?.length ?? 0) === 0) continue; // 다 비운 상자 — 열린 채 남는다
    const toX = chest.x - p.x;
    const toZ = chest.z - p.z;
    const dist = Math.hypot(toX, toZ);
    if (dist > cfg.radius || dist >= best) continue;
    if (dist > 0.001 && (toX * fx + toZ * fz) / dist < arcCos) continue;
    target = chest;
    best = dist;
  }
  world.chestInView = target;

  // 닫은 E 가 다음 틱에 도로 열지 않게 — 주머니와 같은 가드(Loot.closeLoot 가 건다)
  if (target && world.input.interactPressed && world.lootReopenGuard === 0) open(world, target);
}

/** 처음이면 뚜껑을 열고 안을 1회 롤한다. 언제든(남은 게 있으면) 루팅 창을 연다 */
export function open(world: World, chest: ChestState): void {
  if (world.lootOpen) return;
  const first = !chest.opened;
  if (first) {
    const cfg = balance.chest;
    chest.opened = true;
    const span = Math.max(0, cfg.gold.max - cfg.gold.min);
    const total = cfg.gold.min + Math.round(Math.random() * span);
    const entries: LootEntry[] = [{ kind: 'gold', count: total }];
    // 각인 하나 — 아직 없는 것 중에서 뽑는다. 가져가는 순간(loot_taken) Sigils 가 습득시킨다
    const sigilId = rollSigil(world);
    if (sigilId) entries.push({ kind: 'sigil', count: 1, sigilId });
    // 장비 하나 — chest.equipChance 로. 몸에 걸친 것·가방에 든 것은 뺀다 (2026-09-04)
    const equipId = rollEquip(world);
    if (equipId) entries.push({ kind: 'equip', count: 1, equipId });
    chest.chestItems = entries;
    world.events.emit('chest_opened', { id: chest.id, x: chest.x, z: chest.z, gold: total, sigilId, equipId });
  }
  world.lootOpen = { kind: 'chest', id: chest.id };
  world.events.emit('loot_opened', { kind: 'chest', id: chest.id, entries: chest.chestItems?.length ?? 0, first });
}

/** 뽑을 장비 — equipChance 안이면 하나. 몸에 걸친 것·가방에 든 것은 뺀다 */
function rollEquip(world: World): string | null {
  if (Math.random() >= balance.chest.equipChance) return null;
  const owned = new Set<string>([...Object.values(world.equipment).filter((v): v is string => !!v), ...bagEquipIds(world)]);
  const pool = allEquipIds().filter((id) => !owned.has(id));
  return pool[Math.floor(Math.random() * pool.length)] ?? null;
}

/** 뽑을 각인 — 이미 가진 것은 뺀다. 이 빌드에서 실제로 효과가 도는
 *  slice 각인을 먼저 주고, 그게 다 떨어지면 나머지에서 뽑는다.
 *  (효과가 아직 없는 각인만 나오면 "상자를 열었는데 아무 일도 없다"가 된다) */
function rollSigil(world: World): string | null {
  const owned = new Set<string>([...world.sigils.inventory, ...bagSigilIds(world)]); // 몸에 박힌 것 + 가방에 든 것

  const all = (sigilsJson.sigils as { id: string }[]).map((s) => s.id);
  const fresh = all.filter((id) => !owned.has(id));
  if (fresh.length === 0) return null;
  const pool = fresh.filter((id) => sigilDef(id).slice);
  const from = pool.length > 0 ? pool : fresh;
  return from[Math.floor(Math.random() * from.length)] ?? null;
}
