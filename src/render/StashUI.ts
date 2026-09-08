// 창고(성물함) 창 — 보관 · 확장 두 탭. DOM 오버레이, 열려 있는 동안 시뮬레이션은 main 이 멈춘다. docs/systems/stash.md §5.
// 보관 (2026-09-08 사용자 배치): 왼쪽 = 몸(착용 장비 7칸 · 새긴 각인 5칸) + 내 가방 + 설명 칸, 오른쪽 = 창고 한 페이지(5×7)와 페이지 탭 1~4,
// 가운데 아래 = 퀵슬롯 십자. 안전 주머니는 여기 없다 — 캐릭터의 것이라 가방 탭(InventoryUI)에서만 다룬다.
//   창고 칸을 퀵슬롯에 놓으면(드래그·A 길게·숫자키) 물건이 가방으로 들어오며 등록된다 — 가방에 자리가 없으면 거절(Stash.toBagAndBind).
//   착용 칸: Enter·A 벗어 가방으로 / X·우클릭 벗어 창고로. 가방·창고의 장비·각인: Shift+Enter·패드 Y 즉시 장착·새기기, 착용 칸에 드래그해도 같다.
//   커서 하나(마우스·키보드·패드 공용). ↑↓ 장비 → 각인 → 가방 → 퀵슬롯, ←→ 가방↔창고(창고 끝에서 페이지 넘김). PageUp/Down·[ ] 도 페이지.
// 옮기기·확장 규칙은 systems/Stash, 장비는 systems/Equipment, 각인은 systems/Sigils — 여기는 그리기·입력과 그 조합만.

import { balance } from '../core/Balance';
import { EQUIP_SLOTS, equipDef, slotLabel, slotsFor, type EquipSlot } from '../core/EquipData';
import { bindQuickslot, countOf, itemDef, moveSlot, unbindQuickslot } from '../core/Inventory';
import { isActiveSkill, SIGIL_SLOTS, sigilDef, type SigilSlot } from '../core/SigilData';
import type { InventorySlot, ItemKind, World } from '../core/World';
import * as Equipment from '../systems/Equipment';
import * as Sigils from '../systems/Sigils';
import * as Stash from '../systems/Stash';
import { SLOT_LABELS } from './BodyDoll';
import { beginDrag } from './DragDrop';
import { equipIcon, itemIcon, sigilIcon } from './ItemIcons';
import { consumablePopup, equipPopup, keycap, sigilPopup, type PopupContent } from './ItemPopup';

/** 칸은 가방 탭(64)보다 조금 작다 — 창고 7줄 + 몸 + 가방이 720px 높이 안에 들어가야 한다 */
const CELL_PX = 58;
const GAP_PX = 6;
const ICON_PX = 26;
const CELL = `width:${CELL_PX}px;height:${CELL_PX}px;box-sizing:border-box;position:relative;`;
/** 왼쪽 열 폭 — 가방 5열 */
const LEFT_PX = CELL_PX * 5 + GAP_PX * 4;
const COLUMN_GAP_PX = 24;
/** 가운데 열 — 퀵슬롯 십자(3칸) 폭. 아래쪽에 붙는다 ("가운데 아래") */
const MID_PX = CELL_PX * 3 + GAP_PX * 2;
/** 창 폭 — 왼쪽 열(352) + 가운데(208) + 창고 5열(352) + 사이 24×2 + 안쪽 여백 26×2.
 *  퀵슬롯을 아래 별도 줄에 두면 창이 뷰포트보다 높아져 위쪽 칸이 화면 밖으로 잘린다(헤드리스 800px 에서 실측) */
const PANEL_PX = LEFT_PX * 2 + MID_PX + COLUMN_GAP_PX * 2 + 52;
/** 착용 장비 칸 순서 — 4열 두 줄: 투구·갑옷·부츠·목걸이 / 반지 1·반지 2·안전주머니(pack — 맨 아래, 캐릭터 아래 자리) */
const EQUIP_ORDER: EquipSlot[] = ['head', 'body', 'feet', 'neck', 'ring1', 'ring2', 'pack'];
const EQUIP_COLS = 4;
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

/** 이 창이 다루는 격자 */
type Pane = 'equip' | 'sigil' | 'bag' | 'stash' | 'quick';
type ItemPane = 'bag' | 'stash';
const PANE_LABEL: Record<Pane, string> = { equip: '착용 장비', sigil: '새긴 각인', bag: '가방', stash: '창고', quick: '퀵슬롯' };

export class StashUI {
  private readonly root: HTMLDivElement;
  open = false;
  private tab: Tab = 'store';
  private pane: Pane = 'bag';
  /** 격자별 커서 — 장비(EQUIP_ORDER 번호) / 각인(SIGIL_SLOTS 번호) / 가방 / 창고(전체 배열 번호) / 퀵슬롯 */
  private selE = 0;
  private selG = 0;
  private sel = 0;
  private selS = 0;
  private selQ = 0;
  /** 창고 페이지 (0~) */
  private page = 0;
  /** 패드 집어 들기 — 들고 있는 칸 (A 길게로 들고, A 놓기 / B 취소). 가방·창고 칸 또는 착용 칸 */
  private carry: { pane: 'bag' | 'stash' | 'equip' | 'sigil'; index: number } | null = null;
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
      if (e.code === 'PageDown' || e.code === 'BracketRight') { e.preventDefault(); this.turnPage(1); return; }
      if (e.code === 'PageUp' || e.code === 'BracketLeft') { e.preventDefault(); this.turnPage(-1); return; }
      if (UP_KEYS.has(e.code)) { e.preventDefault(); this.move(0, -1); return; }
      if (DOWN_KEYS.has(e.code)) { e.preventDefault(); this.move(0, 1); return; }
      if (LEFT_KEYS.has(e.code)) { e.preventDefault(); this.move(-1, 0); return; }
      if (RIGHT_KEYS.has(e.code)) { e.preventDefault(); this.move(1, 0); return; }
      if (e.code === 'Enter' || e.code === 'NumpadEnter') { e.preventDefault(); if (e.shiftKey) this.actWear(); else this.act(); return; }
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
    this.selE = 0;
    this.selG = 0;
    this.sel = 0;
    this.selS = 0;
    this.selQ = 0;
    this.page = 0;
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
  padY(): void { if (this.open) this.actWear(); }
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

