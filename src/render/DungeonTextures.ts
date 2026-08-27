// 던전 표면 텍스처 — 캔버스로 절차 생성한다. 외부 에셋은 쓰지 않는다 (CLAUDE.md 규칙 6).
//
// 전부 **회색조**로 굽는다. 색은 머티리얼의 color 가 곱해서 낸다 —
// 그래야 문(갈색)·관문(청록)·균열 벽(회청)의 색 구분이 텍스처에 먹히지 않고 그대로 남는다.
// 그래서 밝은 쪽(돌 면)은 흰색에 가깝게, 어두운 쪽(줄눈·물때)만 눌러 놓는다.
// 곱셈이라 어느 값이든 원래 색보다 어두워지기만 한다.
//
// 타일 규약 — 벽은 셀 하나가 4×4m 면이고 UV 가 면당 0~1 이라 텍스처 한 장이 벽 한 칸이다.
// 세로로는 반복하지 않으므로(아래가 곧 바닥) 물때 띠를 아래에 깔 수 있다.
// 가로로는 옆 칸과 이어져야 해서 벽돌·얼룩을 x 방향으로 감아 그린다.
// 바닥·천장은 큰 평면 하나라 repeat 로 셀 수만큼 반복한다 — 양방향 모두 이어져야 한다.

import * as THREE from 'three';

const WALL_SIZE = 512;
const FLOOR_SIZE = 512;
const CEILING_SIZE = 256;

/** 벽돌 한 장 — 4장이 한 줄, 8줄이 한 면 (4m 벽 기준 1m × 0.5m) */
const BRICK_W = 128;
const BRICK_H = 64;
const MORTAR = 5;

function canvas(size: number): { cv: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const cv = document.createElement('canvas');
  cv.width = size;
  cv.height = size;
  return { cv, ctx: cv.getContext('2d')! };
}

/** 회색조 채우기 — 0~255 를 그대로 rgb 세 채널에 넣는다 */
function gray(v: number, alpha = 1): string {
  const c = Math.max(0, Math.min(255, Math.round(v)));
  return `rgba(${c},${c},${c},${alpha})`;
}

/** 가장자리를 넘어가는 그림을 반대편에도 찍어 이음매를 맞춘다.
 *  세로 반복이 필요 없는 벽은 wrapY 를 꺼서 아래 물때 띠가 위로 새지 않게 한다 */
function wrapped(
  size: number,
  draw: (ox: number, oy: number) => void,
  wrapY = true,
): void {
  const ys = wrapY ? [-size, 0, size] : [0];
  for (const ox of [-size, 0, size]) for (const oy of ys) draw(ox, oy);
}

/** 잡티 — 표면이 균일하지 않게 점을 흩뿌린다 */
function speckle(
  ctx: CanvasRenderingContext2D,
  size: number,
  count: number,
  minV: number,
  maxV: number,
  maxAlpha: number,
  maxR: number,
): void {
  for (let i = 0; i < count; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = 0.4 + Math.random() * maxR;
    ctx.fillStyle = gray(minV + Math.random() * (maxV - minV), Math.random() * maxAlpha);
    wrapped(size, (ox, oy) => {
      ctx.beginPath();
      ctx.arc(x + ox, y + oy, r, 0, Math.PI * 2);
      ctx.fill();
    });
  }
}

