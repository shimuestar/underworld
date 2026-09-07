// Tab 창 — 스킬(액티브). 익힌 액티브 스킬을 리스트에서 골라 스킬 퀵슬롯(Z·X·C·V)에 올린다.
// 2026-09-04 개념 변경: 각인은 전부 패시브(가방 아이템)이고 몸 실루엣·새기기는 가방 탭(InventoryUI)으로 옮겼다.
// 액티브 스킬은 아이템이 아니다 — 획득하는 순간 이 리스트에 등록된다.
//
// 조작: 액티브 클릭 = 고르기 → 스킬 칸 클릭(또는 Z·X·C·V) = 올리기 / 빈손으로 칸 클릭 = 비우기
// 퀵슬롯 표시는 전투 HUD 와 같은 마름모 십자다 (index.html 의 .dslot 을 공유, 2026-09-07)

import { balance } from '../core/Balance';
import { isActiveSkill, sigilDef, type SigilDef } from '../core/SigilData';
import type { World } from '../core/World';
import * as Sigils from '../systems/Sigils';

export const SKILL_KEYS = ['Z', 'X', 'C', 'V'];

function swatch(color: string): HTMLElement {
  const dot = document.createElement('span');
  dot.style.cssText =
    `display:inline-block;width:9px;height:9px;margin-right:7px;` +
    `background:${color};box-shadow:0 0 6px ${color};vertical-align:baseline;`;
  return dot;
}


export class SkillUI {
  private readonly root: HTMLDivElement;
  open = false;
  /** 제단에서 열렸는가 — 패시브를 떼는 건 제단에서만 */
  private altarMode = false;
  /** 스킬 칸에 올리려고 골라 둔 액티브 (null = 없음) */
  private picked: string | null = null;

  constructor(private readonly world: World, parent: HTMLElement) {
    // 메뉴 창(MenuTabs)의 스킬 탭 패널 — 배경·시간 정지는 셸이 맡는다 (2026-09-04)
    this.root = document.createElement('div');
    this.root.id = 'skillui';
    this.root.style.cssText = 'display:none;';
    parent.appendChild(this.root);

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
    this.root.style.display = 'block';
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
      `  (오염 대기 ${world.corruption.pending >= 0 ? '+' : ''}${world.corruption.pending} · 확정 ${world.corruption.applied}/${balance.corruption.max})`; // 정화로 음수면 '−4'(main HUD 와 같은 꼴 — B3-2 잔여 메모 → B3-6)
    title.style.cssText = 'color:#9fe870;margin-bottom:12px;font-size:15px;';
    panel.appendChild(title);

    // 액티브 — 스킬 퀵슬롯 + 익힌 리스트 (패시브 각인·몸 실루엣은 가방 탭)
    const activeBox = document.createElement('div');
    activeBox.style.cssText = 'padding-top:4px;';
    activeBox.appendChild(this.buildSkillSlots());
    activeBox.appendChild(this.buildActiveList());
    panel.appendChild(activeBox);

    const hint = document.createElement('div');
    hint.textContent =
      '스킬 클릭 = 고르기 → 스킬 칸 클릭(또는 Z·X·C·V) = 올리기   ·   빈손으로 칸 클릭 = 비우기   ·   ' +
      '패시브 각인은 가방 탭(I)의 몸에 새긴다   ·   Tab 닫기';
    hint.style.cssText = 'margin-top:14px;color:#6c7280;font-size:11px;';
    panel.appendChild(hint);

    this.root.replaceChildren(panel);
  }

  /** 스킬 퀵슬롯 — 전투 HUD 와 같은 마름모 십자(Z 위 · X 오른쪽 · C 아래 · V 왼쪽).
   *  index.html 의 .dslot 규칙을 그대로 쓴다 — HUD 와 모양이 어긋나지 않게 한 곳에서만 고친다.
   *  마름모 안은 색 원반과 키 글자뿐이라 네 칸의 이름은 오른쪽 목록에 적고,
   *  가운데 클릭이 쓰는(선택된) 칸 이름은 HUD 처럼 뭉치 위에 한 줄로 올린다.
   *  고른 액티브가 있으면 칸(또는 목록 줄) 클릭으로 올리고, 없으면 비운다 */
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

    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:26px;margin:0 0 10px 8px;';

