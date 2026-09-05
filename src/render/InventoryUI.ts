// I 창 — 소모품 퀵슬롯 + 가방. DOM 오버레이. 스킬은 Tab 창(SkillUI)이 따로 맡는다 —
// 스킬은 아이템이 아니라 리스트라 가방에 들어가지 않는다.
// 열려 있는 동안 시뮬레이션은 main이 일시정지한다.
//
// 조작 규약(루팅 창과 같다, 2026-09-04 패드 지원): 커서 하나를 마우스·키보드·패드가 함께 움직인다.
// 가방 칸에서 A/Enter/좌클릭 = 고르기 → 퀵슬롯 칸에서 A/Enter/클릭 = 등록(빈손이면 해제, 숫자 키도 같은 뜻).
// A 길게 = 집어 들기 → 커서 이동 → A 놓기(빈 칸 이동·같은 종류 합침·다른 종류 교환·퀵슬롯이면 등록) / B 취소.
// X/우클릭 = 바닥에 버리기, X 길게/Shift+Enter/Shift+클릭 = 수량 나누기, Y/P = 보관 주머니 내려놓기, B/Esc/I = 닫기.
// 마우스 드래그도 그대로. 버리기가 없으면 가방이 가득 찼을 때 빠져나갈 길이 없다.

import {
  bindQuickslot,
  countOf,
  isUseful,
  itemDef,
  dropSlot,
  moveSlot,
  splitSlot,
  unbindQuickslot,
} from '../core/Inventory';
import { beginDrag } from './DragDrop';
import * as Items from '../systems/Items';
import { adjustSplit, makeSplit, renderSplitDialog, splitActivate, splitNavigate, type SplitState } from './SplitDialog';
import { balance } from '../core/Balance';
import { itemIcon } from './ItemIcons';
import { attachPopup, consumablePopup, equipPopup, sigilPopup, type PopupContent } from './ItemPopup';
import { equipIcon, sigilIcon } from './ItemIcons';
import { sigilDef } from '../core/SigilData';
import { equipDef, slotLabel, type EquipSlot } from '../core/EquipData';
import * as Sigils from '../systems/Sigils';
import * as Equipment from '../systems/Equipment';
import type { ItemKind, World } from '../core/World';

const CELL_PX = 64;
const GAP_PX = 8;
const CELL = `width:${CELL_PX}px;height:${CELL_PX}px;box-sizing:border-box;position:relative;`;
/** 칸(64px) 안에서 숫자·번호와 부딪히지 않는 크기 */
const ICON_PX = 28;
/** 두 열 사이 간격 — 가방 5×4 격자(352px) | 퀵슬롯 십자(208px) */
const COLUMN_GAP_PX = 28;
/** 창 폭 고정 — 안내 문장 길이에 따라 창이 늘고 줄지 않게 (LootUI 와 같은 규약). 352 + 28 + 208 + 여백 26×2 */
const PANEL_PX = 820; // 인형(2열) + 가방 격자(5열) + 퀵슬롯 십자
/** 퀵슬롯 십자 — HUD 마름모 넷과 같은 자리(위 1·오른쪽 2·아래 3·왼쪽 4, 시계 방향). grid-area 'row / col' */
const CROSS_AREAS = ['1 / 2', '2 / 3', '3 / 2', '2 / 1'];
/** 십자 안 커서 이동 — [칸][방향(0 ←, 1 →, 2 ↑, 3 ↓)] → 다음 칸, -1 = 가방으로, null = 제자리 */
const CROSS_NAV: Record<number, (number | null)[]> = {
  0: [3, 1, null, 2], // 위: ← 왼쪽 · → 오른쪽 · ↓ 아래
  1: [3, null, 0, 2], // 오른쪽: ← 왼쪽 · ↑ 위 · ↓ 아래
  2: [3, 1, 0, null], // 아래: ← 왼쪽 · → 오른쪽 · ↑ 위
  3: [-1, 1, 0, 2], // 왼쪽: ← 가방으로 · → 오른쪽 · ↑ 위 · ↓ 아래
};
const UP_KEYS = new Set(['KeyW', 'ArrowUp']);
const DOWN_KEYS = new Set(['KeyS', 'ArrowDown']);
const LEFT_KEYS = new Set(['KeyA', 'ArrowLeft']);
const RIGHT_KEYS = new Set(['KeyD', 'ArrowRight']);

type Pane = 'bag' | 'quick' | 'doll';
/** 인형(장비 칸) 배치 — 2열: [투구 목걸이] [갑옷 반지1] [부츠 반지2] [짐칸] */
const DOLL_ORDER: EquipSlot[] = ['head', 'neck', 'body', 'ring1', 'feet', 'ring2', 'pack'];

export class InventoryUI {
  private readonly root: HTMLDivElement;
  open = false;
  /** 커서 — 가방 칸(sel) 또는 퀵슬롯 칸(selQ). 마우스 hover·키보드·패드가 함께 움직인다 */
  private pane: Pane = 'bag';
  private sel = 0;
  private selQ = 0;
  /** 인형 칸 커서 (DOLL_ORDER 번호) */
  private selD = 0;
  /** 퀵슬롯에 꽂으려고 골라 둔 가방 칸 (-1 = 없음) */
  private picked = -1;
  /** 패드 집어 들기 — 들고 있는 가방 칸 (A 길게로 들고, A 놓기 / B 취소) */
  private carry: { index: number } | null = null;
  private aHoldTicks = 0;
  private aConsumed = false;
  private xHoldTicks = 0;
  private xConsumed = false;
  private yHoldTicks = 0;
  private yConsumed = false;
  /** 수량 나누기 대화상자 */
  private split: SplitState | null = null;
  /** 패드로 조작 중 — 안내·글리프를 패드 표기로 (main 이 틱마다 갱신) */
  padMode = false;
  /** 보관 주머니 내려놓기 — P 키·패드 Y·버튼. main 이 Loot.createPlayerPouch 로 잇는다 */
  onPlacePouch: (() => void) | null = null;
  /** 창 안에서 닫았다(B·Esc) — main 이 uiOpen 을 되돌린다 */
  onClose: (() => void) | null = null;
  /** 격자 끝에서 한 번 더 밀었다 — 셸이 옆 탭으로 넘긴다 (가방 왼쪽 끝 ← / 퀵슬롯 오른쪽 끝 →) */
  onEdge: ((dir: number) => void) | null = null;

