// 성소 로비(교회 테마) 장식 — 열주·장의자·색유리창·촛대·노점·대제단·부활 마법진.
// 전부 프리미티브 + 단색/절차 텍스처 (CLAUDE.md 규칙 6). 색은 시각 상수라 여기 둔다 — 튠 값이 아니다.
// 충돌(열주·장의자·노점 상판)은 Level 생성자가 decor 를 읽어 props 차단 상자로 등록한다 — 여기서는 그리기만.
//
// 밝은 분위기 규약: 벽·바닥·천장 텍스처는 회색조라 곱하는 색이 곧 돌빛이다. 던전(0x60564a 갈색 돌)보다
// 훨씬 밝은 상아·크림색을 곱하고, 환경광(lighting.ambient)은 레벨 JSON 이 높게 잡는다.

import * as THREE from 'three';
import type { DecorDef, Level } from './GridLoader';

/** 교회 테마 팔레트 — 던전 팔레트(GridLoader COLOR_*)와 같은 자리에 꽂힌다 */
export const CHURCH_COLORS = {
  wall: 0xd9d0bf,
  floor: 0xb9b0a0,
  ceiling: 0xe9e3d7,
  altar: 0xf2ecdc,
  altarLight: 0xfff0c8,
  gold: 0xd4af37,
  wood: 0x6b4a2f,
  stone: 0xe4dccb,
  iron: 0x3a3630,
  circle: 0x9fd8ff,
  circleLight: 0xa8d8ff,
  glassLight: 0xffe9c0,
};

const COLUMN_RADIUS = 0.42;
const PEW_DEPTH = 0.5;
const STALL_W = 2.2;
const STALL_D = 0.8;

/** 장식의 차단 상자(이동 충돌) — Level 생성자가 부른다. 그리기와 같은 치수를 쓴다 */
export function decorBlockers(
  decor: DecorDef[],
  cs: number,
): { minX: number; maxX: number; minZ: number; maxZ: number }[] {
  const out: { minX: number; maxX: number; minZ: number; maxZ: number }[] = [];
  for (const d of decor) {
    const [row, col] = d.cell as [number, number];
    const x = (col + 0.5) * cs;
    const z = (row + 0.5) * cs;
    if (d.type === 'column') {
      const h = COLUMN_RADIUS + 0.1;
      out.push({ minX: x - h, maxX: x + h, minZ: z - h, maxZ: z + h });
    } else if (d.type === 'pew') {
      const span = (d.span ?? 1) * cs;
      const cx = (col + (d.span ?? 1) / 2) * cs; // span 칸에 걸쳐 놓인다 — 첫 칸 왼쪽 가장자리에서 시작
      const hw = span / 2 - 0.35;
      out.push({ minX: cx - hw, maxX: cx + hw, minZ: z - PEW_DEPTH / 2, maxZ: z + PEW_DEPTH / 2 });
    } else if (d.type === 'stall') {
      // 상판은 노점 칸에서 상인을 향한 쪽(dir) 가장자리에 놓인다
      const n = dirNormal(d.dir);
      const px = x + n.x * (cs / 2 - STALL_D / 2 - 0.2);
      const pz = z + n.z * (cs / 2 - STALL_D / 2 - 0.2);
      const alongX = n.z !== 0; // 상판이 X 축으로 길다
      out.push(
        alongX
          ? { minX: px - STALL_W / 2, maxX: px + STALL_W / 2, minZ: pz - STALL_D / 2, maxZ: pz + STALL_D / 2 }
          : { minX: px - STALL_D / 2, maxX: px + STALL_D / 2, minZ: pz - STALL_W / 2, maxZ: pz + STALL_W / 2 },
      );
    }
  }
  return out;
}

/** 'N'|'S'|'E'|'W' → 단위 법선 (N = -Z, 글리프·함정과 같은 규약) */
export function dirNormal(dir: string | undefined): { x: number; z: number } {
  switch (dir) {
    case 'S': return { x: 0, z: 1 };
    case 'E': return { x: 1, z: 0 };
    case 'W': return { x: -1, z: 0 };
    default: return { x: 0, z: -1 };
  }
}

