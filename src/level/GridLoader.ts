// ASCII 그리드 레벨 → 충돌 질의 + Three.js 지오메트리.
// grid 인덱스는 [row][col] = [z][x]. 월드 좌표: x = col * cellSize, z = row * cellSize.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export interface LevelDef {
  id: string;
  name: string;
  cellSize: number;
  ceiling: number;
  grid: string[];
  lighting: { ambient: number; torches: number[][] };
}

/** 이동을 막는 셀. 잠긴 문(D)과 균열 벽(C)은 열리기 전까지 벽 취급. */
const SOLID_CHARS = new Set(['#', 'D', 'C']);

export class Level {
  readonly cellSize: number;
  readonly ceiling: number;
  readonly grid: string[];
  readonly ambient: number;
  readonly torches: number[][];
  readonly spawn: { x: number; z: number };
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
  }

  charAt(col: number, row: number): string {
    return this.grid[row]?.[col] ?? '#';
  }

  /** 그리드 밖은 전부 벽 취급. */
  solidAt(col: number, row: number): boolean {
    return SOLID_CHARS.has(this.charAt(col, row));
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
const COLOR_WALL = 0x55555f;
const COLOR_DOOR = 0x6b4a2f;
const COLOR_CRACK = 0x4a5a68;
const COLOR_FLOOR = 0x3a3a44;
const COLOR_CEILING = 0x2e2e36;

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

  // 셀 단위 박스 생성 후 카테고리별로 병합
  const byColor = new Map<number, THREE.BufferGeometry[]>();
  for (let row = 0; row < level.rows; row++) {
    for (let col = 0; col < level.cols; col++) {
      const ch = level.charAt(col, row);
      if (!SOLID_CHARS.has(ch)) continue;
      const color = ch === 'D' ? COLOR_DOOR : ch === 'C' ? COLOR_CRACK : COLOR_WALL;
      const box = new THREE.BoxGeometry(cs, level.ceiling, cs);
      box.translate((col + 0.5) * cs, level.ceiling / 2, (row + 0.5) * cs);
      let list = byColor.get(color);
      if (!list) byColor.set(color, (list = []));
      list.push(box);
    }
  }
  for (const [color, geoms] of byColor) {
    const merged = mergeGeometries(geoms);
    group.add(new THREE.Mesh(merged, new THREE.MeshLambertMaterial({ color })));
  }

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(width, depth),
    new THREE.MeshLambertMaterial({ color: COLOR_FLOOR }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(width / 2, 0, depth / 2);
  group.add(floor);

  const ceiling = new THREE.Mesh(
    new THREE.PlaneGeometry(width, depth),
    new THREE.MeshLambertMaterial({ color: COLOR_CEILING }),
  );
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.set(width / 2, level.ceiling, depth / 2);
  group.add(ceiling);

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
