// ASCII 그리드 레벨 → 충돌 질의 + Three.js 지오메트리.
// grid 인덱스는 [row][col] = [z][x]. 월드 좌표: x = col * cellSize, z = row * cellSize.

import * as THREE from 'three';
import {
  dungeonCeilingTexture,
  dungeonFloorTexture,
  dungeonWallTexture,
} from '../render/DungeonTextures';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export interface GlyphDef {
  cell: number[];
  dir: string; // 'N' | 'S' | 'E' | 'W' — 문자가 붙는 벽면
  text: string;
}

export interface TriggerDef {
  type: string;
  cell: number[];
  opens?: number[];
  spawns?: string;
  note?: string;
}

export interface LevelDef {
  id: string;
  name: string;
  cellSize: number;
  ceiling: number;
  grid: string[];
  lighting: { ambient: number; torches: number[][] };
  glyphs?: GlyphDef[];
  triggers?: TriggerDef[];
}

/** 격자에서 찾아낸 잠긴 문 하나. dirX/dirZ 는 미닫이가 밀려 들어갈 방향(셀 단위) */
export interface DoorCell {
  row: number;
  col: number;
  x: number;
  z: number;
  dirX: number;
  dirZ: number;
  /** 레버로만 열리는 관문(G)인가. false 면 문 앞에서 E 로 직접 연다(D) */
  byLever: boolean;
}

/** 이동을 막는 셀. 잠긴 문(D)과 균열 벽(C)은 열리기 전까지 벽 취급. */
const SOLID_CHARS = new Set(['#', 'D', 'G', 'C']);
/** 제단 기둥 발자국(가로세로 m). 충돌과 시각 메시가 반드시 같은 값을 쓴다 —
 *  하나만 고치면 "보이는 것과 부딪히는 것"이 어긋난다 */
const ALTAR_FOOTPRINT = 1.1;

/** 벽 면에서 살짝 띄우는 수치 오차 방지용 여유 (튜닝값 아님) */
const SKIN = 1e-3;

export class Level {
  readonly cellSize: number;
  readonly ceiling: number;
  readonly grid: string[];
  readonly ambient: number;
  readonly torches: number[][];
  readonly spawn: { x: number; z: number };
  readonly altarPos: { x: number; z: number } | null;

  /** 그리드 셀이 아닌 막힌 구조물 (제단 기둥). slideMove가 함께 검사한다 */
  readonly props: { minX: number; maxX: number; minZ: number; maxZ: number }[] = [];
  readonly exitPos: { x: number; z: number } | null;
  readonly glyphs: GlyphDef[];
  /** 잠긴 문(D·G) — 미닫이가 밀려 들어갈 축도 여기서 정한다 */
  readonly doors: DoorCell[];

  /** 레버 — 당기면 연결된 관문(G)이 열린다. 연결은 레벨 데이터의 triggers */
  readonly levers: TriggerDef[];
  readonly rows: number;
  readonly cols: number;

