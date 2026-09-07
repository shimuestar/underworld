// Tab 창 — 스킬(액티브). 익힌 액티브 스킬을 리스트에서 골라 스킬 퀵슬롯(Z·X·C·V)에 올린다.
// 2026-09-04 개념 변경: 각인은 전부 패시브(가방 아이템)이고 몸 실루엣·새기기는 가방 탭(InventoryUI)으로 옮겼다.
// 액티브 스킬은 아이템이 아니다 — 획득하는 순간 이 리스트에서 켜진다.
// 목록은 데이터에 정의된 액티브 전부를 데이터 순서로 보인다 (2026-09-07 사용자) — 아직 못 익힌 것은 흐리게(비활성) 두고
//   끌기·고르기·올리기가 전혀 되지 않는다 (Sigils.assignSkill 도 가진 것만 받는다). 무엇을 더 익힐 수 있는지 미리 보는 용도
//
// 조작(2026-09-07 사용자): 왼쪽 마름모 십자(전투 HUD 와 같은 .dslot 공유) + 오른쪽 익힌 스킬 목록.
//   목록의 아이콘을 끌어 칸(또는 칸 이름 줄)에 놓기 = 올리기 / 칸끼리 끌기 = 자리 바꾸기 / 칸을 밖으로 끌기 = 비우기
//   보조: 스킬 클릭 = 고르기 → 칸 클릭 또는 Z·X·C·V = 올리기 / 빈손으로 찬 칸 클릭 = 비우기
// 칸 키 표기는 HUD 와 같은 장치를 따른다 — 패드면 RB 를 누른 채 Y·B·A·X, 키보드면 설정된 키 (main 이 keyLabel 을 채운다, 2026-09-07 사용자)
// 패드(2026-09-07 사용자): D-패드·왼 스틱 커서(← 마름모 / → 목록), A 목록에서 고르기 → 커서가 마름모로 건너가 A 로 올리기(빈손 = 비우기),
//   X 칸 비우기, B 고르기 취소·닫기. 문구도 패드 모드에선 전부 패드 기준으로 적는다 (가방 탭과 같은 규약)

import { balance } from '../core/Balance';
import { allSigilIds, isActiveSkill, sigilDef } from '../core/SigilData';
import type { World } from '../core/World';
import * as Sigils from '../systems/Sigils';
import { beginDrag } from './DragDrop';
import { sigilIconSvg } from './ItemIcons';

export const SKILL_KEYS = ['Z', 'X', 'C', 'V'];

const PANEL_PX = 1100; // 가방 탭과 같은 폭 — 탭을 오갈 때 창 크기가 튀지 않는다
const LEFT_PX = 300; // 왼쪽 기둥: 마름모 십자(160) + 칸 이름 목록
const ICON_PX = 28; // 목록 아이콘 = 드래그 고스트 크기

/** 마름모 안 패드 커서 이동 — [칸][방향(0 ←, 1 →, 2 ↑, 3 ↓)] → 다음 칸.
 *  'list' = 오른쪽 목록으로, 'prev' = 왼쪽 탭으로(가방 탭의 -1 규약), null = 제자리 (InventoryUI CROSS_NAV 와 같은 배치) */
const CROSS_NAV: Record<number, (number | 'list' | 'prev' | null)[]> = {
  0: [3, 1, null, 2], // 위: ← 왼쪽 · → 오른쪽 · ↓ 아래
  1: [3, 'list', 0, 2], // 오른쪽: ← 왼쪽 · → 목록으로 · ↑ 위 · ↓ 아래
  2: [3, 1, 0, null], // 아래: ← 왼쪽 · → 오른쪽 · ↑ 위
  3: ['prev', 1, 0, 2], // 왼쪽: ← 왼쪽 탭으로 · → 오른쪽 · ↑ 위 · ↓ 아래
};

/** 드롭 대상 key('k0'~'k3') → 칸 번호. 칸이 아니면 -1 */
function slotFromKey(key: string | null): number {
  if (!key || !key.startsWith('k')) return -1;
  const i = Number.parseInt(key.slice(1), 10);
  return Number.isFinite(i) ? i : -1;
}


