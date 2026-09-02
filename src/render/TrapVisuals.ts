// 함정 모형 — Stage 와 debug/traps.ts 가 같은 빌더를 쓴다 (프리미티브 + 단색, 에셋 없음).
// 게임 로직 없음: 상태(phase·timer)를 읽어 모형을 움직일 뿐이다.
// tell(발견 단서)은 여기서 만든다 — 판석과 다른 색의 판, 벽의 검은 노즐, 네 귀의 구멍.
import * as THREE from 'three';

export interface TrapView {
  type: string;
  phase: string;
  timer: number;
  dirX: number;
  dirZ: number;
}

const PLATE_LIGHT = 0x7d7568; // 다트 압력판 — 주변 판석보다 밝다
const PLATE_DARK = 0x3b3733; // 가시판 — 주변보다 어둡다
const GROOVE = 0x2a2622;
const IRON = 0x14121a;
const IRON_SPENT = 0x4a4a50;
const SPIKE = 0x9a9aa4;
const NET_LINE = 0xd8d2b8; // 랜턴에 반짝이는 실
const NET_BUNDLE = 0x2c2418;
const OIL = 0x0c0c10; // 번들거리는 검정 — 점액(녹색)과 갈린다
const OIL_FIRE = 0xff7a1a;
const OIL_SCORCH = 0x1a1410;
const GLYPH = 0x9b5de5;

/** 함정 하나의 모형. group 원점 = 함정 칸 중심, y=0 바닥 */
export function buildTrapGroup(trap: TrapView, cellSize: number): THREE.Group {
  const group = new THREE.Group();
  const data: Record<string, unknown> = {};
  group.userData = data;

  if (trap.type === 'trap_dart') {
    // 압력판 — 밝은 판 + 가운데 홈 (밟으면 내려앉는다)
    const plate = new THREE.Mesh(
      new THREE.BoxGeometry(3.0, 0.05, 3.0),
      new THREE.MeshLambertMaterial({ color: PLATE_LIGHT }),
    );
    plate.position.y = 0.03;
    group.add(plate);
    const groove = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.02, 0.5),
      new THREE.MeshLambertMaterial({ color: GROOVE }),
    );
    groove.position.y = 0.06;
    group.add(groove);
    data['plate'] = plate;
    data['groove'] = groove;
    // 노즐 — -dir 쪽 벽면에 검은 구멍 3개. 예고 중 안쪽이 붉게 달아오른다
    const nozzleMats: THREE.MeshLambertMaterial[] = [];
    const px = -trap.dirZ; // dir 에 수직 (좌우 간격 축)
    const pz = trap.dirX;
    // 벽면에서 12cm 튀어나온 짧은 관 — 정면에서는 검은 구멍, 비스듬히는 관으로 읽힌다 (tell)
    const wx = -trap.dirX * (cellSize / 2 - 0.12);
    const wz = -trap.dirZ * (cellSize / 2 - 0.12);
    for (const off of [-0.6, 0, 0.6]) {
      const mat = new THREE.MeshLambertMaterial({ color: IRON, emissive: 0xff3020, emissiveIntensity: 0.12 });
      const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.24, 10), mat);
      // 실린더 축(Y)을 dir 축으로 — 벽에서 튀어나온 관
      if (trap.dirX !== 0) nozzle.rotation.z = Math.PI / 2;
      else nozzle.rotation.x = Math.PI / 2;
      nozzle.position.set(wx + px * off, 1.0, wz + pz * off);
      group.add(nozzle);
      nozzleMats.push(mat);
    }
    data['nozzleMats'] = nozzleMats;
  } else if (trap.type === 'trap_spike') {
    const plate = new THREE.Mesh(
      new THREE.BoxGeometry(3.0, 0.06, 3.0),
      new THREE.MeshLambertMaterial({ color: PLATE_DARK }),
    );
    plate.position.y = 0.03;
    group.add(plate);
    data['plate'] = plate;
    // 네 귀의 구멍 — 가시가 나오는 자리 (tell)
    const holeMat = new THREE.MeshBasicMaterial({ color: 0x050505 });
    for (const [hx, hz] of [[-1.1, -1.1], [1.1, -1.1], [-1.1, 1.1], [1.1, 1.1]] as const) {
      const hole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.02, 8), holeMat);
      hole.position.set(hx, 0.07, hz);
      group.add(hole);
    }
    // 가시 9개 — 평소엔 바닥 아래 숨어 있다 (바닥이 가린다)
    const spikes = new THREE.Group();
    const spikeMat = new THREE.MeshLambertMaterial({ color: SPIKE });
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        const cone = new THREE.Mesh(new THREE.ConeGeometry(0.09, 1.1, 6), spikeMat);
        cone.position.set((i - 1) * 0.9, 0.55, (j - 1) * 0.9);
        spikes.add(cone);
      }
    }
    spikes.position.y = -1.25;
    group.add(spikes);
    data['spikes'] = spikes;
  } else if (trap.type === 'trap_net') {
    // 무릎 높이 실선 — dir 에 수직으로 칸을 가로지른다. 약한 자체 발광 = 랜턴에 반짝임
    const px = -trap.dirZ;
    const pz = trap.dirX;
    const line = new THREE.Mesh(
      new THREE.BoxGeometry(trap.dirX !== 0 ? 0.02 : cellSize * 0.96, 0.02, trap.dirX !== 0 ? cellSize * 0.96 : 0.02),
      new THREE.MeshLambertMaterial({ color: NET_LINE, emissive: NET_LINE, emissiveIntensity: 0.25 }),
    );
    line.position.set(px * 0, 0.45, pz * 0);
    group.add(line);
    data['line'] = line;
    // 천장의 그물 뭉치 — 떨어지면 바닥에 펼쳐진다
    const bundle = new THREE.Mesh(
      new THREE.SphereGeometry(0.36, 10, 8),
      new THREE.MeshLambertMaterial({ color: NET_BUNDLE }),
    );
    bundle.position.y = 3.55;
    group.add(bundle);
    data['bundle'] = bundle;
  } else if (trap.type === 'trap_oil') {
    const mat = new THREE.MeshLambertMaterial({
      color: OIL, emissive: OIL_FIRE, emissiveIntensity: 0, transparent: true, opacity: 0.9,
    });
    const pool = new THREE.Mesh(new THREE.CircleGeometry(1.6, 18), mat);
    pool.rotation.x = -Math.PI / 2;
    pool.position.y = 0.02;
    group.add(pool);
    data['poolMat'] = mat;
    const light = new THREE.PointLight(OIL_FIRE, 0, 7, 0);
    light.position.y = 0.6;
    group.add(light);
    data['fireLight'] = light;
  } else if (trap.type === 'trap_glyph') {
    // 바닥의 보라 룬 — 무조명 재질(어둠 속에서도 제 빛). 가시성 규칙은 Stage 가 정한다
    const mat = new THREE.MeshBasicMaterial({ color: GLYPH, transparent: true, opacity: 0.7 });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.75, 0.9, 24), mat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.03;
    group.add(ring);
    for (let i = 0; i < 4; i++) {
      const stroke = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.01, 0.07), mat);
      stroke.rotation.y = (i * Math.PI) / 4 + 0.3;
      stroke.position.y = 0.03;
      group.add(stroke);
    }
    data['glyphMat'] = mat;
  }
  return group;
}