let glassTexCache: THREE.CanvasTexture | null = null;
let roseTexCache: THREE.CanvasTexture | null = null;

/** 색유리 — 납선으로 나뉜 색 조각. 자체 발광 재질에 얹어 빛나는 창으로 읽힌다 */
function stainedGlassTexture(): THREE.CanvasTexture {
  if (glassTexCache) return glassTexCache;
  const size = 256;
  const cv = document.createElement('canvas');
  cv.width = size;
  cv.height = size * 2;
  const ctx = cv.getContext('2d')!;
  const palette = ['#e0483a', '#3c6fd0', '#e8b62c', '#3f9a4d', '#8a4fc0', '#e88a2c', '#4fb8d8'];
  const cols = 4;
  const rows = 9;
  const cw = size / cols;
  const ch = (size * 2) / rows;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      ctx.fillStyle = palette[(r * 3 + c * 5 + (r % 2)) % palette.length]!;
      ctx.fillRect(c * cw, r * ch, cw, ch);
    }
  }
  // 위쪽 아치 — 뾰족한 고딕 창 머리. 바깥은 검게 눌러 유리가 아닌 자리로 읽히게
  ctx.fillStyle = '#1a1612';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(size, 0);
  ctx.lineTo(size, ch * 1.4);
  ctx.quadraticCurveTo(size * 0.75, ch * 0.2, size / 2, ch * 0.05);
  ctx.quadraticCurveTo(size * 0.25, ch * 0.2, 0, ch * 1.4);
  ctx.closePath();
  ctx.fill();
  // 납선
  ctx.strokeStyle = '#1a1612';
  ctx.lineWidth = 5;
  for (let r = 1; r < rows; r++) {
    ctx.beginPath();
    ctx.moveTo(0, r * ch);
    ctx.lineTo(size, r * ch);
    ctx.stroke();
  }
  for (let c = 1; c < cols; c++) {
    ctx.beginPath();
    ctx.moveTo(c * cw, 0);
    ctx.lineTo(c * cw, size * 2);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  glassTexCache = tex;
  return tex;
}

/** 장미창 — 원형, 부챗살 색 조각 */
function roseWindowTexture(): THREE.CanvasTexture {
  if (roseTexCache) return roseTexCache;
  const size = 512;
  const cv = document.createElement('canvas');
  cv.width = size;
  cv.height = size;
  const ctx = cv.getContext('2d')!;
  const palette = ['#e0483a', '#3c6fd0', '#e8b62c', '#3f9a4d', '#8a4fc0', '#e88a2c'];
  const cx = size / 2;
  const cy = size / 2;
  const segs = 12;
  for (let ring = 0; ring < 3; ring++) {
    const r0 = (size / 2) * (ring / 3);
    const r1 = (size / 2) * ((ring + 1) / 3);
    for (let i = 0; i < segs; i++) {
      const a0 = (i / segs) * Math.PI * 2;
      const a1 = ((i + 1) / segs) * Math.PI * 2;
      ctx.fillStyle = palette[(i + ring * 2) % palette.length]!;
      ctx.beginPath();
      ctx.arc(cx, cy, r1, a0, a1);
      ctx.arc(cx, cy, r0, a1, a0, true);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#1a1612';
      ctx.lineWidth = 5;
      ctx.stroke();
    }
  }
  ctx.fillStyle = '#fff3c8';
  ctx.beginPath();
  ctx.arc(cx, cy, size / 14, 0, Math.PI * 2);
  ctx.fill();
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  roseTexCache = tex;
  return tex;
}

