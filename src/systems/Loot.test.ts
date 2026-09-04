// 전리품 주머니 — 굴림(결정적), 드랍·병합, 바라보기·E 열기·재오픈 가드, 가져오기 규칙
// (골드 전부 / 화살 상한 / 소모품 가방 자리), 모두 가져오기, 넣기, 바닥에 버리기, 닫기.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { balance } from '../core/Balance';
import { Events } from '../core/Events';
import { Input } from '../core/Input';
import { addItem, countOf, initInventory } from '../core/Inventory';
import { World, type GroundItemState, type LootEntry } from '../core/World';
import { enemyDef } from '../core/Entities';
import { Level } from '../level/GridLoader';
import * as Loot from './Loot';
import * as Sigils from './Sigils';

const DT = 1 / 60;
const cfg = balance.pickups;
const L = balance.loot;

function makeWorld(): World {
  const level = new Level({
    id: 'arena', name: 'arena', cellSize: 4, ceiling: 4,
    grid: ['########', '#S.....#', '#......#', '#......#', '########'],
    lighting: { ambient: 0.04, torches: [] },
  });
  return new World(new Events(), {
    input: Input.emptySnapshot(),
    player: {
      x: 10, y: 0, z: 10, prevX: 10, prevY: 0, prevZ: 10,
      yaw: 0, pitch: 0, health: balance.player.healthMax, // yaw 0 → -Z 를 본다
      stunTicks: 0, dodgeTicks: 0, dodgeDirX: 0, dodgeDirZ: 0,
      iframeTicks: 0, reactionBufferTicks: 0, blocking: false, reactionHeldTicks: 0,
    },
    lantern: { on: true, battery: 100, spares: 0 },
    weapon: { melee: 'hammer', ranged: 'pistol', mag: 12, reserve: 60, cooldown: 0, reloading: 0, muzzleFlash: 0, grenades: 3, meleeCooldown: 0, grenadeCharge: 0, comboStep: 0, comboTimer: 0, swingImpact: 0, swingHeavy: false },
    mana: { value: 0, chainIndex: 0, outOfCombatTicks: 0, inCombat: false },
    sigils: {
      inventory: [],
      equipped: { eye: null, rightArm: null, leftArm: null, heart: null, spine: null },
    },
    modifiers: Sigils.defaultModifiers(),
    corruption: { applied: 0, pending: 0 },
    enemies: [],
    level,
  });
}

let world: World;
beforeEach(() => {
  world = makeWorld();
  initInventory(world);
});
afterEach(() => {
  vi.restoreAllMocks();
});

/** 가방을 빈틈없이 채운다 (Pickups.test 와 같은 헬퍼) */
function fillBag(w: World): void {
  const kinds = ['potion', 'mana', 'food'] as const;
  const stackMax = balance.items.stackMax;
  const total = w.inventory.length * stackMax;
  for (let i = 0; i < total; i++) {
    if (!addItem(w, kinds[Math.floor(i / stackMax) % kinds.length]!)) break;
  }
  if (!w.inventory.every((s) => s !== null && s.count === stackMax)) throw new Error('가방을 못 채웠다');
}

let nextTestId = 4242000;
function pouchAt(w: World, x: number, z: number, entries: LootEntry[], settle = 0, searched = true): GroundItemState {
  // 이전 규칙 테스트는 이미 뒤진(밝혀진) 칸을 전제한다 — 뒤지기 자체는 아래 '뒤지기' 블록이 본다
  if (searched) for (const e of entries) e.searched = true;
  const p: GroundItemState = {
    id: nextTestId++, kind: 'pouch', x, z, pouchItems: entries, pouchTier: 'normal', pouchOwner: 'goblin_runner',
    noMagnetTicks: settle,
  };
  w.groundItems.push(p);
  return p;
}
function openPouch(w: World, p: GroundItemState): void {
  w.lootOpen = { kind: 'pouch', id: p.id };
}
function tickLoot(w: World, n: number, interact = false): void {
  for (let i = 0; i < n; i++) {
    w.input = { ...Input.emptySnapshot(), interactPressed: interact };
    Loot.tick(w, DT);
  }
}
const kindsOf = (entries: LootEntry[]): string[] => entries.map((e) => e.kind);

