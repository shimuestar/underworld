// 1구역 네 층이 실제로 걸어 다닐 수 있는 맵인지 검증한다.
// scripts/checklevel.mjs 와 같은 검사지만, 이쪽은 CI 가 돌린다 —
// 레벨 JSON 을 손대다 길을 막아 버리면 여기서 걸린다.
// 4층 「무저갱 우리」(B3-5)는 보스 결투 층(bossArena) — 난이도 곡선·밀도 비교에서 빼고(기획서 §10.3 (a)) 아레나 규칙(격자 §10.1)을 따로 본다.

import { describe, expect, it } from 'vitest';
import z01f1 from '../../data/levels/z01_f1.json';
import z01f2 from '../../data/levels/z01_f2.json';
import z01f3 from '../../data/levels/z01_f3.json';
import z01f4 from '../../data/levels/z01_f4.json';
import { Level } from './GridLoader';
import { isSpawnable, spawnBarrels, spawnChests, spawnEnemies, spawnTraps } from './Spawner';
import { balance } from '../core/Balance';
import { enemyDef } from '../core/Entities';

const ALTAR_SAFE_RADIUS = balance.altar.safeRadius;

/** 벽 안에 박힌 배치를 문자열로 돌려준다 (없으면 빈 배열) */
function wallCheck(grid: Grid, cell: number[], what: string): string[] {
  const [r, c] = cell as [number, number];
  return SOLID.has(at(grid, c, r)) ? [`${what}[${r},${c}]='${at(grid, c, r)}'`] : [];
}

const ZONE = [z01f1, z01f2, z01f3, z01f4];
/** 보스 결투 층(bossArena) — 잡몹 곡선·밀도 비교에서 뺀다(기획서 §10.3 (a), 결정 12). 층 자체 검사(길·배치·계단)는 그대로 받는다 */
const isBossArena = (json: unknown): boolean => (json as { bossArena?: boolean }).bossArena === true;
const CURVE = ZONE.filter((l) => !isBossArena(l));
const SOLID = new Set(['#', 'D', 'G', 'C', 'P']); // P = 기둥(거수 아레나·시험방, B2-5) — 벽처럼 막힌다
/** 열 수 있는 벽 — 열렸다고 치면 지나간다 */
const OPENABLE = new Set(['D', 'G', 'C']);
const NEIGHBOURS = [[0, -1], [0, 1], [-1, 0], [1, 0]] as const;

type Grid = string[];
const at = (grid: Grid, col: number, row: number): string =>
  row < 0 || row >= grid.length || col < 0 || col >= grid[row]!.length ? '#' : grid[row]![col]!;

function flood(grid: Grid, start: [number, number], passable: (ch: string) => boolean): Set<string> {
  const seen = new Set([`${start[0]},${start[1]}`]);
  const queue: [number, number][] = [start];
  while (queue.length) {
    const [c, r] = queue.shift()!;
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nc = c + dc;
      const nr = r + dr;
      const key = `${nc},${nr}`;
      if (seen.has(key) || !passable(at(grid, nc, nr))) continue;
      seen.add(key);
      queue.push([nc, nr]);
    }
  }
  return seen;
}

function find(grid: Grid, ch: string): [number, number][] {
  const out: [number, number][] = [];
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < grid[r]!.length; c++) if (at(grid, c, r) === ch) out.push([r, c]);
  }
  return out;
}

