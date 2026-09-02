// 함정 모형 미리보기 — 실제 빌더(TrapVisuals)를 import 해 phase 별로 늘어놓는다
import * as THREE from 'three';
import { animateTrap, buildTrapGroup } from '../src/render/TrapVisuals';

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x14100d);
scene.add(new THREE.AmbientLight(0xffffff, 0.5));
const key = new THREE.PointLight(0xffe0b0, 1.4, 40, 0);
key.position.set(1, 3.2, 5);
scene.add(key);
// 판석 바닥 — 함정 판이 바닥과 구분되는지(tell) 본다
const floor = new THREE.Mesh(new THREE.PlaneGeometry(26, 10), new THREE.MeshLambertMaterial({ color: 0x4a423a }));
floor.rotation.x = -Math.PI / 2;
scene.add(floor);
// 뒷벽 — 다트 노즐이 박히는 벽 (-dir = 북쪽)
const wall = new THREE.Mesh(new THREE.BoxGeometry(26, 3.4, 0.6), new THREE.MeshLambertMaterial({ color: 0x565663 }));
wall.position.set(0, 1.7, -2.6); // 앞면 z=-2.3 = 함정 칸(-0.3) 북쪽 경계 — 노즐이 벽면에서 튀어나온다
scene.add(wall);

const specimens: { trap: { type: string; phase: string; timer: number; dirX: number; dirZ: number }; x: number }[] = [
  { trap: { type: 'trap_dart', phase: 'armed', timer: 0, dirX: 0, dirZ: 1 }, x: -8 },
  { trap: { type: 'trap_dart', phase: 'telegraph', timer: 10, dirX: 0, dirZ: 1 }, x: -4 },
  { trap: { type: 'trap_dart', phase: 'spent', timer: 0, dirX: 0, dirZ: 1 }, x: 0 },
  { trap: { type: 'trap_spike', phase: 'armed', timer: 0, dirX: 0, dirZ: -1 }, x: 4 },
  { trap: { type: 'trap_spike', phase: 'firing', timer: 10, dirX: 0, dirZ: -1 }, x: 8 },
];
const groups = specimens.map((s) => {
  const g = buildTrapGroup(s.trap, 4);
  g.position.set(s.x, 0, -0.3);
  scene.add(g);
  return g;
});

const camera = new THREE.PerspectiveCamera(52, innerWidth / innerHeight, 0.05, 100);
camera.position.set(0, 3.2, 8.5);
camera.lookAt(0, 0.5, -0.5);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);
// 두 프레임 — 가시가 '순간 솟음' 규칙으로 바로 올라온 상태를 찍는다
for (let f = 0; f < 3; f++) {
  specimens.forEach((s, i) => animateTrap(groups[i]!, s.trap, 1000 + f * 16));
}
renderer.render(scene, camera);