  // ---- 페이지 ----
  private pageSize(): number { return Stash.pageSlots(); }
  private pages(): number { return Stash.pageCount(); }
  private unlocked(): number { return Stash.unlockedPages(this.world); }

  /** 페이지를 넘긴다 — 열린 페이지 안에서만. 창고 커서는 같은 자리(페이지 안 번호)를 유지한다 */
  private turnPage(dir: number): boolean {
    if (this.tab !== 'store') return false;
    const next = this.page + dir;
    if (next < 0 || next >= this.unlocked()) return false;
    const within = this.selS % this.pageSize();
    this.page = next;
    this.selS = Math.min(this.world.stash.length - 1, next * this.pageSize() + within);
    this.rebuild();
    return true;
  }

  private setPage(p: number): void {
    if (p < 0 || p >= this.unlocked() || p === this.page) return;
    this.page = p;
    this.selS = p * this.pageSize();
    this.pane = 'stash';
    this.rebuild();
  }

  private slots(pane: ItemPane): (InventorySlot | null)[] {
    return pane === 'bag' ? this.world.inventory : this.world.stash;
  }

  private cols(pane: ItemPane): number {
    return pane === 'stash' ? balance.lobby.stash.cols : balance.items.cols;
  }

  private cursorOf(pane: ItemPane): number {
    return pane === 'bag' ? this.sel : this.selS;
  }

  private setCursor(pane: ItemPane, index: number): void {
    if (pane === 'bag') this.sel = index;
    else this.selS = index;
  }

  /** 커서 이동 — 격자 안에서는 칸을, 가장자리에서는 옆 격자로.
   *  세로: 장비 → 각인 → 가방 → 퀵슬롯. 가로: 가방 ↔ 창고, 창고 끝에서는 페이지 넘김 */
  private move(dx: number, dy: number): void {
    if (this.tab !== 'store') return;
    const q = this.world.quickslots.length;
    const bagCols = this.cols('bag');
    const bagRows = Math.max(1, Math.ceil(this.world.inventory.length / bagCols));
    if (this.pane === 'equip') {
      const r = Math.floor(this.selE / EQUIP_COLS);
      const c = this.selE % EQUIP_COLS;
      const rows = Math.ceil(EQUIP_ORDER.length / EQUIP_COLS);
      if (dy > 0 && r === rows - 1) { this.pane = 'sigil'; this.selG = Math.min(SIGIL_SLOTS.length - 1, c); }
      else if (dy > 0) this.selE = Math.min(EQUIP_ORDER.length - 1, (r + 1) * EQUIP_COLS + c);
      else if (dy < 0 && r > 0) this.selE = (r - 1) * EQUIP_COLS + c;
      else if (dx > 0 && c === EQUIP_COLS - 1) return this.jump('stash', 0, 'left');
      else if (dx !== 0) this.selE = Math.max(0, Math.min(EQUIP_ORDER.length - 1, this.selE + dx));
      this.rebuild();
      return;
    }
    if (this.pane === 'sigil') {
      if (dy < 0) { this.pane = 'equip'; this.selE = Math.min(EQUIP_ORDER.length - 1, EQUIP_COLS + Math.min(this.selG, EQUIP_COLS - 1)); }
      else if (dy > 0) { this.pane = 'bag'; this.sel = Math.min(this.world.inventory.length - 1, Math.min(this.selG, bagCols - 1)); }
      else if (dx > 0 && this.selG === SIGIL_SLOTS.length - 1) return this.jump('stash', 0, 'left');
      else if (dx !== 0) this.selG = Math.max(0, Math.min(SIGIL_SLOTS.length - 1, this.selG + dx));
      this.rebuild();
      return;
    }
    if (this.pane === 'quick') {
      if (q === CROSS_AREAS.length) {
        const dir = dx < 0 ? 0 : dx > 0 ? 1 : dy < 0 ? 2 : 3;
        const next = CROSS_NAV[this.selQ]?.[dir] ?? null;
        if (next === -1) this.jump('bag', bagRows - 1, 'keep');
        else if (next !== null) this.selQ = next;
      } else if (dy < 0) {
        this.jump('bag', bagRows - 1, 'keep');
      } else if (dx !== 0) {
        this.selQ = Math.max(0, Math.min(q - 1, this.selQ + dx));
      }
      this.rebuild();
      return;
    }
    const pane = this.pane;
    const cols = this.cols(pane);
    const cur = this.cursorOf(pane);
    // 창고는 페이지 안 좌표로 움직인다
    const base = pane === 'stash' ? this.page * this.pageSize() : 0;
    const count = pane === 'stash' ? Math.min(this.pageSize(), this.world.stash.length - base) : this.world.inventory.length;
    const local = cur - base;
    const rows = Math.max(1, Math.ceil(count / cols));
    const c = local % cols;
    const r = Math.floor(local / cols);
    let nc = c + dx;
    let nr = r + dy;
    if (pane === 'bag' && nr < 0) { this.pane = 'sigil'; this.selG = Math.min(SIGIL_SLOTS.length - 1, c); this.rebuild(); return; }
    if (nc >= cols && pane === 'bag') return this.jump('stash', r, 'left');
    if (nc >= cols && pane === 'stash') { if (!this.turnPage(1)) this.rebuild(); return; }
    if (nc < 0 && pane === 'stash') {
      if (this.page > 0) { this.turnPage(-1); return; }
      return this.jump('bag', r, 'right');
    }
    if (nr >= rows && q > 0) {
      // 아래로 나가면 퀵슬롯 — 가방에서는 십자의 왼쪽 칸, 창고에서는 오른쪽 칸
      this.pane = 'quick';
      this.selQ = q === CROSS_AREAS.length ? (pane === 'bag' ? 3 : 1) : 0;
      this.rebuild();
      return;
    }
    nc = Math.max(0, Math.min(cols - 1, nc));
    nr = Math.max(0, Math.min(rows - 1, nr));
    const next = base + Math.min(count - 1, nr * cols + nc);
    if (next === cur) return;
    this.setCursor(pane, next);
    this.rebuild();
  }

