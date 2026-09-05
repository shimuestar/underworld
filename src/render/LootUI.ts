// 루팅 UI — 주머니·보물상자를 뒤지는 두 칸 창. 왼쪽 컨테이너, 오른쪽 내 가방(+골드·화살 카운터).
// ShopUI 와 같은 규약: DOM 오버레이, 열려 있는 동안 main 이 시뮬레이션을 멈춘다(uiOpen),
// 커서 하나를 키보드·마우스·패드가 함께 움직인다. 규칙은 systems/Loot 가 갖고 여기는
// 그리기·입력·연출만 — 아이콘이 반대 칸으로 날아가고 골드·화살 카운터가 오르는 것으로
// '옮겨지는 것'이 눈에 보이게 한다.
//
// 조작: WASD/화살표 이동(←→ 로 칸 전환), Enter·좌클릭 = 가져오기/넣기, T = 모두 가져오기,
// X·Delete·우클릭 = 바닥에 버리기, E/Esc 닫기. 패드는 main 이 padMove/padActivate/... 로 부른다.
// Space·Shift 는 일부러 안 쓴다 — 전투에서 가장 많이 두들기는 키라 오조작이 난다 (ShopUI 와 같다).

import { balance } from '../core/Balance';
import type { LootEntry, World } from '../core/World';
import * as Loot from '../systems/Loot';
import { itemIconSvg, lootIconSvg } from './ItemIcons';
import { attachPopup, consumablePopup, lootEntryPopup, type PopupContent } from './ItemPopup';
import { beginDrag } from './DragDrop';
import { moveSlot, splitSlot } from '../core/Inventory';
import { adjustSplit, makeSplit, renderSplitDialog, splitActivate, splitNavigate, type SplitState } from './SplitDialog';

const UP_KEYS = new Set(['KeyW', 'ArrowUp']);
const DOWN_KEYS = new Set(['KeyS', 'ArrowDown']);
const LEFT_KEYS = new Set(['KeyA', 'ArrowLeft']);
const RIGHT_KEYS = new Set(['KeyD', 'ArrowRight']);
const CELL_PX = 64;
const ICON_PX = 28;
const ROW_ICON_PX = 22;
const GRID_GAP_PX = 8;
/** 두 패널(컨테이너 | 가방) 사이 */
const PANEL_GAP_PX = 24;
const PANEL_PAD_X = 26;

/** 커서가 있는 곳 — 컨테이너 격자 / 가방 격자 / 컨테이너 아래 버튼 줄(모두 가져오기·닫기) */
type Pane = 'container' | 'bag' | 'buttons';

/** 가져온 것이 어디로 갔는지 — 날아가는 아이콘의 목적지 표식 (data-fly) */
function flyTargetOf(e: LootEntry): string {
  if (e.kind === 'gold') return 'gold';
  if (e.kind === 'arrow') return 'arrow';
  if (e.kind === 'sigil' || e.kind === 'equip') return 'title';
  return `b:${e.kind}`;
}

export class LootUI {
  private readonly root: HTMLDivElement;
  open = false;
  pane: Pane = 'container';
  private selC = 0;
  private selB = 0;
  /** 버튼 줄 커서 — 0 모두 가져오기, 1 닫기 (패드·키보드로도 고를 수 있어야 한다, 2026-09-04) */
  private selBtn = 0;
  /** 닫힐 때 main 이 Loot.closeLoot 와 uiOpen 을 되돌린다 */
  onClose: (() => void) | null = null;
  /** 이 키면 창을 닫고 게임에 그대로 넘긴다(반응·질주) — 실시간 루팅에서 위협에 즉시 대응. main 이 키 설정으로 준다 */
  escapeKey: ((code: string) => boolean) | null = null;
  /** 패드로 조작 중 — 버튼·힌트를 패드 표기로 (main 이 틱마다 갱신) */
  padMode = false;
  /** 직전 동작의 연출 — rebuild 뒤 목적지를 찾아 아이콘을 날린다 / 거부된 줄을 흔든다 */
  private pendingFly: { svg: string; from: DOMRect; toKey: string } | null = null;
  private shakeKey: string | null = null;
  /** 컨테이너 칸 배치 — 줄(entries)은 가져가면 당겨지지만 칸은 제자리를 지킨다(빈 칸으로 남는다).
   *  같은 항목 객체가 살아 있는 동안 같은 칸, 새 항목은 첫 빈 칸. 창을 열 때 다시 짠다 */
  private layout: (LootEntry | null)[] = [];
  private layoutKey: string | null = null;
  /** 패드 집어 들기 — 들고 있는 원본 칸. A 길게로 들고, A 놓기 / B 취소 / Y 버리기 (2026-09-04) */
  private carry: { pane: Pane; index: number } | null = null;
  private aHoldTicks = 0;
  /** 이번 A 누름이 '집어 들기'로 소비됐다 — 떼는 순간 놓기/가져오기로 흐르지 않게 */
  private aConsumed = false;
  /** 수량 나누기 대화상자 (가방 스택) — X 길게 / Shift+Enter / Shift+클릭 */
  private split: SplitState | null = null;
  /** 상황 안내 — 창을 벗어난 사이 패드가 잠든 이유 같은 것 (main 이 setNotice 로, 글이 바뀔 때만 다시 그린다) */
  private notice: string | null = null;
  private xHoldTicks = 0;
  private xConsumed = false;
  /** 뒤지기 — 지금 밝히는 중인 칸과 시작 시각(벽시계, 창은 시간 정지 중에도 돈다) */
  private searching: { entry: LootEntry; startMs: number } | null = null;
  private searchRaf: number | null = null;