describe('1구역 층 구성', () => {
  it('네 층이 순서대로 이어진다 — 1층 시작, 3층 족장, 4층 거수 결투 층이 마지막', () => {
    expect(ZONE.map((l) => l.id)).toEqual(['z01_f1', 'z01_f2', 'z01_f3', 'z01_f4']);
    expect(ZONE.map(isBossArena)).toEqual([false, false, false, true]);
    // 층마다 입구(S)와 출구(X)가 하나씩 — 이 둘이 층을 잇는다
    for (const json of ZONE) {
      expect(find(json.grid, 'S')).toHaveLength(1);
      expect(find(json.grid, 'X')).toHaveLength(1);
    }
  });

  it('난이도가 층마다 올라간다 — 쉬움 / 보통 / 어려움 (보스 결투 층은 곡선 밖)', () => {
    // 정예 = 패링·관통탄·기동을 요구하는 적. 잡몹 수가 아니라 이 비율이 체감 난이도를 만든다
    const ELITE = new Set(['goblin_spear', 'warden', 'spider_large', 'goblin_chieftain', 'ghoul', 'skeleton_shield', 'skeleton_hammer']); // 해골 방패병·해머병은 정예(검사는 잡몹급)
    const stat = CURVE.map((json) => {
      // 층 보스는 곡선에서 뺀다 — 보스 체력은 잡몹 로스터의 난이도 곡선과 별개 축이다
      const ents = json.entities.filter(
        (e) =>
          e.type !== 'barrel' && e.type !== 'chest' && !e.type.startsWith('prop_') && !e.type.startsWith('trap_') && !('group' in e) && !enemyDef(e.type).boss,
      );
      const elites = ents.filter((e) => ELITE.has(e.type)).length;
      const hp = ents.reduce((sum, e) => sum + enemyDef(e.type).health, 0);
      return { id: json.id, count: ents.length, hp, eliteRatio: elites / ents.length };
    });
    for (let i = 1; i < stat.length; i++) {
      const prev = stat[i - 1]!;
      const cur = stat[i]!;
      expect(cur.hp, `${cur.id} 총 HP 가 ${prev.id} 보다 많아야 한다`).toBeGreaterThan(prev.hp);
      expect(
        cur.eliteRatio,
        `${cur.id} 정예 비율이 ${prev.id} 보다 높아야 한다`,
      ).toBeGreaterThan(prev.eliteRatio);
    }
    // 마지막 층은 절반 넘게 정예여야 "어려움" 이라 부를 만하다
    expect(stat.at(-1)!.eliteRatio).toBeGreaterThan(0.5);
    // 첫 층은 잡몹 위주여야 배우는 자리가 된다
    expect(stat[0]!.eliteRatio).toBeLessThan(0.35);
  });

  it('한 층이 유독 빽빽하지 않다 — 밀도가 층마다 두 배 넘게 뛰지 않는다 (보스 결투 층은 비교 밖, 상한만)', () => {
    const densityOf = (json: (typeof ZONE)[number]): number => {
      const ents = json.entities.filter(
        (e) => e.type !== 'barrel' && e.type !== 'chest' && !e.type.startsWith('prop_') && !e.type.startsWith('trap_') && !('group' in e),
      );
      const floors = json.grid.join('').split('').filter((ch) => !SOLID.has(ch)).length;
      return ents.length / floors;
    };
    for (const json of ZONE) expect(densityOf(json)).toBeLessThan(0.15); // 100칸당 15마리를 넘으면 계속 몰린다
    const density = CURVE.map(densityOf);
    expect(Math.max(...density) / Math.min(...density)).toBeLessThan(2.5);
  });

  it('구역 보스 — 족장은 3층에만, 거수(scythe_behemoth)는 4층 결투 층에만 있다 — 출구를 잠그는 것이 보스다', () => {
    const chiefFloors = ZONE.filter((l) => l.entities.some((e) => e.type === 'goblin_chieftain'));
    expect(chiefFloors.map((l) => l.id)).toEqual(['z01_f3']);
    const behemothFloors = ZONE.filter((l) => l.entities.some((e) => e.type === 'scythe_behemoth'));
    expect(behemothFloors.map((l) => l.id)).toEqual(['z01_f4']);
    // 결투 층의 주인은 boss 배치 플래그로 출구 봉인을 쥔다(Spawner floorBoss) — def.boss 와 이중이지만 배치 의도가 읽히게
    expect(z01f4.entities.filter((e) => e.type === 'scythe_behemoth').every((e) => (e as { boss?: boolean }).boss === true)).toBe(true);
  });

  for (const json of ZONE) {
    describe(`${json.id} — ${json.name}`, () => {
      const grid: Grid = json.grid;
      const [sr, sc] = find(grid, 'S')[0]!;
      const [xr, xc] = find(grid, 'X')[0]!;
      const reachable = flood(grid, [sc, sr], (ch) => !SOLID.has(ch) || OPENABLE.has(ch));

      it('행 길이가 고르고 27칸 이상 넓다', () => {
        expect(new Set(grid.map((r) => r.length)).size).toBe(1);
        expect(grid[0]!.length).toBeGreaterThanOrEqual(27);
        expect(grid.length).toBeGreaterThanOrEqual(21);
      });

      it('격리된 바닥이 없다 — 문을 다 열면 모든 칸에 닿는다', () => {
        const orphans: string[] = [];
        for (let r = 0; r < grid.length; r++) {
          for (let c = 0; c < grid[r]!.length; c++) {
            if (SOLID.has(at(grid, c, r))) continue;
            if (!reachable.has(`${c},${r}`)) orphans.push(`[${r},${c}]`);
          }
        }
        expect(orphans).toEqual([]);
      });

      it('입구에서 출구까지 갈 수 있다', () => {
        expect(reachable.has(`${xc},${xr}`)).toBe(true);
      });

      it('모든 층에 제단이 있고, 밟지 않고 출구까지 가는 우회로도 있다', () => {
        // 2026-09-01 사용자 결정 — 층마다 제단 하나 (1층 제외 규칙은 폐지, 둥지는 거미 굴로 이주)
        expect(find(grid, 'A').length).toBeGreaterThan(0);
        const bypass = flood(grid, [sc, sr], (ch) => (!SOLID.has(ch) || OPENABLE.has(ch)) && ch !== 'A');
        expect(bypass.has(`${xc},${xr}`)).toBe(true);
      });

      it('배치물이 벽 안에 박혀 있지 않다', () => {
        const inWall: string[] = [];
        for (const e of json.entities) inWall.push(...wallCheck(grid, e.cell, e.type));
        for (const t of json.lighting.torches) inWall.push(...wallCheck(grid, t, '횃불'));
        for (const g of json.glyphs ?? []) inWall.push(...wallCheck(grid, g.cell, '글리프'));
        expect(inWall).toEqual([]);
      });

      it('적 타입이 전부 실제로 스폰되는 것들이다 — 스텁을 놓으면 그 자리가 빈다', () => {
        const stubs = json.entities
          .filter((e) => e.type !== 'barrel' && e.type !== 'chest' && !e.type.startsWith('prop_') && !e.type.startsWith('trap_'))
          .filter((e) => !isSpawnable(e.type))
          .map((e) => e.type);
        expect([...new Set(stubs)]).toEqual([]);
      });

      it('제단 안전 반경 안에 적을 두지 않는다 — 스포너가 조용히 지운다', () => {
        const level = new Level(json);
        const dropped = json.entities
          .filter((e) => e.type !== 'barrel' && e.type !== 'chest' && !e.type.startsWith('prop_') && !e.type.startsWith('trap_'))
          .filter((e) => {
            if (!level.altarPos) return false;
            const x = (e.cell[1]! + 0.5) * level.cellSize;
            const z = (e.cell[0]! + 0.5) * level.cellSize;
            return Math.hypot(x - level.altarPos.x, z - level.altarPos.z) <= ALTAR_SAFE_RADIUS;
          })
          .map((e) => `${e.type}[${e.cell}]`);
        expect(dropped).toEqual([]);
      });

      it('스폰 근처에 적이 없다 — 내려오자마자 전투가 붙으면 안 된다', () => {
        const level = new Level(json);
        const near = json.entities
          .filter((e) => e.type !== 'barrel' && e.type !== 'chest' && !e.type.startsWith('prop_') && !e.type.startsWith('trap_'))
          .filter((e) => {
            const x = (e.cell[1]! + 0.5) * level.cellSize;
            const z = (e.cell[0]! + 0.5) * level.cellSize;
            return Math.hypot(x - level.spawn.x, z - level.spawn.z) < 16;
          })
          .map((e) => `${e.type}[${e.cell}]`);
        expect(near).toEqual([]);
      });

      it('스포너가 배치를 하나도 흘리지 않는다', () => {
        const level = new Level(json);
        // 매복 대기조(group)는 트리거로 나오는 것이라 처음부터 안 선다 — 세지 않는다
        const enemies = json.entities.filter(
          (e) => e.type !== 'barrel' && e.type !== 'chest' && !e.type.startsWith('prop_') && !e.type.startsWith('trap_') && !('group' in e),
        );
        expect(spawnEnemies(json.entities, level)).toHaveLength(enemies.length);
        expect(spawnBarrels(json.entities, level)).toHaveLength(
          json.entities.filter((e) => e.type === 'barrel').length,
        );
        expect(spawnChests(json.entities, level)).toHaveLength(
          json.entities.filter((e) => e.type === 'chest').length,
        );
        expect(spawnTraps(json.entities, level)).toHaveLength(
          json.entities.filter((e) => e.type.startsWith('trap_')).length,
        );
      });

      it('함정은 바닥 칸에, 계단 8m 밖에, 다트는 노즐 벽(-dir)이 진짜 벽이어야 한다', () => {
        const DIRS: Record<string, [number, number]> = { N: [-1, 0], S: [1, 0], E: [0, 1], W: [0, -1] };
        const stairs: [number, number][] = [];
        json.grid.forEach((row, r) => [...row].forEach((ch, c) => { if (ch === 'S' || ch === 'X') stairs.push([r, c]); }));
        for (const e of json.entities) {
          if (!e.type.startsWith('trap_')) continue;
          const [r, c] = e.cell as [number, number];
          expect(at(json.grid, c, r)).toBe('.');
          for (const [sr, sc] of stairs) {
            expect(Math.hypot((c - sc) * json.cellSize, (r - sr) * json.cellSize)).toBeGreaterThanOrEqual(8);
          }
          if (e.type === 'trap_dart' || e.type === 'trap_dart_auto') {
            const [dr, dc] = DIRS[(e as { dir?: string }).dir ?? 'N']!;
            expect(at(json.grid, c - dc, r - dr)).toBe('#');
          }
          if (e.type === 'trap_net' || e.type === 'trap_pendulum' || e.type === 'trap_rockfall') {
            const [dr, dc] = DIRS[(e as { dir?: string }).dir ?? 'N']!;
            expect(at(json.grid, c + dr, r + dc)).toBe('#'); // 통행 축 양옆 벽
            expect(at(json.grid, c - dr, r - dc)).toBe('#');
          }
        }
      });

      it('배치물 중 통·상자·기믹·함정을 뺀 나머지는 전부 적 정의가 있다 — 층 로드 보스 판정이 던지지 않게', () => {
        // main.loadFloor 가 같은 필터로 enemyDef 를 부른다. 새 배치 접두(trap_ 등)를 필터에 안 넣으면
        // 층을 갈아 끼우는 순간 예외가 난다 (2026-09-02 트랩 시험방 진입에서 실측)
        const rest = json.entities.filter(
          (e) => e.type !== 'barrel' && e.type !== 'chest' && !e.type.startsWith('prop_') && !e.type.startsWith('trap_'),
        );
        for (const e of rest) expect(() => enemyDef(e.type)).not.toThrow();
      });

      it('낙석 잔해가 전부 내려와도 출구와 제단에 갈 수 있다 — 소프트락 방지', () => {
        const rocks = new Set(
          json.entities.filter((e) => e.type === 'trap_rockfall').map((e) => `${e.cell[1]},${e.cell[0]}`),
        );
        if (rocks.size === 0) return;
        const blocked = json.grid.map((row, r) =>
          [...row].map((ch, c) => (rocks.has(`${c},${r}`) ? '#' : ch)).join(''),
        );
        let start: [number, number] = [0, 0];
        json.grid.forEach((row, r) => { const c = row.indexOf('S'); if (c >= 0) start = [c, r]; });
        const reach = flood(blocked, start, (ch) => !SOLID.has(ch) || OPENABLE.has(ch));
        json.grid.forEach((row, r) => [...row].forEach((ch, c) => {
          if (ch === 'X' || ch === 'A') expect(reach.has(`${c},${r}`)).toBe(true);
        }));
      });

      it('횃불이 전부 진짜 벽(#)에 붙어 있다 — 문에 걸면 열릴 때 허공에 남는다', () => {
        const floating = json.lighting.torches
          .filter(([row, col]) => !NEIGHBOURS.some(([dc, dr]) => at(grid, col! + dc, row! + dr) === '#'))
          .map((t) => `[${t}]`);
        expect(floating).toEqual([]);
      });

      it('스폰(S)이 진짜 벽에 붙어 있다 — 계단 입구가 그 벽을 등지고 선다', () => {
        const [sr2, sc2] = find(grid, 'S')[0]!;
        expect(
          NEIGHBOURS.some(([dc, dr]) => at(grid, sc2 + dc, sr2 + dr) === '#'),
          `스폰 [${sr2},${sc2}] 이 벽에서 떨어져 있다 — 아치가 허공에 뜬다`,
        ).toBe(true);
      });

      it('시작 시선이 계단 반대쪽을 본다 — 내려오자마자 등 뒤 벽을 보면 안 된다', () => {
        const level = new Level(json);
        const fx = -Math.sin(level.spawnYaw);
        const fz = -Math.cos(level.spawnYaw);
        // 등진 벽 방향과 시선의 내적이 음수여야 "벽을 등졌다"
        expect(fx * level.spawnWall.dc + fz * level.spawnWall.dr).toBeLessThan(-0.9);
      });

      it('출구(X)도 진짜 벽에 붙어 있다 — 계단이 그 벽을 파고든다', () => {
        const [xr2, xc2] = find(grid, 'X')[0]!;
        expect(NEIGHBOURS.some(([dc, dr]) => at(grid, xc2 + dc, xr2 + dr) === '#')).toBe(true);
      });

      it('레버가 여는 대상이 실제 관문이다', () => {
        for (const t of json.triggers ?? []) {
          if (t.type !== 'lever') continue;
          if ((t as { resets?: number[] }).resets) continue; // 함정 재생성 레버(시험방용)는 관문을 열지 않는다
          const opens = (t as { opens?: number[] }).opens!;
          expect(at(grid, opens[1]!, opens[0]!)).toBe('G');
        }
      });
    });
  }
});