  /** 옆 격자로 건너간다 — side: 들어가는 쪽 끝(left/right) 또는 커서 열 유지(keep). 창고는 지금 페이지 안 */
  private jump(pane: ItemPane, row: number, side: 'left' | 'right' | 'keep'): void {
    const base = pane === 'stash' ? this.page * this.pageSize() : 0;
    const count = pane === 'stash' ? Math.min(this.pageSize(), this.world.stash.length - base) : this.world.inventory.length;
    if (count <= 0) return;
    const cols = this.cols(pane);
    const rows = Math.ceil(count / cols);
    const r = Math.max(0, Math.min(rows - 1, row));
    const col = side === 'left' ? 0 : side === 'right' ? cols - 1 : Math.min(cols - 1, (this.cursorOf(pane) - base) % cols);
    this.pane = pane;
    this.setCursor(pane, base + Math.min(count - 1, r * cols + col));
    this.rebuild();
  }

  // ---- 조작 ----

  /** Enter·A·클릭 — 확장 탭이면 확장. 보관: 들고 있으면 놓기 / 착용 칸은 벗어 가방으로 / 가방·창고 칸은 반대편으로 한 개 / 퀵슬롯은 (들고 있을 때만) 등록 */
  private act(): void {
    if (this.tab === 'expand') { Stash.expand(this.world); this.rebuild(); return; }
    if (this.carry) { this.place(); return; }
    if (this.pane === 'equip') { Equipment.unequip(this.world, EQUIP_ORDER[this.selE]!); this.rebuild(); return; }
    if (this.pane === 'sigil') { Sigils.detach(this.world, SIGIL_SLOTS[this.selG]!); this.rebuild(); return; }
    if (this.pane === 'quick') { this.rebuild(); return; }
    Stash.move(this.world, this.pane, this.cursorOf(this.pane), this.pane === 'stash' ? 'bag' : 'stash', false);
    this.rebuild();
  }

  /** X·우클릭 — 착용 칸은 벗어 창고로 / 가방·창고 칸은 통째로 반대편에 / 퀵슬롯 칸은 등록 해제 */
  private actAll(): void {
    if (this.tab !== 'store' || this.carry) return;
    if (this.pane === 'equip') { this.unequipTo(EQUIP_ORDER[this.selE]!, 'stash', -1); this.rebuild(); return; }
    if (this.pane === 'sigil') { this.detachTo(SIGIL_SLOTS[this.selG]!, 'stash', -1); this.rebuild(); return; }
    if (this.pane === 'quick') { unbindQuickslot(this.world, this.selQ); this.rebuild(); return; }
    Stash.move(this.world, this.pane, this.cursorOf(this.pane), this.pane === 'stash' ? 'bag' : 'stash', true);
    this.rebuild();
  }

  /** Shift+Enter·패드 Y — 가방·창고의 장비·각인을 즉시 장착·새기기. 착용 칸에서는 벗기·떼기(가방으로) */
  private actWear(): void {
    if (this.tab !== 'store' || this.carry) return;
    if (this.pane === 'equip') { Equipment.unequip(this.world, EQUIP_ORDER[this.selE]!); this.rebuild(); return; }
    if (this.pane === 'sigil') { Sigils.detach(this.world, SIGIL_SLOTS[this.selG]!); this.rebuild(); return; }
    if (this.pane === 'quick') return;
    this.wearFrom(this.pane, this.cursorOf(this.pane), null);
    this.rebuild();
  }

  /** 가방·창고 칸의 장비·각인을 몸에 — 창고의 것은 빈 가방 칸을 잠시 거친다(자리가 없으면 거절). target: 드래그로 놓은 칸(없으면 정의 부위) */
  private wearFrom(pane: ItemPane, index: number, target: EquipSlot | SigilSlot | null): void {
    const world = this.world;
    const slot = this.slots(pane)[index];
    if (!slot || (slot.kind !== 'equip' && slot.kind !== 'sigil')) return;
    let bagIdx = index;
    if (pane === 'stash') {
      const empty = world.inventory.indexOf(null);
      if (empty < 0) {
        world.events.emit('stash_denied', { reason: 'full', from: 'stash', to: 'bag', kind: slot.kind });
        return;
      }
      if (Stash.place(world, 'stash', index, 'bag', empty) === 'none') return;
      bagIdx = empty;
    }
    let ok = false;
    if (slot.kind === 'equip' && slot.equipId) {
      const targetSlot = target && (EQUIP_SLOTS as string[]).includes(target) ? (target as EquipSlot) : Equipment.targetSlot(world, slot.equipId);
      const r = Equipment.equipTo(world, bagIdx, targetSlot);
      ok = r === 'equipped' || r === 'swapped';
    } else if (slot.kind === 'sigil' && slot.sigilId) {
      const def = sigilDef(slot.sigilId);
      const fits = !isActiveSkill(def) && (!target || !(SIGIL_SLOTS as string[]).includes(target) || def.slot === target);
      if (fits) ok = Sigils.learnFromBag(world, bagIdx) === 'attached';
    }
    // 창고에서 꺼내 왔는데 못 걸쳤다(부위 안 맞음·이미 아는 각인·짐칸 축소 실패) — 그대로 창고 그 칸으로 되돌린다
    if (!ok && pane === 'stash' && world.inventory[bagIdx]) Stash.place(world, 'bag', bagIdx, 'stash', index);
  }

