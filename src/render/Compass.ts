// 나침반 — 화면 상단 중앙의 가로 띠. 게임 로직 금지, World 를 읽어 그리기만 한다.
// 미니맵(위치)과 역할을 나눈다: 나침반은 "저것이 어느 방향에 있나"를 조준선에서 눈을 떼지 않고 읽는 도구다.
// 정면 ±arcDeg/2 만 띠에 펼치고, 그 밖의 표식은 양 끝 화살촉으로 "뒤에 있다"만 알린다.
// 표식(우선순위): 위협(붉은 점, 락온은 마름모) > 피격 방향(붉은 쐐기) > 소리 핑(잿빛) > 목표(출구·입구·제단·상자) > 전리품(주머니) > 감지한 함정.
// 가리기: 미니맵의 안개 기억을 그대로 — 본 것만(출구는 쇠창살이 열리면 항상). 항상 표시(토글 없음, 2026-09-04 사용자 결정).

import { balance } from '../core/Balance';
import { enemyDef } from '../core/Entities';
import type { World } from '../core/World';
import type { Awareness } from './Awareness';

type Shape = 'circle' | 'square' | 'diamond' | 'triangle' | 'x' | 'bars' | 'wedge';
interface Marker {
  bearing: number; // rad, +는 오른쪽
  dist: number;
  shape: Shape;
  color: string;
  size: number;
  alpha: number;
  priority: number; // 작을수록 앞
  name: string;
  showDist: boolean;
  ring?: boolean;
}

// 색은 미니맵 범례·월드 시각물과 일치 — 지도와 실물이 같은 색이어야 한다
const C = {
  bg: 'rgba(0,0,0,0.55)',
  border: 'rgba(70,70,84,0.9)',
  tick: 'rgba(216,224,234,0.55)',
  major: 'rgba(216,224,234,0.9)',
  text: '#d8e0ea',
  dim: '#8a8f9a',
  threat: '#e04444',
  threatIdle: 'rgba(224,68,68,0.55)',
  ping: 'rgba(230,230,240,0.75)',
  exit: '#3fae5a',
  exitLocked: '#c23a3a',
  entrance: '#9aa3ad',
  altar: '#d8c9a0',
  chest: '#d9a15c',
  pouch: '#c88a4e',
  pouchBoss: '#ffd75e',
  pouchMine: '#7fbfff',
  trap: '#7d5cff',
  heading: '#9fe870',
} as const;
const CARDINALS: [number, string][] = [[0, 'N'], [90, 'E'], [180, 'S'], [270, 'W']];
const LOCK_PLAYER = 'player'; // Loot.PLAYER_OWNER 와 같은 값 — 내가 놓은 보관 주머니

export class Compass {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;

  constructor(
    private readonly aw: Awareness,
    /** 미니맵의 안개 기억 — 이 자리를 본 적이 있는가 */
    private readonly isRevealed: (x: number, z: number) => boolean,
  ) {
    const cfg = balance.hud.compass;
    this.canvas = document.createElement('canvas');
    this.canvas.width = cfg.widthPx;
    this.canvas.height = cfg.heightPx;
    this.canvas.id = 'compass';
    this.canvas.style.cssText =
      `position:fixed;top:8px;left:50%;transform:translateX(-50%);width:${cfg.widthPx}px;height:${cfg.heightPx}px;` +
      'pointer-events:none;user-select:none;z-index:2;';
    document.body.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
  }

