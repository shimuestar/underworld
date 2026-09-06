// 낫뿔 거수 리그 — 렌더러 없이 순수 지오메트리로 지어 잰다(B1-2 천장·낫끝 검사는 Boss.test 에서 이쪽으로 옮겼다, B2-2).
// 약점 구체가 판정과 같은 poseOffsets 표를 읽는지(보이는 자리 = 판정 자리), 머리 메시의 눈이 목 IK 로 같은 자리에 오는지,
// 어느 자세에서도 꼭대기가 3.8m 아래·발과 낫끝이 바닥 위인지.

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { balance } from '../core/Balance';
import { enemyDef, weakPointOffset } from '../core/Entities';
import {
  BEHEMOTH_TORSO,
  ENEMY_LEAN_JITTER,
  behemothAnchorPos,
  behemothBladeTip,
  buildBehemothRig,
  poseBehemothRig,
  solveNeckToEye,
  styleBehemothWeakPoints,
  type BehemothPose,
} from './Stage';

const def = enemyDef('scythe_behemoth');
const reach = def.attackRange * def.attack.impactRangeMul;
const pullback = reach * balance.parrySpace.pullbackRatio;
const T = BEHEMOTH_TORSO;
const J = ENEMY_LEAN_JITTER;

/** 실제 리그를 지어 Stage 와 같은 기울임·전진·낮춤·(굴림)·자세를 넣고 잰다 */
function measureRig(lean: number, lunge: number, crouch: number, pose: Partial<BehemothPose>, roll = 0) {
  const base: BehemothPose = {
    nowMs: 0, legPhase: 0, legBlend: 0, bladeSide: 1, bladeWindup: 0, bladeStriking: false,
    strikeProgress: 0, tipDist: pullback, recoiled: false, chargeCoil: 0, charging: false,
    headbuttCoil: 0, headbutting: false, trembling: false, snap: 1,
  };
  const group = new THREE.Group();
  const torso = new THREE.Group();
  group.add(torso);
  const flash: THREE.MeshLambertMaterial[] = [];
  const rig = buildBehemothRig(group, torso, def, flash);
  torso.rotation.x = lean;
  torso.rotation.z = roll;
  torso.position.z = lunge;
  torso.position.y = crouch;
  poseBehemothRig(rig, { ...base, ...pose });
  group.updateMatrixWorld(true);
  const box = new THREE.Box3();
  group.traverse((o) => {
    if (o instanceof THREE.Mesh) box.union(new THREE.Box3().setFromObject(o, true)); // precise — 기운 원뿔의 헐거운 AABB 가 아니라 정점으로
  });
  const tip = behemothBladeTip(rig, pose.bladeSide ?? 1, new THREE.Vector3()); // 휘두르는 쪽 낫끝
  return { rig, box, tip, flash, group, torso };
}

/** 자세별 몸통 값 — syncEnemies 가 쓰는 BEHEMOTH_TORSO 와 같은 조합 */
const HEAD_DOWN = { lean: T.headDownLean, lunge: 0, crouch: -def.height * T.headDownCrouch };
const CHARGE = { lean: T.chargeLean, lunge: 0, crouch: -def.height * T.chargeCrouch };
const STUNNED = { lean: T.stunnedLean, lunge: 0, crouch: -def.height * T.stunnedCrouch };
const SKID = { lean: T.skidLean, lunge: T.skidLunge, crouch: -def.height * T.skidCrouch, roll: T.skidRoll };

