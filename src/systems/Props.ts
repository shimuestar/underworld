// 부술 수 있는 기믹 — 항아리·궤짝·뼈 무더기·석관·광차 (디아블로식 파괴 재미).
// 겉보기 같아도 결과는 부수는 순간 롤: 빈손 / 전리품(골드·물약·탄약·수류탄·배터리) /
// 매복(타입별 몬스터) / 폭발(심지 0.5초 뒤 — 부숴봐야 안다).
// 파괴 자체(상태·차단·prop_broken)는 core/World.breakProp·damageProp 이 맡고
// 판정은 Weapons/Projectiles 가 한다 — 여기서는 결과 롤과 심지·폭발만.

import { balance } from '../core/Balance';
import { explodeAt } from '../core/Explosion';
import { alertNearbyAt, pushEnemy, type World } from '../core/World';
import { spawnEnemyAt } from '../level/Spawner';

let nextLootId = 990000; // 비석(960000)·구울 머리(980000) 대역과 구분
let nextAmbushId = 850000; // 슬라임 분열(700000)·상자 각인(800000) 대역과 구분

export type PropTypeCfg = (typeof balance.props.types)['prop_jar'];

export function propTypeCfg(type: string): PropTypeCfg | undefined {
  return (balance.props.types as Record<string, PropTypeCfg>)[type];
}

export type PropOutcome = 'empty' | 'loot' | 'ambush' | 'explode';

/** 파괴 롤 — 타입별 가중치에서 하나. rand 를 주입받아 테스트가 결정적이다 */
export function rollOutcome(cfg: PropTypeCfg, rand: () => number): PropOutcome {
  const entries: [PropOutcome, number][] = [
    ['empty', cfg.empty],
    ['loot', cfg.loot],
    ['ambush', cfg.ambush],
    ['explode', cfg.explode],
  ];
  const total = entries.reduce((sum, [, w]) => sum + w, 0);
  let r = rand() * total;
  for (const [outcome, w] of entries) {
    r -= w;
    if (r < 0) return outcome;
  }
  return 'empty';
}

/** 전리품 종류 롤 — 공용 가중치 테이블 */
export function rollLootKind(
  rand: () => number,
): 'gold' | 'potion' | 'mana' | 'ammo' | 'grenade' | 'battery' {
  const lt = balance.props.loot;
  const entries: [ReturnType<typeof rollLootKind>, number][] = [
    ['gold', lt.gold],
    ['potion', lt.potion],
    ['mana', lt.mana],
    ['ammo', lt.ammo],
    ['grenade', lt.grenade],
    ['battery', lt.battery],
  ];
  const total = entries.reduce((sum, [, w]) => sum + w, 0);
  let r = rand() * total;
  for (const [kind, w] of entries) {
    r -= w;
    if (r < 0) return kind;
  }
  return 'gold';
}

/** 구독. 시작 시 1회 — 어떤 경로로 부서지든(해머·총·화살·폭발 연쇄) prop_broken 은
 *  정확히 한 번 나므로 이 하나만 들으면 롤이 중복되지 않는다 */
export function init(world: World): void {
  world.events.on('prop_broken', (payload) => {
    const info = payload as { id: number; type: string; x: number; z: number };
    const prop = world.props.find((pr) => pr.id === info.id);
    const cfg = propTypeCfg(info.type);
    if (!prop || !cfg) return;
    // 파괴음은 크다 — 열린 칸을 따라 주변이 깬다 (닫힌 문 안쪽 방은 못 듣는다)
    alertNearbyAt(world, info.x, info.z, balance.props.noiseRadius, balance.enemyAi.noticeDelayTicks);
    const outcome = rollOutcome(cfg, Math.random);
    if (outcome === 'loot') {
      spawnLoot(world, info.x, info.z, cfg);
    } else if (outcome === 'ambush') {
      spawnAmbush(world, info.x, info.z, cfg);
    } else if (outcome === 'explode') {
      // 작은방 배치(noExplode)는 폭발이 빈손으로 바뀐다 — 좁은 방 폭발은 억울하다
      if (prop.noExplode) return;
      prop.fuseTicks = balance.props.fuseTicks; // 치익 — 도망칠 찰나는 준다
      world.events.emit('prop_fuse_lit', { id: info.id, x: info.x, z: info.z });
    }
  });
}