  constructor(private readonly world: World) {
    this.root = document.createElement('div');
    this.root.id = 'lootui';
    this.root.style.cssText =
      'position:fixed;inset:0;display:none;align-items:center;justify-content:center;' +
      'background:rgba(0,0,0,0.4);color:#cfd2da;font:13px/1.6 monospace;user-select:none;z-index:10;'; // 뒤의 던전이 비친다
    document.body.appendChild(this.root);

    window.addEventListener('keydown', (e) => {
      if (!this.open) return;
      if (!this.split && this.escapeKey?.(e.code)) { this.close(); return; } // preventDefault 없이 — 게임이 그 키를 받는다
      if (this.split) {
        // 대화상자 — 화살표/WASD 로 수량 줄(±1·+big)과 버튼 줄(−big·−1·+1·+big·확인·취소) 사이를 오가고 Enter 실행, Esc 취소
        e.preventDefault();
        if (LEFT_KEYS.has(e.code)) this.navSplit(-1, 0);
        else if (RIGHT_KEYS.has(e.code)) this.navSplit(1, 0);
        else if (UP_KEYS.has(e.code)) this.navSplit(0, -1);
        else if (DOWN_KEYS.has(e.code)) this.navSplit(0, 1);
        else if (e.code === 'Enter' || e.code === 'NumpadEnter') this.activateSplit();
        else if (e.code === 'Escape' || e.code === 'KeyE') this.cancelSplit();
        return;
      }
      if ((e.code === 'Enter' || e.code === 'NumpadEnter') && e.shiftKey) { e.preventDefault(); this.openSplit(); return; }
      if (UP_KEYS.has(e.code)) { e.preventDefault(); this.move(0, -1); return; }
      if (DOWN_KEYS.has(e.code)) { e.preventDefault(); this.move(0, 1); return; }
      if (LEFT_KEYS.has(e.code)) { e.preventDefault(); this.move(-1, 0); return; }
      if (RIGHT_KEYS.has(e.code)) { e.preventDefault(); this.move(1, 0); return; }
      if (e.code === 'Enter' || e.code === 'NumpadEnter') { e.preventDefault(); this.act(); return; }
      if (e.code === 'KeyT') { e.preventDefault(); this.takeAll(); return; }
      if (e.code === 'KeyX' || e.code === 'Delete') { e.preventDefault(); this.drop(); return; }
      if (e.code === 'KeyE' || e.code === 'Escape') { e.preventDefault(); this.close(); }
    });
  }

  show(): void {
    this.open = true;
    this.pane = 'container';
    this.selC = 0;
    this.selB = 0;
    this.carry = null;
    this.aHoldTicks = 0;
    this.aConsumed = false;
    this.split = null;
    this.xHoldTicks = 0;
    this.xConsumed = false;
    this.pendingFly = null;
    this.shakeKey = null;
    this.layout = [];
    this.layoutKey = null;
    this.root.style.display = 'flex';
    this.rebuild();
    this.startSearch();
  }

  /** 마우스 hover 로 커서를 옮겨도 되는가 — 패드로 조작 중이거나 실제로 움직인 게 아니면(이동량 0) 무시한다.
   *  포인터락이 풀리며 화면 중앙에 나타나는 커서가 가방 격자 위에 놓여, 패드로 열자마자 커서가 가방으로 튀었다 (2026-09-04) */
  private hoverAllowed(ev: MouseEvent): boolean {
    if (this.padMode) return false;
    return ev.movementX !== 0 || ev.movementY !== 0;
  }

  /** 뒤지기 루프 — 아직 모르는 칸을 배치 순서대로 하나씩 perItemMs 동안 한 바퀴 돌려 밝힌다 */
  private startSearch(): void {
    if (this.searchRaf !== null) return;
    const step = (): void => {
      this.searchRaf = null;
      if (!this.open) { this.searching = null; return; }
      const c = Loot.container(this.world);
      if (!c) { this.searching = null; return; }
      this.syncLayout(c);
      const now = performance.now();
      if (!this.searching) {
        const next = this.layout.find((e) => e !== null && !e.searched) ?? null;
        if (!next) return; // 다 밝혀졌다 — 루프 종료 (새 항목이 들어오면 rebuild 가 다시 켠다)
        this.searching = { entry: next, startMs: now };
        this.rebuild();
      }
      const per = Math.max(1, balance.loot.search.perItemMs);
      const frac = (now - this.searching.startMs) / per;
      if (frac >= 1 || !c.entries.includes(this.searching.entry)) {
        if (c.entries.includes(this.searching.entry)) Loot.revealEntry(this.world, this.searching.entry);
        this.searching = null;
        this.rebuild(); // 밝혀진 칸을 그린다 (다음 칸은 다음 프레임에)
      } else {
        const idx = this.layout.indexOf(this.searching.entry);
        const sweep = this.root.querySelector<HTMLElement>(`[data-key="c${idx}"] [data-sweep]`);
        if (sweep) {
          const deg = Math.round(frac * 360);
          sweep.style.background = `conic-gradient(rgba(127,191,255,0.42) 0deg ${deg}deg, transparent ${deg}deg 360deg)`;
        }
      }
      this.searchRaf = requestAnimationFrame(step);
    };
    this.searchRaf = requestAnimationFrame(step);
  }

  /** 줄 → 칸 배치를 맞춘다: 사라진 항목의 칸은 비우고(당기지 않는다), 새 항목은 첫 빈 칸에 */
  private syncLayout(c: Loot.Container): void {
    const key = `${c.ref.kind}:${c.ref.id}`;
    if (this.layoutKey !== key) {
      this.layout = [];
      this.layoutKey = key;
    }
    const live = new Set<LootEntry>(c.entries);
    for (let i = 0; i < this.layout.length; i++) {
      const e = this.layout[i];
      if (e && !live.has(e)) this.layout[i] = null;
    }
    for (const e of c.entries) {
      if (this.layout.includes(e)) continue;
      const hole = this.layout.indexOf(null);
      if (hole >= 0) this.layout[hole] = e;
      else this.layout.push(e);
    }
  }

  /** 커서 칸의 항목과 줄 번호 (빈 칸이면 null) */
  private cursorEntry(c: Loot.Container): { entry: LootEntry; index: number } | null {
    const e = this.layout[this.selC];
    if (!e) return null;
    const index = c.entries.indexOf(e);
    return index >= 0 ? { entry: e, index } : null;
  }

  hide(): void {
    this.open = false;
    this.root.style.display = 'none';
    if (this.searchRaf !== null) cancelAnimationFrame(this.searchRaf);
    this.searchRaf = null;
    this.searching = null; // 닫으면 멈춘다 — 밝혀진 것(searched)은 데이터에 남아 다시 열면 이어진다
  }

  /** 닫기 — 창을 숨기고 onClose 로 규칙(Loot.closeLoot·uiOpen)을 되돌린다. main 도 부른다(끊김·무기 버튼) */
  close(): void {
    if (!this.open) return;
    this.hide();
    this.onClose?.();
  }

