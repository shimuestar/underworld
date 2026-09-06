// 낫뿔 거수 비주얼 미리보기 — 게임과 같은 buildBehemothRig/poseBehemothRig 로 짓고 자세를 잡는다
// (치수는 entities.json visual 블록 × radius/height, 색은 Stage 팔레트 — 실전과 동일).
// ?view=front(기본 정면) / side(측면·걸음) / windup(낫 예고, 파랑) / strike(낫 타격 — 낫끝이 판정 4.4m 기둥에
// 닿는지) / strike-front(플레이어 눈높이에서 본 타격) / charge(돌격 예고 — 머리 내림·뿔·몸 빨강) /
// recoil(패링·막힘 튕김 — 팔이 바깥으로 들리고 낫이 매달림. 꼭대기가 3.8m 선 아래인지) /
// windup-left(왼낫 예고 — 왼 어깨가 솟는다, B1-3) / headbutt(들이받기 예고 — 머리를 뒤로 홱 젓고 뿔 빨강) / headbutt-strike(들이받기 — 내리꽂음) /
// weak(약점 5개 열림 발광·맥동 + 눈 명중 플래시, B2-1 — 정면 눈높이). &pose=charge|head_down|… 을 붙이면 약점 구체를 그 자세의 poseOffsets 표 자리에 놓는다
// (안내문에 구체 자리와 머리 메시의 눈 자리(anchor)를 함께 찍어 표와 메시가 얼마나 어긋나는지 본다 — B2-2 재조정 근거).
// 참조물: 4.4m 기둥(= attackRange, 흰색) · 플레이어 기둥(r0.4 h1.7, 몸 표면이 4.4m) · 천장 4.0m / 낫 상한 3.8m 선.
// 안내문의 '꼭대기' 는 리그 정점(precise Box3) 최고 높이 — 어느 뷰든 3.8 아래여야 한다 (Boss.test 의 천장 검사와 같은 잣대).
import * as THREE from 'three';
import { balance } from '../src/core/Balance';
import { enemyDef } from '../src/core/Entities';
import { BEHEMOTH_TORSO, ENEMY_LEAN_JITTER, behemothAnchorPos, behemothBladeTip, buildBehemothRig, poseBehemothRig, styleBehemothWeakPoints } from '../src/render/Stage';

const def = enemyDef('scythe_behemoth');
const params = new URLSearchParams(location.search);
const view = params.get('view') ?? 'front';
/** 로직 자세 id — 약점 구체를 poseOffsets 표의 이 자세 자리에 놓는다 (없으면 normal) */
const logicPose = params.get('pose') ?? undefined;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x101014);
scene.add(new THREE.AmbientLight(0xffffff, 0.75));
const key = new THREE.PointLight(0xffe0b0, 1.6, 40, 0);
key.position.set(3, 4.5, -6);
scene.add(key);
const fill = new THREE.PointLight(0xb0c0ff, 0.6, 40, 0);
fill.position.set(-5, 3, 4);
scene.add(fill);

// 돌바닥 + 1m 격자 (치수 가늠용)
const floor = new THREE.Mesh(new THREE.PlaneGeometry(24, 24), new THREE.MeshLambertMaterial({ color: 0x2e2a26 }));
floor.rotation.x = -Math.PI / 2;
scene.add(floor);
const grid = new THREE.GridHelper(24, 24, 0x555555, 0x3a3a3a);
grid.position.y = 0.005;
scene.add(grid);

// 참조물 — attackRange(4.4m) 기둥, 플레이어 몸(표면이 4.4m 에 오게), 천장 4.0m·낫 상한 3.8m 선
const reach = def.attackRange * def.attack.impactRangeMul;
const refMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
const post = new THREE.Mesh(new THREE.BoxGeometry(0.04, 3.9, 0.04), refMat);
post.position.set(0, 1.95, -reach);
scene.add(post);
const player = new THREE.Mesh(
  new THREE.CylinderGeometry(balance.player.radius, balance.player.radius, 1.7, 12),
  new THREE.MeshLambertMaterial({ color: 0x8899aa, transparent: true, opacity: 0.55 }),
);
player.position.set(0, 0.85, -(reach + balance.player.radius));
scene.add(player);
for (const [y, c] of [[4.0, 0xffffff], [3.8, 0x888888]] as const) {
  const bar = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 12), new THREE.MeshBasicMaterial({ color: c }));
  bar.position.set(2.2, y, -2);
  scene.add(bar);
}

