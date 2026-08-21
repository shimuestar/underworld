// 레이-AABB 교차 (슬랩 방식). 적 히트박스 판정용 순수 함수.
// Three.js Raycaster는 틱 루프에서 쓰기엔 무겁다 — docs/architecture.md §3.

export interface Aabb {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

/**
 * 원점 (ox,oy,oz), 방향 (dx,dy,dz)의 레이가 box와 만나는 최소 t(≥0)를 반환.
 * 만나지 않으면 null. 원점이 박스 안이면 0.
 */
export function rayVsAabb(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  box: Aabb,
): number | null {
  let tMin = -Infinity;
  let tMax = Infinity;

  const axes: [number, number, number, number][] = [
    [ox, dx, box.minX, box.maxX],
    [oy, dy, box.minY, box.maxY],
    [oz, dz, box.minZ, box.maxZ],
  ];

  for (const [o, d, lo, hi] of axes) {
    if (d === 0) {
      if (o < lo || o > hi) return null;
      continue;
    }
    let t1 = (lo - o) / d;
    let t2 = (hi - o) / d;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) return null;
  }

  if (tMax < 0) return null;
  return Math.max(tMin, 0);
}
