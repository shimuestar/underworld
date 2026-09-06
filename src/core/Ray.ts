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

/**
 * 레이가 구체(중심 c, 반지름 r)와 만나는 최소 t(≥0)를 반환. 만나지 않으면 null. 원점이 구 안이면 0.
 * 방향은 정규화되지 않아도 된다(이차식의 a 로 흡수) — t 의 단위는 방향 벡터 길이 기준.
 * 약점 구체 판정(Entities.rayHitsWeakPoint)용 순수 함수
 */
export function rayVsSphere(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  cx: number,
  cy: number,
  cz: number,
  r: number,
): number | null {
  const lx = ox - cx;
  const ly = oy - cy;
  const lz = oz - cz;
  const c = lx * lx + ly * ly + lz * lz - r * r;
  if (c <= 0) return 0; // 원점이 구 안(또는 표면)
  const a = dx * dx + dy * dy + dz * dz;
  if (a === 0) return null;
  const b = 2 * (lx * dx + ly * dy + lz * dz);
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const sq = Math.sqrt(disc);
  const t0 = (-b - sq) / (2 * a);
  if (t0 >= 0) return t0;
  // 원점이 밖(c > 0)인데 가까운 근이 음수면 구가 뒤에 있다 — 먼 근도 음수
  return null;
}