  // ---- 패드 — 일시정지 메뉴·상점과 같은 고정 버튼 규약 (main 이 raw 버튼으로 부른다) ----
  padMove(dx: number, dy: number): void {
    if (!this.open) return;
    if (this.split) {
      // 대화상자 — 수량 줄/버튼 줄 커서 (SplitDialog.splitNavigate)
      this.navSplit(dx, dy);
      return;
    }
    this.move(dx, dy);
  }
  padActivate(): void { if (this.open) this.act(); }
  padTakeAll(): void { if (this.open && !this.carry && !this.split) this.takeAll(); } // 들고 있는 동안은 잠근다 (원본이 사라진다)
  padDrop(): void { if (this.open && !this.split) (this.carry ? this.dropCarried() : this.drop()); }
  padClose(): void {
    if (this.split) this.cancelSplit();
    else if (this.carry) this.cancelCarry();
    else this.close();
  }
  get carrying(): boolean { return this.carry !== null; }
  get splitting(): boolean { return this.split !== null; }
  setNotice(text: string | null): void {
    if (this.notice === text) return;
    this.notice = text;
    if (this.open) this.rebuild();
  }

  /** X 버튼 상태를 매 틱 받는다 — 짧게 떼면 모두 가져오기, padSplitHoldTicks 넘게 누르면 커서 가방 스택 수량 나누기 */
  padX(held: boolean): void {
    if (!this.open) return;
    if (held) {
      this.xHoldTicks++;
      if (!this.xConsumed && !this.split && !this.carry && this.xHoldTicks >= balance.loot.ui.padSplitHoldTicks) {
        this.xConsumed = true;
        this.openSplit();
      }
      return;
    }
    if (this.xHoldTicks === 0) return;
    const consumed = this.xConsumed;
    this.xHoldTicks = 0;
    this.xConsumed = false;
    if (consumed || this.split) return;
    this.padTakeAll();
  }

  /** 커서 가방 칸의 스택(2개 이상)을 나누는 대화상자를 연다 — 빈 칸이 없으면 거부 */
  private openSplit(): void {
    if (this.pane !== 'bag' || this.carry) return;
    const slot = this.world.inventory[this.selB];
    if (!slot || slot.count < 2) { this.shakeKey = `b${this.selB}`; this.rebuild(); return; }
    if (!this.world.inventory.includes(null)) {
      this.world.events.emit('loot_denied', { reason: 'full', kind: slot.kind }); // 나눌 빈 칸이 없다
      this.shakeKey = `b${this.selB}`;
      this.rebuild();
      return;
    }
    this.split = makeSplit(this.selB, slot.kind, slot.count);
    this.rebuild();
  }
  private adjustSplit(delta: number): void {
    if (!this.split) return;
    adjustSplit(this.split, delta);
    this.rebuild();
  }
  private navSplit(dx: number, dy: number): void {
    if (!this.split) return;
    splitNavigate(this.split, dx, dy);
    this.rebuild();
  }
  private activateSplit(): void {
    if (!this.split) return;
    const r = splitActivate(this.split);
    if (r === 'confirm') this.confirmSplit();
    else if (r === 'cancel') this.cancelSplit();
    else this.rebuild();
  }
  private confirmSplit(): void {
    const s = this.split;
    if (!s) return;
    this.split = null;
    const to = splitSlot(this.world, s.index, s.amount);
    if (to >= 0) { this.pane = 'bag'; this.selB = to; } // 커서가 새 칸으로 — 바로 끌어다 놓거나 집어 들 수 있게
    else this.shakeKey = `b${s.index}`;
    this.rebuild();
  }
  private cancelSplit(): void {
    if (!this.split) return;
    this.split = null;
    this.rebuild();
  }

  /** A 버튼 상태를 매 틱 받는다 — 짧게 떼면 가져오기/넣기(또는 들고 있으면 놓기), padPickHoldTicks 넘게 누르면 집어 들기 */
  padA(held: boolean): void {
    if (!this.open) return;
    if (this.split) {
      // 대화상자 — A 를 떼는 순간 커서가 얹힌 것을 실행 (수량 줄이면 확인)
      if (held) { this.aHoldTicks++; return; }
      if (this.aHoldTicks > 0) { this.aHoldTicks = 0; this.aConsumed = false; this.activateSplit(); }
      return;
    }
    if (held) {
      this.aHoldTicks++;
      if (!this.carry && !this.aConsumed && this.aHoldTicks >= balance.loot.ui.padPickHoldTicks) {
        this.aConsumed = true; // 집어 든 그 누름을 떼는 순간 놓기로 흐르지 않게
        this.pickUp();
      }
      return;
    }
    if (this.aHoldTicks === 0) return;
    const consumed = this.aConsumed;
    this.aHoldTicks = 0;
    this.aConsumed = false;
    if (consumed) return;
    if (this.carry) this.place();
    else this.act();
  }

  /** 커서 칸의 것을 집어 든다 — 밝혀진 컨테이너 칸 또는 든 가방 칸만 */
  private pickUp(): void {
    const c = Loot.container(this.world);
    if (!c || this.pane === 'buttons') return;
    if (this.pane === 'container') {
      const e = this.layout[this.selC] ?? null;
      if (!e || !e.searched) return;
      this.carry = { pane: 'container', index: this.selC };
    } else {
      if (!this.world.inventory[this.selB]) return;
      this.carry = { pane: 'bag', index: this.selB };
    }
    this.world.events.emit('loot_carry_started', { pane: this.carry.pane });
    this.rebuild();
  }

  /** 들고 있는 것을 커서 칸에 놓는다 — 마우스 드래그(onDrop)와 같은 규칙 */
  private place(): void {
    const carry = this.carry;
    if (!carry || this.pane === 'buttons') return;
    this.carry = null;
    const key = this.pane === 'container' ? `c${this.selC}` : `b${this.selB}`;
    this.onDrop(carry.pane, carry.index, key); // 안에서 rebuild
  }

  /** 취소 — 아이콘이 원래 칸으로 날아 돌아간다 */
  private cancelCarry(): void {
    const carry = this.carry;
    if (!carry) return;
    this.carry = null;
    const cursorKey = this.pane === 'container' ? `c${this.selC}` : `b${this.selB}`;
    const svg = this.carriedIconSvg(carry, ROW_ICON_PX);
    if (svg) this.pendingFly = { svg, from: this.rectOf(cursorKey), toKey: `cell:${carry.pane === 'container' ? 'c' : 'b'}${carry.index}` };
    this.world.events.emit('loot_carry_cancelled', {});
    this.rebuild();
  }

