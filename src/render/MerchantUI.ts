// 상인 창(성소 로비) — 팔기 · 사기 · 퀘스트 세 탭. DOM 오버레이, 열려 있는 동안 시뮬레이션은 main 이 멈춘다.
// 제단 상점(ShopUI)의 줄 목록과 달리 **인벤토리 방식**이다 (2026-09-07 사용자):
//   팔기 — 내 가방 격자를 그대로 보여 주고 칸을 골라 판다 (A/Enter/클릭 = 한 개, X/우클릭 = 칸 통째로). 값은 칸에 적힌다.
//   사기 — 상인의 물건이 격자 칸으로 놓이고, 오른쪽에 내 가방이 함께 보인다 (얼마나 들고 있고 자리가 남는지).
//   커서 칸의 설명·값·조작은 맨 오른쪽 고정 칸(descBox)에 — 팝업이 옆 칸을 덮지 않게.
//   퀘스트 — 준비 중.
// 조작 규약은 가방·루팅 창과 같다: 커서 하나를 마우스·키보드·패드가 함께 움직인다. Tab·LB/RB·1/2/3 = 탭, B/Esc/E = 닫기.
// 무엇을 팔지는 종류가 정한다 — 각인은 Sigils, 장비는 Equipment, 소모품은 Merchant (창이 가른다. 시스템끼리는 서로 모른다).

import { balance } from '../core/Balance';
import { equipDef, equipSellable } from '../core/EquipData';
import { countOf, isUseful } from '../core/Inventory';
import { sigilDef } from '../core/SigilData';
import type { InventorySlot, ItemKind, LootEntry, World } from '../core/World';
import * as Altar from '../systems/Altar';
import * as Equipment from '../systems/Equipment';
import * as Merchant from '../systems/Merchant';
import * as Sigils from '../systems/Sigils';
import { equipIcon, itemIcon, lootIconSvg, sigilIcon } from './ItemIcons';
import { consumablePopup, equipPopup, keycap, sigilPopup, type PopupContent } from './ItemPopup';

const CELL_PX = 64;
const GAP_PX = 8;
const ICON_PX = 28;
const CELL = `width:${CELL_PX}px;height:${CELL_PX}px;box-sizing:border-box;position:relative;`;
/** 창 폭 고정 — 탭마다 내용 폭이 달라도 창이 늘고 줄지 않게 (가방·루팅 창과 같은 규약).
 *  사기 탭이 가장 넓다: 상인 물건(4열 280) + 내 가방(5열 352) + 설명 칸(DESC_PX) + 사이 28×2 + 안쪽 여백 26×2 */
const PANEL_PX = 1010;
const GOODS_COLS = 4;
/** 오른쪽 고정 설명 칸 — 떠다니는 팝업은 옆 칸을 덮어 격자를 가린다. 커서 칸의 설명·값·조작을 늘 같은 자리에 (2026-09-07) */
const DESC_PX = 250;

type Tab = 'sell' | 'buy' | 'quest';
const TABS: { id: Tab; label: string }[] = [
  { id: 'sell', label: '팔기' },
  { id: 'buy', label: '사기' },
  { id: 'quest', label: '퀘스트' },
];

/** 상인의 물건 — 제단 상점 품목과 같다 (값·재고 공유). kind 가 있으면 가방 소모품, 없으면 무기 자원 */
const GOODS: { item: Altar.ShopItem; kind?: ItemKind; name: string; unit: string }[] = [
  { item: 'heal', kind: 'potion', name: '체력 물약', unit: '개' },
  { item: 'mana', kind: 'mana', name: '마나 물약', unit: '개' },
  { item: 'healLarge', kind: 'potion_large', name: '대형 체력 물약', unit: '개' },
  { item: 'manaLarge', kind: 'mana_large', name: '대형 마나 물약', unit: '개' },
  { item: 'ammo', name: '권총탄', unit: '발' },
  { item: 'arrow', name: '화살', unit: '대' },
  { item: 'grenade', name: '수류탄', unit: '개' },
  { item: 'battery', name: '예비 배터리', unit: '개' },
];