  constructor(private readonly world: World, parent: HTMLElement) {
    // 메뉴 창(MenuTabs)의 가방 탭 패널 — 배경·시간 정지는 셸이 맡고 여기는 내용만 그린다 (2026-09-04)
    this.root = document.createElement('div');
    this.root.id = 'sigilui';
    this.root.style.cssText = 'display:none;';
    parent.appendChild(this.root);

    window.addEventListener('keydown', (e) => {
      if (!this.open) return;
      if (this.split) {
        // 대화상자 — 화살표/WASD 로 수량 줄·버튼 줄 커서, Enter 실행, Esc 취소
        e.preventDefault();
        if (LEFT_KEYS.has(e.code)) splitNavigate(this.split, -1, 0);
        else if (RIGHT_KEYS.has(e.code)) splitNavigate(this.split, 1, 0);
        else if (UP_KEYS.has(e.code)) splitNavigate(this.split, 0, -1);
        else if (DOWN_KEYS.has(e.code)) splitNavigate(this.split, 0, 1);
        else if (e.code === 'Enter' || e.code === 'NumpadEnter') { this.activateSplit(); return; }
        else if (e.code === 'Escape') { this.split = null; }
        else return;
        this.rebuild();
        return;
      }
      if (e.code === 'KeyP') {
        // 보관 주머니 — 빈 주머니를 발밑에 내려놓고 루팅 창으로 넘어간다 (main 이 잇는다)
        e.preventDefault();
        this.onPlacePouch?.();
        return;
      }
      // 키보드로는 칸을 옮기지 않는다 — 마우스(hover·클릭·드래그)만 (2026-09-04 사용자). 화살표·A/D 는 셸의 탭 전환.
      // 패드 D-패드·스틱은 그대로 커서(padMove → move)
      if (e.code === 'Enter' || e.code === 'NumpadEnter') {
        e.preventDefault();
        if (e.shiftKey) this.openSplit(this.pane === 'bag' ? this.sel : -1);
        else this.act();
        return;
      }
      if (e.code === 'KeyX' || e.code === 'Delete') { e.preventDefault(); this.dropCursor(); return; }
      if (e.code === 'KeyE') { e.preventDefault(); this.useCursor(); return; } // 사용 — 창을 닫고 마시기 시작
      if (e.code === 'Escape') { e.preventDefault(); this.cancelOrClose(); return; }
      // 숫자 키 — 고른 게 있으면 그 칸에 꽂고, 없으면 해제 (창 안에서는 등록 전용이다)
      const digit = Number.parseInt(e.code.replace('Digit', ''), 10);
      if (!e.code.startsWith('Digit') || Number.isNaN(digit)) return;
      const index = digit - 1;
      if (index < 0 || index >= this.world.quickslots.length) return;
      e.preventDefault();
      this.assign(index);
    });
  }

  show(): void {
    this.open = true;
    this.pane = 'bag';
    this.sel = 0;
    this.selQ = 0;
    this.picked = -1;
    this.carry = null;
    this.aHoldTicks = 0;
    this.aConsumed = false;
    this.xHoldTicks = 0;
    this.xConsumed = false;
    this.yHoldTicks = 0;
    this.yConsumed = false;
    this.split = null;
    this.root.style.display = 'block';
    this.rebuild();
  }

  hide(): void {
    this.open = false;
    this.picked = -1;
    this.carry = null;
    this.split = null;
    this.root.style.display = 'none';
  }

  toggle(): boolean {
    if (this.open) this.hide();
    else this.show();
    return this.open;
  }

