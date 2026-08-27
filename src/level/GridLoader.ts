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
  /** 스폰이 등진 벽의 방향 (col,row 증분) — 계단 벽감이 이 칸에 파인다 */
  readonly spawnWall: { dc: number; dr: number };
  /** 시작 시선 — 등 뒤 계단이 아니라 방을 본다 */
  readonly spawnYaw: number;
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
    // 스폰이 등진 벽 — 계단이 이쪽 벽을 파고 들어가고, 시선은 그 반대를 본다.
    // 붙은 벽이 없으면 북쪽으로 친다 (Zone.test 가 벽에 붙이도록 강제한다)
    const wall = ([[0, -1], [0, 1], [-1, 0], [1, 0]] as const).find(
      ([dc, dr]) => this.charAt(spawn.col + dc, spawn.row + dr) === '#',
    ) ?? [0, -1];
    this.spawnWall = { dc: wall[0], dr: wall[1] };
    // facing = (-sin yaw, -cos yaw). 벽 반대(-dc, -dr) 를 보려면 yaw = atan2(dc, dr)
    this.spawnYaw = Math.atan2(wall[0], wall[1]);
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
  addBlocker(x: number, z: number, half: number, halfZ = half): {
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
  } {
    const blocker = { minX: x - half, maxX: x + half, minZ: z - halfZ, maxZ: z + halfZ };
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

  /** 스폰 칸의 격자 좌표 — 계단 벽감이 그 옆 칸에 파인다 */
  findSpawnCell(): { col: number; row: number } {
    return this.findChar('S') ?? { col: 0, row: 0 };
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
/** 입구 아래 단 수 — 적을수록 계단참이 낮아져 방에서 평지 윗면이 보인다.
 *  아래+윗단 합(7)이 문 높이를 정하므로 여길 줄이면 ALCOVE_UPPER_STEPS 를 늘릴 것 */
const STAIR_UP_STEPS = 3;
/** 벽감 개구부 — 문과 같은 크기라야 "벽에 낸 통로" 로 읽힌다 */
const ALCOVE_OPEN_W = 2.1;
const ALCOVE_OPEN_H = 2.9;
/** 상인방 깊이 — 입구 쪽만 문 높이로 누르고, 안쪽은 천장(4m)까지 트인다.
 *  안쪽까지 2.9 로 누르면 꺾인 통로의 키가 1.5m 밖에 안 남아 기어가는 굴이 된다 */
const ALCOVE_LINTEL_D = 0.7;
/** 벽감 등판 두께 — 이게 없으면 벽 속이 뚫려 레벨 바깥이 보인다.
 *  얇을수록 윗단이 뒤로 붙는다 (뚫림만 막으면 된다) */
const ALCOVE_BACK_D = 0.2;
/** 꺾인 윗단 줄의 깊이와, 그 꼭대기 옆 어두운 문의 높이 */
/** 윗단 줄의 깊이 — 좁을수록 윗단이 등판에 붙고 평지가 그만큼 깊어진다 */
const ALCOVE_UPPER_D = 0.85;
const ALCOVE_DOOR_H = 1.4;
const ALCOVE_UPPER_STEPS = 4;
/** 왼쪽 기둥에 파인 문의 깊이 — 검은 판 하나가 아니라 진짜 파인 구멍이라야
 *  옆에서 봐도 문설주·문지방의 깊이가 보인다 */
const ALCOVE_NOTCH_D = 0.55;
/** 계단 한 단의 깊이 — 단 수 × 이 값이 개구부에서 계단참까지의 길이다 */
const ALCOVE_STEP_RUN = 0.44;
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
 *  문틀(frame)은 벽의 일부라 그대로 서 있고, 문짝은 경첩(hinge)에 매달려 돌아 열린다.
 *  둘 다 "문 기준 좌표"(폭 = X, 두께 = Z)로 짓고 바깥에서 통째로 돌린다 —
 *  alongX 가 아니면 문틀·경첩을 90도 돌려 세운다 */
function buildMedievalDoor(
  cs: number,
  ceiling: number,
  alongX: boolean,
  color: number,
  gate: boolean,
): { frame: THREE.Group; mount: THREE.Group; pivot: THREE.Group } {
  void alongX; // 축 회전은 부르는 쪽이 건다
  const frame = new THREE.Group();
  // mount 는 문의 방향만 든다(셀 중심에 놓고 돌린다). pivot 이 경첩이고 이것만 여닫이로 돈다 —
  // 방향과 여닫힘을 한 그룹에 겹쳐 두면 회전 뒤 좌표에서 경첩 위치를 잡게 돼 문짝이 개구부 밖으로 나간다
  const mount = new THREE.Group();
  const pivot = new THREE.Group();
  mount.add(pivot);
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

  const half = cs / 2;
  const openW = DOOR_OPEN_WIDTH; // 실제로 뚫린 문 폭 — 4m 를 통째로 문으로 만들면 성문이 된다
  const openH = DOOR_OPEN_HEIGHT;
  const jamb = half - openW / 2; // 양옆 석조 기둥 너비

  // ── 문틀 — 양옆 문설주 + 상인방 + 계단식 아치. 열려도 그대로 서 있다
  for (const side of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(jamb, ceiling, cs), stone);
    post.position.set(side * (half - jamb / 2), ceiling / 2, 0);
    frame.add(post);
  }
  // 상인방 — 개구부 위를 가로지르는 돌 한 장. 계단식으로 물려 놓으면 문 위에
  // 판자 세 장이 얹힌 것처럼 보여서 한 장으로 둔다
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(openW, ceiling - openH, cs), stone);
  lintel.position.set(0, openH + (ceiling - openH) / 2, 0);
  frame.add(lintel);
  // 경첩 쇠 — 문설주에 박힌 돌쩌귀. 문이 어디에 매달렸는지 보여 준다
  for (const y of [openH * 0.22, openH * 0.78]) {
    const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.34, 6), iron);
    pin.position.set(-openW / 2, y, 0);
    frame.add(pin);
  }

  // ── 문짝 — 경첩(pivot)은 개구부 왼쪽 끝. 널은 거기서 폭의 절반만큼 밀어 매단다
  pivot.position.x = -openW / 2;
  const panel = new THREE.Group();
  panel.position.x = openW / 2;
  pivot.add(panel);

  const panelW = openW * 0.94;
  const planks = 6;
  const plankW = panelW / planks;
  for (let i = 0; i < planks; i++) {
    const plank = new THREE.Mesh(
      new THREE.BoxGeometry(plankW * 0.9, openH - 0.12, DOOR_THICK),
      wood,
    );
    plank.position.set(-panelW / 2 + plankW * (i + 0.5), (openH - 0.12) / 2, 0);
    panel.add(plank);
  }
  // 철 띠 두 줄 — 널을 가로질러 묶는다. 앞뒤 양면
  for (const y of [openH * 0.24, openH * 0.76]) {
    for (const face of [-1, 1]) {
      const band = new THREE.Mesh(new THREE.BoxGeometry(panelW, 0.16, 0.06), iron);
      band.position.set(0, y, face * (DOOR_THICK / 2 + 0.03));
      panel.add(band);
      for (let i = 0; i < 5; i++) {
        const rivet = new THREE.Mesh(new THREE.SphereGeometry(0.055, 5, 4), iron);
        rivet.position.set(-panelW / 2 + panelW * ((i + 0.5) / 5), y, face * (DOOR_THICK / 2 + 0.07));
        panel.add(rivet);
      }
    }
  }
  // 고리 손잡이 — 경첩 반대쪽 끝. 어느 쪽에서 와도 잡히도록 앞뒤 양면
  for (const face of [-1, 1]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.035, 6, 12), iron);
    ring.position.set(panelW * 0.34, openH * 0.5, face * (DOOR_THICK / 2 + 0.06));
    ring.rotation.x = Math.PI / 2;
    panel.add(ring);
  }

  return { frame, mount, pivot };
}