  /** 착용 칸의 장비를 벗어 to(가방/창고)의 그 칸으로(toIdx < 0 이면 빈 자리). 벗기는 Equipment 규칙 — 가방이 가득이면 못 벗는다 */
  private unequipTo(slot: EquipSlot, to: ItemPane, toIdx: number): void {
    const world = this.world;
    const id = world.equipment[slot];
    if (!id) return;
    if (Equipment.unequip(world, slot) !== 'ok') return; // 사유는 equip_denied 로 알려진다
    const landed = world.inventory.findIndex((s) => s?.kind === 'equip' && s.equipId === id);
    if (landed < 0) return;
    if (to === 'bag') {
      if (toIdx >= 0 && toIdx !== landed) moveSlot(world, landed, toIdx);
    } else if (toIdx >= 0) {
      if (Stash.place(world, 'bag', landed, 'stash', toIdx) === 'none') Stash.move(world, 'bag', landed, 'stash', true);
    } else {
      Stash.move(world, 'bag', landed, 'stash', true);
    }
  }

  /** 각인 소켓의 패시브를 떼어 to 로 — 떼기는 Sigils 규칙(가방이 가득이면 못 뗀다) */
  private detachTo(slot: SigilSlot, to: ItemPane, toIdx: number): void {
    const world = this.world;
    const id = world.sigils.equipped[slot];
    if (!id) return;
    if (!Sigils.detach(world, slot)) return;
    const landed = world.inventory.findIndex((s) => s?.kind === 'sigil' && s.sigilId === id);
    if (landed < 0) return;
    if (to === 'bag') {
      if (toIdx >= 0 && toIdx !== landed) moveSlot(world, landed, toIdx);
    } else if (toIdx >= 0) {
      if (Stash.place(world, 'bag', landed, 'stash', toIdx) === 'none') Stash.move(world, 'bag', landed, 'stash', true);
    } else {
      Stash.move(world, 'bag', landed, 'stash', true);
    }
  }

  /** 숫자 키 — 커서 칸을 퀵슬롯 index 에. 창고 칸이면 가방으로 들어오며 등록(자리 없으면 거절) */
  private bindCursor(index: number): void {
    if (this.tab !== 'store') return;
    if (this.pane !== 'bag' && this.pane !== 'stash') return;
    this.bindFrom(this.pane, this.cursorOf(this.pane), index);
  }

  private bindFrom(pane: ItemPane, from: number, quick: number): void {
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
    if (this.pane === 'quick') return;
    if (this.pane === 'equip') { if (this.world.equipment[EQUIP_ORDER[this.selE]!]) this.carry = { pane: 'equip', index: this.selE }; }
    else if (this.pane === 'sigil') { if (this.world.sigils.equipped[SIGIL_SLOTS[this.selG]!]) this.carry = { pane: 'sigil', index: this.selG }; }
    else if (this.slots(this.pane)[this.cursorOf(this.pane)]) this.carry = { pane: this.pane, index: this.cursorOf(this.pane) };
    this.rebuild();
  }

  private place(): void {
    const carry = this.carry;
    if (!carry) return;
    this.carry = null;
    const key =
      this.pane === 'quick' ? `q${this.selQ}`
        : this.pane === 'bag' ? `b${this.sel}`
          : this.pane === 'stash' ? `s${this.selS}`
            : this.pane === 'equip' ? `e${EQUIP_ORDER[this.selE]}`
              : `g${SIGIL_SLOTS[this.selG]}`;
    this.onDrop(carry.pane, carry.index, key);
  }

