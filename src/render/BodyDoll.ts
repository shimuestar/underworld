// 몸 실루엣 — 각인(패시브) 부위 소켓 다섯 개. 가방 탭의 '몸' 패널이 그린다 (2026-09-04: 스킬 탭에서 옮겨 왔다).
// 소켓의 상태(빈 칸/새겨진 각인 색/호버)는 여기서 칠하고, 클릭·드롭·팝업은 부르는 쪽이 소켓 자리(anchors)에 덮개를 얹어 처리한다.

import { sigilDef, SIGIL_SLOTS, type SigilSlot } from '../core/SigilData';
import type { World } from '../core/World';

export const SLOT_LABELS: Record<SigilSlot, string> = {
  eye: '눈',
  rightArm: '오른팔',
  leftArm: '왼팔',
  heart: '심장',
  spine: '척추',
};

const SVG_NS = 'http://www.w3.org/2000/svg';
function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

/** 실루엣 위 소켓 자리와 이름표 자리 (정면 — 그림의 오른팔이 보는 사람의 왼쪽) */
export const BODY_ANCHORS: Record<SigilSlot, { x: number; y: number; side: 'left' | 'right'; labelY: number }> = {
  eye: { x: 180, y: 42, side: 'right', labelY: 42 },
  heart: { x: 193, y: 104, side: 'right', labelY: 96 },
  leftArm: { x: 233, y: 122, side: 'right', labelY: 140 },
  rightArm: { x: 127, y: 122, side: 'left', labelY: 122 },
  spine: { x: 180, y: 140, side: 'left', labelY: 164 },
};
export const BODY_W = 360;
export const BODY_H = 250;
const BODY_LINE = '#3a3f4a';
const BODY_FILL = '#1c1f27';

export interface BodySvgOptions {
  /** 소켓 강조 — target: 놓을 수 있다(흰 맥동) / blocked: 막힘(붉음) */
  hover?: Partial<Record<SigilSlot, 'target' | 'blocked' | 'cursor'>>;
}

/** 실루엣 SVG — 부위마다 소켓. 새겨진 각인의 색으로 그 부위 윤곽이 물들고 소켓이 빛난다 */
export function buildBodySvg(world: World, opts: BodySvgOptions = {}): { svg: SVGSVGElement; sockets: Record<SigilSlot, SVGCircleElement> } {
  const svg = svgEl('svg', { width: BODY_W, height: BODY_H, viewBox: `0 0 ${BODY_W} ${BODY_H}` });
  svg.style.cssText = 'display:block;';
  const style = svgEl('style', {});
  style.textContent =
    '.part{fill:' + BODY_FILL + ';stroke:' + BODY_LINE + ';stroke-width:2;stroke-linecap:round;stroke-linejoin:round}' +
    '.limb{fill:none;stroke:' + BODY_LINE + ';stroke-width:13;stroke-linecap:round}' +
    '.socket{fill:#10131a;stroke:#555c66;stroke-width:2;stroke-dasharray:3 3}' +
    '.socket.on{stroke-dasharray:none}' +
    '.socket[data-hover=target]{stroke:#fff;stroke-width:3;stroke-dasharray:none;animation:sockpulse .7s ease-in-out infinite alternate}' +
    '.socket[data-hover=blocked]{stroke:#e04444;stroke-width:3;stroke-dasharray:none}' +
    '.socket[data-hover=cursor]{stroke:#7fbfff;stroke-width:3}' +
    '@keyframes sockpulse{from{r:9}to{r:12}}' +
    '.lead{stroke:#3a3f4a;stroke-width:1}' +
    '.lbl{font:12px monospace;fill:#8a8f9a}' +
    '.val{font:12px monospace}';
  svg.appendChild(style);

  const tint = (slot: SigilSlot): string => {
    const id = world.sigils.equipped[slot];
    return id ? sigilDef(id).color : BODY_LINE;
  };
  const glow = (el: SVGElement, color: string): void => { el.style.filter = `drop-shadow(0 0 5px ${color})`; };

  const head = svgEl('circle', { class: 'part', cx: 180, cy: 42, r: 21 });
  const torso = svgEl('path', {
    class: 'part',
    d: 'M160,68 L200,68 Q212,68 212,82 L212,164 Q212,172 204,172 L156,172 Q148,172 148,164 L148,82 Q148,68 160,68 Z',
  });
  const rightArm = svgEl('line', { class: 'limb', x1: 152, y1: 80, x2: 126, y2: 132 });
  const leftArm = svgEl('line', { class: 'limb', x1: 208, y1: 80, x2: 234, y2: 132 });
  const legL = svgEl('line', { class: 'limb', x1: 168, y1: 176, x2: 163, y2: 238 });
  const legR = svgEl('line', { class: 'limb', x1: 192, y1: 176, x2: 197, y2: 238 });
  const spine = svgEl('line', { class: 'lead', x1: 180, y1: 74, x2: 180, y2: 166, 'stroke-dasharray': '4 3', 'stroke-width': 2 });
  for (const el of [legL, legR, rightArm, leftArm, torso, head, spine]) svg.appendChild(el);

  const partOf: Record<SigilSlot, SVGElement> = { eye: head, heart: torso, spine, rightArm, leftArm };
  for (const slot of SIGIL_SLOTS) {
    const id = world.sigils.equipped[slot];
    if (!id) continue;
    const color = tint(slot);
    partOf[slot].setAttribute('stroke', color);
    if (slot === 'heart') torso.setAttribute('fill', '#1f1a24');
    glow(partOf[slot], color);
  }

  const sockets = {} as Record<SigilSlot, SVGCircleElement>;
  for (const slot of SIGIL_SLOTS) {
    const a = BODY_ANCHORS[slot];
    const id = world.sigils.equipped[slot];
    const labelX = a.side === 'left' ? 112 : 248;
    svg.appendChild(svgEl('line', { class: 'lead', x1: a.x, y1: a.y, x2: a.side === 'left' ? labelX + 4 : labelX - 4, y2: a.labelY }));
    const socket = svgEl('circle', { class: 'socket' + (id ? ' on' : ''), cx: a.x, cy: a.y, r: 9 });
    socket.dataset['slot'] = slot;
    if (id) {
      const def = sigilDef(id);
      socket.setAttribute('fill', def.color);
      socket.setAttribute('stroke', def.color);
      glow(socket, def.color);
    }
    const h = opts.hover?.[slot];
    if (h) socket.setAttribute('data-hover', h);
    svg.appendChild(socket);
    sockets[slot] = socket;

    const anchor = a.side === 'left' ? 'end' : 'start';
    const lbl = svgEl('text', { class: 'lbl', x: labelX, y: a.labelY - 3, 'text-anchor': anchor });
    lbl.textContent = SLOT_LABELS[slot];
    svg.appendChild(lbl);
    const val = svgEl('text', { class: 'val', x: labelX, y: a.labelY + 11, 'text-anchor': anchor });
    if (id) {
      const def = sigilDef(id);
      val.textContent = def.name;
      val.setAttribute('fill', def.color);
    } else {
      val.textContent = '비어 있음';
      val.setAttribute('fill', '#555c66');
    }
    svg.appendChild(val);
  }
  return { svg, sockets };
}