  /** 들고 있는 것을 바닥에 버린다 (Y) */
  private dropCarried(): void {
    const carry = this.carry;
    if (!carry) return;
    this.carry = null;
    const c = Loot.container(this.world);
    if (!c) { this.close(); return; }
    if (carry.pane === 'container') {
      const e = this.layout[carry.index] ?? null;
      const index = e ? c.entries.indexOf(e) : -1;
      if (index >= 0) Loot.dropToFloor(this.world, 'container', index);
    } else {
      Loot.dropToFloor(this.world, 'bag', carry.index);
    }
    this.clampSel();
    this.rebuild();
  }

  /** 들고 있는 것의 아이콘 SVG — 원본이 사라졌으면 null */
  private carriedIconSvg(carry: { pane: Pane; index: number }, px: number): string | null {
    if (carry.pane === 'container') {
      const e = this.layout[carry.index] ?? null;
      return e ? lootIconSvg(e, px) : null;
    }
    const slot = this.world.inventory[carry.index];
    return slot ? itemIconSvg(slot.kind, px) : null;
  }

  /** 들고 있을 때 커서 칸의 팝업 — 여기에 놓으면 무슨 일이 일어나는지 미리 말한다 */
  private carryPopup(pane: Pane, index: number): PopupContent {
    const carry = this.carry!;
    const world = this.world;
    const lines: string[] = [];
    const stackMax = balance.items.stackMax;
    const same = carry.pane === pane && carry.index === index;
    if (same) lines.push('원래 자리 — 놓으면 그대로 둔다');
    else if (carry.pane === 'bag' && pane === 'bag') {
      const src = world.inventory[carry.index];
      const dst = world.inventory[index];
      if (!dst) lines.push('빈 칸으로 옮긴다');
      else if (src && dst.kind === src.kind && dst.count < stackMax) lines.push(`같은 종류 — ${Math.min(stackMax - dst.count, src.count)}개 합친다 (나머지는 제자리)`);
      else lines.push('자리를 맞바꾼다');
    } else if (carry.pane === 'container' && pane === 'container') {
      lines.push(this.layout[index] ? '자리를 맞바꾼다' : '빈 칸으로 옮긴다');
    } else if (carry.pane === 'container' && pane === 'bag') {
      const e = this.layout[carry.index] ?? null;
      const dst = world.inventory[index];
      if (e && (e.kind === 'gold' || e.kind === 'arrow')) lines.push('칸을 차지하지 않는다 — 가져오기와 같다');
      else if (!dst) lines.push(`빈 칸 — ${Math.min(stackMax, e?.count ?? 0)}개 들어간다`);
      else if (e && dst.kind === e.kind) {
        const n = Math.min(stackMax - dst.count, e.count);
        lines.push(n > 0 ? `같은 종류 — ${n}개 합친다` : '가득 — 들어갈 자리가 없다');
      } else lines.push('다른 종류 — 여기엔 안 들어간다');
    } else {
      lines.push(this.layout[index] ? '통째로 넣는다 (같은 종류면 합친다)' : '통째로 넣어 이 칸에 둔다');
    }
    return {
      title: '여기에 놓기',
      lines,
      actions: [
        { key: this.padMode ? 'A' : 'Enter', label: '놓기' },
        { key: this.padMode ? 'B' : 'Esc', label: '취소 — 원래 칸으로' },
        { key: this.padMode ? 'Y' : 'X', label: '바닥에 버리기' },
      ],
    };
  }

  /** 들고 있는 아이콘 — 커서 칸 위에 크게 떠 있다 */
  private carriedOverlay(): HTMLElement | null {
    const carry = this.carry;
    if (!carry) return null;
    const svg = this.carriedIconSvg(carry, ICON_PX);
    if (!svg) return null;
    const el = document.createElement('div');
    el.dataset['carried'] = '1';
    el.innerHTML = svg;
    el.style.cssText =
      `position:absolute;left:50%;top:50%;transform:translate(-50%,-58%) scale(${balance.loot.ui.padCarryScale});line-height:0;` +
      'pointer-events:none;z-index:4;filter:drop-shadow(0 6px 10px rgba(0,0,0,0.8)) brightness(1.2);';
    return el;
  }

  /** 컨테이너 격자 크기 — 가방과 같은 열 수, 줄 수는 가방과 같거나 내용이 넘치면 더 */
  private containerGrid(entries: number): { cols: number; rows: number } {
    const cols = balance.items.cols;
    // 최소 줄 수는 가방과 따로 — 가방이 5×4 로 커져도 서너 개 든 주머니는 두 줄이면 된다
    return { cols, rows: Math.max(balance.loot.ui.containerMinRows, Math.ceil(Math.max(entries, this.layout.length) / cols)) };
  }

  /** 커서 이동 — 두 격자를 ←→ 로 오간다: 컨테이너 오른쪽 끝에서 → 는 가방, 가방 왼쪽 끝에서 ← 는 컨테이너.
   *  위아래는 각 격자 안에서 감긴다 */
  private move(dx: number, dy: number): void {
    const c = Loot.container(this.world);
    const cols = balance.items.cols;
    if (this.pane === 'buttons') {
      // 버튼 줄 — ←→ 로 두 버튼, → 끝에서 가방으로. ↑↓ 로 컨테이너 격자(아래 끝/첫 줄)로
      const g = this.containerGrid(c?.entries.length ?? 0);
      if (dx > 0 && this.selBtn === 1) this.pane = 'bag';
      else if (dx !== 0) this.selBtn = this.selBtn === 0 ? 1 : 0;
      else if (dy < 0) { this.pane = 'container'; this.selC = Math.min(g.cols * g.rows - 1, (g.rows - 1) * cols + (this.selC % cols)); }
      else if (dy > 0) { this.pane = 'container'; this.selC = this.selC % cols; }
    } else if (this.pane === 'container') {
      const g = this.containerGrid(c?.entries.length ?? 0);
      const total = g.cols * g.rows;
      const row = Math.floor(this.selC / cols);
      if (dx > 0 && this.selC % cols === cols - 1) {
        this.pane = 'bag';
      } else if (dx !== 0) {
        const col = ((this.selC % cols) + dx + cols) % cols;
        this.selC = Math.min(total - 1, row * cols + col);
      } else if (dy !== 0 && !this.carry && ((dy > 0 && row === g.rows - 1) || (dy < 0 && row === 0))) {
        // 격자 아래(또는 위로 감아) 버튼 줄 — 들고 있는 동안은 격자 안에서만 돈다
        this.pane = 'buttons';
        this.selBtn = this.selC % cols < cols / 2 ? 0 : 1;
      } else if (dy !== 0) {
        const nrow = (row + dy + g.rows) % g.rows;
        this.selC = Math.min(total - 1, nrow * cols + (this.selC % cols));
      }
    } else {
      const slots = this.world.inventory.length;
      if (dx < 0 && this.selB % cols === 0) {
        this.pane = 'container';
      } else if (dx !== 0) {
        const row = Math.floor(this.selB / cols);
        const col = ((this.selB % cols) + dx + cols) % cols;
        this.selB = Math.min(slots - 1, row * cols + col);
      } else if (dy !== 0) {
        const rows = Math.max(1, Math.ceil(slots / cols));
        const row = (Math.floor(this.selB / cols) + dy + rows) % rows;
        this.selB = Math.min(slots - 1, row * cols + (this.selB % cols));
      }
    }
    this.rebuild();
  }