describe('4층 「무저갱 우리」 — 거수 아레나 (B3-5, 기획서 §10.1·§10.3)', () => {
  const json = z01f4;
  const grid: Grid = json.grid;
  const cs = json.cellSize;
  const level = new Level(json);
  const arena = json.arena;
  const [r0, c0, r1, c1] = arena.bounds as [number, number, number, number];
  const [hr, hc] = arena.home as [number, number];
  const inBounds = (r: number, c: number): boolean => r >= r0 && r <= r1 && c >= c0 && c <= c1;
  const cellsOf = (type: string): [number, number][] => json.entities.filter((e) => e.type === type).map((e) => e.cell as [number, number]);

  it('bossArena·arena{bounds, home} — Level 이 읽고, 경계는 11×9 바닥(기둥 포함), 홈은 경계 안 바닥', () => {
    expect(json.bossArena).toBe(true);
    expect(level.bossArena).toBe(true);
    expect(level.arena).toEqual(arena);
    expect(c1 - c0 + 1).toBe(11);
    expect(r1 - r0 + 1).toBe(9);
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) expect(['.', 'P']).toContain(at(grid, c, r));
    expect(inBounds(hr, hc)).toBe(true);
    expect(at(grid, hc, hr)).toBe('.');
    // 경계 둘레는 벽(#·C·X·D) — 아레나는 우리다
    for (let c = c0 - 1; c <= c1 + 1; c++) {
      expect(SOLID.has(at(grid, c, r0 - 1)) || at(grid, c, r0 - 1) === 'X').toBe(true);
      expect(SOLID.has(at(grid, c, r1 + 1))).toBe(true);
    }
    for (let r = r0 - 1; r <= r1 + 1; r++) {
      expect(SOLID.has(at(grid, c0 - 1, r))).toBe(true);
      expect(SOLID.has(at(grid, c1 + 1, r))).toBe(true);
    }
  });

  it('기둥 P 넷 — 기획서 격자 (3,3)(9,3)(3,7)(9,7) 자리(경계 기준), 사이 24m / 16m 돌격 레인, 4×4m 단일 셀', () => {
    const pillars = find(grid, 'P').map(([r, c]) => [r - r0 + 1, c - c0 + 1]);
    expect(pillars.sort()).toEqual([[3, 3], [3, 9], [7, 3], [7, 9]].sort());
    expect((9 - 3) * cs).toBe(24);
    expect((7 - 3) * cs).toBe(16);
    for (const [r, c] of find(grid, 'P')) expect(level.solidAt(c, r)).toBe(true);
  });

  it('보스 스폰 B — scythe_behemoth 하나, boss 플래그, 홈 칸에 잠들어 있다(alertRadius 18)', () => {
    const boss = json.entities.filter((e) => e.type === 'scythe_behemoth');
    expect(boss).toHaveLength(1);
    expect(boss[0]!.cell).toEqual([hr, hc]);
    expect((boss[0] as { boss?: boolean }).boss).toBe(true);
    expect(enemyDef('scythe_behemoth').alertRadius).toBe(18);
    expect(spawnEnemies(json.entities, level).find((e) => e.type === 'scythe_behemoth')?.floorBoss).toBe(true);
  });

  it('출구 X 는 북쪽 벽감(보스 뒤, 경계 위 벽줄 가운데) — 뒤가 진짜 벽. 남쪽 문 D 하나가 경계에 붙어 있다(봉쇄 대상)', () => {
    const [xr, xc] = find(grid, 'X')[0]!;
    expect(xr).toBe(r0 - 1);
    expect(xc).toBe(hc);
    expect(at(grid, xc, xr - 1)).toBe('#');
    const doors = find(grid, 'D').filter(([r, c]) => (r === r0 - 1 || r === r1 + 1) && c >= c0 && c <= c1);
    expect(doors).toEqual([[r1 + 1, hc]]);
    expect(level.doors.find((d) => d.row === r1 + 1 && d.col === hc)?.byLever).toBe(false); // 손으로 여는 문 — 레버 불필요
  });

  it('기름 함정 O 둘·균열벽 C 둘(뒤 1칸 벽감에 상자, 벽감은 경계 밖)', () => {
    const oil = cellsOf('trap_oil');
    expect(oil).toHaveLength(2);
    for (const [r, c] of oil) expect(inBounds(r, c)).toBe(true);
    const cracks = find(grid, 'C');
    expect(cracks).toHaveLength(2);
    const chests = cellsOf('chest');
    expect(chests).toHaveLength(2);
    for (const [r, c] of cracks) {
      expect(r >= r0 && r <= r1 && (c === c0 - 1 || c === c1 + 1)).toBe(true); // 경계 옆 벽에 박힌 균열벽
      const nicheC = c === c0 - 1 ? c - 1 : c + 1;
      expect(at(grid, nicheC, r)).toBe('.');
      expect(chests.some(([cr, cc]) => cr === r && cc === nicheC)).toBe(true);
      expect(inBounds(r, nicheC)).toBe(false); // 벽감은 경계 밖 — 보스가 목표를 잡지 않는다
      // 벽감은 막혀 있다 — 균열벽 말고는 드나들 곳이 없다
      expect(at(grid, nicheC, r - 1)).toBe('#');
      expect(at(grid, nicheC, r + 1)).toBe('#');
      expect(at(grid, c === c0 - 1 ? nicheC - 1 : nicheC + 1, r)).toBe('#');
    }
    for (const t of json.triggers) expect(t.type === 'crack_wall' ? at(grid, t.cell[1]!, t.cell[0]!) : 'C').toBe('C');
  });

  it('최소 로스터 9(창병 3·궁수 2·구울 2·거미 2) — 전부 경계 밖, 보스 홈에서 18m 밖(포효 기상 반경), 결투는 1:1', () => {
    const roster = json.entities.filter(
      (e) => e.type !== 'barrel' && e.type !== 'chest' && !e.type.startsWith('prop_') && !e.type.startsWith('trap_') && e.type !== 'scythe_behemoth',
    );
    expect(roster).toHaveLength(9);
    const count = (type: string): number => roster.filter((e) => e.type === type).length;
    expect([count('goblin_spear'), count('goblin_archer'), count('ghoul'), count('spider_small')]).toEqual([3, 2, 2, 2]);
    for (const e of roster) {
      const [r, c] = e.cell as [number, number];
      expect(inBounds(r, c), `${e.type}[${r},${c}]`).toBe(false);
      expect(Math.hypot((c - hc) * cs, (r - hr) * cs), `${e.type}[${r},${c}]`).toBeGreaterThanOrEqual(enemyDef('scythe_behemoth').alertRadius!);
    }
  });

  it('제단은 아레나 앞 로비에(경계 밖) — 상점이 이 보스의 준비다', () => {
    const [ar, ac] = find(grid, 'A')[0]!;
    expect(inBounds(ar, ac)).toBe(false);
  });
});