/** 열주 — 주초·주신·주두. 회중석·익랑 모서리에 서서 "예배당" 골격을 만든다 */
function buildColumn(x: number, z: number, ceiling: number): THREE.Group {
  const g = new THREE.Group();
  const stone = new THREE.MeshLambertMaterial({ color: CHURCH_COLORS.stone });
  const plinth = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.32, 1.1), stone);
  plinth.position.y = 0.16;
  g.add(plinth);
  const shaftH = ceiling - 0.32 - 0.34;
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(COLUMN_RADIUS, COLUMN_RADIUS * 1.08, shaftH, 14), stone);
  shaft.position.y = 0.32 + shaftH / 2;
  g.add(shaft);
  const capital = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.34, 1.15), stone);
  capital.position.y = ceiling - 0.17;
  g.add(capital);
  g.position.set(x, 0, z);
  return g;
}

/** 장의자 — 좌판·등판·양 끝 다리. 회중석에 줄지어 제단을 향한다 (등판이 남쪽) */
function buildPew(x: number, z: number, spanW: number): THREE.Group {
  const g = new THREE.Group();
  const wood = new THREE.MeshLambertMaterial({ color: CHURCH_COLORS.wood });
  const w = spanW - 0.7;
  const seat = new THREE.Mesh(new THREE.BoxGeometry(w, 0.08, 0.42), wood);
  seat.position.set(0, 0.46, 0.04);
  g.add(seat);
  const back = new THREE.Mesh(new THREE.BoxGeometry(w, 0.55, 0.07), wood);
  back.position.set(0, 0.78, 0.24);
  back.rotation.x = -0.08;
  g.add(back);
  for (const sx of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.95, PEW_DEPTH), wood);
    leg.position.set(sx * (w / 2 - 0.04), 0.48, 0.02);
    g.add(leg);
  }
  const kneeler = new THREE.Mesh(new THREE.BoxGeometry(w, 0.06, 0.2), wood);
  kneeler.position.set(0, 0.12, -0.28);
  g.add(kneeler);
  g.position.set(x, 0, z);
  return g;
}

/** 색유리창 — 벽 칸의 안쪽 면에 붙는다. 자체 발광 유리 + 석조 틀 + 따뜻한 빛 */
function buildWindow(
  wx: number,
  wz: number,
  n: { x: number; z: number },
  cs: number,
  ceiling: number,
  rose: boolean,
): THREE.Group {
  const g = new THREE.Group();
  const yaw = Math.atan2(n.x, n.z); // 평면의 +Z 가 법선을 보게
  const faceX = wx + n.x * (cs / 2 + 0.03);
  const faceZ = wz + n.z * (cs / 2 + 0.03);
  const frameMat = new THREE.MeshLambertMaterial({ color: 0x8c8474 });
  if (rose) {
    const r = Math.min(1.5, ceiling * 0.26);
    const cy = ceiling * 0.62;
    const glass = new THREE.Mesh(
      new THREE.CircleGeometry(r, 48),
      new THREE.MeshBasicMaterial({ map: roseWindowTexture() }),
    );
    glass.position.set(faceX, cy, faceZ);
    glass.rotation.y = yaw;
    g.add(glass);
    const frame = new THREE.Mesh(new THREE.RingGeometry(r, r + 0.16, 48), frameMat);
    frame.position.set(faceX + n.x * 0.01, cy, faceZ + n.z * 0.01);
    frame.rotation.y = yaw;
    g.add(frame);
    const light = new THREE.PointLight(CHURCH_COLORS.glassLight, 2.2, 18, 0);
    light.position.set(wx + n.x * (cs / 2 + 1.4), cy, wz + n.z * (cs / 2 + 1.4));
    g.add(light);
  } else {
    const w = 1.3;
    const h = Math.min(3.4, ceiling * 0.6);
    const cy = ceiling * 0.5 + 0.3;
    const glass = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ map: stainedGlassTexture() }),
    );
    glass.position.set(faceX, cy, faceZ);
    glass.rotation.y = yaw;
    g.add(glass);
    // 석조 창틀 — 좌우 기둥 + 아래 창턱
    for (const s of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.14, h + 0.2, 0.12), frameMat);
      const ox = s * (w / 2 + 0.07);
      post.position.set(faceX + Math.cos(yaw) * ox, cy, faceZ - Math.sin(yaw) * ox);
      post.rotation.y = yaw;
      g.add(post);
    }
    const sill = new THREE.Mesh(new THREE.BoxGeometry(w + 0.4, 0.12, 0.26), frameMat);
    sill.position.set(faceX + n.x * 0.08, cy - h / 2 - 0.06, faceZ + n.z * 0.08);
    sill.rotation.y = yaw;
    g.add(sill);
    const light = new THREE.PointLight(CHURCH_COLORS.glassLight, 1.3, 12, 0);
    light.position.set(wx + n.x * (cs / 2 + 1.1), cy, wz + n.z * (cs / 2 + 1.1));
    g.add(light);
  }
  return g;
}