  /** 매 프레임 — 표식을 모아 띠에 그린다. hits 는 main 의 월드 고정 피격 마커 */
  update(world: World, hits: { x: number; z: number; bornMs: number }[]): void {
    const hidden = world.dead || world.cleared || (world.uiOpen && !world.lootOpen);
    this.canvas.style.display = hidden ? 'none' : 'block';
    if (hidden) return;
    const cfg = balance.hud.compass;
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const p = world.player;
    const now = performance.now();
    const halfArc = ((cfg.arcDeg / 2) * Math.PI) / 180;
    const pad = 14; // 양 끝 화살촉 자리
    const usable = w / 2 - pad;
    // 세로 배치(46px): 방위 글자 7 · 눈금선 15(시선 바늘이 가로지른다) · 표식 26/34(두 줄) · 거리·이름표 41
    const bandY = 15;
    const letterY = 7;
    const markerY = bandY + 11;
    const labelY = h - 5;
    const xOf = (bearing: number): number => w / 2 + (bearing / halfArc) * usable;

    ctx.clearRect(0, 0, w, h);
    // 바탕
    ctx.fillStyle = C.bg;
    roundRect(ctx, 0.5, 0.5, w - 1, h - 1, 6);
    ctx.fill();
    ctx.strokeStyle = C.border;
    ctx.lineWidth = 1;
    ctx.stroke();

    // 눈금·방위 — 방위각 θ(N=0, E=90)의 상대 방위 = θ + yaw (정면 f=(-sin yaw, -cos yaw), N=-z)
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let deg = 0; deg < 360; deg += cfg.tickEveryDeg) {
      const rel = wrap((deg * Math.PI) / 180 + p.yaw);
      if (Math.abs(rel) > halfArc) continue;
      const x = xOf(rel);
      const major = deg % cfg.majorEveryDeg === 0;
      ctx.strokeStyle = major ? C.major : C.tick;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, bandY - (major ? 5 : 3));
      ctx.lineTo(x, bandY + (major ? 5 : 3));
      ctx.stroke();
    }
    ctx.font = 'bold 10px monospace';
    ctx.fillStyle = C.text;
    for (const [deg, letter] of CARDINALS) {
      const rel = wrap((deg * Math.PI) / 180 + p.yaw);
      if (Math.abs(rel) > halfArc) continue;
      ctx.fillText(letter, xOf(rel), letterY);
    }
    // 시선 — 눈금선을 가로지르는 초록 바늘 (글자·표식 줄은 건드리지 않는다)
    ctx.strokeStyle = C.heading;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(w / 2, bandY - 7);
    ctx.lineTo(w / 2, bandY + 7);
    ctx.stroke();

    // ---- 표식 수집 ----
    const markers: Marker[] = [];
    const bearingTo = (x: number, z: number): number => {
      const dx = x - p.x;
      const dz = z - p.z;
      const fx = -Math.sin(p.yaw);
      const fz = -Math.cos(p.yaw);
      return Math.atan2(-dx * fz + dz * fx, dx * fx + dz * fz);
    };
    const distTo = (x: number, z: number): number => Math.hypot(x - p.x, z - p.z);
    const god = world.godMode === true;

    // 목표 — 본 것만. 출구는 쇠창살이 열리면(층 주인 사망) 항상
    const level = world.level;
    if (level.exitPos && (world.exitOpen || this.isRevealed(level.exitPos.x, level.exitPos.z))) {
      const locked = world.exitNeedsKey;
      markers.push({
        bearing: bearingTo(level.exitPos.x, level.exitPos.z), dist: distTo(level.exitPos.x, level.exitPos.z),
        shape: locked ? 'bars' : 'x', color: locked ? C.exitLocked : C.exit, size: 7, alpha: 1, priority: 4,
        name: locked ? '출구 (봉인)' : '출구', showDist: true,
      });
    }
    if (world.canAscend) {
      markers.push({
        bearing: bearingTo(level.spawn.x, level.spawn.z), dist: distTo(level.spawn.x, level.spawn.z),
        shape: 'triangle', color: C.entrance, size: 6, alpha: 0.9, priority: 5, name: '입구 (위층)', showDist: true,
      });
    }
    if (level.altarPos && this.isRevealed(level.altarPos.x, level.altarPos.z)) {
      markers.push({
        bearing: bearingTo(level.altarPos.x, level.altarPos.z), dist: distTo(level.altarPos.x, level.altarPos.z),
        shape: 'square', color: C.altar, size: 6, alpha: 1, priority: 4, name: '제단', showDist: true,
      });
    }
    for (const chest of world.chests) {
      if (chest.opened && (chest.chestItems?.length ?? 0) === 0) continue;
      if (!this.isRevealed(chest.x, chest.z)) continue;
      markers.push({
        bearing: bearingTo(chest.x, chest.z), dist: distTo(chest.x, chest.z),
        shape: 'diamond', color: C.chest, size: 6, alpha: 1, priority: 5, name: '보물상자', showDist: true,
      });
    }
    // 전리품 — 가까운 미루팅 주머니
    let lootCount = 0;
    for (const g of world.groundItems) {
      if (g.kind !== 'pouch' || (g.noMagnetTicks ?? 0) > 0) continue;
      const d = distTo(g.x, g.z);
      if (d > cfg.loot.radiusM || lootCount >= cfg.loot.maxCount) continue;
      lootCount++;
      const mine = g.pouchOwner === LOCK_PLAYER;
      markers.push({
        bearing: bearingTo(g.x, g.z), dist: d, shape: 'circle',
        color: mine ? C.pouchMine : g.pouchTier === 'boss' ? C.pouchBoss : C.pouch, size: 4.5, alpha: 0.95, priority: 6,
        name: mine ? '내 주머니' : g.pouchOwner ? `${enemyDef(g.pouchOwner).name ?? '전리품'}의 주머니` : '전리품 주머니', showDist: false,
      });
    }
    // 감지한 함정 — 함정 감지 각인이 밝힌 것만
    if (world.modifiers.revealTrapsRadius > 0) {
      for (const t of world.traps) {
        if (!t.revealed || t.phase === 'spent' || t.phase === 'disarmed') continue;
        const d = distTo(t.x, t.z);
        if (d > cfg.trapRadiusM) continue;
        markers.push({ bearing: bearingTo(t.x, t.z), dist: d, shape: 'triangle', color: C.trap, size: 5, alpha: 0.9, priority: 7, name: '함정', showDist: false });
      }
    }
    // 위협 — 미니맵과 같은 조건(시야 안 또는 전투 추적). 가까울수록 크고 밝게, 락온은 마름모
    const threats: Marker[] = [];
    for (const e of world.enemies) {
      if (!e.alive) continue;
      const a = this.aw.threatAlpha(e, p, level, god, now);
      if (a === null) continue;
      const d = distTo(e.x, e.z);
      const t = Math.min(1, Math.max(0, (d - cfg.threat.nearM) / (cfg.threat.farM - cfg.threat.nearM)));
      const scale = cfg.threat.nearScale + (cfg.threat.farScale - cfg.threat.nearScale) * t;
      const locked = world.lockOnId === e.id;
      threats.push({
        bearing: bearingTo(e.x, e.z), dist: d, shape: locked ? 'diamond' : 'circle',
        color: e.ai === 'idle' ? C.threatIdle : C.threat, size: (locked ? 6 : 4.5) * scale, alpha: a, priority: locked ? 0 : 1,
        name: enemyDef(e.type).name ?? e.type, showDist: false, ring: d <= cfg.threat.nearM,
      });
    }
    threats.sort((m1, m2) => m1.dist - m2.dist);
    markers.push(...threats.slice(0, cfg.threat.maxCount));
    // 피격 방향 — 붉은 쐐기, 마커 수명 따라 옅어진다
    const hm = balance.hitMarker;
    for (const hit of hits) {
      const age = now - hit.bornMs;
      if (age > hm.lifeMs) continue;
      const alpha = age < hm.holdMs ? 1 : 1 - (age - hm.holdMs) / (hm.lifeMs - hm.holdMs);
      markers.push({ bearing: bearingTo(hit.x, hit.z), dist: distTo(hit.x, hit.z), shape: 'wedge', color: C.threat, size: 7, alpha, priority: 2, name: '', showDist: false });
    }
    // 소리 핑
    this.aw.prunePings(now);
    if (!god) {
      for (const ping of this.aw.pings) {
        const alpha = 1 - (now - ping.bornMs) / balance.minimap.pingMs;
        markers.push({ bearing: bearingTo(ping.x, ping.z), dist: distTo(ping.x, ping.z), shape: 'circle', color: C.ping, size: 3, alpha, priority: 3, name: '', showDist: false });
      }
    }

    // ---- 그리기 — 우선순위 낮은 것부터(높은 것이 위에). 겹치면 두 번째 줄로 ----
    markers.sort((a, b) => b.priority - a.priority);
    const placed: { x: number; row: number }[] = [];
    for (const m of markers) {
      ctx.globalAlpha = Math.max(0, Math.min(1, m.alpha));
      if (Math.abs(m.bearing) > halfArc) {
        if (!cfg.edgeChevron) continue;
        // 띠 밖 — 양 끝 화살촉 (뒤에 있다)
        const right = m.bearing > 0;
        const x = right ? w - 7 : 7;
        ctx.fillStyle = m.color;
        ctx.globalAlpha *= 0.7;
        ctx.beginPath();
        ctx.moveTo(x + (right ? 3 : -3), markerY);
        ctx.lineTo(x - (right ? 3 : -3), markerY - 5);
        ctx.lineTo(x - (right ? 3 : -3), markerY + 5);
        ctx.closePath();
        ctx.fill();
        continue;
      }
      const x = xOf(m.bearing);
      // 같은 자리에 겹치면 한 줄 아래로 (두 줄까지)
      const row = placed.some((q) => Math.abs(q.x - x) < 8 && q.row === 0) ? 1 : 0;
      placed.push({ x, row });
      const y = markerY + row * 8;
      drawShape(ctx, m.shape, x, y, m.size, m.color);
      if (m.ring) {
        // 코앞 위협 — 고리가 숨 쉰다
        ctx.strokeStyle = m.color;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(x, y, m.size + 3 + 1.5 * Math.sin(now / 120), 0, Math.PI * 2);
        ctx.stroke();
      }
      if (m.showDist && row === 0) {
        ctx.fillStyle = C.dim;
        ctx.font = '9px monospace';
        ctx.fillText(`${Math.round(m.dist)}m`, x, labelY);
      }
    }
    ctx.globalAlpha = 1;

    // 정면 이름표 — 중앙 ±centerLabelDeg 안에 든 표식 하나(우선순위 높은 것)
    const centerRad = (cfg.centerLabelDeg * Math.PI) / 180;
    const center = markers
      .filter((m) => m.name && Math.abs(m.bearing) <= centerRad)
      .sort((a, b) => a.priority - b.priority || a.dist - b.dist)[0];
    if (center) {
      ctx.font = 'bold 10px monospace';
      ctx.fillStyle = center.color;
      const label = center.showDist ? `${center.name} ${Math.round(center.dist)}m` : center.name;
      // 이름표 자리를 비우고 쓴다 — 거리 숫자와 겹치지 않게
      ctx.fillStyle = C.bg;
      ctx.fillRect(w / 2 - 60, labelY - 6, 120, 12);
      ctx.fillStyle = center.color;
      ctx.fillText(label, w / 2, labelY);
    }
  }
}

