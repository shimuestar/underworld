// 낫뿔 거수 리그 — 렌더러 없이 순수 지오메트리로 지어 잰다(B1-2 천장·낫끝 검사는 Boss.test 에서 이쪽으로 옮겼다, B2-2).
// 약점 구체가 판정과 같은 poseOffsets 표를 읽는지(보이는 자리 = 판정 자리), 머리 메시의 눈이 목 IK 로 같은 자리에 오는지,
// 어느 자세에서도 꼭대기가 3.8m 아래·발과 낫끝이 바닥 위인지.

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { balance } from '../core/Balance';
import { comboChain, enemyDef, resolvePhase, weakPointOffset } from '../core/Entities';
import {
  BEHEMOTH_TORSO,
  ENEMY_LEAN_JITTER,
  behemothAnchorPos,
  behemothBladeTip,
  behemothEyeDimmed,
  behemothRearOffset,
  behemothVentLit,
  behemothWeakScaleMul,
  BH_CRACK_GROW,
  BH_VENT_OPEN_SCALE,
  buildBehemothRig,
  poseBehemothRig,
  setBehemothPhaseLook,
  solveNeckToEye,
  stepBehemothRoll,
  styleBehemothWeakPoints,
  type BehemothPose,
} from './Stage';

const def = enemyDef('scythe_behemoth');
const reach = def.attackRange * def.attack.impactRangeMul;
const pullback = reach * balance.parrySpace.pullbackRatio;
/** 삼연낫 ③(B3-4) — 양낫 내려찍기의 판정 사거리(aoe 3.2 = attackRange × impactRangeMul)와 그 pullback */
const COMBO3_REACH = def.attackRange * comboChain(def)[2]!.impactRangeMul;
const COMBO3_PULLBACK = COMBO3_REACH * balance.parrySpace.pullbackRatio;
const T = BEHEMOTH_TORSO;
const J = ENEMY_LEAN_JITTER;

/** 실제 리그를 지어 Stage 와 같은 기울임·전진·낮춤·(굴림·굴림 축 높이)·자세를 넣고 잰다.
 *  rollPivotY 는 syncEnemies(stepBehemothRoll)가 torso.position.x 에 넣는 되밀기 sin(roll)·pivotY 의 정착값 — 미끄러짐은 어깨 높이 */