describe('처치 전리품 굴림 (rollLoot)', () => {
  it('굴림이 확률 안이면 물약·마나·음식·골드가 한 줄씩 — 골드는 최소치', () => {
    const entries = Loot.rollLoot('goblin_runner', () => 0.01);
    expect(kindsOf(entries)).toEqual(expect.arrayContaining(['potion', 'mana', 'food', 'gold']));
    expect(entries.find((e) => e.kind === 'gold')!.count).toBe(cfg.gold.min);
  });

  it('빗나가면 빈 배열 — 주머니가 떨어지지 않는다', () => {
    expect(Loot.rollLoot('goblin_runner', () => 0.99)).toEqual([]);
  });

  it('보스는 확률과 무관하게 물약·마나 확정 + 골드 ×배율', () => {
    const entries = Loot.rollLoot('goblin_chieftain', () => 0.99);
    expect(kindsOf(entries)).toEqual(expect.arrayContaining(['potion', 'mana', 'gold']));
    expect(entries.find((e) => e.kind === 'gold')!.count).toBe(cfg.gold.max * cfg.gold.bossMul);
  });
});

describe('주머니 드랍', () => {
  it('처치하면 주머니 하나가 플레이어 반대쪽에 떨어지고, 안착 시간 동안 손댈 수 없다', () => {
    Loot.init(world);
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const ev: { merged: boolean }[] = [];
    world.events.on('pouch_dropped', (p) => ev.push(p as { merged: boolean }));
    world.events.emit('enemy_died', { enemyType: 'goblin_runner', x: 14, z: 10 });
    const pouches = world.groundItems.filter((g) => g.kind === 'pouch');
    expect(pouches).toHaveLength(1);
    expect(world.groundItems.filter((g) => g.kind !== 'pouch')).toHaveLength(0); // 아이템이 따로 흩어지지 않는다
    const p = pouches[0]!;
    // 시체에서 튀어올라 안착점으로 — 처음엔 시체 자리, 중간엔 적 머리 높이, 끝엔 반대쪽(+X) 바닥
    expect(p.x).toBe(14);
    expect(p.y).toBe(L.pouch.launchY);
    expect(p.originX!).toBeGreaterThan(14); // 플레이어(10) 반대쪽으로 떨어질 자리
    const landing = { x: p.originX!, z: p.originZ! };
    tickLoot(world, L.pouch.settleTicks / 2);
    const head = enemyDef('goblin_runner').height;
    expect(p.y!).toBeGreaterThan(head * 0.85);
    expect(p.x).toBeGreaterThan(14);
    expect(p.x).toBeLessThan(landing.x);
    tickLoot(world, L.pouch.settleTicks / 2);
    expect(p.y).toBeUndefined();
    expect(p.x).toBe(landing.x);
    expect(p.z).toBe(landing.z);
    expect(p.noMagnetTicks).toBe(0);
    expect(kindsOf(p.pouchItems!)).toEqual(expect.arrayContaining(['potion', 'mana', 'food', 'gold']));
    expect(p.pouchOwner).toBe('goblin_runner');
    expect(p.pouchTier).toBe('normal');
    expect(ev).toEqual([expect.objectContaining({ merged: false })]);
  });

  it('noLoot 소환수는 주머니를 안 떨군다', () => {
    Loot.init(world);
    vi.spyOn(Math, 'random').mockReturnValue(0);
    world.events.emit('enemy_died', { enemyType: 'slime_small', x: 14, z: 10, noLoot: true });
    expect(world.groundItems).toHaveLength(0);
  });

  it('기본은 병합 없음 — 같은 자리에서 여럿을 죽여도 주머니가 각자 떨어지고 서로 minSpacing 이상 떨어진다', () => {
    Loot.init(world);
    vi.spyOn(Math, 'random').mockReturnValue(0.5); // 호 한가운데 — 같은 각도로 떨어지려 한다
    for (let i = 0; i < 4; i++) world.events.emit('enemy_died', { enemyType: 'goblin_runner', x: 14, z: 10 });
    const pouches = world.groundItems.filter((g) => g.kind === 'pouch');
    expect(pouches).toHaveLength(4);
    for (let i = 0; i < pouches.length; i++) {
      for (let j = i + 1; j < pouches.length; j++) {
        const a = pouches[i]!;
        const b = pouches[j]!;
        expect(Math.hypot(a.originX! - b.originX!, a.originZ! - b.originZ!)).toBeGreaterThanOrEqual(L.pouch.minSpacing - 1e-6);
      }
      expect(pouches[i]!.pouchOwner).toBe('goblin_runner'); // 섞이지 않는다
      // 벽 칸에 놓이지 않는다
      const cs = world.level.cellSize;
      expect(world.level.solidAt(Math.floor(pouches[i]!.originX! / cs), Math.floor(pouches[i]!.originZ! / cs))).toBe(false);
    }
  });

  it('mergeRadius 를 켜면 가까운 주머니에 합쳐진다 — 같은 종류면 이름 유지, 다른 종류면 전리품 주머니, 보스면 금빛', () => {
    const saved = L.pouch.mergeRadius;
    (L.pouch as { mergeRadius: number }).mergeRadius = 1.6;
    try {
      Loot.init(world);
      vi.spyOn(Math, 'random').mockReturnValue(0);
      world.events.emit('enemy_died', { enemyType: 'goblin_runner', x: 14, z: 10 });
      world.events.emit('enemy_died', { enemyType: 'goblin_runner', x: 14.5, z: 10 });
      let pouches = world.groundItems.filter((g) => g.kind === 'pouch');
      expect(pouches).toHaveLength(1);
      expect(pouches[0]!.pouchItems!.find((e) => e.kind === 'potion')!.count).toBe(2);
      expect(pouches[0]!.pouchOwner).toBe('goblin_runner');
      expect(pouches[0]!.noMagnetTicks).toBe(L.pouch.settleTicks); // 다시 안착 — 제자리에서 살짝 뛴다
      expect(pouches[0]!.bounceY0).toBe(L.pouch.mergeHop);
      world.events.emit('enemy_died', { enemyType: 'goblin_chieftain', x: 14.2, z: 10.3 });
      pouches = world.groundItems.filter((g) => g.kind === 'pouch');
      expect(pouches).toHaveLength(1);
      expect(pouches[0]!.pouchOwner).toBeUndefined(); // 섞였다
      expect(pouches[0]!.pouchTier).toBe('boss');
      expect(Loot.titleOf(world, { kind: 'pouch', id: pouches[0]!.id })).toBe('전리품 주머니');
      world.events.emit('enemy_died', { enemyType: 'goblin_runner', x: 24, z: 10 }); // mergeRadius 밖
      expect(world.groundItems.filter((g) => g.kind === 'pouch')).toHaveLength(2);
    } finally {
      (L.pouch as { mergeRadius: number }).mergeRadius = saved;
    }
  });

  it('보관 주머니도 이미 있는 주머니 위에 겹쳐 놓이지 않는다', () => {
    const a = Loot.createPlayerPouch(world);
    a.pouchItems = [{ kind: 'gold', count: 1, searched: true }]; // 비어 있지 않게 (비면 닫을 때 사라진다)
    Loot.closeLoot(world);
    const b = Loot.createPlayerPouch(world);
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThanOrEqual(L.pouch.minSpacing - 1e-6);
  });
});

