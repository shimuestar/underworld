// 창고(성물함) 창 — 보관 · 확장 두 탭. DOM 오버레이, 열려 있는 동안 시뮬레이션은 main 이 멈춘다. docs/systems/stash.md §5.
// 보관: 왼쪽 열 = 내 가방 격자 + 설명 칸, 오른쪽 = 창고 격자(lobby.stash.cols 열).
//   커서 하나(마우스·키보드·패드 공용). ←→ 로 가방 ↔ 창고.
//   Enter·A·클릭 = 한 개 옮기기(가방 → 창고, 창고 → 가방) · X·우클릭 = 칸 통째로 · Q·패드 LT = 가방 전부 넣기.
//   안전 주머니는 여기 없다 — 캐릭터의 것이라 가방 탭(InventoryUI)에서만 다룬다 (2026-09-08 사용자).
// 확장: 현재 용량·다음 단계 비용·열쇠 보유, Enter·A·클릭으로 확장.
// 옮기기·확장 규칙은 전부 systems/Stash — 여기는 그리기와 입력만.

import { balance } from '../core/Balance';
import { equipDef } from '../core/EquipData';
import { itemDef } from '../core/Inventory';
import { sigilDef } from '../core/SigilData';
import type { InventorySlot, ItemKind, World } from '../core/World';
import * as Stash from '../systems/Stash';
import { equipIcon, itemIcon, sigilIcon } from './ItemIcons';
import { consumablePopup, equipPopup, keycap, sigilPopup, type PopupContent } from './ItemPopup';

const CELL_PX = 64;
const GAP_PX = 8;
const ICON_PX = 28;
const CELL = `width:${CELL_PX}px;height:${CELL_PX}px;box-sizing:border-box;position:relative;`;
const DESC_PX = 352; // 왼쪽 열(가방 5열) 폭에 맞춘다
/** 창 폭 — 왼쪽 열(352) + 사이 28 + 창고 10열(712) + 안쪽 여백 26×2 */
const PANEL_PX = 1144;

type Tab = 'store' | 'expand';
const TABS: { id: Tab; label: string }[] = [
  { id: 'store', label: '보관' },
  { id: 'expand', label: '확장' },
];
const UP_KEYS = new Set(['KeyW', 'ArrowUp']);
const DOWN_KEYS = new Set(['KeyS', 'ArrowDown']);
const LEFT_KEYS = new Set(['KeyA', 'ArrowLeft']);
const RIGHT_KEYS = new Set(['KeyD', 'ArrowRight']);

/** 이 창이 다루는 격자 — 가방·창고. (안전 주머니는 가방 탭의 것) */
type Pane = 'bag' | 'stash';
const PANE_LABEL: Record<Pane, string> = { bag: '가방', stash: '창고' };

export class StashUI {
  private readonly root: HTMLDivElement;
  open = false;
  private tab: Tab = 'store';
  private pane: Pane = 'bag';
  private sel = 0;
  private openedAt = 0;
  /** 패드로 조작 중 — 안내·키캡을 패드 표기로 (main 이 틱마다 갱신) */
  padMode = false;
  /** 창 안에서 닫았다(B·Esc·E) — main 이 uiOpen 을 되돌린다 */
  onClose: (() => void) | null = null;

  constructor(private readonly world: World) {
    this.root = document.createElement('div');
    this.root.id = 'stashui';
    this.root.style.cssText =
      'position:fixed;inset:0;display:none;align-items:center;justify-content:center;' +
      'background:rgba(0,0,0,0.72);color:#cfd2da;font:13px/1.6 monospace;user-select:none;z-index:10;';
    document.body.appendChild(this.root);

    window.addEventListener('keydown', (e) => {
      if (!this.open) return;
      const digit = TABS.findIndex((_, i) => e.code === `Digit${i + 1}`);
      if (digit >= 0) { e.preventDefault(); this.setTab(TABS[digit]!.id); return; }
      if (e.code === 'Tab') { e.preventDefault(); this.cycleTab(e.shiftKey ? -1 : 1); return; }
      if (UP_KEYS.has(e.code)) { e.preventDefault(); this.move(0, -1); return; }
      if (DOWN_KEYS.has(e.code)) { e.preventDefault(); this.move(0, 1); return; }
      if (LEFT_KEYS.has(e.code)) { e.preventDefault(); this.move(-1, 0); return; }
      if (RIGHT_KEYS.has(e.code)) { e.preventDefault(); this.move(1, 0); return; }
      if (e.code === 'Enter' || e.code === 'NumpadEnter') { e.preventDefault(); this.act(); return; }
      if (e.code === 'KeyX') { e.preventDefault(); this.actAll(); return; }
      if (e.code === 'KeyQ') { e.preventDefault(); this.depositAll(); return; }
      if ((e.code === 'Escape' || e.code === 'KeyE') && performance.now() - this.openedAt > 250) {
        e.preventDefault();
        this.close();
      }
    });
  }