/** 매 프레임 — phase·timer 로 모형을 움직인다. 보간은 프레임 기반(연출 전용) */
export function animateTrap(group: THREE.Group, trap: TrapView, nowMs: number): void {
  const data = group.userData as Record<string, unknown>;
  const plate = data['plate'] as THREE.Mesh | undefined;
  if (trap.type === 'trap_dart') {
    // 판 — 예고·작동 중 내려앉는다
    if (plate) plate.position.y = trap.phase === 'telegraph' || trap.phase === 'firing' ? 0.0 : 0.03;
    const mats = data['nozzleMats'] as THREE.MeshLambertMaterial[] | undefined;
    if (mats) {
      const spent = trap.phase === 'spent';
      const glow = trap.phase === 'telegraph' ? 0.7 + 0.5 * Math.abs(Math.sin(nowMs / 40)) : spent ? 0 : 0.12;
      for (const m of mats) {
        m.emissiveIntensity = glow;
        m.color.setHex(spent ? IRON_SPENT : IRON);
      }
    }
  } else if (trap.type === 'trap_spike') {
    if (plate) plate.position.y = trap.phase === 'telegraph' ? 0.0 : 0.03;
    const spikes = data['spikes'] as THREE.Group | undefined;
    if (spikes) {
      const target = trap.phase === 'firing' ? 0 : -1.25;
      // 솟을 때는 순간, 들어갈 때는 스르륵
      spikes.position.y = target > spikes.position.y ? target : spikes.position.y + (target - spikes.position.y) * 0.12;
    }
  } else if (trap.type === 'trap_net') {
    const line = data['line'] as THREE.Mesh | undefined;
    const bundle = data['bundle'] as THREE.Mesh | undefined;
    if (line) line.visible = trap.phase === 'armed';
    if (bundle) {
      const dropped = trap.phase === 'firing' || trap.phase === 'spent';
      const targetY = dropped ? 0.12 : 3.55;
      bundle.position.y += (targetY - bundle.position.y) * (dropped ? 0.35 : 1);
      // 바닥에 닿으면 펼쳐진다
      const flat = dropped && bundle.position.y < 0.3;
      bundle.scale.set(flat ? 2.6 : 1, flat ? 0.28 : 1, flat ? 2.6 : 1);
    }
  } else if (trap.type === 'trap_oil') {
    const mat = data['poolMat'] as THREE.MeshLambertMaterial | undefined;
    const light = data['fireLight'] as THREE.PointLight | undefined;
    const burning = trap.phase === 'firing';
    const flicker = 0.7 + 0.3 * Math.abs(Math.sin(nowMs / 37) * Math.cos(nowMs / 91));
    if (mat) {
      mat.emissiveIntensity = burning ? 0.9 * flicker : 0;
      mat.color.setHex(trap.phase === 'spent' ? OIL_SCORCH : OIL);
      mat.opacity = trap.phase === 'spent' ? 0.7 : 0.9;
    }
    if (light) light.intensity = burning ? 2.4 * flicker : 0;
  } else if (trap.type === 'trap_glyph') {
    const mat = data['glyphMat'] as THREE.MeshBasicMaterial | undefined;
    if (mat) {
      mat.opacity = trap.phase === 'spent' ? 0.18 : 0.55 + 0.35 * Math.abs(Math.sin(nowMs / 420));
      mat.color.setHex(trap.phase === 'spent' ? 0x2a1a3a : GLYPH);
    }
  }
}
