// 얼굴에 붙은 거머리 미리보기 — 게임과 같은 buildFaceLeechRig/animateFaceLeechRig 를
// 실전 부착 위치(카메라 앞 0.3m)에 놓고 본다. ?suck=1 은 흡혈 조임 순간의 프레임.
import * as THREE from 'three';
import { buildFaceLeechRig, animateFaceLeechRig } from '../src/render/Stage';

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x14100d); // 던전 톤의 어두운 배경
scene.add(new THREE.AmbientLight(0xffffff, 0.5));
const key = new THREE.PointLight(0xffe0b0, 1.2, 20, 0);
key.position.set(1, 1.5, 1);
scene.add(key);

// 뒷배경 — 복도 벽 느낌의 판 (리그가 화면을 얼마나 가리는지 가늠용)
const wall = new THREE.Mesh(
  new THREE.PlaneGeometry(12, 6),
  new THREE.MeshLambertMaterial({ color: 0x55555f }),
);
wall.position.set(0, 1.5, -6);
scene.add(wall);

const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.05, 100);
camera.position.set(0, 1.5, 0);
scene.add(camera);

const rig = buildFaceLeechRig();
rig.position.set(0, -0.02, -0.3); // Stage.setFaceLeech 와 같은 부착점
camera.add(rig);

const suck = new URLSearchParams(location.search).get('suck') === '1';
animateFaceLeechRig(rig, 1234, suck ? 60 : 9999); // suck=1 이면 조임 피크 근처

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);
renderer.render(scene, camera);