/** 촛대 — 쇠 기둥 위 초 세 자루, 불꽃은 자체 발광 */
function buildCandle(x: number, z: number): THREE.Group {
  const g = new THREE.Group();
  const iron = new THREE.MeshLambertMaterial({ color: CHURCH_COLORS.iron });
  const wax = new THREE.MeshLambertMaterial({ color: 0xf4ecd6 });
  const flame = new THREE.MeshLambertMaterial({ color: 0x000000, emissive: 0xffb050, emissiveIntensity: 1.6 });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.28, 0.06, 12), iron);
  base.position.y = 0.03;
  g.add(base);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 1.25, 8), iron);
  pole.position.y = 0.66;
  g.add(pole);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.04, 0.04), iron);
  arm.position.y = 1.28;
  g.add(arm);
  for (const ox of [-0.26, 0, 0.26]) {
    const h = ox === 0 ? 0.32 : 0.24;
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, h, 8), wax);
    c.position.set(ox, 1.3 + h / 2, 0);
    g.add(c);
    const f = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), flame);
    f.scale.set(1, 1.5, 1);
    f.position.set(ox, 1.3 + h + 0.06, 0);
    g.add(f);
  }
  const light = new THREE.PointLight(0xffb060, 0.9, 6, 0);
  light.position.set(0, 1.75, 0);
  g.add(light);
  g.position.set(x, 0, z);
  return g;
}

/** 상인 노점 — 상판·차양·궤짝. 로컬 좌표로 짓고 그룹을 dir 로 돌린다: 로컬 +Z 가 상인이 바라보는 쪽(손님 쪽).
 *  상판은 칸 앞쪽(+Z), 차양은 그 위에서 앞이 낮게 기울고, 궤짝은 상인 등 뒤(-Z) 벽 쪽에 놓인다.
 *  (처음엔 월드 축으로 기울여 동서를 보는 노점의 차양이 긴 축을 따라 비스듬히 걸렸다 — 2026-09-07 사용자 지적) */
