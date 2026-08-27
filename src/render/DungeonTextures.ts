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

// 손으로 깎아 쌓은 난석조 — 돌 크기가 제각각이라야 중세로 읽힌다.
// 똑같은 벽돌이 반 칸씩 정확히 엇갈리면 기계로 찍은 현대 벽돌이 된다.
// 512px = 4m 기준이므로 아래 값은 0.8m ~ 1.7m 짜리 돌덩이다
const BLOCK_W_MIN = 100;
const BLOCK_W_MAX = 220;
const COURSE_H_MIN = 62;
const COURSE_H_MAX = 108;
/** 줄눈 — 두께가 일정하지 않아야 손으로 바른 것으로 보인다 */
const MORTAR_MIN = 4;
const MORTAR_MAX = 9;
/** 모서리가 흔들리는 정도 — 직각이면 잘라 낸 타일처럼 보인다 */
const EDGE_JITTER = 3.5;

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

/** total 을 min~max 짜리 조각으로 쪼갠다 — 합은 정확히 total 이라 이음매가 맞는다.
 *  돌 너비·켜 높이를 여기서 뽑는다 (같은 크기가 반복되지 않게) */
function partition(total: number, min: number, max: number): number[] {
  const out: number[] = [];
  let left = total;
  while (left > 0) {
    let w = min + Math.random() * (max - min);
    if (left - w < min || w > left) w = left; // 남는 조각이 너무 작으면 마지막에 합친다
    out.push(w);
    left -= w;
  }
  return out;
}

/** 손으로 깎은 돌 하나의 윤곽 — 네 모서리와 네 변 가운데를 흔든다.
 *  값을 미리 뽑아 두는 이유: 이음매용 복사본들이 같은 모양이어야 한다 */
function roughOutline(w: number, h: number): [number, number][] {
  const j = (): number => (Math.random() - 0.5) * 2 * EDGE_JITTER;
  return [
    [j(), j()],
    [w / 2 + j(), j()],
    [w + j(), j()],
    [w + j(), h / 2 + j()],
    [w + j(), h + j()],
    [w / 2 + j(), h + j()],
    [j(), h + j()],
    [j(), h / 2 + j()],
  ];
}

