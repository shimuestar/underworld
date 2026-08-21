// Three.js 렌더 셋업 전용. 게임 로직 금지.
// World 상태(플레이어 위치/시선, 랜턴)를 읽어 씬에 반영만 한다.

import * as THREE from 'three';

export interface LanternParams {
  intensity: number;
  radius: number;
  angleDeg: number;
  penumbra: number;
}

export class Stage {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly lantern: THREE.SpotLight;
  private readonly eyeHeight: number;

  constructor(container: HTMLElement, eyeHeight: number, lanternParams: LanternParams) {
    this.eyeHeight = eyeHeight;

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
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);

    // 랜턴 스포트라이트 — 카메라에 부착해 시선을 따라간다.
    // decay 0: distance 컷오프 감쇠만 사용 (balance intensity 스케일 유지)
    this.lantern = new THREE.SpotLight(
      0xffffff,
      lanternParams.intensity,
      lanternParams.radius,
      (lanternParams.angleDeg * Math.PI) / 180,
      lanternParams.penumbra,
      0,
    );
    this.lantern.position.set(0, 0, 0);
    this.lantern.target.position.set(0, 0, -1);
    this.camera.add(this.lantern);
    this.camera.add(this.lantern.target);

    window.addEventListener('resize', this.onResize);
  }

  setLevel(group: THREE.Group, ambientIntensity: number): void {
    this.scene.add(group);
    this.scene.add(new THREE.AmbientLight(0xffffff, ambientIntensity));
  }

  /** 보간된 플레이어 상태를 카메라에 반영 */
  updateCamera(x: number, y: number, z: number, yaw: number, pitch: number): void {
    this.camera.position.set(x, y + this.eyeHeight, z);
    this.camera.rotation.y = yaw;
    this.camera.rotation.x = pitch;
  }

  setLanternOn(on: boolean): void {
    this.lantern.visible = on;
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