function buildStall(x: number, z: number, n: { x: number; z: number }, cs: number): THREE.Group {
  const g = new THREE.Group();
  const wood = new THREE.MeshLambertMaterial({ color: CHURCH_COLORS.wood });
  const cloth = new THREE.MeshLambertMaterial({ color: 0x9a3a2e });
  const zc = cs / 2 - STALL_D / 2 - 0.2; // 상판 중심 — decorBlockers 의 차단 상자와 같은 자리
  const counter = new THREE.Mesh(new THREE.BoxGeometry(STALL_W, 0.95, STALL_D), wood);
  counter.position.set(0, 0.475, zc);
  g.add(counter);
  const top = new THREE.Mesh(new THREE.BoxGeometry(STALL_W + 0.2, 0.06, STALL_D + 0.2), cloth);
  top.position.set(0, 0.98, zc);
  g.add(top);
  // 차양 기둥 넷 — 앞 둘은 상판 양 끝 바깥, 뒤 둘은 상인 등 뒤
  const poleFrontZ = zc + STALL_D / 2 + 0.1;
  const poleBackZ = -0.7;
  for (const sx of [-1, 1]) {
    for (const [pz, h] of [[poleFrontZ, 2.15], [poleBackZ, 2.5]] as const) {
      const pole = new THREE.Mesh(new THREE.BoxGeometry(0.08, h, 0.08), wood);
      pole.position.set(sx * (STALL_W / 2 + 0.08), h / 2, pz);
      g.add(pole);
    }
  }
  // 차양 — 앞(+Z)이 낮고 뒤가 높은 한 장. 기둥 위를 덮는다
  const depth = poleFrontZ - poleBackZ + 0.4;
  const awning = new THREE.Mesh(new THREE.BoxGeometry(STALL_W + 0.5, 0.05, depth), cloth);
  const midZ = (poleFrontZ + poleBackZ) / 2;
  const tilt = Math.atan2(2.5 - 2.15, poleFrontZ - poleBackZ); // 뒤 기둥과 앞 기둥 높이 차로 기울기를 정한다
  awning.position.set(0, (2.5 + 2.15) / 2 + 0.03, midZ);
  awning.rotation.x = tilt; // +Z(앞)가 내려간다
  g.add(awning);
  // 앞 처마 — 늘어진 천 띠
  const valance = new THREE.Mesh(new THREE.BoxGeometry(STALL_W + 0.5, 0.22, 0.04), cloth);
  valance.position.set(0, 2.15 - 0.1, poleFrontZ + 0.2);
  g.add(valance);
  // 궤짝 — 상인 등 뒤 벽 쪽 (상인은 칸 가운데 z=0 에 선다)
  for (const [ox, oy, oz] of [[-0.6, 0, -1.45], [0.45, 0, -1.5], [0.45, 0.5, -1.5]] as const) {
    const crate = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), wood);
    crate.position.set(ox, 0.25 + oy, oz);
    g.add(crate);
  }
  g.rotation.y = Math.atan2(n.x, n.z); // 로컬 +Z → n
  g.position.set(x, 0, z);
  return g;
}

/** 대제단 — 대리석 제대 위에 금빛 오벨리스크와 후광 구(球). 발자국(1.1m 정방) 안에 다 들어간다 —
 *  Level 이 'A' 칸에 등록하는 차단 상자가 그 크기라 밖으로 나간 부분은 몸이 뚫는다 */
export function buildGrandAltar(x: number, z: number, ceiling: number, footprint: number): THREE.Group {
  const g = new THREE.Group();
  const marble = new THREE.MeshLambertMaterial({ color: CHURCH_COLORS.altar, emissive: CHURCH_COLORS.altar, emissiveIntensity: 0.18 });
  const gold = new THREE.MeshLambertMaterial({ color: CHURCH_COLORS.gold, emissive: CHURCH_COLORS.gold, emissiveIntensity: 0.45 });
  const w = footprint - 0.08;
  const table = new THREE.Mesh(new THREE.BoxGeometry(w, 1.05, w), marble);
  table.position.y = 0.525;
  g.add(table);
  const trim = new THREE.Mesh(new THREE.BoxGeometry(w + 0.06, 0.08, w + 0.06), gold);
  trim.position.y = 1.05;
  g.add(trim);
  const obeliskH = Math.min(2.6, ceiling - 2.2);
  const obelisk = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.3, obeliskH, 4), marble);
  obelisk.position.y = 1.09 + obeliskH / 2;
  obelisk.rotation.y = Math.PI / 4;
  g.add(obelisk);
  const orbY = 1.09 + obeliskH + 0.42;
  const orb = new THREE.Mesh(
    new THREE.SphereGeometry(0.3, 16, 12),
    new THREE.MeshLambertMaterial({ color: 0xfff6dc, emissive: 0xffe9a8, emissiveIntensity: 1.4 }),
  );
  orb.position.y = orbY;
  orb.name = 'altarOrb';
  g.add(orb);
  const halo = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.035, 8, 40), gold);
  halo.position.y = orbY;
  halo.rotation.x = Math.PI / 2;
  halo.name = 'altarHalo';
  g.add(halo);
  const light = new THREE.PointLight(CHURCH_COLORS.altarLight, 3.0, 16, 0);
  light.position.y = orbY;
  g.add(light);
  g.position.set(x, 0, z);
  return g;
}