describe('안착·보관 주머니', () => {
  it('안착이 끝나는 틱에 pouch_landed 가 한 번 난다 — 병합으로 다시 안착하면 다시 난다', () => {
    const p = pouchAt(world, 14, 10, [{ kind: 'gold', count: 1 }], L.pouch.settleTicks);
    const ev: unknown[] = [];
    world.events.on('pouch_landed', (x) => ev.push(x));
    tickLoot(world, L.pouch.settleTicks - 1);
    expect(ev).toHaveLength(0);
    tickLoot(world, 1);
    expect(ev).toEqual([{ id: p.id, x: 14, z: 10, tier: 'normal' }]);
    tickLoot(world, 10);
    expect(ev).toHaveLength(1);
    p.noMagnetTicks = L.pouch.settleTicks; // 병합 — 다시 안착
    tickLoot(world, L.pouch.settleTicks);
    expect(ev).toHaveLength(2);
  });

  it('가방 창의 보관 주머니 — 정면 발밑에 빈 주머니가 놓이고 곧장 열린다. 넣은 건 남고, 비운 채 닫으면 사라진다', () => {
    const ev: string[] = [];
    world.events.on('pouch_placed', () => ev.push('placed'));
    world.events.on('loot_opened', () => ev.push('opened'));
    addItem(world, 'potion');
    const pouch = Loot.createPlayerPouch(world);
    expect(ev).toEqual(['placed', 'opened']);
    expect(pouch.pouchOwner).toBe(Loot.PLAYER_OWNER);
    expect(Loot.titleOf(world, { kind: 'pouch', id: pouch.id })).toBe('내 주머니');
    expect(pouch.x).toBeCloseTo(10, 5);
    expect(pouch.z).toBeCloseTo(10 - L.pouch.placeAhead, 5); // yaw 0 → -Z 정면
    expect(world.lootOpen).toEqual({ kind: 'pouch', id: pouch.id });
    expect(Loot.stash(world, 0)).toBe(true);
    Loot.closeLoot(world);
    expect(world.groundItems.find((g) => g.id === pouch.id)?.pouchItems).toEqual([{ kind: 'potion', count: 1, searched: true }]);
    // 다시 열어 도로 가져가고 비운 채 닫으면 사라진다
    world.lootOpen = { kind: 'pouch', id: pouch.id };
    expect(Loot.takeOne(world, 0)).toBe('taken');
    Loot.closeLoot(world);
    expect(world.groundItems.find((g) => g.id === pouch.id)).toBeUndefined();
    expect(countOf(world, 'potion')).toBe(1);
  });
});

