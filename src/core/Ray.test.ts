import { describe, expect, it } from 'vitest';
import { rayVsAabb } from './Ray';

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
