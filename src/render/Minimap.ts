// 미니맵 — 2D 캔버스 오버레이. 게임 로직 금지, World 상태를 읽어 그리기만 한다.
// 전장의 안개: 가 본 곳(reveal 반경)만 그려지고, 밝힌 지역은 층별로 기억된다(사망에도 유지).
// 적 표시 규칙: ① 시야(카메라 호 + 벽에 안 가림) 안 ② 공격을 주고받은 지 얼마 안 된 적
// (실시간 추적, combatSolid 후 combatFade 동안 옅어짐) ③ 소리 핑(흐릿한 점 깜빡).
// 신 모드(무적)에서는 예전처럼 전부 표시된다. 수치는 balance.minimap.

import { balance } from '../core/Balance';
import type { EnemyState, PlayerState } from '../core/World';
import type { Level } from '../level/GridLoader';

// 시각 상수 (튜닝값 아님)
const PX_PER_UNIT = 3;
// 월드 시각물과 같은 색을 쓴다 — 지도와 실물이 일치해야 한다
const COLORS: Record<string, string> = {
  '#': '#565663',
  D: '#6b4a2f',
  G: '#2f6f74',
  C: '#4a5a68',
  L: '#2f6f74',
  A: '#d8c9a0',
  X: '#3fae5a',
};
const FLOOR = 'rgba(30,30,36,0.85)';
const FOG = '#0a0a0e'; // 미탐사 — 아예 검게, "모른다"가 확실히 읽히게
const PLAYER = '#9fe870';
const ENEMY = '#e04444';
const ENEMY_IDLE = 'rgba(224,68,68,0.35)';
const ENEMY_STAGGERED = '#cc9922';
const PING = 'rgba(230,230,240,0.7)'; // 소리 핑 — 흐릿한 잿빛 점
const EXIT_LOCKED = '#3a3f44'; // 봉인된 출구 (월드의 COLOR_EXIT_LOCKED 와 같은 색)

export class Minimap {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly base: HTMLCanvasElement;
  private readonly fog: HTMLCanvasElement;
  private cellPx: number;
  visible = true;

  /** 층별로 밝힌 셀 — 층을 오가도, 죽어도 기억은 남는다 (무덤 회수 러닝의 길잡이) */
  private readonly revealedByLevel = new Map<string, Set<number>>();
  private revealed: Set<number>;
  /** 공격을 주고받은 적 — id → 만료 시각(ms). 그동안 실시간 추적된다 */
  private readonly combat = new Map<number, number>();
  /** 소리 핑 — 시야 밖 소리가 난 자리에 잠깐 깜빡인다 */
  private pings: { x: number; z: number; bornMs: number }[] = [];

  constructor(private level: Level) {
    this.cellPx = level.cellSize * PX_PER_UNIT;
    const w = level.cols * this.cellPx;
    const h = level.rows * this.cellPx;

    // 정적 레이어 + 안개 레이어
    this.base = document.createElement('canvas');
    this.base.width = w;
    this.base.height = h;
    this.fog = document.createElement('canvas');
    this.fog.width = w;
    this.fog.height = h;
    this.revealed = this.revealedSetFor(level);
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
      '<span style="color:#2f6f74">■</span>레버·관문 ' +
      '<span style="color:#4a5a68">■</span>균열벽<br>' +
      '<span style="color:#9fe870">▲</span>나 ' +
      '<span style="color:#e04444">●</span>적 ' +
      '<span style="color:#cc9922">●</span>처형 가능';
    document.body.appendChild(this.legend);
  }

  private readonly legend: HTMLDivElement;

  private revealedSetFor(level: Level): Set<number> {
    let set = this.revealedByLevel.get(level.id);
    if (!set) {
      set = new Set<number>();
      this.revealedByLevel.set(level.id, set);
    }
    return set;
  }