  constructor(def: LevelDef) {
    this.cellSize = def.cellSize;
    this.ceiling = def.ceiling;
    this.grid = def.grid;
    this.ambient = def.lighting.ambient;
    this.torches = def.lighting.torches;
    this.rows = def.grid.length;
    this.cols = def.grid[0]?.length ?? 0;

    const spawn = this.findChar('S');
    if (!spawn) throw new Error(`레벨 ${def.id}에 스폰(S)이 없다`);
    this.spawn = {
      x: (spawn.col + 0.5) * this.cellSize,
      z: (spawn.row + 0.5) * this.cellSize,
    };

    // 셀 전체가 아니라 기둥 발자국만 막는다 — 셀을 통째로 solid 로 두면
    // 상호작용 반경(altar.radius) 안에 들어갈 수가 없다
    const half = ALTAR_FOOTPRINT / 2;
    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        if (this.charAt(col, row) !== 'A') continue;
        const cx = (col + 0.5) * this.cellSize;
        const cz = (row + 0.5) * this.cellSize;
        this.props.push({ minX: cx - half, maxX: cx + half, minZ: cz - half, maxZ: cz + half });
      }
    }

    const altar = this.findChar('A');
    this.altarPos = altar
      ? { x: (altar.col + 0.5) * this.cellSize, z: (altar.row + 0.5) * this.cellSize }
      : null;

    const exit = this.findChar('X');
    this.exitPos = exit
      ? { x: (exit.col + 0.5) * this.cellSize, z: (exit.row + 0.5) * this.cellSize }
      : null;

    this.glyphs = def.glyphs ?? [];
    this.levers = (def.triggers ?? []).filter(
      (trigger) => trigger.type === 'lever' && trigger.opens,
    );

    // 문은 격자에서 직접 찾는다. D 는 손으로, G 는 레버로 열린다.
    // 미닫이 방향: 벽이 이어지는 축으로 민다. 문 좌우가 벽이면 벽은 가로로 이어지므로
    // 가로(X)로 밀어 넣고, 위아래가 벽이면 세로(Z)로 민다
    this.doors = [];
    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        const ch = this.charAt(col, row);
        if (ch !== 'D' && ch !== 'G') continue;
        const alongX = this.charAt(col - 1, row) === '#' || this.charAt(col + 1, row) === '#';
        const dirX = alongX ? (this.charAt(col + 1, row) === '#' ? 1 : -1) : 0;
        const dirZ = alongX ? 0 : this.charAt(col, row + 1) === '#' ? 1 : -1;
        this.doors.push({
          row,
          col,
          x: (col + 0.5) * this.cellSize,
          z: (row + 0.5) * this.cellSize,
          dirX,
          dirZ,
          byLever: ch === 'G',
        });
      }
    }
  }

  /** 몸으로 막는 물체를 추가한다 (폭발통 등). 반환값을 removeBlocker 로 되돌린다.
   *  셀을 solid 로 만들지 않고 발자국만 막는다 — 레이캐스트(총알)는 그대로 통과하고
   *  맞히는 판정은 그 물체를 가진 시스템이 따로 한다 */
  addBlocker(x: number, z: number, half: number): {
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
  } {
    const blocker = { minX: x - half, maxX: x + half, minZ: z - half, maxZ: z + half };
    this.props.push(blocker);
    return blocker;
  }

  removeBlocker(blocker: { minX: number; maxX: number; minZ: number; maxZ: number }): void {
    const i = this.props.indexOf(blocker);
    if (i >= 0) this.props.splice(i, 1);
  }

  /** 셀을 바닥으로 연다 (문 개방 등). 이후 solidAt이 통과를 허용한다 */
  openCell(col: number, row: number): void {
    const line = this.grid[row];
    if (!line || col < 0 || col >= line.length) return;
    this.grid[row] = line.slice(0, col) + '.' + line.slice(col + 1);
  }

  charAt(col: number, row: number): string {
    return this.grid[row]?.[col] ?? '#';
  }

  /** 그리드 밖은 전부 벽 취급. */
  solidAt(col: number, row: number): boolean {
    return SOLID_CHARS.has(this.charAt(col, row));
  }

  /**
   * 2D 그리드 DDA 레이캐스트. (ox,oz)에서 방향 (dx,dz)로 나아가 처음 벽에 닿는
   * 레이 파라미터 t를 반환한다. 방향이 정규화된 3D 레이의 XZ 성분이면 t는 3D 거리 단위.
   * 그리드 밖은 벽 취급이므로 반드시 유한한 t를 반환한다.
   */
  wallRayT(ox: number, oz: number, dx: number, dz: number): number {
    return this.wallRayHit(ox, oz, dx, dz).t;
  }

  /**
   * wallRayT 와 같되 부딪힌 면의 축까지 돌려준다. axis 는 "이 축을 넘어가다 벽에
   * 들어갔다"는 뜻이라 벽의 법선이 그 축을 향한다 ('x' → 법선 ±X). 수류탄 튕김처럼
   * 반사 방향이 필요한 쪽이 쓴다. 출발점이 이미 벽 안이면 t=0 / axis=null.
   */
  wallRayHit(
    ox: number,
    oz: number,
    dx: number,
    dz: number,
  ): { t: number; axis: 'x' | 'z' | null } {
    const cs = this.cellSize;
    let axis: 'x' | 'z' | null = null;
    let col = Math.floor(ox / cs);
    let row = Math.floor(oz / cs);

    const stepCol = dx > 0 ? 1 : -1;
    const stepRow = dz > 0 ? 1 : -1;
    const tDeltaX = dx !== 0 ? cs / Math.abs(dx) : Infinity;
    const tDeltaZ = dz !== 0 ? cs / Math.abs(dz) : Infinity;
    let tMaxX =
      dx !== 0 ? (dx > 0 ? (col + 1) * cs - ox : ox - col * cs) / Math.abs(dx) : Infinity;
    let tMaxZ =
      dz !== 0 ? (dz > 0 ? (row + 1) * cs - oz : oz - row * cs) / Math.abs(dz) : Infinity;

    let t = 0;
    const maxSteps = this.cols + this.rows + 2;
    for (let i = 0; i <= maxSteps; i++) {
      if (this.solidAt(col, row)) return { t, axis };
      if (tMaxX < tMaxZ) {
        t = tMaxX;
        tMaxX += tDeltaX;
        col += stepCol;
        axis = 'x';
      } else {
        t = tMaxZ;
        tMaxZ += tDeltaZ;
        row += stepRow;
        axis = 'z';
      }
    }
    return { t, axis };
  }

  /** (ax,az)에서 (bx,bz)까지 벽에 막히지 않고 보이는가 (XZ 평면) */
  hasLineOfSight(ax: number, az: number, bx: number, bz: number): boolean {
    const dx = bx - ax;
    const dz = bz - az;
    const dist = Math.hypot(dx, dz);
    if (dist === 0) return true;
    return this.wallRayT(ax, az, dx / dist, dz / dist) >= dist;
  }

  /** 축 분리 스윕 AABB 이동 (X 해결 → Z 해결). 벽 슬라이딩을 얻는다. */
  slideMove(body: { x: number; z: number }, radius: number, dx: number, dz: number): void {
    this.moveAxis(body, radius, dx, 0);
    this.moveAxis(body, radius, 0, dz);
  }

  private moveAxis(body: { x: number; z: number }, radius: number, dx: number, dz: number): void {
    const cs = this.cellSize;
    let nx = body.x + dx;
    let nz = body.z + dz;

    // 시작~목적지 전체 스윕 범위를 검사한다 — 목적지만 보면 큰 이동에서 터널링
    const minCol = Math.floor((Math.min(body.x, nx) - radius) / cs);
    const maxCol = Math.floor((Math.max(body.x, nx) + radius) / cs);
    const minRow = Math.floor((Math.min(body.z, nz) - radius) / cs);
    const maxRow = Math.floor((Math.max(body.z, nz) + radius) / cs);

    for (let row = minRow; row <= maxRow; row++) {
      for (let col = minCol; col <= maxCol; col++) {
        if (!this.solidAt(col, row)) continue;
        if (dx > 0) nx = Math.min(nx, col * cs - radius - SKIN);
        else if (dx < 0) nx = Math.max(nx, (col + 1) * cs + radius + SKIN);
        if (dz > 0) nz = Math.min(nz, row * cs - radius - SKIN);
        else if (dz < 0) nz = Math.max(nz, (row + 1) * cs + radius + SKIN);
      }
    }

    // 구조물(제단 기둥) — 이동하는 축만 잘라낸다. 반대 축 겹침을 먼저 확인하고,
    // "원래 바깥에 있었을 때"만 자른다 (이미 파묻힌 몸을 뒤로 끌어당기지 않게)
    for (const prop of this.props) {
      if (dx !== 0) {
        if (Math.max(body.z, nz) - radius >= prop.maxZ) continue;
        if (Math.min(body.z, nz) + radius <= prop.minZ) continue;
        if (dx > 0 && body.x + radius <= prop.minX) nx = Math.min(nx, prop.minX - radius - SKIN);
        else if (dx < 0 && body.x - radius >= prop.maxX) nx = Math.max(nx, prop.maxX + radius + SKIN);
      } else if (dz !== 0) {
        if (Math.max(body.x, nx) - radius >= prop.maxX) continue;
        if (Math.min(body.x, nx) + radius <= prop.minX) continue;
        if (dz > 0 && body.z + radius <= prop.minZ) nz = Math.min(nz, prop.minZ - radius - SKIN);
        else if (dz < 0 && body.z - radius >= prop.maxZ) nz = Math.max(nz, prop.maxZ + radius + SKIN);
      }
    }

    body.x = nx;
    body.z = nz;
  }

  private findChar(ch: string): { col: number; row: number } | null {
    for (let row = 0; row < this.rows; row++) {
      const col = this.grid[row]?.indexOf(ch) ?? -1;
      if (col >= 0) return { col, row };
    }
    return null;
  }
}