  // ---- 패드 (main 이 틱마다 부른다) ----
  padMove(dx: number, dy: number): void {
    if (!this.open) return;
    if (this.split) { splitNavigate(this.split, dx, dy); this.rebuild(); return; }
    this.move(dx, dy);
  }
  /** A — 짧게 떼면 고르기/등록(들고 있으면 놓기), padPickHoldTicks 넘게 누르면 커서 가방 칸 집어 들기 */
  padA(held: boolean): void {
    if (!this.open) return;
    if (this.split) {
      if (held) { this.aHoldTicks++; return; }
      if (this.aHoldTicks > 0) { this.aHoldTicks = 0; this.aConsumed = false; this.activateSplit(); }
      return;
    }
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
  /** X — 짧게 떼면 버리기(퀵슬롯이면 등록 해제), padSplitHoldTicks 넘게 누르면 수량 나누기 */
  padX(held: boolean): void {
    if (!this.open) return;
    if (held) {
      this.xHoldTicks++;
      if (!this.xConsumed && !this.split && !this.carry && this.pane === 'bag' && this.xHoldTicks >= balance.loot.ui.padSplitHoldTicks) {
        this.xConsumed = true;
        this.openSplit(this.sel);
      }
      return;
    }
    if (this.xHoldTicks === 0) return;
    const consumed = this.xConsumed;
    this.xHoldTicks = 0;
    this.xConsumed = false;
    if (consumed || this.split) return;
    this.dropCursor();
  }
  /** 제단 앞에서 열렸는가 — 각인을 팔 수 있다 (X). 셸이 show 직전에 넣어 준다 */
  altar = false;

  /** 각인 새기기 — 커서 칸의 각인을 몸에 새긴다/익힌다. 안 되는 이유는 Sigils 가 sigil_learn_denied 로 알린다 */
  private learnCursor(): void {
    if (this.pane !== 'bag') return;
    Sigils.learnFromBag(this.world, this.sel);
    if (this.picked === this.sel) this.picked = -1;
    this.rebuild();
  }

  /** 인형 칸의 장비를 벗어 가방으로 — 가방이 가득이면 Equipment 가 equip_denied 로 알린다 */
  private unequipCursor(): void {
    const slot = DOLL_ORDER[this.selD]!;
    if (this.world.equipment[slot]) Equipment.unequip(this.world, slot);
    this.rebuild();
  }

  /** 장비 걸치기 — 커서 칸의 장비를 몸에. 맞바꾼 것은 같은 칸으로 돌아온다 (2026-09-04) */
  private equipCursor(): void {
    if (this.pane !== 'bag') return;
    Equipment.equipFromBag(this.world, this.sel);
    if (this.picked === this.sel) this.picked = -1;
    this.rebuild();
  }

  /** Y — 짧게 떼면 커서 가방 칸 사용, padPouchHoldTicks 넘게 누르면 보관 주머니 내려놓기 */
  padY(held: boolean): void {
    if (!this.open) return;
    if (held) {
      this.yHoldTicks++;
      if (!this.yConsumed && !this.split && !this.carry && this.yHoldTicks >= balance.loot.ui.padPouchHoldTicks) {
        this.yConsumed = true;
        this.onPlacePouch?.();
      }
      return;
    }
    if (this.yHoldTicks === 0) return;
    const consumed = this.yConsumed;
    this.yHoldTicks = 0;
    this.yConsumed = false;
    if (consumed || this.split || this.carry) return;
    this.useCursor();
  }
  /** B — 대화상자·들기를 취소하고, 아니면 닫는다 */
  padClose(): void { this.cancelOrClose(); }
  /** 수량 나누기 대화상자가 열려 있는가 — 그동안 셸은 화살표로 탭을 바꾸지 않는다 */
  get splitting(): boolean { return this.split !== null; }

  /** 사용 — 커서 가방 칸의 소모품을 마시기 시작한다(퀵슬롯에 없어도). 시전이 있어 창을 닫는다.
   *  못 쓰는 이유(가득·쿨다운·마시는 중)는 Items 가 item_denied 로 알린다 — 창은 그대로 */
  private useCursor(): void {
    if (this.pane === 'doll') { this.unequipCursor(); return; }
    if (this.pane !== 'bag') return;
    const slot = this.world.inventory[this.sel];
    if (!slot) return;
    if (slot.kind === 'sigil') { this.learnCursor(); return; } // 각인은 마시지 않는다 — 새긴다
    if (slot.kind === 'equip') { this.equipCursor(); return; } // 장비는 걸친다
    if (!Items.useKind(this.world, slot.kind)) { this.rebuild(); return; }
    this.hide();
    this.onClose?.();
  }

  // ---- 커서 ----
  private move(dx: number, dy: number): void {
    const cols = balance.items.cols;
    const slots = this.world.inventory.length;
    const rows = Math.max(1, Math.ceil(slots / cols));
    const q = this.world.quickslots.length;
    if (this.pane === 'doll') {
      // 인형 — 2열 격자. 오른쪽 열에서 한 번 더 오른쫙 = 가방, 왼쪽 열에서 왼쫙 = 이전 탭
      const n = DOLL_ORDER.length;
      const dcol = this.selD % 2;
      const drow = Math.floor(this.selD / 2);
      const drows = Math.ceil(n / 2);
      if (dx > 0) {
        if (dcol === 0 && this.selD + 1 < n) this.selD++;
        else { this.pane = 'bag'; this.sel = Math.min(slots - 1, Math.min(drow, rows - 1) * cols); }
      } else if (dx < 0) {
        if (dcol === 1) this.selD--;
        else if (!this.carry) { this.onEdge?.(-1); return; }
      } else if (dy !== 0) {
        const nrow = (drow + dy + drows) % drows;
        this.selD = Math.min(n - 1, nrow * 2 + dcol);
      }
      this.rebuild();
      return;
    }
    if (this.pane === 'bag') {
      const row = Math.floor(this.sel / cols);
      const col = this.sel % cols;
      if (dx < 0 && col === 0) {
        this.pane = 'doll'; // 왼쪽 끝에서 한 번 더 — 인형(장비 칸)의 오른쪽 열
        this.selD = Math.min(DOLL_ORDER.length - 1, Math.min(row, Math.ceil(DOLL_ORDER.length / 2) - 1) * 2 + 1);
        this.rebuild();
        return;
      }
      if (dx > 0 && col === cols - 1) {
        this.pane = 'quick';
        this.selQ = q === CROSS_AREAS.length ? 3 : 0; // 십자의 왼쪽 칸으로 들어간다
      } else if (dx !== 0) {
        this.sel = Math.min(slots - 1, row * cols + ((col + dx + cols) % cols));
      } else if (dy !== 0) {
        this.sel = Math.min(slots - 1, ((row + dy + rows) % rows) * cols + col);
      }
    } else if (q === CROSS_AREAS.length) {
      const dir = dx < 0 ? 0 : dx > 0 ? 1 : dy < 0 ? 2 : 3;
      const next = CROSS_NAV[this.selQ]?.[dir] ?? null;
      if (dx > 0 && this.selQ === 1 && !this.carry) {
        this.onEdge?.(1); // 십자 오른쪽 끝에서 한 번 더 — 다음 탭
        return;
      }
      if (next === -1) {
        this.pane = 'bag';
        this.sel = Math.min(slots - 1, Math.floor(this.sel / cols) * cols + cols - 1); // 같은 줄의 오른쪽 끝 칸으로
      } else if (next !== null) {
        this.selQ = next;
      }
    } else {
      if (dx < 0 && this.selQ === 0) this.pane = 'bag';
      else if (dx > 0 && this.selQ === q - 1 && !this.carry) { this.onEdge?.(1); return; }
      else if (dx !== 0) this.selQ = Math.max(0, Math.min(q - 1, this.selQ + dx));
    }
    this.rebuild();
  }

  /** A/Enter — 들고 있으면 놓기. 가방 칸: 고르기(토글). 퀵슬롯 칸: 고른 것 등록 / 빈손이면 해제 */
  private act(): void {
    if (this.carry) { this.place(); return; }
    if (this.pane === 'doll') { this.unequipCursor(); return; }
    if (this.pane === 'bag') {
      const cur = this.world.inventory[this.sel];
      if (!cur) { this.rebuild(); return; }
      if (cur.kind === 'sigil') { this.learnCursor(); return; } // 각인은 퀵슬롯에 못 간다 — A 도 새기기
      if (cur.kind === 'equip') { this.equipCursor(); return; } // 장비도 — A 는 걸치기
      this.picked = this.picked === this.sel ? -1 : this.sel;
      this.rebuild();
      return;
    }
    this.assign(this.selQ);
  }

  /** 골라 둔 가방 칸을 퀵슬롯 index 에 꽂는다. 고른 게 없으면 등록 해제 */
  private assign(index: number): void {
    const slot = this.picked >= 0 ? this.world.inventory[this.picked] : null;
    if (slot) bindQuickslot(this.world, index, slot.kind);
    else unbindQuickslot(this.world, index);
    this.picked = -1;
    this.rebuild();
  }

  /** X/우클릭 — 가방 칸은 바닥에 버리기, 퀵슬롯 칸은 등록 해제 */
  private dropCursor(): void {
    if (this.carry) return;
    if (this.pane === 'doll') { this.unequipCursor(); return; }
    if (this.pane === 'bag') {
      const cur = this.world.inventory[this.sel];
      if (cur && cur.kind === 'sigil' && this.altar) Sigils.sellFromBag(this.world, this.sel); // 제단 앞 — 각인은 판다
      else if (cur && cur.kind === 'equip' && this.altar) Equipment.sellFromBag(this.world, this.sel); // 제단 앞 — 장비도 판다
      else if (cur) dropSlot(this.world, this.sel);
      if (this.picked === this.sel) this.picked = -1;
    } else {
      unbindQuickslot(this.world, this.selQ);
    }
    this.rebuild();
  }

  private cancelOrClose(): void {
    if (this.split) { this.split = null; this.rebuild(); return; }
    if (this.carry) { this.carry = null; this.rebuild(); return; }
    this.hide();
    this.onClose?.();
  }

  // ---- 집어 들기 (패드) ----
  private pickUp(): void {
    if (this.pane !== 'bag' || !this.world.inventory[this.sel]) return;
    this.carry = { index: this.sel };
    this.picked = -1;
    this.world.events.emit('loot_carry_started', { pane: 'bag' });
    this.rebuild();
  }
  private place(): void {
    // 인형 칸 위에서 놓기 — 든 가방 칸의 장비를 그 칸에 걸친다 (부위가 다르면 무시)
    if (this.pane === 'doll' && this.carry) {
      Equipment.equipTo(this.world, this.carry.index, DOLL_ORDER[this.selD]!);
      this.carry = null;
      this.rebuild();
      return;
    }
    const carry = this.carry;
    if (!carry) return;
    this.carry = null;
    if (this.pane === 'bag') this.onDrop('bag', carry.index, `b${this.sel}`);
    else this.onDrop('bag', carry.index, `q${this.selQ}`);
  }

  // ---- 수량 나누기 ----
  /** 가방 스택(2개 이상)을 나누는 대화상자 — 빈 칸이 없으면 열지 않는다 */
  private openSplit(index: number): void {
    const slot = index >= 0 ? this.world.inventory[index] : null;
    if (!slot || slot.count < 2 || !this.world.inventory.includes(null)) return;
    this.split = makeSplit(index, slot.kind, slot.count);
    this.picked = -1;
    this.rebuild();
  }
  private activateSplit(): void {
    if (!this.split) return;
    const r = splitActivate(this.split);
    if (r === 'confirm') this.confirmSplit();
    else if (r === 'cancel') { this.split = null; this.rebuild(); }
    else this.rebuild();
  }
  private confirmSplit(): void {
    const s = this.split;
    if (!s) return;
    this.split = null;
    const to = splitSlot(this.world, s.index, s.amount);
    if (to >= 0) { this.pane = 'bag'; this.sel = to; this.picked = to; } // 새 칸을 고른 상태로 — 바로 퀵슬롯에 꽂거나 끌 수 있게
    this.rebuild();
  }

  /** 드래그/놓기 — 가방↔가방(이동·합침·교환), 가방→퀵슬롯(등록), 퀵슬롯↔퀵슬롯(교환), 퀵슬롯→빈 곳(해제) */
  private onDrop(from: 'bag' | 'quick' | 'doll', fromIdx: number, key: string | null): void {
    const world = this.world;
    const to = key?.startsWith('b') ? 'bag' : key?.startsWith('q') ? 'quick' : key?.startsWith('d') ? 'doll' : null;
    const toIdx = key ? Number.parseInt(key.slice(1), 10) : -1;
    if (from === 'doll') {
      // 인형 → 가방: 벗어서 그 칸(비어 있으면)으로. 그 밖은 그대로
      if (to === 'bag') {
        const slot = DOLL_ORDER[fromIdx]!;
        const prevId = world.equipment[slot];
        const wasEmpty = world.inventory[toIdx] === null;
        if (prevId && Equipment.unequip(world, slot) === 'ok' && wasEmpty) {
          // 벗은 장비는 첫 빈 칸에 들어갔다 — 놓은 칸이 비어 있었으면 그 칸으로 옮긴다
          const landed = world.inventory.findIndex((s) => s?.kind === 'equip' && s.equipId === prevId);
          if (landed >= 0 && landed !== toIdx) moveSlot(world, landed, toIdx);
        }
        this.pane = 'bag';
        this.sel = toIdx;
      }
      this.picked = -1;
      this.rebuild();
      return;
    }
    if (from === 'bag' && to === 'doll') {
      Equipment.equipTo(world, fromIdx, DOLL_ORDER[toIdx]!); // 부위가 다르면 아무 일도 없다
      this.pane = 'doll';
      this.selD = toIdx;
      this.picked = -1;
      this.rebuild();
      return;
    }
    if (from === 'bag' && to === 'bag') {
      if (moveSlot(world, fromIdx, toIdx) !== 'none') world.events.emit('loot_moved', { where: 'bag' });
      this.pane = 'bag';
      this.sel = toIdx;
    } else if (from === 'bag' && to === 'quick') {
      const slot = world.inventory[fromIdx];
      if (slot) bindQuickslot(world, toIdx, slot.kind);
      this.pane = 'quick';
      this.selQ = toIdx;
    } else if (from === 'quick' && to === 'quick') {
      if (fromIdx !== toIdx) {
        const a = world.quickslots[fromIdx] ?? null;
        world.quickslots[fromIdx] = world.quickslots[toIdx] ?? null;
        world.quickslots[toIdx] = a;
      }
    } else if (from === 'quick' && to !== 'quick') {
      unbindQuickslot(world, fromIdx); // 끌어내 놓으면 등록 해제
    }
    this.picked = -1;
    this.rebuild();
  }

  /** 마우스 hover 로 커서를 옮겨도 되는가 — 패드 조작 중·유령 이동(이동량 0)은 무시 (LootUI 규약) */
  private hoverAllowed(ev: MouseEvent): boolean {
    if (this.padMode) return false;
    return ev.movementX !== 0 || ev.movementY !== 0;
  }

  private key(pad: string, kb: string): string {
    return this.padMode ? pad : kb;
  }

  private rebuild(): void {
    const world = this.world;
    if (this.carry && !world.inventory[this.carry.index]) this.carry = null; // 든 것이 사라졌다
    const panel = document.createElement('div');
    panel.style.cssText =
      `background:#15151b;border:1px solid #3a3a44;padding:20px 26px;width:${PANEL_PX}px;box-sizing:border-box;`;

    // 머리줄 — 창 이름과, 가방을 안 거치는 자원(골드·화살)을 한눈에 (루팅 창의 가방 열과 같은 표기)
    const head = document.createElement('div');
    head.style.cssText = 'display:flex;justify-content:space-between;align-items:baseline;margin-bottom:12px;';
    const title = document.createElement('div');
    title.textContent = '가방';
    title.style.cssText = 'color:#e8c76a;font-size:15px;';
    const counters = document.createElement('div');
    counters.style.cssText = 'color:#cfd2da;display:flex;gap:18px;';
    const gold = document.createElement('span');
    gold.textContent = `◆ ${world.gold}`;
    gold.style.color = '#e8c76a';
    const arrows = document.createElement('span');
    arrows.textContent = `화살 ${world.weapon.arrows ?? 0}/${balance.weapons.bow.ammoMax}`;
    const worn = document.createElement('span');
    worn.textContent = `장비 ${DOLL_ORDER.filter((s) => world.equipment[s]).length}/${DOLL_ORDER.length}`;
    counters.append(worn, gold, arrows);
    head.append(title, counters);
    panel.appendChild(head);

    // 본문 — 왼쪽 가방 격자(5×4), 오른쪽 퀵슬롯 십자
    const columns = document.createElement('div');
    columns.style.cssText = `display:flex;gap:${COLUMN_GAP_PX}px;align-items:flex-start;`;
    columns.appendChild(this.buildDoll());
    columns.appendChild(this.buildBag());
    columns.appendChild(this.buildQuickslots());
    panel.appendChild(columns);

    // 보관 주머니 — 가방을 비워 두고 싶을 때. 넣어 둔 것은 층을 오가도·죽어도 그 자리에 남는다
    const stash = document.createElement('button');
    stash.textContent = `주머니 내려놓기 (${this.key('Y 길게', 'P')}) — 여기에 아이템을 보관한다`;
    stash.style.cssText =
      'margin-top:16px;padding:6px 14px;border:1px solid #3a3a44;background:#1b1b22;color:#cfd2da;cursor:pointer;font:inherit;';
    stash.onclick = () => this.onPlacePouch?.();
    panel.appendChild(stash);

    const hint = document.createElement('div');
    hint.textContent = this.padMode
      ? 'D-패드·왼 스틱 커서   Y 사용   A 고르기 → 퀵슬롯에서 A 등록(빈손 = 해제)   A 길게 집어 옮기기 → A 놓기 / B 취소   X 버리기 · X 길게 수량 나누기   Y 길게 주머니 내려놓기   B 닫기'
      : `마우스로 칸 선택 · ←→ 탭 전환   E·더블클릭 사용   Enter/클릭 고르기 → 퀵슬롯 클릭(또는 1~${world.quickslots.length}) 등록(빈손 = 해제)   X·우클릭 버리기   Shift+Enter·Shift+클릭 수량 나누기   드래그로 옮기기   P 주머니 내려놓기   Esc·I 닫기`;
    hint.style.cssText = 'margin-top:14px;color:#6c7280;font-size:11px;line-height:1.7;white-space:normal;';
    panel.appendChild(hint);

    this.root.replaceChildren(panel);
    if (this.split) {
      this.root.appendChild(
        renderSplitDialog(this.split, {
          padMode: this.padMode,
          onAdjust: (d) => { if (this.split) { adjustSplit(this.split, d); this.rebuild(); } },
          onConfirm: () => this.confirmSplit(),
          onCancel: () => { this.split = null; this.rebuild(); },
        }),
      );
    }
  }

  /** 들고 있을 때 커서 칸의 팝업 — 놓으면 무슨 일이 일어나는지 */
  private carryPopup(pane: Pane, index: number): PopupContent {
    if (pane === 'doll') {
      return { title: `${slotLabel(DOLL_ORDER[index]!)}에 걸치기`, lines: ['부위가 맞아야 한다 — 걸치면 든 칸으로 옛것이 돌아온다'] };
    }
    const world = this.world;
    const carry = this.carry!;
    const src = world.inventory[carry.index];
    const lines: string[] = [];
    if (pane === 'quick') lines.push(`퀵슬롯 ${index + 1}에 등록한다`);
    else if (index === carry.index) lines.push('원래 자리 — 놓으면 그대로 둔다');
    else {
      const dst = world.inventory[index];
      const stackMax = balance.items.stackMax;
      if (!dst) lines.push('빈 칸으로 옮긴다');
      else if (src && dst.kind === src.kind && dst.count < stackMax) lines.push(`같은 종류 — ${Math.min(stackMax - dst.count, src.count)}개 합친다 (나머지는 제자리)`);
      else lines.push('자리를 맞바꾼다');
    }
    return {
      title: '여기에 놓기',
      lines,
      actions: [
        { key: this.key('A', 'Enter'), label: '놓기' },
        { key: this.key('B', 'Esc'), label: '취소' },
      ],
    };
  }

  private carriedOverlay(): HTMLElement | null {
    const carry = this.carry;
    const slot = carry ? this.world.inventory[carry.index] : null;
    if (!slot) return null;
    const el = document.createElement('div');
    el.innerHTML = itemIcon(slot.kind, ICON_PX).outerHTML;
    el.style.cssText =
      `position:absolute;left:50%;top:50%;transform:translate(-50%,-58%) scale(${balance.loot.ui.padCarryScale});line-height:0;` +
      'pointer-events:none;z-index:4;filter:drop-shadow(0 6px 10px rgba(0,0,0,0.8)) brightness(1.2);';
    return el;
  }

  // ---- 퀵슬롯 ----
  /** HUD 마름모 넷과 같은 십자 배치(위 1·오른쪽 2·아래 3·왼쪽 4). 칸 수가 넷이 아니면 한 줄로 늘어놓는다 */
  private buildQuickslots(): HTMLElement {
    const world = this.world;
    const box = document.createElement('div');
    box.style.cssText = `width:${CELL_PX * 3 + GAP_PX * 2}px;flex:none;`;

    const title = document.createElement('div');
    title.textContent = `퀵슬롯 — 전투 중 1~${world.quickslots.length}`;
    title.style.cssText = `color:${this.pane === 'quick' ? '#e8c76a' : '#8a8f9a'};margin-bottom:6px;`;
    box.appendChild(title);

    const cross = world.quickslots.length === CROSS_AREAS.length;
    const grid = document.createElement('div');
    grid.style.cssText = cross
      ? `display:grid;grid-template-columns:repeat(3, ${CELL_PX}px);grid-template-rows:repeat(3, ${CELL_PX}px);gap:${GAP_PX}px;`
      : `display:flex;flex-wrap:wrap;gap:${GAP_PX}px;`;
    if (cross) {
      // 십자의 중심 — 고른 것이 있으면 "어디에 꽂을까"를 여기서 말한다
      const armed = this.picked >= 0 || this.carry !== null;
      const center = document.createElement('div');
      center.style.cssText =
        'grid-area:2 / 2;display:flex;align-items:center;justify-content:center;text-align:center;' +
        `font-size:10px;line-height:1.5;white-space:pre;color:${armed ? '#e8c76a' : '#555c66'};`;
      center.textContent = armed ? '칸을 눌러\n등록' : '1~4';
      grid.appendChild(center);
    }
    world.quickslots.forEach((kind, i) => {
      const cell = document.createElement('div');
      cell.dataset['key'] = `q${i}`;
      const armed = this.picked >= 0 || this.carry !== null;
      const here = this.pane === 'quick' && this.selQ === i;
      cell.style.cssText =
        CELL +
        (cross ? `grid-area:${CROSS_AREAS[i]};` : '') +
        `border:1px solid ${here ? '#7fbfff' : armed ? '#e8c76a' : '#3a3a44'};` +
        `background:${here ? 'rgba(127,191,255,0.12)' : kind ? 'rgba(232,199,106,0.07)' : 'rgba(255,255,255,0.02)'};cursor:pointer;`;

      const key = document.createElement('div');
      key.textContent = String(i + 1);
      key.style.cssText = 'position:absolute;top:2px;left:5px;font-size:10px;color:#8a8f9a;';
      cell.appendChild(key);

      if (kind) {
        const def = itemDef(kind);
        const count = countOf(world, kind);
        const icon = itemIcon(kind, ICON_PX);
        icon.style.cssText +=
          `position:absolute;left:50%;top:24px;transform:translate(-50%,-50%);` +
          `opacity:${count > 0 ? 1 : 0.25};`;
        cell.appendChild(icon);
        const name = document.createElement('div');
        name.textContent = `${def.short ?? def.name.slice(0, 2)} ${count}`;
        name.style.cssText =
          `position:absolute;bottom:3px;width:100%;text-align:center;font-size:10px;` +
          `color:${count > 0 ? '#cfd2da' : '#555c66'};`;
        cell.appendChild(name);
      }

      cell.onclick = () => { this.pane = 'quick'; this.selQ = i; this.act(); };
      cell.oncontextmenu = (ev) => { ev.preventDefault(); this.pane = 'quick'; this.selQ = i; this.dropCursor(); };
      if (kind) {
        const dragIcon = itemIcon(kind, ICON_PX).outerHTML;
        cell.onpointerdown = (ev) => beginDrag(ev, dragIcon, (key) => this.onDrop('quick', i, key));
      }
      cell.onmousemove = (ev) => {
        if (!this.hoverAllowed(ev)) return;
        if (this.pane === 'quick' && this.selQ === i) return;
        this.pane = 'quick';
        this.selQ = i;
        this.rebuild();
      };
      if (here && this.carry) {
        const overlay = this.carriedOverlay();
        if (overlay) cell.appendChild(overlay);
        attachPopup(cell, this.carryPopup('quick', i), 'left', this.padMode);
      } else if (here && kind) {
        // 십자는 창의 오른쪽 — 칸 왼쪽에 띄운다
        const content = consumablePopup(world, kind, countOf(world, kind), ` (퀵슬롯 ${i + 1})`);
        content.actions = [
          { key: String(i + 1), label: '전투 중 사용' },
          { key: this.key('A', 'Enter'), label: this.picked >= 0 ? '고른 가방 칸을 여기에 등록' : '등록 해제' },
          { key: this.key('X', 'X'), label: '등록 해제' },
        ];
        attachPopup(cell, content, 'left', this.padMode);
      } else if (here && this.picked >= 0) {
        attachPopup(cell, { title: `퀵슬롯 ${i + 1}`, lines: ['빈 칸'], actions: [{ key: this.key('A', 'Enter'), label: '고른 가방 칸을 여기에 등록' }] }, 'left', this.padMode);
      }
      grid.appendChild(cell);
    });
    box.appendChild(grid);
    return box;
  }

  // ---- 가방 ----
  /** 인형 — 장비 칸 7개(2열). 걸친 것은 아이콘·이름, 빈 칸은 부위 이름. Y/E·A·X = 벗기, 드래그로 가방 ↔ 인형 */
  private buildDoll(): HTMLElement {
    const world = this.world;
    const box = document.createElement('div');
    box.style.cssText = 'flex:none;';
    const wornCount = DOLL_ORDER.filter((s) => world.equipment[s]).length;
    const title = document.createElement('div');
    title.textContent = `장비 ${wornCount}/${DOLL_ORDER.length}`;
    title.style.cssText = `color:${this.pane === 'doll' ? '#7fbfff' : '#8a8f9a'};margin-bottom:6px;`;
    box.appendChild(title);
    const grid = document.createElement('div');
    grid.style.cssText = `display:grid;grid-template-columns:repeat(2, ${CELL_PX}px);gap:${GAP_PX}px;`;
    DOLL_ORDER.forEach((slot, i) => {
      const id = world.equipment[slot];
      const cell = document.createElement('div');
      cell.dataset['key'] = `d${i}`;
      const here = this.pane === 'doll' && this.selD === i;
      const canDrop = this.carry !== null || this.picked >= 0;
      cell.style.cssText =
        CELL +
        `border:1px ${id ? 'solid' : 'dashed'} ${here ? '#7fbfff' : canDrop ? '#e8c76a' : '#3a3a44'};` +
        `background:${here ? 'rgba(127,191,255,0.12)' : id ? 'rgba(232,199,106,0.07)' : 'rgba(255,255,255,0.02)'};cursor:pointer;`;
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
        const dragIcon = equipIcon(id, ICON_PX).outerHTML;
        cell.onpointerdown = (ev) => beginDrag(ev, dragIcon, (key) => this.onDrop('doll', i, key));
        cell.oncontextmenu = (ev) => { ev.preventDefault(); this.pane = 'doll'; this.selD = i; this.unequipCursor(); };
      } else {
        const empty = document.createElement('div');
        empty.textContent = '비어 있음';
        empty.style.cssText = 'position:absolute;bottom:3px;width:100%;text-align:center;font-size:10px;color:#555c66;';
        cell.appendChild(empty);
      }
      cell.onclick = () => { this.pane = 'doll'; this.selD = i; this.act(); };
      cell.ondblclick = () => { this.pane = 'doll'; this.selD = i; this.useCursor(); };
      cell.onmousemove = (ev) => {
        if (!this.hoverAllowed(ev)) return;
        if (this.pane === 'doll' && this.selD === i) return;
        this.pane = 'doll';
        this.selD = i;
        this.rebuild();
      };
      if (here && this.carry) {
        attachPopup(cell, this.carryPopup('doll', i), 'right', this.padMode);
      } else if (here && id) {
        const content = equipPopup(world, id, ' — 걸친 것', slot);
        content.usefulText = '걸치고 있다';
        content.actions = [
          { key: this.key('Y', 'E'), label: '벗기 → 가방' },
          { key: this.key('A 길게', '드래그'), label: '가방 칸으로 끌어 벗기' },
        ];
        attachPopup(cell, content, 'right', this.padMode);
      } else if (here) {
        attachPopup(cell, { title: `${slotLabel(slot)} — 비어 있음`, lines: ['가방의 장비를 Y/E·A 로 걸치거나 여기로 끌어 놓는다', slot === 'pack' ? '벨트 또는 가방 — 하나만. 가방 칸을 늘린다' : ''] .filter(Boolean) }, 'right', this.padMode);
      }
      grid.appendChild(cell);
    });
    box.appendChild(grid);
    return box;
  }

