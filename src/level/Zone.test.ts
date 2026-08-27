// 1구역 세 층이 실제로 걸어 다닐 수 있는 맵인지 검증한다.
// scripts/checklevel.mjs 와 같은 검사지만, 이쪽은 CI 가 돌린다 —
// 레벨 JSON 을 손대다 길을 막아 버리면 여기서 걸린다.

import { describe, expect, it } from 'vitest';
import z01f1 from '../../data/levels/z01_f1.json';
import z01f2 from '../../data/levels/z01_f2.json';
import z01f3 from '../../data/levels/z01_f3.json';
import { Level } from './GridLoader';
import { isSpawnable, spawnBarrels, spawnChests, spawnEnemies } from './Spawner';
import { balance } from '../core/Balance';
import { enemyDef } from '../core/Entities';

const ALTAR_SAFE_RADIUS = balance.altar.safeRadius;

/** 벽 안에 박힌 배치를 문자열로 돌려준다 (없으면 빈 배열) */
function wallCheck(grid: Grid, cell: number[], what: string): string[] {
  const [r, c] = cell as [number, number];
  return SOLID.has(at(grid, c, r)) ? [`${what}[${r},${c}]='${at(grid, c, r)}'`] : [];
}

const ZONE = [z01f1, z01f2, z01f3];
const SOLID = new Set(['#', 'D', 'G', 'C']);
/** 열 수 있는 벽 — 열렸다고 치면 지나간다 */
const OPENABLE = new Set(['D', 'G', 'C']);

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
  it('세 층이 순서대로 이어진다 — 1층 시작, 3층이 마지막', () => {
    expect(ZONE.map((l) => l.id)).toEqual(['z01_f1', 'z01_f2', 'z01_f3']);
    // 층마다 입구(S)와 출구(X)가 하나씩 — 이 둘이 층을 잇는다
    for (const json of ZONE) {
      expect(find(json.grid, 'S')).toHaveLength(1);
      expect(find(json.grid, 'X')).toHaveLength(1);
    }
  });

  it('난이도가 층마다 올라간다 — 쉬움 / 보통 / 어려움', () => {
    // 정예 = 패링·관통탄·기동을 요구하는 적. 잡몹 수가 아니라 이 비율이 체감 난이도를 만든다
    const ELITE = new Set(['goblin_spear', 'warden', 'spider_large', 'goblin_chieftain']);
    const stat = ZONE.map((json) => {
      const ents = json.entities.filter(
        (e) => e.type !== 'barrel' && e.type !== 'chest' && !('group' in e),
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

  it('한 층이 유독 빽빽하지 않다 — 밀도가 층마다 두 배 넘게 뛰지 않는다', () => {
    const density = ZONE.map((json) => {
      const ents = json.entities.filter(
        (e) => e.type !== 'barrel' && e.type !== 'chest' && !('group' in e),
      );
      const floors = json.grid.join('').split('').filter((ch) => !SOLID.has(ch)).length;
      return ents.length / floors;
    });
    for (const d of density) expect(d).toBeLessThan(0.15); // 100칸당 15마리를 넘으면 계속 몰린다
    expect(Math.max(...density) / Math.min(...density)).toBeLessThan(2.5);
  });

  it('구역 보스(족장)는 마지막 층에만 있다 — 출구를 잠그는 것이 보스다', () => {
    const bossFloors = ZONE.filter((l) => l.entities.some((e) => e.type === 'goblin_chieftain'));
    expect(bossFloors.map((l) => l.id)).toEqual(['z01_f3']);
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

      it('제단이 있고, 밟지 않고 출구까지 가는 우회로도 있다', () => {
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
          .filter((e) => e.type !== 'barrel' && e.type !== 'chest')
          .filter((e) => !isSpawnable(e.type))
          .map((e) => e.type);
        expect([...new Set(stubs)]).toEqual([]);
      });

      it('제단 안전 반경 안에 적을 두지 않는다 — 스포너가 조용히 지운다', () => {
        const level = new Level(json);
        const dropped = json.entities
          .filter((e) => e.type !== 'barrel' && e.type !== 'chest')
          .filter((e) => {
            if (!level.altarPos) return false;
            const x = (e.cell[1]! + 0.5) * level.cellSize;
            const z = (e.cell[0]! + 0.5) * level.cellSize;
            return Math.hypot(x - level.altarPos.x, z - level.altarPos.z) <= ALTAR_SAFE_RADIUS;
          })
          .map((e) => `${e.type}[${e.cell}]`);
        expect(dropped).toEqual([]);
      });

      it('스포너가 배치를 하나도 흘리지 않는다', () => {
        const level = new Level(json);
        // 매복 대기조(group)는 트리거로 나오는 것이라 처음부터 안 선다 — 세지 않는다
        const enemies = json.entities.filter(
          (e) => e.type !== 'barrel' && e.type !== 'chest' && !('group' in e),
        );
        expect(spawnEnemies(json.entities, level)).toHaveLength(enemies.length);
        expect(spawnBarrels(json.entities, level)).toHaveLength(
          json.entities.filter((e) => e.type === 'barrel').length,
        );
        expect(spawnChests(json.entities, level)).toHaveLength(
          json.entities.filter((e) => e.type === 'chest').length,
        );
      });

      it('횃불이 전부 벽에 붙어 있다 — 안 붙으면 셀 가운데에 떠 천장에 매단 꼴이 된다', () => {
        const NEIGHBOURS = [[0, -1], [0, 1], [-1, 0], [1, 0]] as const;
        const floating = json.lighting.torches
          .filter(([row, col]) =>
            !NEIGHBOURS.some(([dc, dr]) => SOLID.has(at(grid, col! + dc, row! + dr))),
          )
          .map((t) => `[${t}]`);
        expect(floating).toEqual([]);
      });

      it('레버가 여는 대상이 실제 관문이다', () => {
        for (const t of json.triggers ?? []) {
          if (t.type !== 'lever') continue;
          const opens = (t as { opens?: number[] }).opens!;
          expect(at(grid, opens[1]!, opens[0]!)).toBe('G');
        }
      });
    });
  }
});