function spawnLoot(world: World, x: number, z: number, cfg: PropTypeCfg): void {
  const lt = balance.props.loot;
  const kind = rollLootKind(Math.random);
  // 플레이어 '반대쪽' 호로만 떨어진다 — 때리자마자 입에 들어오면 뭘 먹었는지 모른다.
  // 바닥에 완전히 놓인 뒤(lootNoMagnetTicks)에야 자석·픽업이 문다
  const p = world.player;
  const adx = x - p.x;
  const adz = z - p.z;
  const away = Math.hypot(adx, adz) > 0.001 ? Math.atan2(adx, adz) : Math.random() * Math.PI * 2;
  const halfArc = ((balance.props.scatterAwayArcDeg / 2) * Math.PI) / 180;
  const ang = away + (Math.random() - 0.5) * 2 * halfArc;
  const r = balance.props.scatterRadius * (0.5 + Math.random() * 0.5);
  const ix = x + Math.sin(ang) * r;
  const iz = z + Math.cos(ang) * r;
  const noMagnetTicks = balance.props.lootNoMagnetTicks;
  if (kind === 'gold') {
    const amount = Math.round(
      (lt.goldMin + Math.random() * (lt.goldMax - lt.goldMin)) * (cfg.goldMul ?? 1),
    );
    world.groundItems.push({ id: nextLootId++, kind: 'gold', x: ix, z: iz, amount, noMagnetTicks });
  } else if (kind === 'ammo') {
    world.groundItems.push({
      id: nextLootId++, kind: 'ammo', x: ix, z: iz, amount: lt.ammoAmount, noMagnetTicks,
    });
  } else {
    world.groundItems.push({ id: nextLootId++, kind, x: ix, z: iz, noMagnetTicks });
  }
  world.events.emit('prop_loot', { kind, x: ix, z: iz });
}

function spawnAmbush(world: World, x: number, z: number, cfg: PropTypeCfg): void {
  const count = cfg.ambushMin + Math.floor(Math.random() * (cfg.ambushMax - cfg.ambushMin + 1));
  const types = cfg.ambushTypes as string[];
  for (let i = 0; i < count; i++) {
    const type = types[Math.floor(Math.random() * types.length)]!;
    const ang = Math.random() * Math.PI * 2;
    const enemy = spawnEnemyAt(type, x + Math.sin(ang) * 0.3, z + Math.cos(ang) * 0.3, nextAmbushId++);
    enemy.ai = 'chase'; // 튀어나오자마자 성나 있다
    enemy.noticeTicks = balance.enemyAi.noticeDelayTicks;
    pushEnemy(enemy, Math.sin(ang), Math.cos(ang), 1.2 + Math.random() * 0.8, 16); // 흩어져 나온다
    world.enemies.push(enemy);
    world.events.emit('prop_ambush', { enemyType: type, x: enemy.x, z: enemy.z });
  }
}

/** 심지 카운트다운 — 폭발 당첨 기믹이 0.5초 뒤 터진다. Barrels 와 같은 선감소 규약 */
export function tick(world: World, _dt: number): void {
  for (const prop of world.props) {
    if (prop.fuseTicks < 0) continue;
    if (prop.fuseTicks > 0) {
      prop.fuseTicks--;
      if (prop.fuseTicks > 0) continue;
    }
    prop.fuseTicks = -1;
    const ex = balance.props.explode;
    const cfg = propTypeCfg(prop.type);
    explodeAt(world, prop.x, prop.z, {
      radius: ex.radius,
      damage: ex.damage,
      damageFalloffMin: ex.damageFalloffMin,
      enemyKnockback: ex.enemyKnockback,
      playerKnockback: ex.playerKnockback,
      playerKnockbackTicks: ex.playerKnockbackTicks,
      noiseRadius: balance.props.noiseRadius * 2, // 폭발음은 파괴음보다 멀리
      fxHeight: (cfg?.height ?? 0.8) * 0.5,
    });
  }
}