describe('바라보기·열기', () => {
  it('안착 전에는 대상이 아니고, 안착 뒤 정면 반경 안이면 lootInView — 등지면 아니다', () => {
    const p = pouchAt(world, 10, 8.5, [{ kind: 'gold', count: 5 }], L.pouch.settleTicks);
    tickLoot(world, 1);
    expect(world.lootInView).toBeNull();
    tickLoot(world, L.pouch.settleTicks);
    expect(world.lootInView).toEqual({ kind: 'pouch', id: p.id });
    world.player.yaw = Math.PI; // 등진다
    tickLoot(world, 1);
    expect(world.lootInView).toBeNull();
    world.player.yaw = 0;
    world.player.z = 10 + L.pouch.radius + 1; // 멀다
    tickLoot(world, 1);
    expect(world.lootInView).toBeNull();
  });

  it('조준 규칙 — 2m 밖이라도 크로스헤어를 주머니에 얹으면(aimArcDeg 안) aimRadius 까지 대상, 시선이 위면 아니다 (주머니 전용)', () => {
    const p = pouchAt(world, 10, 6, [{ kind: 'gold', count: 5 }]); // 정면 4m — 근접 반경(2.0) 밖
    tickLoot(world, 1);
    expect(world.lootInView).toBeNull(); // 수평 시선 — 주머니는 발밑 높이라 각이 벌어진다
    world.player.pitch = Math.atan2(L.pouch.aimHeight - balance.player.eyeHeight, 4); // 주머니를 내려다본다
    tickLoot(world, 1);
    expect(world.lootInView).toEqual({ kind: 'pouch', id: p.id });
    world.player.pitch += (L.pouch.aimArcDeg + 4) * (Math.PI / 180); // 각 밖으로
    tickLoot(world, 1);
    expect(world.lootInView).toBeNull();
    p.z = 10 - L.pouch.aimRadius - 1; // 너무 멀다
    world.player.pitch = Math.atan2(L.pouch.aimHeight - balance.player.eyeHeight, L.pouch.aimRadius + 1);
    tickLoot(world, 1);
    expect(world.lootInView).toBeNull();
  });

  it('E 를 누르면 열리고(lootOpen·loot_opened), 닫은 직후 같은 E 로는 다시 열리지 않는다', () => {
    const p = pouchAt(world, 10, 8.5, [{ kind: 'gold', count: 5 }]);
    const ev: unknown[] = [];
    world.events.on('loot_opened', (x) => ev.push(x));
    tickLoot(world, 1, true);
    expect(world.lootOpen).toEqual({ kind: 'pouch', id: p.id });
    expect(ev).toHaveLength(1);
    tickLoot(world, 3, true); // 열린 채로는 다시 안 연다
    expect(ev).toHaveLength(1);
    Loot.closeLoot(world);
    expect(world.lootOpen).toBeNull();
    tickLoot(world, 1, true); // 닫은 E 가 새 틱에 들어와도 가드가 막는다
    expect(world.lootOpen).toBeNull();
    tickLoot(world, L.pouch.reopenGuardTicks + 1, true);
    expect(world.lootOpen).toEqual({ kind: 'pouch', id: p.id });
    expect(ev).toHaveLength(2);
  });
});

