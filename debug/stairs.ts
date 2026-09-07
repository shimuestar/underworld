// 시작·출구 계단 미리보기 — 실제 GridLoader 코드로 벽감·계단을 지어 놓고
// 고정 카메라로 한 프레임만 그린다. 스크린샷 확인용이라 조명은 게임보다 밝다.
// ?view=front|corner|top(입구) / exit|exitcorner(출구 — 쇠사슬·자물쇠 포함)
import * as THREE from 'three';
import { Level, buildLevelGroup } from '../src/level/GridLoader';
import z01f1 from '../data/levels/z01_f1.json';
import z01f2 from '../data/levels/z01_f2.json';
import z01f3 from '../data/levels/z01_f3.json';
import lobbyJson from '../data/levels/lobby.json';

const def = {
  id: 'debug',
  name: 'debug',
  cellSize: 4,
  ceiling: 4,
  // 스폰은 북쪽 벽을, 출구는 남쪽 벽을 등진다 — 벽감이 [0,2]·[4,2] 칸에 파인다
  grid: ['#####', '#.S.#', '#..C#', '#.X.#', '#####'],
  lighting: { ambient: 0.04, torches: [] as number[][] },
};

// ?level=z01_f1 → 실제 층을 통째로 짓는다 (레벨 구조 확인용 — view=map 과 함께 쓴다)
const REAL: Record<string, unknown> = { z01_f1: z01f1, z01_f2: z01f2, z01_f3: z01f3, lobby: lobbyJson };
const lvParam = new URLSearchParams(location.search).get('level');
const level = new Level(((lvParam && REAL[lvParam]) || def) as never);
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
// 로비는 제 조명(환경광 0.62 + 색유리창)으로 본다 — 실제 게임의 밝기를 그대로 확인하는 게 목적
if (level.theme === 'church') {
  scene.add(new THREE.AmbientLight(0xffffff, level.ambient));
} else {
  scene.add(new THREE.AmbientLight(0xffffff, 0.55));
  const key = new THREE.PointLight(0xffe0b0, 1.6, 30, 0);
  key.position.set(10, 3.2, 8);
  scene.add(key);
}

const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.05, 100);
const sx = level.spawn.x; // 10 (칸 [1,2] 중심)
const sz = level.spawn.z; // 6
const ex = level.exitPos!.x; // 10 (칸 [3,2] 중심)
const ez = level.exitPos!.z; // 14
const view = new URLSearchParams(location.search).get('view') ?? 'front';
// ?bars=up — 주인을 잡은 뒤의 그림: 창살이 감겨 올라가 촉만 매달려 있다
if (new URLSearchParams(location.search).get('bars') === 'up') {
  const bars = group.getObjectByName('exitBars');
  if (bars) bars.position.y = 2.55;
}
if (view === 'lobby') {
  // 부활 마법진에서 일어나 북쪽 대제단을 본 그림 (플레이어 눈높이)
  camera.position.set(sx, 1.6, sz + 0.5);
  camera.lookAt(level.altarPos!.x, 1.8, level.altarPos!.z);
} else if (view === 'lobbyback') {
  // 성단 앞에서 뒤돌아 회중석·현관을 본 그림
  camera.position.set(sx, 1.6, sz - 6);
  camera.lookAt(sx, 1.2, sz + 20);
} else if (view === 'lobbyside') {
  // 동쪽 익랑에서 상인 노점·열주를 본 그림
  camera.position.set(sx + 6, 1.6, sz - 3);
  camera.lookAt(sx + 16, 1.4, sz - 4);
} else if (view === 'lobbyhigh') {
  // 회중석 뒤 높은 곳에서 성단을 향해 내려다본 전경 — 장의자·열주·마법진·대제단이 한눈에
  camera.position.set(sx, 5.4, sz + 22);
  camera.lookAt(sx, 1.0, sz - 8);
} else if (view === 'front') {
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
} else if (view === 'crack') {
  // 균열 벽 — 동쪽 벽 [2,3] 을 정면에서 본다
  camera.position.set(9, 1.6, 10);
  camera.lookAt(15, 1.6, 10);
} else if (view === 'exitcorner') {
  camera.position.set(ex - 3.2, 2.2, ez - 3.0);
  camera.lookAt(ex + 0.5, 0.6, ez + 3);
} else if (view === 'map') {
  // 층 전체 탑뷰 — 로비·방·복도 구조를 한눈에 본다. 천장을 벗겨야 속이 보인다
  group.traverse((o) => {
    if (o.name === 'ceiling') o.visible = false;
  });
  const w = level.cols * 4;
  const d = level.rows * 4;
  const need = Math.max(d, w / camera.aspect);
  camera.far = 600;
  camera.updateProjectionMatrix();
  camera.position.set(w / 2, need / (2 * Math.tan(((camera.fov / 2) * Math.PI) / 180)) + 6, d / 2 + 0.01);
  camera.lookAt(w / 2, 0, d / 2);
  scene.add(new THREE.AmbientLight(0xffffff, 1.1));
} else {
  camera.position.set(sx, 7.5, sz - 1.2);
  camera.lookAt(sx, 0, sz - 2.2);
}

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);
renderer.render(scene, camera);
