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
  const v = 0.88 + (id % 5) * 0.06;
  if (type === 'prop_jar') {
    const mat = new THREE.MeshLambertMaterial({ color: 0x9a5f38 });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.3, 0.62 * v, 9), mat);
    body.position.y = (0.62 * v) / 2;
    group.add(body);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.21, 0.24 * v, 9), mat);
    neck.position.y = 0.62 * v + (0.24 * v) / 2 - 0.02;
    group.add(neck);
  } else if (type === 'prop_crate') {
    const mat = new THREE.MeshLambertMaterial({ color: 0x7a5a34 });
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.5, 0.72), mat);
    base.position.y = 0.25;
    base.rotation.y = (id % 7) * 0.09;
    group.add(base);
    if (id % 2 === 0) {
      const top = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.36, 0.5), mat);
      top.position.set(0.06, 0.68, -0.04);
      top.rotation.y = 0.4 + (id % 3) * 0.2;
      group.add(top);
    }
  } else if (type === 'prop_bonepile') {
    const mound = new THREE.Mesh(new THREE.SphereGeometry(0.42, 9, 6), new THREE.MeshLambertMaterial({ color: 0x6a6152 }));
    mound.scale.set(1, 0.35, 1);
    group.add(mound);
    const boneMat = new THREE.MeshLambertMaterial({ color: 0xcfc7b0 });
    for (let i = 0; i < 3; i++) {
      const bone = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.05, 0.05), boneMat);
      bone.position.set((i - 1) * 0.12, 0.14 + i * 0.03, (i % 2) * 0.1 - 0.05);
      bone.rotation.y = i * 1.1 + id;
      group.add(bone);
    }
    const skull = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.14, 0.18), boneMat);
    skull.position.set(0.12, 0.2, 0.08);
    group.add(skull);
  } else if (type === 'prop_sarcophagus') {
    const stone = new THREE.MeshLambertMaterial({ color: 0x8a8f96 });
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.7, 0.62), stone);
    base.position.y = 0.35;
    group.add(base);
    const lid = new THREE.Mesh(new THREE.BoxGeometry(1.18, 0.16, 0.7), new THREE.MeshLambertMaterial({ color: 0x777c84 }));
    lid.position.y = 0.78;
    lid.rotation.y = 0.03;
    group.add(lid);
  } else {
    const hullMat = new THREE.MeshLambertMaterial({ color: 0x5f5348 });
    const hull = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.5, 0.6), hullMat);
    hull.position.y = 0.45;
    group.add(hull);
    const inner = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.1, 0.46), new THREE.MeshBasicMaterial({ color: 0x14100d }));
    inner.position.y = 0.71;
    group.add(inner);
    const wheelMat = new THREE.MeshLambertMaterial({ color: 0x3c3f45 });
    for (const [wx, wz] of [[-0.3, 0.3], [0.3, 0.3], [-0.3, -0.3], [0.3, -0.3]] as const) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.07, 8), wheelMat);
      wheel.rotation.x = Math.PI / 2;
      wheel.position.set(wx, 0.13, wz);
      group.add(wheel);
    }
    group.rotation.y = 0.5;
  }
  scene.add(group);
  return group;
}

// 항아리 군집 (크기 잔변화) — 벽 곁
makeProp('prop_jar', 1).position.set(-5.6, 0, -1.1);
makeProp('prop_jar', 3).position.set(-5.1, 0, -0.8);
makeProp('prop_jar', 5).position.set(-5.9, 0, -0.6);
makeProp('prop_crate', 2).position.set(-3.2, 0, -0.9);
makeProp('prop_bonepile', 4).position.set(-1.1, 0, -0.9);
makeProp('prop_sarcophagus', 6).position.set(1.4, 0, 0.2);
makeProp('prop_minecart', 7).position.set(4.4, 0, 0.1);

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