// ---- 렌더 지오메트리 ----
// 시각 팔레트 (튜닝값 아님 — 슬라이스 검증 후 비주얼 단계에서 교체)
// 요철 세기 — 랜턴이 스칠 때 줄눈·판석 틈이 파여 보이는 정도.
// 크게 주면 평면인 게 들통난다 (그림자가 안 지는데 음영만 진해진다)
const WALL_BUMP = 0.42;
const FLOOR_BUMP = 0.3;
const CEILING_BUMP = 0.25;
// 돌 색 — 텍스처가 회색조라 이 값이 그대로 돌빛이 된다. 푸른 회색(0x55555f)에서
// 따뜻한 갈색 돌로 옮겼다 (2026-08-27). 명도는 거의 그대로 두고 색조만 돌린 것이라
// 어둡기는 변하지 않는다 — R>G>B 순서가 곧 '갈색'이다
const COLOR_WALL = 0x60564a;
const COLOR_DOOR = 0x6b4a2f;
/** 중세 판문 — 문틀 안에 실제로 뚫린 구멍 크기와 문짝 두께 */
const DOOR_OPEN_WIDTH = 2.1;
const DOOR_OPEN_HEIGHT = 2.9;
const DOOR_THICK = 0.22;
const DOOR_WOOD = 0x5a3d24;
const DOOR_IRON = 0x2e2c2a;
const COLOR_CRACK = 0x4a5a68;
/** 레버로만 열리는 관문 — 손으로 여는 문(갈색)과 확실히 다른 청록 금속색 */
export const COLOR_GATE = 0x2f6f74;
// 바닥은 벽보다 한참 어둡다 — 때가 앉고 랜턴 빔이 정면으로 안 닿는 자리다.
// 갈색 비율(R>G>B)은 유지한 채 명도만 내렸다 (2026-08-27: 60.5 → 43.4)
const COLOR_FLOOR = 0x2f2b24;
const COLOR_CEILING = 0x342f28;
const COLOR_ALTAR = 0xd8c9a0;
const COLOR_ALTAR_LIGHT = 0xe0d0a0;
const COLOR_EXIT = 0x3fae5a;
/** 층 사이 계단 — 단 수와 한 단 높이, 돌 색 */
const STAIR_STEPS = 7;
const STAIR_RISE = 0.34;
const STAIR_STONE = 0x4a443b;
const STAIR_SLAB = 0x565045;
/** 봉인된 출구 — 꺼진 돌바닥. 열린 초록과 한눈에 구분돼야 한다 */
export const COLOR_EXIT_LOCKED = 0x3a3f44;
export const COLOR_EXIT_OPEN = 0x3fae5a;
const GLYPH_RUNES = 'ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃᛇᛈᛉᛊᛏᛒᛖᛗᛚᛜᛞᛟ';

