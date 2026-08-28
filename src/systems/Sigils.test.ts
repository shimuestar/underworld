// 각인·마법 검증 — 드랍, 부착 페널티/효과, 화염구 시전과 화상.

import { beforeEach, describe, expect, it } from 'vitest';
import { balance } from '../core/Balance';
import { Events } from '../core/Events';
import sigilsJson from '../../data/sigils.json';
import { sigilColor, sigilDef } from '../core/SigilData';
import { Input } from '../core/Input';
import { addItem, initInventory, spillInventoryToGrave } from '../core/Inventory';
import { enemyDef as enemyDef2 } from '../core/Entities';
import { World, type BarrelState, type EnemyState } from '../core/World';
import { Level } from '../level/GridLoader';
import { spawnEnemyAt } from '../level/Spawner';
import * as Enemies from './Enemies';
import * as Exit from './Exit';
import * as Mana from './Mana';
import * as Pickups from './Pickups';
import * as PlayerMove from './PlayerMove';
import * as Projectiles from './Projectiles';
import * as Sigils from './Sigils';

const DT = 1 / 60;

function makeWorld(): World {
  const level = new Level({
    id: 'arena',
    name: 'arena',
    cellSize: 4,
    ceiling: 4,
    grid: ['########', '#S.....#', '########'],
    lighting: { ambient: 0.04, torches: [] },
  });
  const world = new World(new Events(), {
    input: Input.emptySnapshot(),
    player: {
      x: 6, y: 0, z: 6, prevX: 6, prevY: 0, prevZ: 6,
      yaw: -Math.PI / 2, pitch: 0, health: 100, // +X를 바라봄
      stunTicks: 0, dodgeTicks: 0, dodgeDirX: 0, dodgeDirZ: 0,
      iframeTicks: 0, reactionBufferTicks: 0, blocking: false, reactionHeldTicks: 0,
    },
    lantern: { on: true, battery: 100, spares: 0 },
    weapon: { melee: 'hammer', ranged: 'pistol', mag: 12, reserve: 60, cooldown: 0, reloading: 0, muzzleFlash: 0, grenades: 3, meleeCooldown: 0, grenadeCharge: 0, comboStep: 0, comboTimer: 0, swingImpact: 0, swingHeavy: false },
    mana: { value: 100, chainIndex: 0, outOfCombatTicks: 0, inCombat: false },
    sigils: {
      inventory: [],
      equipped: { eye: null, rightArm: null, leftArm: null, heart: null, spine: null },
    },
    modifiers: Sigils.defaultModifiers(),
    corruption: { applied: 0, pending: 0 },
    enemies: [],
    level,
  });
  Sigils.init(world);
  Mana.init(world);
  Projectiles.init(world);
  return world;
}

function runnerAt(x: number, z: number): EnemyState {
  return {
    id: 1, type: 'goblin_runner', x, z, prevX: x, prevZ: z, yaw: 0,
    health: 30, alive: true, ai: 'chase', timer: 0,
    burnTicks: 0, burnDamagePerTick: 0,
  };
}

let world: World;
beforeEach(() => {
  world = makeWorld();
});