  /** 드래그·놓기 — from[fromIdx] 를 key 칸에.
   *  가방 ↔ 창고: 그 칸에 놓기(Stash.place). 퀵슬롯: 등록(창고에서면 가방으로 들어온다). 착용 칸: 장착·새기기(부위가 맞아야).
   *  착용 칸에서 끌어 가방·창고에: 벗어·떼어 그 칸으로 */
  private onDrop(from: 'bag' | 'stash' | 'quick' | 'equip' | 'sigil', fromIdx: number, key: string | null): void {
    const world = this.world;
    const to: Pane | null =
      key?.startsWith('b') ? 'bag' : key?.startsWith('s') ? 'stash' : key?.startsWith('q') ? 'quick' : key?.startsWith('e') ? 'equip' : key?.startsWith('g') ? 'sigil' : null;
    const toIdx = key && (to === 'bag' || to === 'stash' || to === 'quick') ? Number.parseInt(key.slice(1), 10) : -1;
    const toSlot = key && (to === 'equip' || to === 'sigil') ? key.slice(1) : null;
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
    if (from === 'equip' || from === 'sigil') {
      if (to === 'bag' || to === 'stash') {
        if (from === 'equip') this.unequipTo(EQUIP_ORDER[fromIdx]!, to, toIdx);
        else this.detachTo(SIGIL_SLOTS[fromIdx]!, to, toIdx);
        this.pane = to;
        if (toIdx >= 0) this.setCursor(to, toIdx);
      }
      this.rebuild();
      return;
    }
    // from: bag | stash
    if (to === 'quick' && toIdx >= 0) {
      this.bindFrom(from, fromIdx, toIdx);
      this.pane = 'quick';
      this.selQ = toIdx;
      this.rebuild();
      return;
    }
    if ((to === 'equip' || to === 'sigil') && toSlot) {
      this.wearFrom(from, fromIdx, toSlot as EquipSlot | SigilSlot);
      this.pane = to;
      if (to === 'equip') this.selE = Math.max(0, EQUIP_ORDER.indexOf(toSlot as EquipSlot));
      else this.selG = Math.max(0, SIGIL_SLOTS.indexOf(toSlot as SigilSlot));
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
    if (!c) return null;
    if (c.pane === 'equip') { const id = this.world.equipment[EQUIP_ORDER[c.index]!]; return id ? { kind: 'equip', count: 1, equipId: id } : null; }
    if (c.pane === 'sigil') { const id = this.world.sigils.equipped[SIGIL_SLOTS[c.index]!]; return id ? { kind: 'sigil', count: 1, sigilId: id } : null; }
    return this.slots(c.pane)[c.index] ?? null;
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
    if (this.page >= this.unlocked()) this.page = Math.max(0, this.unlocked() - 1);
    const panel = document.createElement('div');
    panel.style.cssText = `background:#15151b;border:1px solid #3a3a44;padding:14px 26px 12px;width:${PANEL_PX}px;box-sizing:border-box;`;

    const head = document.createElement('div');
    head.style.cssText = 'display:flex;align-items:baseline;gap:18px;margin-bottom:10px;border-bottom:1px solid #23232b;padding-bottom:8px;';
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
      ? 'D-패드 커서(창고 끝에서 페이지)   A 한 개 · A 길게 집어 옮기기   X 통째로(착용 칸은 벗어 창고로 · 퀵슬롯 해제)   Y 장착·새기기   LT 전부 넣기   LB/RB 탭   B 닫기'
      : '화살표 커서(창고 끝·PageUp/Down 페이지)   Enter·클릭 한 개   X·우클릭 통째로(착용 칸은 벗어 창고로 · 퀵슬롯 해제)   Shift+Enter 장착·새기기   1~4 퀵슬롯   드래그(착용 칸·퀵슬롯에도)   Q 전부 넣기   Tab 탭   E/Esc 닫기';
    hint.style.cssText = 'margin-top:10px;color:#8a8f9a;border-top:1px solid #23232b;padding-top:8px;white-space:pre-line;font-size:11px;line-height:1.6;';
    panel.appendChild(hint);
    this.root.replaceChildren(panel);
  }

  // ---- 보관 ----
  private buildStore(): HTMLElement {
    const world = this.world;
    const wrap = document.createElement('div');

    const row = document.createElement('div');
    row.style.cssText = `display:flex;gap:${COLUMN_GAP_PX}px;align-items:stretch;`;
    wrap.appendChild(row);

    const left = document.createElement('div');
    left.style.cssText = `flex:none;width:${LEFT_PX}px;display:flex;flex-direction:column;gap:8px;align-self:flex-start;`;
    left.appendChild(this.buildEquip());
    left.appendChild(this.buildSigils());
    left.appendChild(this.grid('bag', `내 가방 ${world.inventory.filter((s) => s).length}/${world.inventory.length}칸`, '#7fbfff'));
    left.appendChild(this.descBox(this.cursorDesc()));
    row.appendChild(left);

    // 가운데 아래 — 퀵슬롯. 창고 칸을 여기 놓으면 가방으로 들어오며 등록된다
    const mid = document.createElement('div');
    mid.style.cssText = `flex:none;width:${MID_PX}px;display:flex;flex-direction:column;justify-content:flex-end;`;
    mid.appendChild(this.buildQuickslots());
    row.appendChild(mid);

    const right = document.createElement('div');
    right.style.cssText = `flex:none;width:${LEFT_PX}px;align-self:flex-start;`;
    right.appendChild(this.buildPageTabs());
    right.appendChild(this.grid('stash', `창고 ${this.page + 1}페이지 — 전체 ${world.stash.filter((s) => s).length}/${world.stash.length}칸`, '#e8c76a'));
    // 아래 한 줄 — 전부 넣기 버튼 + 짧은 안내 (두 줄이면 창이 720px 을 넘는다)
    const foot = document.createElement('div');
    foot.style.cssText = 'margin-top:8px;display:flex;align-items:center;gap:10px;';
    const deposit = document.createElement('div');
    deposit.textContent = `${this.key('LT', 'Q')}  가방 전부 넣기`;
    deposit.style.cssText = 'flex:none;padding:4px 12px;border:1px solid #3a3a44;color:#cfd2da;cursor:pointer;';
    deposit.onclick = () => this.depositAll();
    foot.appendChild(deposit);
    const note = document.createElement('div');
    note.textContent = `한 칸 ${balance.lobby.stash.stackMax}개 · 로비에 들어오면 던전 비석은 사라진다 — 창고에 넣은 것만 안전`;
    note.style.cssText = 'color:#8a8f9a;font-size:10px;line-height:1.4;';
    foot.appendChild(note);
    right.appendChild(foot);
    row.appendChild(right);
    return wrap;
  }

  /** 페이지 탭 1~N — 잠긴 페이지는 🔒 (확장 탭에서 산다) */
  private buildPageTabs(): HTMLElement {
    const bar = document.createElement('div');
    bar.style.cssText = 'display:flex;gap:6px;margin-bottom:8px;';
    const unlocked = this.unlocked();
    for (let p = 0; p < this.pages(); p++) {
      const t = document.createElement('div');
      const on = p === this.page;
      const locked = p >= unlocked;
      t.textContent = locked ? `${p + 1} 🔒` : `${p + 1}`;
      t.style.cssText =
        `flex:1;text-align:center;padding:4px 0;border:1px solid ${on ? '#e8c76a' : '#3a3a44'};` +
        `color:${locked ? '#555c66' : on ? '#e8c76a' : '#8a8f9a'};background:${on ? 'rgba(232,199,106,0.10)' : 'transparent'};cursor:${locked ? 'default' : 'pointer'};`;
      t.title = locked ? '잠긴 페이지 — 확장 탭에서 넓힌다' : `${p + 1}페이지`;
      if (!locked) t.onclick = () => this.setPage(p);
      bar.appendChild(t);
    }
    return bar;
  }

  /** 착용 장비 7칸 — 4열 두 줄 */
  private buildEquip(): HTMLElement {
    const world = this.world;
    const box = document.createElement('div');
    const title = document.createElement('div');
    const worn = EQUIP_SLOTS.filter((s) => world.equipment[s]).length;
    title.textContent = `몸 — 장비 ${worn}/${EQUIP_SLOTS.length}`;
    title.style.cssText = `color:${this.pane === 'equip' ? '#e8c76a' : '#8a8f9a'};margin-bottom:6px;`;
    box.appendChild(title);
    const grid = document.createElement('div');
    grid.style.cssText = `display:grid;grid-template-columns:repeat(${EQUIP_COLS}, ${CELL_PX}px);gap:${GAP_PX}px;`;
    const carried = this.carriedSlot();
    EQUIP_ORDER.forEach((slot, i) => {
      const id = world.equipment[slot];
      const cell = document.createElement('div');
      cell.dataset['key'] = `e${slot}`;
      const here = this.pane === 'equip' && this.selE === i;
      // 들고 있는 장비의 부위면 금빛 — "여기에 놓아 걸친다"
      const target = carried?.kind === 'equip' && carried.equipId ? slotsFor(equipDef(carried.equipId).slot).includes(slot) : false;
      cell.style.cssText =
        CELL +
        `border:1px ${id ? 'solid' : 'dashed'} ${here ? '#7fbfff' : target ? '#e8c76a' : '#3a3a44'};` +
        `background:${here ? 'rgba(127,191,255,0.12)' : id ? 'rgba(232,199,106,0.07)' : 'rgba(255,255,255,0.02)'};cursor:pointer;`;
      if (this.carry && this.carry.pane === 'equip' && this.carry.index === i) cell.style.opacity = '0.35';
      const label = document.createElement('div');
      label.textContent = slotLabel(slot);
      label.style.cssText = 'position:absolute;top:2px;left:5px;font-size:10px;color:#8a8f9a;';
      cell.appendChild(label);
      if (id) {
        const icon = equipIcon(id, ICON_PX);
        icon.style.cssText += 'position:absolute;left:50%;top:30px;transform:translate(-50%,-50%);';
        cell.appendChild(icon);
        const name = document.createElement('div');
        name.textContent = equipDef(id).name.slice(0, 5);
        name.style.cssText = `position:absolute;bottom:3px;width:100%;text-align:center;font-size:10px;color:${equipDef(id).color};`;
        cell.appendChild(name);
        const dragIcon = icon.outerHTML;
        cell.onpointerdown = (ev) => beginDrag(ev, dragIcon, (key) => this.onDrop('equip', i, key));
      }
      cell.onclick = () => { this.pane = 'equip'; this.selE = i; this.act(); };
      cell.oncontextmenu = (e) => { e.preventDefault(); this.pane = 'equip'; this.selE = i; this.actAll(); };
      cell.onmousemove = (ev) => {
        if (!this.hoverAllowed(ev) || (this.pane === 'equip' && this.selE === i)) return;
        this.pane = 'equip';
        this.selE = i;
        this.rebuild();
      };
      grid.appendChild(cell);
    });
    box.appendChild(grid);
    return box;
  }

  /** 새긴 각인 5칸 — 눈·오른팔·왼팔·심장·척추 */
  private buildSigils(): HTMLElement {
    const world = this.world;
    const box = document.createElement('div');
    const title = document.createElement('div');
    const worn = SIGIL_SLOTS.filter((s) => world.sigils.equipped[s]).length;
    title.textContent = `몸 — 각인 ${worn}/${SIGIL_SLOTS.length}`;
    title.style.cssText = `color:${this.pane === 'sigil' ? '#e8c76a' : '#8a8f9a'};margin-bottom:6px;`;
    box.appendChild(title);
    const grid = document.createElement('div');
    grid.style.cssText = `display:grid;grid-template-columns:repeat(${SIGIL_SLOTS.length}, ${CELL_PX}px);gap:${GAP_PX}px;`;
    const carried = this.carriedSlot();
    SIGIL_SLOTS.forEach((slot, i) => {
      const id = world.sigils.equipped[slot];
      const cell = document.createElement('div');
      cell.dataset['key'] = `g${slot}`;
      const here = this.pane === 'sigil' && this.selG === i;
      const target = carried?.kind === 'sigil' && carried.sigilId ? sigilDef(carried.sigilId).slot === slot && !isActiveSkill(sigilDef(carried.sigilId)) : false;
      cell.style.cssText =
        CELL +
        `border:1px ${id ? 'solid' : 'dashed'} ${here ? '#7fbfff' : target ? '#e8c76a' : '#3a3a44'};` +
        `background:${here ? 'rgba(127,191,255,0.12)' : id ? 'rgba(180,140,255,0.07)' : 'rgba(255,255,255,0.02)'};cursor:pointer;`;
      if (this.carry && this.carry.pane === 'sigil' && this.carry.index === i) cell.style.opacity = '0.35';
      const label = document.createElement('div');
      label.textContent = SLOT_LABELS[slot];
      label.style.cssText = 'position:absolute;top:2px;left:5px;font-size:10px;color:#8a8f9a;';
      cell.appendChild(label);
      if (id) {
        const icon = sigilIcon(id, ICON_PX);
        icon.style.cssText += 'position:absolute;left:50%;top:30px;transform:translate(-50%,-50%);';
        cell.appendChild(icon);
        const name = document.createElement('div');
        name.textContent = sigilDef(id).name.slice(0, 4);
        name.style.cssText = `position:absolute;bottom:3px;width:100%;text-align:center;font-size:10px;color:${sigilDef(id).color};`;
        cell.appendChild(name);
        const dragIcon = icon.outerHTML;
        cell.onpointerdown = (ev) => beginDrag(ev, dragIcon, (key) => this.onDrop('sigil', i, key));
      }
      cell.onclick = () => { this.pane = 'sigil'; this.selG = i; this.act(); };
      cell.oncontextmenu = (e) => { e.preventDefault(); this.pane = 'sigil'; this.selG = i; this.actAll(); };
      cell.onmousemove = (ev) => {
        if (!this.hoverAllowed(ev) || (this.pane === 'sigil' && this.selG === i)) return;
        this.pane = 'sigil';
        this.selG = i;
        this.rebuild();
      };
      grid.appendChild(cell);
    });
    box.appendChild(grid);
    return box;
  }

  /** 가방 격자 전체 / 창고 격자는 지금 페이지만 */
  private grid(pane: ItemPane, titleText: string, accent: string): HTMLElement {
    const box = document.createElement('div');
    const all = this.slots(pane);
    const base = pane === 'stash' ? this.page * this.pageSize() : 0;
    const count = pane === 'stash' ? Math.min(this.pageSize(), all.length - base) : all.length;
    const title = document.createElement('div');
    title.textContent = titleText;
    title.style.cssText = `color:${this.pane === pane ? accent : '#8a8f9a'};margin-bottom:6px;`;
    box.appendChild(title);
    const grid = document.createElement('div');
    grid.style.cssText = `display:grid;grid-template-columns:repeat(${this.cols(pane)}, ${CELL_PX}px);gap:${GAP_PX}px;`;
    const keyPrefix = pane === 'bag' ? 'b' : 's';
    for (let k = 0; k < count; k++) {
      const i = base + k;
      const slot = all[i] ?? null;
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
        cell.onpointerdown = (ev) => { if (!ev.shiftKey) beginDrag(ev, dragIcon, (key) => this.onDrop(pane, i, key)); };
      }
      cell.onclick = (ev) => { this.pane = pane; this.setCursor(pane, i); if (ev.shiftKey) this.actWear(); else this.act(); };
      cell.oncontextmenu = (e) => { e.preventDefault(); this.pane = pane; this.setCursor(pane, i); this.actAll(); };
      cell.onmousemove = (ev) => {
        if (!this.hoverAllowed(ev) || (this.pane === pane && this.cursorOf(pane) === i)) return;
        this.pane = pane;
        this.setCursor(pane, i);
        this.rebuild();
      };
      grid.appendChild(cell);
    }
    box.appendChild(grid);
    return box;
  }