describe('가져오기', () => {
  it('소모품은 가방으로 1개씩, 골드는 전부(gold_picked 는 컨테이너 자리), 화살은 화살통 상한까지 부분', () => {
    const p = pouchAt(world, 12, 8, [{ kind: 'potion', count: 2 }, { kind: 'gold', count: 7 }, { kind: 'arrow', count: 3 }]);
    openPouch(world, p);
    const golds: { amount: number; x: number; z: number }[] = [];
    world.events.on('gold_picked', (g) => golds.push(g as { amount: number; x: number; z: number }));
    const taken: { kind: string; count: number }[] = [];
    world.events.on('loot_taken', (t) => taken.push(t as { kind: string; count: number }));
    expect(Loot.takeOne(world, 0)).toBe('taken');
    expect(countOf(world, 'potion')).toBe(1);
    expect(p.pouchItems![0]!.count).toBe(1); // 한 개 남았다
    expect(Loot.takeOne(world, 1)).toBe('taken'); // 골드 — 전부
    expect(world.gold).toBe(7);
    expect(golds).toEqual([{ amount: 7, total: 7, x: 12, z: 8 }]);
    expect(kindsOf(p.pouchItems!)).toEqual(['potion', 'arrow']);
    world.weapon.arrows = balance.weapons.bow.ammoMax - 1;
    expect(Loot.takeOne(world, 1)).toBe('taken'); // 화살 — 한 대만 들어간다
    expect(world.weapon.arrows).toBe(balance.weapons.bow.ammoMax);
    expect(p.pouchItems![1]!.count).toBe(2);
    const denied: unknown[] = [];
    world.events.on('loot_denied', (d) => denied.push(d));
    expect(Loot.takeOne(world, 1)).toBe('quiver');
    expect(denied).toEqual([{ reason: 'quiver', kind: 'arrow' }]);
    expect(taken.map((t) => `${t.kind}:${t.count}`)).toEqual(['potion:1', 'gold:7', 'arrow:1']);
  });

  it('가방이 가득이면 소모품은 거부(loot_denied full) — 골드는 그래도 들어간다', () => {
    fillBag(world);
    const p = pouchAt(world, 12, 8, [{ kind: 'potion', count: 1 }, { kind: 'gold', count: 3 }]);
    openPouch(world, p);
    const denied: unknown[] = [];
    world.events.on('loot_denied', (d) => denied.push(d));
    expect(Loot.takeOne(world, 0)).toBe('full');
    expect(denied).toEqual([{ reason: 'full', kind: 'potion' }]);
    expect(Loot.takeOne(world, 1)).toBe('taken');
    expect(world.gold).toBe(3);
  });

  it('모두 가져오기 — 들어갈 만큼 가져오고 남은 것은 남는다, 거부 알림은 한 번', () => {
    fillBag(world);
    const p = pouchAt(world, 12, 8, [{ kind: 'potion', count: 2 }, { kind: 'food', count: 1 }, { kind: 'gold', count: 9 }]);
    openPouch(world, p);
    const denied: unknown[] = [];
    world.events.on('loot_denied', (d) => denied.push(d));
    const res = Loot.takeAll(world);
    expect(res.taken).toBe(9);
    expect(res.leftover).toBe(3);
    expect(res.denied).toBe('full');
    expect(denied).toHaveLength(1);
    expect(world.gold).toBe(9);
    expect(kindsOf(p.pouchItems!)).toEqual(['potion', 'food']);
  });

  it('모두 가져오기 — 자리가 있으면 전부 비운다', () => {
    const p = pouchAt(world, 12, 8, [{ kind: 'potion', count: 2 }, { kind: 'mana', count: 1 }, { kind: 'gold', count: 4 }]);
    openPouch(world, p);
    const res = Loot.takeAll(world);
    expect(res).toEqual({ taken: 7, leftover: 0, denied: null });
    expect(p.pouchItems).toEqual([]);
    expect(countOf(world, 'potion')).toBe(2);
    expect(countOf(world, 'mana')).toBe(1);
    expect(world.gold).toBe(4);
  });
});

