// 맵 탭 — 미니맵과 같은 데이터·규칙의 큰 지도. 게임 로직 금지, World 와 미니맵의 안개 기억을 읽어 그리기만 한다.
// 본 곳만(안개), 적은 인지·전투 중만(Awareness.threatAlpha), 소리 핑, 플레이어 화살표(북쪽 위 고정).
// 표식은 나침반과 같은 색·모양(출구·입구·제단·상자·주머니·감지한 함정). 읽기 전용 — 조작 없음 (2026-09-04).

import { balance } from '../core/Balance';
import type { World } from '../core/World';
import type { Awareness } from './Awareness';
import { MINIMAP } from './Minimap';

const MARK = {
  exit: '#3fae5a', exitLocked: '#c23a3a', entrance: '#9aa3ad', altar: '#d8c9a0', chest: '#d9a15c',
  pouch: '#c88a4e', pouchBoss: '#ffd75e', pouchMine: '#7fbfff', trap: '#7d5cff', ping: 'rgba(230,230,240,0.75)',
} as const;

export class MapPanel {
  readonly root: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly title: HTMLDivElement;
  open = false;
  private titleText = '';

  constructor(
    private readonly world: World,
    private readonly aw: Awareness,
    private readonly isRevealed: (x: number, z: number) => boolean,
    parent: HTMLElement,
  ) {
    this.root = document.createElement('div');
    this.root.style.cssText =
      'display:none;background:#15151b;border:1px solid #3a3a44;padding:16px 22px 14px;box-sizing:border-box;text-align:center;';
    this.title = document.createElement('div');
    this.title.style.cssText = 'color:#d8e0ea;font:bold 14px/1 monospace;letter-spacing:2px;margin-bottom:10px;';
    this.canvas = document.createElement('canvas');
    this.canvas.style.cssText = 'display:block;border:1px solid #333;background:rgba(0,0,0,0.6);image-rendering:pixelated;';
    const legend = document.createElement('div');
    legend.style.cssText = 'margin-top:10px;font:11px/1.7 monospace;color:#8a8f9a;';
    legend.innerHTML =
      '<span style="color:#d8c9a0">■</span>제단 <span style="color:#3fae5a">■</span>출구 <span style="color:#6b4a2f">■</span>잠긴 문 ' +
      '<span style="color:#2f6f74">■</span>레버·관문 <span style="color:#4a5a68">■</span>균열벽 · ' +
      '<span style="color:#9fe870">▲</span>나 <span style="color:#e04444">●</span>적 <span style="color:#d9a15c">◆</span>상자 ' +
      '<span style="color:#c88a4e">●</span>주머니 <span style="color:#7d5cff">▲</span>함정';
    this.root.append(this.title, this.canvas, legend);
    parent.appendChild(this.root);
    this.ctx = this.canvas.getContext('2d')!;
  }

  setTitle(text: string): void {
    this.titleText = text;
    this.title.textContent = text;
  }

  show(): void {
    this.open = true;
    this.root.style.display = 'block';
    this.title.textContent = this.titleText;
    this.update();
  }
  hide(): void {
    this.open = false;
    this.root.style.display = 'none';
  }