  private clampSel(): void {
    const c = Loot.container(this.world);
    const g = this.containerGrid(c?.entries.length ?? 0);
    if (this.selC >= g.cols * g.rows) this.selC = g.cols * g.rows - 1;
  }

  private rectOf(key: string): DOMRect {
    const el = this.root.querySelector<HTMLElement>(`[data-key="${key}"]`);
    return el?.getBoundingClientRect() ?? this.root.getBoundingClientRect();
  }

  /** Enter/A/좌클릭 — 컨테이너 줄이면 가져오기, 가방 칸이면 넣기 */
  private act(): void {
    const c = Loot.container(this.world);
    if (!c) { this.close(); return; }
    if (this.pane === 'buttons') {
      if (this.selBtn === 1) { this.close(); return; }
      if (c.entries.length > 0) this.takeAll();
      else this.rebuild();
      return;
    }
    if (this.pane === 'container') {
      const at = this.cursorEntry(c);
      if (!at) { this.shakeKey = `c${this.selC}`; this.rebuild(); return; }
      const e = at.entry;
      const from = this.rectOf(`c${this.selC}`);
      const svg = lootIconSvg(e, ROW_ICON_PX);
      const toKey = flyTargetOf(e);
      const r = Loot.takeOne(this.world, at.index);
      if (r === 'taken') {
        this.pendingFly = { svg, from, toKey };
        this.advanceContainerCursor(); // 칸이 비었으면 다음 든 칸으로 — A/Enter 를 연달아 눌러 담는다
      } else this.shakeKey = `c${this.selC}`;
    } else {
      const slot = this.world.inventory[this.selB];
      if (!slot) {
        this.shakeKey = `b${this.selB}`;
      } else {
        const from = this.rectOf(`b${this.selB}`);
        const svg = itemIconSvg(slot.kind, ROW_ICON_PX);
        if (Loot.stash(this.world, this.selB)) this.pendingFly = { svg, from, toKey: `k:${slot.kind}` };
      }
    }
    this.clampSel();
    this.rebuild();
  }

  /** 드래그로 놓았다 — 원본 칸(pane, index)을 대상 key(c#/b#) 칸에. 창 밖·빈 곳이면 취소 */
  private onDrop(from: Pane, fromIdx: number, key: string | null): void {
    const c = Loot.container(this.world);
    if (!c) { this.close(); return; }
    const to: Pane | null = key?.startsWith('c') ? 'container' : key?.startsWith('b') ? 'bag' : null;
    const toIdx = key ? Number.parseInt(key.slice(1), 10) : -1;
    if (!to || Number.isNaN(toIdx)) { this.rebuild(); return; }
    if (from === 'container' && to === 'container') {
      // 배치만 — 칸을 맞바꾼다(빈 칸이면 옮김). 데이터(entries)는 그대로다
      if (fromIdx !== toIdx) {
        const a = this.layout[fromIdx] ?? null;
        const b = this.layout[toIdx] ?? null;
        for (let k = 0; k <= Math.max(fromIdx, toIdx); k++) if (this.layout[k] === undefined) this.layout[k] = null;
        this.layout[fromIdx] = b;
        this.layout[toIdx] = a;
        this.world.events.emit('loot_moved', { where: 'container' });
      }
      this.pane = 'container';
      this.selC = toIdx;
    } else if (from === 'bag' && to === 'bag') {
      if (moveSlot(this.world, fromIdx, toIdx) !== 'none') this.world.events.emit('loot_moved', { where: 'bag' });
      this.pane = 'bag';
      this.selB = toIdx;
    } else if (from === 'container' && to === 'bag') {
      const e = this.layout[fromIdx] ?? null;
      const index = e ? c.entries.indexOf(e) : -1;
      if (index >= 0 && Loot.takeStackTo(this.world, index, toIdx) <= 0) this.shakeKey = `b${toIdx}`;
      this.pane = 'bag';
      this.selB = toIdx;
    } else if (from === 'bag' && to === 'container') {
      const entry = Loot.stashStackTo(this.world, fromIdx);
      if (entry && !this.layout.includes(entry)) {
        for (let k = 0; k <= toIdx; k++) if (this.layout[k] === undefined) this.layout[k] = null;
        if (!this.layout[toIdx]) this.layout[toIdx] = entry; // 놓은 칸에 — 차 있으면 syncLayout 이 첫 빈 칸에
      }
      this.pane = 'container';
      this.selC = toIdx;
    }
    this.clampSel();
    this.rebuild();
  }

  /** 가져간 칸이 비었으면 커서를 다음 든 칸(앞으로, 끝에서 감김)으로 옮긴다 — 패드로 연달아 담을 수 있게 (2026-09-04 사용자).
   *  부분 가져오기(화살 상한 등)로 아직 남았으면 그대로. 남은 칸이 없으면 제자리 */
  private advanceContainerCursor(): void {
    const c = Loot.container(this.world);
    if (!c) return;
    this.syncLayout(c); // 가져간 항목이 배치에서 지워지게
    if (this.layout[this.selC]) return;
    const n = this.layout.length;
    for (let k = 1; k <= n; k++) {
      const i = (this.selC + k) % n;
      if (this.layout[i]) { this.selC = i; return; }
    }
  }