describe('약점 구체 = 판정 구체', () => {
  it('구체는 def.weakPoints 마다 하나(wp_<id>), group 소속, 반지름 = wp.radius, 자리 = normal 표', () => {
    const { rig, group, flash } = measureRig(0, 0, 0, {});
    for (const wp of def.weakPoints!) {
      const mesh = rig.weakPoints[wp.id]!;
      expect(mesh, wp.id).toBeDefined();
      expect(mesh.name).toBe(`wp_${wp.id}`);
      expect(mesh.parent).toBe(group);
      expect((mesh.geometry as THREE.SphereGeometry).parameters.radius).toBeCloseTo(wp.radius, 6);
      expect([mesh.position.x, mesh.position.y, mesh.position.z]).toEqual([wp.offset.x, wp.offset.y, wp.offset.z]);
      expect(flash).not.toContain(mesh.material as THREE.MeshLambertMaterial);
    }
    expect(Object.keys(rig.weakPoints)).toHaveLength(def.weakPoints!.length);
  });

  it('로직 자세(pose)가 있으면 poseOffsets 표의 그 자세 자리 — 몸통 기울임·웅크림에 딸려 가지 않는다. poseBlend 는 normal ↔ 표 보간', () => {
    const charge = measureRig(CHARGE.lean, 0, CHARGE.crouch, { pose: 'charge', chargeCoil: 1 });
    for (const wp of def.weakPoints!) {
      const off = weakPointOffset(def, wp, 'charge');
      const p = charge.rig.weakPoints[wp.id]!.position;
      expect([p.x, p.y, p.z], wp.id).toEqual([off.x, off.y, off.z]);
    }
    expect(charge.rig.weakPoints['eye']!.position.y).toBeCloseTo(1.1, 6);
    const headDown = measureRig(HEAD_DOWN.lean, 0, HEAD_DOWN.crouch, { pose: 'head_down' });
    expect(headDown.rig.weakPoints['eye']!.position.y).toBeCloseTo(0.9, 6);
    expect(headDown.rig.weakPoints['eye']!.position.z).toBeCloseTo(-1.9, 6);
    // 표에 없는 자세는 normal
    const odd = measureRig(0, 0, 0, { pose: 'no_such_pose' });
    expect(odd.rig.weakPoints['eye']!.position.y).toBeCloseTo(2.35, 6);
    // 반쯤 진행 — normal(2.35)과 head_down(0.9)의 중간
    const half = measureRig(HEAD_DOWN.lean, 0, HEAD_DOWN.crouch, { pose: 'head_down', poseBlend: 0.5 });
    expect(half.rig.weakPoints['eye']!.position.y).toBeCloseTo((2.35 + 0.9) / 2, 6);
    expect(half.rig.weakPoints['eye']!.position.z).toBeCloseTo((-1.88 - 1.9) / 2, 6);
    // 진행 0 이면 자세가 있어도 normal 자리 (자세가 풀리며 되돌아가는 마지막)
    const zero = measureRig(0, 0, 0, { pose: 'head_down', poseBlend: 0 });
    expect(zero.rig.weakPoints['eye']!.position.y).toBeCloseTo(2.35, 6);
  });

  it('자세 없이 몸만 움직이면(들이받기 예고) 구체는 normal 자리에 남고, 머리 메시의 눈 자리(anchor)만 움직인다', () => {
    const rest = measureRig(0, 0, 0, {});
    const coil = measureRig(T.headbuttLean, 0, 0, { headbuttCoil: 1 });
    const eyeRest = rest.rig.weakPoints['eye']!.position;
    const eyeCoil = coil.rig.weakPoints['eye']!.position;
    expect([eyeCoil.x, eyeCoil.y, eyeCoil.z]).toEqual([eyeRest.x, eyeRest.y, eyeRest.z]);
    const anchorRest = behemothAnchorPos(rest.rig, 'eye', new THREE.Vector3());
    const anchorCoil = behemothAnchorPos(coil.rig, 'eye', new THREE.Vector3());
    expect(anchorCoil.y).toBeGreaterThan(anchorRest.y + 0.15);
    // 대기 자세에서는 메시의 눈 자리와 구체가 같은 곳이다 (표 normal = 외형 표)
    expect(anchorRest.distanceTo(eyeRest)).toBeLessThan(0.02);
    for (const id of ['joint_r', 'joint_l', 'heart', 'vent']) {
      expect(behemothAnchorPos(rest.rig, id, new THREE.Vector3()).distanceTo(rest.rig.weakPoints[id]!.position), id).toBeLessThan(0.02);
    }
  });

  it('목 IK(B2-2) — 표 자세(charge·head_down·stunned)에서 머리 메시의 눈 자리가 구체(표)와 같은 곳에 온다(어긋남 ≤ 0.06m), 얼굴은 앞아래를 본다', () => {
    const cases: { name: string; lean: number; crouch: number; pose: Partial<BehemothPose> }[] = [
      { name: 'charge', ...CHARGE, pose: { pose: 'charge', chargeCoil: 1 } },
      { name: 'charging', ...CHARGE, pose: { pose: 'charge', charging: true } },
      { name: 'head_down', ...HEAD_DOWN, pose: { pose: 'head_down' } },
      { name: 'stunned', ...STUNNED, pose: { pose: 'stunned' } },
      // 진행 중간에도 구체와 머리가 함께 간다
      { name: 'head_down 0.5', ...HEAD_DOWN, pose: { pose: 'head_down', poseBlend: 0.5 } },
      { name: 'charge coil 0.4', lean: T.chargeLean * 0.4, crouch: -def.height * T.chargeCrouch * 0.4, pose: { pose: 'charge', chargeCoil: 0.4, poseBlend: 0.4 } },
    ];
    for (const c of cases) {
      const { rig } = measureRig(c.lean, 0, c.crouch, c.pose);
      const anchor = behemothAnchorPos(rig, 'eye', new THREE.Vector3());
      const sphere = rig.weakPoints['eye']!.position;
      expect(anchor.distanceTo(sphere), `${c.name} 어긋남 ${anchor.distanceTo(sphere).toFixed(3)}`).toBeLessThanOrEqual(0.06);
    }
    // 얼굴 방향 — head_down·charge 에서 머리가 앞아래를 본다(곧게 바닥이 아니라, 눈이 정면에서 보이게): 머리 중심이 눈보다 뒤·위
    for (const c of cases.slice(0, 3)) {
      const { rig, torso } = measureRig(c.lean, 0, c.crouch, c.pose);
      const eye = behemothAnchorPos(rig, 'eye', new THREE.Vector3());
      const headCenter = new THREE.Vector3();
      let o: THREE.Object3D | null = rig.head;
      while (o && o !== torso.parent) {
        o.updateMatrix();
        headCenter.applyMatrix4(o.matrix);
        o = o.parent;
      }
      const dz = eye.z - headCenter.z; // 앞(−z)으로 나가 있어야
      const dy = eye.y - headCenter.y; // 아래
      const faceDeg = (Math.atan2(dy, -dz) * 180) / Math.PI;
      expect(faceDeg, `${c.name} 얼굴 ${faceDeg.toFixed(0)}°`).toBeLessThan(-20);
      expect(faceDeg, `${c.name} 얼굴 ${faceDeg.toFixed(0)}°`).toBeGreaterThan(-75);
    }
    // 자세가 없으면(대기) IK 도 대기 각 — 목·머리 회전 0
    const rest = measureRig(0, 0, 0, {});
    expect(Math.abs(rest.rig.neck.rotation.x)).toBeLessThan(1e-6);
    expect(Math.abs(rest.rig.headPitch.rotation.x)).toBeLessThan(1e-6);
    // 대기 눈 자리를 표적으로 주면 0 이 나온다 (해의 가지가 대기 자세를 재현한다)
    const ik = solveNeckToEye(rest.rig, 0, 0, 0, { x: 0, y: 2.35, z: -1.88 });
    expect(Math.abs(ik.neck)).toBeLessThan(0.01);
    expect(Math.abs(ik.pitch)).toBeLessThan(0.01);
  });

  it('표시 — 열림: 발광(id 색)+맥동 ±12% / 쿨다운(dim): 어두운 청록·맥동 없음 / 파열: 어둡게·발광 없음 / 명중 직후: 더 밝게. 텔레그래프 3색·스태거 금색은 쓰지 않는다', () => {
    const { rig } = measureRig(0, 0, 0, {});
    const forbidden = new Set([0x4a9eff, 0xff3b3b, 0xa855f7, 0xcc9922, 0xffb648]);
    const mat = (id: string) => rig.weakPoints[id]!.material as THREE.MeshLambertMaterial;
    // 열림, 맥동 봉우리(sin = 1)
    styleBehemothWeakPoints(rig, 640 / 4, () => ({ open: true, broken: false, flashAgeMs: -1 }));
    expect(rig.weakPoints['eye']!.scale.x).toBeCloseTo(1.12, 3);
    expect(mat('eye').emissive.getHex()).toBe(0x3ff0d0);
    expect(mat('joint_r').emissive.getHex()).toBe(0xfff4c8);
    expect(mat('heart').emissive.getHex()).toBe(0xff2e63);
    expect(mat('vent').emissive.getHex()).toBe(0x39ff88);
    for (const id in rig.weakPoints) expect(forbidden.has(mat(id).emissive.getHex()), id).toBe(false);
    const openIntensity = mat('eye').emissiveIntensity;
    // 골(sin = −1)
    styleBehemothWeakPoints(rig, (640 * 3) / 4, () => ({ open: true, broken: false, flashAgeMs: -1 }));
    expect(rig.weakPoints['eye']!.scale.x).toBeCloseTo(0.88, 3);
    // 혼절 쿨다운 — 열려 있되 어두운 청록, 맥동 없음, 열림보다 어둡다
    styleBehemothWeakPoints(rig, 640 / 4, (id) => ({ open: true, broken: false, flashAgeMs: -1, dim: id === 'eye' }));
    expect(rig.weakPoints['eye']!.scale.x).toBe(1);
    expect(mat('eye').emissive.getHex()).not.toBe(0x3ff0d0);
    expect(mat('eye').emissive.getHex()).toBe(0x1c6e60);
    expect(mat('eye').emissiveIntensity).toBeLessThan(openIntensity);
    expect(forbidden.has(mat('eye').emissive.getHex())).toBe(false);
    expect(rig.weakPoints['joint_r']!.scale.x).toBeCloseTo(1.12, 3); // 관절은 그대로 맥동
    // 명중 직후 — 더 밝다
    styleBehemothWeakPoints(rig, 0, (id) => ({ open: true, broken: false, flashAgeMs: id === 'eye' ? 0 : -1 }));
    expect(mat('eye').emissiveIntensity).toBeGreaterThan(openIntensity);
    expect(mat('vent').emissiveIntensity).toBeCloseTo(openIntensity, 6);
    // 파열
    styleBehemothWeakPoints(rig, 0, (id) => ({ open: id !== 'joint_r', broken: id === 'joint_r', flashAgeMs: -1 }));
    expect(mat('joint_r').emissive.getHex()).toBe(0);
    expect(mat('joint_r').color.getHex()).toBe(0x7a1f3a);
    expect(rig.weakPoints['joint_r']!.scale.x).toBe(1);
    expect(mat('joint_l').emissive.getHex()).toBe(0xfff4c8);
    // 닫힘 — 본색, 발광 없음, 크기 1
    styleBehemothWeakPoints(rig, 0, () => ({ open: false, broken: false, flashAgeMs: -1 }));
    expect(mat('eye').emissive.getHex()).toBe(0);
    expect(mat('eye').color.getHex()).toBe(0x0f3a36);
    expect(rig.weakPoints['eye']!.scale.x).toBe(1);
  });
});