  /** 매 프레임 — 안개·적·핑이 움직이므로 열려 있는 동안 다시 그린다 */
  update(): void {
    if (!this.open) return;
    const cfg = balance.hud.menuTabs.map;
    const world = this.world;
    const level = world.level;
    const p = world.player;
    const now = performance.now();
    // 셀 크기 — 기본값에서 화면 높이 비율에 맞게 줄인다
    const cell = Math.max(6, Math.min(cfg.cellPx, Math.floor((window.innerHeight * cfg.maxHeightFrac) / level.rows)));
    const w = level.cols * cell;
    const h = level.rows * cell;
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    const ctx = this.ctx;
    const cs = level.cellSize;
    const god = world.godMode === true;
    ctx.clearRect(0, 0, w, h);
    // 바닥·벽 — 본 칸만 (신 모드는 전부)
    for (let row = 0; row < level.rows; row++) {
      for (let col = 0; col < level.cols; col++) {
        const seen = god || this.isRevealed(col * cs + cs / 2, row * cs + cs / 2);
        if (!seen) { ctx.fillStyle = MINIMAP.fog; ctx.fillRect(col * cell, row * cell, cell, cell); continue; }
        const ch = level.charAt(col, row);
        ctx.fillStyle = MINIMAP.colors[ch] ?? MINIMAP.floor;
        ctx.fillRect(col * cell, row * cell, cell, cell);
      }
    }
    const px = (x: number): number => (x / cs) * cell;
    const pz = (z: number): number => (z / cs) * cell;
    const dot = (x: number, z: number, r: number, color: string, alpha = 1): void => {
      ctx.globalAlpha = alpha; ctx.fillStyle = color; ctx.beginPath(); ctx.arc(px(x), pz(z), r, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
    };
    const square = (x: number, z: number, r: number, color: string): void => { ctx.fillStyle = color; ctx.fillRect(px(x) - r, pz(z) - r, r * 2, r * 2); };
    const diamond = (x: number, z: number, r: number, color: string): void => {
      ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(px(x), pz(z) - r); ctx.lineTo(px(x) + r, pz(z)); ctx.lineTo(px(x), pz(z) + r); ctx.lineTo(px(x) - r, pz(z)); ctx.closePath(); ctx.fill();
    };
    const tri = (x: number, z: number, r: number, color: string): void => {
      ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(px(x), pz(z) - r); ctx.lineTo(px(x) + r, pz(z) + r); ctx.lineTo(px(x) - r, pz(z) + r); ctx.closePath(); ctx.fill();
    };
    const r = Math.max(3, cell * 0.28);
    // 목표 — 나침반과 같은 규칙(본 것만, 출구는 열리면 항상)
    if (level.exitPos && (world.exitOpen || god || this.isRevealed(level.exitPos.x, level.exitPos.z))) {
      const locked = world.exitNeedsKey;
      ctx.fillStyle = locked ? MARK.exitLocked : MARK.exit;
      const col = Math.floor(level.exitPos.x / cs), row = Math.floor(level.exitPos.z / cs);
      ctx.fillRect(col * cell, row * cell, cell, cell);
    }
    if (world.canAscend) tri(level.spawn.x, level.spawn.z, r, MARK.entrance);
    if (level.altarPos && (god || this.isRevealed(level.altarPos.x, level.altarPos.z))) square(level.altarPos.x, level.altarPos.z, r, MARK.altar);
    for (const c of world.chests) {
      if (c.opened && (c.chestItems?.length ?? 0) === 0) continue;
      if (god || this.isRevealed(c.x, c.z)) diamond(c.x, c.z, r, MARK.chest);
    }
    for (const g of world.groundItems) {
      if (g.kind !== 'pouch') continue;
      if (!(god || this.isRevealed(g.x, g.z))) continue;
      dot(g.x, g.z, r * 0.8, g.pouchOwner === 'player' ? MARK.pouchMine : g.pouchTier === 'boss' ? MARK.pouchBoss : MARK.pouch);
    }
    if (world.modifiers.revealTrapsRadius > 0) {
      for (const t of world.traps) if (t.revealed && t.phase !== 'spent' && t.phase !== 'disarmed') tri(t.x, t.z, r * 0.9, MARK.trap);
    }
    // 소리 핑
    this.aw.prunePings(now);
    if (!god) for (const ping of this.aw.pings) dot(ping.x, ping.z, r * 0.7, MARK.ping, 1 - (now - ping.bornMs) / balance.minimap.pingMs);
    // 적 — 미니맵과 같은 조건
    for (const e of world.enemies) {
      if (!e.alive) continue;
      const a = this.aw.threatAlpha(e, p, level, god, now);
      if (a === null) continue;
      dot(e.x, e.z, r, e.ai === 'staggered' ? MINIMAP.enemyStaggered : e.ai === 'idle' ? MINIMAP.enemyIdle : MINIMAP.enemy, a);
    }
    // 나 — 시선 방향 화살표
    const angle = Math.atan2(-Math.cos(p.yaw), -Math.sin(p.yaw));
    ctx.save();
    ctx.translate(px(p.x), pz(p.z));
    ctx.rotate(angle);
    ctx.fillStyle = MINIMAP.player;
    ctx.beginPath();
    ctx.moveTo(r * 1.8, 0);
    ctx.lineTo(-r * 1.2, r * 1.1);
    ctx.lineTo(-r * 1.2, -r * 1.1);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}