let wallTex: THREE.CanvasTexture | null = null;
/** 벽 — 습한 지하 감옥. 벽돌 위로 물때가 세로로 흘러내리고 바닥 쪽이 짙게 젖어 있다 */
export function dungeonWallTexture(): THREE.CanvasTexture {
  if (wallTex) return wallTex;
  const size = WALL_SIZE;
  const { cv, ctx } = canvas(size);

  // 줄눈 색으로 바탕을 깔고 그 위에 벽돌을 얹는다 — 벽돌 사이 틈이 저절로 줄눈이 된다
  ctx.fillStyle = gray(150);
  ctx.fillRect(0, 0, size, size);

  const rows = size / BRICK_H;
  for (let row = 0; row < rows; row++) {
    const y = row * BRICK_H;
    const offset = row % 2 === 0 ? 0 : BRICK_W / 2; // 한 줄씩 엇갈려 쌓는다
    for (let i = 0; i < size / BRICK_W; i++) {
      const x = i * BRICK_W + offset;
      // 벽돌마다 밝기를 미세하게 달리한다 — 같은 돌이 반복돼 보이지 않게
      const tone = 226 + Math.random() * 28;
      ctx.fillStyle = gray(tone);
      wrapped(
        size,
        (ox) => {
          ctx.fillRect(
            x + MORTAR / 2 + ox,
            y + MORTAR / 2,
            BRICK_W - MORTAR,
            BRICK_H - MORTAR,
          );
        },
        false,
      );
      // 위쪽 모서리에 옅은 빛, 아래쪽에 그늘 — 벽돌이 튀어나와 보인다
      ctx.fillStyle = gray(255, 0.35);
      wrapped(size, (ox) => ctx.fillRect(x + MORTAR / 2 + ox, y + MORTAR / 2, BRICK_W - MORTAR, 2), false);
      ctx.fillStyle = gray(120, 0.3);
      wrapped(size, (ox) => ctx.fillRect(x + MORTAR / 2 + ox, y + BRICK_H - MORTAR / 2 - 2, BRICK_W - MORTAR, 2), false);
      // 이 빠진 모서리 — 가끔 한 귀퉁이가 떨어져 나갔다
      if (Math.random() < 0.22) {
        const cw = 6 + Math.random() * 14;
        const cx = Math.random() < 0.5 ? x + MORTAR / 2 : x + BRICK_W - MORTAR / 2 - cw;
        const cy = Math.random() < 0.5 ? y + MORTAR / 2 : y + BRICK_H - MORTAR / 2 - cw * 0.6;
        ctx.fillStyle = gray(160, 0.85);
        wrapped(size, (ox) => ctx.fillRect(cx + ox, cy, cw, cw * 0.6), false);
      }
    }
  }

  // 물때 — 위에서 아래로 흘러내린 자국. 길이가 제각각이라 벽이 균일해 보이지 않는다
  for (let i = 0; i < 9; i++) {
    const x = Math.random() * size;
    const w = 6 + Math.random() * 26;
    const top = Math.random() * size * 0.35;
    const bottom = top + size * (0.3 + Math.random() * 0.6);
    const streak = ctx.createLinearGradient(0, top, 0, bottom);
    streak.addColorStop(0, gray(110, 0));
    streak.addColorStop(0.25, gray(110, 0.22 + Math.random() * 0.16));
    streak.addColorStop(1, gray(95, 0));
    ctx.fillStyle = streak;
    wrapped(size, (ox) => ctx.fillRect(x + ox, top, w, bottom - top), false);
  }

  // 바닥 쪽 습기 띠 — 아래로 갈수록 짙게 젖는다. 세로로 반복하지 않으므로 여기만 어둡다
  const damp = ctx.createLinearGradient(0, size * 0.62, 0, size);
  damp.addColorStop(0, gray(90, 0));
  damp.addColorStop(1, gray(85, 0.34));
  ctx.fillStyle = damp;
  ctx.fillRect(0, size * 0.62, size, size * 0.38);

  speckle(ctx, size, 900, 120, 215, 0.3, 1.5);

  wallTex = finish(cv, 'dungeon-wall');
  return wallTex;
}