// ── 리그: Stage 와 같은 계층(group → torso) ──
const group = new THREE.Group();
const torso = new THREE.Group();
group.add(torso);
scene.add(group);
const flash: THREE.MeshLambertMaterial[] = [];
const rig = buildBehemothRig(group, torso, def, flash);

const pullback = reach * balance.parrySpace.pullbackRatio;
const base = {
  nowMs: 1234,
  legPhase: 0,
  legBlend: 0,
  bladeSide: 1 as const,
  bladeWindup: 0,
  bladeStriking: false,
  strikeProgress: 0,
  tipDist: pullback,
  recoiled: false,
  chargeCoil: 0,
  charging: false,
  headbuttCoil: 0,
  headbutting: false,
  trembling: false,
  snap: 1,
  pose: logicPose,
};
const tint = (mats: THREE.MeshLambertMaterial[], hex: string): void => {
  for (const m of mats) m.emissive.set(new THREE.Color(hex).getHex());
};

const camera = new THREE.PerspectiveCamera(52, innerWidth / innerHeight, 0.05, 100);
let note = '';
if (view === 'side') {
  torso.rotation.x = 0;
  poseBehemothRig(rig, { ...base, legPhase: 1.2, legBlend: 1 });
  camera.position.set(9.5, 2.6, -0.6);
  camera.lookAt(0, 1.6, -0.4);
} else if (view === 'windup') {
  // 낫 예고 끝 — 관절이 솟고 낫끝이 pullback(1.32m)까지 접힌다. 낫·몸 파랑(syncEnemies 와 같은 색 규약)
  torso.rotation.x = BEHEMOTH_TORSO.windupLean;
  poseBehemothRig(rig, { ...base, bladeWindup: 1, trembling: false, tipDist: pullback });
  tint(flash, balance.telegraph.colorParryable);
  tint(rig.bladeMats, balance.telegraph.colorParryable);
  camera.position.set(7.5, 2.8, -5.5);
  camera.lookAt(0, 1.8, -0.8);
} else if (view === 'windup-left') {
  // 왼낫 예고 끝(B1-3, attackMode 'alt') — 왼 어깨가 솟고 왼 낫끝이 pullback 까지 접힌다. 오른낫은 대기. 왼쪽에서 본다
  torso.rotation.x = BEHEMOTH_TORSO.windupLean;
  poseBehemothRig(rig, { ...base, bladeSide: -1, bladeWindup: 1, tipDist: pullback });
  tint(flash, balance.telegraph.colorParryable);
  tint(rig.bladeMats, balance.telegraph.colorParryable);
  camera.position.set(-7.5, 2.8, -5.5);
  camera.lookAt(0, 1.8, -0.8);
} else if (view === 'headbutt') {
  // 들이받기 예고 끝(B1-3, attackMode 'close') — 머리를 뒤로 홱 젓고 뿔·몸 빨강, 낫은 물들지 않는다. 솟은 뿔끝이 3.8m 선 아래
  torso.rotation.x = BEHEMOTH_TORSO.headbuttLean;
  poseBehemothRig(rig, { ...base, headbuttCoil: 1 });
  tint(flash, balance.telegraph.colorUnparryable);
  tint(rig.hornMats, balance.telegraph.colorUnparryable);
  camera.position.set(4.5, 2.4, -6.5);
  camera.lookAt(0, 2.2, -1.0);
} else if (view === 'headbutt-strike') {
  // 들이받기 타격 — 목을 앞으로 내리꽂고 몸통이 짧게 앞으로 실린다 (헛친 경직도 이 자세)
  torso.rotation.x = BEHEMOTH_TORSO.headbuttStrikeLean;
  torso.position.z = BEHEMOTH_TORSO.headbuttLunge;
  poseBehemothRig(rig, { ...base, headbutting: true });
  camera.position.set(4.5, 1.8, -6.5);
  camera.lookAt(0, 1.6, -1.0);
} else if (view === 'strike' || view === 'strike-front') {
  // 타격 끝 — 낫끝 = 판정 낫끝(4.4m). 기둥에 닿아야 한다
  torso.rotation.x = BEHEMOTH_TORSO.strikeLean;
  torso.position.z = BEHEMOTH_TORSO.strikeLunge;
  poseBehemothRig(rig, { ...base, bladeStriking: true, strikeProgress: 1, tipDist: reach });
  tint(flash, balance.telegraph.colorParryable);
  tint(rig.bladeMats, balance.telegraph.colorParryable);
  if (view === 'strike') {
    camera.position.set(9.0, 2.4, -2.6);
    camera.lookAt(0, 1.4, -2.2);
  } else {
    // 플레이어 눈높이 — 몸 표면 4.4m 에서 본다
    camera.position.set(0, balance.player.eyeHeight, -(reach + balance.player.radius));
    camera.lookAt(0, 1.8, 0);
  }
} else if (view === 'recoil') {
  // 패링·막힘 튕김 — 뒤로 젖힘(+흔들림 진폭)에 팔이 바깥으로 들리고 낫이 매달린다. 위팔 끝·뿔끝이 3.8m 선 아래
  torso.rotation.x = BEHEMOTH_TORSO.recoilLean + ENEMY_LEAN_JITTER.recoilShake;
  poseBehemothRig(rig, { ...base, recoiled: true });
  camera.position.set(7.5, 2.8, -5.5);
  camera.lookAt(0, 2.0, -1.0);
} else if (view === 'charge') {
  // 대지 돌격 예고 끝 — 머리 내림·−12° 웅크림·낫 접힘. 뿔·몸 빨강, 낫은 물들지 않는다
  torso.rotation.x = BEHEMOTH_TORSO.chargeLean;
  torso.position.y = -def.height * BEHEMOTH_TORSO.chargeCrouch;
  poseBehemothRig(rig, { ...base, chargeCoil: 1 });
  tint(flash, balance.telegraph.colorUnparryable);
  tint(rig.hornMats, balance.telegraph.colorUnparryable);
  camera.position.set(2.2, 1.6, -7.5);
  camera.lookAt(0, 1.4, -0.5);
} else if (view === 'weak') {
  // 약점 5개 열림(B2-1: 항상 노출) — 발광 + 맥동 봉우리, 눈은 명중 직후 플래시. 플레이어 눈높이 정면에서 본다
  poseBehemothRig(rig, base);
  styleBehemothWeakPoints(rig, 640 / 4, (id) => ({ open: true, broken: false, flashAgeMs: id === 'eye' ? 40 : -1 }));
  camera.position.set(0.6, balance.player.eyeHeight, -7.5);
  camera.lookAt(0, 1.7, -0.5);
} else {
  poseBehemothRig(rig, base);
  camera.position.set(0.8, 2.2, -8.5);
  camera.lookAt(0, 1.6, -0.3);
}