const UP_KEYS = new Set(['KeyW', 'ArrowUp']);
const DOWN_KEYS = new Set(['KeyS', 'ArrowDown']);
const LEFT_KEYS = new Set(['KeyA', 'ArrowLeft']);
const RIGHT_KEYS = new Set(['KeyD', 'ArrowRight']);
const OUTLINE = 'rgba(0,0,0,0.55)';

/** 무기 자원 아이콘 — 가방 아이템이 아니라 ItemIcons 에 없다. 바닥 모형(Stage)과 같은 실루엣·색 */
function goodsIconSvg(item: Altar.ShopItem, size: number): string {
  const wrap = (body: string, glow: string): string =>
    `<svg viewBox="0 0 24 24" width="${size}" height="${size}" style="display:block;filter:drop-shadow(0 0 4px ${glow});">${body}</svg>`;
  switch (item) {
    case 'ammo':
      // 탄 세 발 — 놋쇠 탄피 + 납 탄두
      return wrap(
        [4, 10, 16].map((x) =>
          `<rect x="${x}" y="9" width="4" height="12" rx="1" fill="#c9a24a" stroke="${OUTLINE}" stroke-width="1"/>` +
          `<path d="M${x} 9a2 2 0 0 1 4 0Z" fill="#8a8f9a" stroke="${OUTLINE}" stroke-width="1"/>`,
        ).join(''),
        '#c9a24a',
      );
    case 'arrow':
      return lootIconSvg({ kind: 'arrow', count: 1, searched: true } as unknown as LootEntry, size);
    case 'grenade':
      return wrap(
        `<circle cx="12" cy="14" r="7" fill="#4a5a3a" stroke="${OUTLINE}" stroke-width="1.4"/>` +
          `<rect x="9.5" y="3" width="5" height="4" rx="1" fill="#8a8f9a" stroke="${OUTLINE}" stroke-width="1"/>` +
          `<path d="M14.5 4.5h4a1.5 1.5 0 0 1 0 3h-1" fill="none" stroke="#c9a24a" stroke-width="1.6" stroke-linecap="round"/>` +
          `<path d="M8 12h8M12 8v12" stroke="rgba(0,0,0,0.35)" stroke-width="1"/>`,
        '#7fb85a',
      );
    case 'battery':
      return wrap(
        `<rect x="6" y="5" width="12" height="17" rx="1.5" fill="#3a5f9a" stroke="${OUTLINE}" stroke-width="1.4"/>` +
          `<rect x="9.5" y="2.5" width="5" height="3" fill="#8a8f9a"/>` +
          `<path d="M12.5 9l-3 6h3l-1 5 4-7h-3l1-4z" fill="#ffe27a"/>`,
        '#7fbfff',
      );
    default:
      return '';
  }
}

export class MerchantUI {
  private readonly root: HTMLDivElement;
  open = false;
  private tab: Tab = 'sell';
  /** 커서 — 활성 격자의 칸 번호 (팔기: 가방 또는 창고 / 사기: 상인 물건) */
  private sel = 0;
  /** 팔기 탭의 격자 — 가방 위, 창고 아래 (창고 물건도 바로 판다, stash.md §2) */
  private pane: 'bag' | 'stash' = 'bag';
  private openedAt = 0;
  /** 패드로 조작 중 — 안내·키캡을 패드 표기로 (main 이 틱마다 갱신) */
  padMode = false;
  /** 창 안에서 닫았다(B·Esc·E) — main 이 uiOpen 을 되돌린다 */
  onClose: (() => void) | null = null;