  private buildBag(): HTMLElement {
    const world = this.world;
    const cfg = balance.items;
    const box = document.createElement('div');
    box.style.cssText = 'flex:none;';

    const used = world.inventory.filter((s) => s !== null).length;
    const full = used >= world.inventory.length;
    const title = document.createElement('div');
    title.textContent = `가방 ${used}/${world.inventory.length}칸${full ? '  — 가득 찼다. 바닥의 아이템을 집을 수 없다' : ''}`;
    title.style.cssText = `color:${full ? '#e0455a' : this.pane === 'bag' ? '#7fbfff' : '#8a8f9a'};margin-bottom:6px;`;
    box.appendChild(title);

    const grid = document.createElement('div');
    grid.style.cssText = `display:grid;grid-template-columns:repeat(${cfg.cols}, ${CELL_PX}px);gap:${GAP_PX}px;`;
    world.inventory.forEach((slot, i) => {
      const cell = document.createElement('div');
      cell.dataset['key'] = `b${i}`;
      const here = this.pane === 'bag' && this.sel === i;
      const isPicked = i === this.picked;
      cell.style.cssText =
        CELL +
        `border:1px solid ${here ? '#7fbfff' : isPicked ? '#e8c76a' : '#3a3a44'};` +
        `background:${here ? 'rgba(127,191,255,0.12)' : isPicked ? 'rgba(232,199,106,0.12)' : 'rgba(255,255,255,0.02)'};` +
        `cursor:${slot ? 'pointer' : 'default'};`;
      if (this.carry && this.carry.index === i) cell.style.opacity = '0.35';

      if (slot) {
        const isSigil = slot.kind === 'sigil' && !!slot.sigilId;
        const isEquip = slot.kind === 'equip' && !!slot.equipId;
        const icon = isSigil ? sigilIcon(slot.sigilId!, ICON_PX) : isEquip ? equipIcon(slot.equipId!, ICON_PX) : itemIcon(slot.kind, ICON_PX);
        icon.style.cssText += 'position:absolute;left:50%;top:24px;transform:translate(-50%,-50%);';
        cell.appendChild(icon);

        const count = document.createElement('div');
        // 각인은 스택이 없다 — 개수 대신 이름 앞 글자. 이미 익힌 중복이면 흐리게
        count.textContent = isSigil ? sigilDef(slot.sigilId!).name.slice(0, 4) : isEquip ? equipDef(slot.equipId!).name.slice(0, 5) : `×${slot.count}`;
        count.style.cssText = isSigil || isEquip
          ? `position:absolute;bottom:3px;width:100%;text-align:center;font-size:10px;color:${isSigil ? sigilDef(slot.sigilId!).color : equipDef(slot.equipId!).color};`
          : 'position:absolute;bottom:3px;right:5px;font-size:11px;color:#cfd2da;';
        cell.appendChild(count);
        if (isSigil && world.sigils.inventory.includes(slot.sigilId!)) icon.style.opacity = '0.5';

        // 지금 써도 값어치가 없으면(만피의 체력 물약·만마나의 마나 물약·버프 중인 음식) 흐리게 — "마셔도 안 나가는" 이유를
        // 미리 보여 준다. 칸이 아니라 아이콘·개수에만 건다 — 칸에 걸면 자식인 설명 팝업까지 흐려진다 (2026-09-04)
        if (!isUseful(world, slot.kind) && !(this.carry && this.carry.index === i)) {
          icon.style.opacity = '0.45';
          count.style.opacity = '0.45';
        }

        const bound = world.quickslots.indexOf(slot.kind);
        if (bound >= 0) {
          const tag = document.createElement('div');
          tag.textContent = String(bound + 1);
          tag.style.cssText = 'position:absolute;top:2px;left:5px;font-size:10px;color:#e8c76a;';
          cell.appendChild(tag);
        }
        cell.oncontextmenu = (e) => { e.preventDefault(); this.pane = 'bag'; this.sel = i; this.dropCursor(); };
        const dragIcon = (isSigil ? sigilIcon(slot.sigilId!, ICON_PX) : isEquip ? equipIcon(slot.equipId!, ICON_PX) : itemIcon(slot.kind, ICON_PX)).outerHTML;
        cell.onpointerdown = (ev) => { if (!ev.shiftKey) beginDrag(ev, dragIcon, (key) => this.onDrop('bag', i, key)); };
      }
      cell.onclick = (ev) => {
        this.pane = 'bag';
        this.sel = i;
        if (ev.shiftKey) { this.openSplit(i); return; } // Shift+클릭 = 수량 나누기
        this.act();
      };
      cell.ondblclick = () => { this.pane = 'bag'; this.sel = i; this.useCursor(); }; // 더블클릭 = 사용
      cell.onmousemove = (ev) => {
        if (!this.hoverAllowed(ev)) return;
        if (this.pane === 'bag' && this.sel === i) return;
        this.pane = 'bag';
        this.sel = i;
        this.rebuild();
      };
      // 설명 팝업 — 커서 칸. 가방은 창의 왼쪽이라 칸 오른쪽에 띄운다. 들고 있으면 "여기에 놓기"
      if (here && this.carry) {
        const overlay = this.carriedOverlay();
        if (overlay) cell.appendChild(overlay);
        attachPopup(cell, this.carryPopup('bag', i), 'right', this.padMode);
      } else if (here && slot && slot.kind === 'equip' && slot.equipId) {
        const content = equipPopup(world, slot.equipId);
        const sellPrice = Math.round(equipDef(slot.equipId).price * balance.equipment.sellRatio);
        content.actions = [
          { key: this.key('Y', 'E'), label: '걸치기 (같은 부위 것과 맞바꾼다)' },
          { key: this.key('A 길게', '드래그'), label: '집어 옮기기 — 인형 칸에 놓으면 그 칸에 걸친다' },
          { key: this.key('X', 'X'), label: this.altar ? `팔기 ◆ ${sellPrice}` : '바닥에 버리기' },
        ];
        attachPopup(cell, content, 'right', this.padMode);
      } else if (here && slot && slot.kind === 'sigil' && slot.sigilId) {
        const content = sigilPopup(world, slot.sigilId);
        const known = world.sigils.inventory.includes(slot.sigilId);
        const sell = (balance.sigil.sellGold as Record<string, number>)[sigilDef(slot.sigilId).tier] ?? 0;
        content.actions = [
          { key: this.key('Y', 'E'), label: known ? '새기기 — 이미 익힌 각인' : '새기기 (몸에 박힌다 · 스킬 탭과 같다)' },
          { key: this.key('A 길게', '드래그'), label: '집어 옮기기' },
          { key: this.key('X', 'X'), label: this.altar ? `팔기 ◆ ${sell}` : '바닥에 버리기' },
        ];
        attachPopup(cell, content, 'right', this.padMode);
      } else if (here && slot) {
        const content = consumablePopup(world, slot.kind, slot.count);
        content.actions = [
          { key: this.key('Y', 'E'), label: isUseful(world, slot.kind) ? '사용 (창이 닫히고 마신다)' : '사용 — 지금은 값어치 없음' },
          { key: this.key('A', 'Enter'), label: isPicked ? '고르기 해제' : '고르기 → 퀵슬롯에 등록' },
          { key: this.key('A 길게', '드래그'), label: '집어 옮기기' },
          { key: this.key('X', 'X'), label: '바닥에 버리기' },
        ];
        if (slot.count >= 2) content.actions.push({ key: this.key('X 길게', 'Shift+Enter'), label: '수량 나누기' });
        attachPopup(cell, content, 'right', this.padMode);
      }
      grid.appendChild(cell);
    });
    box.appendChild(grid);
    return box;
  }
}

/** 퀵슬롯에 든 종류 — HUD 바가 읽는다 */
export function quickslotView(world: World): {
  kind: ItemKind | null;
  name: string;
  color: string;
  count: number;
  useful: boolean;
}[] {
  return world.quickslots.map((kind) => {
    if (!kind) return { kind: null, name: '', color: '#3a3a44', count: 0, useful: false };
    const def = itemDef(kind);
    return {
      kind,
      name: def.name,
      color: def.color,
      count: countOf(world, kind),
      useful: isUseful(world, kind),
    };
  });
}