    // 마름모 뭉치 — HUD 의 #skill-diamond 와 같은 160px 판, 같은 .dslot 자리(p0~p3)
    const pad = document.createElement('div');
    pad.className = 'menu-diamond' + (this.picked ? ' picking' : '');
    pad.style.cssText =
      'position:relative;width:160px;height:160px;flex:none;font:10px/1 monospace;margin-top:14px;';
    const label = document.createElement('div');
    label.style.cssText =
      'position:absolute;bottom:100%;left:-20px;right:-20px;text-align:center;font-size:11px;' +
      'color:#cfd2da;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
    const chosen = slots[world.selectedSkill];
    label.textContent = chosen ? sigilDef(chosen).name : '';
    pad.appendChild(label);

    slots.forEach((id, i) => {
      const selected = world.selectedSkill === i && id !== null;
      const cell = document.createElement('div');
      cell.className = `dslot p${i} skill ${id ? 'ready' : 'empty'}${selected ? ' selected' : ''}`;
      const frame = document.createElement('div');
      frame.className = 'frame';
      const key = document.createElement('div');
      key.className = 'key';
      key.textContent = SKILL_KEYS[i] ?? String(i + 1);
      const body = document.createElement('div');
      body.className = 'body';
      const mark = document.createElement('span');
      mark.className = 'mark';
      if (id) {
        const def = sigilDef(id);
        mark.style.background = def.color;
        mark.style.boxShadow = `0 0 8px ${def.color}`;
      }
      body.appendChild(mark);
      cell.append(frame, key, body);
      cell.title = `${SKILL_KEYS[i] ?? i + 1} — ${id ? sigilDef(id).name : '비어 있음'}`;
      cell.onclick = () => this.assign(i);
      pad.appendChild(cell);
    });
    row.appendChild(pad);

    // 오른쪽 목록 — 키 순서로 네 칸의 이름. 줄을 눌러도 그 칸에 올린다
    const legend = document.createElement('div');
    legend.style.cssText = 'display:flex;flex-direction:column;gap:8px;';
    slots.forEach((id, i) => {
      const selected = world.selectedSkill === i && id !== null;
      const line = document.createElement('div');
      line.style.cssText = 'display:flex;align-items:center;gap:10px;cursor:pointer;font-size:12px;line-height:1;';
      const k = document.createElement('span');
      k.textContent = SKILL_KEYS[i] ?? String(i + 1);
      k.style.cssText =
        `display:inline-block;width:18px;height:18px;line-height:18px;text-align:center;font-size:10px;` +
        `border:1px solid ${selected ? '#e8c76a' : id ? '#4a6a8a' : '#3a3a44'};color:${selected ? '#e8c76a' : '#8a8f9a'};`;
      line.appendChild(k);
      const name = document.createElement('span');
      if (id) {
        const def = sigilDef(id);
        name.textContent = def.name;
        name.style.color = def.color;
      } else {
        name.textContent = this.picked ? '여기에 올린다' : '비어 있음';
        name.style.color = this.picked ? '#e8c76a' : '#555c66';
      }
      line.appendChild(name);
      if (selected) {
        const tag = document.createElement('span');
        tag.textContent = '가운데 클릭';
        tag.style.cssText = 'font-size:10px;color:#e8c76a;opacity:0.8;';
        line.appendChild(tag);
      }
      line.onclick = () => this.assign(i);
      legend.appendChild(line);
    });
    row.appendChild(legend);
    wrap.appendChild(row);
    return wrap;
  }

  /** 소지한 액티브 — 클릭하면 골라진다 (그다음 칸을 고른다) */
  private buildActiveList(): HTMLElement {
    const world = this.world;
    const list = document.createElement('div');
    const head = document.createElement('div');
    head.textContent = '익힌 스킬 — 골라서 퀵슬롯에 올린다';
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