  constructor(private readonly world: World) {
    this.root = document.createElement('div');
    this.root.id = 'merchantui';
    this.root.style.cssText =
      'position:fixed;inset:0;display:none;align-items:center;justify-content:center;' +
      'background:rgba(0,0,0,0.72);color:#cfd2da;font:13px/1.6 monospace;user-select:none;z-index:10;';
    document.body.appendChild(this.root);

    window.addEventListener('keydown', (e) => {
      if (!this.open) return;
      const digit = TABS.findIndex((_, i) => e.code === `Digit${i + 1}`);
      if (digit >= 0) {
        e.preventDefault();
        this.setTab(TABS[digit]!.id);
        return;
      }
      if (e.code === 'Tab') {
        e.preventDefault();
        this.cycleTab(e.shiftKey ? -1 : 1);
        return;
      }
      if (UP_KEYS.has(e.code)) { e.preventDefault(); this.move(0, -1); return; }
      if (DOWN_KEYS.has(e.code)) { e.preventDefault(); this.move(0, 1); return; }
      if (LEFT_KEYS.has(e.code)) { e.preventDefault(); this.move(-1, 0); return; }
      if (RIGHT_KEYS.has(e.code)) { e.preventDefault(); this.move(1, 0); return; }
      if (e.code === 'Enter' || e.code === 'NumpadEnter') { e.preventDefault(); this.act(); return; }
      if (e.code === 'KeyX') { e.preventDefault(); this.sellAll(); return; }
      // 창을 연 그 E 가 곧바로 닫지 않게 잠깐 무시한다
      if ((e.code === 'Escape' || e.code === 'KeyE') && performance.now() - this.openedAt > 250) {
        e.preventDefault();
        this.close();
      }
    });
  }