  show(): void {
    this.open = true;
    this.openedAt = performance.now();
    this.pane = 'bag';
    this.sel = 0;
    this.root.style.display = 'flex';
    this.rebuild();
  }

  hide(): void {
    this.open = false;
    this.root.style.display = 'none';
  }

  private close(): void {
    if (!this.open) return;
    this.hide();
    this.onClose?.();
  }

  // ---- 패드 (main 이 부른다) ----
  padMove(dx: number, dy: number): void { if (this.open) this.move(dx, dy); }
  padA(): void { if (this.open) this.act(); }
  padX(): void { if (this.open) this.actAll(); }
  padLT(): void { if (this.open) this.depositAll(); }
  padB(): void { this.close(); }
  padTab(dir: number): void { if (this.open) this.cycleTab(dir); }

  private setTab(tab: Tab): void {
    if (this.tab === tab) return;
    this.tab = tab;
    this.sel = 0;
    this.pane = 'bag';
    this.rebuild();
  }

  private cycleTab(dir: number): void {
    const i = TABS.findIndex((t) => t.id === this.tab);
    this.setTab(TABS[(i + dir + TABS.length) % TABS.length]!.id);
  }

  private slots(pane: Pane): (InventorySlot | null)[] {
    return pane === 'bag' ? this.world.inventory : this.world.stash;
  }

  private cols(pane: Pane): number {
    return pane === 'stash' ? balance.lobby.stash.cols : balance.items.cols;
  }

  /** 커서 이동 — 격자 안에서는 칸을, 가장자리에서는 옆 격자로 (가방 ↔ 창고 좌우) */
  private move(dx: number, dy: number): void {
    if (this.tab !== 'store') return;
    const count = this.slots(this.pane).length;
    const cols = this.cols(this.pane);
    const rows = Math.max(1, Math.ceil(count / cols));
    const c = this.sel % cols;
    const r = Math.floor(this.sel / cols);
    let nc = c + dx;
    let nr = r + dy;
    if (nc >= cols && this.pane === 'bag') return this.jump('stash', r);
    if (nc < 0 && this.pane === 'stash') return this.jump('bag', r);
    nc = Math.max(0, Math.min(cols - 1, nc));
    nr = Math.max(0, Math.min(rows - 1, nr));
    const next = Math.min(count - 1, nr * cols + nc);
    if (next === this.sel) return;
    this.sel = next;
    this.rebuild();
  }

  private jump(pane: Pane, row: number): void {
    const count = this.slots(pane).length;
    if (count === 0) return;
    const cols = this.cols(pane);
    const rows = Math.ceil(count / cols);
    const r = Math.max(0, Math.min(rows - 1, row));
    this.pane = pane;
    // 왼쪽으로 건너가면 그 격자의 오른쪽 끝, 오른쪽으로 건너가면 왼쪽 끝
    this.sel = Math.min(count - 1, r * cols + (pane === 'bag' ? cols - 1 : 0));
    this.rebuild();
  }

  /** Enter·A·클릭 — 확장 탭이면 확장, 보관 탭이면 한 개 옮기기 */
  private act(): void {
    if (this.tab === 'expand') { Stash.expand(this.world); this.rebuild(); return; }
    Stash.move(this.world, this.pane, this.sel, this.pane === 'stash' ? 'bag' : 'stash', false);
    this.rebuild();
  }

  private actAll(): void {
    if (this.tab !== 'store') return;
    Stash.move(this.world, this.pane, this.sel, this.pane === 'stash' ? 'bag' : 'stash', true);
    this.rebuild();
  }

  private depositAll(): void {
    if (this.tab !== 'store') return;
    Stash.depositAll(this.world);
    this.rebuild();
  }

  private hoverAllowed(ev: MouseEvent): boolean {
    return !this.padMode && !(ev.movementX === 0 && ev.movementY === 0);
  }