describe('몬스터 시험방 — 기둥 P (B2-5)', () => {
  it('P 넷이 가운데 표식(S)에서 동서남북 4칸에 서고, 소환 부채꼴(시선 앞 ±arcDeg/2 · maxDist)을 막지 않는다', async () => {
    const json = (await import('../../data/levels/test_monsters.json')).default as { grid: string[]; cellSize: number; legend: Record<string, string> };
    const grid = json.grid;
    expect(json.legend['P']).toBe('pillar');
    const pillars = find(grid, 'P');
    const [sr, sc] = find(grid, 'S')[0]!;
    expect(pillars).toHaveLength(4);
    expect(pillars.map(([r, c]) => `${r - sr},${c - sc}`).sort()).toEqual(['-4,0', '0,-4', '0,4', '4,0']);
    // 격자로도 벽이다 — Level 이 P 를 막힌 칸으로 본다
    const level = new Level(json as never);
    for (const [r, c] of pillars) expect(level.solidAt(c, r)).toBe(true);
    // 소환 부채꼴 — 스폰이 등진 벽이 없으니 북쪽을 등지고 남(+z)을 본다. 앞 maxDist 안·±arcDeg/2 안의 칸에 P 가 없다
    const cs = json.cellSize;
    const fan = balance.monsterRoom.summon;
    const fx = -Math.sin(level.spawnYaw);
    const fz = -Math.cos(level.spawnYaw);
    for (const [r, c] of pillars) {
      const dx = (c + 0.5) * cs - level.spawn.x;
      const dz = (r + 0.5) * cs - level.spawn.z;
      const d = Math.hypot(dx, dz);
      const ang = (Math.acos((dx * fx + dz * fz) / d) * 180) / Math.PI;
      const inFan = d - cs * 0.5 <= fan.maxDist && ang <= fan.arcDeg / 2;
      expect(inFan, `P[${r},${c}] d=${d.toFixed(1)} ang=${ang.toFixed(0)}`).toBe(false);
    }
    // 시험방은 진행 층이 아니다 — ZONE 에 없다
    expect(ZONE.some((l) => l.id === 'test_monsters')).toBe(false);
  });
});