  /** 퀵슬롯 — 가방 탭의 십자와 같은 꼴. 창고·가방 칸을 끌어다 놓거나 숫자키로 등록한다 */
  private buildQuickslots(): HTMLElement {
    const world = this.world;
    const box = document.createElement('div');
    box.style.cssText = `width:${CELL_PX * 3 + GAP_PX * 2}px;flex:none;`;
    const title = document.createElement('div');
    title.textContent = `퀵슬롯`;
    title.style.cssText = `color:${this.pane === 'quick' ? '#e8c76a' : '#8a8f9a'};margin-bottom:6px;white-space:nowrap;`;
    box.appendChild(title);
    const cross = world.quickslots.length === CROSS_AREAS.length;
    const grid = document.createElement('div');
    grid.style.cssText = cross
      ? `display:grid;grid-template-columns:repeat(3, ${CELL_PX}px);grid-template-rows:repeat(3, ${CELL_PX}px);gap:${GAP_PX}px;`
      : `display:flex;flex-wrap:wrap;gap:${GAP_PX}px;`;
    const carried = this.carriedSlot();
    const armed = carried !== null && Stash.isBindable(carried.kind);
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
    const note = document.createElement('div');
    note.textContent = '창고 칸을 놓으면 가방으로 들어오며 등록 — 가방 자리 필요';
    note.style.cssText = 'margin-top:6px;color:#8a8f9a;font-size:10px;line-height:1.5;';
    box.appendChild(note);
    return box;
  }