  private key(pad: string, kb: string): string {
    return this.padMode ? pad : kb;
  }

  private rebuild(): void {
    const world = this.world;
    const panel = document.createElement('div');
    panel.style.cssText = `background:#15151b;border:1px solid #3a3a44;padding:20px 26px;width:${PANEL_PX}px;box-sizing:border-box;`;

    const head = document.createElement('div');
    head.style.cssText = 'display:flex;align-items:baseline;gap:18px;margin-bottom:14px;border-bottom:1px solid #23232b;padding-bottom:10px;';
    const title = document.createElement('div');
    title.textContent = `성물함 — 창고 ${Stash.stashedCount(world)}개 보관   ◆ ${world.gold}`;
    title.style.cssText = 'color:#e8c76a;font-size:15px;flex:none;';
    head.appendChild(title);
    const tabs = document.createElement('div');
    tabs.style.cssText = 'display:flex;gap:6px;margin-left:auto;';
    TABS.forEach((t, i) => {
      const b = document.createElement('div');
      const on = t.id === this.tab;
      b.textContent = `${i + 1}  ${t.label}`;
      b.style.cssText =
        `padding:4px 16px;border:1px solid ${on ? '#e8c76a' : '#3a3a44'};cursor:pointer;` +
        `color:${on ? '#e8c76a' : '#8a8f9a'};background:${on ? 'rgba(232,199,106,0.10)' : 'transparent'};`;
      b.onclick = () => this.setTab(t.id);
      tabs.appendChild(b);
    });
    head.appendChild(tabs);
    panel.appendChild(head);

    panel.appendChild(this.tab === 'store' ? this.buildStore() : this.buildExpand());

    const hint = document.createElement('div');
    hint.textContent = this.padMode
      ? 'D-패드·왼 스틱 커서(←→ 가방↔창고)   A 한 개 옮기기   X 칸 통째로   LT 가방 전부 넣기   LB/RB 탭   B 닫기'
      : 'WASD·화살표 커서(←→ 가방↔창고)   Enter·클릭 한 개   X·우클릭 칸 통째로   Q 가방 전부 넣기   Tab·1/2 탭   E / Esc 닫기';
    hint.style.cssText = 'margin-top:16px;color:#8a8f9a;border-top:1px solid #23232b;padding-top:10px;white-space:pre-line;';
    panel.appendChild(hint);
    this.root.replaceChildren(panel);
  }

  // ---- 보관 ----
  private buildStore(): HTMLElement {
    const world = this.world;
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:28px;align-items:flex-start;';

    const left = document.createElement('div');
    left.style.cssText = 'flex:none;display:flex;flex-direction:column;gap:14px;';
    left.appendChild(this.grid('bag', `내 가방 ${world.inventory.filter((s) => s).length}/${world.inventory.length}칸`, '#7fbfff'));
    const cur = this.slots(this.pane)[this.sel];
    left.appendChild(this.descBox(cur ? this.itemPopup(cur) : { title: `${PANE_LABEL[this.pane]} — 빈 칸`, lines: ['옮길 물건을 고른다'] }));
    row.appendChild(left);

    const right = document.createElement('div');
    right.style.cssText = 'flex:none;';
    right.appendChild(this.grid('stash', `창고 ${world.stash.filter((s) => s).length}/${world.stash.length}칸  (단계 ${world.stashTier}/${(balance.lobby.stash.tiers as unknown[]).length})`, '#e8c76a'));
    const deposit = document.createElement('div');
    deposit.textContent = `${this.key('LT', 'Q')}  가방 전부 창고에 넣기`;
    deposit.style.cssText = 'margin-top:10px;display:inline-block;padding:5px 14px;border:1px solid #3a3a44;color:#cfd2da;cursor:pointer;';
    deposit.onclick = () => this.depositAll();
    right.appendChild(deposit);
    const note = document.createElement('div');
    note.textContent = `창고 한 칸에 ${balance.lobby.stash.stackMax}개까지 · 로비에 들어오면 던전의 비석은 사라진다 — 창고에 넣은 것만 안전하다 (몸에 지키려면 가방 탭의 안전 주머니)`;
    note.style.cssText = 'margin-top:8px;color:#8a8f9a;font-size:11px;';
    right.appendChild(note);
    row.appendChild(right);
    return row;
  }

