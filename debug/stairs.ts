// 시작·출구 계단 미리보기 — 실제 GridLoader 코드로 벽감·계단을 지어 놓고
// 고정 카메라로 한 프레임만 그린다. 스크린샷 확인용이라 조명은 게임보다 밝다.
// ?view=front|corner|top(입구) / exit|exitcorner(출구 — 쇠사슬·자물쇠 포함)
import * as THREE from 'three';
import { Level, buildLevelGroup } from '../src/level/GridLoader';

const def = {
  id: 'debug',
  name: 'debug',
  cellSize: 4,
  ceiling: 4,
  // 스폰은 북쪽 벽을, 출구는 남쪽 벽을 등진다 — 벽감이 [0,2]·[4,2] 칸에 파인다
  grid: ['#####', '#.S.#', '#...#', '#.X.#', '#####'],
  lighting: { ambient: 0.04, torches: [] as number[][] },
};

const level = new Level(def as never);
const group = buildLevelGroup(level, {
  color: '#FF8C3B',
  intensity: 2.2,
  distance: 9,
  height: 2.6,
  wallOffset: 0.42,
});

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0a0c);
scene.add(group);
// 확인용 조명 — 게임 환경광(0.04)으로는 스크린샷이 새까맣다
scene.add(new THREE.AmbientLight(0xffffff, 0.55));
const key = new THREE.PointLight(0xffe0b0, 1.6, 30, 0);
key.position.set(10, 3.2, 8);
scene.add(key);

const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.05, 100);
const sx = level.spawn.x; // 10 (칸 [1,2] 중심)
const sz = level.spawn.z; // 6
const ex = level.exitPos!.x; // 10 (칸 [3,2] 중심)
const ez = level.exitPos!.z; // 14
const view = new URLSearchParams(location.search).get('view') ?? 'front';
if (view === 'front') {
  // 플레이어가 뒤돌아 입구 계단을 본 그림
  camera.position.set(sx, 1.6, sz + 3.2);
  camera.lookAt(sx, 1.5, sz - 4);
} else if (view === 'corner') {
  camera.position.set(sx + 3.4, 2.4, sz + 3.4);
  camera.lookAt(sx - 0.6, 1.3, sz - 3);
} else if (view === 'exit') {
  // 출구 발판 뒤에서 쇠사슬 걸린 내려가는 계단을 본 그림
  camera.position.set(ex, 1.6, ez - 3.4);
  camera.lookAt(ex, 0.9, ez + 4);
} else if (view === 'exitcorner') {
  camera.position.set(ex - 3.2, 2.2, ez - 3.0);
  camera.lookAt(ex + 0.5, 0.6, ez + 3);
} else {
  camera.position.set(sx, 7.5, sz - 1.2);
  camera.lookAt(sx, 0, sz - 2.2);
}

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);
renderer.render(scene, camera);