export class SkillUI {
  private readonly root: HTMLDivElement;
  open = false;
  /** 제단에서 열렸는가 — 패시브를 떼는 건 제단에서만 */
  private altarMode = false;
  /** 스킬 칸에 올리려고 골라 둔 액티브 (null = 없음) */
  private picked: string | null = null;
  /** 칸 키 표기 — main 이 장치(패드/키보드)와 현재 바인딩을 따라 채운다. 기본은 Z·X·C·V */
  keyLabel: (index: number, pad: boolean) => string = (i) => SKILL_KEYS[i] ?? String(i + 1);
  /** 패드의 스킬 선택(조합) 버튼 이름 — 기본 'RB'. 헤더 문구에 쓴다 */
  padSelectLabel: () => string = () => 'RB';
  private _padMode = false;
  /** 패드 표기 모드 — 바뀌면 창이 열려 있을 때 다시 그린다 (HUD 의 칸 표기와 같은 장치를 따른다) */
  get padMode(): boolean {
    return this._padMode;
  }
  set padMode(v: boolean) {
    if (v === this._padMode) return;
    this._padMode = v;
    if (this.open) this.rebuild();
  }
  private key(i: number): string {
    return this.keyLabel(i, this._padMode);
  }
  /** 패드 커서 — 'slots'(왼쪽 마름모 칸) | 'list'(오른쪽 익힌 스킬 줄). 패드 모드에서만 그린다 */
  private pane: 'slots' | 'list' = 'list';
  private selSlot = 0;
  private selRow = 0;
  /** 패드 D-패드로 끝에서 한 번 더 밀면 옆 탭으로 (가방 탭과 같은 규약) */
  onEdge: ((dir: 1 | -1) => void) | null = null;
  /** B — 고른 것이 없을 때 창을 닫는다 (셸이 uiOpen 을 되돌린다) */
  onClose: (() => void) | null = null;

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
    // 커서는 목록에서 시작한다 — 목록이 비어 있으면(데이터에 액티브가 없으면) 마름모
    this.pane = this.listActives().length > 0 ? 'list' : 'slots';
    this.selRow = 0;
    this.root.style.display = 'block';
    this.rebuild();
  }

  /** 목록에 보이는 액티브 전부 — 익힌 것·못 익힌 것 모두, 데이터 순서 */
  private listActives(): string[] {
    return allSigilIds().filter((id) => isActiveSkill(sigilDef(id)));
  }

  /** 익혔는가 — 못 익힌 스킬은 보이기만 하고 고르기·끌기·올리기가 막힌다 */
  private owned(id: string): boolean {
    return this.world.sigils.inventory.includes(id);
  }

  // ---- 패드 ----

  /** D-패드·왼 스틱 — 목록은 위아래, ← 로 마름모, → 로 옆 탭. 마름모는 십자 이동표(CROSS_NAV) */
  padMove(dx: number, dy: number): void {
    if (!this.open) return;
    const dir = dx < 0 ? 0 : dx > 0 ? 1 : dy < 0 ? 2 : dy > 0 ? 3 : -1;
    if (dir < 0) return;
    if (this.pane === 'list') {
      if (dir === 0) {
        this.pane = 'slots';
      } else if (dir === 1) {
        this.onEdge?.(1);
        return;
      } else {
        const n = this.listActives().length;
        if (n === 0) return;
        const next = Math.max(0, Math.min(n - 1, this.selRow + (dir === 3 ? 1 : -1)));
        if (next === this.selRow) return; // 끝 — 제자리
        this.selRow = next;
      }
    } else {
      const next = CROSS_NAV[this.selSlot]?.[dir] ?? null;
      if (next === null) return;
      if (next === 'list') {
        if (this.listActives().length === 0) return; // 목록이 비어 있으면 건너갈 곳이 없다
        this.pane = 'list';
      } else if (next === 'prev') {
        this.onEdge?.(-1);
        return;
      } else {
        this.selSlot = next;
      }
    }
    this.rebuild();
  }

  /** A — 목록: 고르기(다시 누르면 취소) → 커서가 올릴 칸으로 건너간다. 못 익힌 줄에서는 아무 일도 없다 /
   *  마름모: 고른 것을 그 칸에 올린다, 빈손이면 찬 칸을 비운다 (가방 탭 퀵슬롯과 같은 '빈손 = 해제') */
  padA(): void {
    if (!this.open) return;
    if (this.pane === 'list') {
      const id = this.listActives()[this.selRow];
      if (!id || !this.owned(id)) return;
      if (this.picked === id) {
        this.picked = null;
        this.rebuild();
        return;
      }
      this.picked = id;
      // 이미 올라가 있으면 그 칸, 아니면 첫 빈 칸, 다 찼으면 지금 커서 칸
      const slots = Sigils.ensureSkillSlots(this.world);
      const at = slots.indexOf(id);
      const empty = slots.indexOf(null);
      this.pane = 'slots';
      this.selSlot = at >= 0 ? at : empty >= 0 ? empty : this.selSlot;
      this.rebuild();
      return;
    }
    if (this.picked) {
      this.assign(this.selSlot);
      return;
    }
    if (Sigils.ensureSkillSlots(this.world)[this.selSlot]) this.assign(this.selSlot); // picked=null → 비우기
  }

  /** X — 커서 칸을 비운다. 목록 위에서는 그 스킬이 올라간 칸을 비운다 */
  padX(): void {
    if (!this.open) return;
    const slots = Sigils.ensureSkillSlots(this.world);
    let at = -1;
    if (this.pane === 'slots') {
      at = slots[this.selSlot] ? this.selSlot : -1;
    } else {
      const id = this.listActives()[this.selRow];
      at = id ? slots.indexOf(id) : -1;
    }
    if (at < 0) return;
    Sigils.assignSkill(this.world, at, null);
    this.picked = null;
    this.rebuild();
  }

  /** B — 고른 것이 있으면 취소(커서는 고른 줄로 돌아간다), 없으면 닫는다 */
  padB(): void {
    if (!this.open) return;
    if (this.picked) {
      this.picked = null;
      if (this.listActives().length > 0) this.pane = 'list';
      this.rebuild();
      return;
    }
    this.onClose?.();
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

  /** 목록 아이콘 → 칸: 그 칸에 올린다 (같은 스킬이 다른 칸에 있었으면 그쪽은 비워진다) */
  private dropSkill(sigilId: string, key: string | null): void {
    const to = slotFromKey(key);
    if (to < 0) return; // 칸 밖에 놓았다 — 아무 일도 없다
    if (!this.owned(sigilId)) return; // 못 익힌 스킬은 끌 수도 없지만 한 번 더 막는다
    Sigils.assignSkill(this.world, to, sigilId);
    this.picked = null;
    this.rebuild();
  }

  /** 칸 → 칸: 자리 바꾸기(빈 칸이면 옮기기) / 칸 → 밖: 비우기 */
  private dropCell(from: number, key: string | null): void {
    const world = this.world;
    const slots = Sigils.ensureSkillSlots(world);
    const a = slots[from];
    if (!a) return;
    const to = slotFromKey(key);
    if (to === from) return;
    if (to < 0) {
      Sigils.assignSkill(world, from, null);
    } else {
      const b = slots[to] ?? null;
      Sigils.assignSkill(world, to, a); // 같은 스킬은 한 칸에만 — from 은 여기서 비워진다
      if (b) Sigils.assignSkill(world, from, b);
    }
    this.picked = null;
    this.rebuild();
  }

  private rebuild(): void {
    const world = this.world;
    const panel = document.createElement('div');
    panel.style.cssText =
      `background:#15151b;border:1px solid #3a3a44;padding:20px 26px;width:${PANEL_PX}px;box-sizing:border-box;`;

    const title = document.createElement('div');
    title.textContent =
      (this.altarMode ? '제단 — 스킬' : '스킬') +
      `  (오염 대기 ${world.corruption.pending >= 0 ? '+' : ''}${world.corruption.pending} · 확정 ${world.corruption.applied}/${balance.corruption.max})`; // 정화로 음수면 '−4'(main HUD 와 같은 꼴 — B3-2 잔여 메모 → B3-6)
    title.style.cssText = 'color:#9fe870;margin-bottom:12px;font-size:15px;';
    panel.appendChild(title);

    // 왼쪽 퀵슬롯 마름모 · 오른쪽 익힌 스킬 목록 (패시브 각인·몸 실루엣은 가방 탭)
    const columns = document.createElement('div');
    columns.style.cssText = 'display:flex;align-items:flex-start;gap:30px;';
    columns.appendChild(this.buildSkillSlots());
    columns.appendChild(this.buildActiveList());
    panel.appendChild(columns);

    const hint = document.createElement('div');
    const keys = world.skillSlots.map((_, i) => this.key(i)).join('·');
    hint.textContent = this._padMode
      ? 'D-패드·왼 스틱 커서 (← 마름모 · → 목록)   A 고르기 → 칸에서 A 올리기 (빈손 = 비우기)   X 칸 비우기   ' +
        'B 취소 · 닫기   LB/RB 탭 전환   패시브 각인은 가방 탭의 몸에 새긴다'
      : '아이콘 끌어 칸에 놓기 = 올리기   ·   칸끼리 끌기 = 자리 바꾸기   ·   칸을 밖으로 끌기(또는 빈손으로 클릭) = 비우기   ·   ' +
        `스킬 클릭 = 고르기 → ${keys} 로 올리기   ·   패시브 각인은 가방 탭(I)의 몸에 새긴다   ·   Tab 닫기`;
    hint.style.cssText = 'margin-top:14px;color:#6c7280;font-size:11px;';
    panel.appendChild(hint);

    this.root.replaceChildren(panel);
  }

  /** 스킬 퀵슬롯 — 전투 HUD 와 같은 마름모 십자(Z 위 · X 오른쪽 · C 아래 · V 왼쪽).
   *  index.html 의 .dslot 규칙을 그대로 쓴다 — HUD 와 모양이 어긋나지 않게 한 곳에서만 고친다.
   *  마름모 안은 색 원반과 키 글자뿐이라 네 칸의 이름은 아래 목록에 적고,
   *  가운데 클릭이 쓰는(선택된) 칸 이름은 HUD 처럼 뭉치 위에 한 줄로 올린다.
   *  칸과 이름 줄은 모두 드롭 대상(data-key k0~k3)이고, 찬 칸은 끌어서 옮기거나 밖에 버려 비운다 */
  private buildSkillSlots(): HTMLElement {
    const world = this.world;
    const slots = Sigils.ensureSkillSlots(world);
    const col = document.createElement('div');
    col.style.cssText = `width:${LEFT_PX}px;flex:none;`;
    const head = document.createElement('div');
    const keys = slots.map((_, i) => this.key(i)).join('·');
    head.textContent = this.picked
      ? `스킬 퀵슬롯 — ${sigilDef(this.picked).name} 을(를) 올릴 칸을 고른다` + (this._padMode ? ' (A 올리기 · B 취소)' : '')
      : this._padMode
        ? `스킬 퀵슬롯 — 전투 중 ${this.padSelectLabel()} 를 누른 채 ${keys}`
        : `스킬 퀵슬롯 — 전투 중 ${keys}   ·   아이콘을 끌어 칸에 놓는다`;
    head.style.cssText = `color:${this.picked ? '#e8c76a' : '#9fe870'};margin-bottom:6px;`;
    col.appendChild(head);

    // 마름모 뭉치 — HUD 의 #skill-diamond 와 같은 160px 판, 같은 .dslot 자리(p0~p3)
    const pad = document.createElement('div');
    pad.className = 'menu-diamond' + (this.picked ? ' picking' : '');
    pad.style.cssText =
      'position:relative;width:160px;height:160px;font:10px/1 monospace;margin:28px auto 16px;';
    const label = document.createElement('div');
    label.style.cssText =
      'position:absolute;bottom:100%;left:-40px;right:-40px;text-align:center;font-size:11px;' +
      'color:#cfd2da;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
    const chosen = slots[world.selectedSkill];
    label.textContent = chosen ? sigilDef(chosen).name : '';
    pad.appendChild(label);

    const dragCell = (i: number, id: string) => (ev: PointerEvent) =>
      beginDrag(ev, sigilIconSvg(id, ICON_PX), (key) => this.dropCell(i, key));

    slots.forEach((id, i) => {
      const selected = world.selectedSkill === i && id !== null;
      const cursor = this._padMode && this.pane === 'slots' && this.selSlot === i;
      const cell = document.createElement('div');
      cell.className =
        `dslot p${i} skill ${id ? 'ready' : 'empty'}${selected ? ' selected' : ''}${cursor ? ' cursor' : ''}` +
        (this._padMode ? ' pad' : ''); // 패드면 키 글자를 원 안에
      cell.dataset['key'] = `k${i}`;
      const frame = document.createElement('div');
      frame.className = 'frame';
      const key = document.createElement('div');
      key.className = 'key';
      key.textContent = this.key(i);
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
      cell.title = `${this.key(i)} — ${id ? sigilDef(id).name : '비어 있음'}`;
      cell.onclick = () => this.assign(i);
      if (id) cell.onpointerdown = dragCell(i, id);
      pad.appendChild(cell);
    });
    col.appendChild(pad);

    // 칸 이름 목록 — 키 순서로. 줄도 드롭 대상이고, 눌러도 그 칸에 올린다
    const legend = document.createElement('div');
    legend.style.cssText = 'display:flex;flex-direction:column;gap:8px;margin-left:24px;';
    slots.forEach((id, i) => {
      const selected = world.selectedSkill === i && id !== null;
      const cursor = this._padMode && this.pane === 'slots' && this.selSlot === i;
      const line = document.createElement('div');
      line.dataset['key'] = `k${i}`;
      line.style.cssText =
        'display:flex;align-items:center;gap:10px;cursor:pointer;font-size:12px;line-height:1;' +
        (cursor ? 'background:rgba(127,191,255,0.12);margin:-3px -6px;padding:3px 6px;' : '');
      const k = document.createElement('span');
      k.textContent = this.key(i);
      // 패드면 원(버튼 꼴), 키보드면 네모(키캡 꼴)
      k.style.cssText =
        `display:inline-block;width:18px;height:18px;line-height:16px;text-align:center;font-size:10px;box-sizing:border-box;` +
        (this._padMode ? 'border-radius:50%;' : '') +
        `border:1px solid ${cursor ? '#7fbfff' : selected ? '#e8c76a' : id ? '#4a6a8a' : '#3a3a44'};` +
        `color:${cursor ? '#7fbfff' : selected ? '#e8c76a' : '#8a8f9a'};`;
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
      if (selected && !this._padMode) {
        // 가운데 클릭은 마우스 얘기 — 패드는 조합 버튼으로 곧장 시전하니 뺀다
        const tag = document.createElement('span');
        tag.textContent = '가운데 클릭';
        tag.style.cssText = 'font-size:10px;color:#e8c76a;opacity:0.8;';
        line.appendChild(tag);
      }
      line.onclick = () => this.assign(i);
      if (id) line.onpointerdown = dragCell(i, id);
      legend.appendChild(line);
    });
    col.appendChild(legend);
    return col;
  }

  /** 액티브 목록 — 한 줄에 아이콘 · 이름(마나) · 설명 · 표식. 아이콘(줄 어디든)을 끌어 칸에 놓는다.
   *  클릭은 고르기(그다음 칸 클릭 또는 Z·X·C·V) — 끌기 임계를 넘기지 않으면 클릭이다.
   *  못 익힌 스킬도 같은 줄 꼴로 보이되 흐리고(비활성) 끌기·클릭이 없다 — 패드 커서는 지나갈 수 있어 설명은 읽힌다 */
  private buildActiveList(): HTMLElement {
    const world = this.world;
    const list = document.createElement('div');
    list.style.cssText = 'flex:1;min-width:0;';
    const head = document.createElement('div');
    head.textContent = this._padMode
      ? '스킬 — 익힌 것을 A 로 골라 칸에 올린다 (흐린 줄 = 아직 못 익힘)'
      : '스킬 — 익힌 것의 아이콘을 끌어 퀵슬롯 칸에 놓는다 (흐린 줄 = 아직 못 익힘)';
    head.style.cssText = 'color:#9fe870;margin-bottom:6px;';
    list.appendChild(head);
    const shown = this.listActives().map((id) => sigilDef(id));
    if (this.selRow >= shown.length) this.selRow = Math.max(0, shown.length - 1);
    if (shown.length === 0) {
      const empty = document.createElement('div');
      empty.textContent = '없음';
      empty.style.color = '#555c66';
      list.appendChild(empty);
    }
    shown.forEach((def, rowIndex) => {
      const has = this.owned(def.id);
      const slotIndex = has ? world.skillSlots.indexOf(def.id) : -1;
      const picked = has && this.picked === def.id;
      const here = this._padMode && this.pane === 'list' && this.selRow === rowIndex;
      const accent = picked ? '#e8c76a' : slotIndex >= 0 ? def.color : null;
      const row = document.createElement('div');
      row.style.cssText =
        `display:grid;grid-template-columns:${ICON_PX + 6}px 118px minmax(0,1fr) auto;gap:0 12px;align-items:center;` +
        `padding:7px 10px;margin:3px 0;cursor:${has ? 'pointer' : 'default'};border-left:3px solid ` +
        (here ? '#7fbfff' : accent ?? 'transparent') + ';' +
        (here ? 'background:rgba(127,191,255,0.12);outline:1px solid rgba(127,191,255,0.5);' : accent ? `background:${accent}14;` : 'background:rgba(255,255,255,0.02);') +
        (has ? '' : 'opacity:0.38;filter:saturate(0.35);'); // 비활성 — 흐리고 색을 뺀다. 커서 강조는 그대로 보인다

      const icon = document.createElement('span');
      icon.style.cssText = `display:block;line-height:0;cursor:${has ? 'grab' : 'default'};`;
      icon.innerHTML = sigilIconSvg(def.id, ICON_PX);
      row.appendChild(icon);

      const nameBox = document.createElement('div');
      const name = document.createElement('div');
      name.textContent = def.name;
      name.style.cssText = `color:${def.color};font-size:13px;line-height:1.2;`;
      nameBox.appendChild(name);
      const cost =
        def.effects['manaCost'] ??
        balance.spellCost[def.tier as keyof typeof balance.spellCost] ??
        0;
      const costLine = document.createElement('div');
      costLine.textContent = `${cost} 마나`;
      costLine.style.cssText = 'color:#8a8f9a;font-size:10px;margin-top:3px;';
      nameBox.appendChild(costLine);
      row.appendChild(nameBox);

      const desc = document.createElement('div');
      desc.textContent = def.desc ?? '';
      desc.style.cssText = 'color:#8a8f9a;font-size:11px;line-height:1.5;';
      row.appendChild(desc);

      const tags = document.createElement('div');
      tags.style.cssText = 'display:flex;flex-direction:column;align-items:flex-end;gap:4px;';
      // 올라간 칸 — 키보드는 'Z 칸', 패드는 버튼 글자만 원 안에 (2026-09-07 사용자)
      if (slotIndex >= 0) tags.appendChild(this._padMode ? keyBadge(this.key(slotIndex), def.color) : badge(`${this.key(slotIndex)} 칸`, def.color));
      if (picked) tags.appendChild(badge(this._padMode ? '고름 — 칸에서 A' : '고름 — 칸을 클릭', '#e8c76a'));
      if (!has) tags.appendChild(badge('아직 못 익힘', '#8a8f9a'));
      if (!def.cast) tags.appendChild(badge('이 빌드에선 효과 없음', '#e04444'));
      row.appendChild(tags);

      if (has) {
        row.onclick = () => {
          this.picked = picked ? null : def.id;
          this.rebuild();
        };
        row.onpointerdown = (ev) => beginDrag(ev, sigilIconSvg(def.id, ICON_PX), (key) => this.dropSkill(def.id, key));
      }
      list.appendChild(row);
    });
    return list;
  }
}

/** 패드 버튼 표식 — 원 안에 글자 하나 (index.html .padkey) */
function keyBadge(text: string, color: string): HTMLElement {
  const el = document.createElement('span');
  el.className = 'padkey';
  el.textContent = text;
  el.style.color = color;
  return el;
}

function badge(text: string, color: string): HTMLElement {
  const el = document.createElement('span');
  el.textContent = text;
  el.style.cssText =
    `padding:0 6px;border:1px solid ${color};color:${color};` +
    'font-size:10px;line-height:16px;border-radius:2px;white-space:nowrap;';
  return el;
}