  /** 층이 바뀌었다 — 새 그리드로 갈아 끼우고 밑그림·안개를 다시 그린다 */
  setLevel(level: Level): void {
    this.level = level;
    this.cellPx = level.cellSize * PX_PER_UNIT;
    const w = level.cols * this.cellPx;
    const h = level.rows * this.cellPx;
    this.base.width = w;
    this.base.height = h;
    this.fog.width = w;
    this.fog.height = h;
    this.canvas.width = w;
    this.canvas.height = h;
    this.revealed = this.revealedSetFor(level);
    this.combat.clear();
    this.pings = [];
    this.rebuildBase();
  }

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
    // 안개 — 전부 덮고, 이미 밝혀 둔 셀만 걷는다 (층 기억)
    const fctx = this.fog.getContext('2d')!;
    fctx.clearRect(0, 0, this.fog.width, this.fog.height);
    fctx.fillStyle = FOG;
    fctx.fillRect(0, 0, this.fog.width, this.fog.height);
    for (const key of this.revealed) {
      const row = Math.floor(key / 4096);
      const col = key % 4096;
      fctx.clearRect(col * this.cellPx, row * this.cellPx, this.cellPx, this.cellPx);
    }
  }

  /** 발길이 닿은 자리 — 반경 안 셀의 안개를 걷는다. 매 프레임 호출해도 새 셀만 지운다 */
  private reveal(px: number, pz: number): void {
    const cs = this.level.cellSize;
    const r = balance.minimap.revealRadius;
    const fctx = this.fog.getContext('2d')!;
    const c0 = Math.floor((px - r) / cs);
    const c1 = Math.floor((px + r) / cs);
    const r0 = Math.floor((pz - r) / cs);
    const r1 = Math.floor((pz + r) / cs);
    for (let row = r0; row <= r1; row++) {
      for (let col = c0; col <= c1; col++) {
        if (row < 0 || col < 0 || row >= this.level.rows || col >= this.level.cols) continue;
        const key = row * 4096 + col;
        if (this.revealed.has(key)) continue;
        // 셀 중심이 반경 안일 때만 — 대각 모서리가 성급히 밝혀지지 않게
        const cx = col * cs + cs / 2;
        const cz = row * cs + cs / 2;
        if (Math.hypot(cx - px, cz - pz) > r) continue;
        this.revealed.add(key);
        fctx.clearRect(col * this.cellPx, row * this.cellPx, this.cellPx, this.cellPx);
      }
    }
  }

  /** 공격을 주고받았다 — 이 적은 잠시 실시간으로 추적된다 */
  notifyCombat(enemyId: number): void {
    const cfg = balance.minimap;
    this.combat.set(enemyId, performance.now() + cfg.combatSolidMs + cfg.combatFadeMs);
  }

  /** 소리가 났다 — 그 자리에 흐릿한 점이 잠깐 깜빡인다 */
  ping(x: number, z: number): void {
    this.pings.push({ x, z, bornMs: performance.now() });
    if (this.pings.length > 24) this.pings.shift();
  }

  toggle(): void {
    this.visible = !this.visible;
    this.canvas.style.display = this.visible ? 'block' : 'none';
    this.legend.style.display = this.visible ? 'block' : 'none';
  }

  update(
    player: PlayerState,
    enemies: EnemyState[],
    alpha: number,
    exitOpen = true,
    god = false,
  ): void {
    if (!this.visible) return;
    const cfg = balance.minimap;
    const now = performance.now();
    this.reveal(player.x, player.z);
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

    // 안개 — 신 모드는 전부 보인다
    if (!god) ctx.drawImage(this.fog, 0, 0);

    // 소리 핑 — 흐릿한 점이 pingMs 동안 잦아든다 (신 모드에선 불필요)
    if (!god) {
      for (let i = this.pings.length - 1; i >= 0; i--) {
        const p = this.pings[i]!;
        const age = now - p.bornMs;
        if (age > cfg.pingMs) {
          this.pings.splice(i, 1);
          continue;
        }
        ctx.globalAlpha = 1 - age / cfg.pingMs;
        ctx.fillStyle = PING;
        ctx.beginPath();
        ctx.arc(p.x * s, p.z * s, 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    // 적 — ① 시야(카메라 호 + 벽에 안 가림) 안 ② 전투 추적(실시간, 끝은 페이드).
    // 위장 중인 천장 거머리는 눈앞이라도 안 보인다 (기습 담당)
    const fx = -Math.sin(player.yaw);
    const fz = -Math.cos(player.yaw);
    const arcCos = Math.cos(((cfg.viewArcDeg / 2) * Math.PI) / 180);
    for (const enemy of enemies) {
      if (!enemy.alive) continue;
      let alphaMul = 1;
      if (!god) {
        const expire = this.combat.get(enemy.id);
        const inCombat = expire !== undefined && now < expire;
        if (inCombat) {
          const remain = expire - now;
          if (remain < cfg.combatFadeMs) alphaMul = remain / cfg.combatFadeMs;
        } else {
          if (enemy.lurking) continue;
          const dx = enemy.x - player.x;
          const dz = enemy.z - player.z;
          const dist = Math.hypot(dx, dz);
          if (dist > 0.001 && (fx * dx + fz * dz) / dist < arcCos) continue; // 시야각 밖
          if (!this.level.hasLineOfSight(player.x, player.z, enemy.x, enemy.z)) continue; // 벽 뒤
        }
      }
      const ex = (enemy.prevX + (enemy.x - enemy.prevX) * alpha) * s;
      const ez = (enemy.prevZ + (enemy.z - enemy.prevZ) * alpha) * s;
      ctx.globalAlpha = alphaMul;
      ctx.fillStyle =
        enemy.ai === 'staggered' ? ENEMY_STAGGERED : enemy.ai === 'idle' ? ENEMY_IDLE : ENEMY;
      ctx.beginPath();
      ctx.arc(ex, ez, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
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