  private takeAll(): void {
    const c = Loot.container(this.world);
    if (!c) { this.close(); return; }
    const res = Loot.takeAll(this.world);
    if (res.denied && c.entries.length > 0) this.shakeKey = `c${Math.min(this.selC, c.entries.length - 1)}`;
    this.clampSel();
    this.rebuild();
  }

  private drop(): void {
    const c = Loot.container(this.world);
    if (!c) { this.close(); return; }
    if (this.pane === 'buttons') return;
    const at = this.pane === 'container' ? this.cursorEntry(c) : null;
    if (this.pane === 'container' && !at) { this.shakeKey = `c${this.selC}`; this.rebuild(); return; }
    const side: 'container' | 'bag' = this.pane === 'container' ? 'container' : 'bag';
    const ok = Loot.dropToFloor(this.world, side, side === 'container' ? at!.index : this.selB);
    if (!ok) this.shakeKey = this.pane === 'container' ? `c${this.selC}` : `b${this.selB}`;
    this.clampSel();
    this.rebuild();
  }

  private rebuild(): void {
    const world = this.world;
    const c = Loot.container(world);
    if (!c) { this.close(); return; } // 슬라임이 먹었다 등 — 컨테이너가 사라졌다
    this.syncLayout(c);
    if (this.carry && !this.carriedIconSvg(this.carry, ICON_PX)) this.carry = null; // 든 것이 사라졌다(뒤지기 갱신 등)
    // 두 패널 — 왼쪽 컨테이너(주머니·상자), 오른쪽 내 가방. 하나의 창으로 묶지 않는다 (2026-09-04 사용자).
    // 배경은 반투명 — 뒤의 던전이 비쳐 '잠깐 뒤지는 중'이 읽힌다. 하단 설명줄은 없다 (조작은 칸 옆 팝업이 말한다)
    const wrap = document.createElement('div');
    wrap.style.cssText = `display:flex;gap:${PANEL_GAP_PX}px;align-items:flex-start;`;

    const left = this.panel();
    const title = document.createElement('div');
    title.textContent = c.title;
    title.dataset['fly'] = 'title';
    title.style.cssText = `color:${c.tier === 'boss' ? '#ffd75e' : '#e8c76a'};margin-bottom:2px;font-size:15px;`;
    left.appendChild(title);
    // 실시간 — 뒤지는 동안 게임은 멈추지 않는다. 한 줄로 못박아 둔다 (맞으면 끊긴다)
    const live = document.createElement('div');
    live.textContent = `게임은 멈추지 않는다 — 공격받으면 끊긴다 · ${this.padMode ? 'RT/LT' : 'Shift/Space'} 로 바로 대응`;
    live.style.cssText = 'color:#8a8f9a;font-size:11px;margin-bottom:10px;';
    left.appendChild(live);
    left.appendChild(this.buildContainer(c));
    // 버튼 줄 — 커서(패드·키보드)로도 고른다: 격자 아래로 내려오면 여기, ←→ 로 둘 사이, A/Enter 로 실행
    const buttons = document.createElement('div');
    buttons.style.cssText = 'display:flex;gap:10px;margin-top:2px;';
    const labels = [`모두 가져오기 (${this.padMode ? 'X' : 'T'})`, `닫기 (${this.padMode ? 'B' : 'E'})`];
    const runs = [() => this.takeAll(), () => this.close()];
    const enabled = [c.entries.length > 0, true];
    labels.forEach((label, i) => {
      const focused = this.pane === 'buttons' && this.selBtn === i;
      const b = this.button(label, runs[i]!, enabled[i]!, focused);
      b.dataset['key'] = `t${i}`;
      b.onmousemove = (ev) => {
        if (!this.hoverAllowed(ev)) return;
        if (this.pane === 'buttons' && this.selBtn === i) return;
        this.pane = 'buttons';
        this.selBtn = i;
        this.rebuild();
      };
      buttons.appendChild(b);
    });
    left.appendChild(buttons);

    if (this.notice) {
      const n = document.createElement('div');
      n.textContent = this.notice;
      n.style.cssText =
        'margin-top:12px;padding:8px 10px;border:1px solid #6b4a2f;background:rgba(107,74,47,0.18);color:#e8c76a;font-size:12px;line-height:1.5;white-space:normal;';
      left.appendChild(n);
    }

    const right = this.panel();
    const bagTitle = document.createElement('div');
    bagTitle.textContent = '내 가방';
    bagTitle.style.cssText = 'color:#e8c76a;margin-bottom:10px;font-size:15px;';
    right.appendChild(bagTitle);
    right.appendChild(this.buildBag());

    wrap.appendChild(left);
    wrap.appendChild(right);
    this.root.replaceChildren(wrap);
    if (this.split) {
      this.root.appendChild(
        renderSplitDialog(this.split, {
          padMode: this.padMode,
          onAdjust: (d) => this.adjustSplit(d),
          onConfirm: () => this.confirmSplit(),
          onCancel: () => this.cancelSplit(),
        }),
      );
    }
    this.playFx();
    if (this.open && this.layout.some((e) => e !== null && !e.searched)) this.startSearch();
  }

  /** 패널 하나 — 격자 폭에 맞춘 고정 폭, 반투명 배경(뒤가 비친다) */
  private panel(): HTMLDivElement {
    const cols = balance.items.cols;
    const width = cols * CELL_PX + (cols - 1) * GRID_GAP_PX + PANEL_PAD_X * 2;
    const p = document.createElement('div');
    p.style.cssText =
      `width:${width}px;box-sizing:border-box;padding:18px ${PANEL_PAD_X}px 20px;` +
      'background:rgba(21,21,27,0.78);border:1px solid rgba(70,70,84,0.9);border-radius:4px;' +
      'backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);';
    return p;
  }

  private button(label: string, onClick: () => void, enabled: boolean, focused = false): HTMLButtonElement {
    const b = document.createElement('button');
    b.textContent = label;
    b.disabled = !enabled;
    // 커서가 얹힌 버튼은 컨테이너 커서 칸과 같은 푸른 테두리·바탕
    b.style.cssText =
      `padding:6px 14px;border:1px solid ${focused ? '#7fbfff' : '#3a3a44'};background:${focused ? 'rgba(127,191,255,0.14)' : '#1b1b22'};` +
      `color:${focused ? '#e8ecf2' : '#cfd2da'};cursor:pointer;font:inherit;` +
      (enabled ? '' : 'opacity:0.45;cursor:default;');
    b.onclick = onClick;
    return b;
  }

