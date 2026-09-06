// 낫뿔 거수 비주얼 미리보기 — 게임과 같은 buildBehemothRig/poseBehemothRig 로 짓고 자세를 잡는다
// (치수는 entities.json visual 블록 × radius/height, 색은 Stage 팔레트 — 실전과 동일).
// ?view=front(기본 정면) / side(측면·걸음) / windup(낫 예고, 파랑) / strike(낫 타격 — 낫끝이 판정 4.4m 기둥에
// 닿는지) / strike-front(플레이어 눈높이에서 본 타격) / charge(돌격 예고 — 머리 내림·뿔·몸 빨강) /
// recoil(패링·막힘 튕김 — 팔이 바깥으로 들리고 낫이 매달림. 꼭대기가 3.8m 선 아래인지) /
// windup-left(왼낫 예고 — 왼 어깨가 솟는다, B1-3) / headbutt(들이받기 예고 — 머리를 뒤로 홱 젓고 뿔 빨강) / headbutt-strike(들이받기 — 내리꽂음) /
// weak(약점 5개 열림 발광·맥동 + 눈 명중 플래시, B2-1 — 정면 눈높이) /
// head_down(B2-2 — 완벽 패링에 낫이 바닥에 박혀 머리가 0.9m 로 내려온 자세: 눈 청록 맥동·관절 백황, 플레이어 눈높이 정면) /
// head_down-side(같은 자세 측면 — 다리가 바닥에 남고 낫끝이 바닥에 꽂히는지) / head_down-cooldown(혼절 쿨다운 — 눈 어두운 청록, 맥동 없음) /
// stunned(혼절 — 몸 스태거 금색, 머리 처짐·휘청, 눈 닫힘 = 처형 창) /
// skid(B2-3 — 돌격 완벽 회피에 미끄러짐: 어깨 높이를 축으로 옆 8° 굴림(발이 미끄러짐)·앞으로 밀림, 두 낫 매달림, 다리 벌려 버팀, 양 관절 백황 40틱) /
// rupture(B2-3 — 오른 관절 파열: 구체 어둡게(0x7a1f3a), 오른낫이 축 늘어져 끝이 바닥을 긁는다, 왼낫은 대기 — 오른 옆에서) /
// limp(B2-3 — 양 낫 잠김 절뚝: 두 낫이 다 끌리고 앞다리 걸음이 짧다, 측면 걸음).
// &pose=charge|head_down|… 을 붙이면 약점 구체와 머리 메시(목 IK)를 그 자세의 poseOffsets 표 자리에 놓는다
// (안내문에 구체 자리와 머리 메시의 눈 자리(anchor)를 함께 찍는다 — 어긋남이 0 에 가까워야 한다, B2-2).
// 참조물: 4.4m 기둥(= attackRange, 흰색) · 플레이어 기둥(r0.4 h1.7, 몸 표면이 4.4m) · 천장 4.0m / 낫 상한 3.8m 선.
// 안내문의 '꼭대기' 는 리그 정점(precise Box3) 최고 높이 — 어느 뷰든 3.8 아래여야 한다, '바닥' 은 최저 높이 — 0 아래로 뚫리면 안 된다
// (src/render/Behemoth.test.ts 의 천장·바닥 검사와 같은 잣대).
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
const STAGGER_COLOR = 0xcc9922; // Stage 의 스태거 표시색(몸 발광) — 약점 구체엔 쓰지 않는다

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
  poseBlend: 1,
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
  // 대지 돌격 예고 끝 — 머리 내림(목 IK → 표의 눈 1.1m)·−12° 웅크림·낫 접힘. 뿔·몸 빨강, 낫은 물들지 않는다. 로직 자세 'charge'
  torso.rotation.x = BEHEMOTH_TORSO.chargeLean;
  torso.position.y = -def.height * BEHEMOTH_TORSO.chargeCrouch;
  poseBehemothRig(rig, { ...base, chargeCoil: 1, pose: logicPose ?? 'charge' });
  tint(flash, balance.telegraph.colorUnparryable);
  tint(rig.hornMats, balance.telegraph.colorUnparryable);
  camera.position.set(2.2, 1.6, -7.5);
  camera.lookAt(0, 1.4, -0.5);
} else if (view === 'weak') {
  // 약점 5개 열림(연출 확인용으로 전부 켠다) — 발광 + 맥동 봉우리, 눈은 명중 직후 플래시. 플레이어 눈높이 정면에서 본다
  poseBehemothRig(rig, base);
  styleBehemothWeakPoints(rig, 640 / 4, (id) => ({ open: true, broken: false, flashAgeMs: id === 'eye' ? 40 : -1 }));
  camera.position.set(0.6, balance.player.eyeHeight, -7.5);
  camera.lookAt(0, 1.7, -0.5);
} else if (view === 'head_down' || view === 'head_down-side' || view === 'head_down-cooldown') {
  // 머리 내림(B2-2) — 완벽 패링에 오른낫이 바닥에 박혀 머리가 표의 눈(0.9m)까지 내려온다. 몸통 앞으로 기울고 앞다리 접힘.
  // 눈 청록 맥동 + 그 낫의 관절(joint_r) 백황 90틱 — 눈(피해)과 관절(통제)의 양자택일. 쿨다운 뷰는 눈이 어두운 청록(맥동 없음)
  torso.rotation.x = BEHEMOTH_TORSO.headDownLean;
  torso.position.y = -def.height * BEHEMOTH_TORSO.headDownCrouch;
  poseBehemothRig(rig, { ...base, pose: 'head_down' });
  const dim = view === 'head_down-cooldown';
  styleBehemothWeakPoints(rig, 640 / 4, (id) => ({ open: id === 'eye' || id === 'joint_r', broken: false, flashAgeMs: -1, dim: dim && id === 'eye' }));
  if (view === 'head_down-side') {
    camera.position.set(8.5, 1.9, -2.2);
    camera.lookAt(0, 1.2, -1.2);
  } else {
    // 플레이어 눈높이 — 패링한 자리(몸 표면 4.4m)에서 내려온 머리를 본다
    camera.position.set(0.5, balance.player.eyeHeight, -(reach + balance.player.radius));
    camera.lookAt(0, 1.1, -1.0);
  }
} else if (view === 'skid') {
  // 미끄러짐(B2-3) — 완벽 회피 직후. 몸통 옆 15°(rotation.z) + 앞으로 밀림·낮춤, 로직 자세 'skid'(표: 눈 2.2·관절 2.4), 양 관절 열림
  torso.rotation.x = BEHEMOTH_TORSO.skidLean;
  torso.rotation.z = BEHEMOTH_TORSO.skidRoll;
  torso.position.x = Math.sin(BEHEMOTH_TORSO.skidRoll) * def.visual!.joints.pos[1] * def.height; // 굴림 축 = 어깨 높이(syncEnemies 와 같다)
  torso.position.z = BEHEMOTH_TORSO.skidLunge;
  torso.position.y = -def.height * BEHEMOTH_TORSO.skidCrouch;
  poseBehemothRig(rig, { ...base, pose: 'skid' });
  styleBehemothWeakPoints(rig, 640 / 4, (id) => ({ open: id === 'joint_r' || id === 'joint_l', broken: false, flashAgeMs: -1 }));
  camera.position.set(4.5, 2.2, -7.0);
  camera.lookAt(0, 1.6, -0.6);
} else if (view === 'rupture') {
  // 관절 파열(B2-3) — 오른 관절 내구 0: 구체 어둡게, 오른낫이 축 늘어져 바닥을 긁는다(잠김 600틱). 비틀거림은 튕김 자세(recoiled). 오른 옆에서 본다
  torso.rotation.x = BEHEMOTH_TORSO.recoilLean;
  poseBehemothRig(rig, { ...base, recoiled: true, bladeLocked: { r: true, l: false } });
  styleBehemothWeakPoints(rig, 0, (id) => ({ open: false, broken: id === 'joint_r', flashAgeMs: -1 }));
  camera.position.set(7.5, 2.4, -4.5);
  camera.lookAt(0, 1.6, -0.8);
} else if (view === 'limp') {
  // 절뚝(B2-3) — 양 낫 잠김: 두 낫이 다 끌리고, 걸음에 몸이 굴러 절룩(rotation.z)·앞다리 걸음이 짧다. 측면 걸음
  torso.rotation.x = 0;
  torso.rotation.z = Math.sin(1.2) * BEHEMOTH_TORSO.limpRoll;
  poseBehemothRig(rig, { ...base, legPhase: 1.2, legBlend: 1, limping: true, bladeLocked: { r: true, l: true } });
  styleBehemothWeakPoints(rig, 0, (id) => ({ open: false, broken: id === 'joint_r' || id === 'joint_l', flashAgeMs: -1 }));
  camera.position.set(9.0, 2.4, -1.5);
  camera.lookAt(0, 1.4, -0.6);
} else if (view === 'stunned') {
  // 혼절(눈 누적 66) — 몸 스태거 금색, 머리가 처져 휘청, 눈은 닫힘(판정 없음) = 처형 창
  torso.rotation.x = BEHEMOTH_TORSO.stunnedLean;
  torso.position.y = -def.height * BEHEMOTH_TORSO.stunnedCrouch;
  poseBehemothRig(rig, { ...base, pose: 'stunned' });
  tint(flash, '#' + STAGGER_COLOR.toString(16).padStart(6, '0'));
  styleBehemothWeakPoints(rig, 0, () => ({ open: false, broken: false, flashAgeMs: -1 }));
  camera.position.set(3.5, 2.0, -7.0);
  camera.lookAt(0, 1.6, -0.8);
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
  `꼭대기 ${bounds.max.y.toFixed(2)}m (낫 상한 3.8 / 천장 4.0)   바닥 ${bounds.min.y.toFixed(2)}m (0 아래 금지)\n` +
  `wp_eye(판정 표) = ${f2(eye)}   머리 메시 눈 자리 = ${f2(eyeMesh)}   어긋남 ${eye.distanceTo(eyeMesh).toFixed(2)}m\n` +
  `wp_joint_r = ${f2(jr)}`;
document.getElementById('info')!.textContent = note;
document.title = note.replace(/\n/g, ' | ');

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);
renderer.render(scene, camera);