export interface TorchParams {
  color: string;
  intensity: number;
  distance: number;
  height: number;
  /** 불꽃이 벽에서 떨어져 나온 거리 — 브래킷 길이이자 광원이 서는 자리 */
  wallOffset: number;
}

/** 셀 하나를 그대로 채우는 벽 덩어리 (균열 벽처럼 "문이 아닌 것" 용) */
function plainCell(cs: number, ceiling: number, color: number): THREE.Object3D {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(cs, ceiling, cs),
    new THREE.MeshLambertMaterial({
      color,
      map: dungeonWallTexture(),
      bumpMap: dungeonWallTexture(),
      bumpScale: WALL_BUMP,
    }),
  );
  mesh.position.y = ceiling / 2;
  const holder = new THREE.Group();
  holder.add(mesh);
  return holder;
}

/** 중세 판문 — 아치형 석조 문틀 안에 세로 널을 댄 두꺼운 나무 문. 철 띠와 리벳, 고리 손잡이.
 *  통째로 옆으로 밀려 벽 속으로 들어간다 (Door 시스템의 미닫이 규약).
 *  alongX 면 X 축으로 밀리므로 문의 앞뒤(두께 축)는 Z 다 */
function buildMedievalDoor(
  cs: number,
  ceiling: number,
  alongX: boolean,
  color: number,
  gate: boolean,
): THREE.Object3D {
  const g = new THREE.Group();
  const stone = new THREE.MeshLambertMaterial({
    color,
    map: dungeonWallTexture(),
    bumpMap: dungeonWallTexture(),
    bumpScale: WALL_BUMP,
    emissive: gate ? color : 0x000000,
    emissiveIntensity: gate ? 0.22 : 0,
  });
  const wood = new THREE.MeshLambertMaterial({ color: DOOR_WOOD });
  const iron = new THREE.MeshLambertMaterial({ color: DOOR_IRON });

  /** 문 기준 좌표 → 월드. w 는 미는 축(문의 폭), d 는 두께 축 */
  const put = (obj: THREE.Object3D, w: number, y: number, d: number): void => {
    obj.position.set(alongX ? w : d, y, alongX ? d : w);
    if (!alongX) obj.rotation.y = Math.PI / 2;
    g.add(obj);
  };

  const half = cs / 2;
  const openW = DOOR_OPEN_WIDTH; // 실제로 뚫린 문 폭 — 4m 를 통째로 문으로 만들면 성문이 된다
  const openH = DOOR_OPEN_HEIGHT;
  const jamb = half - openW / 2; // 양옆 석조 기둥 너비

  // 양옆 문설주 + 상인방 — 셀을 막는 석조. 문틀 노릇을 한다
  for (const side of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(jamb, ceiling, cs), stone);
    put(post, side * (half - jamb / 2), ceiling / 2, 0);
  }
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(openW, ceiling - openH, cs), stone);
  put(lintel, 0, openH + (ceiling - openH) / 2, 0);
  // 아치 — 상인방 아래에 계단식으로 물려 들어간 돌 세 단
  for (let i = 0; i < 3; i++) {
    const w = openW - (i + 1) * (openW * 0.14);
    const arch = new THREE.Mesh(new THREE.BoxGeometry(w, 0.16, cs * 0.9), stone);
    put(arch, 0, openH - 0.08 - i * 0.16, 0);
  }

  // 문짝 — 세로 널 여섯 장. 널 사이 틈이 보이도록 살짝 벌려 둔다
  const panelW = openW * 0.97;
  const planks = 6;
  const plankW = panelW / planks;
  for (let i = 0; i < planks; i++) {
    const plank = new THREE.Mesh(
      new THREE.BoxGeometry(plankW * 0.9, openH - 0.1, DOOR_THICK),
      wood,
    );
    put(plank, -panelW / 2 + plankW * (i + 0.5), (openH - 0.1) / 2, 0);
  }
  // 철 띠 두 줄 — 널을 가로질러 묶는다. 앞뒤 양면
  for (const y of [openH * 0.24, openH * 0.76]) {
    for (const face of [-1, 1]) {
      const band = new THREE.Mesh(
        new THREE.BoxGeometry(panelW, 0.16, 0.06),
        iron,
      );
      put(band, 0, y, face * (DOOR_THICK / 2 + 0.03));
      // 리벳 — 띠 위에 박힌 못 머리
      for (let i = 0; i < 5; i++) {
        const rivet = new THREE.Mesh(new THREE.SphereGeometry(0.055, 5, 4), iron);
        put(rivet, -panelW / 2 + panelW * ((i + 0.5) / 5), y, face * (DOOR_THICK / 2 + 0.07));
      }
    }
  }
  // 고리 손잡이 — 어느 쪽에서 와도 잡히도록 앞뒤 양면
  for (const face of [-1, 1]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.035, 6, 12), iron);
    put(ring, panelW * 0.32, openH * 0.5, face * (DOOR_THICK / 2 + 0.06));
    ring.rotation.x = Math.PI / 2;
  }

  return g;
}

