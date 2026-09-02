// 함정 모형 — Stage 와 debug/traps.ts 가 같은 빌더를 쓴다 (프리미티브 + 단색, 에셋 없음).
// 게임 로직 없음: 상태(phase·timer)를 읽어 모형을 움직일 뿐이다.
// tell(발견 단서)은 여기서 만든다 — 판석과 다른 색의 판, 벽의 검은 노즐, 네 귀의 구멍.
import * as THREE from 'three';
import { balance } from '../core/Balance';

export interface TrapView {
  type: string;
  phase: string;
  timer: number;
  dirX: number;
  dirZ: number;
  /** 진자 주기 카운터 */
  cycleTick?: number;
  /** 함정 감지 각인이 알아챘다 — 보랏빛으로 드러난다 */
  revealed?: boolean;
}
const REVEAL = 0x7d5cff;

const PLATE_LIGHT = 0x7d7568; // 다트 압력판 — 주변 판석보다 밝다
const PLATE_DARK = 0x3b3733; // 가시판 — 주변보다 어둡다
const PLATE_RUST = 0x6e3a2c; // 자동 순환 가시판 — 녹슨 붉은색으로 구분
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
const GAS = 0x4fc46a;
const GRATE = 0x2a2a30;
const SLAB = 0x45403a;
const CRACK = 0x8a8278;
const RUBBLE = 0x5a534b;
const BLADE = 0xb8b8c4;
const ROD = 0x3a3634;

/** 함정 하나의 모형. group 원점 = 함정 칸 중심, y=0 바닥 */
export function buildTrapGroup(trap: TrapView, cellSize: number): THREE.Group {
  const group = new THREE.Group();
  const data: Record<string, unknown> = {};
  group.userData = data;
  // 감지 발광 — 각인이 알아챈 함정 위에 은은한 보라 빛 (평소엔 꺼져 있다)
  const reveal = new THREE.PointLight(REVEAL, 0, 4.5, 0);
  reveal.position.y = 0.5;
  group.add(reveal);
  data['reveal'] = reveal;

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
  } else if (trap.type === 'trap_spike' || trap.type === 'trap_spike_auto') {
    const plate = new THREE.Mesh(
      new THREE.BoxGeometry(3.0, 0.06, 3.0),
      new THREE.MeshLambertMaterial({ color: trap.type === 'trap_spike_auto' ? PLATE_RUST : PLATE_DARK }),
    );
    plate.position.y = 0.03;
    group.add(plate);
    data['plate'] = plate;
    // 구멍 9개 — 가시가 나올 자리 그대로 (tell: 어디서 솟을지 미리 보인다). 쇠 테두리 + 검은 속
    const rimMat = new THREE.MeshLambertMaterial({ color: 0x5a5a62 });
    const holeMat = new THREE.MeshBasicMaterial({ color: 0x030303 });
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.02, 10), rimMat);
        rim.position.set((i - 1) * 0.9, 0.065, (j - 1) * 0.9);
        group.add(rim);
        const hole = new THREE.Mesh(new THREE.CylinderGeometry(0.115, 0.115, 0.02, 10), holeMat);
        hole.position.set((i - 1) * 0.9, 0.075, (j - 1) * 0.9);
        group.add(hole);
      }
    }
    // 가시 9개 — 구멍과 같은 자리. 평소엔 바닥 아래 숨어 있다 (바닥이 가린다)
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
  } else if (trap.type === 'trap_gas') {
    // 바닥 쇠창살 — 살 5개. 구름은 반투명 초록 구체 군집(랜턴 빔에 빛난다)
    const grateMat = new THREE.MeshLambertMaterial({ color: GRATE });
    const frame = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.06, 1.6), grateMat);
    frame.position.y = 0.03;
    group.add(frame);
    const hole = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.02, 1.3), new THREE.MeshBasicMaterial({ color: 0x030303 }));
    hole.position.y = 0.065;
    group.add(hole);
    for (let i = 0; i < 5; i++) {
      const slat = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.03, 0.1), grateMat);
      slat.position.set(0, 0.08, -0.5 + i * 0.25);
      group.add(slat);
    }
    const cloud = new THREE.Group();
    const cloudMat = new THREE.MeshLambertMaterial({ color: GAS, transparent: true, opacity: 0, depthWrite: false });
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const rr = 0.4 + (i % 3) * 0.5;
      const puff = new THREE.Mesh(new THREE.SphereGeometry(0.75 + (i % 2) * 0.35, 10, 8), cloudMat);
      puff.position.set(Math.cos(a) * rr, 0.6 + (i % 3) * 0.45, Math.sin(a) * rr);
      cloud.add(puff);
    }
    cloud.visible = false;
    group.add(cloud);
    data['cloud'] = cloud;
    data['cloudMat'] = cloudMat;
  } else if (trap.type === 'trap_rockfall') {
    // 천장의 금 간 슬래브 + 바닥 자갈(tell). 떨어지면 슬래브가 사라지고 잔해 더미가 남는다
    const slab = new THREE.Group();
    const slabMesh = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.25, 3.6), new THREE.MeshLambertMaterial({ color: SLAB }));
    slab.add(slabMesh);
    for (const [rx, rz, ry] of [[0.3, -0.2, 0.4], [-0.6, 0.5, -0.9]] as const) {
      const crack = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.03, 0.06), new THREE.MeshLambertMaterial({ color: CRACK }));
      crack.rotation.y = ry;
      crack.position.set(rx, -0.14, rz);
      slab.add(crack);
    }
    slab.position.y = 3.87;
    group.add(slab);
    data['slab'] = slab;
    const gravelMat = new THREE.MeshLambertMaterial({ color: RUBBLE });
    for (let i = 0; i < 5; i++) {
      const g = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.1, 0.14), gravelMat);
      g.position.set(Math.sin(i * 2.1) * 1.1, 0.05, Math.cos(i * 1.7) * 1.1);
      g.rotation.y = i * 0.9;
      group.add(g);
    }
    const rubble = new THREE.Group();
    for (let i = 0; i < 8; i++) {
      const size = 0.55 + (i % 3) * 0.25;
      const rock = new THREE.Mesh(new THREE.BoxGeometry(size, size * 0.8, size * 0.9), gravelMat);
      rock.position.set(Math.sin(i * 2.4) * 1.0, size * 0.4 + (i % 2) * 0.35, Math.cos(i * 1.9) * 1.0);
      rock.rotation.set(i * 0.4, i * 0.8, i * 0.3);
      rubble.add(rock);
    }
    rubble.visible = false;
    group.add(rubble);
    data['rubble'] = rubble;
  } else if (trap.type === 'trap_pendulum') {
    // 천장 피벗 — 막대 끝의 큰 칼날. 복도 축(dir)에 수직으로 흔들린다
    const arm = new THREE.Group();
    arm.position.y = 3.95;
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.6, 8), new THREE.MeshLambertMaterial({ color: ROD }));
    rod.position.y = -1.3;
    arm.add(rod);
    const bladeMat = new THREE.MeshLambertMaterial({ color: BLADE, emissive: 0x303038, emissiveIntensity: 0.35 });
    const blade = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.55, 0.05), bladeMat);
    blade.position.y = -2.8;
    // 칼날 면이 진행 방향을 향하게 — 복도 축이 X 면 날은 Z 로 흔들리니 면을 X 축 정렬
    if (trap.dirX === 0) blade.rotation.y = Math.PI / 2;
    arm.add(blade);
    const edge = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.06, 0.02), new THREE.MeshLambertMaterial({ color: 0xe8e8f0 }));
    edge.position.y = -3.08;
    if (trap.dirX === 0) edge.rotation.y = Math.PI / 2;
    arm.add(edge);
    group.add(arm);
    data['arm'] = arm;
  }
  return group;
}

