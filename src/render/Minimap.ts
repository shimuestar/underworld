// 미니맵 — 2D 캔버스 오버레이. 게임 로직 금지, World 상태를 읽어 그리기만 한다.
// 정적 레벨 레이어는 생성 시 1회, 플레이어/적은 매 프레임.
// 어그로 전(idle) 적은 흐린 점 — 프로토타입 단계의 탐색 편의. 슬라이스 검증 시 숨길 것.

import type { EnemyState, PlayerState } from '../core/World';
import type { Level } from '../level/GridLoader';

// 시각 상수 (튜닝값 아님)
const PX_PER_UNIT = 3;
// 월드 시각물과 같은 색을 쓴다 — 지도와 실물이 일치해야 한다
const COLORS: Record<string, string> = {
  '#': '#565663',
  D: '#6b4a2f',
  C: '#4a5a68',
  A: '#d8c9a0',
  X: '#3fae5a',
};
const FLOOR = 'rgba(30,30,36,0.85)';
const PLAYER = '#9fe870';
const ENEMY = '#e04444';
const ENEMY_IDLE = 'rgba(224,68,68,0.35)';
const ENEMY_STAGGERED = '#cc9922';
const EXIT_LOCKED = '#3a3f44'; // 봉인된 출구 (월드의 COLOR_EXIT_LOCKED 와 같은 색)

export class Minimap {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly base: HTMLCanvasElement;
  private readonly cellPx: number;
  visible = true;

  constructor(private readonly level: Level) {
    this.cellPx = level.cellSize * PX_PER_UNIT;
    const w = level.cols * this.cellPx;
    const h = level.rows * this.cellPx;

    // 정적 레이어
    this.base = document.createElement('canvas');
    this.base.width = w;
    this.base.height = h;
    this.rebuildBase();

    // 표시용 캔버스
    this.canvas = document.createElement('canvas');
    this.canvas.width = w;
    this.canvas.height = h;
    this.canvas.style.cssText =
      'position:fixed;top:8px;right:8px;opacity:0.92;border:1px solid #333;' +
      'background:rgba(0,0,0,0.6);pointer-events:none;image-rendering:pixelated;';
    document.body.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;

    // 범례 — 미니맵 바로 아래
    this.legend = document.createElement('div');
    this.legend.style.cssText =
      `position:fixed;top:${h + 14}px;right:8px;width:${w}px;` +
      'font:10px/1.6 monospace;color:#8a8f9a;text-align:right;pointer-events:none;user-select:none;';
    this.legend.innerHTML =
      '<span style="color:#d8c9a0">■</span>제단 ' +
      '<span style="color:#3fae5a">■</span>출구 ' +
      '<span style="color:#6b4a2f">■</span>잠긴 문 ' +
      '<span style="color:#4a5a68">■</span>균열벽<br>' +
      '<span style="color:#9fe870">▲</span>나 ' +
      '<span style="color:#e04444">●</span>적 ' +
      '<span style="color:#cc9922">●</span>처형 가능';
    document.body.appendChild(this.legend);
  }

  private readonly legend: HTMLDivElement;

  /** 정적 레이어 재생성 — 문 개방 등 그리드가 바뀌었을 때 호출 */
  rebuildBase(): void {
    const level = this.level;
    const bctx = this.base.getContext('2d')!;
    bctx.clearRect(0, 0, this.base.width, this.base.height);
    for (let row = 0; row < level.rows; row++) {
      for (let col = 0; col < level.cols; col++) {
        const ch = level.charAt(col, row);
        bctx.fillStyle = COLORS[ch] ?? FLOOR;
        bctx.fillRect(col * this.cellPx, row * this.cellPx, this.cellPx, this.cellPx);
      }
    }
  }

  toggle(): void {
    this.visible = !this.visible;
    this.canvas.style.display = this.visible ? 'block' : 'none';
    this.legend.style.display = this.visible ? 'block' : 'none';
  }

  update(player: PlayerState, enemies: EnemyState[], alpha: number, exitOpen = true): void {
    if (!this.visible) return;
    const ctx = this.ctx;
    const s = PX_PER_UNIT;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.drawImage(this.base, 0, 0);

    // 봉인된 출구는 회색으로 덮는다 — 지도에서도 "아직 못 나간다"가 보여야 한다
    if (!exitOpen && this.level.exitPos) {
      const col = Math.floor(this.level.exitPos.x / this.level.cellSize);
      const row = Math.floor(this.level.exitPos.z / this.level.cellSize);
      ctx.fillStyle = EXIT_LOCKED;
      ctx.fillRect(col * this.cellPx, row * this.cellPx, this.cellPx, this.cellPx);
    }

    // 적 — 어그로 상태는 선명하게, idle은 흐리게. 스태거는 처형 가능 색
    for (const enemy of enemies) {
      if (!enemy.alive) continue;
      const ex = (enemy.prevX + (enemy.x - enemy.prevX) * alpha) * s;
      const ez = (enemy.prevZ + (enemy.z - enemy.prevZ) * alpha) * s;
      ctx.fillStyle =
        enemy.ai === 'staggered' ? ENEMY_STAGGERED : enemy.ai === 'idle' ? ENEMY_IDLE : ENEMY;
      ctx.beginPath();
      ctx.arc(ex, ez, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    // 플레이어 — 시선 방향 화살표
    const px = (player.prevX + (player.x - player.prevX) * alpha) * s;
    const pz = (player.prevZ + (player.z - player.prevZ) * alpha) * s;
    const angle = Math.atan2(-Math.cos(player.yaw), -Math.sin(player.yaw));
    ctx.save();
    ctx.translate(px, pz);
    ctx.rotate(angle);
    ctx.fillStyle = PLAYER;
    ctx.beginPath();
    ctx.moveTo(5, 0);
    ctx.lineTo(-3.5, 3.2);
    ctx.lineTo(-3.5, -3.2);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}