  show(): void {
    this.open = true;
    this.openedAt = performance.now();
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

  // ---- 패드 — 가방·루팅 창과 같은 고정 버튼 규약 (main 이 부른다) ----
  padMove(dx: number, dy: number): void { if (this.open) this.move(dx, dy); }
  padA(): void { if (this.open) this.act(); }
  padX(): void { if (this.open) this.sellAll(); }
  padB(): void { this.close(); }
  padTab(dir: number): void { if (this.open) this.cycleTab(dir); }

  private setTab(tab: Tab): void {
    if (this.tab === tab) return;
    this.tab = tab;
    this.sel = 0;
    this.pane = 'bag';
    this.rebuild();
  }

  /** 팔기 탭에서 커서가 가리키는 칸 배열 */
  private sellSlots(): (InventorySlot | null)[] {
    return this.pane === 'stash' ? this.world.stash : this.world.inventory;
  }

  private cycleTab(dir: number): void {
    const i = TABS.findIndex((t) => t.id === this.tab);
    this.setTab(TABS[(i + dir + TABS.length) % TABS.length]!.id);
  }

  /** 활성 격자의 열 수·칸 수 */
  private gridShape(): { cols: number; count: number } {
    if (this.tab === 'sell') {
      return this.pane === 'stash'
        ? { cols: balance.lobby.stash.cols, count: this.world.stash.length }
        : { cols: balance.items.cols, count: this.world.inventory.length };
    }
    if (this.tab === 'buy') return { cols: GOODS_COLS, count: GOODS.length };
    return { cols: 1, count: 0 };
  }

  /** 커서 이동 — 격자 안에서만, 끝에서는 멈춘다 */
  private move(dx: number, dy: number): void {
    const { cols, count } = this.gridShape();
    if (count === 0) return;
    const rows = Math.ceil(count / cols);
    let c = this.sel % cols;
    let r = Math.floor(this.sel / cols);
    // 팔기 탭 — 가방 아래로 나가면 창고, 창고 위로 나가면 가방
    if (this.tab === 'sell' && dy > 0 && r + dy >= rows && this.pane === 'bag' && this.world.stash.length > 0) {
      this.pane = 'stash';
      this.sel = Math.min(this.world.stash.length - 1, c);
      this.rebuild();
      return;
    }
    if (this.tab === 'sell' && dy < 0 && r + dy < 0 && this.pane === 'stash') {
      this.pane = 'bag';
      const bagCols = balance.items.cols;
      const bagRows = Math.ceil(this.world.inventory.length / bagCols);
      this.sel = Math.min(this.world.inventory.length - 1, (bagRows - 1) * bagCols + Math.min(c, bagCols - 1));
      this.rebuild();
      return;
    }
    c = Math.max(0, Math.min(cols - 1, c + dx));
    r = Math.max(0, Math.min(rows - 1, r + dy));
    const next = Math.min(count - 1, r * cols + c);
    if (next === this.sel) return;
    this.sel = next;
    this.rebuild();
  }

  /** A/Enter/클릭 — 팔기: 한 개 판다 · 사기: 산다 */
  private act(): void {
    if (this.tab === 'sell') this.sellCursor(false);
    else if (this.tab === 'buy') {
      const g = GOODS[this.sel];
      if (g) Altar.purchase(this.world, g.item); // 성공·실패 연출은 main 이 이벤트로
      this.rebuild();
    }
  }

  /** X/우클릭 — 칸 통째로 판다 (장비·각인은 한 개짜리라 A 와 같다) */
  private sellAll(): void {
    if (this.tab !== 'sell') return;
    this.sellCursor(true);
  }

  private sellCursor(all: boolean): void {
    const world = this.world;
    const slots = this.sellSlots();
    const slot = slots[this.sel];
    if (!slot) return;
    if (slot.kind === 'sigil') Sigils.sellFromBag(world, this.sel, slots);
    else if (slot.kind === 'equip') Equipment.sellFromBag(world, this.sel, slots);
    else Merchant.sellConsumable(world, this.sel, all, slots);
    this.rebuild();
  }

  /** 마우스가 실제로 움직였을 때만 커서를 따라간다 — 패드 조작 중·포인터락 해제 순간의 튐 방지 (가방 창과 같은 규약) */
  private hoverAllowed(ev: MouseEvent): boolean {
    return !this.padMode && !(ev.movementX === 0 && ev.movementY === 0);
  }

  private key(pad: string, kb: string): string {
    return this.padMode ? pad : kb;
  }

  private rebuild(): void {
    const world = this.world;
    const panel = document.createElement('div');
    panel.style.cssText =
      `background:#15151b;border:1px solid #3a3a44;padding:20px 26px;width:${PANEL_PX}px;box-sizing:border-box;`;

    // 머리 — 이름 + 골드 + 탭
    const head = document.createElement('div');
    head.style.cssText = 'display:flex;align-items:baseline;gap:18px;margin-bottom:14px;border-bottom:1px solid #23232b;padding-bottom:10px;';
    const title = document.createElement('div');
    title.textContent = `상인   ◆ ${world.gold}`;
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

    if (this.tab === 'sell') panel.appendChild(this.buildSell());
    else if (this.tab === 'buy') panel.appendChild(this.buildBuy());
    else panel.appendChild(this.buildQuest());

    const hint = document.createElement('div');
    hint.textContent = this.padMode
      ? 'D-패드·왼 스틱 커서   A 팔기(한 개)/구매   X 칸 통째로 팔기   LB/RB 탭   B 닫기'
      : 'WASD·↑↓←→ 커서   Enter·클릭 팔기(한 개)/구매   X·우클릭 칸 통째로 팔기   Tab·1/2/3 탭   E / Esc 닫기';
    hint.style.cssText = 'margin-top:16px;color:#8a8f9a;border-top:1px solid #23232b;padding-top:10px;white-space:pre-line;';
    panel.appendChild(hint);

    this.root.replaceChildren(panel);
  }

  // ---- 팔기 — 내 가방 격자 + 매입 안내 ----
  private buildSell(): HTMLElement {
    const wrap = document.createElement('div');
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:28px;align-items:flex-start;';
    wrap.appendChild(row);
    row.appendChild(this.bagGrid(true));

    // 매입 규칙 — 가운데 열
    const info = document.createElement('div');
    info.style.cssText = 'flex:1;color:#8a8f9a;font-size:12px;line-height:1.7;';
    const t = document.createElement('div');
    t.textContent = '매입';
    t.style.cssText = 'color:#cfd2da;margin-bottom:6px;';
    info.appendChild(t);
    const ratio = Math.round(balance.lobby.merchant.sellRatio * 100);
    const lines = [
      `소모품은 상점 값의 ${ratio}% 로 사 준다`,
      '칸마다 ◆ 매입가가 적혀 있다',
      `장비는 정가의 ${Math.round(balance.equipment.sellRatio * 100)}%, 각인은 등급값`,
      '(제단과 같다) · 유일 장비는 사지 않는다',
    ];
    for (const l of lines) {
      const el = document.createElement('div');
      el.textContent = l;
      info.appendChild(el);
    }
    row.appendChild(info);
    // 커서 칸 설명 — 오른쪽 고정 칸
    const slot = this.sellSlots()[this.sel];
    row.appendChild(this.descBox(slot ? this.sellPopup(this.sel) : { title: '빈 칸', lines: ['팔 물건을 고른다 — 커서를 가방·창고 칸으로'] }));
    // 창고 — 아래 전폭. 로비 성물함의 물건을 여기서도 판다 (stash.md §2)
    wrap.appendChild(this.stashGrid());
    return wrap;
  }

  /** 창고 격자(팔기 탭 아래) — 가방 격자와 같은 칸, 매입가 표기 */
  private stashGrid(): HTMLElement {
    const world = this.world;
    const box = document.createElement('div');
    box.style.cssText = 'margin-top:16px;';
    const title = document.createElement('div');
    title.textContent = `창고 ${world.stash.filter((s) => s).length}/${world.stash.length}칸 — 여기서도 판다`;
    title.style.cssText = `color:${this.pane === 'stash' ? '#7fbfff' : '#8a8f9a'};margin-bottom:6px;`;
    box.appendChild(title);
    const grid = document.createElement('div');
    grid.style.cssText = `display:grid;grid-template-columns:repeat(${balance.lobby.stash.cols}, ${CELL_PX}px);gap:${GAP_PX}px;`;
    world.stash.forEach((slot, i) => grid.appendChild(this.sellCell(slot, i, 'stash')));
    box.appendChild(grid);
    return box;
  }

  /** 팔기 칸 하나 — 가방·창고 공용 */
  private sellCell(slot: InventorySlot | null, i: number, pane: 'bag' | 'stash'): HTMLDivElement {
    const cell = document.createElement('div');
    const here = this.pane === pane && this.sel === i;
    cell.style.cssText =
      CELL +
      `border:1px solid ${here ? '#7fbfff' : '#3a3a44'};` +
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
      const price = this.priceOfSlot(slot);
      const tag = document.createElement('div');
      tag.textContent = price === null ? '×' : `◆${price.unit}`;
      tag.style.cssText = `position:absolute;top:2px;left:4px;font-size:10px;color:${price === null ? '#a05050' : '#e8c76a'};`;
      cell.appendChild(tag);
    }
    cell.onclick = () => { this.pane = pane; this.sel = i; this.act(); };
    cell.oncontextmenu = (e) => { e.preventDefault(); this.pane = pane; this.sel = i; this.sellAll(); };
    cell.onmousemove = (ev) => {
      if (!this.hoverAllowed(ev) || (this.pane === pane && this.sel === i)) return;
      this.pane = pane;
      this.sel = i;
      this.rebuild();
    };
    return cell;
  }

