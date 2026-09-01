// 락온 마커 미리보기 — Stage getLockTexture 와 같은 그리기. 구울(1.85m) 몸통 중앙.
import * as THREE from 'three';

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x14100d);
scene.add(new THREE.AmbientLight(0xffffff, 0.55));
const key = new THREE.PointLight(0xffe0b0, 1.2, 40, 0);
key.position.set(1.5, 3, 5);
scene.add(key);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(14, 8), new THREE.MeshLambertMaterial({ color: 0x3a3f46 }));
floor.rotation.x = -Math.PI / 2;
scene.add(floor);

// 구울 대역 — 키 1.85 몸통
const body = new THREE.Mesh(
  new THREE.CylinderGeometry(0.35, 0.42, 1.85, 8),
  new THREE.MeshLambertMaterial({ color: 0x5a6a4a }),
);
body.position.y = 1.85 / 2;
scene.add(body);

// Stage.getLockTexture 재현
const canvas = document.createElement('canvas');
canvas.width = 64;
canvas.height = 64;
const ctx = canvas.getContext('2d')!;
ctx.beginPath();
ctx.moveTo(32, 8);
ctx.lineTo(56, 32);
ctx.lineTo(32, 56);
ctx.lineTo(8, 32);
ctx.closePath();
ctx.lineWidth = 9;
ctx.strokeStyle = 'rgba(0,0,0,0.85)';
ctx.stroke();
ctx.lineWidth = 5;
ctx.strokeStyle = '#ffd24a';
ctx.stroke();
ctx.fillStyle = 'rgba(255, 210, 74, 0.25)';
ctx.fill();
const spr = new THREE.Sprite(
  new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(canvas),
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
    depthTest: false,
  }),
);
spr.renderOrder = 999;
spr.scale.set(0.7, 0.7, 1);
spr.position.set(0, 1.85 * 0.55, 0);
scene.add(spr);

const camera = new THREE.PerspectiveCamera(60, 900 / 600, 0.1, 100);
camera.position.set(0, 1.6, 4.2);
camera.lookAt(0, 1.1, 0);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(900, 600);
document.body.appendChild(renderer.domElement);
renderer.render(scene, camera);
