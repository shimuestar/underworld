// 창고(성물함) 창 — 보관 · 확장 두 탭. DOM 오버레이, 열려 있는 동안 시뮬레이션은 main 이 멈춘다. docs/systems/stash.md §5.
// 보관 (2026-09-08 사용자 배치): 왼쪽 = 내 가방(인벤토리), 오른쪽 = 창고, 가운데 아래 = 퀵슬롯.
//   창고 칸을 퀵슬롯에 끌어다 놓으면(숫자키·패드도) 물건이 가방으로 들어오며 등록된다 — 가방에 자리가 없으면 거절(Stash.toBagAndBind).
//   커서 하나(마우스·키보드·패드 공용). ←→ 가방↔창고, ↓ 퀵슬롯. Enter·A·클릭 = 한 개 옮기기, X·우클릭 = 칸 통째로(퀵슬롯은 등록 해제),
//   1~4 = 커서 칸을 그 퀵슬롯에, Q·LT = 가방 전부 넣기, 드래그·A 길게 집어 옮기기. 탭은 Tab·LB/RB.
//   안전 주머니는 여기 없다 — 캐릭터의 것이라 가방 탭(InventoryUI)에서만 다룬다.
// 옮기기·확장 규칙은 전부 systems/Stash — 여기는 그리기와 입력만.

import { balance } from '../core/Balance';
import { equipDef } from '../core/EquipData';
import { bindQuickslot, countOf, itemDef, moveSlot, unbindQuickslot } from '../core/Inventory';
import { sigilDef } from '../core/SigilData';
import type { InventorySlot, ItemKind, World } from '../core/World';
import * as Stash from '../systems/Stash';
import { beginDrag } from './DragDrop';
import { equipIcon, itemIcon, sigilIcon } from './ItemIcons';
import { consumablePopup, equipPopup, keycap, sigilPopup, type PopupContent } from './ItemPopup';

const CELL_PX = 64;
const GAP_PX = 8;
const ICON_PX = 28;
const CELL = `width:${CELL_PX}px;height:${CELL_PX}px;box-sizing:border-box;position:relative;`;
const DESC_PX = 352; // 왼쪽 열(가방 5열) 폭에 맞춘다
/** 창 폭 — 왼쪽 열(352) + 사이 28 + 창고 10열(712) + 안쪽 여백 26×2 */
const PANEL_PX = 1144;
/** 퀵슬롯 십자 — HUD 마름모 넷과 같은 자리(위 1·오른쪽 2·아래 3·왼쪽 4). grid-area 'row / col' (InventoryUI 와 같다) */
const CROSS_AREAS = ['1 / 2', '2 / 3', '3 / 2', '2 / 1'];
/** 십자 안 커서 이동 — [칸][방향(0 ←, 1 →, 2 ↑, 3 ↓)] → 다음 칸, -1 = 가방으로(위로 나간다), null = 제자리 */
const CROSS_NAV: Record<number, (number | null)[]> = {
  0: [3, 1, -1, 2],
  1: [3, null, 0, 2],
  2: [3, 1, 0, null],
  3: [null, 1, 0, 2],
};

type Tab = 'store' | 'expand';
const TABS: { id: Tab; label: string }[] = [
  { id: 'store', label: '보관' },
  { id: 'expand', label: '확장' },
];
const UP_KEYS = new Set(['KeyW', 'ArrowUp']);
const DOWN_KEYS = new Set(['KeyS', 'ArrowDown']);
const LEFT_KEYS = new Set(['KeyA', 'ArrowLeft']);
const RIGHT_KEYS = new Set(['KeyD', 'ArrowRight']);

/** 이 창이 다루는 격자 — 가방·창고·퀵슬롯. (안전 주머니는 가방 탭의 것) */
type Pane = 'bag' | 'stash' | 'quick';
const PANE_LABEL: Record<Pane, string> = { bag: '가방', stash: '창고', quick: '퀵슬롯' };