function measureRig(lean: number, lunge: number, crouch: number, pose: Partial<BehemothPose>, roll = 0, rollPivotY = 0) {
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
  torso.position.x = Math.sin(roll) * rollPivotY;
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
const SKID_PIVOT = def.visual!.joints.pos[1] * def.height; // 미끄러짐 굴림 축 = 어깨 높이(syncEnemies 와 같다)
const SKID = { lean: T.skidLean, lunge: T.skidLunge, crouch: -def.height * T.skidCrouch, roll: T.skidRoll, pivot: SKID_PIVOT };
const ROAR = { lean: T.roarLean, lunge: 0, crouch: 0 };
/** 앞발 들기(B3-1) — 몸통 +35° 를 몸통 가운데 축으로(behemothRearOffset: 축 보정 전진·상승), syncEnemies 와 같은 값 */
const REAR_OFF = behemothRearOffset();
const REAR = { lean: REAR_OFF.lean, lunge: REAR_OFF.lunge, crouch: REAR_OFF.rise };
const SLAM_COIL = { lean: T.slamLean, lunge: 0, crouch: 0 };
const SLAM_LAND = { lean: T.slamLandLean, lunge: 0, crouch: -def.height * T.slamLandCrouch };
/** 발 높이(group 좌표) — 다리 원기둥 밑면 중심 */
function footY(rig: ReturnType<typeof buildBehemothRig>, hip: THREE.Group): number {
  const foot = new THREE.Vector3(0, -rig.dims.legH * (hip.children[0]!.scale.y), 0);
  let o: THREE.Object3D | null = hip;
  while (o && o !== rig.torso.parent) {
    o.updateMatrix();
    foot.applyMatrix4(o.matrix);
    o = o.parent;
  }
  return foot.y;
}

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
      // 눈멂(B2-5) — 표의 눈 1.2m. 머리 휘저음은 sin(nowMs) 라 nowMs 0 에선 정지 — 휘저음의 어긋남 상한은 아래 별도 검사
      { name: 'blind', ...CHARGE, pose: { pose: 'blind', charging: true } },
      // 포효(B2-6 페이즈 전환) — 표의 눈 2.9m(치켜든 머리)
      { name: 'roar', ...ROAR, pose: { pose: 'roar' } },
      { name: 'roar 0.5', lean: T.roarLean * 0.5, crouch: 0, pose: { pose: 'roar', poseBlend: 0.5 } },
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

  it('눈멂(B2-5, pose blind) — 눈먼 채 달리며 머리를 좌우로 휘젓는다: 목 yaw 가 시간에 따라 부호를 바꾸고, 휘저음 봉우리에서도 머리 메시의 눈은 표 구체(1.2m)에서 구체 반지름 남짓(≤ 0.32m) 안, 눈 판정은 닫혀 있으니 표 자리에 구체가 남는다', () => {
    const still = measureRig(CHARGE.lean, 0, CHARGE.crouch, { pose: 'blind', charging: true, nowMs: 0 });
    expect(Math.abs(still.rig.neck.rotation.y)).toBeLessThan(1e-6);
    expect(still.rig.weakPoints['eye']!.position.y).toBeCloseTo(def.poseOffsets!['blind']!['eye']!.y, 6);
    const yaws: number[] = [];
    for (const nowMs of [70 * Math.PI * 0.5, 70 * Math.PI * 1.5, 100, 1234]) {
      const { rig } = measureRig(CHARGE.lean, 0, CHARGE.crouch, { pose: 'blind', charging: true, nowMs });
      yaws.push(rig.neck.rotation.y);
      const anchor = behemothAnchorPos(rig, 'eye', new THREE.Vector3());
      const sphere = rig.weakPoints['eye']!.position;
      expect(anchor.distanceTo(sphere), `blind@${nowMs.toFixed(0)} 어긋남 ${anchor.distanceTo(sphere).toFixed(3)}`).toBeLessThanOrEqual(0.32);
      expect(sphere.y).toBeCloseTo(1.2, 6);
    }
    expect(Math.max(...yaws)).toBeGreaterThan(0.1);
    expect(Math.min(...yaws)).toBeLessThan(-0.1);
    // 다른 표 자세(charge·head_down·stunned)에선 목 yaw 0 — 휘저음은 눈멂만
    for (const c of [{ ...CHARGE, pose: { pose: 'charge', charging: true, nowMs: 100 } }, { ...HEAD_DOWN, pose: { pose: 'head_down', nowMs: 100 } }, { ...STUNNED, pose: { pose: 'stunned', nowMs: 100 } }]) {
      const { rig } = measureRig(c.lean, 0, c.crouch, c.pose);
      expect(Math.abs(rig.neck.rotation.y)).toBeLessThan(1e-6);
    }
  });

  it('미끄러짐(B2-3) — 어깨 축 굴림·전진·젖힘·낮춤을 넣어도 눈은 표 자리(≤ 0.06m), 완벽 회피 보상 표적인 양 어깨 관절 메시–구체 어긋남 ≤ 0.20m(움찔 최악은 구체 반지름 0.30 안), 진행 중간도', () => {
    // 표(±1.15, 2.4, −0.8)가 정본이고 굴림이 오른/왼 어깨를 ±1.15·sin(roll) 갈라 놓으니 0 은 못 만든다 — BEHEMOTH_TORSO 주석의 수치를 여기서 못박는다.
    // skidLunge −0.3 이던 때는 어깨가 z −1.31 로 밀려 0.52m 였다(검토)
    const jointR = def.weakPoints!.find((wp) => wp.id === 'joint_r')!;
    const cases: { name: string; lean: number; lunge: number; crouch: number; roll: number; pose: Partial<BehemothPose>; jointTol: number; eyeTol?: number }[] = [
      { name: 'skid roll+', ...SKID, pose: { pose: 'skid' }, jointTol: 0.2, eyeTol: 0.06 },
      { name: 'skid roll-', ...SKID, roll: -SKID.roll, pose: { pose: 'skid' }, jointTol: 0.2, eyeTol: 0.06 },
      // 진행 중간 — 굴림 축이 아직 어깨까지 오지 않아(stepBehemothRoll 이 축도 같은 비율로 올린다) 눈 x 가 (축 − 눈 높이)·sin 만큼 잠깐 밀린다(≈0.07, 몇 프레임)
      { name: 'skid 0.5', lean: SKID.lean * 0.5, lunge: SKID.lunge * 0.5, crouch: SKID.crouch * 0.5, roll: SKID.roll * 0.5, pose: { pose: 'skid', poseBlend: 0.5 }, jointTol: 0.2, eyeTol: 0.08 },
      { name: 'skid+flinch', ...SKID, lean: SKID.lean + T.flinchLean, pose: { pose: 'skid', nowMs: 100 }, jointTol: jointR.radius },
    ];
    for (const c of cases) {
      // 진행 중간은 굴림 축 되밀기도 stepBehemothRoll 이 같은 비율로 — 정착값의 절반 근처
      const pivot = c.name === 'skid 0.5' ? SKID.pivot * 0.5 : SKID.pivot;
      const { rig } = measureRig(c.lean, c.lunge, c.crouch, c.pose, c.roll, pivot);
      for (const id of ['joint_r', 'joint_l']) {
        const d = behemothAnchorPos(rig, id, new THREE.Vector3()).distanceTo(rig.weakPoints[id]!.position);
        expect(d, `${c.name} ${id} 어긋남 ${d.toFixed(3)}`).toBeLessThanOrEqual(c.jointTol);
      }
      if (c.eyeTol !== undefined) {
        const d = behemothAnchorPos(rig, 'eye', new THREE.Vector3()).distanceTo(rig.weakPoints['eye']!.position);
        expect(d, `${c.name} 눈 어긋남 ${d.toFixed(3)}`).toBeLessThanOrEqual(c.eyeTol);
      }
      // 구체는 표 자리 그대로(굴림·전진에 딸려 가지 않는다)
      const table = weakPointOffset(def, jointR, 'skid');
      if (c.name !== 'skid 0.5') expect(rig.weakPoints['joint_r']!.position.z).toBeCloseTo(table.z, 6);
    }
    // 어깨 관절의 앞뒤(z)는 표에 맞춘다 — 젖힘(+lean)이 어깨를 뒤로 2.5·sin 만큼, 전진(lunge)이 앞으로 그만큼
    const { rig } = measureRig(SKID.lean, SKID.lunge, SKID.crouch, { pose: 'skid' }, SKID.roll, SKID.pivot);
    for (const id of ['joint_r', 'joint_l']) {
      expect(Math.abs(behemothAnchorPos(rig, id, new THREE.Vector3()).z - weakPointOffset(def, jointR, 'skid').z), id).toBeLessThan(0.03);
    }
  });

  it('굴림 보간(stepBehemothRoll, B2-3 검토) — 미끄러짐이 끝나 굴림 축이 어깨→발로 바뀌어도 torso.position.x 는 프레임마다 절반 이상 남기며 단조 감소(한 프레임에 0.35 → 0 으로 튀지 않음), 정착값은 sin(skidRoll)·어깨 높이', () => {
    const settled = Math.sin(T.skidRoll) * SKID_PIVOT; // ≈ 0.35
    const v: { bhRoll?: number; bhRollPivot?: number } = {};
    // 서는 동안 — 단조 증가, 넘지 않고 정착
    let prev = 0;
    for (let i = 0; i < 90; i++) {
      const x = stepBehemothRoll(v, T.skidRoll, SKID_PIVOT);
      expect(x).toBeGreaterThanOrEqual(prev - 1e-9);
      expect(x).toBeLessThanOrEqual(settled + 1e-9);
      prev = x;
    }
    expect(prev).toBeCloseTo(settled, 3);
    expect(v.bhRoll).toBeCloseTo(T.skidRoll, 6);
    expect(v.bhRollPivot).toBeCloseTo(SKID_PIVOT, 3);
    // 끝난 뒤 — 각과 축이 같은 계수로 풀려 x ∝ (1−k)^2n: 프레임마다 절반 이상 남고(옛 방식은 첫 프레임에 0), 20 프레임 안에 0.01 아래
    let frames = 0;
    for (let i = 0; i < 60; i++) {
      const x = stepBehemothRoll(v, 0, 0);
      expect(x, `종료 후 ${i}번째 프레임 ${x.toFixed(3)} (이전 ${prev.toFixed(3)})`).toBeGreaterThanOrEqual(prev * 0.5 - 1e-9);
      expect(x).toBeLessThanOrEqual(prev + 1e-9);
      prev = x;
      if (prev >= 0.01) frames++;
    }
    expect(frames).toBeGreaterThanOrEqual(3);
    expect(frames).toBeLessThan(20);
    expect(prev).toBeLessThan(1e-3);
    // 대조 — 축만 즉시 0 으로 떨어뜨리면(옛 syncEnemies) 첫 프레임에 0.35 → 0
    const oldRoll = T.skidRoll + (0 - T.skidRoll) * 0.25;
    expect(Math.abs(Math.sin(oldRoll) * 0 - settled)).toBeGreaterThan(0.3);
    // 빙결(k 0) — 굳는다. 절뚝(축 0, 각은 걸음 사인)은 x 0
    const frozen = { bhRoll: 0.1, bhRollPivot: 1 };
    expect(stepBehemothRoll(frozen, 0, 0, 0)).toBeCloseTo(Math.sin(0.1), 9);
    const limp = { bhRoll: 0, bhRollPivot: 0 };
    for (let i = 0; i < 10; i++) expect(stepBehemothRoll(limp, Math.sin(i / 3) * T.limpRoll, 0)).toBe(0);
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

  it('쿨다운 dim 판정(B2-5 검토) — 혼절 쿨다운 중 머리 내림·회복의 눈은 어둡게, 돌격 질주(charging + charge) 중 6m 눈은 쿨다운이어도 밝게(눈멂 누적이 유효 — 판정과 같은 그림), 포효 예고(pose roar + windup, B3-4 검토)의 치켜든 눈도 쿨다운이어도 밝게(66 → 역류가 유효 — 전환 molting·발동 뒤는 어둡게), 쿨다운 0 이면 어디서도 어둡지 않다', () => {
    expect(behemothEyeDimmed({ dazeCooldown: 600, ai: 'recover', attackMode: 'charge' })).toBe(true);
    expect(behemothEyeDimmed({ dazeCooldown: 1, ai: 'chase' })).toBe(true);
    expect(behemothEyeDimmed({ dazeCooldown: 600, ai: 'charging', attackMode: 'charge' })).toBe(false);
    expect(behemothEyeDimmed({ dazeCooldown: 600, ai: 'windup', attackMode: 'charge' })).toBe(true); // 예고 중엔 눈이 안 열리지만 규칙은 질주만 예외
    expect(behemothEyeDimmed({ dazeCooldown: 0, ai: 'recover' })).toBe(false);
    expect(behemothEyeDimmed({ ai: 'charging', attackMode: 'charge' })).toBe(false);
    // 역류(B3-1) 머리 내림 — 쿨다운 0 이라도 어둡게(피해만, 혼절 누적 없음). 낫 박힘·전도 머리 내림은 밝게
    expect(behemothEyeDimmed({ dazeCooldown: 0, ai: 'recover', pose: 'head_down', poseCause: 'backflow' })).toBe(true);
    expect(behemothEyeDimmed({ dazeCooldown: 0, ai: 'recover', pose: 'head_down' })).toBe(false);
    expect(behemothEyeDimmed({ dazeCooldown: 0, ai: 'recover', pose: 'head_down', poseCause: 'topple' })).toBe(false);
    // 포효 예고(B3-4 검토) — 치켜든 눈의 66 → 역류는 혼절 쿨다운과 무관(Enemies roarEye)이라 쿨다운이어도 밝게(판정 = 그림). 전환(molting)의 roar 자세와 포효가 끝난 뒤(recover)는 어둡게
    expect(behemothEyeDimmed({ dazeCooldown: 600, ai: 'windup', attackMode: 'roar', pose: 'roar' })).toBe(false);
    expect(behemothEyeDimmed({ dazeCooldown: 1, ai: 'windup', attackMode: 'roar', pose: 'roar', molting: false })).toBe(false);
    expect(behemothEyeDimmed({ dazeCooldown: 600, ai: 'windup', attackMode: 'roar', pose: 'roar', molting: true })).toBe(true);
    expect(behemothEyeDimmed({ dazeCooldown: 600, ai: 'recover', attackMode: 'melee', pose: 'roar', molting: true })).toBe(true);
    expect(behemothEyeDimmed({ dazeCooldown: 600, ai: 'recover', attackMode: 'roar' })).toBe(true);
    expect(behemothEyeDimmed({ dazeCooldown: 0, ai: 'windup', attackMode: 'roar', pose: 'roar' })).toBe(false);
  });
});

describe('리그 천장·바닥·낫끝 검사 (B1-2 → B2-2 이동)', () => {
  const CEIL = 3.8; // 기획서 §2 낫 상한 (천장 4m)
  const FLOOR = -0.08; // 기운 원기둥 발의 테두리(r 0.22)가 살짝 잠기는 만큼만 허용 — 배치 1 메모 (c) 돌격 −0.46m 는 안 된다
  // 떨림은 sin(nowMs/12)·sin(nowMs/11) 진폭 — 봉우리 근처를 몇 점 찍는다
  const peaks = [0, 12 * Math.PI * 0.5, 11 * Math.PI * 0.5, 100, 1234];
  const cases: { name: string; lean: number; lunge: number; crouch: number; pose: Partial<BehemothPose>; roll?: number; pivot?: number; liftedFront?: boolean }[] = [
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
    // B2-5 눈멂 질주 — 내린 머리를 좌우로 휘젓는 봉우리(sin(nowMs/70)) + 움찔
    ...peaks.map((nowMs) => ({ name: `blind@${nowMs.toFixed(0)}`, lean: T.chargeLean + T.flinchLean, lunge: 0, crouch: CHARGE.crouch, pose: { pose: 'blind', charging: true, nowMs } })),
    { name: 'blind thrash peak', lean: T.chargeLean, lunge: 0, crouch: CHARGE.crouch, pose: { pose: 'blind', charging: true, nowMs: 70 * Math.PI * 0.5 } },
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
    // B2-3 미끄러짐(어깨 축 옆 8° 굴림 + 앞으로 미끄러지며 살짝 뒤로 젖힘, 두 낫 매달림, 다리 벌려 버팀) — 굴림 양쪽·움찔·진행 중간
    ...peaks.map((nowMs) => ({ name: `skid@${nowMs.toFixed(0)}`, lean: SKID.lean + T.flinchLean, lunge: SKID.lunge, crouch: SKID.crouch, roll: SKID.roll, pivot: SKID.pivot, pose: { pose: 'skid', nowMs } })),
    { name: 'skid roll-', ...SKID, roll: -SKID.roll, pose: { pose: 'skid' } },
    { name: 'skid 0.5', lean: SKID.lean * 0.5, lunge: SKID.lunge * 0.5, crouch: SKID.crouch * 0.5, roll: SKID.roll * 0.5, pivot: SKID.pivot * 0.5, pose: { pose: 'skid', poseBlend: 0.5 } },
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
    // B2-6 포효(페이즈 전환 갑각 재생) — 머리 치켜듦(표의 눈 2.9m)·입 벌림·두 낫 벌려 들기(떨림 봉우리)·움찔·진행 중간·잠긴 낫 채로
    ...peaks.map((nowMs) => ({ name: `roar@${nowMs.toFixed(0)}`, lean: T.roarLean + T.flinchLean, lunge: 0, crouch: 0, pose: { pose: 'roar', nowMs } })),
    { name: 'roar 0.5', lean: T.roarLean * 0.5, lunge: 0, crouch: 0, pose: { pose: 'roar', poseBlend: 0.5 } },
    { name: 'roar locked r', ...ROAR, pose: { pose: 'roar', bladeLocked: { r: true, l: false } } },
    // B3-1 앞발 들기(rear — 몸통 +35°, 앞다리 들림·낫 앞아래·머리 치켜듦) — 떨림 봉우리·움찔·진행 중간·잠긴 낫 채로. 앞발은 공중(liftedFront)
    ...peaks.map((nowMs) => ({ name: `rear+tremble+flinch@${nowMs.toFixed(0)}`, ...REAR, lean: REAR.lean + J.tremble + T.flinchLean, pose: { pose: 'rear', trembling: true, nowMs }, liftedFront: true })),
    { name: 'rear', ...REAR, pose: { pose: 'rear' }, liftedFront: true },
    { name: 'rear 0.5', lean: REAR.lean * 0.5, lunge: REAR.lunge * 0.5, crouch: REAR.crouch * 0.5, pose: { pose: 'rear', poseBlend: 0.5 }, liftedFront: true },
    { name: 'rear locked r', ...REAR, pose: { pose: 'rear', bladeLocked: { r: true, l: false } }, liftedFront: true },
    // B3-1 발구르기 예고(앞발 들기 밖·기상 발구르기 — 앞발 낮게) / 착지(내리찍음)
    ...peaks.map((nowMs) => ({ name: `slam coil+tremble+flinch@${nowMs.toFixed(0)}`, ...SLAM_COIL, lean: SLAM_COIL.lean + J.tremble + T.flinchLean, pose: { slamCoil: 1, trembling: true, nowMs } })),
    { name: 'slam coil 0.5', lean: T.slamLean * 0.5, lunge: 0, crouch: 0, pose: { slamCoil: 0.5 } },
    { name: 'slam land', ...SLAM_LAND, pose: { slamming: true } },
    { name: 'slam land+flinch', ...SLAM_LAND, lean: SLAM_LAND.lean + T.flinchLean, pose: { slamming: true } },
    // B3-1 역류 머리 내림(cause backflow) — 두 낫이 벌어져 매달린 고꾸라짐(박힌 낫 아님)
    { name: 'head_down backflow', ...HEAD_DOWN, pose: { pose: 'head_down', poseCause: 'backflow' } },
    { name: 'head_down backflow+flinch', ...HEAD_DOWN, lean: HEAD_DOWN.lean + T.flinchLean, pose: { pose: 'head_down', poseCause: 'backflow', nowMs: 100 } },
    // B3-4 탈진(exhaust — 양낫 박힘, 몸통은 머리 내림 값) / 삼연낫 ③ 예고(두 낫 머리 위 — 떨림·움찔 최악)·타격(두 낫 내려찍기) / 광란 돌격 선회(꼬리 휘두름 봉우리) / 포효 예고는 위 roar
    { name: 'exhaust', ...HEAD_DOWN, pose: { pose: 'exhaust' } },
    { name: 'exhaust+flinch', ...HEAD_DOWN, lean: HEAD_DOWN.lean + T.flinchLean, pose: { pose: 'exhaust', nowMs: 100 } },
    ...peaks.map((nowMs) => ({
      name: `combo3 windup+tremble+flinch@${nowMs.toFixed(0)}`,
      lean: T.windupLean + J.tremble + T.flinchLean, lunge: 0, crouch: 0,
      pose: { bothBlades: true, bladeWindup: 1, tipDist: COMBO3_PULLBACK, trembling: true, nowMs },
    })),
    ...[0, 0.5, 1].map((sp) => ({
      name: `combo3 strike ${sp}`,
      lean: sp === 0 ? T.windupLean + J.tremble : T.strikeLean, lunge: T.strikeLunge, crouch: 0,
      pose: { bothBlades: true, bladeStriking: true, strikeProgress: sp, tipDist: COMBO3_PULLBACK + (COMBO3_REACH - COMBO3_PULLBACK) * sp },
    })),
    ...peaks.map((nowMs) => ({ name: `chain turn@${nowMs.toFixed(0)}`, lean: T.chargeLean + T.flinchLean, lunge: 0, crouch: CHARGE.crouch, pose: { pose: 'charge', chargeCoil: 1, chainTurn: true, nowMs } })),
  ];

  it('어깨→위팔→낫을 실제로 지어 모든 자세(떨림·움찔·튕김 흔들림을 더한 최악)에서 꼭대기가 3.8m 아래', () => {
    for (const c of cases) {
      const { box } = measureRig(c.lean, c.lunge, c.crouch, c.pose, c.roll ?? 0, c.pivot ?? 0);
      expect(box.max.y, `${c.name} 꼭대기 ${box.max.y.toFixed(2)}m`).toBeLessThanOrEqual(CEIL);
    }
  });

  it('바닥(B2-2, 배치 1 메모 c) — 모든 자세에서 발·낫끝이 바닥을 뚫지 않는다: 기울임·낮춤만큼 다리를 늘이고 접어 발이 바닥에 남는다(앞발 들기의 든 앞발만 예외)', () => {
    for (const c of cases) {
      const { box, rig } = measureRig(c.lean, c.lunge, c.crouch, c.pose, c.roll ?? 0, c.pivot ?? 0);
      expect(box.min.y, `${c.name} 바닥 ${box.min.y.toFixed(2)}m`).toBeGreaterThanOrEqual(FLOOR);
      // 발끝(다리 원기둥 밑면 중심)이 바닥 근처 — 앞발 들기(rear)의 앞다리(0·1)는 공중이라 위 한계를 재지 않는다(별도 검사)
      rig.legs.forEach((hip, i) => {
        const y = footY(rig, hip);
        expect(y, `${c.name} 발 ${y.toFixed(2)}`).toBeGreaterThanOrEqual(-0.02);
        if (!(c.liftedFront && i < 2)) expect(y, `${c.name} 발 ${y.toFixed(2)}`).toBeLessThanOrEqual(0.35); // 걸음·긁기의 들림 이상으로 뜨지 않는다
      });
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

  it('미끄러짐(B2-3, pose skid) — 몸통이 어깨 축으로 옆 8° 굴러도 네 발은 바닥에 남고(굴림을 되돌려 세운다), 두 낫은 벌어져 매달리고, 눈 구체는 표의 skid 자리(2.2m)', () => {
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

  it('앞발 들기(B3-1, pose rear) — 몸통 +35°(축 보정 앞·위)에 배 심장 메시 자리 = 표 구체 (0, 1.15, −1.0)(≤ 0.03m), 눈도 표(3.0m, ≤ 0.06), 관절 ≤ 0.2; 앞발은 공중(≥ 0.5m) 뒷발은 바닥, 두 낫은 앞아래(끝 0.5~1.5m), 꼬리·몸 어디도 바닥 아래 없음, 꼭대기 3.8 아래. 진행 중간도 심장이 따라간다', () => {
    const heartWp = def.weakPoints!.find((wp) => wp.id === 'heart')!;
    const table = weakPointOffset(def, heartWp, 'rear');
    expect(table).toEqual({ x: 0, y: 1.15, z: -1.0 });
    // 축 보정 — 표의 심장이 normal (0.6, −0.4) 에서 35° 돌아 나온 자리(수직이등분선 위의 축): 앞으로 ≈1.02·위로 ≈0.43
    expect(REAR_OFF.lean).toBeCloseTo((35 * Math.PI) / 180, 2);
    expect(REAR_OFF.lunge).toBeLessThan(-0.9);
    expect(REAR_OFF.rise).toBeGreaterThan(0.35);
    const full = measureRig(REAR.lean, REAR.lunge, REAR.crouch, { pose: 'rear' });
    const heartA = behemothAnchorPos(full.rig, 'heart', new THREE.Vector3());
    const heartS = full.rig.weakPoints['heart']!.position;
    expect([heartS.x, heartS.y, heartS.z]).toEqual([table.x, table.y, table.z]);
    expect(heartA.distanceTo(heartS), `심장 어긋남 ${heartA.distanceTo(heartS).toFixed(3)}`).toBeLessThanOrEqual(0.03);
    expect(behemothAnchorPos(full.rig, 'eye', new THREE.Vector3()).distanceTo(full.rig.weakPoints['eye']!.position)).toBeLessThanOrEqual(0.06);
    expect(full.rig.weakPoints['eye']!.position.y).toBeCloseTo(3.0, 6);
    for (const id of ['joint_r', 'joint_l']) {
      expect(behemothAnchorPos(full.rig, id, new THREE.Vector3()).distanceTo(full.rig.weakPoints[id]!.position), id).toBeLessThanOrEqual(0.2);
    }
    // 앞발 공중·뒷발 바닥
    expect(footY(full.rig, full.rig.legs[0]!)).toBeGreaterThan(0.5);
    expect(footY(full.rig, full.rig.legs[1]!)).toBeGreaterThan(0.5);
    expect(Math.abs(footY(full.rig, full.rig.legs[2]!))).toBeLessThan(0.03);
    expect(Math.abs(footY(full.rig, full.rig.legs[3]!))).toBeLessThan(0.03);
    // 두 낫 — 앞아래, 좌우 대칭
    for (const side of [1, -1] as const) {
      const tip = behemothBladeTip(full.rig, side, new THREE.Vector3());
      expect(tip.y, `side ${side} 낫끝 ${tip.y.toFixed(2)}`).toBeGreaterThan(0.5);
      expect(tip.y).toBeLessThan(1.5);
      expect(-tip.z).toBeGreaterThan(2.0);
    }
    expect(full.box.min.y).toBeGreaterThanOrEqual(-0.02); // 꼬리도 되들었다
    expect(full.box.max.y).toBeLessThanOrEqual(3.8);
    // 진행 중간 — 심장 구체와 배 메시가 함께 간다
    const half = measureRig(REAR.lean * 0.5, REAR.lunge * 0.5, REAR.crouch * 0.5, { pose: 'rear', poseBlend: 0.5 });
    const hA = behemothAnchorPos(half.rig, 'heart', new THREE.Vector3());
    expect(hA.distanceTo(half.rig.weakPoints['heart']!.position)).toBeLessThanOrEqual(0.08);
    // 앞발 들기 밖의 발구르기 예고(기상 발구르기) — 앞발이 낮게(≤ 0.35) 들리고 심장은 배 밑 normal 자리 그대로(안 보인다)
    const coil = measureRig(SLAM_COIL.lean, 0, 0, { slamCoil: 1 });
    expect(footY(coil.rig, coil.rig.legs[0]!)).toBeGreaterThan(0.08);
    expect(footY(coil.rig, coil.rig.legs[0]!)).toBeLessThanOrEqual(0.35);
    expect(Math.abs(footY(coil.rig, coil.rig.legs[2]!))).toBeLessThan(0.03);
    expect(coil.rig.weakPoints['heart']!.position.y).toBeCloseTo(0.6, 6);
    // 착지 — 앞발이 다시 바닥
    const land = measureRig(SLAM_LAND.lean, 0, SLAM_LAND.crouch, { slamming: true, slamCoil: 1 });
    expect(Math.abs(footY(land.rig, land.rig.legs[0]!))).toBeLessThan(0.03);
  });

  it('역류 머리 내림(B3-1, head_down cause backflow) — 낫이 박히지 않는다: 두 낫이 벌어져 매달리고(끝이 바닥 위 0.2m 이상, 바깥), 눈은 표(0.9m). 봉인(sealed) 심장은 어두운 본색·발광 없음·맥동 없음', () => {
    const bf = measureRig(HEAD_DOWN.lean, 0, HEAD_DOWN.crouch, { pose: 'head_down', poseCause: 'backflow' });
    for (const side of [1, -1] as const) {
      const tip = behemothBladeTip(bf.rig, side, new THREE.Vector3());
      expect(tip.y, `side ${side} 낫끝 ${tip.y.toFixed(2)}`).toBeGreaterThan(0.2);
      expect(Math.sign(tip.x)).toBe(side);
    }
    const stuck = measureRig(HEAD_DOWN.lean, 0, HEAD_DOWN.crouch, { pose: 'head_down' });
    expect(behemothBladeTip(stuck.rig, 1, new THREE.Vector3()).y).toBeLessThanOrEqual(0.25); // 대조 — 낫 박힘은 그대로 바닥에 꽂힌다
    expect(bf.rig.weakPoints['eye']!.position.y).toBeCloseTo(0.9, 6);
    expect(behemothAnchorPos(bf.rig, 'eye', new THREE.Vector3()).distanceTo(bf.rig.weakPoints['eye']!.position)).toBeLessThanOrEqual(0.06);
    // 봉인 표시
    const { rig } = measureRig(0, 0, 0, {});
    const mat = rig.weakPoints['heart']!.material as THREE.MeshLambertMaterial;
    styleBehemothWeakPoints(rig, 640 / 4, (id) => ({ open: id === 'heart', broken: false, flashAgeMs: -1, sealed: id === 'heart' }));
    expect(mat.emissive.getHex()).toBe(0);
    expect(rig.weakPoints['heart']!.scale.x).toBe(1);
    const sealedColor = mat.color.getHex();
    styleBehemothWeakPoints(rig, 640 / 4, () => ({ open: false, broken: false, flashAgeMs: -1 }));
    expect(sealedColor).not.toBe(mat.color.getHex()); // 닫힘 본색(0x7a1f3a)보다 어둡다
    expect(sealedColor).toBeLessThan(mat.color.getHex());
    styleBehemothWeakPoints(rig, 640 / 4, (id) => ({ open: id === 'heart', broken: false, flashAgeMs: -1 }));
    expect(mat.emissive.getHex()).toBe(0xff2e63); // 열림이면 진홍 맥동
    expect(rig.weakPoints['heart']!.scale.x).toBeCloseTo(1.12, 3);
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

describe('페이즈 외형(B2-6) — 포효 자세·등갑판 균열·분출공 점등·탈락·붉은 홍채', () => {
  it('포효(pose roar) — 아래턱이 −0.8rad 벌어지고(진행에 비례), 두 낫이 바깥으로 벌어져 들리며(양쪽 대칭), 눈은 표의 2.9m. 다른 자세에선 턱이 닫힌다', () => {
    const rest = measureRig(0, 0, 0, {});
    expect(rest.rig.jaw.rotation.x).toBeCloseTo(0, 6);
    const roar = measureRig(ROAR.lean, 0, 0, { pose: 'roar' });
    expect(roar.rig.jaw.rotation.x).toBeCloseTo(-0.8, 6);
    expect(roar.rig.weakPoints['eye']!.position.y).toBeCloseTo(2.9, 6);
    const half = measureRig(ROAR.lean * 0.5, 0, 0, { pose: 'roar', poseBlend: 0.5 });
    expect(half.rig.jaw.rotation.x).toBeCloseTo(-0.4, 6);
    // 두 낫 — 대기보다 위팔이 들리고 바깥(yaw 부호가 side 와 반대)으로 벌어진다, 좌우 대칭
    const [r, l] = roar.rig.arms;
    const [r0] = rest.rig.arms;
    expect(r!.shoulder.rotation.x).toBeGreaterThan(r0!.shoulder.rotation.x + 0.05);
    expect(l!.shoulder.rotation.x).toBeCloseTo(r!.shoulder.rotation.x, 6);
    expect(r!.shoulder.rotation.y).toBeLessThan(-0.3); // 오른팔(side +1): yaw = +1 × (−0.5)
    expect(l!.shoulder.rotation.y).toBeCloseTo(-r!.shoulder.rotation.y, 6);
    // 머리가 위로 — 대기보다 머리 메시 눈 자리가 높다. 얼굴은 천장을 본다(faceUp 가지): 눈이 머리 중심보다 위 — 접는 가지였으면 머리·뿔이 눈 위에 쌓여 3.9m 를 넘었다
    const eyeRest = behemothAnchorPos(rest.rig, 'eye', new THREE.Vector3());
    const eyeRoar = behemothAnchorPos(roar.rig, 'eye', new THREE.Vector3());
    expect(eyeRoar.y).toBeGreaterThan(eyeRest.y + 0.4);
    const headCenter = new THREE.Vector3();
    let o: THREE.Object3D | null = roar.rig.head;
    while (o && o !== roar.torso.parent) {
      o.updateMatrix();
      headCenter.applyMatrix4(o.matrix);
      o = o.parent;
    }
    expect(eyeRoar.y).toBeGreaterThan(headCenter.y + 0.3);
    expect(roar.box.max.y).toBeLessThanOrEqual(3.8);
  });

  it('리그 구성 — 등갑판 3장(plate0~2)·균열 5개(이음새 2 + 실금 3, 자체 발광 재질 하나, flashMaterials 밖, 처음엔 숨김)·홍채(눈 구체의 자식, 숨김)', () => {
    const { rig, flash } = measureRig(0, 0, 0, {});
    expect(rig.plates.map((p) => p.name)).toEqual(['plate0', 'plate1', 'plate2']);
    const n = def.visual!.plates.z.length;
    expect(rig.cracks).toHaveLength(n - 1 + n);
    for (const c of rig.cracks) {
      expect(c.visible).toBe(false);
      expect(c.material).toBe(rig.crackMat);
    }
    expect(flash).not.toContain(rig.crackMat as unknown as THREE.MeshLambertMaterial);
    expect(rig.iris.visible).toBe(false);
    expect(rig.iris.parent).toBe(rig.weakPoints['eye']);
    // 이음새 띠는 뒤 판(plate1·plate2)의 자식으로 그 판의 들린 앞전 위(로컬 +y 윗면, −z 앞쪽)에 — 두 판 사이 중간 높이는 겹친 판 두께 안에 묻힌다
    const seams = rig.cracks.slice(0, n - 1);
    expect(seams.map((c) => c.parent)).toEqual([rig.plates[1], rig.plates[2]]);
    const [, ph, pd] = def.visual!.plates.size;
    for (const seam of seams) {
      expect(seam.position.y).toBeGreaterThan((ph * def.height) / 2);
      expect(seam.position.z).toBeLessThan(0);
      expect(seam.position.z).toBeGreaterThan(-(pd * def.radius) / 2);
    }
    // 실금은 판 위 — torso 소속, 판 높이 위
    for (const hair of rig.cracks.slice(n - 1)) {
      expect(hair.parent).toBe(rig.torso);
      expect(hair.position.y).toBeGreaterThan(def.visual!.plates.y * def.height);
    }
    // 판을 숨기면(P3) 자식 이음새도 함께 안 그려진다 — three.js visible 은 하위까지 건너뛴다
    rig.plates[1]!.visible = false;
    expect(seams[0]!.parent!.visible).toBe(false);
  });

  it('setBehemothPhaseLook — P1(표 3)·표 없음: 전부 꺼짐 / P2(표 2, shellPlatesOn): 균열 켜짐·판 보임·홍채 없음·분출공 점등 / P3(표 1, shedPlates): 판·균열 숨김·홍채 켜짐·분출공 점등 유지(누적)', () => {
    const { rig } = measureRig(0, 0, 0, {});
    const on = (arr: THREE.Mesh[]): boolean[] => arr.map((m) => m.visible);
    setBehemothPhaseLook(rig, resolvePhase(def, 3), 0);
    expect(on(rig.plates)).toEqual([true, true, true]);
    expect(on(rig.cracks).every((v) => !v)).toBe(true);
    expect(rig.iris.visible).toBe(false);
    expect(behemothVentLit(resolvePhase(def, 3))).toBe(false);
    setBehemothPhaseLook(rig, undefined, 0);
    expect(on(rig.cracks).every((v) => !v)).toBe(true);
    expect(behemothVentLit(undefined)).toBe(false);
    setBehemothPhaseLook(rig, resolvePhase(def, 2), 0);
    expect(on(rig.plates)).toEqual([true, true, true]);
    expect(on(rig.cracks).every((v) => v)).toBe(true);
    expect(rig.iris.visible).toBe(false);
    expect(behemothVentLit(resolvePhase(def, 2))).toBe(true);
    // 균열 색 — 오염 녹색(0x39ff88) 계열이 숨쉰다(0.7~1.0 배), 텔레그래프 3색이 아니다
    const c = rig.crackMat.color;
    expect(c.g).toBeGreaterThan(c.r);
    expect(c.g).toBeGreaterThan(c.b);
    setBehemothPhaseLook(rig, resolvePhase(def, 2), 1400 * 0.25);
    expect(rig.crackMat.color.g).toBeCloseTo(1.0, 3); // 봉우리
    setBehemothPhaseLook(rig, resolvePhase(def, 2), 1400 * 0.75);
    expect(rig.crackMat.color.g).toBeCloseTo(0.7, 3); // 골
    setBehemothPhaseLook(rig, resolvePhase(def, 1), 0);
    expect(on(rig.plates)).toEqual([false, false, false]);
    expect(on(rig.cracks).every((v) => !v)).toBe(true);
    expect(rig.iris.visible).toBe(true);
    expect(behemothVentLit(resolvePhase(def, 1))).toBe(true);
    // 되돌리면(디버그·부활 재스폰) 판이 다시 보인다
    setBehemothPhaseLook(rig, resolvePhase(def, 3), 0);
    expect(on(rig.plates)).toEqual([true, true, true]);
    expect(rig.iris.visible).toBe(false);
  });

  it('점등(lit) 표시 — 닫힌 분출공이 제 열림색으로 은은하게 빛나되 맥동은 없다(크기 1, 세기 < 열림). 열림이 오면 열림이 이긴다', () => {
    const { rig } = measureRig(0, 0, 0, {});
    const vent = rig.weakPoints['vent']!;
    const mat = vent.material as THREE.MeshLambertMaterial;
    styleBehemothWeakPoints(rig, 640 / 4, (id) => ({ open: false, broken: false, flashAgeMs: -1, lit: id === 'vent' }));
    expect(mat.emissive.getHex()).toBe(0x39ff88);
    expect(mat.color.getHex()).toBe(0x1f3a2e);
    expect(vent.scale.x).toBeCloseTo(1, 6);
    const litIntensity = mat.emissiveIntensity;
    expect(litIntensity).toBeGreaterThan(0);
    styleBehemothWeakPoints(rig, 640 / 4, (id) => ({ open: id === 'vent', broken: false, flashAgeMs: -1, lit: id === 'vent' }));
    expect(mat.emissiveIntensity).toBeGreaterThan(litIntensity);
    expect(vent.scale.x).toBeGreaterThan(1.05); // 맥동 봉우리
    // 다른 약점은 점등이 없다(닫힘 = 발광 없음)
    const heart = rig.weakPoints['heart']!.material as THREE.MeshLambertMaterial;
    expect(heart.emissive.getHex()).toBe(0x000000);
  });
});

describe('갑각판 파괴 외형(B3-3)', () => {
  it('setBehemothPhaseLook(platesLeft) — P2 에서 부서진 장수만큼 앞 판(plate0 부터)이 사라지고, 그 자리 실금은 몸 윗면으로 내려와 BH_CRACK_GROW 배로 벌어진다(수평). 남은 판의 실금·이음새는 그대로. platesLeft 없음 = 전부, P3(shed)면 남은 장수와 무관하게 전부 숨김', () => {
    const { rig } = measureRig(0, 0, 0, {});
    const on = (arr: THREE.Mesh[]): boolean[] => arr.map((m) => m.visible);
    const n = def.visual!.plates.z.length;
    const hairs = rig.cracks.slice(n - 1);
    const H = def.height;
    const ph = def.visual!.plates.size[1] * H;
    const restY = def.visual!.plates.y * H + ph * 0.5;
    const bodyTop = (def.visual!.body.pos[1] + def.visual!.body.size[1] / 2) * H;
    const tilt = (def.visual!.plates.tiltDeg * Math.PI) / 180;
    const p2 = resolvePhase(def, 2);
    setBehemothPhaseLook(rig, p2, 0, 2);
    expect(on(rig.plates)).toEqual([false, true, true]);
    expect(on(rig.cracks).every((v) => v)).toBe(true);
    expect(hairs[0]!.scale.x).toBe(BH_CRACK_GROW);
    expect(hairs[0]!.position.y).toBeLessThan(restY);
    expect(hairs[0]!.position.y).toBeGreaterThan(bodyTop);
    expect(hairs[0]!.position.y).toBeLessThan(bodyTop + ph * 0.1);
    expect(hairs[0]!.rotation.x).toBe(0);
    for (const h of hairs.slice(1)) {
      expect(h.scale.x).toBe(1);
      expect(h.position.y).toBeCloseTo(restY, 6);
      expect(h.rotation.x).toBeCloseTo(tilt, 6);
    }
    setBehemothPhaseLook(rig, p2, 0, 0);
    expect(on(rig.plates)).toEqual([false, false, false]);
    expect(hairs.every((h) => h.scale.x === BH_CRACK_GROW)).toBe(true);
    // 되돌림 — platesLeft 없음(P1·디버그 기본)은 전부 제자리
    setBehemothPhaseLook(rig, p2, 0);
    expect(on(rig.plates)).toEqual([true, true, true]);
    expect(hairs.every((h) => h.scale.x === 1 && Math.abs(h.position.y - restY) < 1e-6)).toBe(true);
    setBehemothPhaseLook(rig, p2, 0, 3);
    expect(on(rig.plates)).toEqual([true, true, true]);
    // P3 — 탈락: 남은 장수(2)와 무관하게 전부 숨김·균열 꺼짐
    setBehemothPhaseLook(rig, resolvePhase(def, 1), 0, 2);
    expect(on(rig.plates)).toEqual([false, false, false]);
    expect(on(rig.cracks).every((v) => !v)).toBe(true);
    // 범위 밖 값은 잠근다
    setBehemothPhaseLook(rig, p2, 0, 7);
    expect(on(rig.plates)).toEqual([true, true, true]);
    setBehemothPhaseLook(rig, p2, 0, -1);
    expect(on(rig.plates)).toEqual([false, false, false]);
  });

  it('분출공 크기 = 판정 크기 — behemothWeakScaleMul(vent, open, ventScale): 닫힘·점등·봉인·파열 어느 가지든 ventScale 배(판 밑 균열이 벌어진 채), 열리면 그 위에 ×1.4. 다른 약점은 1', () => {
    expect(behemothWeakScaleMul('vent', false, 1.15)).toBeCloseTo(1.15, 6);
    expect(behemothWeakScaleMul('vent', true, 1.15)).toBeCloseTo(1.15 * BH_VENT_OPEN_SCALE, 6);
    expect(behemothWeakScaleMul('eye', true, 1.15)).toBe(1);
    expect(behemothWeakScaleMul('vent', false)).toBe(1); // 기본 — 옛 호출 그대로
    const { rig } = measureRig(0, 0, 0, {});
    const vent = rig.weakPoints['vent']!;
    const vs = 1.15 ** 3;
    styleBehemothWeakPoints(rig, 0, (id) => ({ open: false, broken: false, flashAgeMs: -1, lit: id === 'vent', scaleMul: behemothWeakScaleMul(id, false, vs) }));
    expect(vent.scale.x).toBeCloseTo(vs, 6); // 점등(P2 닫힘)
    expect(rig.weakPoints['eye']!.scale.x).toBe(1);
    styleBehemothWeakPoints(rig, 0, (id) => ({ open: false, broken: false, flashAgeMs: -1, scaleMul: behemothWeakScaleMul(id, false, vs) }));
    expect(vent.scale.x).toBeCloseTo(vs, 6); // 닫힘(P1 색)
    styleBehemothWeakPoints(rig, 0, (id) => ({ open: false, broken: false, flashAgeMs: -1, sealed: id === 'vent', scaleMul: behemothWeakScaleMul(id, false, vs) }));
    expect(vent.scale.x).toBeCloseTo(vs, 6); // 질식(sealed)
    styleBehemothWeakPoints(rig, 640 / 4, (id) => ({ open: id === 'vent', broken: false, flashAgeMs: -1, scaleMul: behemothWeakScaleMul(id, id === 'vent', vs) }));
    expect(vent.scale.x).toBeCloseTo(1.12 * BH_VENT_OPEN_SCALE * vs, 3); // 열림 — 맥동 봉우리 × 1.4 × 균열
  });
});

describe('갑각 떨기·분출공·질식 외형(B3-2)', () => {
  it('열린 분출공은 ×1.4(BH_VENT_OPEN_SCALE — 맥동 위에 곱한다), 다른 약점은 1. 닫힌 분출공은 1. 질식(sealed)이면 어두운 본색·발광 없음·크기 1(파열색 0x7a1f3a 이 아니다)', () => {
    expect(BH_VENT_OPEN_SCALE).toBe(1.4);
    expect(behemothWeakScaleMul('vent', true)).toBe(1.4);
    expect(behemothWeakScaleMul('vent', false)).toBe(1);
    expect(behemothWeakScaleMul('eye', true)).toBe(1);
    const { rig } = measureRig(0, 0, 0, {});
    const vent = rig.weakPoints['vent']!;
    const mat = vent.material as THREE.MeshLambertMaterial;
    styleBehemothWeakPoints(rig, 640 / 4, (id) => ({ open: true, broken: false, flashAgeMs: -1, scaleMul: behemothWeakScaleMul(id, true) }));
    expect(vent.scale.x).toBeCloseTo(1.12 * 1.4, 3); // 맥동 봉우리 × 열림 배율
    expect(rig.weakPoints['eye']!.scale.x).toBeCloseTo(1.12, 3);
    expect(mat.emissive.getHex()).toBe(0x39ff88); // 텔레그래프 보라가 아니다 — 약점 발광은 제 색
    styleBehemothWeakPoints(rig, 640 / 4, (id) => ({ open: false, broken: false, flashAgeMs: -1, lit: id === 'vent', scaleMul: behemothWeakScaleMul(id, false) }));
    expect(vent.scale.x).toBeCloseTo(1, 6);
    // 질식 — sealed 로 그린다(syncEnemies 가 chokeTicks > 0 이면 sealed, broken 은 vent 에 쓰지 않는다)
    styleBehemothWeakPoints(rig, 640 / 4, (id) => ({ open: false, broken: false, flashAgeMs: -1, sealed: id === 'vent' }));
    expect(mat.emissive.getHex()).toBe(0x000000);
    expect(mat.color.getHex()).not.toBe(0x7a1f3a);
    expect(mat.color.getHex()).not.toBe(0x1f3a2e); // 본색보다 어둡다
    expect(vent.scale.x).toBe(1);
  });

  it('갑각 떨기(shaking) — 등갑판 셋이 판마다 다른 위상으로 잘게 굴러(rotation.z ≠ 0, 서로 다름) 살짝 들썩이고, 떨지 않으면 제자리(0·restY). 꼭대기는 3.8 아래', () => {
    const { rig, box } = measureRig(0, 0, 0, { shaking: true, nowMs: 7 });
    const rz = rig.plates.map((p) => p.rotation.z);
    expect(rz.every((r) => Math.abs(r) > 1e-4)).toBe(true);
    expect(new Set(rz.map((r) => r.toFixed(4))).size).toBe(3);
    expect(rz.every((r) => Math.abs(r) <= 0.05 + 1e-6)).toBe(true);
    const restY = def.visual!.plates.y * def.height;
    expect(rig.plates.every((p) => p.position.y >= restY - 1e-6 && p.position.y <= restY + 0.03 + 1e-6)).toBe(true);
    expect(box.max.y).toBeLessThan(3.8);
    poseBehemothRig(rig, { nowMs: 100, legPhase: 0, legBlend: 0, bladeSide: 1, bladeWindup: 0, bladeStriking: false, strikeProgress: 0, tipDist: pullback, recoiled: false, chargeCoil: 0, charging: false, headbuttCoil: 0, headbutting: false, trembling: false, snap: 1, shaking: false });
    for (const p of rig.plates) {
      expect(p.rotation.z).toBeCloseTo(0, 6);
      expect(p.position.y).toBeCloseTo(restY, 6);
    }
  });
});

describe('P3 기술 외형(B3-4) — 포효 어깨 솟음·탈진·삼연낫 ③·광란 돌격 선회', () => {
  const base: BehemothPose = {
    nowMs: 0, legPhase: 0, legBlend: 0, bladeSide: 1, bladeWindup: 0, bladeStriking: false,
    strikeProgress: 0, tipDist: pullback, recoiled: false, chargeCoil: 0, charging: false,
    headbuttCoil: 0, headbutting: false, trembling: false, snap: 1,
  };
  const anchorGap = (rig: ReturnType<typeof buildBehemothRig>, id: string): number =>
    behemothAnchorPos(rig, id, new THREE.Vector3()).distanceTo(rig.weakPoints[id]!.position);

  it('포효(pose roar) — 어깨 피벗(관절 자리)이 표 (±1.15, 2.7, −0.5) 로 솟아 관절 메시 = 구체(≤ 0.02m — B2-6 검토의 0.31m 어긋남을 없앴다), 진행 중간·움찔도 ≤ 0.2, 눈은 표 2.9(≤ 0.06). 자세가 풀리면 어깨는 제자리(2.5, −0.8)', () => {
    const roar = measureRig(ROAR.lean, 0, 0, { pose: 'roar' });
    for (const id of ['joint_r', 'joint_l']) expect(anchorGap(roar.rig, id), `${id} ${anchorGap(roar.rig, id).toFixed(3)}`).toBeLessThanOrEqual(0.02);
    expect(anchorGap(roar.rig, 'eye')).toBeLessThanOrEqual(0.06);
    const table = weakPointOffset(def, def.weakPoints!.find((w) => w.id === 'joint_r')!, 'roar');
    const jr = behemothAnchorPos(roar.rig, 'joint_r', new THREE.Vector3());
    expect(jr.y).toBeCloseTo(table.y, 2);
    expect(jr.z).toBeCloseTo(table.z, 2);
    const half = measureRig(ROAR.lean * 0.5, 0, 0, { pose: 'roar', poseBlend: 0.5 });
    for (const id of ['joint_r', 'joint_l']) expect(anchorGap(half.rig, id)).toBeLessThanOrEqual(0.2);
    const flinch = measureRig(ROAR.lean + T.flinchLean, 0, 0, { pose: 'roar', nowMs: 100 });
    for (const id of ['joint_r', 'joint_l']) expect(anchorGap(flinch.rig, id)).toBeLessThanOrEqual(0.2);
    // 자세가 풀리면 어깨는 제자리 — 같은 리그를 대기 자세로 다시 놓는다
    roar.torso.rotation.x = 0;
    poseBehemothRig(roar.rig, base);
    const jt = def.visual!.joints.pos;
    for (const arm of roar.rig.arms) {
      expect(arm.shoulder.position.y).toBeCloseTo(jt[1] * def.height, 6);
      expect(arm.shoulder.position.z).toBeCloseTo(jt[2] * def.radius, 6);
    }
    for (const id of ['joint_r', 'joint_l']) {
      roar.group.updateMatrixWorld(true);
      expect(anchorGap(roar.rig, id)).toBeLessThanOrEqual(1e-3);
    }
  });

  it('탈진(pose exhaust) — 두 낫이 다 바닥에 꽂힌다(낫끝 y 0~0.25, 몸 앞 2.4m~사거리, 어깨보다 안쪽, 좌우 대칭), 눈은 표 0.9(IK ≤ 0.06), 분출공 구체는 표 (0, 1.6, −1.7) — 내려온 머리 위로 보인다. 탈진은 exposedStates 로만 열리니 구체 자리만 여기서', () => {
    const { rig } = measureRig(HEAD_DOWN.lean, 0, HEAD_DOWN.crouch, { pose: 'exhaust' });
    const tips = ([1, -1] as const).map((side) => behemothBladeTip(rig, side, new THREE.Vector3()));
    for (const t of tips) {
      expect(t.y, `낫끝 y ${t.y.toFixed(2)}`).toBeGreaterThanOrEqual(0);
      expect(t.y, `낫끝 y ${t.y.toFixed(2)}`).toBeLessThanOrEqual(0.25);
      expect(-t.z).toBeGreaterThan(2.4);
      expect(-t.z).toBeLessThan(reach);
      expect(Math.abs(t.x)).toBeLessThan(1.15);
    }
    expect(tips[1]!.x).toBeCloseTo(-tips[0]!.x, 6);
    expect(rig.weakPoints['eye']!.position.y).toBeCloseTo(0.9, 6);
    expect(anchorGap(rig, 'eye')).toBeLessThanOrEqual(0.06);
    const vent = rig.weakPoints['vent']!.position;
    expect(vent.y).toBeCloseTo(1.6, 6);
    expect(vent.z).toBeCloseTo(-1.7, 6);
    // 열린 표적은 보여야 한다 — 플레이어 눈높이 정면(몸 표면 4.4m)에서 분출공 구체를 향한 시선이 내려온 머리 상자·뿔에 가리지 않는다(레이가 구체 표면보다 먼저 머리를 맞지 않는다)
    const eyePos = new THREE.Vector3(0.5, balance.player.eyeHeight, -(reach + balance.player.radius));
    const ventR = def.weakPoints!.find((w) => w.id === 'vent')!.radius * BH_VENT_OPEN_SCALE;
    const dir = vent.clone().sub(eyePos).normalize();
    const hits = new THREE.Raycaster(eyePos, dir).intersectObject(rig.headShake, true);
    const toSurface = eyePos.distanceTo(vent) - ventR;
    expect(hits.length === 0 || hits[0]!.distance > toSurface, `머리가 분출공을 가린다(${hits[0]?.distance.toFixed(2)} < ${toSurface.toFixed(2)})`).toBe(true);
  });

  it('삼연낫 ③(bothBlades) — 예고에 두 위팔이 같은 각으로 단발 예고보다 높이 들리고 대칭으로 벌어지며 낫은 앞아래(낫끝이 어깨보다 낮다); 타격에 두 낫끝이 tipDist 앞 중심선에 함께(대칭) 온다', () => {
    const wind = measureRig(T.windupLean, 0, 0, { bothBlades: true, bladeWindup: 1, tipDist: COMBO3_PULLBACK });
    const [r, l] = wind.rig.arms;
    const single = measureRig(T.windupLean, 0, 0, { bladeWindup: 1, tipDist: pullback });
    expect(r!.shoulder.rotation.x).toBeGreaterThan(single.rig.arms[0]!.shoulder.rotation.x + 0.02);
    expect(l!.shoulder.rotation.x).toBeCloseTo(r!.shoulder.rotation.x, 6);
    expect(Math.abs(r!.shoulder.rotation.y)).toBeGreaterThan(0.05);
    expect(l!.shoulder.rotation.y).toBeCloseTo(-r!.shoulder.rotation.y, 6);
    for (const side of [1, -1] as const) {
      const t = behemothBladeTip(wind.rig, side, new THREE.Vector3());
      expect(t.y).toBeLessThan(def.visual!.joints.pos[1] * def.height); // 낫끝은 어깨 아래 — 위로 세우면 천장을 뚫는다
    }
    // 단발 예고는 한쪽만 들린다
    expect(single.rig.arms[1]!.shoulder.rotation.x).toBeLessThan(single.rig.arms[0]!.shoulder.rotation.x - 0.03);
    for (const sp of [0.5, 1]) {
      const tipD = COMBO3_PULLBACK + (COMBO3_REACH - COMBO3_PULLBACK) * sp;
      const { rig } = measureRig(T.strikeLean, T.strikeLunge, 0, { bothBlades: true, bladeStriking: true, strikeProgress: sp, tipDist: tipD });
      const tr = behemothBladeTip(rig, 1, new THREE.Vector3());
      const tl = behemothBladeTip(rig, -1, new THREE.Vector3());
      expect(Math.abs(-tr.z - tipD), `sp ${sp} 오른 낫끝 ${(-tr.z).toFixed(2)} vs ${tipD.toFixed(2)}`).toBeLessThan(0.1);
      expect(tl.x).toBeCloseTo(-tr.x, 6);
      expect(tl.y).toBeCloseTo(tr.y, 6);
      expect(tl.z).toBeCloseTo(tr.z, 6);
      if (sp === 1) expect(Math.abs(tr.x)).toBeLessThan(0.3); // 끝에선 중심선
    }
  });

  it('광란 돌격 선회(chainTurn) — 꼬리 yaw 가 크게(봉우리 ≥ 0.6rad) 빠르게 휘둘리고 평소엔 0.18 안. 입·꼬리 재질은 flashMaterials 밖(절망 포효 보라·선회 빨강을 따로 물들인다), 관절 자리는 어깨 피벗의 자식', () => {
    const peak = measureRig(CHARGE.lean, 0, CHARGE.crouch, { pose: 'charge', chargeCoil: 1, chainTurn: true, nowMs: 55 * Math.PI * 0.5 });
    expect(Math.abs(peak.rig.tail.rotation.y)).toBeGreaterThanOrEqual(0.6);
    const rest = measureRig(0, 0, 0, { nowMs: 900 * Math.PI * 0.5 });
    expect(Math.abs(rest.rig.tail.rotation.y)).toBeLessThanOrEqual(0.18 + 1e-6);
    expect(rest.flash).not.toContain(rest.rig.mouthMat);
    for (const m of rest.rig.tailMats) expect(rest.flash).not.toContain(m);
    expect(rest.rig.tailMats).toHaveLength(1);
    expect(rest.rig.anchors['joint_r']!.parent).toBe(rest.rig.arms[0]!.shoulder);
    expect(rest.rig.anchors['joint_l']!.parent).toBe(rest.rig.arms[1]!.shoulder);
  });
});