function wrap(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawShape(ctx: CanvasRenderingContext2D, shape: Shape, x: number, y: number, s: number, color: string): void {
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  switch (shape) {
    case 'circle':
      ctx.arc(x, y, s, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'square':
      ctx.fillRect(x - s, y - s, s * 2, s * 2);
      break;
    case 'diamond':
      ctx.moveTo(x, y - s);
      ctx.lineTo(x + s, y);
      ctx.lineTo(x, y + s);
      ctx.lineTo(x - s, y);
      ctx.closePath();
      ctx.fill();
      break;
    case 'triangle':
      ctx.moveTo(x, y - s);
      ctx.lineTo(x + s, y + s);
      ctx.lineTo(x - s, y + s);
      ctx.closePath();
      ctx.fill();
      break;
    case 'x':
      ctx.moveTo(x - s, y - s);
      ctx.lineTo(x + s, y + s);
      ctx.moveTo(x + s, y - s);
      ctx.lineTo(x - s, y + s);
      ctx.stroke();
      break;
    case 'bars':
      for (let i = -1; i <= 1; i++) {
        ctx.moveTo(x + i * (s * 0.7), y - s);
        ctx.lineTo(x + i * (s * 0.7), y + s);
      }
      ctx.stroke();
      break;
    case 'wedge':
      ctx.moveTo(x, y - s);
      ctx.lineTo(x + s * 0.8, y + s * 0.6);
      ctx.lineTo(x - s * 0.8, y + s * 0.6);
      ctx.closePath();
      ctx.fill();
      break;
  }
}
