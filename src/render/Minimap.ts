// 미니맵 — 2D 캔버스 오버레이. 게임 로직 금지, World 상태를 읽어 그리기만 한다.
// 정적 레벨 레이어는 생성 시 1회, 플레이어/적은 매 프레임.
// 어그로 전(idle) 적은 흐린 점 — 프로토타입 단계의 탐색 편의. 슬라이스 검증 시 숨길 것.

import type { EnemyState, PlayerState } from '../core/World';
import type { Level } from '../level/GridLoader';

// 시각 상수 (튜닝값 아님)
const PX_PER_UNIT = 3;
const COLORS: Record<string, string> = {
  '#': '#565663',
  D: '#6b4a2f',
  C: '#4a5a68',
  A: '#a855f7',
  X: '#3fae5a',
  L: '#c9a227',
};
const FLOOR = 'rgba(30,30,36,0.85)';
const PLAYER = '#9fe870';
const ENEMY = '#e04444';
const ENEMY_IDLE = 'rgba(224,68,68,0.35)';
const ENEMY_STAGGERED = '#cc9922';

export class Minimap {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly base: HTMLCanvasElement;
  private readonly cellPx: number;
  visible = true;

  constructor(level: Level) {
    this.cellPx = level.cellSize * PX_PER_UNIT;
    const w = level.cols * this.cellPx;
    const h = level.rows * this.cellPx;

    // 정적 레이어
    this.base = document.createElement('canvas');
    this.base.width = w;
    this.base.height = h;
    const bctx = this.base.getContext('2d')!;
    for (let row = 0; row < level.rows; row++) {
      for (let col = 0; col < level.cols; col++) {
        const ch = level.charAt(col, row);
        bctx.fillStyle = COLORS[ch] ?? FLOOR;
        bctx.fillRect(col * this.cellPx, row * this.cellPx, this.cellPx, this.cellPx);
      }
    }
    // 횃불 점
    bctx.fillStyle = '#ff8c3b';
    for (const cell of level.torches) {
      const [row, col] = cell;
      if (row === undefined || col === undefined) continue;
      bctx.beginPath();
      bctx.arc((col + 0.5) * this.cellPx, (row + 0.5) * this.cellPx, 2, 0, Math.PI * 2);
      bctx.fill();
    }

    // 표시용 캔버스
    this.canvas = document.createElement('canvas');
    this.canvas.width = w;
    this.canvas.height = h;
    this.canvas.style.cssText =
      'position:fixed;top:8px;right:8px;opacity:0.92;border:1px solid #333;' +
      'background:rgba(0,0,0,0.6);pointer-events:none;image-rendering:pixelated;';
    document.body.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
  }

  toggle(): void {
    this.visible = !this.visible;
    this.canvas.style.display = this.visible ? 'block' : 'none';
  }

  update(player: PlayerState, enemies: EnemyState[], alpha: number): void {
    if (!this.visible) return;
    const ctx = this.ctx;
    const s = PX_PER_UNIT;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.drawImage(this.base, 0, 0);

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