export class StashUI {
  private readonly root: HTMLDivElement;
  open = false;
  private tab: Tab = 'store';
  private pane: Pane = 'bag';
  /** 격자별 커서 — 가방 / 창고 / 퀵슬롯 */
  private sel = 0;
  private selS = 0;
  private selQ = 0;
  /** 패드 집어 들기 — 들고 있는 칸 (A 길게로 들고, A 놓기 / B 취소) */
  private carry: { pane: 'bag' | 'stash'; index: number } | null = null;
  private aHoldTicks = 0;
  private aConsumed = false;
  private openedAt = 0;
  /** 패드로 조작 중 — 안내·키캡을 패드 표기로 (main 이 틱마다 갱신) */
  padMode = false;
  /** 퀵슬롯 칸 키 표기 — main 이 장치(패드/키보드)와 바인딩을 따라 채운다. 기본은 1~4 (가방 탭과 같다) */
  keyLabel: (index: number, pad: boolean) => string = (i) => String(i + 1);
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
      if (e.code === 'Tab') { e.preventDefault(); this.cycleTab(e.shiftKey ? -1 : 1); return; }
      if (UP_KEYS.has(e.code)) { e.preventDefault(); this.move(0, -1); return; }
      if (DOWN_KEYS.has(e.code)) { e.preventDefault(); this.move(0, 1); return; }
      if (LEFT_KEYS.has(e.code)) { e.preventDefault(); this.move(-1, 0); return; }
      if (RIGHT_KEYS.has(e.code)) { e.preventDefault(); this.move(1, 0); return; }
      if (e.code === 'Enter' || e.code === 'NumpadEnter') { e.preventDefault(); this.act(); return; }
      if (e.code === 'KeyX' || e.code === 'Delete') { e.preventDefault(); this.actAll(); return; }
      if (e.code === 'KeyQ') { e.preventDefault(); this.depositAll(); return; }
      if ((e.code === 'Escape' || e.code === 'KeyE') && performance.now() - this.openedAt > 250) {
        e.preventDefault();
        this.cancelOrClose();
        return;
      }
      // 숫자 키 — 커서 칸(가방·창고)을 그 퀵슬롯에 등록. 창고 칸이면 가방으로 들어오며 등록된다
      const digit = Number.parseInt(e.code.replace('Digit', ''), 10);
      if (!e.code.startsWith('Digit') || Number.isNaN(digit)) return;
      const index = digit - 1;
      if (index < 0 || index >= this.world.quickslots.length) return;
      e.preventDefault();
      this.bindCursor(index);
    });
  }

  show(): void {
    this.open = true;
    this.openedAt = performance.now();
    this.pane = 'bag';
    this.sel = 0;
    this.selS = 0;
    this.selQ = 0;
    this.carry = null;
    this.aHoldTicks = 0;
    this.aConsumed = false;
    this.root.style.display = 'flex';
    this.rebuild();
  }

  hide(): void {
    this.open = false;
    this.carry = null;
    this.root.style.display = 'none';
  }

  private close(): void {
    if (!this.open) return;
    this.hide();
    this.onClose?.();
  }

  private cancelOrClose(): void {
    if (this.carry) { this.carry = null; this.rebuild(); return; }
    this.close();
  }

  // ---- 패드 (main 이 틱마다 부른다) ----
  padMove(dx: number, dy: number): void { if (this.open) this.move(dx, dy); }
  /** A — 짧게 떼면 옮기기/놓기, padPickHoldTicks 넘게 누르면 커서 칸 집어 들기 (가방 탭과 같은 규약) */
  padA(held: boolean): void {
    if (!this.open) return;
    if (held) {
      this.aHoldTicks++;
      if (!this.carry && !this.aConsumed && this.aHoldTicks >= balance.loot.ui.padPickHoldTicks) {
        this.aConsumed = true;
        this.pickUp();
      }
      return;
    }
    if (this.aHoldTicks === 0) return;
    const consumed = this.aConsumed;
    this.aHoldTicks = 0;
    this.aConsumed = false;
    if (consumed) return;
    this.act();
  }
  padX(): void { if (this.open) this.actAll(); }
  padLT(): void { if (this.open) this.depositAll(); }
  padB(): void { if (this.open) this.cancelOrClose(); }
  padTab(dir: number): void { if (this.open) this.cycleTab(dir); }

  private setTab(tab: Tab): void {
    if (this.tab === tab) return;
    this.tab = tab;
    this.pane = 'bag';
    this.carry = null;
    this.rebuild();
  }

  private cycleTab(dir: number): void {
    const i = TABS.findIndex((t) => t.id === this.tab);
    this.setTab(TABS[(i + dir + TABS.length) % TABS.length]!.id);
  }

  private slots(pane: 'bag' | 'stash'): (InventorySlot | null)[] {
    return pane === 'bag' ? this.world.inventory : this.world.stash;
  }

  private cols(pane: 'bag' | 'stash'): number {
    return pane === 'stash' ? balance.lobby.stash.cols : balance.items.cols;
  }

  private cursorOf(pane: 'bag' | 'stash'): number {
    return pane === 'bag' ? this.sel : this.selS;
  }

  private setCursor(pane: 'bag' | 'stash', index: number): void {
    if (pane === 'bag') this.sel = index;
    else this.selS = index;
  }

  /** 커서 이동 — 격자 안에서는 칸을, 가장자리에서는 옆 격자로 (가방 ↔ 창고 좌우, 아래는 퀵슬롯) */
  private move(dx: number, dy: number): void {
    if (this.tab !== 'store') return;
    const q = this.world.quickslots.length;
    if (this.pane === 'quick') {
      if (q === CROSS_AREAS.length) {
        const dir = dx < 0 ? 0 : dx > 0 ? 1 : dy < 0 ? 2 : 3;
        const next = CROSS_NAV[this.selQ]?.[dir] ?? null;
        if (next === -1) this.jump('bag', Math.ceil(this.world.inventory.length / this.cols('bag')) - 1, 'keep');
        else if (next !== null) this.selQ = next;
      } else if (dy < 0) {
        this.jump('bag', Math.ceil(this.world.inventory.length / this.cols('bag')) - 1, 'keep');
      } else if (dx !== 0) {
        this.selQ = Math.max(0, Math.min(q - 1, this.selQ + dx));
      }
      this.rebuild();
      return;
    }
    const pane = this.pane;
    const count = this.slots(pane).length;
    const cols = this.cols(pane);
    const rows = Math.max(1, Math.ceil(count / cols));
    const cur = this.cursorOf(pane);
    const c = cur % cols;
    const r = Math.floor(cur / cols);
    let nc = c + dx;
    let nr = r + dy;
    if (nc >= cols && pane === 'bag') return this.jump('stash', r, 'left');
    if (nc < 0 && pane === 'stash') return this.jump('bag', r, 'right');
    if (nr >= rows && q > 0) {
      // 아래로 나가면 퀵슬롯 — 가방에서는 십자의 왼쪽 칸, 창고에서는 오른쪽 칸
      this.pane = 'quick';
      this.selQ = q === CROSS_AREAS.length ? (pane === 'bag' ? 3 : 1) : 0;
      this.rebuild();
      return;
    }
    nc = Math.max(0, Math.min(cols - 1, nc));
    nr = Math.max(0, Math.min(rows - 1, nr));
    const next = Math.min(count - 1, nr * cols + nc);
    if (next === cur) return;
    this.setCursor(pane, next);
    this.rebuild();
  }

  /** 옆 격자로 건너간다 — side: 들어가는 쪽 끝(left/right) 또는 커서 열 유지(keep) */
  private jump(pane: 'bag' | 'stash', row: number, side: 'left' | 'right' | 'keep'): void {
    const count = this.slots(pane).length;
    if (count === 0) return;
    const cols = this.cols(pane);
    const rows = Math.ceil(count / cols);
    const r = Math.max(0, Math.min(rows - 1, row));
    const col = side === 'left' ? 0 : side === 'right' ? cols - 1 : Math.min(cols - 1, this.cursorOf(pane) % cols);
    this.pane = pane;
    this.setCursor(pane, Math.min(count - 1, r * cols + col));
    this.rebuild();
  }

  /** Enter·A·클릭 — 확장 탭이면 확장. 보관: 들고 있으면 놓기, 가방·창고 칸은 반대편으로 한 개, 퀵슬롯 칸은 (들고 있을 때만) 등록 */
  private act(): void {
    if (this.tab === 'expand') { Stash.expand(this.world); this.rebuild(); return; }
    if (this.carry) { this.place(); return; }
    if (this.pane === 'quick') { this.rebuild(); return; }
    Stash.move(this.world, this.pane, this.cursorOf(this.pane), this.pane === 'stash' ? 'bag' : 'stash', false);
    this.rebuild();
  }

  /** X·우클릭 — 가방·창고 칸은 통째로 반대편에, 퀵슬롯 칸은 등록 해제 */
  private actAll(): void {
    if (this.tab !== 'store' || this.carry) return;
    if (this.pane === 'quick') { unbindQuickslot(this.world, this.selQ); this.rebuild(); return; }
    Stash.move(this.world, this.pane, this.cursorOf(this.pane), this.pane === 'stash' ? 'bag' : 'stash', true);
    this.rebuild();
  }

  /** 숫자 키 — 커서 칸을 퀵슬롯 index 에. 창고 칸이면 가방으로 들어오며 등록(자리 없으면 거절) */
  private bindCursor(index: number): void {
    if (this.tab !== 'store') return;
    if (this.pane === 'quick') return;
    this.bindFrom(this.pane, this.cursorOf(this.pane), index);
  }

  private bindFrom(pane: 'bag' | 'stash', from: number, quick: number): void {
    const world = this.world;
    if (pane === 'stash') {
      Stash.toBagAndBind(world, from, quick);
    } else {
      const slot = world.inventory[from];
      if (slot && Stash.isBindable(slot.kind)) bindQuickslot(world, quick, slot.kind);
      else if (slot) world.events.emit('stash_denied', { reason: 'not_bindable', from: 'bag', to: 'quick', kind: slot.kind });
    }
    this.rebuild();
  }

  private depositAll(): void {
    if (this.tab !== 'store') return;
    Stash.depositAll(this.world);
    this.rebuild();
  }

  // ---- 집어 옮기기 (패드 A 길게 · 마우스 드래그) ----
  private pickUp(): void {
    if (this.pane === 'quick' || !this.slots(this.pane)[this.cursorOf(this.pane)]) return;
    this.carry = { pane: this.pane, index: this.cursorOf(this.pane) };
    this.rebuild();
  }

  private place(): void {
    const carry = this.carry;
    if (!carry) return;
    this.carry = null;
    const key = this.pane === 'quick' ? `q${this.selQ}` : this.pane === 'bag' ? `b${this.sel}` : `s${this.selS}`;
    this.onDrop(carry.pane, carry.index, key);
  }

  /** 드래그·놓기 — from[fromIdx] 를 key 칸에. 가방 ↔ 창고는 그 칸에 놓기(Stash.place), 퀵슬롯은 등록(창고에서면 가방으로 들어온다) */
  private onDrop(from: 'bag' | 'stash' | 'quick', fromIdx: number, key: string | null): void {
    const world = this.world;
    const to: Pane | null = key?.startsWith('b') ? 'bag' : key?.startsWith('s') ? 'stash' : key?.startsWith('q') ? 'quick' : null;
    const toIdx = key ? Number.parseInt(key.slice(1), 10) : -1;
    if (from === 'quick') {
      if (to === 'quick' && toIdx >= 0 && toIdx !== fromIdx) {
        const a = world.quickslots[fromIdx] ?? null;
        world.quickslots[fromIdx] = world.quickslots[toIdx] ?? null;
        world.quickslots[toIdx] = a;
      } else if (to !== 'quick') {
        unbindQuickslot(world, fromIdx); // 끌어내 놓으면 등록 해제 (가방 탭과 같다)
      }
      this.pane = 'quick';
      if (to === 'quick' && toIdx >= 0) this.selQ = toIdx;
      this.rebuild();
      return;
    }
    if (to === 'quick' && toIdx >= 0) {
      this.bindFrom(from, fromIdx, toIdx);
      this.pane = 'quick';
      this.selQ = toIdx;
      this.rebuild();
      return;
    }
    if (to === 'bag' || to === 'stash') {
      if (from === to) {
        if (from === 'bag') moveSlot(world, fromIdx, toIdx);
        else Stash.place(world, 'stash', fromIdx, 'stash', toIdx);
      } else {
        Stash.place(world, from, fromIdx, to, toIdx);
      }
      this.pane = to;
      this.setCursor(to, toIdx);
    }
    this.rebuild();
  }

  private carriedSlot(): InventorySlot | null {
    const c = this.carry;
    return c ? (this.slots(c.pane)[c.index] ?? null) : null;
  }

  private hoverAllowed(ev: MouseEvent): boolean {
    return !this.padMode && !(ev.movementX === 0 && ev.movementY === 0);
  }

  private key(pad: string, kb: string): string {
    return this.padMode ? pad : kb;
  }

  private rebuild(): void {
    const world = this.world;
    if (this.carry && !this.carriedSlot()) this.carry = null;
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
    TABS.forEach((t) => {
      const b = document.createElement('div');
      const on = t.id === this.tab;
      b.textContent = t.label;
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
      ? 'D-패드·왼 스틱 커서(←→ 가방↔창고, ↓ 퀵슬롯)   A 한 개 옮기기 · A 길게 집어 옮기기 → A 놓기(퀵슬롯에 놓으면 등록) / B 취소   X 칸 통째로(퀵슬롯은 해제)   LT 가방 전부 넣기   LB/RB 탭   B 닫기'
      : 'WASD·화살표 커서(←→ 가방↔창고, ↓ 퀵슬롯)   Enter·클릭 한 개   X·우클릭 칸 통째로(퀵슬롯은 해제)   1~4 커서 칸을 퀵슬롯에   드래그로 옮기기(퀵슬롯에 놓으면 등록)   Q 가방 전부 넣기   Tab 탭   E / Esc 닫기';
    hint.style.cssText = 'margin-top:16px;color:#8a8f9a;border-top:1px solid #23232b;padding-top:10px;white-space:pre-line;';
    panel.appendChild(hint);
    this.root.replaceChildren(panel);
  }

  // ---- 보관 ----
  private buildStore(): HTMLElement {
    const world = this.world;
    const wrap = document.createElement('div');

    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:28px;align-items:flex-start;';
    wrap.appendChild(row);

    const left = document.createElement('div');
    left.style.cssText = 'flex:none;display:flex;flex-direction:column;gap:14px;';
    left.appendChild(this.grid('bag', `내 가방 ${world.inventory.filter((s) => s).length}/${world.inventory.length}칸`, '#7fbfff'));
    left.appendChild(this.descBox(this.cursorDesc()));
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

    // 가운데 아래 — 퀵슬롯. 창고 칸을 여기 놓으면 가방으로 들어오며 등록된다
    const bottom = document.createElement('div');
    bottom.style.cssText = 'display:flex;justify-content:center;margin-top:18px;';
    bottom.appendChild(this.buildQuickslots());
    wrap.appendChild(bottom);
    return wrap;
  }

  private grid(pane: 'bag' | 'stash', titleText: string, accent: string): HTMLElement {
    const box = document.createElement('div');
    const slots = this.slots(pane);
    const title = document.createElement('div');
    title.textContent = titleText;
    title.style.cssText = `color:${this.pane === pane ? accent : '#8a8f9a'};margin-bottom:6px;`;
    box.appendChild(title);
    const grid = document.createElement('div');
    grid.style.cssText = `display:grid;grid-template-columns:repeat(${this.cols(pane)}, ${CELL_PX}px);gap:${GAP_PX}px;`;
    const keyPrefix = pane === 'bag' ? 'b' : 's';
    slots.forEach((slot, i) => {
      const cell = document.createElement('div');
      cell.dataset['key'] = `${keyPrefix}${i}`;
      const here = this.pane === pane && this.cursorOf(pane) === i;
      cell.style.cssText =
        CELL +
        `border:1px solid ${here ? accent : '#3a3a44'};` +
        `background:${here ? 'rgba(127,191,255,0.12)' : 'rgba(255,255,255,0.02)'};cursor:${slot ? 'pointer' : 'default'};`;
      if (this.carry && this.carry.pane === pane && this.carry.index === i) cell.style.opacity = '0.35';
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
        // 퀵슬롯에 등록된 종류 — 왼쪽 위 번호 (가방 탭과 같다)
        const bound = this.world.quickslots.indexOf(slot.kind);
        if (bound >= 0 && pane === 'bag') {
          const tag = document.createElement('div');
          tag.textContent = String(bound + 1);
          tag.style.cssText = 'position:absolute;top:2px;left:5px;font-size:10px;color:#e8c76a;';
          cell.appendChild(tag);
        }
        const dragIcon = icon.outerHTML;
        cell.onpointerdown = (ev) => beginDrag(ev, dragIcon, (key) => this.onDrop(pane, i, key));
      }
      cell.onclick = () => { this.pane = pane; this.setCursor(pane, i); this.act(); };
      cell.oncontextmenu = (e) => { e.preventDefault(); this.pane = pane; this.setCursor(pane, i); this.actAll(); };
      cell.onmousemove = (ev) => {
        if (!this.hoverAllowed(ev) || (this.pane === pane && this.cursorOf(pane) === i)) return;
        this.pane = pane;
        this.setCursor(pane, i);
        this.rebuild();
      };
      grid.appendChild(cell);
    });
    box.appendChild(grid);
    return box;
  }

  /** 퀵슬롯 — 가방 탭의 십자와 같은 꼴. 창고·가방 칸을 끌어다 놓거나 숫자키로 등록한다 */
  private buildQuickslots(): HTMLElement {
    const world = this.world;
    const box = document.createElement('div');
    box.style.cssText = `width:${CELL_PX * 3 + GAP_PX * 2}px;flex:none;`;
    const title = document.createElement('div');
    title.textContent = `퀵슬롯 — 창고 칸을 놓으면 가방으로 들어오며 등록`;
    title.style.cssText = `color:${this.pane === 'quick' ? '#e8c76a' : '#8a8f9a'};margin-bottom:6px;white-space:nowrap;`;
    box.appendChild(title);
    const cross = world.quickslots.length === CROSS_AREAS.length;
    const grid = document.createElement('div');
    grid.style.cssText = cross
      ? `display:grid;grid-template-columns:repeat(3, ${CELL_PX}px);grid-template-rows:repeat(3, ${CELL_PX}px);gap:${GAP_PX}px;`
      : `display:flex;flex-wrap:wrap;gap:${GAP_PX}px;`;
    const armed = this.carry !== null;
    if (cross) {
      const center = document.createElement('div');
      center.style.cssText =
        'grid-area:2 / 2;display:flex;align-items:center;justify-content:center;text-align:center;' +
        `font-size:10px;line-height:1.5;white-space:pre;color:${armed ? '#e8c76a' : '#555c66'};`;
      center.textContent = armed ? (this.padMode ? 'A 로\n등록' : '칸에 놓아\n등록') : this.padMode ? 'D-패드' : '1~4';
      grid.appendChild(center);
    }
    world.quickslots.forEach((kind, i) => {
      const cell = document.createElement('div');
      cell.dataset['key'] = `q${i}`;
      const here = this.pane === 'quick' && this.selQ === i;
      cell.style.cssText =
        CELL +
        (cross ? `grid-area:${CROSS_AREAS[i]};` : '') +
        `border:1px solid ${here ? '#7fbfff' : armed ? '#e8c76a' : '#3a3a44'};` +
        `background:${here ? 'rgba(127,191,255,0.12)' : kind ? 'rgba(232,199,106,0.07)' : 'rgba(255,255,255,0.02)'};cursor:pointer;`;
      const key = document.createElement('div');
      key.textContent = this.keyLabel(i, this.padMode);
      key.className = this.padMode ? 'padkey' : '';
      key.style.cssText = this.padMode
        ? 'position:absolute;top:3px;left:3px;width:16px;height:16px;font-size:9px;color:#8a8f9a;'
        : 'position:absolute;top:2px;left:5px;font-size:10px;color:#8a8f9a;';
      cell.appendChild(key);
      if (kind) {
        const def = itemDef(kind);
        const count = countOf(world, kind);
        const icon = itemIcon(kind, ICON_PX);
        icon.style.cssText += `position:absolute;left:50%;top:24px;transform:translate(-50%,-50%);opacity:${count > 0 ? 1 : 0.25};`;
        cell.appendChild(icon);
        const name = document.createElement('div');
        name.textContent = `${def.short ?? def.name.slice(0, 2)} ${count}`;
        name.style.cssText = `position:absolute;bottom:3px;width:100%;text-align:center;font-size:10px;color:${count > 0 ? '#cfd2da' : '#555c66'};`;
        cell.appendChild(name);
        const dragIcon = itemIcon(kind, ICON_PX).outerHTML;
        cell.onpointerdown = (ev) => beginDrag(ev, dragIcon, (k) => this.onDrop('quick', i, k));
      }
      cell.onclick = () => { this.pane = 'quick'; this.selQ = i; this.act(); };
      cell.oncontextmenu = (ev) => { ev.preventDefault(); this.pane = 'quick'; this.selQ = i; this.actAll(); };
      cell.onmousemove = (ev) => {
        if (!this.hoverAllowed(ev) || (this.pane === 'quick' && this.selQ === i)) return;
        this.pane = 'quick';
        this.selQ = i;
        this.rebuild();
      };
      grid.appendChild(cell);
    });
    box.appendChild(grid);
    return box;
  }

  /** 커서 칸 설명 — 격자에 따라 다르다 */
  private cursorDesc(): PopupContent {
    const world = this.world;
    if (this.carry) {
      const slot = this.carriedSlot()!;
      const where = this.pane === 'quick' ? `퀵슬롯 ${this.selQ + 1}에 등록` : this.pane === this.carry.pane ? '같은 격자 안에서 자리 옮기기' : `${PANE_LABEL[this.pane]}의 그 칸에 놓기`;
      return {
        title: `${itemDef(slot.kind as ItemKind).name} 들고 있음`,
        lines: [where, this.pane === 'quick' && this.carry.pane === 'stash' ? '창고의 것은 가방으로 들어오며 등록된다 — 가방에 자리가 있어야 한다' : ''].filter(Boolean),
        actions: [{ key: this.key('A', 'Enter'), label: '놓기' }, { key: this.key('B', 'Esc'), label: '취소' }],
      };
    }
    if (this.pane === 'quick') {
      const kind = world.quickslots[this.selQ] ?? null;
      if (!kind) {
        return {
          title: `퀵슬롯 ${this.selQ + 1} — 비어 있다`,
          lines: ['가방·창고 칸을 끌어다 놓거나, 커서 칸에서 숫자키로 등록한다', '창고의 것은 가방으로 들어오며 등록된다 — 가방에 자리가 없으면 안 된다'],
        };
      }
      const content = consumablePopup(world, kind, countOf(world, kind), ' (퀵슬롯)');
      content.actions = [{ key: this.key('X', 'X·우클릭'), label: '등록 해제' }];
      return content;
    }
    const slot = this.slots(this.pane)[this.cursorOf(this.pane)];
    if (!slot) return { title: `${PANE_LABEL[this.pane]} — 빈 칸`, lines: ['옮길 물건을 고른다'] };
    return this.itemPopup(slot);
  }

  private itemPopup(slot: InventorySlot): PopupContent {
    const world = this.world;
    const where = this.pane === 'quick' ? '' : ` (${PANE_LABEL[this.pane]})`;
    let content: PopupContent;
    if (slot.kind === 'equip' && slot.equipId) content = equipPopup(world, slot.equipId, where);
    else if (slot.kind === 'sigil' && slot.sigilId) content = sigilPopup(world, slot.sigilId, where);
    else content = consumablePopup(world, slot.kind, slot.count, where);
    if (itemDef(slot.kind as ItemKind).passive) {
      content.usefulText = '창고 확장 재료 — 주우면 안전 주머니로 먼저 들어간다';
      content.useful = true;
    }
    const to = this.pane === 'stash' ? '가방' : '창고';
    content.actions = [{ key: this.key('A', 'Enter'), label: `${to}로 한 개` }];
    if (slot.count > 1) content.actions.push({ key: this.key('X', 'X·우클릭'), label: `${to}로 전부 (×${slot.count})` });
    if (Stash.isBindable(slot.kind)) {
      content.actions.push({
        key: this.key('A 길게', `1~${world.quickslots.length}·드래그`),
        label: this.pane === 'stash' ? '퀵슬롯에 등록 — 가방으로 들어온다 (자리 필요)' : '퀵슬롯에 등록',
      });
    } else {
      content.actions.push({ key: this.key('A 길게', '드래그'), label: '집어 옮기기' });
    }
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
