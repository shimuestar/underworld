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
  /** 낙석 잔해가 폭발로 부서졌다 — 낮은 자갈 더미만 남는다 */
  rubbleBroken?: boolean;
}
const REVEAL = 0x7d5cff;

const PLATE_LIGHT = 0x7d7568; // 다트 압력판 — 주변 판석보다 밝다
const PLATE_DARK = 0x3b3733; // 가시판 — 주변보다 어둡다
const PLATE_RUST = 0x6e3a2c; // 자동 순환 가시판 — 녹슨 붉은색으로 구분
const GROOVE = 0x2a2622;
const IRON = 0x14121a;
const IRON_SPENT = 0x4a4a50;
const BRASS = 0x9a7a3a; // 자동 순환 다트 발사기 노즐 — 밟는 다트(검은 쇠)와 구분
const SPIKE = 0x9a9aa4;
const NET_LINE = 0xb9b29a; // 랜턴 빔에는 밝게 드러나되 횃불 잔광엔 묻히는 중간 톤 실
const NET_BUNDLE = 0x2c2418;
const OIL = 0x0c0c10; // 번들거리는 검정 — 점액(녹색)과 갈린다
const OIL_FIRE = 0xff7a1a;
const OIL_SCORCH = 0x1a1410;
const GLYPH = 0x9b5de5;
const GAS = 0x4fc46a;
const STALK = 0x4d6b2e; // 포자 식물 줄기
const BULB = 0x8fbf4a; // 포자 주머니 — 병든 연두
const BULB_SPOT = 0x3f5f22;
const SAC = 0x6f9a3a;
const PETAL = 0x7fae44;
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

  if (trap.type === 'trap_dart' || trap.type === 'trap_dart_auto') {
    if (trap.type === 'trap_dart') {
      // 압력판 — 밝은 판 + 가운데 홈 (밟으면 내려앉는다). 자동 발사기는 발판이 없다
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
    }
    // 노즐 — -dir 쪽 벽면에 구멍 3개(밟는 다트 = 검은 쇠, 자동 = 황동). 예고 중 안쪽이 붉게 달아오른다
    const nozzleBase = trap.type === 'trap_dart_auto' ? BRASS : IRON;
    data['nozzleBase'] = nozzleBase;
    const nozzleMats: THREE.MeshLambertMaterial[] = [];
    const px = -trap.dirZ; // dir 에 수직 (좌우 간격 축)
    const pz = trap.dirX;
    // 벽면에서 12cm 튀어나온 짧은 관 — 정면에서는 검은 구멍, 비스듬히는 관으로 읽힌다 (tell)
    const wx = -trap.dirX * (cellSize / 2 - 0.12);
    const wz = -trap.dirZ * (cellSize / 2 - 0.12);
    for (const off of [-0.6, 0, 0.6]) {
      const mat = new THREE.MeshLambertMaterial({ color: nozzleBase, emissive: 0xff3020, emissiveIntensity: 0.12 });
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
    // 무릎 높이 실선 — dir 에 수직으로 칸을 가로지른다. 자체 발광 없음: 랜턴 빔이 닿을 때만
    // 밝은 실이 드러나고, 랜턴을 끄면 어둠(환경광 0.04)에 묻힌다 — 켜서 살피는 이유가 된다
    const px = -trap.dirZ;
    const pz = trap.dirX;
    // 투명 재질 — Stage 가 랜턴 상태·빔 안/밖에 따라 opacity 를 매 프레임 정한다
    const line = new THREE.Mesh(
      new THREE.BoxGeometry(trap.dirX !== 0 ? 0.02 : cellSize * 0.96, 0.02, trap.dirX !== 0 ? cellSize * 0.96 : 0.02),
      new THREE.MeshLambertMaterial({ color: NET_LINE, transparent: true, opacity: 0.1, emissive: NET_LINE, emissiveIntensity: 0 }),
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
    // 포자 식물 — 줄기 위에 부풀어 오른 주머니, 둘레에 작은 포자 주머니 셋. 다가가면(예고) 꽃잎이
    // 벌어지며 개화하고 포자 구름을 뿜는다. 구름은 반투명 초록 구체 군집(랜턴 빔에 빛난다)
    const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.13, 0.7, 8), new THREE.MeshLambertMaterial({ color: STALK }));
    stalk.position.y = 0.35;
    group.add(stalk);
    const bulbMat = new THREE.MeshLambertMaterial({ color: BULB, emissive: 0x9fe060, emissiveIntensity: 0 });
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 10), bulbMat);
    bulb.scale.set(1, 1.15, 1);
    bulb.position.y = 0.98;
    group.add(bulb);
    data['bulbMat'] = bulbMat;
    data['bulb'] = bulb;
    // 반점 — 주머니의 자식으로 붙여 부풀고 쭈그러질 때 함께 움직인다 (로컬 좌표, 주머니 반지름 0.42)
    const spotMat = new THREE.MeshLambertMaterial({ color: BULB_SPOT });
    for (let i = 0; i < 6; i++) {
      const a = i * 1.05;
      const spot = new THREE.Mesh(new THREE.SphereGeometry(0.075, 6, 5), spotMat);
      spot.position.set(Math.cos(a) * 0.38, (Math.sin(i * 1.7) * 0.3) / 1.15, Math.sin(a) * 0.38);
      bulb.add(spot);
    }
    const sacMat = new THREE.MeshLambertMaterial({ color: SAC });
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.4;
      const sacStalk = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.32, 6), new THREE.MeshLambertMaterial({ color: STALK }));
      sacStalk.position.set(Math.cos(a) * 0.55, 0.16, Math.sin(a) * 0.55);
      sacStalk.rotation.z = Math.cos(a) * 0.35;
      sacStalk.rotation.x = -Math.sin(a) * 0.35;
      group.add(sacStalk);
      const sac = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), sacMat);
      sac.position.set(Math.cos(a) * 0.66, 0.36, Math.sin(a) * 0.66);
      group.add(sac);
    }
    // 꽃잎 4장 — 주머니 꼭대기에 힌지. 닫혀 있다가 예고·분출 중 바깥으로 벌어진다
    const petals: THREE.Group[] = [];
    const petalArounds: THREE.Group[] = [];
    const petalMat = new THREE.MeshLambertMaterial({ color: PETAL });
    data['petalMat'] = petalMat;
    for (let i = 0; i < 4; i++) {
      // 두 겹 — 바깥(around)은 둘레 배치(y 회전), 안(hinge)은 개폐(x 회전).
      // 한 그룹에 둘을 같이 걸면 오일러 순서(XYZ) 때문에 옆 꽃잎이 제 축으로 안 기운다
      const around = new THREE.Group();
      around.position.y = 1.4;
      around.rotation.y = (i * Math.PI) / 2;
      const hinge = new THREE.Group();
      const petal = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.04, 0.5), petalMat);
      petal.position.z = 0.25;
      hinge.add(petal);
      hinge.rotation.x = 1.05; // 닫힘 — 꽃받침처럼 주머니 어깨를 감싸 늘어진 상태
      around.add(hinge);
      group.add(around);
      petals.push(hinge);
      petalArounds.push(around);
    }
    data['petals'] = petals;
    data['petalArounds'] = petalArounds;
    // 터진 자리 — 바닥의 포자 자국 (spent 에서만 보인다)
    const residue = new THREE.Mesh(
      new THREE.CircleGeometry(1.1, 14),
      new THREE.MeshLambertMaterial({ color: 0x2f4a1e, transparent: true, opacity: 0.75 }),
    );
    residue.rotation.x = -Math.PI / 2;
    residue.position.y = 0.02;
    residue.visible = false;
    group.add(residue);
    data['residue'] = residue;
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
    // 폭발로 부서진 잔해 — 넓게 흩어진 낮은 자갈. 몸이 지나갈 수 있어 보여야 한다
    const broken = new THREE.Group();
    for (let i = 0; i < 12; i++) {
      const size = 0.2 + (i % 4) * 0.09;
      const chip = new THREE.Mesh(new THREE.BoxGeometry(size, size * 0.5, size * 0.8), gravelMat);
      chip.position.set(Math.sin(i * 2.7) * 1.45, size * 0.25, Math.cos(i * 2.2) * 1.45);
      chip.rotation.set(0, i * 1.1, 0);
      broken.add(chip);
    }
    broken.visible = false;
    group.add(broken);
    data['brokenRubble'] = broken;
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
  if (trap.type === 'trap_dart' || trap.type === 'trap_dart_auto') {
    // 판 — 예고·작동 중 내려앉는다 (가시판과 같은 3cm)
    if (plate) plate.position.y = trap.phase === 'telegraph' || trap.phase === 'firing' ? 0.0 : 0.03;
    const mats = data['nozzleMats'] as THREE.MeshLambertMaterial[] | undefined;
    const base = (data['nozzleBase'] as number | undefined) ?? IRON;
    if (mats) {
      const spent = trap.phase === 'spent';
      const glow = trap.phase === 'telegraph' ? 0.7 + 0.5 * Math.abs(Math.sin(nowMs / 40)) : spent ? 0 : 0.12;
      for (const m of mats) {
        m.emissiveIntensity = glow;
        m.color.setHex(spent ? IRON_SPENT : base);
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
    // 예고 — 1초간 바르르 떨며 부풀고, 터지면(firing) 꽃잎이 벌어지고 빛난다.
    // 한 번 터진 자리(spent)는 시든 주머니 + 늘어진 꽃잎 + 바닥 포자 자국으로 남는다
    const petals = data['petals'] as THREE.Group[] | undefined;
    const bulb = data['bulb'] as THREE.Mesh | undefined;
    const bulbMat = data['bulbMat'] as THREE.MeshLambertMaterial | undefined;
    const residue = data['residue'] as THREE.Mesh | undefined;
    const spent = trap.phase === 'spent';
    const trembling = trap.phase === 'telegraph';
    const burst = trap.phase === 'firing';
    // 떨림 — 배치 좌표를 기억해 두고 그 주위로 흔든다 (첫 호출 = 아직 흔들기 전)
    const baseX = (data['baseX'] as number | undefined) ?? (data['baseX'] = group.position.x);
    const baseZ = (data['baseZ'] as number | undefined) ?? (data['baseZ'] = group.position.z);
    group.position.x = (baseX as number) + (trembling ? (Math.random() - 0.5) * 0.07 : 0);
    group.position.z = (baseZ as number) + (trembling ? (Math.random() - 0.5) * 0.07 : 0);
    if (petals) {
      const target = burst ? -0.55 : spent ? 1.5 : 1.05; // 터짐 — 바깥으로 / 시듦 — 축 늘어짐
      for (const h of petals) h.rotation.x += (target - h.rotation.x) * 0.12;
    }
    // 시들면 꽃잎 힌지도 쭈그러진 주머니 꼭대기로 내려앉고 색이 바랜다
    const arounds = data['petalArounds'] as THREE.Group[] | undefined;
    if (arounds) for (const a of arounds) a.position.y += ((spent ? 0.92 : 1.4) - a.position.y) * 0.1;
    const petalMat = data['petalMat'] as THREE.MeshLambertMaterial | undefined;
    if (petalMat) petalMat.color.setHex(spent ? 0x4f5f33 : PETAL);
    if (bulb) {
      const swell = trembling ? 1.12 + 0.1 * Math.abs(Math.sin(nowMs / 45)) : burst ? 1.25 : spent ? 0.55 : 1;
      const targetY = spent ? 0.4 : 1.15 * swell;
      bulb.scale.set(swell, spent ? bulb.scale.y + (targetY - bulb.scale.y) * 0.1 : targetY, swell);
      if (spent) bulb.position.y += (0.72 - bulb.position.y) * 0.1; // 쭈그러져 내려앉는다
    }
    if (bulbMat) {
      bulbMat.emissiveIntensity = burst ? 0.45 + 0.2 * Math.abs(Math.sin(nowMs / 160)) : trembling ? 0.25 : 0;
      bulbMat.color.setHex(spent ? 0x4a5a2e : 0x8fbf4a);
    }
    if (residue) residue.visible = spent;
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
    const broken = data['brokenRubble'] as THREE.Group | undefined;
    const shattered = trap.rubbleBroken === true;
    if (rubble) rubble.visible = fallen && !shattered;
    if (broken) broken.visible = fallen && shattered;
  } else if (trap.type === 'trap_pendulum') {
    const arm = data['arm'] as THREE.Group | undefined;
    if (arm) {
      // 주기·진폭 — 로직과 같은 데이터를 읽는다 (최저점 = 칸 중심 = 각도 0)
      const pcfg = balance.traps.types.trap_pendulum;
      const period = Math.max(2, pcfg.periodTicks);
      const t = ((trap.cycleTick ?? 0) % period) / period;
      const angle = (pcfg.swingDeg * Math.PI) / 180 * Math.sin(t * Math.PI * 2);
      if (trap.dirX !== 0) arm.rotation.x = angle;
      else arm.rotation.z = angle;
    }
  }
}
