// 고정 타임스텝 루프. 게임 로직은 simulate에서만, 고정 60Hz로 돈다.
// 렌더는 가변 프레임이며 alpha 보간만 담당한다. docs/architecture.md §1 참조.

export interface LoopHooks {
  /** 고정 dt로 호출된다. 게임 상태 변경은 여기서만 한다. */
  simulate(dt: number): void;
  /** 매 프레임 호출된다. alpha는 [0,1) 틱 간 보간 계수. */
  render(alpha: number): void;
}

export class Loop {
  private readonly step: number;
  private acc = 0;
  private last = 0;
  private paused = false;

  constructor(
    tickRate: number,
    private readonly maxFrameClampSec: number,
    private readonly hooks: LoopHooks,
  ) {
    this.step = 1 / tickRate;
  }

  start(): void {
    this.last = performance.now();
    requestAnimationFrame(this.frame);
  }

  /** 일시정지 — simulate만 멈추고 render는 계속한다 (화면은 정지 상태로 보인다).
   *  재개 시 누적 시간을 버려 멈춰 있던 만큼 틱이 몰아치지 않게 한다 */
  setPaused(paused: boolean): void {
    if (this.paused === paused) return;
    this.paused = paused;
    if (!paused) {
      this.last = performance.now();
      this.acc = 0;
    }
  }

  get isPaused(): boolean {
    return this.paused;
  }

  private frame = (now: number): void => {
    // 스파이크 클램프 — 탭 전환 후 복귀 시 수백 틱이 몰아치는 것을 막는다
    this.acc += Math.min((now - this.last) / 1000, this.maxFrameClampSec);
    this.last = now;

    if (this.paused) {
      this.acc = 0;
      this.hooks.render(0);
      requestAnimationFrame(this.frame);
      return;
    }

    while (this.acc >= this.step) {
      this.hooks.simulate(this.step);
      this.acc -= this.step;
    }

    this.hooks.render(this.acc / this.step);
    requestAnimationFrame(this.frame);
  };
}
