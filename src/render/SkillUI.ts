// Tab 창 — 스킬. 패시브는 몸 실루엣의 부위에 새기고(각인), 액티브는 리스트에서 골라
// 스킬 퀵슬롯(Z·X·C·V)에 올린다. 가방·소모품은 I 창(InventoryUI)이 따로 맡는다.
//
// 조작: 소지 패시브 클릭 = 그 부위에 새기기 / 제단에서 몸 위의 소켓 클릭 = 떼기
//       액티브 클릭 = 고르기 → 스킬 칸 클릭(또는 Z·X·C·V) = 올리기 / 빈손으로 칸 클릭 = 비우기

import { balance } from '../core/Balance';
import { isActiveSkill, sigilDef, SIGIL_SLOTS, type SigilDef, type SigilSlot } from '../core/SigilData';
import type { World } from '../core/World';
import * as Sigils from '../systems/Sigils';

const SLOT_LABELS: Record<SigilSlot, string> = {
  eye: '눈',
  rightArm: '오른팔',
  leftArm: '왼팔',
  heart: '심장',
  spine: '척추',
};
export const SKILL_KEYS = ['Z', 'X', 'C', 'V'];

function swatch(color: string): HTMLElement {
  const dot = document.createElement('span');
  dot.style.cssText =
    `display:inline-block;width:9px;height:9px;margin-right:7px;` +
    `background:${color};box-shadow:0 0 6px ${color};vertical-align:baseline;`;
  return dot;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number>,
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

/** 실루엣 위 소켓 자리와 이름표 자리 (정면 — 그림의 오른팔이 보는 사람의 왼쪽).
 *  이름표는 좌우로 나눠 겹치지 않게 했고, 소켓에서 이름표로 가는 안내선을 긋는다 */
const BODY_ANCHORS: Record<
  SigilSlot,
  { x: number; y: number; side: 'left' | 'right'; labelY: number }
> = {
  eye: { x: 180, y: 42, side: 'right', labelY: 42 },
  heart: { x: 193, y: 104, side: 'right', labelY: 96 },
  leftArm: { x: 233, y: 122, side: 'right', labelY: 140 },
  rightArm: { x: 127, y: 122, side: 'left', labelY: 122 },
  spine: { x: 180, y: 140, side: 'left', labelY: 164 },
};
const BODY_W = 360;
const BODY_H = 250;
const BODY_LINE = '#3a3f4a';
const BODY_FILL = '#1c1f27';


export class SkillUI {
  private readonly root: HTMLDivElement;
  open = false;
  /** 제단에서 열렸는가 — 패시브를 떼는 건 제단에서만 */
  private altarMode = false;
  /** 스킬 칸에 올리려고 골라 둔 액티브 (null = 없음) */
  private picked: string | null = null;

  constructor(private readonly world: World) {
    this.root = document.createElement('div');
    this.root.id = 'skillui';
    this.root.style.cssText =
      'position:fixed;inset:0;display:none;align-items:center;justify-content:center;' +
      'background:rgba(0,0,0,0.72);color:#cfd2da;font:13px/1.6 monospace;user-select:none;z-index:10;';
    document.body.appendChild(this.root);

    // 창 안에서 Z·X·C·V — 고른 액티브를 그 칸에 올린다 (전투 키와 같은 자리)
    window.addEventListener('keydown', (e) => {
      if (!this.open) return;
      const index = ['KeyZ', 'KeyX', 'KeyC', 'KeyV'].indexOf(e.code);
      if (index < 0 || index >= balance.skills.quickslots) return;
      e.preventDefault();
      this.assign(index);
    });
  }

  show(altarMode: boolean): void {
    this.altarMode = altarMode;
    this.open = true;
    this.picked = null;
    this.root.style.display = 'flex';
    this.rebuild();
  }

  hide(): void {
    this.open = false;
    this.picked = null;
    this.root.style.display = 'none';
  }

  toggle(altarMode = false): boolean {
    if (this.open) this.hide();
    else this.show(altarMode);
    return this.open;
  }

  private assign(index: number): void {
    Sigils.assignSkill(this.world, index, this.picked);
    this.picked = null;
    this.rebuild();
  }

  private rebuild(): void {
    const world = this.world;
    const panel = document.createElement('div');
    panel.style.cssText =
      'background:#15151b;border:1px solid #3a3a44;padding:20px 26px;min-width:720px;max-width:920px;';

    const title = document.createElement('div');
    title.textContent =
      (this.altarMode ? '제단 — 스킬' : '스킬') +
      `  (오염 대기 +${world.corruption.pending} · 확정 ${world.corruption.applied}/${balance.corruption.max})`;
    title.style.cssText = 'color:#9fe870;margin-bottom:12px;font-size:15px;';
    panel.appendChild(title);

    // 위: 패시브 — 실루엣 + 소지 패시브
    const passiveRow = document.createElement('div');
    passiveRow.style.cssText = 'display:flex;gap:22px;align-items:flex-start;';
    const { svg, sockets } = this.buildBody();
    passiveRow.appendChild(svg);
    passiveRow.appendChild(this.buildPassiveList(sockets));
    panel.appendChild(passiveRow);

    // 아래: 액티브 — 스킬 퀵슬롯 + 리스트
    const activeBox = document.createElement('div');
    activeBox.style.cssText = 'margin-top:14px;border-top:1px solid #23232b;padding-top:12px;';
    activeBox.appendChild(this.buildSkillSlots());
    activeBox.appendChild(this.buildActiveList());
    panel.appendChild(activeBox);

    const hint = document.createElement('div');
    hint.textContent =
      '소지 패시브 클릭 = 부위에 새기기   ·   ' +
      (this.altarMode ? '몸 위의 소켓 클릭 = 떼기   ·   ' : '떼기는 제단에서   ·   ') +
      '액티브 클릭 = 고르기 → 스킬 칸 클릭(또는 Z·X·C·V) = 올리기   ·   빈손으로 칸 클릭 = 비우기   ·   Tab 닫기   ·   가방은 I';
    hint.style.cssText = 'margin-top:14px;color:#6c7280;font-size:11px;';
    panel.appendChild(hint);

    this.root.replaceChildren(panel);
  }

  /** 소지한 패시브 — 새겨지지 않은 것만. 클릭하면 그 부위에 새긴다 */
  private buildPassiveList(sockets: Record<SigilSlot, SVGCircleElement>): HTMLElement {
    const world = this.world;
    const list = document.createElement('div');
    list.style.cssText = 'flex:1;min-width:250px;';
    const head = document.createElement('div');
    head.textContent = '패시브 — 부위에 새겨야 켜진다';
    head.style.cssText = 'color:#9fe870;margin-bottom:6px;';
    list.appendChild(head);

    const equippedIds = new Set(Object.values(world.sigils.equipped).filter((v): v is string => !!v));
    const owned = world.sigils.inventory
      .map((id) => sigilDef(id))
      .filter((d) => !isActiveSkill(d) && !equippedIds.has(d.id));
    if (owned.length === 0) {
      const empty = document.createElement('div');
      empty.textContent = '새길 것 없음 — 창병을 완벽 패링 후 처형하거나 보물상자를 열면 나온다';
      empty.style.color = '#555c66';
      list.appendChild(empty);
    }
    for (const def of owned) {
      const occupied = world.sigils.equipped[def.slot] !== null;
      const row = skillRow(def, null);
      row.style.cursor = occupied ? 'default' : 'pointer';
      const h = row.querySelector('.head') as HTMLElement;
      h.appendChild(badge(`→ ${SLOT_LABELS[def.slot]}`, '#8a8f9a'));
      h.appendChild(occupied ? badge('부위 사용 중', '#e04444') : badge('클릭해서 새기기', '#7fbfff'));
      if (!def.slice) h.appendChild(badge('이 빌드에선 효과 없음', '#e04444'));
      const socket = sockets[def.slot];
      row.onmouseenter = () => socket.setAttribute('data-hover', occupied ? 'blocked' : 'target');
      row.onmouseleave = () => socket.removeAttribute('data-hover');
      if (!occupied) {
        row.onclick = () => {
          Sigils.attach(world, def.id);
          this.rebuild();
        };
      }
      list.appendChild(row);
    }
    return list;
  }

  /** 스킬 퀵슬롯 — Z·X·C·V. 고른 액티브가 있으면 클릭으로 올리고, 없으면 비운다 */
  private buildSkillSlots(): HTMLElement {
    const world = this.world;
    const slots = Sigils.ensureSkillSlots(world);
    const wrap = document.createElement('div');
    const head = document.createElement('div');
    head.textContent = this.picked
      ? `스킬 퀵슬롯 — ${sigilDef(this.picked).name} 을(를) 올릴 칸을 고른다`
      : '스킬 퀵슬롯 — Z·X·C·V 로 바로 쓰거나, Q 로 칸을 돌려 가운데 클릭으로 쓴다';
    head.style.cssText = `color:${this.picked ? '#e8c76a' : '#9fe870'};margin-bottom:6px;`;
    wrap.appendChild(head);
    const bar = document.createElement('div');
    bar.style.cssText = 'display:flex;gap:8px;margin-bottom:10px;';
    slots.forEach((id, i) => {
      const cell = document.createElement('div');
      cell.style.cssText =
        'width:132px;height:54px;box-sizing:border-box;position:relative;cursor:pointer;' +
        'background:rgba(0,0,0,0.55);border:1px solid ' +
        (this.picked ? '#e8c76a' : id ? '#4a6a8a' : '#3a3a44') + ';padding:4px 6px;';
      const key = document.createElement('div');
      const selected = world.selectedSkill === i && id !== null;
      key.textContent = (selected ? '▸ ' : '') + (SKILL_KEYS[i] ?? String(i + 1)) + (selected ? '  선택됨' : '');
      key.style.cssText = `font-size:10px;color:${selected ? '#e8c76a' : '#8a8f9a'};`;
      cell.appendChild(key);
      const name = document.createElement('div');
      if (id) {
        const def = sigilDef(id);
        name.textContent = def.name;
        name.style.cssText = `color:${def.color};font-size:13px;`;
      } else {
        name.textContent = '비어 있음';
        name.style.cssText = 'color:#555c66;font-size:12px;';
      }
      cell.appendChild(name);
      cell.onclick = () => this.assign(i);
      bar.appendChild(cell);
    });
    wrap.appendChild(bar);
    return wrap;
  }

  /** 소지한 액티브 — 클릭하면 골라진다 (그다음 칸을 고른다) */
  private buildActiveList(): HTMLElement {
    const world = this.world;
    const list = document.createElement('div');
    const head = document.createElement('div');
    head.textContent = '액티브 — 골라서 퀵슬롯에 올린다';
    head.style.cssText = 'color:#9fe870;margin-bottom:6px;';
    list.appendChild(head);
    const owned = world.sigils.inventory.map((id) => sigilDef(id)).filter(isActiveSkill);
    if (owned.length === 0) {
      const empty = document.createElement('div');
      empty.textContent = '없음';
      empty.style.color = '#555c66';
      list.appendChild(empty);
    }
    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:2px 18px;';
    for (const def of owned) {
      const slotIndex = world.skillSlots.indexOf(def.id);
      const picked = this.picked === def.id;
      const row = skillRow(def, picked ? '#e8c76a' : slotIndex >= 0 ? def.color : null);
      row.style.cursor = 'pointer';
      const h = row.querySelector('.head') as HTMLElement;
      const cost =
        def.effects['manaCost'] ??
        balance.spellCost[def.tier as keyof typeof balance.spellCost] ??
        0;
      h.appendChild(badge(`${cost} 마나`, '#8a8f9a'));
      if (slotIndex >= 0) h.appendChild(badge(`${SKILL_KEYS[slotIndex]} 칸`, def.color));
      if (picked) h.appendChild(badge('고름 — 칸을 클릭', '#e8c76a'));
      if (!def.cast) h.appendChild(badge('이 빌드에선 효과 없음', '#e04444'));
      row.onclick = () => {
        this.picked = picked ? null : def.id;
        this.rebuild();
      };
      grid.appendChild(row);
    }
    list.appendChild(grid);
    return list;
  }

  /** 몸 실루엣 — 부위마다 소켓. 장착된 각인의 색으로 그 부위 윤곽이 물들고 소켓이 빛난다 */
  private buildBody(): { svg: SVGSVGElement; sockets: Record<SigilSlot, SVGCircleElement> } {
    const world = this.world;
    const svg = svgEl('svg', {
      width: BODY_W,
      height: BODY_H,
      viewBox: `0 0 ${BODY_W} ${BODY_H}`,
    });
    svg.style.cssText = 'flex:none;display:block;';
    const style = svgEl('style', {});
    style.textContent =
      '.part{fill:' + BODY_FILL + ';stroke:' + BODY_LINE + ';stroke-width:2;stroke-linecap:round;stroke-linejoin:round}' +
      '.limb{fill:none;stroke:' + BODY_LINE + ';stroke-width:13;stroke-linecap:round}' +
      '.socket{fill:#10131a;stroke:#555c66;stroke-width:2;stroke-dasharray:3 3}' +
      '.socket.on{stroke-dasharray:none}' +
      '.socket[data-hover=target]{stroke:#fff;stroke-width:3;stroke-dasharray:none;animation:sockpulse .7s ease-in-out infinite alternate}' +
      '.socket[data-hover=blocked]{stroke:#e04444;stroke-width:3;stroke-dasharray:none}' +
      '@keyframes sockpulse{from{r:9}to{r:12}}' +
      '.lead{stroke:#3a3f4a;stroke-width:1}' +
      '.lbl{font:12px monospace;fill:#8a8f9a}' +
      '.val{font:12px monospace}';
    svg.appendChild(style);

    // 부위별 색 — 장착된 각인 색, 없으면 기본 윤곽색
    const tint = (slot: SigilSlot): string => {
      const id = world.sigils.equipped[slot];
      return id ? sigilDef(id).color : BODY_LINE;
    };
    const glow = (el: SVGElement, color: string): void => {
      el.style.filter = `drop-shadow(0 0 5px ${color})`;
    };

    // 머리·몸통·팔·다리 (정면). 그림의 오른팔 = 보는 사람의 왼쪽
    const head = svgEl('circle', { class: 'part', cx: 180, cy: 42, r: 21 });
    const torso = svgEl('path', {
      class: 'part',
      d: 'M160,68 L200,68 Q212,68 212,82 L212,164 Q212,172 204,172 L156,172 Q148,172 148,164 L148,82 Q148,68 160,68 Z',
    });
    const rightArm = svgEl('line', { class: 'limb', x1: 152, y1: 80, x2: 126, y2: 132 });
    const leftArm = svgEl('line', { class: 'limb', x1: 208, y1: 80, x2: 234, y2: 132 });
    const legL = svgEl('line', { class: 'limb', x1: 168, y1: 176, x2: 163, y2: 238 });
    const legR = svgEl('line', { class: 'limb', x1: 192, y1: 176, x2: 197, y2: 238 });
    const spine = svgEl('line', {
      class: 'lead', x1: 180, y1: 74, x2: 180, y2: 166, 'stroke-dasharray': '4 3', 'stroke-width': 2,
    });
    for (const el of [legL, legR, rightArm, leftArm, torso, head, spine]) svg.appendChild(el);

    // 장착 부위 물들이기
    const partOf: Record<SigilSlot, SVGElement> = { eye: head, heart: torso, spine, rightArm, leftArm };
    for (const slot of SIGIL_SLOTS) {
      const id = world.sigils.equipped[slot];
      if (!id) continue;
      const color = tint(slot);
      partOf[slot].setAttribute('stroke', color);
      if (slot === 'heart') torso.setAttribute('fill', '#1f1a24'); // 심장이 뛰면 몸통이 살짝 따뜻해진다
      glow(partOf[slot], color);
    }

    // 소켓 + 이름표
    const sockets = {} as Record<SigilSlot, SVGCircleElement>;
    for (const slot of SIGIL_SLOTS) {
      const a = BODY_ANCHORS[slot];
      const id = world.sigils.equipped[slot];
      const labelX = a.side === 'left' ? 112 : 248;
      const lead = svgEl('line', {
        class: 'lead', x1: a.x, y1: a.y, x2: a.side === 'left' ? labelX + 4 : labelX - 4, y2: a.labelY,
      });
      svg.appendChild(lead);

      const socket = svgEl('circle', { class: 'socket' + (id ? ' on' : ''), cx: a.x, cy: a.y, r: 9 });
      socket.dataset.slot = slot;
      if (id) {
        const def = sigilDef(id);
        socket.setAttribute('fill', def.color);
        socket.setAttribute('stroke', def.color);
        glow(socket, def.color);
        if (this.altarMode) {
          socket.style.cursor = 'pointer';
          socket.onclick = () => {
            Sigils.detach(world, slot);
            this.rebuild();
          };
        }
      }
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
        if (this.altarMode) {
          val.style.cursor = 'pointer';
          val.onclick = socket.onclick;
        }
      } else {
        val.textContent = '비어 있음';
        val.setAttribute('fill', '#555c66');
      }
      svg.appendChild(val);
    }
    return { svg, sockets };
  }
}

