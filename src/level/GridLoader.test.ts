import { describe, expect, it } from 'vitest';
import { Level } from './GridLoader';

// 4×4 셀, cellSize 4. 내부 (1,1)~(2,2)가 빈 공간, (2,2)에 기둥은 없음
const level = new Level({
  id: 'test',
  name: 'test',
  cellSize: 4,
  ceiling: 4,
  grid: [
    '####',
    '#S.#',
    '#..#',
    '####',
  ],
  lighting: { ambient: 0.04, torches: [] },
});

describe('Level', () => {
  it('스폰 위치는 셀 중앙', () => {
    expect(level.spawn).toEqual({ x: 6, z: 6 });
  });

  it('그리드 밖은 벽 취급', () => {
    expect(level.solidAt(-1, 0)).toBe(true);
    expect(level.solidAt(0, 99)).toBe(true);
  });

  it('D와 C는 벽 취급', () => {
    const withDoor = new Level({
      id: 't2',
      name: 't2',
      cellSize: 4,
      ceiling: 4,
      grid: ['####', '#SD#', '####'],
      lighting: { ambient: 0.04, torches: [] },
    });
    expect(withDoor.solidAt(2, 1)).toBe(true);
  });
});

describe('wallRayT', () => {
  it('+X 방향 — (6,6)에서 x=12 벽까지 t=6', () => {
    expect(level.wallRayT(6, 6, 1, 0)).toBeCloseTo(6);
  });

  it('-Z 방향 — (6,6)에서 z=4 벽까지 t=2', () => {
    expect(level.wallRayT(6, 6, 0, -1)).toBeCloseTo(2);
  });

  it('대각선 — 빈 셀을 지나 벽에 닿는다', () => {
    const inv = Math.SQRT1_2;
    const t = level.wallRayT(6, 6, inv, inv);
    // (6,6) → +X+Z 대각선: x=12 또는 z=12 경계 도달 시 t = 6/inv ≈ 8.485
    expect(t).toBeCloseTo(6 / inv, 3);
  });

  it('시야 판정 — 같은 방은 보이고 벽 너머는 안 보인다', () => {
    expect(level.hasLineOfSight(6, 6, 10, 10)).toBe(true);
    expect(level.hasLineOfSight(6, 6, 6, 20)).toBe(false);
  });
});

describe('slideMove', () => {
  it('벽으로 이동하면 반지름만큼 떨어져 멈춘다', () => {
    const body = { x: 6, z: 6 };
    level.slideMove(body, 0.4, -10, 0);
    expect(body.x).toBeCloseTo(4.4, 2);
    expect(body.z).toBe(6);
  });

  it('대각 입력 시 막힌 축만 잘리고 열린 축은 미끄러진다', () => {
    const body = { x: 6, z: 6 };
    level.slideMove(body, 0.4, -10, 3);
    expect(body.x).toBeCloseTo(4.4, 2);
    expect(body.z).toBeCloseTo(9, 2);
  });

  it('열린 공간에서는 그대로 이동한다', () => {
    const body = { x: 6, z: 6 };
    level.slideMove(body, 0.4, 2, 3);
    expect(body.x).toBeCloseTo(8, 5);
    expect(body.z).toBeCloseTo(9, 5);
  });
});
