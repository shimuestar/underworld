// 성소 로비 (지하 1층 위, 2026-09-07) — 15×15 십자형 예배당. 부활 마법진(S)·대제단(A)·현관 계단(X)·사제·상인.
// 손으로 그린 맵이 실제로 걸어 다닐 수 있고 배치가 벽에 박히지 않았는지 CI 가 본다 (Zone.test 와 같은 검사).

import { describe, expect, it } from 'vitest';
import lobby from '../../data/levels/lobby.json';
import { Level } from './GridLoader';
import { spawnEnemies, spawnNpcs } from './Spawner';

const SOLID = new Set(['#', 'D', 'G', 'C', 'P']);
const grid = lobby.grid as string[];
const at = (col: number, row: number): string =>
  row < 0 || row >= grid.length || col < 0 || col >= grid[row]!.length ? '#' : grid[row]![col]!;

function flood(start: [number, number]): Set<string> {
  const seen = new Set([`${start[0]},${start[1]}`]);
  const queue: [number, number][] = [start];
  while (queue.length) {
    const [c, r] = queue.shift()!;
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nc = c + dc;
      const nr = r + dr;
      if (SOLID.has(at(nc, nr)) || seen.has(`${nc},${nr}`)) continue;
      seen.add(`${nc},${nr}`);
      queue.push([nc, nr]);
    }
  }
  return seen;
}

function find(ch: string): [number, number] {
  for (let r = 0; r < grid.length; r++) {
    const c = grid[r]!.indexOf(ch);
    if (c >= 0) return [c, r];
  }
  throw new Error(`${ch} 없음`);
}

describe('성소 로비', () => {
  it('15×15, 교회 테마, 입구 계단 없음, 스폰(부활 마법진)이 정중앙 [7,7] 에서 북쪽(대제단)을 본다', () => {
    expect(grid).toHaveLength(15);
    expect(grid.every((row) => row.length === 15)).toBe(true);
    expect(lobby.theme).toBe('church');
    expect(lobby.entranceStairs).toBe(false);
    expect(find('S')).toEqual([7, 7]);
    const level = new Level(lobby as never);
    expect(level.theme).toBe('church');
    expect(level.spawn).toEqual({ x: 30, z: 30 });
    // facing N = (0,-1) → yaw 0
    expect(Math.abs(level.spawnYaw)).toBeLessThan(1e-9);
    expect(level.spawnWall).toEqual({ dc: 0, dr: 1 }); // 등진 쪽은 남쪽
  });

  it('대제단 A 는 북쪽 성단에, 현관 계단 X 는 남쪽 벽을 등지고 있다 — 스폰에서 둘 다 닿는다', () => {
    const [ac, ar] = find('A');
    const [xc, xr] = find('X');
    expect(ar).toBeLessThan(7);
    expect(ac).toBe(7);
    expect(xr).toBeGreaterThan(7);
    expect(at(xc, xr + 1)).toBe('#');
    const reach = flood(find('S'));
    expect(reach.has(`${ac},${ar}`)).toBe(true);
    expect(reach.has(`${xc},${xr}`)).toBe(true);
    // 바닥이 전부 이어진다 — 고립된 칸이 없다
    let floors = 0;
    for (let r = 0; r < 15; r++) for (let c = 0; c < 15; c++) if (!SOLID.has(at(c, r))) floors++;
    expect(reach.size).toBe(floors);
    const level = new Level(lobby as never);
    expect(level.exitPos).not.toBeNull();
    expect(level.altarPos).toEqual({ x: (ac + 0.5) * 4, z: (ar + 0.5) * 4 });
  });

  it('적은 없고 NPC 는 사제·상인 둘 — 둘 다 바닥에 서고 대제단 상호작용 반경(2.4) 과 겹치지 않는다', () => {
    const level = new Level(lobby as never);
    expect(spawnEnemies(lobby.entities as never, level)).toHaveLength(0);
    const npcs = spawnNpcs(lobby.entities as never, level);
    expect(npcs.map((n) => n.kind).sort()).toEqual(['merchant', 'priest']);
    for (const n of npcs) {
      expect(level.solidAt(Math.floor(n.x / 4), Math.floor(n.z / 4))).toBe(false);
      expect(Math.hypot(n.x - level.altarPos!.x, n.z - level.altarPos!.z)).toBeGreaterThan(2.4 + 2.6);
    }
  });

  it('장식(열주·장의자·노점·촛대)은 바닥 칸에, 창은 벽 칸에 붙어 안쪽(dir)이 바닥이다 — 열주·장의자·노점은 차단 상자를 남긴다', () => {
    const level = new Level(lobby as never);
    let blockers = 0;
    for (const d of lobby.decor as { type: string; cell: number[]; dir?: string; span?: number }[]) {
      const [r, c] = d.cell as [number, number];
      if (d.type === 'window') {
        expect(at(c, r)).toBe('#');
        const n = d.dir === 'S' ? [0, 1] : d.dir === 'N' ? [0, -1] : d.dir === 'E' ? [1, 0] : [-1, 0];
        expect(SOLID.has(at(c + n[0]!, r + n[1]!))).toBe(false);
      } else {
        expect(SOLID.has(at(c, r))).toBe(false);
        if (d.type === 'pew') for (let i = 1; i < (d.span ?? 1); i++) expect(SOLID.has(at(c + i, r))).toBe(false);
        if (d.type !== 'candle') blockers++;
      }
    }
    // 제단 기둥 1 + 장식 차단 상자
    expect(level.props).toHaveLength(1 + blockers);
    // 스폰 자리(마법진)와 대제단 앞은 막히지 않는다
    for (const rect of level.props) {
      const inside = (x: number, z: number): boolean => x > rect.minX && x < rect.maxX && z > rect.minZ && z < rect.maxZ;
      expect(inside(level.spawn.x, level.spawn.z)).toBe(false);
      expect(inside(level.altarPos!.x, level.altarPos!.z + 1.5)).toBe(false);
    }
  });

  it('밝은 분위기 — 환경광이 던전(0.04)보다 훨씬 높고 벽걸이 횃불이 없다 (빛은 색유리창이 낸다)', () => {
    expect(lobby.lighting.ambient).toBeGreaterThanOrEqual(0.5);
    expect(lobby.lighting.torches).toHaveLength(0);
    expect((lobby.decor as { type: string }[]).filter((d) => d.type === 'window').length).toBeGreaterThanOrEqual(8);
  });
});