  /** 컨테이너 — 가방과 같은 사각 칸 격자. 한 칸 = 한 종류(×개수). 빈 칸은 어둡게 */
  private buildContainer(c: Loot.Container): HTMLDivElement {
    const col = document.createElement('div');
    const g = this.containerGrid(c.entries.length);
    const head = document.createElement('div');
    const known = c.entries.filter((e) => e.searched).length;
    const label = c.ref.kind === 'chest' ? '상자 안' : '주머니 안';
    head.textContent = known < c.entries.length ? `${label} (${known}/${c.entries.length}종 확인 — 뒤지는 중…)` : `${label} (${c.entries.length}종)`;
    head.style.cssText = `color:${this.pane === 'container' ? '#e8c76a' : '#8a8f9a'};margin-bottom:6px;`;
    col.appendChild(head);
    const grid = document.createElement('div');
    grid.style.cssText = `display:grid;grid-template-columns:repeat(${g.cols}, ${CELL_PX}px);gap:8px;margin-bottom:26px;`;
    const flyMarked = new Set<string>();
    for (let i = 0; i < g.cols * g.rows; i++) {
      const e = this.layout[i] ?? null; // 칸 배치 — 가져가도 나머지가 당겨지지 않는다
      const here = this.pane === 'container' && i === this.selC;
      const cell = document.createElement('div');
      cell.dataset['key'] = `c${i}`;
      cell.style.cssText =
        `width:${CELL_PX}px;height:${CELL_PX}px;box-sizing:border-box;position:relative;border-radius:4px;cursor:pointer;` +
        'display:flex;align-items:center;justify-content:center;' +
        `border:1px solid ${here ? '#7fbfff' : '#3a3a44'};background:${here ? 'rgba(127,191,255,0.12)' : '#1b1b22'};`;
      // mousemove 로 커서가 따라온다 (mouseenter 는 rebuild 마다 다시 떠서 키보드 선택을 덮는다 — ShopUI 규약)
      cell.onmousemove = (ev) => {
        if (!this.hoverAllowed(ev)) return;
        if (this.pane === 'container' && this.selC === i) return;
        this.pane = 'container';
        this.selC = i;
        this.rebuild();
      };
      cell.onclick = () => { this.pane = 'container'; this.selC = i; this.act(); };
      cell.oncontextmenu = (ev) => { ev.preventDefault(); this.pane = 'container'; this.selC = i; this.drop(); };
      // 드래그 — 밝혀진 칸만 집을 수 있다. 놓는 곳에 따라 배치 바꿈 / 가방 칸에 통째로
      if (e && e.searched) cell.onpointerdown = (ev) => beginDrag(ev, lootIconSvg(e, ICON_PX), (key) => this.onDrop('container', i, key));
      // 들고 있는 동안: 원본 칸은 흐리게, 커서 칸엔 든 아이콘과 "여기에 놓기" 팝업
      if (this.carry && this.carry.pane === 'container' && this.carry.index === i) cell.style.opacity = '0.35';
      if (here && this.carry) {
        const overlay = this.carriedOverlay();
        if (overlay) cell.appendChild(overlay);
        attachPopup(cell, this.carryPopup('container', i), 'right', this.padMode);
      } else if (here && e) {
        const content = lootEntryPopup(this.world, e);
        if (e.searched) {
          content.actions = [
            { key: this.padMode ? 'A' : 'Enter', label: '가져오기' },
            { key: this.padMode ? 'Y' : 'X', label: '바닥에 버리기' },
          ];
        }
        attachPopup(cell, content, 'right', this.padMode);
      }
      if (e && !e.searched) {
        // 아직 모르는 칸 — ? 로 가려 있다. 뒤지는 중이면 쿨다운처럼 한 바퀴 도는 덮개가 얹힌다
        const mark = document.createElement('span');
        mark.textContent = '?';
        mark.style.cssText = 'font-size:22px;color:#555c66;';
        cell.appendChild(mark);
        if (this.searching && this.searching.entry === e) {
          const sweep = document.createElement('div');
          sweep.dataset['sweep'] = '1';
          sweep.style.cssText = 'position:absolute;inset:0;border-radius:4px;pointer-events:none;';
          cell.appendChild(sweep);
          cell.style.borderColor = '#7fbfff';
        }
      } else if (e) {
        const flyKey = `k:${e.kind}`;
        if (!flyMarked.has(flyKey)) { cell.dataset['fly'] = flyKey; flyMarked.add(flyKey); }
        const icon = document.createElement('span');
        icon.style.cssText = 'display:block;line-height:0;';
        icon.innerHTML = lootIconSvg(e, ICON_PX);
        cell.appendChild(icon);
        const count = document.createElement('span');
        count.textContent = `×${e.count}`;
        count.style.cssText = 'position:absolute;right:4px;bottom:1px;font-size:11px;color:#e8c76a;';
        cell.appendChild(count);
      }
      grid.appendChild(cell);
    }
    col.appendChild(grid); // 빈 주머니는 빈 격자 그대로 — '비었다' 글자는 두지 않는다 (2026-09-04 사용자)
    return col;
  }