/** 문이 열려도 문틀은 몸을 막는다 — 셀을 통째로 열어 두면 석조 문설주를 뚫고 지나간다.
 *  총알은 그대로 통과한다 (props 는 발자국만 막는 규약) */
export function addDoorFrameBlockers(level: Level, col: number, row: number): void {
  const cs = level.cellSize;
  const x = (col + 0.5) * cs;
  const z = (row + 0.5) * cs;
  const alongX = level.charAt(col - 1, row) === '#' || level.charAt(col + 1, row) === '#';
  const jamb = (cs - DOOR_OPEN_WIDTH) / 2;
  for (const side of [-1, 1]) {
    const off = side * (cs / 2 - jamb / 2);
    if (alongX) level.addBlocker(x + off, z, jamb / 2, cs / 2);
    else level.addBlocker(x, z + off, cs / 2, jamb / 2);
  }
}

/** 계단이 등질 벽 방향 → 회전각. 두 칸까지 훑어 가장 가까운 벽 쪽을 고른다.
 *  입구는 계단 꼭대기(아치)가 벽에 붙고, 출구는 계단 바닥이 벽을 파고든다 —
 *  그래서 둘의 방향이 180도 다르다 */
function stairYaw(level: Level, col: number, row: number, entrance: boolean): number {
  const dirs: [number, number][] = [[0, -1], [0, 1], [-1, 0], [1, 0]];
  let wx = 0;
  let wz = -1; // 못 찾으면 북쪽
  // 바로 붙은 진짜 벽만 본다. 두 칸 건너 벽을 잡으면 계단이 방 한가운데 서고 아치가 허공에 뜬다 —
  // 스폰·출구를 벽에 붙여 두는 것이 데이터 쪽 규약이고, Zone.test 가 그걸 지킨다
  for (const [dc, dr] of dirs) {
    if (level.charAt(col + dc, row + dr) !== '#') continue;
    wx = dc;
    wz = dr;
    break;
  }
  // 로컬 -Z 가 계단 꼭대기, +Z 가 바닥이다
  return entrance ? Math.atan2(-wx, -wz) : Math.atan2(wx, wz);
}