  private grid(pane: Pane, titleText: string, accent: string): HTMLElement {
    const box = document.createElement('div');
    const slots = this.slots(pane);
    const title = document.createElement('div');
    title.textContent = titleText;
    title.style.cssText = `color:${this.pane === pane ? accent : '#8a8f9a'};margin-bottom:6px;`;
    box.appendChild(title);
    const grid = document.createElement('div');
    grid.style.cssText = `display:grid;grid-template-columns:repeat(${this.cols(pane)}, ${CELL_PX}px);gap:${GAP_PX}px;`;
    slots.forEach((slot, i) => {
      const cell = document.createElement('div');
      const here = this.pane === pane && this.sel === i;
      cell.style.cssText =
        CELL +
        `border:1px solid ${here ? accent : '#3a3a44'};` +
        `background:${here ? 'rgba(127,191,255,0.12)' : 'rgba(255,255,255,0.02)'};cursor:${slot ? 'pointer' : 'default'};`;
      if (slot) {
        const isSigil = slot.kind === 'sigil' && !!slot.sigilId;
        const isEquip = slot.kind === 'equip' && !!slot.equipId;
        const icon = isSigil ? sigilIcon(slot.sigilId!, ICON_PX) : isEquip ? equipIcon(slot.equipId!, ICON_PX) : itemIcon(slot.kind, ICON_PX);
        icon.style.cssText += 'position:absolute;left:50%;top:24px;transform:translate(-50%,-50%);';
        cell.appendChild(icon);
        const label = document.createElement('div');
        label.textContent = isSigil ? sigilDef(slot.sigilId!).name.slice(0, 4) : isEquip ? equipDef(slot.equipId!).name.slice(0, 5) : `×${slot.count}`;
        label.style.cssText = isSigil || isEquip
          ? `position:absolute;bottom:3px;width:100%;text-align:center;font-size:10px;color:${isSigil ? sigilDef(slot.sigilId!).color : equipDef(slot.equipId!).color};`
          : 'position:absolute;bottom:3px;right:5px;font-size:11px;color:#cfd2da;';
        cell.appendChild(label);
      }
      cell.onclick = () => { this.pane = pane; this.sel = i; this.act(); };
      cell.oncontextmenu = (e) => { e.preventDefault(); this.pane = pane; this.sel = i; this.actAll(); };
      cell.onmousemove = (ev) => {
        if (!this.hoverAllowed(ev) || (this.pane === pane && this.sel === i)) return;
        this.pane = pane;
        this.sel = i;
        this.rebuild();
      };
      grid.appendChild(cell);
    });
    box.appendChild(grid);
    return box;
  }

  /** 커서 칸 설명 — 물건 설명 + 이 창에서의 조작 */
  private itemPopup(slot: InventorySlot): PopupContent {
    const world = this.world;
    let content: PopupContent;
    if (slot.kind === 'equip' && slot.equipId) content = equipPopup(world, slot.equipId, ` (${PANE_LABEL[this.pane]})`);
    else if (slot.kind === 'sigil' && slot.sigilId) content = sigilPopup(world, slot.sigilId, ` (${PANE_LABEL[this.pane]})`);
    else content = consumablePopup(world, slot.kind, slot.count, ` (${PANE_LABEL[this.pane]})`);
    if (itemDef(slot.kind as ItemKind).passive) {
      content.usefulText = '창고 확장 재료 — 주우면 안전 주머니로 먼저 들어간다';
      content.useful = true;
    }
    const to = this.pane === 'stash' ? '가방' : '창고';
    content.actions = [{ key: this.key('A', 'Enter'), label: `${to}로 한 개` }];
    if (slot.count > 1) content.actions.push({ key: this.key('X', 'X'), label: `${to}로 전부 (×${slot.count})` });
    return content;
  }