describe('뒤지기 (타르코프식 한 칸씩 밝히기)', () => {
  it('처치 전리품은 처음엔 모르는 칸 — 밝혀지기 전엔 가져가기·모두·버리기가 안 된다', () => {
    const p = pouchAt(world, 12, 8, [{ kind: 'potion', count: 1 }, { kind: 'gold', count: 5 }], 0, false);
    openPouch(world, p);
    expect(p.pouchItems!.every((e) => !e.searched)).toBe(true);
    expect(Loot.takeOne(world, 0)).toBe('none');
    expect(Loot.takeAll(world)).toEqual({ taken: 0, leftover: 6, denied: null });
    expect(Loot.dropToFloor(world, 'container', 1)).toBe(false);
    expect(world.gold).toBe(0);
  });

  it('revealEntry 가 칸을 밝히고 loot_revealed 를 낸다 — 그 뒤엔 가져갈 수 있다. 두 번 밝혀도 한 번만', () => {
    const p = pouchAt(world, 12, 8, [{ kind: 'gold', count: 5 }, { kind: 'mana', count: 1 }], 0, false);
    openPouch(world, p);
    const ev: unknown[] = [];
    world.events.on('loot_revealed', (x) => ev.push(x));
    Loot.revealEntry(world, p.pouchItems![0]!);
    Loot.revealEntry(world, p.pouchItems![0]!);
    expect(ev).toEqual([{ kind: 'gold', count: 5, sigilId: undefined }]);
    expect(Loot.takeOne(world, 0)).toBe('taken');
    expect(world.gold).toBe(5);
    expect(Loot.takeAll(world).taken).toBe(0); // 마나는 아직 모른다
    Loot.revealEntry(world, p.pouchItems![0]!);
    expect(Loot.takeAll(world).taken).toBe(1);
  });

  it('내가 넣은 것은 바로 보이고, 모르는 같은 종류 칸에 넣으면 그 칸이 밝혀진다', () => {
    addItem(world, 'potion');
    addItem(world, 'potion');
    const p = pouchAt(world, 12, 8, [{ kind: 'potion', count: 1 }], 0, false);
    openPouch(world, p);
    expect(Loot.stash(world, 0)).toBe(true);
    expect(p.pouchItems).toEqual([{ kind: 'potion', count: 2, searched: true }]);
    Loot.createPlayerPouch(world);
    expect(Loot.stash(world, 0)).toBe(true);
    const mine = world.groundItems.find((g) => g.kind === 'pouch' && g.pouchOwner === Loot.PLAYER_OWNER)!;
    expect(mine.pouchItems![0]!.searched).toBe(true);
  });

  it('처치 드랍의 칸은 모두 모르는 상태로 시작한다', () => {
    const entries = Loot.rollLoot('goblin_runner', () => 0.01);
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every((e) => !e.searched)).toBe(true);
  });
});