/** 계단이 등질 벽 방향 → 회전각. 두 칸까지 훑어 가장 가까운 벽 쪽을 고른다.
 *  입구는 계단 꼭대기(아치)가 벽에 붙고, 출구는 계단 바닥이 벽을 파고든다 —
 *  그래서 둘의 방향이 180도 다르다 */
function stairYaw(level: Level, col: number, row: number, entrance: boolean): number {
  const dirs: [number, number][] = [[0, -1], [0, 1], [-1, 0], [1, 0]];
  let wx = 0;
  let wz = -1; // 못 찾으면 북쪽
  outer: for (let dist = 1; dist <= 2; dist++) {
    for (const [dc, dr] of dirs) {
      if (!level.solidAt(col + dc * dist, row + dr * dist)) continue;
      wx = dc;
      wz = dr;
      break outer;
    }
  }
  // 로컬 -Z 가 계단 꼭대기, +Z 가 바닥이다
  return entrance ? Math.atan2(-wx, -wz) : Math.atan2(wx, wz);
}

/** 층과 층을 잇는 돌계단. entrance 면 "내려온 자리"(위가 막힌 아치),
 *  아니면 "내려갈 자리"(석판이 덮인 구멍 — 열리면 석판이 밀려난다).
 *  바닥 아래로 파 내려가는 것이라 충돌에는 관여하지 않는다 — 순수 연출 */
function buildStairwell(
  x: number,
  z: number,
  cs: number,
  entrance: boolean,
  yaw: number,
): THREE.Object3D {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.rotation.y = yaw;
  const stone = new THREE.MeshLambertMaterial({
    color: STAIR_STONE,
    map: dungeonFloorTexture(),
    bumpMap: dungeonFloorTexture(),
    bumpScale: 0.3,
  });
  const w = cs * 0.62;
  const steps = STAIR_STEPS;
  const rise = STAIR_RISE;
  const run = (cs * 0.78) / steps;

  // 구멍 — 계단을 감싸는 어두운 통. 바닥 아래로 뚫려 있는 것처럼 보이게 벽을 세운다
  const shaft = new THREE.Mesh(
    new THREE.BoxGeometry(w + 0.5, steps * rise + 0.3, cs * 0.9),
    new THREE.MeshLambertMaterial({ color: 0x0a0908 }),
  );
  shaft.position.y = -(steps * rise) / 2 - 0.15;
  g.add(shaft);

  // 디딤돌 — 앞에서 뒤로 가며 한 단씩 내려간다
  for (let i = 0; i < steps; i++) {
    const step = new THREE.Mesh(new THREE.BoxGeometry(w, rise, run), stone);
    step.position.set(0, -rise * (i + 0.5), -cs * 0.39 + run * (i + 0.5));
    g.add(step);
  }
  // 양옆 난간 턱 — 계단이 벽에 파묻힌 것으로 보이게
  for (const side of [-1, 1]) {
    const rail = new THREE.Mesh(
      new THREE.BoxGeometry(0.22, steps * rise, cs * 0.8),
      stone,
    );
    rail.position.set(side * (w / 2 + 0.11), -(steps * rise) / 2, 0);
    g.add(rail);
  }

  if (entrance) {
    // 내려온 아치 — 계단 위쪽 끝을 막은 석조. 되돌아 올라갈 수는 없다
    const back = new THREE.Mesh(new THREE.BoxGeometry(w + 0.44, 2.6, 0.35), stone);
    back.position.set(0, 1.3, -cs * 0.42);
    g.add(back);
    for (let i = 0; i < 3; i++) {
      const arch = new THREE.Mesh(
        new THREE.BoxGeometry(w + 0.44 - (i + 1) * 0.3, 0.18, 0.4),
        stone,
      );
      arch.position.set(0, 2.6 - 0.09 - i * 0.18, -cs * 0.42);
      g.add(arch);
    }
    return g;
  }

  // 덮개 석판 — 잠겨 있는 동안 계단을 덮는다. Stage 가 열릴 때 옆으로 민다
  const slab = new THREE.Mesh(
    new THREE.BoxGeometry(cs * 0.86, 0.22, cs * 0.86),
    new THREE.MeshLambertMaterial({
      color: STAIR_SLAB,
      map: dungeonFloorTexture(),
      bumpMap: dungeonFloorTexture(),
      bumpScale: 0.3,
    }),
  );
  slab.position.y = -0.09;
  slab.name = 'exitSlab';
  g.add(slab);
  return g;
}