  private buildBag(): HTMLDivElement {
    const world = this.world;
    const cfg = balance.items;
    const col = document.createElement('div');
    const used = world.inventory.filter((s) => s !== null).length;
    const head = document.createElement('div');
    head.textContent = `가방 ${used}/${world.inventory.length}칸${used >= world.inventory.length ? '  — 가득' : ''}`;
    head.style.cssText = `color:${this.pane === 'bag' ? '#e8c76a' : '#8a8f9a'};margin-bottom:6px;`;
    col.appendChild(head);
    const grid = document.createElement('div');
    grid.style.cssText = `display:grid;grid-template-columns:repeat(${cfg.cols}, ${CELL_PX}px);gap:8px;margin-bottom:26px;`;
    const flyMarked = new Set<string>();
    world.inventory.forEach((slot, i) => {
      const here = this.pane === 'bag' && i === this.selB;
      const cell = document.createElement('div');
      cell.dataset['key'] = `b${i}`;
      cell.style.cssText =
        `width:${CELL_PX}px;height:${CELL_PX}px;box-sizing:border-box;position:relative;border-radius:4px;cursor:pointer;` +
        'display:flex;align-items:center;justify-content:center;' +
        `border:1px solid ${here ? '#e8c76a' : '#3a3a44'};background:${here ? 'rgba(232,199,106,0.12)' : '#1b1b22'};`;
      cell.onmousemove = (ev) => {
        if (!this.hoverAllowed(ev)) return;
        if (this.pane === 'bag' && this.selB === i) return;
        this.pane = 'bag';
        this.selB = i;
        this.rebuild();
      };
      cell.onclick = (ev) => {
        this.pane = 'bag';
        this.selB = i;
        if (ev.shiftKey) this.openSplit(); // Shift+클릭 = 수량 나누기
        else this.act();
      };
      cell.oncontextmenu = (ev) => { ev.preventDefault(); this.pane = 'bag'; this.selB = i; this.drop(); };
      if (slot) cell.onpointerdown = (ev) => { if (!ev.shiftKey) beginDrag(ev, itemIconSvg(slot.kind, ICON_PX), (key) => this.onDrop('bag', i, key)); };
      if (this.carry && this.carry.pane === 'bag' && this.carry.index === i) cell.style.opacity = '0.35';
      if (here && this.carry) {
        const overlay = this.carriedOverlay();
        if (overlay) cell.appendChild(overlay);
        attachPopup(cell, this.carryPopup('bag', i), 'left', this.padMode);
      }
      if (slot) {
        // 같은 종류의 첫 칸이 날아온 아이콘의 목적지 — 실제로 addItem 이 쌓는 자리와 같다
        if (!flyMarked.has(slot.kind)) { cell.dataset['fly'] = `b:${slot.kind}`; flyMarked.add(slot.kind); }
        const icon = document.createElement('span');
        icon.style.cssText = 'display:block;line-height:0;';
        icon.innerHTML = itemIconSvg(slot.kind, ICON_PX);
        cell.appendChild(icon);
        const count = document.createElement('span');
        count.textContent = `×${slot.count}`;
        count.style.cssText = 'position:absolute;right:4px;bottom:1px;font-size:11px;color:#e8c76a;';
        cell.appendChild(count);
        const q = world.quickslots.indexOf(slot.kind);
        if (q >= 0) {
          const tag = document.createElement('span');
          tag.textContent = `${q + 1}`;
          tag.style.cssText = 'position:absolute;left:4px;top:1px;font-size:10px;color:#8a8f9a;';
          cell.appendChild(tag);
        }
        if (here && !this.carry) {
          // 가방은 창의 오른쪽이라 칸 왼쪽에 띄운다. 조작 안내(넣기 → 그 아래 버리기)는 팝업 안에
          const content = consumablePopup(world, slot.kind, slot.count, ' (내 가방)');
          content.actions = [
            { key: this.padMode ? 'A' : 'Enter', label: '컨테이너에 넣기' },
            { key: this.padMode ? 'Y' : 'X', label: '바닥에 버리기' },
          ];
          if (slot.count >= 2) content.actions.push({ key: this.padMode ? 'X 길게' : 'Shift+Enter', label: '수량 나누기' });
          attachPopup(cell, content, 'left', this.padMode);
        }
      }
      grid.appendChild(cell);
    });
    col.appendChild(grid);
    // 빈 종류의 목적지 — 첫 빈 칸이 받는다 (addItem 이 새 칸을 잡는 자리)
    const firstEmpty = world.inventory.indexOf(null);
    if (firstEmpty >= 0) {
      const cell = grid.children[firstEmpty] as HTMLElement | undefined;
      if (cell) cell.dataset['flyEmpty'] = '1';
    }
    const counters = document.createElement('div');
    counters.style.cssText = 'margin-top:8px;color:#cfd2da;display:flex;gap:18px;';
    const gold = document.createElement('span');
    gold.dataset['fly'] = 'gold';
    gold.textContent = `◆ ${world.gold}`;
    gold.style.color = '#e8c76a';
    const arrows = document.createElement('span');
    arrows.dataset['fly'] = 'arrow';
    arrows.textContent = `화살 ${world.weapon.arrows ?? 0}/${balance.weapons.bow.ammoMax}`;
    counters.appendChild(gold);
    counters.appendChild(arrows);
    col.appendChild(counters);
    return col;
  }

  /** rebuild 뒤 연출 — 날아가는 아이콘(Web Animations, 스타일시트 없이) / 거부된 줄 흔들림 */
  private playFx(): void {
    const ui = balance.loot.ui;
    if (this.shakeKey) {
      const el = this.root.querySelector<HTMLElement>(`[data-key="${this.shakeKey}"]`);
      el?.animate(
        [{ transform: 'translateX(0)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }, { transform: 'translateX(0)' }],
        { duration: ui.shakeMs },
      );
      this.shakeKey = null;
    }
    const fly = this.pendingFly;
    this.pendingFly = null;
    if (!fly) return;
    let target = fly.toKey.startsWith('cell:')
      ? this.root.querySelector<HTMLElement>(`[data-key="${fly.toKey.slice(5)}"]`) // 취소 — 원래 칸으로
      : this.root.querySelector<HTMLElement>(`[data-fly="${fly.toKey}"]`);
    if (!target && fly.toKey.startsWith('b:')) target = this.root.querySelector<HTMLElement>('[data-fly-empty="1"]');
    if (!target) return;
    const to = target.getBoundingClientRect();
    const span = document.createElement('span');
    span.innerHTML = fly.svg;
    span.style.cssText =
      `position:fixed;left:${fly.from.left + fly.from.width / 2 - ROW_ICON_PX / 2}px;top:${fly.from.top + fly.from.height / 2 - ROW_ICON_PX / 2}px;` +
      'pointer-events:none;z-index:11;line-height:0;';
    document.body.appendChild(span);
    const anim = span.animate(
      [
        { transform: 'translate(0,0) scale(1)' },
        { transform: `translate(${to.left + to.width / 2 - (fly.from.left + fly.from.width / 2)}px, ${to.top + to.height / 2 - (fly.from.top + fly.from.height / 2)}px) scale(0.85)` },
      ],
      { duration: ui.flyMs, easing: 'ease-out' },
    );
    anim.onfinish = () => {
      span.remove();
      target?.animate([{ filter: 'brightness(1)' }, { filter: 'brightness(2.2)' }, { filter: 'brightness(1)' }], { duration: ui.shakeMs });
    };
  }
}