describe('넣기·버리기·닫기', () => {
  it('내 가방 칸에서 컨테이너로 1개 — 5개 무더기는 4개가 되고 컨테이너 줄에 합쳐진다, 빈 칸은 false', () => {
    for (let i = 0; i < 5; i++) addItem(world, 'potion');
    const p = pouchAt(world, 12, 8, [{ kind: 'potion', count: 1 }]);
    openPouch(world, p);
    const ev: unknown[] = [];
    world.events.on('loot_stashed', (x) => ev.push(x));
    expect(Loot.stash(world, 0)).toBe(true);
    expect(world.inventory[0]!.count).toBe(4);
    expect(p.pouchItems).toEqual([{ kind: 'potion', count: 2, searched: true }]);
    expect(world.quickslots[0]).toBe('potion'); // 등록은 그대로
    expect(Loot.stash(world, 1)).toBe(false); // 빈 칸
    expect(ev).toEqual([{ kind: 'potion', count: 1, to: 'pouch' }]);
  });

  it('컨테이너 줄을 바닥에 버리면 단위별 바닥 아이템 — 물약 3개는 3개, 골드는 amount 하나, 버린 직후 유예', () => {
    const p = pouchAt(world, 12, 8, [{ kind: 'potion', count: 3 }, { kind: 'gold', count: 6 }]);
    openPouch(world, p);
    const ev: unknown[] = [];
    world.events.on('loot_dropped', (x) => ev.push(x));
    expect(Loot.dropToFloor(world, 'container', 0)).toBe(true);
    const potions = world.groundItems.filter((g) => g.kind === 'potion');
    expect(potions).toHaveLength(3);
    for (const g of potions) {
      expect(g.noMagnetTicks).toBe(balance.items.dropNoMagnetTicks);
      expect(Math.hypot(g.x - 12, g.z - 8)).toBeCloseTo(L.dropScatter, 5);
      expect(g.id).toBeGreaterThanOrEqual(1200000);
    }
    expect(Loot.dropToFloor(world, 'container', 0)).toBe(true); // 이제 0번이 골드
    const gold = world.groundItems.filter((g) => g.kind === 'gold');
    expect(gold).toHaveLength(1);
    expect(gold[0]!.amount).toBe(6);
    expect(p.pouchItems).toEqual([]);
    expect(ev).toEqual([
      { kind: 'potion', count: 3, from: 'container' },
      { kind: 'gold', count: 6, from: 'container' },
    ]);
  });

  it('가방 칸을 버리면 item_dropped 와 loot_dropped 가 함께 난다', () => {
    addItem(world, 'mana');
    addItem(world, 'mana');
    const p = pouchAt(world, 12, 8, []);
    openPouch(world, p);
    const ev: string[] = [];
    world.events.on('item_dropped', () => ev.push('item'));
    world.events.on('loot_dropped', (x) => ev.push(`loot:${(x as { from: string }).from}`));
    expect(Loot.dropToFloor(world, 'bag', 0)).toBe(true);
    expect(world.inventory[0]).toBeNull();
    expect(world.groundItems.filter((g) => g.kind === 'mana')).toHaveLength(2);
    expect(ev).toEqual(['item', 'loot:bag']);
  });

  it('닫을 때 빈 주머니는 사라지고, 남은 게 있으면 남는다 (loot_closed emptied)', () => {
    const empty = pouchAt(world, 12, 8, []);
    openPouch(world, empty);
    const ev: { emptied: boolean }[] = [];
    world.events.on('loot_closed', (x) => ev.push(x as { emptied: boolean }));
    Loot.closeLoot(world);
    expect(world.groundItems.find((g) => g.id === empty.id)).toBeUndefined();
    expect(world.lootReopenGuard).toBe(L.pouch.reopenGuardTicks);
    const full = pouchAt(world, 14, 8, [{ kind: 'gold', count: 1 }]);
    openPouch(world, full);
    Loot.closeLoot(world);
    expect(world.groundItems.find((g) => g.id === full.id)).toBeTruthy();
    expect(ev.map((e) => e.emptied)).toEqual([true, false]);
  });
});