describe('각인 색', () => {
  it('24종이 전부 다른 색이다 — 바닥에서 색만 보고 구분한다', () => {
    const ids = (sigilsJson.sigils as { id: string }[]).map((s) => s.id);
    expect(ids).toHaveLength(24);
    const colors = ids.map((id) => sigilDef(id).color);
    expect(new Set(colors).size).toBe(ids.length);
    for (const c of colors) expect(c).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('sigilColor 는 같은 값을 숫자로 준다 (Three.js·CSS 공용)', () => {
    expect(sigilColor('sig_fireball')).toBe(
      Number.parseInt(sigilDef('sig_fireball').color.slice(1), 16),
    );
    expect(sigilColor('sig_fireball')).not.toBe(sigilColor('sig_dash'));
  });

  it('너무 어두운 색은 쓰지 않는다 — 랜턴 밖에서도 보여야 한다', () => {
    for (const s of sigilsJson.sigils as { id: string; color: string }[]) {
      const n = Number.parseInt(s.color.slice(1), 16);
      const lum = ((n >> 16) & 255) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114;
      expect(lum, s.id).toBeGreaterThan(70);
    }
  });
});

describe('스킬 드랍과 획득', () => {
  it('창병은 어떻게 죽이든 드랍 → 그 자리에 놓이고 접근하면 획득', () => {
    // 처형이 아니어도 (총·해머·오사 무엇이든) 사망하면 떨어진다
    world.events.emit('enemy_died', { enemyType: 'goblin_spear', x: 14, z: 6 });
    expect(world.groundItems).toHaveLength(1);
    expect(world.sigils.inventory).toHaveLength(0); // 아직 줍지 않음

    // 멀리 있는 동안은 획득하지 않는다
    Sigils.tick(world, DT);
    expect(world.sigils.inventory).toHaveLength(0);

    // 접근 → 자동 획득. 시전이 구현된 액티브라 곧바로 스킬 퀵슬롯 1(Z)에 올라간다
    world.player.x = 14 - balance.sigil.pickupRadius + 0.1;
    Sigils.tick(world, DT);
    expect(world.groundItems).toHaveLength(0);
    expect(world.sigils.inventory).toEqual(['sig_fireball']);
    expect(world.skillSlots[0]).toBe('sig_fireball');
  });

  it('처형으로 죽여도 한 번만 떨어진다 (melee_kill + enemy_died 중복 방지)', () => {
    world.events.emit('melee_kill', { enemyType: 'goblin_spear', execution: true, x: 14, z: 6 });
    world.events.emit('enemy_died', { enemyType: 'goblin_spear', x: 14, z: 6 });
    expect(world.groundItems).toHaveLength(1);
  });

  it('일반 근접 처치는 드랍 없음', () => {
    world.events.emit('melee_kill', { enemyType: 'goblin_spear', execution: false, x: 8, z: 6 });
    expect(world.groundItems).toHaveLength(0);
  });

  it('획득: 페널티는 없고 오염 pending 만 부위 비용만큼 누적된다', () => {
    Sigils.acquire(world, 'sig_fireball');
    expect(world.sigils.inventory).toContain('sig_fireball');
    expect(world.corruption.pending).toBe(balance.corruption.slotCost.rightArm);
  });

  it('액티브: 시전이 구현된 스킬은 빈 퀵슬롯에 바로 올라간다 — 다음 것은 다음 칸', () => {
    Sigils.acquire(world, 'sig_fireball');
    expect(world.skillSlots[0]).toBe('sig_fireball');
    Sigils.acquire(world, 'sig_frost');
    expect(world.skillSlots[1]).toBe('sig_frost');
    Sigils.acquire(world, 'sig_acid'); // 데이터만 있는 스킬 — 자동으로는 안 올라간다
    expect(world.skillSlots).not.toContain('sig_acid');
  });

  it('퀵슬롯 배치: 같은 스킬은 한 칸에만, 패시브·안 가진 스킬은 못 올린다, null 로 비운다', () => {
    Sigils.acquire(world, 'sig_fireball');
    expect(Sigils.assignSkill(world, 2, 'sig_fireball')).toBe(true);
    expect(world.skillSlots[0]).toBeNull();
    expect(world.skillSlots[2]).toBe('sig_fireball');
    Sigils.acquire(world, 'sig_dash');
    expect(Sigils.assignSkill(world, 1, 'sig_dash')).toBe(false);
    expect(Sigils.assignSkill(world, 1, 'sig_lightning')).toBe(false);
    expect(Sigils.assignSkill(world, 2, null)).toBe(true);
    expect(world.skillSlots[2]).toBeNull();
  });

  it('패시브: 부위가 비어 있으면 줍는 순간 새겨지고, 차 있으면 리스트에만 남는다', () => {
    Sigils.acquire(world, 'sig_dash'); // 척추
    expect(world.sigils.equipped.spine).toBe('sig_dash');
    const pendingAfterFirst = world.corruption.pending;
    Sigils.acquire(world, 'sig_moment'); // 척추 — 차 있다
    expect(world.sigils.equipped.spine).toBe('sig_dash');
    expect(world.sigils.inventory).toContain('sig_moment');
    expect(world.corruption.pending).toBe(pendingAfterFirst); // 안 새겨졌으니 오염도 없다
    expect(Sigils.attach(world, 'sig_moment')).toBe(false);
    expect(Sigils.detach(world, 'spine')).toBe(true);
    expect(world.modifiers.dodgeDistanceMul).toBe(1); // 떼면 효과가 사라진다
    expect(Sigils.attach(world, 'sig_moment')).toBe(true);
    expect(world.sigils.equipped.spine).toBe('sig_moment');
  });

  it('패시브는 갖는 순간 켜진다 — 돌진 회피: 회피 거리·무적 연장', () => {
    Sigils.acquire(world, 'sig_dash');
    expect(world.modifiers.dodgeDistanceMul).toBeCloseTo(1.8);
    expect(world.modifiers.dodgeIFrameTicks).toBe(12);
  });

  it('암시야: ambient 부스트', () => {
    Sigils.acquire(world, 'sig_darkvision');
    expect(world.modifiers.ambientVisionBoost).toBeCloseTo(1.0);
  });

  it('액티브 스킬의 effects 는 패시브 계산에 섞이지 않는다', () => {
    Sigils.acquire(world, 'sig_fireball');
    expect(world.modifiers).toEqual(Sigils.defaultModifiers());
  });
});

describe('화염구', () => {
  function cast(): void {
    world.input = { ...Input.emptySnapshot(), castPressed: true, useSkill: 1 };
    Projectiles.tick(world, DT);
    world.input = Input.emptySnapshot();
  }

  it('스킬 칸이 비어 있으면 시전 실패', () => {
    cast();
    expect(world.projectiles).toHaveLength(0);
    expect(world.mana.value).toBe(100);
  });

  it('시전이 구현되지 않은 스킬은 not_implemented 로 불발 — 빈 투사체를 만들지 않는다', () => {
    Sigils.acquire(world, 'sig_acid');
    expect(world.skillSlots[0]).toBeNull(); // 미구현은 자동으로 안 올라간다
    expect(Sigils.assignSkill(world, 0, 'sig_acid')).toBe(true); // 직접 올리는 건 된다
    world.mana.value = 100;
    const reasons: string[] = [];
    world.events.on('cast_failed', (p) => reasons.push((p as { reason: string }).reason));
    cast();
    expect(reasons).toEqual(['not_implemented']);
    expect(world.projectiles).toHaveLength(0);
  });

  it('시전: 마나 소모(각인이 지정한 manaCost) + 연쇄 리셋 + 투사체 생성', () => {
        Sigils.acquire(world, 'sig_fireball');
    world.mana.chainIndex = 2;
    cast();
    expect(world.projectiles).toHaveLength(1);
    expect(world.mana.value).toBeCloseTo(100 - (sigilDef('sig_fireball').effects['manaCost'] as number));
    expect(world.mana.chainIndex).toBe(0); // cast_spell → 리셋
  });

  it('마나 부족 시 불발', () => {
        Sigils.acquire(world, 'sig_fireball');
    world.mana.value = 5;
    cast();
    expect(world.projectiles).toHaveLength(0);
    expect(world.mana.value).toBe(5);
  });

  it('적 명중: 45 피해 + 화상, 화상 DoT가 마무리하면 spell_kill', () => {
        Sigils.acquire(world, 'sig_fireball');
    const enemy = runnerAt(10, 6); // 전방 4u
    world.enemies.push(enemy);
    const kills: unknown[] = [];
    world.events.on('spell_kill', (payload) => kills.push(payload));

    cast();
    // 4u / (26 u/s ÷ 60) ≈ 10틱이면 도달
    for (let i = 0; i < 15 && world.projectiles.length > 0; i++) Projectiles.tick(world, DT);
    expect(enemy.health).toBe(30 - 45); // 즉사 (45 > 30)
    expect(enemy.alive).toBe(false);
    expect(kills).toHaveLength(1);
  });

  it('낮은 피해 상황에서 화상 DoT 누적', () => {
        Sigils.acquire(world, 'sig_fireball');
    const enemy = runnerAt(10, 6);
    enemy.health = 200; // 즉사 방지용 가상 체력
    world.enemies.push(enemy);
    cast();
    for (let i = 0; i < 15 && world.projectiles.length > 0; i++) Projectiles.tick(world, DT);
    expect(enemy.burnTicks).toBeGreaterThan(0);
    const afterHit = enemy.health;
    for (let i = 0; i < 60; i++) Projectiles.tick(world, DT);
    expect(enemy.health).toBeCloseTo(afterHit - 60 * 0.15, 1);
  });

  it('벽에 막히면 소멸', () => {
        Sigils.acquire(world, 'sig_fireball');
    cast();
    let impacts = 0;
    world.events.on('spell_impact', () => impacts++);
    for (let i = 0; i < 120 && world.projectiles.length > 0; i++) Projectiles.tick(world, DT);
    expect(world.projectiles).toHaveLength(0);
    expect(impacts).toBe(1);
  });
});

describe('화염구 폭발', () => {
  const fx = sigilDef('sig_fireball').effects;

  /** 플레이어(6,6)에서 +X로 화염구를 쏴 dist 지점의 적에게 맞힌다 */
  function castAt(): void {
        Sigils.acquire(world, 'sig_fireball');
    world.mana.value = 100;
    world.player.yaw = -Math.PI / 2;
    world.input = { ...Input.emptySnapshot(), castPressed: true, useSkill: 1 };
    Projectiles.tick(world, DT);
    world.input = Input.emptySnapshot();
    for (let i = 0; i < 60 && world.projectiles.length > 0; i++) Projectiles.tick(world, DT);
  }

  it('적중 지점 주변의 다른 적도 피해를 입는다 (거리 감쇠)', () => {
    const direct = spawnEnemyAt('goblin_runner', 6 + 6, 6, 1);
    const near = spawnEnemyAt('goblin_runner', 6 + 6, 6 + 1.5, 2); // 폭심에서 1.5
    const far = spawnEnemyAt('goblin_runner', 6 + 6, 6 + 3.5, 3); // 3.5
    const outside = spawnEnemyAt('goblin_runner', 6 + 6, 6 + 6, 4); // 반경 밖
    for (const e of [direct, near, far, outside]) {
      e.health = 1000;
      world.enemies.push(e);
    }

    castAt();
    expect(direct.health).toBeLessThan(1000); // 직격
    expect(near.health).toBeLessThan(1000);
    expect(far.health).toBeLessThan(1000);
    expect(outside.health).toBe(1000); // 반경 밖은 무사
    // 가까울수록 크게 다친다
    expect(1000 - near.health).toBeGreaterThan(1000 - far.health);
  });

  it('폭심 가까이 있으면 크게 밀려난다', () => {
    // 사선 위의 적에게 맞혀 그 자리에서 터뜨린다
    const direct = spawnEnemyAt('goblin_runner', 6 + 6, 6, 1);
    const near = spawnEnemyAt('goblin_runner', 6 + 6, 6 + 1.6, 2); // 폭심에서 1.6 (blastRadius 안)
    const far = spawnEnemyAt('goblin_runner', 6 + 6, 6 + 3.5, 3); // 3.5 (밖)
    for (const e of [direct, near, far]) {
      e.health = 1000;
      world.enemies.push(e);
    }

    castAt();
    expect(near.kbTicks).toBe(fx['blastKnockbackTicks']);
    expect(far.kbTicks ?? 0).toBe(0); // blastRadius 밖은 밀리지 않는다
  });

  it('폭심이 반경 안이면 플레이어도 피해를 입는다 (자폭)', () => {
    // 코앞(2m)의 적에게 쏜다 — explodeRadius 4.0 안이라 나도 휘말린다
    const close = spawnEnemyAt('goblin_runner', 6 + 2, 6, 1);
    close.health = 1000;
    world.enemies.push(close);
    const hits: { amount: number }[] = [];
    world.events.on('player_damaged', (payload) => hits.push(payload as { amount: number }));
    let blast: { x: number; z: number } | null = null;
    world.events.on('explosion', (payload) => (blast = payload as { x: number; z: number }));

    const before = world.player.health;
    castAt();
    expect(world.player.health).toBeLessThan(before);
    expect(hits).toHaveLength(1);
    // 실제 폭심까지의 거리로 감쇠를 계산해 대조한다 (탄이 적 표면에서 터지므로 2m보다 가깝다)
    const at = blast!;
    const dist = Math.hypot(at.x - 6, at.z - 6);
    expect(dist).toBeLessThan(fx['explodeRadius']!);
    const falloff = 1 - (1 - fx['explodeFalloffMin']!) * (dist / fx['explodeRadius']!);
    expect(hits[0]!.amount).toBeCloseTo(fx['explodeDamage']! * falloff, 3);
  });

  it('멀리서 터지면 플레이어는 무사하다', () => {
    const far = spawnEnemyAt('goblin_runner', 6 + 8, 6, 1); // 8m — 반경 4.0 밖
    far.health = 1000;
    world.enemies.push(far);

    const before = world.player.health;
    castAt();
    expect(far.health).toBeLessThan(1000); // 적은 맞았고
    expect(world.player.health).toBe(before); // 나는 안 맞았다
  });

  it('회피 무적 중에는 자폭 피해를 받지 않는다', () => {
    const close = spawnEnemyAt('goblin_runner', 6 + 2, 6, 1);
    close.health = 1000;
    world.enemies.push(close);
    world.player.iframeTicks = 60;

    const before = world.player.health;
    castAt();
    expect(world.player.health).toBe(before);
  });

  it('벽에 맞아도 터진다 — 근처 적이 피해를 입는다', () => {
    // 사격장 복도 끝 벽까지 날아가 터지게, 벽 앞에 적을 둔다
    const nearWall = spawnEnemyAt('goblin_runner', 6 + 40, 6 + 1.5, 1);
    nearWall.health = 1000;
    world.enemies.push(nearWall);
    const explosions: unknown[] = [];
    world.events.on('explosion', (payload) => explosions.push(payload));

    castAt();
    expect(explosions.length).toBeGreaterThan(0);
  });
});

describe('스킬 시전 — 뇌창·서리·그림자', () => {
  // 아레나는 한 줄 복도(x 4~28, z 4~8). 플레이어 (6,6) 이 +x 를 본다
  function castSlot(n: number): void {
    world.input = { ...Input.emptySnapshot(), castPressed: true, useSkill: n };
    Projectiles.tick(world, DT);
    world.input = Input.emptySnapshot();
    Projectiles.endChannel(world); // 탭 = 눌렀다 뗀 것 — 채널형(뇌창)은 여기서 끊긴다
  }
  /** 이번 시전에서 빔이 "직격"한 적 id — 연쇄로 옮겨붙은 피해와 구분해서 본다 */
  function beamHits(slot: number): number[] {
    let ids: number[] = [];
    const off = world.events.on('lightning_beam', (p) => {
      const b = p as { hits: number[]; pulse?: boolean };
      if (b.pulse) ids = b.hits;
    });
    castSlot(slot);
    off();
    return ids;
  }
  /** 스킬 칸 n 을 ticks 틱 동안 붙들고 있는다 (떼지 않는다) */
  function holdSlot(n: number, ticks: number): void {
    for (let i = 0; i < ticks; i++) {
      world.input = { ...Input.emptySnapshot(), castPressed: i === 0, useSkill: i === 0 ? n : 0, skillHeld: n };
      Projectiles.tick(world, DT);
    }
    world.input = Input.emptySnapshot();
  }
  let nextEnemyId = 1000;
  function add(type: string, x: number, z: number): EnemyState {
    const e = spawnEnemyAt(type, x, z, nextEnemyId++);
    world.enemies.push(e);
    return e;
  }
  /** 앞(+x)으로 dist, 옆(z)으로 side 만큼 */
  function runnerAhead(dist: number, side = 0): EnemyState {
    return add('goblin_runner', 6 + dist, 6 + side);
  }

  it('관통 뇌창: 조준선 위의 적을 pierce 명까지 꿰뚫고, 옆의 적은 무사하다', () => {
    Sigils.acquire(world, 'sig_lightning');
    world.mana.value = 100;
    const fx = sigilDef('sig_lightning').effects;
    const inLine = [1.5, 3, 4.5, 6, 7.5, 9].map((d) => runnerAhead(d)); // 6명 — pierce 5
    const aside = runnerAhead(4, 1.7); // 빔 폭(0.7)+몸(0.5) 밖
    for (const e of [...inLine, aside]) e.health = 1000; // 연쇄까지 받아도 안 죽게
    const hits = beamHits(1);
    expect(hits).toEqual(inLine.slice(0, fx['pierce']!).map((e) => e.id));
    expect(hits).not.toContain(inLine[5]!.id); // 여섯째는 빔이 못 닿는다 (연쇄로는 닿는다)
    expect(hits).not.toContain(aside.id);
    expect(world.mana.value).toBe(100 - fx['manaCost']!);
    expect(Projectiles.skillCooldown(world, 'sig_lightning')).toBe(fx['cooldownTicks']);
  });

  it('이미 익힌 스킬을 또 주우면 각인이 아니라 경험치가 된다', () => {
    Sigils.acquire(world, 'sig_lightning');
    const before = { inv: [...world.sigils.inventory], slots: [...world.skillSlots], xp: world.xp };
    const gained: { amount: number; source?: string }[] = [];
    const dup: { id: string; xp: number }[] = [];
    world.events.on('xp_gained', (p) => gained.push(p as never));
    world.events.on('sigil_duplicate', (p) => dup.push(p as never));
    Sigils.acquire(world, 'sig_lightning');
    const amount = balance.sigil.duplicateXp[sigilDef('sig_lightning').tier];
    expect(world.sigils.inventory).toEqual(before.inv); // 목록에 겹쳐 쌓이지 않는다
    expect(world.skillSlots).toEqual(before.slots);
    expect(world.xp).toBe(before.xp + amount);
    expect(gained).toEqual([expect.objectContaining({ amount, source: 'sigil_duplicate' })]);
    expect(dup).toEqual([{ id: 'sig_lightning', xp: amount }]);
  });

  it('이미 익힌 스킬의 중복 획득은 오염을 더 쌓지 않는다', () => {
    Sigils.acquire(world, 'sig_lightning');
    const pending = world.corruption.pending;
    expect(pending).toBeGreaterThan(0); // 처음 익힐 때는 대가를 치른다
    Sigils.acquire(world, 'sig_lightning');
    expect(world.corruption.pending).toBe(pending);
  });

  it('바닥에서 주운 중복 스킬도 경험치가 된다 — 아이템은 사라진다', () => {
    Sigils.acquire(world, 'sig_darkvision'); // 패시브
    const xp = world.xp;
    world.groundItems.push({ id: 1, kind: 'sigil', sigilId: 'sig_darkvision', x: 6, z: 6 });
    Sigils.tick(world, DT);
    expect(world.groundItems).toHaveLength(0);
    expect(world.sigils.inventory.filter((id) => id === 'sig_darkvision')).toHaveLength(1);
    expect(world.xp).toBe(xp + balance.sigil.duplicateXp[sigilDef('sig_darkvision').tier]);
  });

  it('화살이 머리 높이에 맞으면 헤드샷 — 몸통 높이는 아니다', () => {
    const headFrac = balance.weapons.pistol.hitZones.headFrac;
    const shoot = (y: number): string[] => {
      const target = add('goblin_runner', 12, 6);
      target.health = 1000;
      const log: string[] = [];
      world.events.on('headshot', () => log.push('head'));
      world.projectiles.push({
        id: 555000 + Math.round(y * 100), owner: 'player', kind: 'arrow',
        x: 6, y, z: 6, prevX: 6, prevY: y, prevZ: 6,
        vx: 40, vy: 0, vz: 0, lifeTicks: 60,
        damage: 5, burnTicks: 0, burnDamagePerTick: 0, radius: 0.15,
      });
      for (let i = 0; i < 30 && target.health === 1000; i++) Projectiles.tick(world, DT);
      target.alive = false; // 다음 발사가 같은 적을 또 맞히지 않게 치운다
      return log;
    };
    const h = enemyDef2('goblin_runner').height;
    expect(shoot(h * (headFrac + 0.05))).toEqual(['head']);
    expect(shoot(h * (headFrac - 0.2))).toEqual([]);
  });

  it('화살 헤드샷으로 죽이면 히트스톱과 headshot_kill 이 걸린다', () => {
    const target = add('goblin_runner', 12, 6);
    target.health = 3; // 한 방 거리
    const kills: unknown[] = [];
    world.events.on('headshot_kill', (p) => kills.push(p));
    const h = enemyDef2('goblin_runner').height;
    world.projectiles.push({
      id: 556000, owner: 'player', kind: 'arrow',
      x: 6, y: h * 0.95, z: 6, prevX: 6, prevY: h * 0.95, prevZ: 6,
      vx: 40, vy: 0, vz: 0, lifeTicks: 60,
      damage: 5, burnTicks: 0, burnDamagePerTick: 0, radius: 0.15,
    });
    for (let i = 0; i < 30 && target.alive; i++) Projectiles.tick(world, DT);
    expect(target.alive).toBe(false);
    expect(kills).toHaveLength(1);
    expect(world.freezeTicks).toBe(balance.weapons.headshotKillFreezeTicks);
  });

  it('수류탄은 금 간 벽에 튕기지 않고 부딪히는 즉시 터져 벽을 부순다', () => {
    world.level.grid[1] = '#######C'; // 동쪽 벽 한 칸을 균열 벽으로
    const log: string[] = [];
    world.events.on('grenade_bounce', () => log.push('bounce'));
    world.events.on('explosion', () => log.push('boom'));
    world.events.on('crack_wall_broken', () => log.push('broken'));
    world.projectiles.push({
      id: 434343, owner: 'player', kind: 'grenade',
      x: 24, y: 1.2, z: 6, prevX: 24, prevY: 1.2, prevZ: 6,
      vx: 12, vy: 0, vz: 0, lifeTicks: 600,
      damage: 0, burnTicks: 0, burnDamagePerTick: 0, radius: 0.12,
    });
    for (let i = 0; i < 40 && !log.includes('boom'); i++) Projectiles.tick(world, DT);
    expect(log).toContain('boom');
    expect(log).toContain('broken');
    expect(log).not.toContain('bounce');
  });

  it('화염구 폭발이 균열 벽을 1방에 부순다 — 셀이 열리고 붕괴 이벤트가 난다', () => {
    // 아레나 동쪽 벽 한 칸을 균열 벽으로 (col 7, row 1)
    world.level.grid[1] = '#######C';
    const broken: { row: number; col: number }[] = [];
    world.events.on('crack_wall_broken', (p) => broken.push(p as never));
    const fx = sigilDef('sig_fireball').effects;
    Projectiles.breakCrackWalls(world, (7 + 0.5) * 4 - 1, 6, fx['explodeRadius']!);
    expect(broken).toEqual([expect.objectContaining({ row: 1, col: 7 })]);
    expect(world.level.solidAt(7, 1)).toBe(false); // 이제 지나갈 수 있다
  });

  it('발소리 — 질주는 sprint 플래그가 참, 걷기는 거짓 (걷기 소리는 적이 못 듣는다)', () => {
    world.stamina.value = 100;
    world.stamina.exhausted = false;
    const steps: { sprint?: boolean }[] = [];
    world.events.on('footstep', (p) => steps.push(p as { sprint?: boolean }));
    world.input = { ...Input.emptySnapshot(), moveForward: 1, sprint: true };
    for (let i = 0; i < balance.player.sprintFootstepTicks * 2 + 2; i++) PlayerMove.tick(world, DT);
    expect(steps.length).toBeGreaterThanOrEqual(2);
    expect(steps.every((f) => f.sprint === true)).toBe(true);
    steps.length = 0;
    world.input = { ...Input.emptySnapshot(), moveForward: 1 }; // 걷기
    for (let i = 0; i < balance.player.walkFootstepTicks * 2 + 2; i++) PlayerMove.tick(world, DT);
    world.input = Input.emptySnapshot();
    expect(steps.length).toBeGreaterThanOrEqual(2); // 걷기도 소리는 난다
    expect(steps.every((f) => f.sprint === false)).toBe(true); // 다만 작아서 적이 못 듣는다
  });

  it('회피 대시 소리는 1.5m 안의 적이 듣지만, 걷기 발소리는 못 듣는다', () => {
    Enemies.init(world);
    const eaves = add('goblin_runner', 6 - 1.2, 6);
    eaves.homeYaw = Math.atan2(-(6 - eaves.x), -(6 - eaves.z)) + Math.PI;
    // 걷기 — 아무리 걸어도 소리가 없다
    world.stamina.value = 100;
    world.input = { ...Input.emptySnapshot(), moveForward: 1 };
    for (let i = 0; i < 40; i++) PlayerMove.tick(world, DT);
    world.input = Input.emptySnapshot();
    world.player.x = 6; // 제자리로 되돌린다 (걷다 멀어졌다)
    world.player.z = 6;
    expect(eaves.ai).toBe('idle');
    // 대시 — 그 자리에서 듣는다
    world.events.emit('dodge_step', {});
    expect(eaves.ai).toBe('chase');
  });

  it('보스는 죽었는데 자물쇠·열쇠가 모두 없으면 열쇠를 다시 떨군다 — 소프트락 방지', () => {
    const boss = add('slime_mother', 12, 6);
    boss.alive = false;
    world.exitNeedsKey = true;
    world.hasExitKey = false;
    Exit.tick(world, DT);
    const key = world.groundItems.find((g) => g.kind === 'key');
    expect(key).toBeTruthy();
    expect([key!.x, key!.z]).toEqual([12, 6]); // 죽은 보스 자리
    // 한 번만 — 다음 틱에 또 떨구지 않는다
    Exit.tick(world, DT);
    expect(world.groundItems.filter((g) => g.kind === 'key')).toHaveLength(1);
  });

  it('열쇠를 이미 손에 쥐고 있으면 다시 떨구지 않는다', () => {
    const boss = add('slime_mother', 12, 6);
    boss.alive = false;
    world.exitNeedsKey = true;
    world.hasExitKey = true;
    Exit.tick(world, DT);
    expect(world.groundItems.some((g) => g.kind === 'key')).toBe(false);
  });

  it('죽으면 가방 소모품만 비석에 남고, 그 자리를 밟으면 되찾는다', () => {
    initInventory(world);
    addItem(world, 'potion');
    addItem(world, 'potion');
    addItem(world, 'mana');
    expect(spillInventoryToGrave(world, 12, 6)).toBe(true);
    expect(world.inventory.every((s2) => s2 === null)).toBe(true); // 가방이 통째로 비었다
    const grave = world.groundItems.find((g) => g.kind === 'grave')!;
    expect(grave.graveItems!.reduce((n, s2) => n + s2.count, 0)).toBe(3);
    // 6m 밖 — 비석은 자석에 걸리지 않는다
    Pickups.tick(world, DT);
    expect(world.groundItems.some((g) => g.kind === 'grave')).toBe(true);
    expect(world.inventory.every((s2) => s2 === null)).toBe(true);
    // 밟으면 전부 회수
    world.player.x = 12;
    world.player.z = 6;
    Pickups.tick(world, DT);
    expect(world.groundItems.some((g) => g.kind === 'grave')).toBe(false);
    expect(world.inventory.filter((s2) => s2 !== null).length).toBeGreaterThan(0);
  });

  it('가방이 비어 있으면 비석이 서지 않는다', () => {
    initInventory(world);
    expect(spillInventoryToGrave(world, 12, 6)).toBe(false);
    expect(world.groundItems.some((g) => g.kind === 'grave')).toBe(false);
  });

  it('어미 슬라임 — 제 몸을 떼어 새끼 다섯을 뿌리고 그만큼 체력을 잃는다', () => {
    const mom = add('slime_mother', 14, 6);
    mom.ai = 'chase';
    const before = mom.health;
    // 소환 windup(48틱) 뒤 머리에서 한 마리씩 순차 사출 — 다섯이 다 나올 때까지
    for (
      let i = 0;
      i < 200 && world.enemies.filter((e) => e.type === 'slime_small').length < 5;
      i++
    )
      Enemies.tick(world, DT);
    expect(world.enemies.filter((e) => e.type === 'slime_small' && e.alive)).toHaveLength(5);
    // 머리 높이에서 태어나 떨어지는 중이다 (마지막 사출 직후라 아직 공중)
    const lastborn = world.enemies.filter((e) => e.type === 'slime_small').at(-1)!;
    expect(lastborn.jumpY ?? 0).toBeGreaterThan(0);
    expect(mom.health).toBe(before - 30);
    expect(mom.summonCooldown).toBeGreaterThan(0); // 재사용 대기가 돈다
  });

  it('어미 슬라임 — 화상 중에는 말라붙어 새끼를 못 떼어낸다', () => {
    const mom = add('slime_mother', 14, 6);
    mom.ai = 'chase';
    mom.burnTicks = 600;
    for (let i = 0; i < 70; i++) Enemies.tick(world, DT);
    expect(world.enemies.filter((e) => e.type === 'slime_small')).toHaveLength(0);
  });

  it('슬라임은 죽으면 절반 둘로 갈라진다 — 화상·빙결 중 사망은 예외다', () => {
    const s1 = add('slime', 12, 6);
    s1.health = 0;
    s1.alive = false;
    Enemies.tick(world, DT);
    expect(world.enemies.filter((e) => e.type === 'slime_small' && e.alive)).toHaveLength(2);
    // 갈라진 새끼는 튕겨 나간다 — 부모 자리에 겹쳐 태어나면 해머 한 방에 같이 죽는다
    for (const child of world.enemies.filter((e) => e.type === 'slime_small')) {
      expect(child.kbTicks ?? 0).toBeGreaterThan(0);
    }
    // 화상 중 사망 — 말라붙어 갈라지지 않는다
    const s2 = add('slime', 20, 6);
    s2.burnTicks = 10;
    s2.alive = false;
    // 빙결 중 사망 — 통째로 깨져 갈라지지 않는다
    const s3 = add('slime', 24, 6);
    s3.freezeTicks = 10;
    s3.alive = false;
    Enemies.tick(world, DT);
    expect(world.enemies.filter((e) => e.type === 'slime_small')).toHaveLength(2); // 그대로
  });

  it('슬라임은 눈이 없다 — 코앞에 서도 못 보고, 소리는 배로 듣는다', () => {
    Enemies.init(world);
    const slime = add('slime', 6, 8); // 플레이어(6,6) 정면 2m — 보통 적이면 인기척에 깬다
    slime.yaw = Math.atan2(-(6 - slime.x), -(6 - slime.z)); // 플레이어를 정면에 둔다
    slime.hearingMul = 2.5; // 스포너가 def 에서 복사하는 값 — 직접 만든 개체라 손으로 준다
    for (let i = 0; i < 60; i++) Enemies.tick(world, DT);
    expect(slime.ai).toBe('idle'); // 시야·인기척으로는 안 깬다
    world.events.emit('dodge_step', {}); // 대시 소음 1.5m × 청각 2.5 = 3.75m — 2m 거리라 들린다
    expect(slime.ai).toBe('chase');
  });

  it('구울 파먹기 — 물리는 동안 피가 닳고, 근접 연타 6번에 밀쳐낸다', () => {
    const g = add('ghoul', 7, 6); // 플레이어(6,6) 코앞
    g.ai = 'latched';
    g.timer = 1; // 다음 틱에 첫 물기
    g.latchDirX = 1;
    g.latchDirZ = 0;
    world.grappleEnemyId = g.id;
    world.grappleMash = 0;
    const hp = world.player.health;
    world.input = Input.emptySnapshot();
    Enemies.tick(world, DT);
    expect(world.player.health).toBe(hp - balance.ghoulGrapple.biteDamage); // 물어뜯겼다
    // 한 키 체계가 상호작용으로 바꿔 보낸 입력도 몸부림이다 (문 앞에서 물렸을 때)
    world.input = { ...Input.emptySnapshot(), interactPressed: true };
    Enemies.tick(world, DT);
    expect(world.grappleMash).toBe(1);
    for (let i = 0; i < balance.ghoulGrapple.mashToEscape; i++) {
      world.input = { ...Input.emptySnapshot(), meleePressed: true };
      Enemies.tick(world, DT);
    }
    expect(world.grappleEnemyId).toBeNull(); // 밀쳐냈다
    expect(g.ai).toBe('recover');
    expect(g.whiffed).toBe(true); // 무방비 — 반격 창
    expect(world.player.iframeTicks).toBeGreaterThan(0);
    world.input = Input.emptySnapshot();
  });

  it('구울 굶주림 — 생명 입자를 먹으면 회복하고 광란이 쌓인다', () => {
    const g = add('ghoul', 20, 6);
    g.ai = 'chase';
    g.health = 40;
    world.lifeMotes.push({ id: 1, x: 21, y: 0.5, z: 6, ageTicks: 0, homing: false, speed: 0 });
    for (let i = 0; i < 30 && world.lifeMotes.length > 0; i++) Enemies.tick(world, DT);
    expect(world.lifeMotes).toHaveLength(0); // 플레이어보다 가까웠다 — 뺏겼다
    expect(g.frenzyStacks).toBe(1);
    expect(g.health).toBe(40 + 6);
  });

  it('죽은 척 구울 — 코앞 기척(3m)에만 일어난다', () => {
    const near = add('ghoul', 8.5, 6); // 2.5m
    near.feigning = true;
    const far = add('ghoul', 14, 6); // 8m
    far.feigning = true;
    Enemies.tick(world, DT);
    expect(near.feigning).toBe(false);
    expect(near.ai).toBe('chase');
    expect(far.ai).toBe('idle');
    expect(far.feigning).toBe(true);
  });

  it('동료가 눈앞에서 죽으면 알아챈다 — 등 뒤·장님은 모른다', () => {
    const victim = add('spider_small', 14, 6);
    const front = add('spider_large', 18, 6); // 서쪽(희생자 쪽)을 보고 있다
    front.yaw = Math.PI / 2;
    const back = add('spider_large', 10, 6); // 서쪽을 보고 있다 — 희생자는 등 뒤(동쪽)
    back.yaw = Math.PI / 2;
    const blindOne = add('slime', 16, 6); // 희생자 쪽을 보지만 눈이 없다
    blindOne.yaw = Math.PI / 2;
    world.lantern.on = false; // 랜턴 빔(+X)이 back 을 비춰 깨우지 않게 — 목격 규칙만 잰다
    victim.alive = false;
    Enemies.tick(world, DT);
    expect(front.ai).toBe('chase'); // 정면에서 동료가 터지는 걸 봤다
    expect(back.ai).toBe('idle');
    expect(blindOne.ai).toBe('idle');
  });

  it('슬라임은 바닥 아이템을 삼키고, 죽으면 전부 게워 낸다 — 금액 그대로', () => {
    const s1 = add('slime_small', 12, 6); // 새끼는 분열이 없어 게워 낸 것이 그대로 남는다
    world.groundItems.push({ id: 4242, kind: 'gold', x: 12.3, z: 6, amount: 7 });
    world.groundItems.push({ id: 4243, kind: 'potion', x: 11.9, z: 6.2 });
    Enemies.tick(world, DT);
    expect(world.groundItems.filter((g) => g.kind === 'gold' || g.kind === 'potion')).toHaveLength(0);
    expect(s1.eatenItems).toHaveLength(2);
    s1.alive = false;
    Enemies.tick(world, DT);
    expect(world.groundItems.find((g) => g.kind === 'gold')?.amount).toBe(7);
    expect(world.groundItems.some((g) => g.kind === 'potion')).toBe(true);
  });

  it('슬라임은 열쇠를 삼키지 않는다 — 진행이 배 속에 갇히면 안 된다', () => {
    add('slime_small', 12, 6);
    world.groundItems.push({ id: 4244, kind: 'key', x: 12.2, z: 6 });
    Enemies.tick(world, DT);
    expect(world.groundItems.some((g) => g.kind === 'key')).toBe(true);
  });

  it('점액 장판을 밟으면 느려진다', () => {
    world.stamina.value = 100;
    const run = (goo: boolean): number => {
      world.player.x = 6;
      world.player.z = 6;
      world.player.prevX = 6;
      world.player.prevZ = 6;
      world.gooPuddles = goo ? [{ id: 1, x: 6, z: 6, ticks: 600 }] : [];
      world.input = { ...Input.emptySnapshot(), moveForward: 1 };
      for (let i = 0; i < 10; i++) PlayerMove.tick(world, DT);
      world.input = Input.emptySnapshot();
      return Math.hypot(world.player.x - 6, world.player.z - 6);
    };
    const slow = run(true);
    const fast = run(false);
    expect(slow).toBeLessThan(fast * 0.7);
  });

  it('시전 소음 — 빗나가도 등 뒤 코앞(2m)의 대기 적은 깬다', () => {
    Enemies.init(world);
    Sigils.acquire(world, 'sig_fireball');
    world.mana.value = 100;
    // 플레이어 등 뒤 1.3m — 눈으로는 절대 못 보는 자리 (플레이어를 등지고 있기까지 하다)
    const eaves = add('goblin_runner', 6 - 1.3, 6);
    eaves.homeYaw = Math.atan2(-(6 - eaves.x), -(6 - eaves.z)) + Math.PI;
    expect(eaves.ai).toBe('idle');
    castSlot(1); // 화염구는 +X 로 날아간다 — 이 적과는 무관
    expect(eaves.ai).toBe('chase');
  });

  it('피격음 — 화살에 맞은 적 코앞(2m)의 동료도 깬다', () => {
    const victim = add('goblin_runner', 14, 6); // 플레이어에게서 8m — 활 소음(4m) 밖
    const buddy = add('goblin_runner', 14, 7.5); // 피해자 옆 1.5m
    for (const e of [victim, buddy]) {
      e.ai = 'idle';
      e.homeYaw = Math.atan2(-(6 - e.x), -(6 - e.z)) + Math.PI; // 플레이어를 등진다
    }
    victim.health = 1000;
    // 화살을 직접 날린다 — Weapons 를 거치면 발사 소음이 겹쳐 피격음을 못 갈라낸다
    world.projectiles.push({
      id: 424242, owner: 'player', kind: 'arrow',
      x: 6, y: 1.0, z: 6, prevX: 6, prevY: 1.0, prevZ: 6,
      vx: 40, vy: 0, vz: 0, lifeTicks: 60,
      damage: 5, burnTicks: 0, burnDamagePerTick: 0, radius: 0.15,
    });
    for (let i = 0; i < 30 && victim.health === 1000; i++) Projectiles.tick(world, DT);
    expect(victim.health).toBeLessThan(1000); // 명중 확인
    expect(buddy.ai).toBe('chase'); // 옆 놈이 피격음을 들었다
  });

  it('관통 뇌창: 끊기지 않고 1.5초를 지지면 감전돼 1초 동안 그 자세로 굳는다', () => {
    Sigils.acquire(world, 'sig_lightning');
    world.mana.value = 500;
    const fx = sigilDef('sig_lightning').effects;
    const need = fx['shockChargeTicks']!;
    const e = runnerAhead(6);
    e.health = 100000;
    const shocks: { enemyId: number }[] = [];
    world.events.on('enemy_shocked', (p) => shocks.push(p as { enemyId: number }));
    holdSlot(1, need - 1);
    expect(shocks).toEqual([]); // 아직
    expect(e.shockCharge).toBe(need - 1);
    holdSlot(1, 1);
    expect(shocks).toEqual([expect.objectContaining({ enemyId: e.id })]);
    expect(e.shockTicks).toBe(fx['shockTicks']);
    expect(e.shockCharge).toBe(0); // 풀리면 처음부터 다시 쌓는다
  });

  it('관통 뇌창: 감전 중에는 AI 가 멎고, 풀리면 하던 자리에서 그대로 이어진다', () => {
    Sigils.acquire(world, 'sig_lightning');
    const fx = sigilDef('sig_lightning').effects;
    const e = runnerAhead(6);
    e.ai = 'chase';
    e.shockTicks = fx['shockTicks']!;
    const x = e.x;
    const z = e.z;
    const ai = e.ai;
    for (let i = 0; i < fx['shockTicks']!; i++) Enemies.tick(world, DT);
    expect(e.x).toBe(x); // 한 발짝도 못 움직인다
    expect(e.z).toBe(z);
    expect(e.ai).toBe(ai); // 상태가 초기화되지 않는다 — 하던 걸 이어 간다
    expect(e.shockTicks).toBe(0);
    Enemies.tick(world, DT);
    expect(e.x).not.toBe(x); // 풀린 다음 틱부터 다시 다가온다
  });

  it('관통 뇌창: 전기가 끊기면 누적이 0 으로 돌아간다 — "연속" 이 조건이다', () => {
    Sigils.acquire(world, 'sig_lightning');
    world.mana.value = 500;
    const fx = sigilDef('sig_lightning').effects;
    const e = runnerAhead(6);
    e.health = 100000;
    holdSlot(1, 40);
    expect(e.shockCharge).toBe(40);
    // 손을 떼고 유예(shockGraceTicks)가 지나면 처음으로 돌아간다
    for (let i = 0; i < fx['shockGraceTicks']! + 1; i++) Enemies.tick(world, DT);
    expect(e.shockCharge).toBe(0);
  });

  it('관통 뇌창: 방어막이 살아 있는 주술사는 전기를 흘려보낼 뿐 감전되지 않는다', () => {
    Sigils.acquire(world, 'sig_lightning');
    world.mana.value = 500;
    const fx = sigilDef('sig_lightning').effects;
    const warden = add('warden', 12, 6);
    warden.ai = 'chase';
    holdSlot(1, fx['shockChargeTicks']! + 30);
    expect(warden.shockTicks ?? 0).toBe(0);
    expect(warden.shockCharge ?? 0).toBe(0);
  });

  it('관통 뇌창: 맞은 적에서 가까운 순으로 옮겨붙고, 한 번마다 피해가 10% 깎인다', () => {
    Sigils.acquire(world, 'sig_lightning');
    world.mana.value = 100;
    const fx = sigilDef('sig_lightning').effects;
    const dmg = fx['damage']!;
    const fall = fx['chainFalloff']!;
    const target = runnerAhead(5); // 직격 (11, 6)
    const a = add('goblin_runner', 13, 7.5); // 직격점에서 2.5m — 첫 전이
    const b = add('goblin_runner', 16, 4.6); // a 에서 4.2m — 둘째 전이
    for (const e of [target, a, b]) e.health = 1000;
    const hits = beamHits(1);
    expect(hits).toEqual([target.id]); // 빔이 꿴 건 하나 — 나머지는 연쇄다
    expect(target.health).toBe(1000 - dmg);
    expect(a.health).toBeCloseTo(1000 - dmg * fall, 6); // 10.8
    expect(b.health).toBeCloseTo(1000 - dmg * fall * fall, 6); // 9.72
  });

  it('관통 뇌창: 연쇄 반경은 처음 맞은 적 기준 — 10m 밖은 옮겨붙지 않는다', () => {
    Sigils.acquire(world, 'sig_lightning');
    world.mana.value = 100;
    const fx = sigilDef('sig_lightning').effects;
    const target = runnerAhead(5); // 직격 (11, 6)
    const near = add('goblin_runner', 13, 7.5); // 2.5m — 옮겨붙는다
    const outOfRange = add('goblin_runner', 22, 7.5); // 직격점에서 11.1m — 밖
    for (const e of [target, near, outOfRange]) e.health = 1000;
    castSlot(1);
    expect(near.health).toBeLessThan(1000);
    expect(outOfRange.health).toBe(1000);
    expect(fx['chainRange']).toBe(10);
  });

  it('관통 뇌창: 벽에 가린 적에게는 옮겨붙지 않는다', () => {
    Sigils.acquire(world, 'sig_lightning');
    world.mana.value = 100;
    const target = runnerAhead(5); // 직격 (11, 6)
    const behindWall = add('goblin_runner', 13, 9); // z>8 은 벽 안 — 3.6m 지만 안 보인다
    target.health = 1000;
    behindWall.health = 1000;
    castSlot(1);
    expect(behindWall.health).toBe(1000);
  });

  it('관통 뇌창: 빔이 이미 꿴 적에게는 다시 옮겨붙지 않는다', () => {
    Sigils.acquire(world, 'sig_lightning');
    world.mana.value = 100;
    const fx = sigilDef('sig_lightning').effects;
    const first = runnerAhead(4);
    const second = runnerAhead(7); // 둘 다 빔이 꿴다
    first.health = 1000;
    second.health = 1000;
    const hits = beamHits(1);
    expect(hits).toEqual([first.id, second.id]);
    // 둘 다 직격 피해 한 번씩만 — 연쇄로 두 번 맞지 않는다
    expect(first.health).toBe(1000 - fx['damage']!);
    expect(second.health).toBe(1000 - fx['damage']!);
  });

  it('관통 뇌창: 붙들고 있으면 pulseTicks 마다 한 타씩 계속 나간다', () => {
    Sigils.acquire(world, 'sig_lightning');
    world.mana.value = 100;
    const fx = sigilDef('sig_lightning').effects;
    const e = runnerAhead(6);
    e.health = 1000;
    const pulses = 4;
    holdSlot(1, 1 + fx['pulseTicks']! * (pulses - 1)); // 첫 타는 누른 틱에 바로
    expect(e.health).toBe(1000 - fx['damage']! * pulses);
    expect(world.mana.value).toBe(100 - fx['manaCost']! * pulses); // 마나는 한 타마다
    expect(world.spell.channel).toBeTruthy(); // 아직 붙들고 있다
    expect(Projectiles.skillCooldown(world, 'sig_lightning')).toBe(0); // 뻗는 동안은 안 쉰다
  });

  it('관통 뇌창: 손을 떼면 그 틱에 멈추고, 그때서야 쿨다운이 걸린다', () => {
    Sigils.acquire(world, 'sig_lightning');
    world.mana.value = 100;
    const fx = sigilDef('sig_lightning').effects;
    const e = runnerAhead(6);
    e.health = 1000;
    holdSlot(1, 1 + fx['pulseTicks']! * 2); // 3타
    const health = e.health;
    const ended: { reason?: string }[] = [];
    world.events.on('channel_ended', (p) => ended.push(p as { reason?: string }));
    world.input = Input.emptySnapshot(); // 뗐다
    Projectiles.tick(world, DT);
    expect(world.spell.channel).toBeFalsy();
    expect(ended).toEqual([expect.objectContaining({ reason: 'released' })]);
    expect(Projectiles.skillCooldown(world, 'sig_lightning')).toBe(fx['cooldownTicks']);
    for (let i = 0; i < 30; i++) Projectiles.tick(world, DT);
    expect(e.health).toBe(health); // 뗀 뒤로는 한 타도 더 안 들어간다
  });

  it('관통 뇌창: 마나가 마르면 붙들고 있어도 저절로 끊긴다', () => {
    Sigils.acquire(world, 'sig_lightning');
    const fx = sigilDef('sig_lightning').effects;
    world.mana.value = fx['manaCost']! * 2 + 1; // 두 타 분
    const e = runnerAhead(6);
    e.health = 1000;
    holdSlot(1, 10);
    expect(e.health).toBe(1000 - fx['damage']! * 2);
    expect(world.spell.channel).toBeFalsy();
    expect(Projectiles.skillCooldown(world, 'sig_lightning')).toBeGreaterThan(0);
  });

  it('관통 뇌창: 정확히 안 겨눠도 조준선 근처의 적에게 저절로 휜다', () => {
    Sigils.acquire(world, 'sig_lightning');
    world.mana.value = 100;
    const fx = sigilDef('sig_lightning').effects;
    // 앞 6m, 옆 1.4m — 빔 폭(0.7)+몸(0.5) 밖이지만 보정 원뿔(14도, 여기선 13.1도) 안
    const off = runnerAhead(6, 1.4);
    off.health = 1000;
    castSlot(1);
    expect(off.health).toBe(1000 - fx['damage']!);
  });

  it('관통 뇌창: 보정 원뿔 밖의 적에게는 휘지 않는다', () => {
    Sigils.acquire(world, 'sig_lightning');
    world.mana.value = 100;
    const wide = runnerAhead(3, 1.4); // 25도 — 원뿔(14도) 밖
    wide.health = 1000;
    castSlot(1);
    expect(wide.health).toBe(1000);
  });

  it('관통 뇌창: 원뿔 안이라도 벽 너머의 적에게는 휘지 않는다', () => {
    Sigils.acquire(world, 'sig_lightning');
    world.mana.value = 100;
    const behindWall = add('goblin_runner', 18, 8.5); // z>8 은 벽 안 — 11.8도라 원뿔 안이다
    behindWall.health = 1000;
    castSlot(1);
    expect(behindWall.health).toBe(1000);
  });

  it('관통 뇌창: 원뿔 안에 둘이면 가장 가까운 쪽으로 휜다', () => {
    Sigils.acquire(world, 'sig_lightning');
    world.mana.value = 100;
    const fx = sigilDef('sig_lightning').effects;
    const near = runnerAhead(8, 1.9); // 13.4도
    const far = runnerAhead(12, 1.4); // 6.6도 — 더 정면이지만 멀다
    near.health = 1000;
    far.health = 1000;
    const hits = beamHits(1);
    expect(hits).toEqual([near.id]); // 빔이 꿴 건 가까운 쪽 하나뿐
    expect(near.health).toBe(1000 - fx['damage']!);
    // 먼 쪽은 빔의 선 밖 — 다만 연쇄로 한 번 깎인 피해가 옮겨붙는다
    expect(far.health).toBeCloseTo(1000 - fx['damage']! * fx['chainFalloff']!, 6);
  });

  it('관통 뇌창: 빔이 멈춘 면을 벽·바닥·천장으로 알려 준다 (그을림 자리)', () => {
    Sigils.acquire(world, 'sig_lightning');
    const beams: { surface: string | null; axis: string | null; ey: number }[] = [];
    world.events.on('lightning_beam', (p) => beams.push(p as never));
    const shoot = (pitch: number): (typeof beams)[number] => {
      world.player.pitch = pitch;
      world.spell.cooldowns = {};
      world.mana.value = 100;
      beams.length = 0;
      castSlot(1);
      return beams[0]!;
    };
    // 수평 — 복도 끝 벽(x=28). 넘어간 축이 x 라 법선도 ±X
    const flat = shoot(0);
    expect(flat.surface).toBe('wall');
    expect(flat.axis).toBe('x');
    // 아래로 — 벽보다 바닥이 먼저다. 끝점이 바닥(y=0)에 딱 놓인다
    const down = shoot(-0.6);
    expect(down.surface).toBe('floor');
    expect(down.ey).toBeCloseTo(0, 6);
    // 위로 — 천장
    const up = shoot(0.6);
    expect(up.surface).toBe('ceiling');
    expect(up.ey).toBeCloseTo(world.level.ceiling, 6);
    world.player.pitch = 0;
  });

  it('관통 뇌창: 바닥에 처박힌 빔은 그 너머의 적에게 닿지 않는다', () => {
    Sigils.acquire(world, 'sig_lightning');
    world.mana.value = 100;
    const far = runnerAhead(12);
    far.health = 1000;
    world.player.pitch = -0.6; // 발밑 2.3m 쯤에서 바닥에 닿는다
    castSlot(1);
    world.player.pitch = 0;
    expect(far.health).toBe(1000);
  });

  it('관통 뇌창: 마법 방어막에서 끊긴 빔은 그 뒤 벽을 그을리지 않는다', () => {
    Sigils.acquire(world, 'sig_lightning');
    world.mana.value = 100;
    const warden = add('warden', 12, 6);
    warden.ai = 'chase';
    const beams: { surface: string | null }[] = [];
    world.events.on('lightning_beam', (p) => beams.push(p as never));
    castSlot(1);
    expect(beams[0]!.surface).toBeNull();
  });

  it('관통 뇌창: 폭발통을 지지면 시간이 쌓여 터진다 — 끊었다 다시 지져도 누적된다', () => {
    Sigils.acquire(world, 'sig_lightning');
    world.mana.value = 100;
    const barrel: BarrelState = { id: 1, x: 12, z: 6, alive: true, hits: 0, fuseTicks: -1 };
    world.barrels.push(barrel);
    const need = balance.barrel.zapTicks;
    world.player.pitch = -0.15; // 통은 1.3m — 눈높이(1.6m) 로는 위를 지나간다
    holdSlot(1, need - 1);
    expect(barrel.zapTicks).toBe(need - 1);
    expect(barrel.fuseTicks).toBe(-1); // 아직 안 터진다
    expect(barrel.hits).toBe(0); // 때린 게 아니다 — 도화선이 짧아지지 않는다
    // 손을 떼도 지진 시간은 남는다
    world.input = Input.emptySnapshot();
    Projectiles.tick(world, DT);
    expect(barrel.zapTicks).toBe(need - 1);
    world.spell.cooldowns = {};
    world.mana.value = 100;
    holdSlot(1, 1);
    expect(barrel.zapTicks).toBe(need);
    expect(barrel.fuseTicks).toBe(0); // 점화 — Barrels 가 이 틱에 터뜨린다
    world.player.pitch = 0;
  });

  it('관통 뇌창: 빔은 폭발통에서 멈추지만, 사슬은 통을 타고 뒤의 적에게 넘어간다', () => {
    Sigils.acquire(world, 'sig_lightning');
    world.mana.value = 100;
    const fx = sigilDef('sig_lightning').effects;
    world.barrels.push({ id: 1, x: 12, z: 6, alive: true, hits: 0, fuseTicks: -1 });
    const behind = add('goblin_runner', 16, 6);
    behind.health = 1000;
    world.player.pitch = -0.15;
    const hits = beamHits(1);
    world.player.pitch = 0;
    expect(hits).toEqual([]); // 빔이 꿴 적은 없다 — 통이 막았다
    expect(behind.health).toBeCloseTo(1000 - fx['damage']! * fx['chainFalloff']!, 6);
  });

  it('관통 뇌창: 통에 쏘면 통을 시작점으로 주변 적에게 옮겨붙는다', () => {
    Sigils.acquire(world, 'sig_lightning');
    world.mana.value = 100;
    const fx = sigilDef('sig_lightning').effects;
    const barrel: BarrelState = { id: 1, x: 12, z: 6, alive: true, hits: 0, fuseTicks: -1 };
    world.barrels.push(barrel);
    const beside = add('goblin_runner', 12, 4.2); // 16.7도 — 조준 보정 원뿔(14도) 밖
    beside.health = 1000;
    world.player.pitch = -0.15;
    const hits = beamHits(1);
    world.player.pitch = 0;
    expect(hits).toEqual([]); // 빔은 통에서 멈췄다
    expect(barrel.zapTicks).toBe(1); // 직격은 한 틱씩 쌓인다
    expect(beside.health).toBeCloseTo(1000 - fx['damage']! * fx['chainFalloff']!, 6);
  });

  it('관통 뇌창: 적을 맞히면 근처 폭발통으로도 옮겨붙어 지져진다', () => {
    Sigils.acquire(world, 'sig_lightning');
    world.mana.value = 100;
    const fx = sigilDef('sig_lightning').effects;
    const target = runnerAhead(5); // 직격 (11, 6)
    target.health = 1000;
    const barrel: BarrelState = { id: 1, x: 13, z: 7.5, alive: true, hits: 0, fuseTicks: -1 };
    world.barrels.push(barrel); // 직격점에서 2.5m — 사슬의 첫 대상
    const hits = beamHits(1);
    expect(hits).toEqual([target.id]);
    // 사슬 한 칸당 한 타 간격(pulseTicks)만큼 지진다 — 계속 대고 있으면 직격과 같은 1.5초
    expect(barrel.zapTicks).toBe(fx['pulseTicks']);
    expect(barrel.hits).toBe(0); // 때린 게 아니다
  });

  it('관통 뇌창: 사슬로 계속 지진 통도 1.5초면 터진다', () => {
    Sigils.acquire(world, 'sig_lightning');
    world.mana.value = 100;
    const target = runnerAhead(5);
    target.health = 100000;
    const barrel: BarrelState = { id: 1, x: 13, z: 7.5, alive: true, hits: 0, fuseTicks: -1 };
    world.barrels.push(barrel);
    holdSlot(1, balance.barrel.zapTicks); // 1.5초 붙들고 있는다
    expect(barrel.zapTicks).toBeGreaterThanOrEqual(balance.barrel.zapTicks);
    expect(barrel.fuseTicks).toBe(0); // 점화
  });

  it('관통 뇌창: 방패병은 번개를 못 막는다 — 정면으로 들고 있어도 그대로 맞고 뒤까지 꿰뚫린다', () => {
    Sigils.acquire(world, 'sig_lightning');
    world.mana.value = 100;
    const fx = sigilDef('sig_lightning').effects;
    const spear = add('goblin_spear', 10, 6);
    spear.yaw = Math.atan2(-(6 - spear.x), -(6 - spear.z)); // 나를 본다 — 방패가 정면
    spear.ai = 'chase';
    spear.health = 1000;
    const behind = runnerAhead(8);
    behind.health = 1000;
    const blocked: unknown[] = [];
    world.events.on('shot_blocked', (p) => blocked.push(p));
    world.events.on('barrier_blocked', (p) => blocked.push(p));
    const hits = beamHits(1);
    // 방패는 물리를 받아 내는 물건이라 전기는 타고 들어간다 (2026-08-25)
    expect(blocked).toEqual([]);
    expect(hits).toEqual([spear.id, behind.id]);
    expect(spear.health).toBe(1000 - fx['damage']!);
    expect(behind.health).toBe(1000 - fx['damage']!);
  });

  it('관통 뇌창: 주술사의 방어막은 피해만 막는다 — 적중이 안 돼도 전기는 옆으로 옮겨붙는다', () => {
    Sigils.acquire(world, 'sig_lightning');
    world.mana.value = 100;
    const fx = sigilDef('sig_lightning').effects;
    const warden = add('warden', 12, 6);
    warden.ai = 'chase';
    const behind = runnerAhead(10); // (16, 6) — 주술사에게서 4m
    behind.health = 1000;
    const wardenFull = warden.health;
    const blocked: { kind?: string }[] = [];
    world.events.on('barrier_blocked', (p) => blocked.push(p as { kind?: string }));
    const hits = beamHits(1);
    expect(hits).toEqual([]); // 빔은 꿰지 못하고 방어막에서 멈춘다
    expect(blocked).toEqual([expect.objectContaining({ kind: 'magic' })]);
    expect(warden.health).toBe(wardenFull); // 주술사는 멀쩡하다
    // 다만 막힌 그 자리가 사슬의 시작점이 된다 (2026-08-25)
    expect(behind.health).toBeCloseTo(1000 - fx['damage']! * fx['chainFalloff']!, 6);
  });

  it('관통 뇌창: 사슬 도중의 주술사는 피해 없이 전기를 넘겨준다 — 거기서 끊기지 않는다', () => {
    Sigils.acquire(world, 'sig_lightning');
    world.mana.value = 100;
    const fx = sigilDef('sig_lightning').effects;
    const dmg = fx['damage']!;
    const fall = fx['chainFalloff']!;
    const target = runnerAhead(5); // 직격 (11, 6)
    const warden = add('warden', 13, 7.5); // 직격점에서 2.5m — 사슬 첫 칸
    const last = add('goblin_runner', 16, 4.6); // 주술사에서 4.2m — 사슬 둘째 칸 (빔 선 밖)
    target.health = 1000;
    last.health = 1000;
    const wardenFull = warden.health;
    const hits = beamHits(1);
    expect(hits).toEqual([target.id]);
    expect(target.health).toBe(1000 - dmg);
    expect(warden.health).toBe(wardenFull); // 거쳐 가기만 한다
    // 주술사를 지난 만큼 한 칸이 소모된다 — 그다음은 두 번 깎인 값
    expect(last.health).toBeCloseTo(1000 - dmg * fall * fall, 6);
  });

  /** 얼음 화살이 다 날아갈 때까지 (최대 lifeTicks) 투사체만 돌린다 — 적 AI 는 안 돌린다 */
  function flyBolt(): void {
    for (let i = 0; i < 200 && world.projectiles.some((p) => p.kind === 'frost'); i++) {
      Projectiles.tick(world, DT);
    }
  }

  it('서리 중첩: 1타 약한 둔화(4) → 2타 완전 둔화(6) → 3타 빙결(8, 깨질 때 14) → 4타 빙결 +1초(10) → 5타도 10', () => {
    Sigils.acquire(world, 'sig_frost');
    world.mana.value = 500;
    const fx = sigilDef('sig_frost').effects;
    const full = 1000;
    const hit = runnerAhead(6); // x=12 — 직격
    const near = runnerAhead(12); // x=18 — 6m 옆, 반경 안
    hit.health = full;
    near.health = full;
    const far = runnerAhead(20); // 14m 밖
    const shoot = (): void => {
      world.spell.cooldowns = {}; // 쿨다운은 여기서 안 본다
      castSlot(1);
      flyBolt();
    };
    const dmg = (stack: number): number =>
      fx['damageFirst']! + (Math.min(stack, fx['damageCapStack']!) - 1) * fx['damageStep']!;
    const dBreak = fx['breakDamage']!;
    expect([dmg(1), dmg(2), dmg(3), dmg(4), dmg(5), dBreak]).toEqual([4, 6, 8, 10, 10, 14]); // 2026-08 결정
    const frozenEvents: number[] = [];
    world.events.on('enemy_frozen', (p) => frozenEvents.push((p as { stacks: number }).stacks));
    // 1타 — 얼지 않고 약하게 느려진다, 피해 6
    shoot();
    for (const e of [hit, near]) {
      expect(e.frostStacks).toBe(1);
      expect(e.freezeTicks ?? 0).toBe(0);
      expect(e.slowMul).toBe(fx['slowMulLight']);
      expect(e.slowTicks).toBe(fx['slowTicks']);
      expect(e.health).toBe(full - dmg(1));
    }
    expect(far.frostStacks ?? 0).toBe(0);
    // 2타 — 완전 둔화, 피해 +12
    shoot();
    expect(hit.frostStacks).toBe(2);
    expect(hit.freezeTicks ?? 0).toBe(0);
    expect(hit.slowMul).toBe(fx['slowMul']);
    expect(hit.health).toBe(full - dmg(1) - dmg(2));
    expect(frozenEvents).toEqual([]); // 둔화만으론 빙결 이벤트가 없다
    // 3타 — 빙결 2초, 피해 +12, 깨질 때 15 예약
    shoot();
    expect(frozenEvents).toEqual([3, 3]); // hit·near 둘 다 얼었다
    expect(hit.frostStacks).toBe(3);
    expect(hit.freezeTicks).toBe(fx['freezeTicks']);
    expect(hit.slowTicks).toBe(fx['freezeTicks']! + fx['afterFreezeSlowTicks']!);
    expect(hit.health).toBe(full - dmg(1) - dmg(2) - dmg(3));
    expect(hit.frozenDamage).toBe(dBreak);
    // 4타 — 빙결이 1초 늘고, 피해 +12, 깨질 때 피해는 그대로 15
    shoot();
    expect(hit.frostStacks).toBe(4);
    expect(hit.freezeTicks).toBe(fx['freezeTicks']! + fx['freezeExtraTicks']!);
    expect(hit.health).toBe(full - dmg(1) - dmg(2) - dmg(3) - dmg(4));
    expect(hit.frozenDamage).toBe(dBreak);
    // 얼음이 깨지면 15 한 번 — 그 뒤 둔화, 둔화가 끝나면 겹이 0
    const frozenFor = hit.freezeTicks!; // 루프 안에서 줄어드는 값이라 미리 잡아 둔다
    for (let i = 0; i < frozenFor; i++) Enemies.tick(world, DT);
    expect(hit.freezeTicks).toBe(0);
    expect(hit.health).toBe(full - dmg(1) - dmg(2) - dmg(3) - dmg(4) - dBreak);
    expect(hit.frostStacks).toBe(4); // 둔화 중엔 겹이 남는다
    while ((hit.slowTicks ?? 0) > 0) Enemies.tick(world, DT);
    expect(hit.frostStacks).toBe(0);
  });

  it('빙결 중 다른 공격을 받으면 얼음이 깨지며 피해 1.5배 + 깨질 때 피해 14', () => {
    Sigils.acquire(world, 'sig_lightning');
    world.mana.value = 100;
    const fx = sigilDef('sig_frost').effects;
    const e = runnerAhead(6);
    e.health = 1000;
    e.ai = 'chase';
    e.freezeTicks = 90;
    e.slowTicks = 270;
    e.frozenDamage = fx['breakDamage']!;
    const ended: { shattered?: boolean }[] = [];
    world.events.on('enemy_freeze_ended', (p) => ended.push(p as { shattered?: boolean }));
    castSlot(1); // 뇌창 한 타 1.5 → ×1.5 = 2.25, + 깨질 때 14 = 16.25
    const bolt = sigilDef('sig_lightning').effects['damage']!;
    const shatterHit = bolt * fx['hitShatterMul']! + fx['breakDamage']!;
    expect(shatterHit).toBe(16.25); // 2026-08-25 뇌창 피해를 세 번 반으로 줄인 뒤
    expect(e.health).toBe(1000 - shatterHit);
    expect(e.freezeTicks).toBe(0);
    expect(ended).toEqual([expect.objectContaining({ shattered: true })]);
    // 깨질 때 피해는 이미 들어갔다 — 시간이 지나도 두 번 안 깎인다
    for (let i = 0; i < 5; i++) Enemies.tick(world, DT);
    expect(e.health).toBe(1000 - shatterHit);
    expect(e.frozenDamage).toBe(0);
    // 깨진 뒤 둔화 상태(겹 유지)에선 둔화 배율이 붙는다 — 겹 0 이면 배율이 없다
    e.frostStacks = 0;
    world.spell.cooldowns = {};
    world.mana.value = 100;
    castSlot(1);
    expect(e.health).toBe(1000 - shatterHit - bolt);
  });

  it('둔화만 걸린 적은 1겹 ×1.1, 2겹 이상 ×1.2 로 더 아프다', () => {
    Sigils.acquire(world, 'sig_lightning');
    world.mana.value = 300;
    const fx = sigilDef('sig_frost').effects;
    const bolt = sigilDef('sig_lightning').effects['damage']!;
    const e = runnerAhead(6);
    e.health = 1000;
    e.frostStacks = 1;
    e.slowTicks = 100;
    e.slowMul = 0.7;
    castSlot(1);
    expect(e.health).toBeCloseTo(1000 - bolt * fx['hitMulStack1']!, 6);
    expect(fx['hitMulStack1']).toBe(1.1);
    e.frostStacks = 2;
    world.spell.cooldowns = {};
    castSlot(1);
    expect(e.health).toBeCloseTo(1000 - bolt * fx['hitMulStack1']! - bolt * fx['hitMulStack2']!, 6);
    expect(fx['hitMulStack2']).toBe(1.2);
    expect(e.freezeTicks ?? 0).toBe(0); // 둔화는 깨질 것이 없다 — 그대로 둔화
  });

  it('빙결은 겹이 쌓여도 freezeMaxTicks(3초)를 넘지 않는다', () => {
    Sigils.acquire(world, 'sig_frost');
    world.mana.value = 500;
    const fx = sigilDef('sig_frost').effects;
    const e = runnerAhead(6);
    e.health = 100000;
    const shoot = (): void => { world.spell.cooldowns = {}; castSlot(1); flyBolt(); };
    for (let i = 0; i < 6; i++) shoot(); // 6겹
    expect(e.frostStacks).toBe(6);
    expect(e.freezeTicks).toBe(fx['freezeMaxTicks']);
    expect(fx['freezeMaxTicks']).toBe(180);
  });

  it('서리 자신의 피해는 얼음을 깨지 않는다 (겹 4 = 연장), 화상 DoT 도 깨지 않는다', () => {
    Sigils.acquire(world, 'sig_frost');
    world.mana.value = 500;
    const e = runnerAhead(6);
    e.health = 1000;
    const shoot = (): void => { world.spell.cooldowns = {}; castSlot(1); flyBolt(); };
    shoot(); shoot(); shoot(); // 3겹 — 빙결
    expect(e.freezeTicks).toBeGreaterThan(0);
    const fz = e.freezeTicks!;
    shoot(); // 4겹 — 깨지지 않고 연장
    expect(e.freezeTicks).toBeGreaterThan(fz);
    e.burnTicks = 10;
    e.burnDamagePerTick = 1;
    Projectiles.tick(world, DT); // 화상 한 틱
    expect(e.freezeTicks).toBeGreaterThan(0);
  });

  it('서리 이펙트 크기: 첫 타는 작고, 창 안에 이어지는 둘째부터는 제 크기', () => {
    Sigils.acquire(world, 'sig_frost');
    world.mana.value = 500;
    const fx = sigilDef('sig_frost').effects;
    const scales: number[] = [];
    world.events.on('frost_nova', (p) => scales.push((p as { scale: number }).scale));
    const shoot = (): void => { world.spell.cooldowns = {}; castSlot(1); flyBolt(); };
    shoot();
    shoot();
    shoot();
    expect(scales).toEqual([fx['firstHitFxScale'], 1, 1]);
    world.tick += fx['comboWindowTicks']! + 1; // 창이 지나면 다시 처음
    shoot();
    expect(scales[3]).toBe(fx['firstHitFxScale']);
  });

  it('서리 볼트: 폭발통에 맞으면 통이 점화되고 그 자리에서도 광역 빙결이 터진다 — 통 발밑에 서리 자국', () => {
    Sigils.acquire(world, 'sig_frost');
    world.mana.value = 100;
    const fx = sigilDef('sig_frost').effects;
    world.barrels.push({ id: 1, x: 14, z: 6, alive: true, hits: 0, fuseTicks: -1 });
    const beside = add('goblin_runner', 17, 7.5); // 통에서 3.4m — 사선 밖
    world.player.pitch = -0.15; // 통은 눈높이보다 낮다 — 살짝 내려다보고 쏜다 (8m 앞에서 y≈0.4)
    const impacts: { surface: string; x: number; z: number }[] = [];
    world.events.on('frost_impact', (p) => impacts.push(p as { surface: string; x: number; z: number }));
    castSlot(1);
    flyBolt();
    expect(world.barrels[0]!.fuseTicks).toBe(0); // 점화
    expect(beside.frostStacks).toBe(1); // 통 주변도 서리가 쌓인다
    expect(beside.slowMul).toBe(fx['slowMulLight']);
    expect(impacts).toHaveLength(1);
    expect(impacts[0]).toMatchObject({ surface: 'floor', x: 14, z: 6 });
  });

  it('서리 볼트: 적을 직격하면 그 적의 발밑 바닥에 서리 자국이 생긴다', () => {
    Sigils.acquire(world, 'sig_frost');
    world.mana.value = 100;
    const hit = runnerAhead(6);
    const impacts: { surface: string; x: number; z: number; y: number }[] = [];
    world.events.on('frost_impact', (p) => impacts.push(p as { surface: string; x: number; z: number; y: number }));
    castSlot(1);
    flyBolt();
    expect(impacts).toHaveLength(1);
    expect(impacts[0]!.surface).toBe('floor');
    expect(impacts[0]!.y).toBe(0);
    expect(impacts[0]!.x).toBeCloseTo(hit.x, 5);
    expect(impacts[0]!.z).toBeCloseTo(hit.z, 5);
  });

  it('서리 볼트: 아무도 안 맞고 벽에 닿아도 그 자리에서 터져 주변 적이 언다', () => {
    Sigils.acquire(world, 'sig_frost');
    world.mana.value = 100;
    const fx = sigilDef('sig_frost').effects;
    const byWall = add('goblin_runner', 22, 7.6); // 사선(z=6)에서 비켜 있고, 벽(x=28) 근처
    const farBack = add('goblin_runner', 10, 7.6); // 벽에서 18m
    castSlot(1);
    flyBolt();
    expect(byWall.frostStacks).toBe(1);
    expect(byWall.slowTicks).toBe(fx['slowTicks']);
    expect(farBack.frostStacks ?? 0).toBe(0);
  });

  it('빙결: freezeTicks 동안 이동도 공격 예고도 멈추고, 풀리면 둔화 상태로 이어진다', () => {
    const e = add('goblin_spear', 12, 6); // 6m — 추격 거리
    e.ai = 'chase';
    e.freezeTicks = 30;
    e.slowTicks = 90;
    e.slowMul = 0.4;
    const x0 = e.x;
    const yaw0 = e.yaw;
    const ended: number[] = [];
    world.events.on('enemy_freeze_ended', (p) => ended.push((p as { enemyId: number }).enemyId));
    for (let i = 0; i < 30; i++) Enemies.tick(world, DT);
    expect(e.x).toBe(x0); // 한 발짝도 못 움직였다
    expect(e.yaw).toBe(yaw0); // 몸도 못 돌렸다
    expect(e.ai).toBe('chase'); // 공격 예고로 넘어가지 않았다
    expect(ended).toEqual([e.id]);
    expect(e.freezeTicks).toBe(0);
    expect(e.slowTicks).toBe(60); // 빙결 동안에도 전체 지속은 흘렀다
    for (let i = 0; i < 10; i++) Enemies.tick(world, DT);
    expect(e.x).toBeLessThan(x0); // 이제 (느리게) 다가온다
  });

  it('둔화는 돌진에도 걸린다 — 얼렸는데 전속력으로 달려들면 안 된다', () => {
    // 창병의 돌진 공격(chargeAttack.chargeSpeed). 러너는 돌진 공격이 없고 그냥 빨리 걷는다
    // 겹치면 분리 로직이 서로 밀어내 이동량을 더럽힌다 — 복도 폭 안에서 2m 떨어뜨린다
    const quick = add('goblin_spear', 24, 5);
    const slow = add('goblin_spear', 24, 7);
    slow.slowTicks = 60;
    slow.slowMul = 0.4;
    for (const r of [quick, slow]) {
      r.ai = 'charging';
      r.attackMode = 'charge'; // 돌진 공격 정의(chargeSpeed)를 쓰게
      r.chargeTargetX = 6;
      r.chargeTargetZ = r.z; // 제 줄을 따라 곧장 -x 로
      r.timer = 30;
    }
    const q0 = quick.x;
    const s0 = slow.x;
    Enemies.tick(world, DT);
    const qMoved = q0 - quick.x;
    const sMoved = s0 - slow.x;
    expect(qMoved).toBeGreaterThan(0);
    expect(sMoved).toBeCloseTo(qMoved * 0.4, 3);
  });

  it('해동: 둔화가 끝나는 틱에 enemy_thawed 가 한 번 난다', () => {
    const e = add('goblin_spear', 20, 6);
    e.ai = 'chase';
    e.slowTicks = 3;
    e.slowMul = 0.4;
    const thawed: number[] = [];
    world.events.on('enemy_thawed', (p) => thawed.push((p as { enemyId: number }).enemyId));
    for (let i = 0; i < 10; i++) Enemies.tick(world, DT);
    expect(thawed).toEqual([e.id]);
    expect(e.slowTicks).toBe(0);
  });

  it('서리 둔화: 얼어붙은 적은 같은 시간에 덜 움직인다', () => {
    // 창병은 걸어서 다가온다 (러너는 돌진이라 비교가 안 된다). 둘 다 사거리 밖에서 출발
    const slow = add('goblin_spear', 16, 6);
    const quick = add('goblin_spear', 24, 6);
    for (const e of [slow, quick]) e.ai = 'chase';
    slow.slowTicks = 60;
    slow.slowMul = 0.4;
    const s0 = slow.x;
    const q0 = quick.x;
    for (let i = 0; i < 20; i++) Enemies.tick(world, DT);
    const slowMoved = s0 - slow.x;
    const quickMoved = q0 - quick.x;
    expect(quickMoved).toBeGreaterThan(0.5);
    expect(slowMoved).toBeGreaterThan(0);
    expect(slowMoved).toBeLessThan(quickMoved * 0.6);
  });

  it('그림자 이동: 보는 방향으로 날아가되 벽 앞에서 멈추고, 잠깐 무적이다', () => {
    Sigils.acquire(world, 'sig_shadowstep');
    world.mana.value = 100;
    const fx = sigilDef('sig_shadowstep').effects;
    // +x 벽은 x=28. 22m 떨어져 있으니 range(20) 안에서 멈춘다
    castSlot(1);
    expect(world.player.x).toBeCloseTo(6 + fx['range']!, 5);
    expect(world.player.z).toBeCloseTo(6, 5);
    expect(world.player.prevX).toBe(world.player.x); // 보간 잔상 없음
    expect(world.player.iframeTicks).toBeGreaterThanOrEqual(fx['iframeTicks']!);
    expect(world.mana.value).toBe(100 - fx['manaCost']!);
  });

  it('그림자 이동: 벽이 먼저면 벽 앞에서 멈춘다', () => {
    Sigils.acquire(world, 'sig_shadowstep');
    world.mana.value = 100;
    world.player.x = 20; // 벽(28)까지 8m — range 보다 짧다
    castSlot(1);
    expect(world.player.x).toBeLessThan(28 - balance.player.radius + 0.01);
    expect(world.player.x).toBeGreaterThan(27);
  });

  it('스킬 교체(Q): 빈 칸을 건너뛰며 돌고, 끝에서 처음으로 온다', () => {
    Sigils.acquire(world, 'sig_fireball'); // 칸 0
    Sigils.acquire(world, 'sig_frost'); // 칸 1
    Sigils.assignSkill(world, 3, 'sig_frost'); // 칸 1 → 3. 칸 1·2 는 빈다
    expect(world.selectedSkill).toBe(0);
    const cycle = (): void => {
      world.input = { ...Input.emptySnapshot(), cycleSkill: true };
      Sigils.tick(world, DT);
      world.input = Input.emptySnapshot();
    };
    cycle();
    expect(world.selectedSkill).toBe(3); // 1·2 건너뜀
    cycle();
    expect(world.selectedSkill).toBe(0); // 처음으로
  });

  it('선택 칸이 비면 찬 칸으로 옮겨 간다 — 사용 키가 헛방이 되지 않게', () => {
    Sigils.acquire(world, 'sig_fireball');
    Sigils.acquire(world, 'sig_frost');
    world.selectedSkill = 0;
    Sigils.assignSkill(world, 0, null);
    expect(world.selectedSkill).toBe(1);
  });

  it('선택한 스킬 사용(가운데 클릭): 선택 칸의 스킬이 나간다, 직접 지정(Z~V)이 우선', () => {
    Sigils.acquire(world, 'sig_fireball');
    Sigils.acquire(world, 'sig_frost');
    world.mana.value = 200;
    world.selectedSkill = 1;
    world.input = { ...Input.emptySnapshot(), castPressed: true, useSelectedSkill: true };
    Projectiles.tick(world, DT);
    world.input = Input.emptySnapshot();
    expect(Projectiles.skillCooldown(world, 'sig_frost')).toBeGreaterThan(0); // 선택 칸 = 서리
    expect(world.projectiles.filter((p) => p.kind === 'fireball')).toHaveLength(0); // 화염구는 안 나갔다
    world.input = { ...Input.emptySnapshot(), castPressed: true, useSkill: 1, useSelectedSkill: true };
    Projectiles.tick(world, DT);
    expect(world.projectiles.filter((p) => p.kind === 'fireball')).toHaveLength(1); // 직접 지정 Z = 칸 0 화염구
  });

  it('스킬 쿨다운은 스킬별이다 — 서리를 쓴 직후에도 뇌창은 나간다', () => {
    Sigils.acquire(world, 'sig_frost');
    Sigils.acquire(world, 'sig_lightning');
    world.mana.value = 200;
    castSlot(1);
    expect(Projectiles.skillCooldown(world, 'sig_frost')).toBeGreaterThan(0);
    const before = world.mana.value;
    castSlot(2);
    expect(world.mana.value).toBeLessThan(before);
    castSlot(2); // 쿨다운 중 — 조용히 무시, 마나 그대로
    expect(world.mana.value).toBe(before - sigilDef('sig_lightning').effects['manaCost']!);
  });
});