// 낫끝·약점 좌표를 찍어 판정과 대조한다 (group 좌표 = 적 중심 기준). 꼭대기는 리그 정점의 최고 높이
group.updateMatrixWorld(true);
const bounds = new THREE.Box3();
group.traverse((o) => {
  if (o instanceof THREE.Mesh) bounds.union(new THREE.Box3().setFromObject(o, true));
});
const tipSide = view === 'windup-left' ? -1 : 1; // 왼낫 뷰는 왼 낫끝을 잰다
const tip = behemothBladeTip(rig, tipSide, new THREE.Vector3());
const eye = rig.weakPoints['eye']!.position;
const jr = rig.weakPoints['joint_r']!.position;
// 머리 메시 위의 눈 자리(anchor) — 구체(판정 표)와 얼마나 어긋나는지. 대기 자세에선 0, 돌격 예고·들이받기에선 벌어진다(B2-2 가 메시를 표에 맞춘다)
const eyeMesh = behemothAnchorPos(rig, 'eye', new THREE.Vector3());
const f2 = (v: THREE.Vector3): string => `${v.x.toFixed(2)}, ${v.y.toFixed(2)}, ${v.z.toFixed(2)}`;
note =
  `view=${view}${logicPose ? ` pose=${logicPose}` : ''}\n` +
  `blade_${tipSide === 1 ? 'r' : 'l'} tip (x,y,z) = ${f2(tip)}  → 앞 거리 ${(-tip.z).toFixed(2)}m (판정 ${(view.startsWith('strike') ? reach : view.startsWith('windup') ? pullback : NaN).toFixed(2)})\n` +
  `꼭대기 ${bounds.max.y.toFixed(2)}m (낫 상한 3.8 / 천장 4.0)\n` +
  `wp_eye(판정 표) = ${f2(eye)}   머리 메시 눈 자리 = ${f2(eyeMesh)}   어긋남 ${eye.distanceTo(eyeMesh).toFixed(2)}m\n` +
  `wp_joint_r = ${f2(jr)}`;
document.getElementById('info')!.textContent = note;
document.title = note.replace(/\n/g, ' | ');

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);
renderer.render(scene, camera);