/** 벽감 테두리 — 벽 한 칸에 문 크기 구멍을 낸 모양. 통짜 상자 대신 이 조각들을
 *  벽 병합 목록에 그대로 넣으므로 벽과 한 몸이 된다 (재질도 이음매도 갈리지 않는다).
 *  개구부는 로컬 +Z 를 향하고, yaw 로 방 쪽을 보게 돌린다 */
function alcoveFrameGeoms(
  cs: number,
  ceiling: number,
  x: number,
  z: number,
  yaw: number,
): THREE.BufferGeometry[] {
  const openW = ALCOVE_OPEN_W;
  const openH = ALCOVE_OPEN_H;
  const jamb = (cs - openW) / 2;
  const out: THREE.BufferGeometry[] = [];
  const place = (g: THREE.BufferGeometry, lx: number, ly: number, lz: number): void => {
    g.translate(lx, ly, lz);
    g.rotateY(yaw);
    g.translate(x, 0, z);
    out.push(g);
  };
  // 오른쪽 기둥 — 칸 깊이만큼 두껍다. 이 안쪽 면이 곧 계단 통로의 벽이 된다
  place(new THREE.BoxGeometry(jamb, ceiling, cs), cs / 2 - jamb / 2, ceiling / 2, 0);

  // 왼쪽 기둥 — 윗단 꼭대기 높이에 위층으로 이어지는 문을 판다.
  // 검은 판 하나를 붙이는 게 아니라 기둥을 다섯 조각으로 갈라 진짜 구멍을 낸다 —
  // 문지방·문설주·문틀 윗면이 전부 실물이라 어느 각도에서 봐도 깊이가 보인다
  const doorBottom = STAIR_RISE * (STAIR_UP_STEPS + ALCOVE_UPPER_STEPS);
  const doorTop = doorBottom + ALCOVE_DOOR_H;
  const notchB = -cs / 2 + ALCOVE_BACK_D; // 문의 z 구간 = 윗단 줄과 같다
  const notchF = notchB + ALCOVE_UPPER_D;
  const notchD = notchF - notchB;
  const lx = -(cs / 2 - jamb / 2); // 왼쪽 기둥 중심
  // 앞쪽·뒤쪽 통짜
  place(new THREE.BoxGeometry(jamb, ceiling, cs / 2 - notchF), lx, ceiling / 2, (notchF + cs / 2) / 2);
  place(new THREE.BoxGeometry(jamb, ceiling, notchB + cs / 2), lx, ceiling / 2, (-cs / 2 + notchB) / 2);
  // 문 아래(문지방까지)와 문 위
  place(new THREE.BoxGeometry(jamb, doorBottom, notchD), lx, doorBottom / 2, (notchF + notchB) / 2);
  place(
    new THREE.BoxGeometry(jamb, ceiling - doorTop, notchD),
    lx,
    doorTop + (ceiling - doorTop) / 2,
    (notchF + notchB) / 2,
  );
  // 구멍 안쪽에 남는 벽 두께
  place(
    new THREE.BoxGeometry(jamb - ALCOVE_NOTCH_D, ALCOVE_DOOR_H, notchD),
    -cs / 2 + (jamb - ALCOVE_NOTCH_D) / 2,
    doorBottom + ALCOVE_DOOR_H / 2,
    (notchF + notchB) / 2,
  );
  // 상인방 — 입구 쪽만. 안쪽은 천장까지 트여 있어야 꺾여 올라가는 통로의 키가 나온다
  place(
    new THREE.BoxGeometry(openW, ceiling - openH, ALCOVE_LINTEL_D),
    0,
    openH + (ceiling - openH) / 2,
    cs / 2 - ALCOVE_LINTEL_D / 2,
  );
  // 등판 — 벽감의 끝. 이게 없으면 벽 속이 뚫려 바깥이 보인다
  place(new THREE.BoxGeometry(openW, ceiling, ALCOVE_BACK_D), 0, ceiling / 2, -cs / 2 + ALCOVE_BACK_D / 2);
  return out;
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
  const rise = STAIR_RISE;

  if (entrance) {
    // ㄱ자 계단 — 아래 단이 방을 향해 내려오고, 계단참에서 꺾여 윗단이 왼쪽으로
    // 올라가 어두운 문으로 사라진다. "위층에서 코너를 돌아 내려온 길" 이 통째로 보인다.
    // 단은 전부 바닥부터 통짜 상자다 — 밑이 비면 옆에서 뜬 판자로 보인다
    const innerW = ALCOVE_OPEN_W - 0.04; // 기둥 면과 겹쳐 지글거리지 않게 살짝 안으로
    const front = cs / 2;
    const lowerSteps = STAIR_UP_STEPS;
    const run = ALCOVE_STEP_RUN;
    const landingTop = rise * lowerSteps;

    // 아래 단 — 개구부에서 안쪽으로 오른다
    for (let i = 0; i < lowerSteps; i++) {
      const h = rise * (i + 1);
      const step = new THREE.Mesh(new THREE.BoxGeometry(innerW, h, run), stone);
      step.position.set(0, h / 2, front - run * (i + 0.5));
      g.add(step);
    }

    // 계단참 — 한 번 올라선 뒤의 사각 평지. 여기서 길이 꺾인다.
    // 아래 단을 3개로 눌러 평지를 깊고 낮게(1.02m) 잡았다 — 얕고 높으면
    // 방에서 평지 윗면이 안 보여 아래 단과 윗단이 한 계단으로 붙어 보인다
    const upperFront = -cs / 2 + ALCOVE_BACK_D + ALCOVE_UPPER_D;
    const landingFront = front - run * lowerSteps;
    const landing = new THREE.Mesh(
      new THREE.BoxGeometry(innerW, landingTop, landingFront - upperFront),
      stone,
    );
    landing.position.set(0, landingTop / 2, (landingFront + upperFront) / 2);
    g.add(landing);

    // 윗단 — 등판 바로 앞 한 줄. 왼쪽으로 갈수록 한 단씩 높다 (왼쪽 끝이 꼭대기)
    const upperSteps = ALCOVE_UPPER_STEPS;
    const stepW = innerW / upperSteps;
    const upperZ = -cs / 2 + ALCOVE_BACK_D + ALCOVE_UPPER_D / 2;
    for (let k = 0; k < upperSteps; k++) {
      const h = landingTop + rise * (upperSteps - k);
      const step = new THREE.Mesh(new THREE.BoxGeometry(stepW - 0.02, h, ALCOVE_UPPER_D), stone);
      step.position.set(-innerW / 2 + stepW * (k + 0.5), h / 2, upperZ);
      g.add(step);
    }

    // 파인 문의 속 — 조명이 그림자를 못 만들므로(섀도 맵 없음) 끝은 검은 판으로 눌러 둔다.
    // 문 자체는 왼쪽 기둥에 실제로 파여 있다 (alcoveFrameGeoms 가 다섯 조각으로 가른다)
    const doorBottom = landingTop + rise * upperSteps;
    const dark = new THREE.Mesh(
      new THREE.BoxGeometry(0.05, ALCOVE_DOOR_H - 0.04, ALCOVE_UPPER_D - 0.06),
      new THREE.MeshBasicMaterial({ color: 0x020202 }),
    );
    dark.position.set(-innerW / 2 - ALCOVE_NOTCH_D + 0.05, doorBottom + ALCOVE_DOOR_H / 2, upperZ);
    g.add(dark);
    // 위층에서 새어 내려오는 불빛 — 문가에 낮게 걸어 윗단과 문설주만 데운다.
    // '길이 저 위로 이어진다' 는 신호는 어둠보다 이 빛이 낸다
    const spill = new THREE.PointLight(0xff9a4a, 1.15, 5, 0);
    spill.position.set(-innerW / 2 + 0.4, doorBottom + 0.55, upperZ);
    g.add(spill);
    return g;
  }

  // ── 출구 — 바닥을 뚫고 아래로 내려간다
  const w = cs * 0.62;
  const steps = STAIR_STEPS;
  const run = (cs * 0.78) / steps;
  const shaft = new THREE.Mesh(
    new THREE.BoxGeometry(w + 0.5, steps * rise + 0.3, cs * 0.9),
    new THREE.MeshLambertMaterial({ color: 0x0a0908 }),
  );
  shaft.position.y = -(steps * rise) / 2 - 0.15;
  g.add(shaft);
  for (let i = 0; i < steps; i++) {
    const step = new THREE.Mesh(new THREE.BoxGeometry(w, rise, run), stone);
    step.position.set(0, -rise * (i + 0.5), -cs * 0.39 + run * (i + 0.5));
    g.add(step);
  }
  for (const side of [-1, 1]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.22, steps * rise, cs * 0.8), stone);
    rail.position.set(side * (w / 2 + 0.11), -(steps * rise) / 2, 0);
    g.add(rail);
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

  // 시작 계단이 들어갈 벽 칸 — 스폰이 등진 쪽 한 칸.
  // 개구부는 방을 향해(= 등진 벽의 반대로) 입을 벌린다
  const spawnCell = level.findSpawnCell();
  const alcove = {
    row: spawnCell.row + level.spawnWall.dr,
    col: spawnCell.col + level.spawnWall.dc,
    x: (spawnCell.col + level.spawnWall.dc + 0.5) * cs,
    z: (spawnCell.row + level.spawnWall.dr + 0.5) * cs,
    yaw: Math.atan2(-level.spawnWall.dc, -level.spawnWall.dr),
  };

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
        if (ch === 'C') {
          // 균열 벽은 부술 벽이지 문이 아니다 — 통째로 사라진다
          const wall = plainCell(cs, level.ceiling, color);
          wall.position.set((col + 0.5) * cs, 0, (row + 0.5) * cs);
          wall.name = `crack-${row}-${col}`;
          group.add(wall);
          continue;
        }
        // 문틀(석조)은 벽의 일부라 그대로 서 있고, 문짝만 경첩에서 돌아 열린다.
        // 문틀·문짝 모두 셀 중심에 놓고 같은 각도로 돌린다 — 경첩 위치는 그 안쪽 좌표라
        // 회전과 섞이지 않는다
        const baseYaw = alongX ? 0 : Math.PI / 2;
        const built = buildMedievalDoor(cs, level.ceiling, alongX, color, ch === 'G');
        for (const node of [built.frame, built.mount]) {
          node.position.set((col + 0.5) * cs, 0, (row + 0.5) * cs);
          node.rotation.y = baseYaw;
        }
        built.frame.name = `doorframe-${row}-${col}`;
        // 이름은 경첩에 붙인다 — Stage 가 이것만 돌린다 (0 = 닫힘)
        built.pivot.name = `door-${row}-${col}`;
        group.add(built.frame);
        group.add(built.mount);
        continue;
      }
      const color = COLOR_WALL;
      // 시작 계단이 파고 들어갈 벽 칸 — 통짜 상자 대신 개구부를 낸 테두리를 넣는다.
      // 별도 메시로 세우면 벽과 재질·이음매가 갈려 "벽에 상자를 끼운" 것처럼 보인다.
      // 같은 병합 목록에 넣으므로 벽과 문자 그대로 한 몸이다.
      // 격자는 그대로 '#' 이라 몸은 여전히 막힌다 (보이는 것만 판다)
      if (row === alcove.row && col === alcove.col) {
        let list = byColor.get(color);
        if (!list) byColor.set(color, (list = []));
        list.push(...alcoveFrameGeoms(cs, level.ceiling, alcove.x, alcove.z, alcove.yaw));
        continue;
      }
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
      if (ch === 'X') continue; // 내려가는 계단 구멍. 입구(S)는 계단이 올라가므로 바닥이 있다
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
        // 입구 — 이 층으로 내려온 계단. 스폰 칸이 아니라 등진 벽 칸을 파고 들어간다.
        // 격자는 여전히 '#' 이라 몸은 못 들어가고, 눈에만 벽감으로 보인다
        group.add(buildStairwell(alcove.x, alcove.z, cs, true, alcove.yaw));
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
    // 문·관문·균열 벽('D'·'G'·'C')에는 걸지 않는다 — 열리거나 부서지면 횃불만 허공에 남는다
    let nx = 0;
    let nz = 0;
    if (level.charAt(col, row - 1) === '#') nz = 1;
    else if (level.charAt(col, row + 1) === '#') nz = -1;
    else if (level.charAt(col - 1, row) === '#') nx = 1;
    else if (level.charAt(col + 1, row) === '#') nx = -1;

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