export function buildLevelGroup(level: Level, torch: TorchParams): THREE.Group {
  const group = new THREE.Group();
  const cs = level.cellSize;
  const width = level.cols * cs;
  const depth = level.rows * cs;

  // 셀 단위 박스 생성 후 카테고리별로 병합. 문(D)은 열릴 때 제거해야 하므로 개별 메시
  const byColor = new Map<number, THREE.BufferGeometry[]>();
  for (let row = 0; row < level.rows; row++) {
    for (let col = 0; col < level.cols; col++) {
      const ch = level.charAt(col, row);
      if (!SOLID_CHARS.has(ch)) continue;
      if (ch === 'D' || ch === 'G' || ch === 'C') {
        // 문·관문·균열 벽은 열리거나 파괴될 수 있으므로 개별 메시.
        // 관문(G)은 색을 달리한다 — 손으로 열리는 문과 눈으로 구분돼야 헛되이
        // 붙어서 E 를 두들기지 않는다
        const color = ch === 'D' ? COLOR_DOOR : ch === 'G' ? COLOR_GATE : COLOR_CRACK;
        // 문이 미끄러져 들어가는 축 — 좌우가 벽이면 X 로 민다. 그 반대축이 문의 앞뒤다.
        // 판정은 Level 이 dirX/dirZ 를 잡을 때와 똑같이 '#' 만 벽으로 본다 —
        // 어긋나면 문이 제 얼굴 쪽으로 밀려 들어간다
        const alongX = level.charAt(col - 1, row) === '#' || level.charAt(col + 1, row) === '#';
        const node =
          ch === 'C'
            ? plainCell(cs, level.ceiling, color) // 균열 벽은 부술 벽이지 문이 아니다
            : buildMedievalDoor(cs, level.ceiling, alongX, color, ch === 'G');
        node.position.set((col + 0.5) * cs, 0, (row + 0.5) * cs);
        // 이름은 문·관문 모두 door- 로 둔다 — 미닫이·제거를 같은 경로로 쓴다
        node.name = `${ch === 'C' ? 'crack' : 'door'}-${row}-${col}`;
        group.add(node);
        continue;
      }
      const color = COLOR_WALL;
      const box = new THREE.BoxGeometry(cs, level.ceiling, cs);
      box.translate((col + 0.5) * cs, level.ceiling / 2, (row + 0.5) * cs);
      let list = byColor.get(color);
      if (!list) byColor.set(color, (list = []));
      list.push(box);
    }
  }
  for (const [color, geoms] of byColor) {
    const merged = mergeGeometries(geoms);
    group.add(
      new THREE.Mesh(
        merged,
        new THREE.MeshLambertMaterial({
          color,
          map: dungeonWallTexture(),
          bumpMap: dungeonWallTexture(),
          bumpScale: WALL_BUMP,
        }),
      ),
    );
  }

  // 바닥은 셀 한 장씩 깔아 병합한다 — 계단이 놓인 칸(S·X)만 비워 구멍을 낸다.
  // 큰 평면 하나로 깔면 바닥 아래로 판 계단이 그 평면에 가려 안 보인다.
  // 셀마다 UV 가 0~1 이라 텍스처 한 장이 셀 하나에 정확히 들어맞는다 (벽과 같은 규약)
  const floorTiles: THREE.BufferGeometry[] = [];
  for (let row = 0; row < level.rows; row++) {
    for (let col = 0; col < level.cols; col++) {
      const ch = level.charAt(col, row);
      if (ch === 'S' || ch === 'X') continue; // 계단 구멍
      const tile = new THREE.PlaneGeometry(cs, cs);
      tile.rotateX(-Math.PI / 2);
      tile.translate((col + 0.5) * cs, 0, (row + 0.5) * cs);
      floorTiles.push(tile);
    }
  }
  const floor = new THREE.Mesh(
    mergeGeometries(floorTiles),
    new THREE.MeshLambertMaterial({
      color: COLOR_FLOOR,
      map: dungeonFloorTexture(),
      bumpMap: dungeonFloorTexture(),
      bumpScale: FLOOR_BUMP,
    }),
  );
  group.add(floor);

  const ceilingTex = dungeonCeilingTexture().clone();
  ceilingTex.needsUpdate = true;
  ceilingTex.repeat.set(level.cols, level.rows);
  const ceiling = new THREE.Mesh(
    new THREE.PlaneGeometry(width, depth),
    new THREE.MeshLambertMaterial({
      color: COLOR_CEILING,
      map: ceilingTex,
      bumpMap: ceilingTex,
      bumpScale: CEILING_BUMP,
    }),
  );
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.set(width / 2, level.ceiling, depth / 2);
  group.add(ceiling);

  // 제단 — 기둥 + 온화한 광원
  for (let row = 0; row < level.rows; row++) {
    for (let col = 0; col < level.cols; col++) {
      if (level.charAt(col, row) !== 'A') continue;
      const x = (col + 0.5) * cs;
      const z = (row + 0.5) * cs;
      const pillar = new THREE.Mesh(
        new THREE.BoxGeometry(ALTAR_FOOTPRINT, 2.1, ALTAR_FOOTPRINT),
        new THREE.MeshLambertMaterial({
          color: COLOR_ALTAR,
          emissive: COLOR_ALTAR,
          emissiveIntensity: 0.18,
        }),
      );
      pillar.position.set(x, 1.05, z);
      group.add(pillar);
      const cap = new THREE.Mesh(
        new THREE.BoxGeometry(1.5, 0.18, 1.5),
        new THREE.MeshLambertMaterial({ color: COLOR_ALTAR }),
      );
      cap.position.set(x, 2.2, z);
      group.add(cap);
      const light = new THREE.PointLight(COLOR_ALTAR_LIGHT, 1.1, 8, 0);
      light.position.set(x, 2.6, z);
      group.add(light);
    }
  }

  // 레버·출구 — 미니맵 색과 동일한 시각물 (지도와 실물 일치)
  for (let row = 0; row < level.rows; row++) {
    for (let col = 0; col < level.cols; col++) {
      const ch = level.charAt(col, row);
      const x = (col + 0.5) * cs;
      const z = (row + 0.5) * cs;

      if (ch === 'L') {
        // 레버 — 받침 + 기울어진 손잡이. 관문과 같은 색이라 "이게 저 문을 연다"가 읽힌다
        const base = new THREE.Mesh(
          new THREE.BoxGeometry(0.5, 0.5, 0.5),
          new THREE.MeshLambertMaterial({ color: 0x4a4a52 }),
        );
        base.position.set(x, 0.25, z);
        group.add(base);
        const handle = new THREE.Mesh(
          new THREE.BoxGeometry(0.09, 0.9, 0.09),
          new THREE.MeshLambertMaterial({
            color: COLOR_GATE,
            emissive: COLOR_GATE,
            emissiveIntensity: 0.45,
          }),
        );
        handle.position.set(x, 0.85, z);
        handle.rotation.z = 0.5;
        handle.name = `lever-${row}-${col}`;
        group.add(handle);
        group.add(new THREE.PointLight(COLOR_GATE, 0.7, 5, 0));
      }

      if (ch === 'X') {
        // 출구 — 아래층으로 내려가는 계단. 잠겨 있으면 석판이 덮고 있고,
        // 열리면 석판이 옆으로 밀려 계단이 드러난다
        // 계단은 벽 쪽으로 파고 내려간다 — 방 한가운데로 뚫린 것처럼 보이지 않게
        group.add(buildStairwell(x, z, cs, false, stairYaw(level, col, row, false)));

        // 발판 — 잠김/열림을 색으로 알린다. 멀리서 보이는 신호라 유지한다
        const pad = new THREE.Mesh(
          new THREE.PlaneGeometry(cs * 0.8, cs * 0.8),
          new THREE.MeshLambertMaterial({
            color: COLOR_EXIT,
            emissive: COLOR_EXIT,
            emissiveIntensity: 0.5,
            transparent: true,
            opacity: 0.85,
          }),
        );
        pad.rotation.x = -Math.PI / 2;
        pad.position.set(x, 0.02, z);
        pad.name = 'exitPad'; // Stage가 잠김/열림에 따라 색을 바꾼다
        group.add(pad);
        const light = new THREE.PointLight(COLOR_EXIT, 0.9, 7, 0);
        light.position.set(x, 1.5, z);
        light.name = 'exitLight';
        group.add(light);
      }

      if (ch === 'S') {
        // 입구 — 이 층으로 내려온 계단. 위층에서 걸어 내려온 자리라 뒤가 막혀 있다.
        // 순수 장식이다 (충돌·판정 없음)
        group.add(buildStairwell(x, z, cs, true, stairYaw(level, col, row, true)));
      }
    }
  }

  // 벽 문자 — 오염 25 전에는 룬 문자열(해독 불가), 이후 원문 (Stage가 교체)
  for (const glyph of level.glyphs) {
    const mesh = buildGlyphMesh(glyph, level, false);
    if (mesh) group.add(mesh);
  }

  // 횃불 — 위치는 레벨 데이터([row, col]), 광원 파라미터는 balance.
  // 셀 가운데에 띄우면 천장에 매단 것처럼 보인다. 붙은 벽을 찾아 그 면에 건다
  const flameColor = new THREE.Color(torch.color);
  const bracketMat = new THREE.MeshLambertMaterial({ color: 0x2b2118 });
  const flameMat = new THREE.MeshLambertMaterial({ color: 0x000000, emissive: flameColor });
  for (const cell of level.torches) {
    const [row, col] = cell;
    if (row === undefined || col === undefined) continue;
    const x = (col + 0.5) * cs;
    const z = (row + 0.5) * cs;

    // 어느 쪽에 벽이 붙어 있는가 — 법선은 그 벽에서 방 안쪽을 향한다.
    // 북·남·서·동 순으로 본다 (여러 면이 벽이면 앞선 쪽에 건다)
    let nx = 0;
    let nz = 0;
    if (level.solidAt(col, row - 1)) nz = 1;
    else if (level.solidAt(col, row + 1)) nz = -1;
    else if (level.solidAt(col - 1, row)) nx = 1;
    else if (level.solidAt(col + 1, row)) nx = -1;

    // 벽 면에서 wallOffset 만큼 나온 자리 — 붙은 벽이 없으면 셀 가운데 그대로
    const out = cs / 2 - torch.wallOffset;
    const fx = x - nx * out;
    const fz = z - nz * out;
    const mounted = nx !== 0 || nz !== 0;

    if (mounted) {
      // 브래킷 — 벽에서 불꽃까지 뻗은 쇠막대. 길이 축(z)을 법선에 맞춘다
      const bracket = new THREE.Mesh(
        new THREE.BoxGeometry(0.07, 0.07, torch.wallOffset),
        bracketMat,
      );
      bracket.position.set(
        x - nx * (cs / 2 - torch.wallOffset / 2),
        torch.height - 0.16,
        z - nz * (cs / 2 - torch.wallOffset / 2),
      );
      bracket.lookAt(bracket.position.x + nx, bracket.position.y, bracket.position.z + nz);
      group.add(bracket);
      // 받침 — 불꽃을 얹는 컵
      const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.06, 0.16, 6), bracketMat);
      cup.position.set(fx, torch.height - 0.04, fz);
      group.add(cup);
    }

    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.44, 6), flameMat);
    flame.position.set(fx, torch.height + 0.2, fz);
    group.add(flame);

    // decay 0 — distance 컷오프 감쇠만 사용. 물리 감쇠(decay 2)는 balance의
    // intensity 스케일과 맞지 않아 광원이 죽는다.
    const light = new THREE.PointLight(flameColor, torch.intensity, torch.distance, 0);
    light.position.set(fx, torch.height + 0.15, fz);
    group.add(light);
  }

  return group;
}