function outlinePath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  pts: [number, number][],
): void {
  ctx.beginPath();
  ctx.moveTo(x + pts[0]![0], y + pts[0]![1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(x + pts[i]![0], y + pts[i]![1]);
  ctx.closePath();
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

let crackedTex: THREE.CanvasTexture | null = null;
/** 깨진 벽 — 벽 텍스처 위에 굵은 금이 사방으로 뻗고 조각이 떨어져 나갔다.
 *  "여긴 부술 수 있다" 가 한눈에 읽혀야 한다 */
export function crackedWallTexture(): THREE.CanvasTexture {
  if (crackedTex) return crackedTex;
  const size = WALL_SIZE;
  const { cv, ctx } = canvas(size);
  ctx.drawImage(dungeonWallTexture().image as HTMLCanvasElement, 0, 0);

  // 굵은 금 — 가운데 즈음에서 사방으로 가지 치며 뻗는다
  const cx = size * (0.42 + Math.random() * 0.16);
  const cy = size * (0.38 + Math.random() * 0.2);
  const vein = (x: number, y: number, ang: number, len: number, w: number): void => {
    ctx.strokeStyle = gray(26, 0.92);
    ctx.lineWidth = w;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x, y);
    let px = x;
    let py = y;
    const steps = 6;
    for (let i = 0; i < steps; i++) {
      ang += (Math.random() - 0.5) * 0.9;
      px += Math.cos(ang) * (len / steps);
      py += Math.sin(ang) * (len / steps);
      ctx.lineTo(px, py);
    }
    ctx.stroke();
    // 가지 — 절반쯤에서 한 갈래
    if (w > 3) vein(px, py, ang + (Math.random() < 0.5 ? 1 : -1) * 0.9, len * 0.45, w * 0.55);
  };
  for (let i = 0; i < 6; i++) {
    vein(cx, cy, (i / 6) * Math.PI * 2 + Math.random() * 0.5, size * (0.3 + Math.random() * 0.25), 7);
  }
  // 폭심 — 조각이 떨어져 나가 어둡게 파인 자리
  const hole = ctx.createRadialGradient(cx, cy, 0, cx, cy, size * 0.13);
  hole.addColorStop(0, gray(30, 0.9));
  hole.addColorStop(1, gray(60, 0));
  ctx.fillStyle = hole;
  ctx.fillRect(0, 0, size, size);
  // 금 가장자리 하이라이트 조각 — 균열이 도드라져 보인다
  for (let i = 0; i < 26; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = size * (0.06 + Math.random() * 0.34);
    ctx.fillStyle = gray(240, 0.25 + Math.random() * 0.2);
    ctx.fillRect(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 3 + Math.random() * 5, 2 + Math.random() * 3);
  }
  crackedTex = finish(cv, 'dungeon-cracked-wall');
  return crackedTex;
}

let wallTex: THREE.CanvasTexture | null = null;
/** 벽 — 중세 지하 감옥. 손으로 깎아 쌓은 난석조 위로 물때가 흘러내리고 아래가 젖어 있다.
 *  켜(가로줄)마다 높이가 다르고 돌 너비도 제각각이며, 켜마다 시작점을 어긋나게 잡아
 *  세로 줄눈이 한 줄로 서지 않는다 — 이 불규칙이 "기계 벽돌"과 "손으로 쌓은 벽"을 가른다 */
export function dungeonWallTexture(): THREE.CanvasTexture {
  if (wallTex) return wallTex;
  const size = WALL_SIZE;
  const { cv, ctx } = canvas(size);

  // 줄눈 색으로 바탕을 깔고 그 위에 돌을 얹는다 — 돌 사이 틈이 저절로 줄눈이 된다
  ctx.fillStyle = gray(148);
  ctx.fillRect(0, 0, size, size);

  let y = 0;
  for (const courseH of partition(size, COURSE_H_MIN, COURSE_H_MAX)) {
    // 켜마다 시작점을 아무 데나 — 세로 줄눈이 위아래로 이어지면 격자로 보인다
    let x = -Math.random() * BLOCK_W_MAX;
    for (const blockW of partition(size + BLOCK_W_MAX, BLOCK_W_MIN, BLOCK_W_MAX)) {
      const mx = MORTAR_MIN + Math.random() * (MORTAR_MAX - MORTAR_MIN);
      const my = MORTAR_MIN + Math.random() * (MORTAR_MAX - MORTAR_MIN);
      const bw = blockW - mx;
      const bh = courseH - my;
      const bx = x + mx / 2;
      const by = y + my / 2;
      const pts = roughOutline(bw, bh);
      // 돌마다 밝기가 다르다. 가끔 눈에 띄게 어두운 돌 하나 — 다른 데서 가져다 끼운 돌
      const tone = Math.random() < 0.12 ? 190 + Math.random() * 22 : 224 + Math.random() * 30;

      ctx.fillStyle = gray(tone);
      wrapped(size, (ox) => {
        outlinePath(ctx, bx + ox, by, pts);
        ctx.fill();
      }, false);

      // 위 모서리에 빛, 아래에 그늘 — 쌓인 돌이 튀어나와 보인다
      ctx.strokeStyle = gray(255, 0.3);
      ctx.lineWidth = 2;
      wrapped(size, (ox) => {
        ctx.beginPath();
        ctx.moveTo(bx + ox + pts[0]![0], by + pts[0]![1]);
        ctx.lineTo(bx + ox + pts[1]![0], by + pts[1]![1]);
        ctx.lineTo(bx + ox + pts[2]![0], by + pts[2]![1]);
        ctx.stroke();
      }, false);
      ctx.strokeStyle = gray(112, 0.32);
      wrapped(size, (ox) => {
        ctx.beginPath();
        ctx.moveTo(bx + ox + pts[4]![0], by + pts[4]![1]);
        ctx.lineTo(bx + ox + pts[5]![0], by + pts[5]![1]);
        ctx.lineTo(bx + ox + pts[6]![0], by + pts[6]![1]);
        ctx.stroke();
      }, false);

      // 정끌 자국 — 손으로 깎은 면에는 나란한 사선 흠이 남는다
      const chisels = 3 + Math.floor(Math.random() * 5);
      const ang = -0.5 - Math.random() * 0.5;
      ctx.strokeStyle = gray(178, 0.22);
      ctx.lineWidth = 1;
      for (let i = 0; i < chisels; i++) {
        const cx0 = bx + 6 + Math.random() * (bw - 12);
        const cy0 = by + 6 + Math.random() * (bh - 12);
        const len = 6 + Math.random() * 16;
        wrapped(size, (ox) => {
          ctx.beginPath();
          ctx.moveTo(cx0 + ox, cy0);
          ctx.lineTo(cx0 + ox + Math.cos(ang) * len, cy0 + Math.sin(ang) * len);
          ctx.stroke();
        }, false);
      }

      // 닳아 떨어져 나간 귀퉁이 — 오래된 벽일수록 모서리가 성하지 않다
      if (Math.random() < 0.35) {
        const cw = 8 + Math.random() * 18;
        const cx = Math.random() < 0.5 ? bx : bx + bw - cw;
        const cy = Math.random() < 0.5 ? by : by + bh - cw * 0.7;
        ctx.fillStyle = gray(158, 0.8);
        wrapped(size, (ox) => {
          ctx.beginPath();
          ctx.moveTo(cx + ox, cy);
          ctx.lineTo(cx + ox + cw, cy + cw * 0.25);
          ctx.lineTo(cx + ox + cw * 0.4, cy + cw * 0.7);
          ctx.closePath();
          ctx.fill();
        }, false);
      }

      // 곰보 — 표면이 패인 자국 몇 점
      if (Math.random() < 0.5) {
        const pits = 3 + Math.floor(Math.random() * 6);
        for (let i = 0; i < pits; i++) {
          const px = bx + 5 + Math.random() * (bw - 10);
          const py = by + 5 + Math.random() * (bh - 10);
          const pr = 1 + Math.random() * 2.6;
          ctx.fillStyle = gray(160, 0.3 + Math.random() * 0.3);
          wrapped(size, (ox) => {
            ctx.beginPath();
            ctx.arc(px + ox, py, pr, 0, Math.PI * 2);
            ctx.fill();
          }, false);
        }
      }

      x += blockW;
      if (x > size) break;
    }
    y += courseH;
  }

  // 이끼·검댕 — 줄눈을 타고 번진 얼룩. 돌 경계를 무시하고 덮여야 세월이 얹힌다
  for (let i = 0; i < 12; i++) {
    const bx = Math.random() * size;
    const by = Math.random() * size;
    const br = 20 + Math.random() * 60;
    const v = 120 + Math.random() * 50;
    const ry = br * (0.5 + Math.random() * 0.6); // 복사본이 같은 모양이어야 이음매가 맞는다
    ctx.fillStyle = gray(v, 0.1 + Math.random() * 0.14);
    wrapped(size, (ox, oy) => {
      ctx.beginPath();
      ctx.ellipse(bx + ox, by + oy, br, ry, 0, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  // 물때 — 위에서 아래로 흘러내린 자국. 길이가 제각각이라 벽이 균일해 보이지 않는다
  for (let i = 0; i < 9; i++) {
    const x0 = Math.random() * size;
    const w = 6 + Math.random() * 26;
    const top = Math.random() * size * 0.35;
    const bottom = top + size * (0.3 + Math.random() * 0.6);
    const streak = ctx.createLinearGradient(0, top, 0, bottom);
    streak.addColorStop(0, gray(110, 0));
    streak.addColorStop(0.25, gray(110, 0.2 + Math.random() * 0.14));
    streak.addColorStop(1, gray(95, 0));
    ctx.fillStyle = streak;
    wrapped(size, (ox) => ctx.fillRect(x0 + ox, top, w, bottom - top), false);
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
/** 바닥 — 밟아 닳은 판석. 벽과 같은 이유로 격자를 버렸다: 줄마다 높이가 다르고
 *  판석 너비도 제각각이며, 줄마다 시작점을 어긋나게 잡는다.
 *  양방향으로 반복되므로 가로·세로 모두 감아 그린다 */
export function dungeonFloorTexture(): THREE.CanvasTexture {
  if (floorTex) return floorTex;
  const size = FLOOR_SIZE;
  const { cv, ctx } = canvas(size);

  ctx.fillStyle = gray(138); // 틈새 — 흙과 모래가 낀 자리
  ctx.fillRect(0, 0, size, size);

  let y = 0;
  for (const rowH of partition(size, 84, 148)) {
    let x = -Math.random() * 170;
    for (const stoneW of partition(size + 170, 88, 170)) {
      const mx = 5 + Math.random() * 6;
      const my = 5 + Math.random() * 6;
      const sw = stoneW - mx;
      const sh = rowH - my;
      const sx = x + mx / 2;
      const sy = y + my / 2;
      const pts = roughOutline(sw, sh);
      ctx.fillStyle = gray(210 + Math.random() * 38);
      wrapped(size, (ox, oy) => {
        outlinePath(ctx, sx + ox, sy + oy, pts);
        ctx.fill();
      });

      // 가운데가 옴폭 — 오래 밟힌 판석은 가운데가 닳아 어둡다
      if (Math.random() < 0.55) {
        const wx = sx + sw / 2 + (Math.random() - 0.5) * sw * 0.3;
        const wy = sy + sh / 2 + (Math.random() - 0.5) * sh * 0.3;
        const wr = Math.min(sw, sh) * (0.3 + Math.random() * 0.25);
        wrapped(size, (ox, oy) => {
          const hollow = ctx.createRadialGradient(wx + ox, wy + oy, 0, wx + ox, wy + oy, wr);
          hollow.addColorStop(0, gray(175, 0.35));
          hollow.addColorStop(1, gray(175, 0));
          ctx.fillStyle = hollow;
          ctx.beginPath();
          ctx.arc(wx + ox, wy + oy, wr, 0, Math.PI * 2);
          ctx.fill();
        });
      }

      // 금 — 한쪽 끝에서 다른 끝까지 꺾이며 간다.
      // 경로를 미리 뽑아 둔다: 이음매용 복사본이 같은 길을 가야 한다
      if (Math.random() < 0.32) {
        const steps = 4;
        const crack: [number, number][] = [];
        let cx = sx + 6 + Math.random() * (sw - 12);
        let cy = sy + 4;
        crack.push([cx, cy]);
        for (let k = 0; k < steps; k++) {
          cx += (Math.random() - 0.5) * 26;
          cy += (sh - 8) / steps;
          crack.push([cx, cy]);
        }
        ctx.strokeStyle = gray(146, 0.7);
        ctx.lineWidth = 1.4 + Math.random();
        wrapped(size, (ox, oy) => {
          ctx.beginPath();
          ctx.moveTo(crack[0]![0] + ox, crack[0]![1] + oy);
          for (let k = 1; k < crack.length; k++) ctx.lineTo(crack[k]![0] + ox, crack[k]![1] + oy);
          ctx.stroke();
        });
      }

      x += stoneW;
      if (x > size) break;
    }
    y += rowH;
  }

  speckle(ctx, size, 1500, 125, 220, 0.35, 1.8);

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
  // 깎아 낸 자국 — 천장도 사람이 파 내려간 곳이다. 짧은 사선이 무리 지어 남는다
  for (let g = 0; g < 10; g++) {
    const gx = Math.random() * size;
    const gy = Math.random() * size;
    const ang = Math.random() * Math.PI * 2;
    const n = 3 + Math.floor(Math.random() * 4);
    ctx.strokeStyle = gray(165, 0.28);
    ctx.lineWidth = 1.2;
    for (let i = 0; i < n; i++) {
      const off = i * (4 + Math.random() * 3);
      const len = 10 + Math.random() * 18;
      const px = gx + Math.cos(ang + Math.PI / 2) * off;
      const py = gy + Math.sin(ang + Math.PI / 2) * off;
      wrapped(size, (ox, oy) => {
        ctx.beginPath();
        ctx.moveTo(px + ox, py + oy);
        ctx.lineTo(px + ox + Math.cos(ang) * len, py + oy + Math.sin(ang) * len);
        ctx.stroke();
      });
    }
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