  /** 오른쪽 고정 설명 칸 — 팝업 내용(제목·설명·값어치·조작)을 같은 자리에 그린다 */
  private descBox(content: PopupContent): HTMLElement {
    const box = document.createElement('div');
    box.style.cssText =
      `flex:none;width:${DESC_PX}px;box-sizing:border-box;padding:10px 12px;min-height:${CELL_PX * 2 + GAP_PX + 26}px;` +
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

  /** 커서 격자의 index 칸 매입가 */
  private sellPriceOf(index: number): { unit: number; all: number } | null {
    return this.priceOfSlot(this.sellSlots()[index] ?? null);
  }

  /** 칸의 매입가 — { 한 개, 전부 }. 못 파는 칸(유일 장비·값 없는 종류)은 null */
  private priceOfSlot(slot: InventorySlot | null): { unit: number; all: number } | null {
    if (!slot) return null;
    if (slot.kind === 'equip' && slot.equipId) {
      if (!equipSellable(slot.equipId)) return null;
      const p = Math.round(equipDef(slot.equipId).price * balance.equipment.sellRatio);
      return { unit: p, all: p };
    }
    if (slot.kind === 'sigil' && slot.sigilId) {
      const p = (balance.sigil.sellGold as Record<string, number>)[sigilDef(slot.sigilId).tier] ?? 0;
      return { unit: p, all: p };
    }
    const unit = Merchant.unitSellPrice(slot.kind);
    return unit === null ? null : { unit, all: unit * slot.count };
  }

  /** 내 가방 격자 — interactive 면 팔기 커서·팝업, 아니면(사기 탭) 보기만 */
  private bagGrid(interactive: boolean): HTMLElement {
    const world = this.world;
    const box = document.createElement('div');
    box.style.cssText = 'flex:none;';
    const used = world.inventory.filter((s) => s !== null).length;
    const full = used >= world.inventory.length;
    const title = document.createElement('div');
    title.textContent = `내 가방 ${used}/${world.inventory.length}칸${full ? '  — 가득 찼다' : ''}`;
    title.style.cssText = `color:${full ? '#e0455a' : interactive ? '#7fbfff' : '#8a8f9a'};margin-bottom:6px;`;
    box.appendChild(title);

    const grid = document.createElement('div');
    grid.style.cssText = `display:grid;grid-template-columns:repeat(${balance.items.cols}, ${CELL_PX}px);gap:${GAP_PX}px;`;
    world.inventory.forEach((slot, i) => {
      if (interactive) { grid.appendChild(this.sellCell(slot, i, 'bag')); return; }
      const cell = document.createElement('div');
      const here = false;
      cell.style.cssText =
        CELL +
        `border:1px solid ${here ? '#7fbfff' : '#3a3a44'};` +
        `background:${here ? 'rgba(127,191,255,0.12)' : 'rgba(255,255,255,0.02)'};` +
        `cursor:${slot && interactive ? 'pointer' : 'default'};`;
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
      grid.appendChild(cell);
    });
    box.appendChild(grid);
    return box;
  }

  /** 팔기 칸 팝업 — 설명 + 매입가 + 조작 */
  private sellPopup(index: number): PopupContent {
    const world = this.world;
    const slot = this.sellSlots()[index]!;
    const price = this.sellPriceOf(index);
    let content: PopupContent;
    if (slot.kind === 'equip' && slot.equipId) content = equipPopup(world, slot.equipId);
    else if (slot.kind === 'sigil' && slot.sigilId) content = sigilPopup(world, slot.sigilId);
    else content = consumablePopup(world, slot.kind, slot.count);
    if (price === null) {
      content.usefulText = slot.kind === 'equip' ? '유일한 장비 — 사지 않는다' : '사지 않는다';
      content.useful = false;
      content.actions = [];
    } else {
      content.usefulText = `매입 ◆ ${price.unit} / 개`;
      content.useful = true;
      content.actions = [{ key: this.key('A', 'Enter'), label: `한 개 팔기  ◆ ${price.unit}` }];
      if (slot.count > 1) content.actions.push({ key: this.key('X', 'X'), label: `전부 팔기 (×${slot.count})  ◆ ${price.all}` });
    }
    return content;
  }

  // ---- 사기 — 상인의 물건 격자 + 내 가방(보기) ----
  private buildBuy(): HTMLElement {
    const world = this.world;
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:28px;align-items:flex-start;';

    const box = document.createElement('div');
    box.style.cssText = 'flex:none;';
    const title = document.createElement('div');
    title.textContent = '상인의 물건';
    title.style.cssText = 'color:#7fbfff;margin-bottom:6px;';
    box.appendChild(title);
    const grid = document.createElement('div');
    grid.style.cssText = `display:grid;grid-template-columns:repeat(${GOODS_COLS}, ${CELL_PX}px);gap:${GAP_PX}px;`;
    GOODS.forEach((g, i) => {
      const s = Altar.shopState(world, g.item);
      const here = this.sel === i;
      const cell = document.createElement('div');
      cell.style.cssText =
        CELL +
        `border:1px solid ${here ? '#7fbfff' : '#3a3a44'};` +
        `background:${here ? 'rgba(127,191,255,0.12)' : 'rgba(255,255,255,0.02)'};cursor:pointer;`;
      const icon = document.createElement('span');
      icon.style.cssText = 'display:block;line-height:0;position:absolute;left:50%;top:24px;transform:translate(-50%,-50%);';
      icon.innerHTML = g.kind ? itemIcon(g.kind, ICON_PX).innerHTML : goodsIconSvg(g.item, ICON_PX);
      if (!s.canBuy) icon.style.opacity = '0.4';
      cell.appendChild(icon);
      // 값 — 오른쪽 아래. 골드가 모자라면 붉게
      const price = document.createElement('div');
      price.textContent = `◆${s.price}`;
      price.style.cssText = `position:absolute;bottom:3px;right:4px;font-size:10px;color:${s.poor ? '#a05050' : '#e8c76a'};`;
      cell.appendChild(price);
      // 재고 — 왼쪽 위 (여러 개짜리만). 떨어졌으면 시계
      const stock = document.createElement('div');
      stock.textContent = s.cooldown > 0 ? '⏳' : s.stockMax > 1 ? `${s.stock}/${s.stockMax}` : '';
      stock.style.cssText = `position:absolute;top:2px;left:4px;font-size:10px;color:${s.stock > 0 ? '#8a8f9a' : '#8a7a4a'};`;
      cell.appendChild(stock);
      // 한 번에 주는 양 — 왼쪽 아래
      const amount = document.createElement('div');
      amount.textContent = `+${s.amount}`;
      amount.style.cssText = 'position:absolute;bottom:3px;left:4px;font-size:10px;color:#9fe870;';
      cell.appendChild(amount);
      cell.onclick = () => { this.sel = i; this.act(); };
      cell.onmousemove = (ev) => {
        if (!this.hoverAllowed(ev) || this.sel === i) return;
        this.sel = i;
        this.rebuild();
      };
      grid.appendChild(cell);
    });
    box.appendChild(grid);
    const note = document.createElement('div');
    note.textContent = '제단 상점과 같은 물건·값·재고 — 다 팔리면 5분 뒤 재입고';
    note.style.cssText = 'margin-top:8px;color:#8a8f9a;font-size:11px;';
    box.appendChild(note);
    row.appendChild(box);

    row.appendChild(this.bagGrid(false));
    row.appendChild(this.descBox(this.buyPopup(this.sel)));
    return row;
  }

  /** 사기 칸 팝업 — 효과(소모품이면 가방 설명 그대로) + 양·보유·재고·값 + 조작 */
  private buyPopup(index: number): PopupContent {
    const world = this.world;
    const g = GOODS[index]!;
    const s = Altar.shopState(world, g.item);
    const content: PopupContent = g.kind
      ? consumablePopup(world, g.kind, s.amount, ' (상인)')
      : { title: `${g.name} +${s.amount}${g.unit}`, lines: [] };
    if (g.kind) {
      content.lines = content.lines.filter((l) => !l.startsWith('가방에')); // 아래 '보유' 줄과 겹친다
      content.lines.push(`가방에 ${countOf(world, g.kind)}개${isUseful(world, g.kind) ? '' : ' (지금은 쓸 값어치 없음)'}`);
    } else {
      content.lines.push(`보유 ${s.have}/${s.max}`);
    }
    if (s.stockMax > 1) content.lines.push(`재고 ${s.stock}/${s.stockMax}`);
    content.lines.push(`값 ◆ ${s.price}`);
    if (s.cooldown > 0) {
      const sec = Math.ceil(s.cooldown / balance.loop.tickRate);
      content.useful = false;
      content.usefulText = `재입고까지 ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
    } else if (s.full) {
      content.useful = false;
      content.usefulText = g.kind ? '가방이 가득 찼다' : '이미 가득 찼다';
    } else if (s.poor) {
      content.useful = false;
      content.usefulText = `골드 부족 — ◆ ${world.gold} / ${s.price}`;
    } else {
      content.useful = true;
      content.usefulText = '구매 가능';
    }
    content.actions = s.canBuy ? [{ key: this.key('A', 'Enter'), label: `구매  ◆ ${s.price}` }] : [];
    return content;
  }

  // ---- 퀘스트 — 준비 중 ----
  private buildQuest(): HTMLElement {
    const box = document.createElement('div');
    box.style.cssText = 'padding:18px 6px;color:#8a8f9a;line-height:1.8;min-height:160px;';
    const t = document.createElement('div');
    t.textContent = '퀘스트 — 준비 중';
    t.style.cssText = 'color:#cfd2da;font-size:14px;margin-bottom:8px;';
    box.appendChild(t);
    const q = document.createElement('div');
    q.textContent = '"지하에서 가져다 줄 게 생기면 말하지. 지금은 팔 것과 살 것이나 보게."';
    box.appendChild(q);
    const sub = document.createElement('div');
    sub.textContent = '상인의 부탁(수집·배달)은 이후 구역에서 열린다.';
    sub.style.cssText = 'color:#555c66;font-size:11px;margin-top:6px;';
    box.appendChild(sub);
    return box;
  }
}