/** 벽 문자 텍스처 — readable이면 원문, 아니면 원문에서 파생된 룬 문자열 */
export function glyphTexture(text: string, readable: boolean): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, 512, 128);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (readable) {
    ctx.font = '44px monospace';
    ctx.fillStyle = '#b8e0c0';
    ctx.fillText(text, 256, 64);
  } else {
    const garbled = [...text]
      .map((ch) => (ch === ' ' ? ' ' : GLYPH_RUNES[ch.charCodeAt(0) % GLYPH_RUNES.length]))
      .join('');
    ctx.font = '46px serif';
    ctx.fillStyle = '#6a4444';
    ctx.fillText(garbled, 256, 64);
  }
  const texture = new THREE.CanvasTexture(canvas);
  return texture;
}

function buildGlyphMesh(glyph: GlyphDef, level: Level, readable: boolean): THREE.Mesh | null {
  const [row, col] = glyph.cell;
  if (row === undefined || col === undefined) return null;
  const cs = level.cellSize;
  const cx = (col + 0.5) * cs;
  const cz = (row + 0.5) * cs;
  const inset = 0.07;

  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(3, 0.75),
    new THREE.MeshBasicMaterial({
      map: glyphTexture(glyph.text, readable),
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    }),
  );
  mesh.name = 'glyph';
  mesh.userData['glyphText'] = glyph.text;

  const y = 2.9; // 제단 기둥(2.2)보다 높게 — 가려지지 않도록
  switch (glyph.dir) {
    case 'N': // 셀 북쪽 벽면, 남쪽(셀 안)을 향한다
      mesh.position.set(cx, y, row * cs + inset);
      break;
    case 'S':
      mesh.position.set(cx, y, (row + 1) * cs - inset);
      mesh.rotation.y = Math.PI;
      break;
    case 'W':
      mesh.position.set(col * cs + inset, y, cz);
      mesh.rotation.y = Math.PI / 2;
      break;
    case 'E':
      mesh.position.set((col + 1) * cs - inset, y, cz);
      mesh.rotation.y = -Math.PI / 2;
      break;
    default:
      return null;
  }
  return mesh;
}
