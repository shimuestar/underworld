import { describe, expect, it } from 'vitest';
import { addDoorFrameBlockers, Level } from './GridLoader';

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

describe('blockedAhead — 막힌 몸의 선두 면 너머 칸(B2-5 거수 돌격 지형 충돌, moveAxis 기하)', () => {
  const R = 1.6; // 거수 몸 반경(AABB 반폭)
  const EPS = 0.01;
  const mk = (grid: string[]): Level => new Level({ id: 'ba', name: 'ba', cellSize: 4, ceiling: 4, grid, lighting: { ambient: 0.04, torches: [] } });

  it('기둥 P(col 3 row 2 = x 12~16 · z 8~12) 에 +X 로 막힌 몸 — 정면(겹침 3.2)·모서리 스침(0.1m)도 그 칸, 겹치지 않으면(막히지도 않는다) null', () => {
    const level = mk(['######', '#S...#', '#..P.#', '#....#', '######']);
    for (const [z, overlap] of [[10, 3.2], [12.2, 1.4], [13.5, 0.1]] as const) {
      const body = { x: 6, z };
      level.slideMove(body, R, 20, 0);
      expect(body.x, `z ${z}`).toBeCloseTo(12 - R, 2); // 기둥 앞 반경에 막혔다
      expect(Math.min(z + R, 12) - Math.max(z - R, 8), `z ${z}`).toBeCloseTo(overlap, 6);
      expect(level.blockedAhead(body, R, 1, 0, EPS), `z ${z}`).toEqual({ col: 3, row: 2, ch: 'P' });
    }
    const free = { x: 6, z: 13.7 }; // 몸 z 12.1~15.3 — 기둥을 안 겹친다: 막히지 않고 지나가며, 면 너머 칸은 바닥
    level.slideMove(free, R, 20, 0);
    expect(free.x).toBeGreaterThan(12);
    expect(level.blockedAhead({ x: 12 - R - 1e-3, z: 13.7 }, R, 1, 0, EPS)).toBeNull();
    // 멈춰 있거나(방향 0) 면이 벽에서 떨어져 있으면(1m 앞) null — 벽에 닿은 몸만 읽는다
    expect(level.blockedAhead({ x: 12 - R - 1e-3, z: 10 }, R, 0, 0, EPS)).toBeNull();
    expect(level.blockedAhead({ x: 12 - R - 1, z: 10 }, R, 1, 0, EPS)).toBeNull();
    // −X 로 서쪽 벽(col 0)에 막힌 몸 — 벽 문자 #
    const west = { x: 6, z: 10 };
    level.slideMove(west, R, -20, 0);
    expect(level.blockedAhead(west, R, -1, 0, EPS)).toEqual({ col: 0, row: 2, ch: '#' });
  });

  it('두 칸을 함께 겹치면 몸 중심이 든 칸(가장 넓게 겹친 칸) — 균열벽 C 와 일반 벽 # 이 나란한 남쪽 벽에 +Z 로 막힌 몸', () => {
    const level = mk(['######', '#S...#', '#....#', '#....#', '##C###']); // C = col 2 (x 8~12), row 4 (z 16~20)
    const onC = { x: 10.5, z: 10 }; // 몸 x 8.9~12.1 — C 3.1 / # 0.1
    level.slideMove(onC, R, 0, 20);
    expect(onC.z).toBeCloseTo(16 - R, 2);
    expect(level.blockedAhead(onC, R, 0, 1, EPS)).toEqual({ col: 2, row: 4, ch: 'C' });
    const onWall = { x: 12.5, z: 10 }; // 몸 x 10.9~14.1 — C 1.1 / # 2.1
    level.slideMove(onWall, R, 0, 20);
    expect(level.blockedAhead(onWall, R, 0, 1, EPS)).toEqual({ col: 3, row: 4, ch: '#' });
    // 비스듬한 진행(|dz| > |dx|)도 큰 축(Z)의 면을 본다
    expect(level.blockedAhead(onC, R, 0.2, 0.98, EPS)).toEqual({ col: 2, row: 4, ch: 'C' });
  });

  it('이동만 막는 소품(props)에 막힌 몸은 벽이 아니다 → null. 열린 문의 문설주(rayBlockers — 돌)는 벽이다 → 문 칸(바닥 문자)', () => {
    const level = mk(['######', '#S...#', '#..P.#', '#....#', '######']);
    level.props.push({ minX: 11.5, maxX: 11.8, minZ: 8, maxZ: 12 }); // 기둥 서쪽 면(x 12) 앞 0.2m 두께 0.3m 소품
    const body = { x: 6, z: 10 };
    level.slideMove(body, R, 20, 0);
    expect(body.x).toBeCloseTo(11.5 - R, 2); // 소품에 막혔다 — 기둥 면은 0.5m 더 앞
    expect(level.blockedAhead(body, R, 1, 0, EPS)).toBeNull();
    // 문 — D(col 2 row 2 = x 8~12 · z 8~12)를 열고 문틀을 세운다. 몸 폭 3.2 < 칸 4 라 옆 벽 # 는 안 겹치고 문설주(각 0.95m)만 막는다
    const door = mk(['#####', '#S..#', '##D##', '#...#', '#####']);
    door.openCell(2, 2);
    addDoorFrameBlockers(door, 2, 2);
    expect(door.solidAt(2, 2)).toBe(false);
    const atDoor = { x: 10, z: 6 };
    door.slideMove(atDoor, R, 0, 20);
    expect(atDoor.z).toBeCloseTo(8 - R, 2); // 문설주에 막혔다
    expect(door.blockedAhead(atDoor, R, 0, 1, EPS)).toEqual({ col: 2, row: 2, ch: '.' });
    // 문설주에서 1m 떨어진 몸은 아무것도 안 닿았다
    expect(door.blockedAhead({ x: 10, z: 8 - R - 1 }, R, 0, 1, EPS)).toBeNull();
  });
});

describe('기둥 P (B2-5, 거수 아레나·시험방)', () => {
  const withPillar = new Level({
    id: 't3',
    name: 't3',
    cellSize: 4,
    ceiling: 4,
    grid: ['######', '#S...#', '#..P.#', '#....#', '######'],
    lighting: { ambient: 0.04, torches: [] },
  });

  it('벽 취급 — 이동을 막고 시야·레이를 가린다', () => {
    expect(withPillar.solidAt(3, 2)).toBe(true);
    expect(withPillar.solidAt(2, 2)).toBe(false);
    // (6,10) → +X 로 걸으면 기둥(x 12..16) 앞 반지름만큼에서 멈춘다
    const body = { x: 6, z: 10 };
    withPillar.slideMove(body, 0.4, 20, 0);
    expect(body.x).toBeCloseTo(12 - 0.4, 2);
    expect(body.z).toBe(10);
    // 기둥 너머는 안 보인다, 옆으로는 보인다
    expect(withPillar.hasLineOfSight(6, 10, 18, 10)).toBe(false);
    expect(withPillar.hasLineOfSight(6, 6, 18, 6)).toBe(true);
    expect(withPillar.wallRayT(6, 10, 1, 0)).toBeCloseTo(6, 6);
    expect(withPillar.charAt(3, 2)).toBe('P');
  });
});
