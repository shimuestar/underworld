// 기믹 미리보기 — Stage.makeProp 와 같은 프리미티브 공식 (치수·색 동일)
import * as THREE from 'three';

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x14100d);
scene.add(new THREE.AmbientLight(0xffffff, 0.55));
const key = new THREE.PointLight(0xffe0b0, 1.3, 40, 0);
key.position.set(1, 3, 5);
scene.add(key);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(16, 9), new THREE.MeshLambertMaterial({ color: 0x3a3f46 }));
floor.rotation.x = -Math.PI / 2;
scene.add(floor);
const wall = new THREE.Mesh(new THREE.BoxGeometry(16, 3.4, 0.6), new THREE.MeshLambertMaterial({ color: 0x565663 }));
wall.position.set(0, 1.7, -1.7);
scene.add(wall);

function makeProp(type: string, id: number): THREE.Group {
  const group = new THREE.Group();
  const v = 0.88 + (id % 5) * 0.06; // 개체 변화
  if (type === 'prop_jar') {
    // 배불뚝이 도자기 항아리 — 굽·배·어깨·벌어진 입 + 유약 띠
    const clay = new THREE.MeshLambertMaterial({ color: 0x8f5a36 });
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.18, 0.08, 10), clay);
    foot.position.y = 0.04;
    group.add(foot);
    const belly = new THREE.Mesh(new THREE.SphereGeometry(0.28 * v, 12, 9), clay);
    belly.scale.set(1, 0.95, 1);
    belly.position.y = 0.34 * v;
    group.add(belly);
    const band = new THREE.Mesh(
      new THREE.CylinderGeometry(0.255 * v, 0.27 * v, 0.08, 12),
      new THREE.MeshLambertMaterial({ color: 0x63381e }),
    );
    band.position.y = 0.38 * v;
    group.add(band);
    const shoulder = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.2 * v, 0.16, 10), clay);
    shoulder.position.y = 0.6 * v;
    group.add(shoulder);
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.1, 0.08, 10), clay);
    rim.position.y = 0.71 * v;
    group.add(rim);
  } else if (type === 'prop_crate') {
    // 쇠띠 두른 나무 궤짝 — 몸통 + 뚜껑 턱 + 세로 쇠띠 둘 (2단 스택 변형)
    const wood = new THREE.MeshLambertMaterial({ color: 0x6e5230 });
    const iron = new THREE.MeshLambertMaterial({ color: 0x3a3d44 });
    const makeBox = (w: number, h: number, d: number, y: number, ry: number): void => {
      const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wood);
      body.position.y = y + h / 2;
      body.rotation.y = ry;
      group.add(body);
      const lid = new THREE.Mesh(new THREE.BoxGeometry(w * 1.08, 0.07, d * 1.1), wood);
      lid.position.y = y + h + 0.035;
      lid.rotation.y = ry;
      group.add(lid);
      for (const off of [-0.16, 0.16]) {
        const bandBox = new THREE.Mesh(new THREE.BoxGeometry(w * 1.02, h + 0.1, 0.05), iron);
        bandBox.position.set(Math.sin(ry) * off, y + h / 2, Math.cos(ry) * off);
        bandBox.rotation.y = ry;
        group.add(bandBox);
      }
    };
    makeBox(0.68, 0.42, 0.5, 0, (id % 7) * 0.09);
    if (id % 2 === 0) makeBox(0.46, 0.32, 0.36, 0.49, 0.5 + (id % 3) * 0.2);
  } else if (type === 'prop_bonepile') {
    // 뼈 무더기 — 긴 뼈들이 어지럽게 겹치고 해골 둘이 굴러다닌다
    const boneMat = new THREE.MeshLambertMaterial({ color: 0xcfc7b0 });
    for (let i = 0; i < 5; i++) {
      const len = 0.34 + (i % 3) * 0.08;
      const bone = new THREE.Mesh(new THREE.BoxGeometry(len, 0.045, 0.045), boneMat);
      bone.position.set(
        Math.sin(i * 2.1 + id) * 0.18,
        0.035 + i * 0.028,
        Math.cos(i * 1.7 + id) * 0.16,
      );
      bone.rotation.y = i * 1.15 + id * 0.7;
      bone.rotation.z = (i % 2) * 0.12;
      group.add(bone);
    }
    const dark = new THREE.MeshLambertMaterial({ color: 0x2a2620 });
    for (const [sx, sz, ry] of [[0.14, 0.1, 0.6], [-0.16, -0.08, 2.4]] as const) {
      const skull = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.13, 0.17), boneMat);
      skull.position.set(sx, 0.09, sz);
      skull.rotation.y = ry + id;
      group.add(skull);
      const eyes = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.035, 0.02), dark);
      eyes.position.set(sx, 0.11, sz);
      eyes.rotation.y = ry + id;
      eyes.translateZ(-0.085);
      group.add(eyes);
    }
  } else if (type === 'prop_sarcophagus') {
    // 석관 — 받침단 + 관 몸체 + 밝은 뚜껑 + 뚜껑의 십자 홈
    const plinth = new THREE.Mesh(
      new THREE.BoxGeometry(1.24, 0.14, 0.74),
      new THREE.MeshLambertMaterial({ color: 0x6e747c }),
    );
    plinth.position.y = 0.07;
    group.add(plinth);
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(1.04, 0.5, 0.58),
      new THREE.MeshLambertMaterial({ color: 0x8a8f96 }),
    );
    body.position.y = 0.39;
    group.add(body);
    const lid = new THREE.Mesh(
      new THREE.BoxGeometry(1.12, 0.14, 0.66),
      new THREE.MeshLambertMaterial({ color: 0x9aa0a8 }),
    );
    lid.position.y = 0.71;
    group.add(lid);
    const groove = new THREE.MeshLambertMaterial({ color: 0x565c66 });
    const long = new THREE.Mesh(new THREE.BoxGeometry(0.88, 0.03, 0.08), groove);
    long.position.y = 0.785;
    group.add(long);
    const cross = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.03, 0.5), groove);
    cross.position.set(-0.22, 0.785, 0);
    group.add(cross);
  } else {
    // prop_minecart — 널판 광차: 나무 몸통 + 위 테두리 쇠틀 + 광석 + 바퀴
    const wood = new THREE.MeshLambertMaterial({ color: 0x5d4a30 });
    const iron = new THREE.MeshLambertMaterial({ color: 0x3a3d44 });
    const hull = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.44, 0.58), wood);
    hull.position.y = 0.5;
    group.add(hull);
    for (const [w, d, ox, oz] of [
      [0.98, 0.07, 0, 0.29],
      [0.98, 0.07, 0, -0.29],
      [0.07, 0.62, 0.47, 0],
      [0.07, 0.62, -0.47, 0],
    ] as const) {
      const rim = new THREE.Mesh(new THREE.BoxGeometry(w, 0.08, d), iron);
      rim.position.set(ox, 0.74, oz);
      group.add(rim);
    }
    const oreMat = new THREE.MeshLambertMaterial({ color: 0x6b6f77 });
    for (const [ox, oz] of [[-0.18, 0.08], [0.14, -0.1], [0.02, 0.14]] as const) {
      const ore = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.12, 0.16), oreMat);
      ore.position.set(ox, 0.74, oz);
      ore.rotation.y = ox * 9;
      group.add(ore);
    }
    for (const [wx, wz] of [[-0.28, 0.32], [0.28, 0.32], [-0.28, -0.32], [0.28, -0.32]] as const) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.07, 9), iron);
      wheel.rotation.x = Math.PI / 2;
      wheel.position.set(wx, 0.14, wz);
      group.add(wheel);
    }
    group.rotation.y = (id % 9) * 0.7; // 버려진 방향 제각각
  }
  return group;
}

function addProp(type: string, id: number): THREE.Group {
  const g = makeProp(type, id);
  scene.add(g);
  return g;
}

// 항아리 군집 (크기 잔변화) — 벽 곁
addProp('prop_jar', 1).position.set(-5.6, 0, -1.1);
addProp('prop_jar', 3).position.set(-5.1, 0, -0.8);
addProp('prop_jar', 5).position.set(-5.9, 0, -0.6);
addProp('prop_crate', 2).position.set(-3.2, 0, -0.9);
addProp('prop_bonepile', 4).position.set(-1.1, 0, -0.9);
addProp('prop_sarcophagus', 6).position.set(1.4, 0, 0.2);
addProp('prop_minecart', 7).position.set(4.4, 0, 0.1);

// 심지 표본 — 붉은 점광 (파괴 후 폭발 당첨의 치익)
const fuse = new THREE.PointLight(0xff3820, 2.2, 6, 0);
fuse.position.set(4.4, 0.35, 1.4);
scene.add(fuse);

const camera = new THREE.PerspectiveCamera(52, innerWidth / innerHeight, 0.05, 100);
camera.position.set(-0.5, 2.4, 7.2);
camera.lookAt(-0.5, 0.4, -0.8);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);
renderer.render(scene, camera);