  /** 커서 칸 설명 — 격자에 따라 다르다 */
  private cursorDesc(): PopupContent {
    const world = this.world;
    if (this.carry) {
      const slot = this.carriedSlot()!;
      const name = slot.kind === 'equip' && slot.equipId ? equipDef(slot.equipId).name : slot.kind === 'sigil' && slot.sigilId ? sigilDef(slot.sigilId).name : itemDef(slot.kind as ItemKind).name;
      const where =
        this.pane === 'quick' ? `퀵슬롯 ${this.selQ + 1}에 등록`
          : this.pane === 'equip' ? `${slotLabel(EQUIP_ORDER[this.selE]!)}에 걸치기 (부위가 맞아야 한다)`
            : this.pane === 'sigil' ? `${SLOT_LABELS[SIGIL_SLOTS[this.selG]!]}에 새기기 (부위가 맞는 패시브만)`
              : this.pane === this.carry.pane ? '같은 격자 안에서 자리 옮기기'
                : `${PANE_LABEL[this.pane]}의 그 칸에 놓기`;
      return {
        title: `${name} 들고 있음`,
        lines: [where, this.carry.pane === 'stash' && this.pane !== 'stash' && this.pane !== 'bag' ? '창고의 것은 가방 한 칸을 잠시 거친다 — 자리가 있어야 한다' : ''].filter(Boolean),
        actions: [{ key: this.key('A', 'Enter'), label: '놓기' }, { key: this.key('B', 'Esc'), label: '취소' }],
      };
    }
    if (this.pane === 'equip') {
      const slot = EQUIP_ORDER[this.selE]!;
      const id = world.equipment[slot];
      if (!id) return { title: `${slotLabel(slot)} — 비어 있다`, lines: ['가방·창고의 장비를 끌어다 놓으면 걸친다 (Shift+Enter 로도)'] };
      const content = equipPopup(world, id, ' (착용 중)', slot);
      content.actions = [
        { key: this.key('A', 'Enter'), label: '벗어 가방으로' },
        { key: this.key('X', 'X·우클릭'), label: '벗어 창고로' },
        { key: this.key('A 길게', '드래그'), label: '집어 옮기기' },
      ];
      return content;
    }
    if (this.pane === 'sigil') {
      const slot = SIGIL_SLOTS[this.selG]!;
      const id = world.sigils.equipped[slot];
      if (!id) return { title: `${SLOT_LABELS[slot]} — 비어 있다`, lines: ['가방·창고의 그 부위 패시브 각인을 끌어다 놓으면 새겨진다 (Shift+Enter 로도)'] };
      const content = sigilPopup(world, id, ' (새김)');
      content.actions = [
        { key: this.key('A', 'Enter'), label: '떼어 가방으로 (다시 새기면 오염이 다시 붙는다)' },
        { key: this.key('X', 'X·우클릭'), label: '떼어 창고로' },
        { key: this.key('A 길게', '드래그'), label: '집어 옮기기' },
      ];
      return content;
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
    const pane = this.pane as ItemPane;
    const where = ` (${PANE_LABEL[pane]})`;
    let content: PopupContent;
    if (slot.kind === 'equip' && slot.equipId) content = equipPopup(world, slot.equipId, where);
    else if (slot.kind === 'sigil' && slot.sigilId) content = sigilPopup(world, slot.sigilId, where);
    else content = consumablePopup(world, slot.kind, slot.count, where);
    if (itemDef(slot.kind as ItemKind).passive) {
      content.usefulText = '창고 확장 재료 — 주우면 안전 주머니로 먼저 들어간다';
      content.useful = true;
    }
    const to = pane === 'stash' ? '가방' : '창고';
    content.actions = [{ key: this.key('A', 'Enter'), label: `${to}로 한 개` }];
    if (slot.count > 1) content.actions.push({ key: this.key('X', 'X·우클릭'), label: `${to}로 전부 (×${slot.count})` });
    if (slot.kind === 'equip') {
      content.actions.push({ key: this.key('Y', 'Shift+Enter'), label: pane === 'stash' ? '즉시 걸치기 (가방 한 칸을 거친다)' : '걸치기' });
    } else if (slot.kind === 'sigil') {
      const known = slot.sigilId ? world.sigils.inventory.includes(slot.sigilId) : false;
      content.actions.push({ key: this.key('Y', 'Shift+Enter'), label: known ? '새기기 — 이미 새긴 각인' : pane === 'stash' ? '즉시 새기기 (가방 한 칸을 거친다)' : '새기기' });
    } else if (Stash.isBindable(slot.kind)) {
      content.actions.push({
        key: this.key('A 길게', `1~${world.quickslots.length}·드래그`),
        label: pane === 'stash' ? '퀵슬롯에 등록 — 가방으로 들어온다 (자리 필요)' : '퀵슬롯에 등록',
      });
    } else {
      content.actions.push({ key: this.key('A 길게', '드래그'), label: '집어 옮기기' });
    }
    return content;
  }

  private descBox(content: PopupContent): HTMLElement {
    const box = document.createElement('div');
    box.style.cssText =
      `width:${LEFT_PX}px;box-sizing:border-box;padding:8px 12px;height:112px;overflow:auto;` + // 높이 고정 — 설명이 길어도 창이 자라지 않는다(안에서 스크롤)
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
    cur.textContent = `지금 창고 ${world.stash.length}칸 — ${this.unlocked()}/${this.pages()}페이지 (한 페이지 ${this.pageSize()}칸)`;
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
      name.textContent = `${i + 2}페이지 — ${cap}칸`;
      name.style.cssText = `width:170px;color:${done ? '#9fe870' : next ? '#e8c76a' : '#6c7280'};`;
      line.appendChild(name);
      const cost = document.createElement('span');
      const keyName = t.key ? itemDef(t.key as ItemKind).name : null;
      cost.textContent = done ? '열림' : `◆ ${t.gold}${keyName ? `  +  ${keyName} 1` : ''}`;
      cost.style.cssText = `width:260px;color:${done ? '#6c7280' : '#cfd2da'};`;
      line.appendChild(cost);
      if (next) {
        const c = Stash.canExpand(world);
        const st = document.createElement('span');
        st.textContent = c.ok
          ? '열 수 있다'
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
    btn.textContent = c.ok ? `${this.key('A', 'Enter')}  다음 페이지를 연다` : c.reason === 'max' ? '모든 페이지가 열려 있다' : `${this.key('A', 'Enter')}  다음 페이지 (지금은 못 연다)`;
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
