// Three.js 렌더 셋업 전용. 게임 로직 금지.
// M0: 빈 씬 + 바닥 평면 하나. 레벨 지오메트리는 level/GridLoader가 담당할 예정.

import * as THREE from 'three';

export class Stage {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  private readonly renderer: THREE.WebGLRenderer;

  constructor(container: HTMLElement, eyeHeight: number) {
    this.renderer = new THREE.WebGLRenderer({ antialias: false });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000000);

    this.camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      200,
    );
    this.camera.position.set(0, eyeHeight, 8);

    // 임시 조명 — 레벨 조명(ambient/torches)은 레벨 JSON에서 로드할 예정
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.15));
    const key = new THREE.DirectionalLight(0xffffff, 0.6);
    key.position.set(4, 10, 6);
    this.scene.add(key);

    // 바닥 평면 (그리드 셀 4u 기준 10x10 셀 크기)
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(40, 40),
      new THREE.MeshLambertMaterial({ color: 0x3a3a44 }),
    );
    floor.rotation.x = -Math.PI / 2;
    this.scene.add(floor);

    window.addEventListener('resize', this.onResize);
  }

  private onResize = (): void => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  };

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }
}
