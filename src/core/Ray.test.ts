import { describe, expect, it } from 'vitest';
import { rayVsAabb, rayVsSphere } from './Ray';

const box = { minX: 2, minY: 0, minZ: -1, maxX: 4, maxY: 2, maxZ: 1 };

describe('rayVsAabb', () => {
  it('정면 히트 — 진입 t를 반환한다', () => {
    expect(rayVsAabb(0, 1, 0, 1, 0, 0, box)).toBe(2);
  });

  it('빗나감 — null', () => {
    expect(rayVsAabb(0, 1, 5, 1, 0, 0, box)).toBeNull();
  });

  it('반대 방향 — null', () => {
    expect(rayVsAabb(0, 1, 0, -1, 0, 0, box)).toBeNull();
  });

  it('원점이 박스 안이면 0', () => {
    expect(rayVsAabb(3, 1, 0, 1, 0, 0, box)).toBe(0);
  });

  it('축과 평행하고 슬랩 밖 — null', () => {
    expect(rayVsAabb(0, 5, 0, 1, 0, 0, box)).toBeNull();
  });

  it('대각선 히트', () => {
    const t = rayVsAabb(0, 1, -3, 0.70710678, 0, 0.70710678, box);
    expect(t).not.toBeNull();
    expect(t!).toBeCloseTo(2 / 0.70710678, 3);
  });
});

describe('rayVsSphere', () => {
  // 중심 (5, 1, 0) 반지름 1
  it('정면 히트 — 표면 진입 t (중심 거리 − 반지름)', () => {
    expect(rayVsSphere(0, 1, 0, 1, 0, 0, 5, 1, 0, 1)).toBeCloseTo(4, 6);
  });

  it('스침 — 반지름 안쪽으로 비껴도 맞는다, 밖이면 null', () => {
    expect(rayVsSphere(0, 1, 0.9, 1, 0, 0, 5, 1, 0, 1)).not.toBeNull();
    expect(rayVsSphere(0, 1, 1.1, 1, 0, 0, 5, 1, 0, 1)).toBeNull();
  });

  it('반대 방향(구가 뒤) — null', () => {
    expect(rayVsSphere(0, 1, 0, -1, 0, 0, 5, 1, 0, 1)).toBeNull();
  });

  it('원점이 구 안이면 0', () => {
    expect(rayVsSphere(5.2, 1, 0, 1, 0, 0, 5, 1, 0, 1)).toBe(0);
  });

  it('정규화되지 않은 방향 — t 는 그 방향 벡터 길이 기준', () => {
    expect(rayVsSphere(0, 1, 0, 2, 0, 0, 5, 1, 0, 1)).toBeCloseTo(2, 6);
  });

  it('대각선 히트 — 중심을 지나는 레이의 t 는 거리 − 반지름', () => {
    const d = Math.hypot(3, 4);
    const t = rayVsSphere(0, 0, 0, 3 / d, 4 / d, 0, 3, 4, 0, 0.5);
    expect(t).not.toBeNull();
    expect(t!).toBeCloseTo(d - 0.5, 6);
  });

  it('영 벡터 방향 — null (원점이 밖일 때)', () => {
    expect(rayVsSphere(0, 1, 0, 0, 0, 0, 5, 1, 0, 1)).toBeNull();
  });
});
