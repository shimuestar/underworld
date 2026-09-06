// 낫뿔 거수 리그 — 약점 구체가 판정과 같은 poseOffsets 표를 읽는지(보이는 자리 = 판정 자리, B2-1).
// 렌더러 없이 순수 지오메트리로 짓는다. 배치 1 의 천장·낫끝 검사는 Boss.test 에 있다(B2-2 에서 이쪽으로 옮긴다).

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { enemyDef, weakPointOffset } from '../core/Entities';
import {
  behemothAnchorPos,
  buildBehemothRig,
  poseBehemothRig,
  styleBehemothWeakPoints,
  BEHEMOTH_TORSO,
  type BehemothPose,
} from './Stage';

const def = enemyDef('scythe_behemoth');

function build(pose: Partial<BehemothPose> = {}, lean = 0, crouch = 0) {
  const base: BehemothPose = {
    nowMs: 0, legPhase: 0, legBlend: 0, bladeSide: 1, bladeWindup: 0, bladeStriking: false,
    strikeProgress: 0, tipDist: 1.3, recoiled: false, chargeCoil: 0, charging: false,
    headbuttCoil: 0, headbutting: false, trembling: false, snap: 1,
  };
  const group = new THREE.Group();
  const torso = new THREE.Group();
  group.add(torso);
  const flash: THREE.MeshLambertMaterial[] = [];
  const rig = buildBehemothRig(group, torso, def, flash);
  torso.rotation.x = lean;
  torso.position.y = crouch;
  poseBehemothRig(rig, { ...base, ...pose });
  return { rig, group, flash };
}

describe('약점 구체 = 판정 구체', () => {
  it('구체는 def.weakPoints 마다 하나(wp_<id>), group 소속, 반지름 = wp.radius, 자리 = normal 표', () => {
    const { rig, group, flash } = build();
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

  it('로직 자세(pose)가 있으면 poseOffsets 표의 그 자세 자리 — 몸통 기울임·웅크림·목 내림에 딸려 가지 않는다', () => {
    const charge = build({ pose: 'charge', chargeCoil: 1 }, BEHEMOTH_TORSO.chargeLean, -def.height * BEHEMOTH_TORSO.chargeCrouch);
    for (const wp of def.weakPoints!) {
      const off = weakPointOffset(def, wp, 'charge');
      const p = charge.rig.weakPoints[wp.id]!.position;
      expect([p.x, p.y, p.z], wp.id).toEqual([off.x, off.y, off.z]);
    }
    expect(charge.rig.weakPoints['eye']!.position.y).toBeCloseTo(1.1, 6);
    const headDown = build({ pose: 'head_down' });
    expect(headDown.rig.weakPoints['eye']!.position.y).toBeCloseTo(0.9, 6);
    expect(headDown.rig.weakPoints['eye']!.position.z).toBeCloseTo(-1.9, 6);
    // 표에 없는 자세는 normal
    const odd = build({ pose: 'no_such_pose' });
    expect(odd.rig.weakPoints['eye']!.position.y).toBeCloseTo(2.35, 6);
  });

  it('자세 없이 몸만 움직이면(들이받기 예고·돌격 예고) 구체는 normal 자리에 남고, 머리 메시의 눈 자리(anchor)만 움직인다', () => {
    const rest = build();
    const coil = build({ headbuttCoil: 1 }, BEHEMOTH_TORSO.headbuttLean);
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

  it('표시 — 열림: 발광(id 색)+맥동 ±12% / 파열: 어둡게·발광 없음 / 명중 직후: 더 밝게. 텔레그래프 3색·스태거 금색은 쓰지 않는다', () => {
    const { rig } = build();
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