/** 매 프레임 — phase·timer 로 모형을 움직인다. 보간은 프레임 기반(연출 전용) */
export function animateTrap(group: THREE.Group, trap: TrapView, nowMs: number): void {
  const data = group.userData as Record<string, unknown>;
  const reveal = data['reveal'] as THREE.PointLight | undefined;
  if (reveal) {
    const live = trap.revealed === true && trap.phase !== 'spent' && trap.phase !== 'disarmed';
    reveal.intensity = live ? 0.9 + 0.5 * Math.abs(Math.sin(nowMs / 520)) : 0;
  }
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
  } else if (trap.type === 'trap_spike' || trap.type === 'trap_spike_auto') {
    if (plate) plate.position.y = trap.phase === 'telegraph' ? 0.0 : 0.03;
    const spikes = data['spikes'] as THREE.Group | undefined;
    if (spikes) {
      // 솟을 때는 순간(firing), 들어갈 때는 회수 시간(cooldownTicks) 내내 타이머에 맞춰 천천히 —
      // 회수 소리(돌 갈림)와 길이가 같고, 걸쇠 철컥과 함께 완전히 들어간다
      if (trap.phase === 'firing') {
        spikes.position.y = 0;
      } else if (trap.phase === 'cooldown') {
        const cd = Math.max(
          1,
          trap.type === 'trap_spike_auto'
            ? balance.traps.types.trap_spike_auto.cooldownTicks
            : balance.traps.types.trap_spike.cooldownTicks,
        );
        const progress = 1 - Math.max(0, Math.min(1, trap.timer / cd));
        spikes.position.y = -1.25 * progress;
      } else {
        spikes.position.y = -1.25;
      }
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
  } else if (trap.type === 'trap_gas') {
    const cloud = data['cloud'] as THREE.Group | undefined;
    const mat = data['cloudMat'] as THREE.MeshLambertMaterial | undefined;
    if (cloud && mat) {
      const on = trap.phase === 'firing';
      // 예고 중엔 살짝 새어 나오고, 도는 동안은 짙고, 끝 1초는 옅어진다
      const target = on ? Math.min(0.32, 0.32 * Math.min(1, trap.timer / 60)) : trap.phase === 'telegraph' ? 0.1 : 0;
      mat.opacity += (target - mat.opacity) * 0.15;
      cloud.visible = mat.opacity > 0.01;
      cloud.rotation.y = nowMs / 2400;
      cloud.position.y = 0.1 * Math.sin(nowMs / 900);
    }
  } else if (trap.type === 'trap_rockfall') {
    const slab = data['slab'] as THREE.Group | undefined;
    const rubble = data['rubble'] as THREE.Group | undefined;
    const fallen = trap.phase === 'spent';
    if (slab) {
      slab.visible = !fallen;
      // 예고 — 천장이 떨린다
      const shake = trap.phase === 'telegraph' ? 0.03 : 0;
      slab.position.x = Math.sin(nowMs / 23) * shake;
      slab.position.z = Math.cos(nowMs / 31) * shake;
    }
    if (rubble) rubble.visible = fallen;
  } else if (trap.type === 'trap_pendulum') {
    const arm = data['arm'] as THREE.Group | undefined;
    if (arm) {
      // 주기 — 로직의 cycleTick 을 그대로 읽는다 (최저점 = 칸 중심 = 각도 0)
      const period = 120;
      const t = ((trap.cycleTick ?? 0) % period) / period;
      const angle = (70 * Math.PI) / 180 * Math.sin(t * Math.PI * 2);
      if (trap.dirX !== 0) arm.rotation.x = angle;
      else arm.rotation.z = angle;
    }
  }
}