function badge(text: string, color: string): HTMLElement {
  const el = document.createElement('span');
  el.textContent = text;
  el.style.cssText =
    `margin-left:8px;padding:0 6px;border:1px solid ${color};color:${color};` +
    'font-size:10px;line-height:16px;border-radius:2px;white-space:nowrap;';
  return el;
}

/** 스킬 한 줄 — 색 견본 + 이름 (+표식들) / 아래에 설명. 강조색이 있으면 왼쪽 테두리 */
function skillRow(def: SigilDef, accent: string | null): HTMLElement {
  const row = document.createElement('div');
  row.style.cssText =
    'padding:4px 8px;margin:2px 0;border-left:3px solid ' +
    (accent ?? 'transparent') +
    ';' +
    (accent ? `background:${accent}14;` : '');
  const head = document.createElement('div');
  head.className = 'head';
  head.style.cssText = 'display:flex;align-items:center;flex-wrap:wrap;color:#cfd2da;';
  head.appendChild(swatch(def.color));
  const name = document.createElement('span');
  name.textContent = def.name;
  name.style.color = def.color;
  head.appendChild(name);
  row.appendChild(head);
  if (def.desc) {
    const desc = document.createElement('div');
    desc.textContent = def.desc;
    desc.style.cssText = 'color:#8a8f9a;font-size:11px;margin:1px 0 0 16px;';
    row.appendChild(desc);
  }
  return row;
}
