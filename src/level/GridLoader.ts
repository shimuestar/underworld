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
/** 봉인된 출구 — 꺼진 돌바닥. 열린 초록과 한눈에 구분돼야 한다 */
export const COLOR_EXIT_LOCKED = 0x3a3f44;
export const COLOR_EXIT_OPEN = 0x3fae5a;
const GLYPH_RUNES = 'ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃᛇᛈᛉᛊᛏᛒᛖᛗᛚᛜᛞᛟ';

export interface TorchParams {
  color: string;
  intensity: number;
  distance: number;
  height: number;
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
        const mesh = new THREE.Mesh(
          new THREE.BoxGeometry(cs, level.ceiling, cs),
          new THREE.MeshLambertMaterial({
            color,
            // 텍스처는 회색조라 color 가 곱해져 문(갈색)·관문(청록)의 색 구분이 그대로 남는다
            map: dungeonWallTexture(),
            bumpMap: dungeonWallTexture(),
            bumpScale: WALL_BUMP,
            // 관문은 은은하게 자체 발광 — 어두운 복도 끝에서도 "저기 뭔가 있다"가 보인다
            emissive: ch === 'G' ? COLOR_GATE : 0x000000,
            emissiveIntensity: ch === 'G' ? 0.22 : 0,
          }),
        );
        mesh.position.set((col + 0.5) * cs, level.ceiling / 2, (row + 0.5) * cs);
        // 이름은 문·관문 모두 door- 로 둔다 — 미닫이·제거를 같은 경로로 쓴다
        mesh.name = `${ch === 'C' ? 'crack' : 'door'}-${row}-${col}`;
        group.add(mesh);
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

  // 바닥·천장은 큰 평면 하나라 셀 수만큼 반복시킨다 — 타일 한 장이 셀 하나(4m)다.
  // 텍스처 객체를 공유하면 repeat 도 공유돼 버리므로 각자 복제해서 쓴다
  const floorTex = dungeonFloorTexture().clone();
  floorTex.needsUpdate = true;
  floorTex.repeat.set(level.cols, level.rows);
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(width, depth),
    new THREE.MeshLambertMaterial({
      color: COLOR_FLOOR,
      map: floorTex,
      bumpMap: floorTex,
      bumpScale: FLOOR_BUMP,
    }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(width / 2, 0, depth / 2);
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
        // 출구 — 바닥 발광 판 + 초록 광원
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
    }
  }

  // 벽 문자 — 오염 25 전에는 룬 문자열(해독 불가), 이후 원문 (Stage가 교체)
  for (const glyph of level.glyphs) {
    const mesh = buildGlyphMesh(glyph, level, false);
    if (mesh) group.add(mesh);
  }

  // 횃불 — 위치는 레벨 데이터([row, col]), 광원 파라미터는 balance
  for (const cell of level.torches) {
    const [row, col] = cell;
    if (row === undefined || col === undefined) continue;
    const x = (col + 0.5) * cs;
    const z = (row + 0.5) * cs;

    // decay 0 — distance 컷오프 감쇠만 사용. 물리 감쇠(decay 2)는 balance의
    // intensity 스케일과 맞지 않아 광원이 죽는다.
    const light = new THREE.PointLight(
      new THREE.Color(torch.color),
      torch.intensity,
      torch.distance,
      0,
    );
    light.position.set(x, torch.height, z);
    group.add(light);

    const marker = new THREE.Mesh(
      new THREE.BoxGeometry(0.2, 0.5, 0.2),
      new THREE.MeshLambertMaterial({
        color: 0x000000,
        emissive: new THREE.Color(torch.color),
      }),
    );
    marker.position.set(x, torch.height, z);
    group.add(marker);
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