describe('리그 천장·바닥·낫끝 검사 (B1-2 → B2-2 이동)', () => {
  const CEIL = 3.8; // 기획서 §2 낫 상한 (천장 4m)
  const FLOOR = -0.08; // 기운 원기둥 발의 테두리(r 0.22)가 살짝 잠기는 만큼만 허용 — 배치 1 메모 (c) 돌격 −0.46m 는 안 된다
  // 떨림은 sin(nowMs/12)·sin(nowMs/11) 진폭 — 봉우리 근처를 몇 점 찍는다
  const peaks = [0, 12 * Math.PI * 0.5, 11 * Math.PI * 0.5, 100, 1234];
  const cases: { name: string; lean: number; lunge: number; crouch: number; pose: Partial<BehemothPose>; roll?: number }[] = [
    { name: 'rest', lean: 0, lunge: 0, crouch: 0, pose: {} },
    { name: 'rest+flinch', lean: T.flinchLean, lunge: 0, crouch: 0, pose: {} },
    { name: 'walk', lean: 0, lunge: 0, crouch: 0, pose: { legPhase: Math.PI / 2, legBlend: 1 } },
    { name: 'windup', lean: T.windupLean, lunge: 0, crouch: 0, pose: { bladeWindup: 1, tipDist: pullback } },
    ...peaks.map((nowMs) => ({
      name: `windup+tremble+flinch@${nowMs.toFixed(0)}`,
      lean: T.windupLean + J.tremble + T.flinchLean, lunge: 0, crouch: 0,
      pose: { bladeWindup: 1, tipDist: pullback, trembling: true, nowMs },
    })),
    ...[0, 0.25, 0.5, 0.75, 1].map((sp) => ({
      name: `strike ${sp}`,
      // 타격 첫 프레임은 기울임이 아직 예고값(+떨림) 근처다 — 그쪽도 잰다
      lean: sp === 0 ? T.windupLean + J.tremble : T.strikeLean, lunge: T.strikeLunge, crouch: 0,
      pose: { bladeStriking: true, strikeProgress: sp, tipDist: pullback + (reach - pullback) * sp },
    })),
    { name: 'recoil', lean: T.recoilLean + J.recoilShake, lunge: 0, crouch: 0, pose: { recoiled: true } },
    { name: 'recoil+flinch', lean: T.recoilLean + J.recoilShake + T.flinchLean, lunge: 0, crouch: 0, pose: { recoiled: true } },
    // 돌격 예고 — 로직 자세 'charge'(목 IK 로 머리 내림) + 앞발 긁기 떨림·움찔
    ...peaks.map((nowMs) => ({
      name: `charge coil+tremble@${nowMs.toFixed(0)}`,
      lean: T.chargeLean + J.tremble + T.flinchLean, lunge: 0, crouch: CHARGE.crouch,
      pose: { pose: 'charge', chargeCoil: 1, trembling: true, nowMs },
    })),
    { name: 'charging', ...CHARGE, pose: { pose: 'charge', charging: true } },
    // B1-3 들이받기 — 예고에 목을 뒤로 젓으면 뿔끝이 솟는다. 중간 진행·떨림·움찔까지 / 타격(내리꽂음)
    ...[0.25, 0.5, 0.75, 1].map((c) => ({
      name: `headbutt coil ${c}+flinch`,
      lean: T.headbuttLean * c + T.flinchLean, lunge: 0, crouch: 0,
      pose: { headbuttCoil: c },
    })),
    ...peaks.map((nowMs) => ({
      name: `headbutt coil+tremble+flinch@${nowMs.toFixed(0)}`,
      lean: T.headbuttLean + J.tremble + T.flinchLean, lunge: 0, crouch: 0,
      pose: { headbuttCoil: 1, trembling: true, nowMs },
    })),
    { name: 'headbutt strike', lean: T.headbuttStrikeLean, lunge: T.headbuttLunge, crouch: 0, pose: { headbutting: true } },
    { name: 'headbutt strike+flinch', lean: T.headbuttStrikeLean + T.flinchLean, lunge: T.headbuttLunge, crouch: 0, pose: { headbutting: true } },
    // B1-3 왼낫(bladeSide −1) — 리그는 좌우 대칭이지만 실제로 잰다
    { name: 'left windup+tremble+flinch', lean: T.windupLean + J.tremble + T.flinchLean, lunge: 0, crouch: 0, pose: { bladeSide: -1, bladeWindup: 1, tipDist: pullback, trembling: true, nowMs: 100 } },
    { name: 'left strike 0', lean: T.windupLean + J.tremble, lunge: T.strikeLunge, crouch: 0, pose: { bladeSide: -1, bladeStriking: true, strikeProgress: 0, tipDist: pullback } },
    { name: 'left recoil+flinch', lean: T.recoilLean + J.recoilShake + T.flinchLean, lunge: 0, crouch: 0, pose: { bladeSide: -1, recoiled: true } },
    // B2-2 머리 내림(오른낫·왼낫 박힘, 진행 중간, 움찔) / 혼절(휘청 봉우리)
    { name: 'head_down r', ...HEAD_DOWN, pose: { pose: 'head_down' } },
    { name: 'head_down l', ...HEAD_DOWN, pose: { pose: 'head_down', bladeSide: -1 } },
    { name: 'head_down 0.5', lean: T.headDownLean * 0.5, lunge: 0, crouch: HEAD_DOWN.crouch * 0.5, pose: { pose: 'head_down', poseBlend: 0.5 } },
    { name: 'head_down+flinch', lean: T.headDownLean + T.flinchLean, lunge: 0, crouch: HEAD_DOWN.crouch, pose: { pose: 'head_down' } },
    ...peaks.map((nowMs) => ({ name: `stunned@${nowMs.toFixed(0)}`, lean: T.stunnedLean + 0.02, lunge: 0, crouch: STUNNED.crouch, pose: { pose: 'stunned', nowMs } })),
    // B2-3 미끄러짐(옆 15° 굴림 + 앞으로 밀림, 두 낫 매달림, 다리 벌려 버팀) — 굴림 양쪽·움찔·진행 중간
    ...peaks.map((nowMs) => ({ name: `skid@${nowMs.toFixed(0)}`, lean: SKID.lean + T.flinchLean, lunge: SKID.lunge, crouch: SKID.crouch, roll: SKID.roll, pose: { pose: 'skid', nowMs } })),
    { name: 'skid roll-', ...SKID, roll: -SKID.roll, pose: { pose: 'skid' } },
    { name: 'skid 0.5', lean: SKID.lean * 0.5, lunge: SKID.lunge * 0.5, crouch: SKID.crouch * 0.5, roll: SKID.roll * 0.5, pose: { pose: 'skid', poseBlend: 0.5 } },
    // B2-3 잠긴 낫(관절 파열) — 오른/왼/양쪽, 대기·걸음·튕김(비틀거림)·예고(남은 낫)·돌격 웅크림에서 끌리는 낫끝이 바닥 위
    { name: 'locked r', lean: 0, lunge: 0, crouch: 0, pose: { bladeLocked: { r: true, l: false } } },
    { name: 'locked l walk', lean: 0, lunge: 0, crouch: 0, pose: { bladeLocked: { r: false, l: true }, legPhase: Math.PI / 2, legBlend: 1 } },
    { name: 'locked r recoil+flinch', lean: T.recoilLean + J.recoilShake + T.flinchLean, lunge: 0, crouch: 0, pose: { bladeLocked: { r: true, l: false }, recoiled: true } },
    { name: 'locked r + left windup', lean: T.windupLean + J.tremble, lunge: 0, crouch: 0, pose: { bladeLocked: { r: true, l: false }, bladeSide: -1, bladeWindup: 1, tipDist: pullback, trembling: true, nowMs: 100 } },
    { name: 'locked both charging', ...CHARGE, pose: { pose: 'charge', charging: true, bladeLocked: { r: true, l: true } } },
    { name: 'locked both head_down', ...HEAD_DOWN, pose: { pose: 'head_down', bladeLocked: { r: true, l: true } } },
    // B2-3 절뚝(양 낫 잠김) — 절룩 걸음 + 몸 굴림 양쪽 봉우리
    ...[Math.PI / 2, -Math.PI / 2].map((ph) => ({
      name: `limp walk ${ph > 0 ? '+' : '-'}`, lean: 0, lunge: 0, crouch: 0, roll: Math.sin(ph) * T.limpRoll,
      pose: { limping: true, bladeLocked: { r: true, l: true }, legPhase: ph, legBlend: 1 },
    })),
  ];

  it('어깨→위팔→낫을 실제로 지어 모든 자세(떨림·움찔·튕김 흔들림을 더한 최악)에서 꼭대기가 3.8m 아래', () => {
    for (const c of cases) {
      const { box } = measureRig(c.lean, c.lunge, c.crouch, c.pose, c.roll ?? 0);
      expect(box.max.y, `${c.name} 꼭대기 ${box.max.y.toFixed(2)}m`).toBeLessThanOrEqual(CEIL);
    }
  });

  it('바닥(B2-2, 배치 1 메모 c) — 모든 자세에서 발·낫끝이 바닥을 뚫지 않는다: 기울임·낮춤만큼 다리를 늘이고 접어 발이 바닥에 남는다', () => {
    for (const c of cases) {
      const { box, rig } = measureRig(c.lean, c.lunge, c.crouch, c.pose, c.roll ?? 0);
      expect(box.min.y, `${c.name} 바닥 ${box.min.y.toFixed(2)}m`).toBeGreaterThanOrEqual(FLOOR);
      // 발끝(다리 원기둥 밑면 중심)이 바닥 근처
      for (const hip of rig.legs) {
        const foot = new THREE.Vector3(0, -rig.dims.legH * (hip.children[0]!.scale.y), 0);
        let o: THREE.Object3D | null = hip;
        while (o && o !== rig.torso.parent) {
          o.updateMatrix();
          foot.applyMatrix4(o.matrix);
          o = o.parent;
        }
        expect(foot.y, `${c.name} 발 ${foot.y.toFixed(2)}`).toBeGreaterThanOrEqual(-0.02);
        expect(foot.y, `${c.name} 발 ${foot.y.toFixed(2)}`).toBeLessThanOrEqual(0.35); // 걸음·긁기의 들림 이상으로 뜨지 않는다
      }
    }
    // 대기·돌격 웅크림에서 발이 정확히 바닥
    for (const c of [cases[0]!, { name: 'charging', ...CHARGE, pose: { pose: 'charge', charging: true } }]) {
      const { rig } = measureRig(c.lean, c.lunge, c.crouch, c.pose);
      for (const hip of rig.legs) {
        const foot = new THREE.Vector3(0, -rig.dims.legH * (hip.children[0]!.scale.y), 0);
        let o: THREE.Object3D | null = hip;
        while (o && o !== rig.torso.parent) {
          o.updateMatrix();
          foot.applyMatrix4(o.matrix);
          o = o.parent;
        }
        expect(Math.abs(foot.y), `${c.name} 발 ${foot.y.toFixed(3)}`).toBeLessThan(0.01);
      }
    }
  });

  it('머리 내림(B2-2) — 그 낫(bladeSide)이 곧게 내려와 낫끝이 바닥에 꽂힌다(플레이어 앞 바닥, 중심선 쪽으로), 다른 낫은 대기. 머리는 표의 눈(0.9m) 아래·천장 위 어디도 안 뚫는다', () => {
    for (const side of [1, -1] as const) {
      const { rig, tip } = measureRig(HEAD_DOWN.lean, 0, HEAD_DOWN.crouch, { pose: 'head_down', bladeSide: side });
      expect(tip.y, `side ${side} 낫끝 y ${tip.y.toFixed(2)}`).toBeGreaterThanOrEqual(0);
      expect(tip.y, `side ${side} 낫끝 y ${tip.y.toFixed(2)}`).toBeLessThanOrEqual(0.25);
      expect(-tip.z).toBeGreaterThan(2.4); // 몸 앞
      expect(-tip.z).toBeLessThan(reach); // 플레이어 몸(4.4+0.4)보다 앞이 아니라 그 앞 바닥
      expect(Math.abs(tip.x)).toBeLessThan(1.15); // 어깨(±1.15)보다 안쪽으로 휩쓴 채 박혔다
      const other = behemothBladeTip(rig, side === 1 ? -1 : 1, new THREE.Vector3());
      expect(other.y).toBeGreaterThan(0.5); // 다른 낫은 대기(들려 있다)
    }
  });

  it('보이는 낫끝 = 판정 낫끝(B1-2) — 타격 진행 0~1 에서 리그 낫끝의 앞 거리(−z)가 tipDist 와 맞고, 끝에선 정면 중심선에 온다', () => {
    // 판정 낫끝은 적 중심에서 정면으로 tipDist 나간 점(중심선 위)이다. 어깨가 옆(x 1.15)에 있어 타격 초반의
    // 낫끝은 중심선 옆에 있으니 앞 거리로 비교하고, 타격 끝(휩쓸기 끝)에서만 중심선 위임을 확인한다
    for (const sp of [0, 0.25, 0.5, 0.75, 1]) {
      const tipDist = pullback + (reach - pullback) * sp;
      const { tip } = measureRig(T.strikeLean, T.strikeLunge, 0, { bladeStriking: true, strikeProgress: sp, tipDist });
      expect(-tip.z, `strike ${sp}`).toBeCloseTo(tipDist, 1);
    }
    const end = measureRig(T.strikeLean, T.strikeLunge, 0, { bladeStriking: true, strikeProgress: 1, tipDist: reach });
    expect(Math.abs(end.tip.x)).toBeLessThan(0.15);
    expect(Math.hypot(end.tip.x, end.tip.z)).toBeCloseTo(reach, 1);
    // 예고 끝 = 타격 시작 — 낫끝이 pullback 거리에 있어 이어진다
    const windup = measureRig(T.windupLean, 0, 0, { bladeWindup: 1, tipDist: pullback });
    expect(-windup.tip.z).toBeCloseTo(pullback, 1);
  });

  it('왼낫(B1-3, bladeSide −1) — 같은 규칙이 왼팔에: 왼 낫끝이 tipDist 와 맞고 끝에선 중심선, 오른낫은 제자리(+x)에 쉰다', () => {
    const altReach = def.attackRange * def.attackAlt!.impactRangeMul;
    const altPull = altReach * balance.parrySpace.pullbackRatio;
    for (const sp of [0, 0.5, 1]) {
      const tipDist = altPull + (altReach - altPull) * sp;
      const left = measureRig(T.strikeLean, T.strikeLunge, 0, { bladeSide: -1, bladeStriking: true, strikeProgress: sp, tipDist });
      expect(-left.tip.z, `left strike ${sp}`).toBeCloseTo(tipDist, 1);
      if (sp === 0) expect(left.tip.x).toBeLessThan(-0.5); // 시작은 왼쪽(−x) 어깨 옆
      if (sp === 1) expect(Math.abs(left.tip.x)).toBeLessThan(0.15); // 끝은 정면 중심선
      const restRight = behemothBladeTip(left.rig, 1, new THREE.Vector3());
      expect(restRight.x).toBeGreaterThan(0.5); // 오른낫은 오른쪽(+x)에 그대로
    }
    // 왼낫 예고 — 왼 어깨가 솟고(위팔 각이 대기보다 크다) 오른 어깨는 대기
    const w = measureRig(T.windupLean, 0, 0, { bladeSide: -1, bladeWindup: 1, tipDist: altPull });
    const rest = measureRig(0, 0, 0, {});
    const armL = w.rig.arms.find((a) => a.side === -1)!;
    const armR = w.rig.arms.find((a) => a.side === 1)!;
    const restL = rest.rig.arms.find((a) => a.side === -1)!;
    expect(armL.shoulder.rotation.x).toBeGreaterThan(restL.shoulder.rotation.x + 0.02);
    expect(Math.abs(armR.shoulder.rotation.x - restL.shoulder.rotation.x)).toBeLessThan(0.05);
    expect(-w.tip.z).toBeCloseTo(altPull, 1);
  });

  it('들이받기 자세(B1-3) — 예고에 머리가 위로 젖혀져(뿔이 하늘을 봄) 눈이 뒤·위로, 타격엔 앞으로(−) 내리꽂혀 눈이 앞·아래로. 낫은 대기 그대로', () => {
    // 머리의 움직임은 머리 메시 위 눈 자리(anchors)로 잰다 — 약점 구체는 판정과 같은 poseOffsets 표를 읽어 메시를 따라가지 않는다
    const rest = measureRig(0, 0, 0, {});
    const eyeRest = behemothAnchorPos(rest.rig, 'eye', new THREE.Vector3());
    const coil = measureRig(T.headbuttLean, 0, 0, { headbuttCoil: 1 });
    expect(coil.rig.headPitch.rotation.x).toBeGreaterThan(0.3); // 얼굴이 위로
    expect(coil.rig.neck.rotation.x).toBeLessThanOrEqual(0); // 목은 들지 않는다(0.9m 마디라 들면 뿔끝이 천장을 친다)
    const eyeCoil = behemothAnchorPos(coil.rig, 'eye', new THREE.Vector3());
    expect(eyeCoil.y).toBeGreaterThan(eyeRest.y + 0.15);
    expect(eyeCoil.z).toBeGreaterThan(eyeRest.z + 0.05); // 뒤로
    const restLeaned = measureRig(T.headbuttLean, 0, 0, {}); // 같은 몸통 기울임의 대기 — 목만 움직였는지 본다
    expect(coil.tip.z).toBeCloseTo(restLeaned.tip.z, 2); // 낫은 안 움직인다
    // 반쯤 진행에서도 이미 크게 젖혀 있다 — "홱" (1 − (1−t)³)
    const half = measureRig(T.headbuttLean * 0.5, 0, 0, { headbuttCoil: 0.5 });
    expect(half.rig.headPitch.rotation.x).toBeGreaterThan(coil.rig.headPitch.rotation.x * 0.8);
    const butt = measureRig(T.headbuttStrikeLean, T.headbuttLunge, 0, { headbutting: true });
    expect(butt.rig.neck.rotation.x).toBeLessThan(-0.4);
    const eyeButt = behemothAnchorPos(butt.rig, 'eye', new THREE.Vector3());
    expect(eyeButt.y).toBeLessThan(eyeRest.y - 0.3);
    expect(eyeButt.z).toBeLessThan(eyeRest.z - 0.2); // 앞으로
    expect(eyeButt.y).toBeGreaterThan(1.0); // 머리가 바닥에 박히지는 않는다
  });

  it('리그 구성(B1-2) — 약점 구체 5개는 group 소속·flashMaterials 밖, 낫·뿔 재질도 밖, 머리 부속(상자·뿔·턱·눈 자리)은 헤드샷 젖힘 노드 아래 한 덩어리', () => {
    const { rig, flash, group } = measureRig(0, 0, 0, {});
    for (const id of ['wp_eye', 'wp_joint_r', 'wp_joint_l', 'wp_heart', 'wp_vent']) {
      const mesh = group.getObjectByName(id) as THREE.Mesh | undefined;
      expect(mesh, id).toBeDefined();
      expect(mesh!.parent).toBe(group);
      expect(flash).not.toContain(mesh!.material as THREE.MeshLambertMaterial);
    }
    for (const m of [...rig.bladeMats, ...rig.hornMats]) expect(flash).not.toContain(m);
    // 헤드샷 젖힘 — headShake 하나를 돌리면 머리 상자·뿔 둘·아래턱·눈 자리가 함께 움직인다 (상자만 돌아 분리돼 보이던 문제)
    expect(rig.head.parent).toBe(rig.headShake);
    expect(rig.jaw.parent).toBe(rig.headShake);
    expect(rig.anchors['eye']!.parent).toBe(rig.headShake);
    const horns = rig.headShake.children.filter((c) => c.children.some((g) => g instanceof THREE.Mesh && g.geometry instanceof THREE.ConeGeometry));
    expect(horns).toHaveLength(2);
    // 자세(headPitch)와 헤드샷(headShake)은 다른 노드 — 서로 덮어쓰지 않는다
    expect(rig.headShake.parent).toBe(rig.headPitch);
  });
  it('잠긴 낫(B2-3) — 그 팔이 축 늘어져 낫끝이 바닥 가까이(0.05~0.45m) 앞·바깥에 끌리고, 예고·타격·튕김보다 우선한다. 다른 낫은 대기 그대로', () => {
    for (const side of [1, -1] as const) {
      const locked = { r: side === 1, l: side === -1 };
      const { rig, tip } = measureRig(0, 0, 0, { bladeSide: side, bladeLocked: locked });
      expect(tip.y, `side ${side} 낫끝 y ${tip.y.toFixed(2)}`).toBeGreaterThanOrEqual(0.05);
      expect(tip.y, `side ${side} 낫끝 y ${tip.y.toFixed(2)}`).toBeLessThanOrEqual(0.45);
      expect(-tip.z).toBeGreaterThan(1.5); // 몸 앞으로 끌린다
      expect(Math.sign(tip.x)).toBe(side); // 바깥으로 벌어진 채
      const other = behemothBladeTip(rig, side === 1 ? -1 : 1, new THREE.Vector3());
      expect(other.y).toBeGreaterThan(0.5); // 다른 낫은 들려 있다
      // 잠긴 낫은 예고(bladeWindup)·타격(bladeStriking)·튕김(recoiled)에도 그대로 늘어져 있다
      for (const pose of [{ bladeWindup: 1, tipDist: pullback }, { bladeStriking: true, strikeProgress: 1, tipDist: reach }, { recoiled: true }] as Partial<BehemothPose>[]) {
        const t2 = measureRig(0, 0, 0, { bladeSide: side, bladeLocked: locked, ...pose }).tip;
        expect(t2.y, `${JSON.stringify(pose)} 낫끝 y ${t2.y.toFixed(2)}`).toBeLessThanOrEqual(0.45);
      }
    }
    // 잠기지 않은 낫은 예전 그대로 — bladeLocked 를 안 주면 대기 높이
    const { tip } = measureRig(0, 0, 0, {});
    expect(tip.y).toBeGreaterThan(0.5);
  });

  it('미끄러짐(B2-3, pose skid) — 몸통이 옆으로 15° 굴러도 네 발은 바닥에 남고(굴림을 되돌려 세운다), 두 낫은 벌어져 매달리고, 눈 구체는 표의 skid 자리(2.2m)', () => {
    const { rig, group } = measureRig(SKID.lean, SKID.lunge, SKID.crouch, { pose: 'skid' }, SKID.roll);
    group.updateMatrixWorld(true);
    for (const hip of rig.legs) {
      const foot = new THREE.Vector3(0, -rig.dims.legH * hip.children[0]!.scale.y, 0);
      let o: THREE.Object3D | null = hip;
      while (o && o !== rig.torso.parent) {
        o.updateMatrix();
        foot.applyMatrix4(o.matrix);
        o = o.parent;
      }
      expect(foot.y, `발 ${foot.y.toFixed(2)}`).toBeGreaterThanOrEqual(-0.02);
      expect(foot.y, `발 ${foot.y.toFixed(2)}`).toBeLessThanOrEqual(0.35);
      expect(Math.abs(hip.rotation.z + SKID.roll)).toBeLessThan(1e-6); // 굴림 되돌림
    }
    // 앞다리는 앞으로, 뒷다리는 뒤로 벌려 버틴다
    expect(rig.legs[0]!.rotation.x).toBeGreaterThan(rig.legs[2]!.rotation.x);
    for (const side of [1, -1] as const) {
      const tip = behemothBladeTip(rig, side, new THREE.Vector3());
      expect(Math.sign(tip.x)).toBe(side); // 바깥으로
      expect(tip.y).toBeGreaterThan(0.2);
    }
    expect(rig.weakPoints['eye']!.position.y).toBeCloseTo(2.2, 6);
    expect(rig.weakPoints['joint_r']!.position.y).toBeCloseTo(2.4, 6);
  });

  it('절뚝(B2-3, limping) — 앞다리 걸음이 뒷다리보다 짧다(절룩), 잠기지 않았으면 대칭', () => {
    const limp = measureRig(0, 0, 0, { limping: true, bladeLocked: { r: true, l: true }, legPhase: Math.PI / 2, legBlend: 1 }).rig;
    const front = Math.abs(limp.legs[0]!.rotation.x);
    const rear = Math.abs(limp.legs[3]!.rotation.x);
    expect(front).toBeLessThan(rear * 0.5);
    const walk = measureRig(0, 0, 0, { legPhase: Math.PI / 2, legBlend: 1 }).rig;
    expect(Math.abs(walk.legs[0]!.rotation.x)).toBeCloseTo(Math.abs(walk.legs[3]!.rotation.x), 6);
  });
});