  private descBox(content: PopupContent): HTMLElement {
    const box = document.createElement('div');
    box.style.cssText =
      `width:${DESC_PX}px;box-sizing:border-box;padding:10px 12px;min-height:120px;` +
      'background:rgba(12,14,18,0.6);border:1px solid #3a3a44;border-radius:6px;font:12px/1.55 monospace;color:#cfd2da;';
    const title = document.createElement('div');
    title.textContent = content.title;
    title.style.cssText = 'color:#e8c76a;font-size:13px;margin-bottom:4px;';
    box.appendChild(title);
    for (const line of content.lines) {
      const el = document.createElement('div');
      el.textContent = line;
      box.appendChild(el);
    }
    if (content.usefulText) {
      const el = document.createElement('div');
      el.textContent = content.usefulText;
      el.style.cssText = `margin-top:4px;color:${content.useful ? '#7fd27f' : '#8a8f9a'};`;
      box.appendChild(el);
    }
    if (content.actions && content.actions.length > 0) {
      const list = document.createElement('div');
      list.style.cssText = 'margin-top:6px;padding-top:6px;border-top:1px solid #23232b;display:flex;flex-direction:column;gap:3px;';
      for (const a of content.actions) {
        const line = document.createElement('div');
        line.style.cssText = 'display:flex;align-items:center;font-size:11px;color:#cfd2da;';
        line.appendChild(keycap(a.key, this.padMode));
        const label = document.createElement('span');
        label.textContent = a.label;
        line.appendChild(label);
        list.appendChild(line);
      }
      box.appendChild(list);
    }
    return box;
  }

  // ---- 확장 ----
  private buildExpand(): HTMLElement {
    const world = this.world;
    const box = document.createElement('div');
    box.style.cssText = 'padding:6px 4px;min-height:200px;';
    const cur = document.createElement('div');
    cur.textContent = `지금 창고 ${world.stash.length}칸`;
    cur.style.cssText = 'color:#cfd2da;font-size:14px;margin-bottom:12px;';
    box.appendChild(cur);

    const list = document.createElement('div');
    list.style.cssText = 'display:flex;flex-direction:column;gap:4px;max-width:640px;';
    const tiers = balance.lobby.stash.tiers as { slots: number; gold: number; key: string | null }[];
    let cap = balance.lobby.stash.baseSlots;
    tiers.forEach((t, i) => {
      cap += t.slots;
      const done = i < world.stashTier;
      const next = i === world.stashTier;
      const line = document.createElement('div');
      line.style.cssText =
        `display:flex;gap:14px;padding:6px 10px;border-top:1px solid #23232b;` +
        (next ? 'background:rgba(232,199,106,0.08);box-shadow:inset 2px 0 0 #e8c76a;' : '');
      const name = document.createElement('span');
      name.textContent = `${i + 1}단계 — ${cap}칸`;
      name.style.cssText = `width:150px;color:${done ? '#9fe870' : next ? '#e8c76a' : '#6c7280'};`;
      line.appendChild(name);
      const cost = document.createElement('span');
      const keyName = t.key ? itemDef(t.key as ItemKind).name : null;
      cost.textContent = done ? '완료' : `◆ ${t.gold}${keyName ? `  +  ${keyName} 1` : ''}`;
      cost.style.cssText = `width:260px;color:${done ? '#6c7280' : '#cfd2da'};`;
      line.appendChild(cost);
      if (next) {
        const c = Stash.canExpand(world);
        const st = document.createElement('span');
        st.textContent = c.ok
          ? '확장 가능'
          : c.reason === 'no_gold'
            ? `골드 부족 (◆ ${world.gold})`
            : c.reason === 'no_key'
              ? `${keyName} 이 없다 — 상자·보스 주머니에서 나온다`
              : '';
        st.style.color = c.ok ? '#7fd27f' : '#a05050';
        line.appendChild(st);
        line.style.cursor = c.ok ? 'pointer' : 'default';
        line.onclick = () => this.act();
      }
      list.appendChild(line);
    });
    box.appendChild(list);

    const c = Stash.canExpand(world);
    const btn = document.createElement('div');
    btn.textContent = c.ok ? `${this.key('A', 'Enter')}  확장한다` : c.reason === 'max' ? '더 넓힐 수 없다 — 다음 구역에서' : `${this.key('A', 'Enter')}  확장 (지금은 못 한다)`;
    btn.style.cssText =
      `margin-top:14px;display:inline-block;padding:6px 16px;border:1px solid ${c.ok ? '#e8c76a' : '#3a3a44'};` +
      `color:${c.ok ? '#e8c76a' : '#6c7280'};cursor:${c.ok ? 'pointer' : 'default'};`;
    btn.onclick = () => this.act();
    box.appendChild(btn);
    const note = document.createElement('div');
    note.textContent = '열쇠는 안전 주머니·가방·창고 어디에 있어도 된다. 열쇠 大는 다음 구역의 확장에 쓴다';
    note.style.cssText = 'margin-top:10px;color:#8a8f9a;font-size:11px;';
    box.appendChild(note);
    return box;
  }
}