/** 부활 마법진 — 큰 고리 둘 + 8 갈래 살 + 둘레의 룬 조각 + 위로 뻗는 옅은 빛기둥.
 *  빛을 받지 않는 재질(MeshBasic)이라 어디서 봐도 같은 밝기로 읽힌다. 바닥에서 살짝 띄워 z-fighting 을 피한다 */
export function buildRespawnCircle(x: number, z: number, cs: number, ceiling: number): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: CHURCH_COLORS.circle, transparent: true, opacity: 0.9 });
  const rOuter = cs * 0.92;
  const rInner = cs * 0.34;
  const outer = new THREE.Mesh(new THREE.RingGeometry(rOuter - 0.1, rOuter, 96), mat);
  outer.rotation.x = -Math.PI / 2;
  outer.position.y = 0.02;
  g.add(outer);
  const outer2 = new THREE.Mesh(new THREE.RingGeometry(rOuter - 0.42, rOuter - 0.36, 96), mat);
  outer2.rotation.x = -Math.PI / 2;
  outer2.position.y = 0.02;
  g.add(outer2);
  const inner = new THREE.Mesh(new THREE.RingGeometry(rInner - 0.08, rInner, 64), mat);
  inner.rotation.x = -Math.PI / 2;
  inner.position.y = 0.02;
  g.add(inner);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const len = rOuter - 0.42 - rInner;
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.01, len), mat);
    const mid = rInner + len / 2;
    spoke.position.set(Math.sin(a) * mid, 0.02, Math.cos(a) * mid);
    spoke.rotation.y = a;
    g.add(spoke);
  }
  // 룬 조각 — 두 고리 사이에 박힌 작은 사각 16개
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 + Math.PI / 16;
    const r = rOuter - 0.24;
    const rune = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.01, 0.2), mat);
    rune.position.set(Math.sin(a) * r, 0.02, Math.cos(a) * r);
    rune.rotation.y = a;
    g.add(rune);
  }
  // 빛기둥 — 안쪽 고리 지름으로 천장까지, 아주 옅게
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(rInner, rInner * 1.15, ceiling, 32, 1, true),
    new THREE.MeshBasicMaterial({ color: CHURCH_COLORS.circle, transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false }),
  );
  beam.position.y = ceiling / 2;
  beam.name = 'respawnBeam';
  g.add(beam);
  const light = new THREE.PointLight(CHURCH_COLORS.circleLight, 1.2, 10, 0);
  light.position.y = 1.6;
  g.add(light);
  g.name = 'respawnCircle';
  g.position.set(x, 0, z);
  return g;
}

/** 레벨의 decor 목록을 전부 짓는다 — buildLevelGroup 이 마지막에 부른다 */
export function buildDecor(level: Level, group: THREE.Group): void {
  const cs = level.cellSize;
  for (const d of level.decor) {
    const [row, col] = d.cell as [number, number];
    const x = (col + 0.5) * cs;
    const z = (row + 0.5) * cs;
    switch (d.type) {
      case 'column':
        group.add(buildColumn(x, z, level.ceiling));
        break;
      case 'pew': {
        const span = d.span ?? 1;
        group.add(buildPew((col + span / 2) * cs, z, span * cs));
        break;
      }
      case 'window':
        group.add(buildWindow(x, z, dirNormal(d.dir), cs, level.ceiling, d.kind === 'rose'));
        break;
      case 'candle':
        group.add(buildCandle(x, z));
        break;
      case 'stall':
        group.add(buildStall(x, z, dirNormal(d.dir), cs));
        break;
      default:
        console.warn(`[ChurchDecor] 모르는 장식: ${d.type}`);
    }
  }
}