let floorTex: THREE.CanvasTexture | null = null;
/** 바닥 — 판석. 큼직한 사각 넷씩 열여섯 장에 틈새 모래가 낀다 */
export function dungeonFloorTexture(): THREE.CanvasTexture {
  if (floorTex) return floorTex;
  const size = FLOOR_SIZE;
  const { cv, ctx } = canvas(size);
  const stone = size / 4; // 4m 셀 안에 1m 판석 열여섯 장
  const gap = 7;

  ctx.fillStyle = gray(140); // 틈새
  ctx.fillRect(0, 0, size, size);

  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      const x = c * stone;
      const y = r * stone;
      ctx.fillStyle = gray(214 + Math.random() * 34);
      ctx.fillRect(x + gap / 2, y + gap / 2, stone - gap, stone - gap);
      // 판석마다 결 — 옅은 줄 몇 개
      const lines = 2 + Math.floor(Math.random() * 3);
      for (let i = 0; i < lines; i++) {
        ctx.strokeStyle = gray(180, 0.25);
        ctx.lineWidth = 1;
        ctx.beginPath();
        const gy = y + gap + Math.random() * (stone - gap * 2);
        ctx.moveTo(x + gap, gy);
        ctx.lineTo(x + stone - gap, gy + (Math.random() - 0.5) * 10);
        ctx.stroke();
      }
      // 가끔 금이 간 판석
      if (Math.random() < 0.3) {
        ctx.strokeStyle = gray(150, 0.7);
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        let px = x + gap + Math.random() * (stone - gap * 2);
        let py = y + gap;
        ctx.moveTo(px, py);
        for (let s = 0; s < 4; s++) {
          px += (Math.random() - 0.5) * 26;
          py += (stone - gap * 2) / 4;
          ctx.lineTo(px, py);
        }
        ctx.stroke();
      }
    }
  }

  speckle(ctx, size, 1400, 130, 220, 0.35, 1.6);

  floorTex = finish(cv, 'dungeon-floor');
  return floorTex;
}

let ceilingTex: THREE.CanvasTexture | null = null;
/** 천장 — 다듬지 않은 암반. 규칙적인 선이 없어야 "위는 그냥 바위"로 읽힌다 */
export function dungeonCeilingTexture(): THREE.CanvasTexture {
  if (ceilingTex) return ceilingTex;
  const size = CEILING_SIZE;
  const { cv, ctx } = canvas(size);
  ctx.fillStyle = gray(228);
  ctx.fillRect(0, 0, size, size);

  // 덩어리 얼룩 — 큰 것부터 작은 것까지 겹쳐 바위 결을 만든다
  for (let i = 0; i < 70; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = 8 + Math.random() * 46;
    const v = 150 + Math.random() * 80;
    wrapped(size, (ox, oy) => {
      const blob = ctx.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
      blob.addColorStop(0, gray(v, 0.3));
      blob.addColorStop(1, gray(v, 0));
      ctx.fillStyle = blob;
      ctx.beginPath();
      ctx.arc(x + ox, y + oy, r, 0, Math.PI * 2);
      ctx.fill();
    });
  }
  // 갈라진 결 몇 줄 — 방향이 제각각이라 격자로 안 보인다
  for (let i = 0; i < 14; i++) {
    ctx.strokeStyle = gray(140, 0.35);
    ctx.lineWidth = 1 + Math.random();
    const x = Math.random() * size;
    const y = Math.random() * size;
    const ang = Math.random() * Math.PI * 2;
    const len = 30 + Math.random() * 90;
    wrapped(size, (ox, oy) => {
      ctx.beginPath();
      ctx.moveTo(x + ox, y + oy);
      ctx.lineTo(x + ox + Math.cos(ang) * len, y + oy + Math.sin(ang) * len);
      ctx.stroke();
    });
  }

  speckle(ctx, size, 700, 130, 210, 0.3, 1.4);

  ceilingTex = finish(cv, 'dungeon-ceiling');
  return ceilingTex;
}

/** 공통 마무리 — 반복 감기와 비스듬히 볼 때의 선명도(이방성) */
function finish(cv: HTMLCanvasElement, name: string): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(cv);
  tex.name = name;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8; // 실제 상한은 three 가 알아서 깎는다
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
