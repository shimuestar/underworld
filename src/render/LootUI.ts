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
import { countOf, isUseful, itemDef } from '../core/Inventory';
import { sigilDef } from '../core/SigilData';
import type { ItemKind, LootEntry, World } from '../core/World';
import * as Loot from '../systems/Loot';
import { itemIconSvg, lootIconSvg } from './ItemIcons';

const UP_KEYS = new Set(['KeyW', 'ArrowUp']);
const DOWN_KEYS = new Set(['KeyS', 'ArrowDown']);
const LEFT_KEYS = new Set(['KeyA', 'ArrowLeft']);
const RIGHT_KEYS = new Set(['KeyD', 'ArrowRight']);
const CELL_PX = 64;
const ICON_PX = 28;
const ROW_ICON_PX = 22;

type Pane = 'container' | 'bag';

/** 가져온 것이 어디로 갔는지 — 날아가는 아이콘의 목적지 표식 (data-fly) */
function flyTargetOf(e: LootEntry): string {
  if (e.kind === 'gold') return 'gold';
  if (e.kind === 'arrow') return 'arrow';
  if (e.kind === 'sigil') return 'title';
  return `b:${e.kind}`;
}

export class LootUI {
  private readonly root: HTMLDivElement;
  open = false;
  pane: Pane = 'container';
  private selC = 0;
  private selB = 0;
  /** 닫힐 때 main 이 Loot.closeLoot 와 uiOpen 을 되돌린다 */
  onClose: (() => void) | null = null;
  /** 패드로 조작 중 — 버튼·힌트를 패드 표기로 (main 이 틱마다 갱신) */
  padMode = false;
  /** 직전 동작의 연출 — rebuild 뒤 목적지를 찾아 아이콘을 날린다 / 거부된 줄을 흔든다 */
  private pendingFly: { svg: string; from: DOMRect; toKey: string } | null = null;
  private shakeKey: string | null = null;
  /** 컨테이너 칸 배치 — 줄(entries)은 가져가면 당겨지지만 칸은 제자리를 지킨다(빈 칸으로 남는다).
   *  같은 항목 객체가 살아 있는 동안 같은 칸, 새 항목은 첫 빈 칸. 창을 열 때 다시 짠다 */
  private layout: (LootEntry | null)[] = [];
  private layoutKey: string | null = null;

  constructor(private readonly world: World) {
    this.root = document.createElement('div');
    this.root.id = 'lootui';
    this.root.style.cssText =
      'position:fixed;inset:0;display:none;align-items:center;justify-content:center;' +
      'background:rgba(0,0,0,0.72);color:#cfd2da;font:13px/1.6 monospace;user-select:none;z-index:10;';
    document.body.appendChild(this.root);

    window.addEventListener('keydown', (e) => {
      if (!this.open) return;
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
    this.pendingFly = null;
    this.shakeKey = null;
    this.layout = [];
    this.layoutKey = null;
    this.root.style.display = 'flex';
    this.rebuild();
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
  }

  private close(): void {
    if (!this.open) return;
    this.hide();
    this.onClose?.();
  }

  // ---- 패드 — 일시정지 메뉴·상점과 같은 고정 버튼 규약 (main 이 raw 버튼으로 부른다) ----
  padMove(dx: number, dy: number): void { if (this.open) this.move(dx, dy); }
  padActivate(): void { if (this.open) this.act(); }
  padTakeAll(): void { if (this.open) this.takeAll(); }
  padDrop(): void { if (this.open) this.drop(); }
  padClose(): void { this.close(); }

  /** 컨테이너 격자 크기 — 가방과 같은 열 수, 줄 수는 가방과 같거나 내용이 넘치면 더 */
  private containerGrid(entries: number): { cols: number; rows: number } {
    const cols = balance.items.cols;
    return { cols, rows: Math.max(balance.items.rows, Math.ceil(Math.max(entries, this.layout.length) / cols)) };
  }

  /** 커서 이동 — 두 격자를 ←→ 로 오간다: 컨테이너 오른쪽 끝에서 → 는 가방, 가방 왼쪽 끝에서 ← 는 컨테이너.
   *  위아래는 각 격자 안에서 감긴다 */
  private move(dx: number, dy: number): void {
    const c = Loot.container(this.world);
    const cols = balance.items.cols;
    if (this.pane === 'container') {
      const g = this.containerGrid(c?.entries.length ?? 0);
      const total = g.cols * g.rows;
      if (dx > 0 && this.selC % cols === cols - 1) {
        this.pane = 'bag';
      } else if (dx !== 0) {
        const row = Math.floor(this.selC / cols);
        const col = ((this.selC % cols) + dx + cols) % cols;
        this.selC = Math.min(total - 1, row * cols + col);
      } else if (dy !== 0) {
        const row = (Math.floor(this.selC / cols) + dy + g.rows) % g.rows;
        this.selC = Math.min(total - 1, row * cols + (this.selC % cols));
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
    if (this.pane === 'container') {
      const at = this.cursorEntry(c);
      if (!at) { this.shakeKey = `c${this.selC}`; this.rebuild(); return; }
      const e = at.entry;
      const from = this.rectOf(`c${this.selC}`);
      const svg = lootIconSvg(e, ROW_ICON_PX);
      const toKey = flyTargetOf(e);
      const r = Loot.takeOne(this.world, at.index);
      if (r === 'taken') this.pendingFly = { svg, from, toKey };
      else this.shakeKey = `c${this.selC}`;
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
    const at = this.pane === 'container' ? this.cursorEntry(c) : null;
    if (this.pane === 'container' && !at) { this.shakeKey = `c${this.selC}`; this.rebuild(); return; }
    const ok = Loot.dropToFloor(this.world, this.pane, this.pane === 'container' ? at!.index : this.selB);
    if (!ok) this.shakeKey = this.pane === 'container' ? `c${this.selC}` : `b${this.selB}`;
    this.clampSel();
    this.rebuild();
  }

  private rebuild(): void {
    const world = this.world;
    const c = Loot.container(world);
    if (!c) { this.close(); return; } // 슬라임이 먹었다 등 — 컨테이너가 사라졌다
    this.syncLayout(c);
    const panel = document.createElement('div');
    // 폭은 고정 — 툴팁 길이에 따라 창이 늘고 줄면 눈이 어지럽다. 긴 문장은 접어 내린다
    panel.style.cssText = 'background:#15151b;border:1px solid #3a3a44;padding:20px 26px;width:860px;box-sizing:border-box;';

    const title = document.createElement('div');
    title.textContent = `${c.title}   ◆ ${world.gold}`;
    title.dataset['fly'] = 'title';
    title.style.cssText = `color:${c.tier === 'boss' ? '#ffd75e' : '#e8c76a'};margin-bottom:12px;font-size:15px;`;
    panel.appendChild(title);

    const columns = document.createElement('div');
    columns.style.cssText = 'display:flex;gap:28px;align-items:flex-start;';
    columns.appendChild(this.buildContainer(c));
    columns.appendChild(this.buildBag());
    panel.appendChild(columns);

    // 툴팁 — 커서 아래 것이 무엇이고 지금 쓸 값어치가 있는지 한 줄로
    const tip = document.createElement('div');
    tip.textContent = this.describeCursor();
    tip.style.cssText = 'margin-top:12px;min-height:44px;color:#a9b0bc;border-top:1px solid #23232b;padding-top:8px;white-space:normal;overflow-wrap:anywhere;';
    panel.appendChild(tip);

    const buttons = document.createElement('div');
    buttons.style.cssText = 'display:flex;gap:10px;margin-top:16px;';
    const takeAllBtn = this.button(`모두 가져오기 (${this.padMode ? 'X' : 'T'})`, () => this.takeAll(), c.entries.length > 0);
    const closeBtn = this.button(`닫기 (${this.padMode ? 'B' : 'E'})`, () => this.close(), true);
    buttons.appendChild(takeAllBtn);
    buttons.appendChild(closeBtn);
    panel.appendChild(buttons);

    const hint = document.createElement('div');
    hint.textContent = this.padMode
      ? 'D-패드 이동 · ←→ 칸 전환   A 가져오기/넣기   X 모두 가져오기   Y 바닥에 버리기   B 닫기'
      : 'WASD·화살표 이동 · ←→ 칸 전환   Enter·좌클릭 가져오기/넣기   T 모두 가져오기   X·우클릭 바닥에 버리기   E / Esc 닫기';
    hint.style.cssText = 'margin-top:14px;color:#8a8f9a;border-top:1px solid #23232b;padding-top:10px;white-space:pre-line;';
    panel.appendChild(hint);

    this.root.replaceChildren(panel);
    this.playFx();
  }

  /** 커서 아래 아이템 설명 — 소모품은 효과·유용성·가방 수, 골드·화살은 어디에 쓰는지, 각인은 설명 */
  private describeCursor(): string {
    const world = this.world;
    const consumable = (kind: ItemKind, where: string): string => {
      const def = itemDef(kind);
      const parts: string[] = [];
      if (def.heal > 0) parts.push(`체력 +${def.heal}`);
      if (def.restore > 0) parts.push(`마나 +${def.restore}`);
      if (def.regen) {
        const total = Math.round(def.regen.healPerTick * def.regen.durationTicks);
        parts.push(`${Math.round(def.regen.durationTicks / 60)}초 지속 회복(총 +${total}) · 스태미너 회복 ×${def.regen.staminaRegenMul}`);
      }
      const useful = isUseful(world, kind) ? '지금 쓸 값어치 있음' : '지금은 가득 — 쓸 값어치 없음';
      return `▸ ${def.name}${where} — ${parts.join(', ')} · ${useful} · 가방에 ${countOf(world, kind)}개`;
    };
    if (this.pane === 'container') {
      const e = this.layout[this.selC] ?? null;
      if (!e) return '';
      if (e.kind === 'gold') return `▸ 골드 ×${e.count} — 제단 상점에서 체력·마나·탄약·수류탄·배터리를 산다 · 소지 ◆ ${world.gold}`;
      if (e.kind === 'arrow') {
        const have = world.weapon.arrows ?? 0;
        const max = balance.weapons.bow.ammoMax;
        return `▸ 화살 ×${e.count} — 활 탄약 · 화살통 ${have}/${max}${have >= max ? ' (가득 — 들어갈 자리가 없다)' : ''}`;
      }
      if (e.kind === 'sigil') {
        const def = e.sigilId ? sigilDef(e.sigilId) : null;
        return def ? `▸ ${def.name} (각인) — ${def.desc ?? ''} · 가져가면 곧바로 몸에 새겨진다` : '▸ 각인';
      }
      return consumable(e.kind, ` ×${e.count}`);
    }
    const slot = world.inventory[this.selB];
    if (!slot) return '▸ 빈 칸 — 컨테이너에서 가져온 것이 여기 들어온다';
    return consumable(slot.kind, ` ×${slot.count} (내 가방)`) + ' · Enter/A 로 컨테이너에 넣는다';
  }

  private button(label: string, onClick: () => void, enabled: boolean): HTMLButtonElement {
    const b = document.createElement('button');
    b.textContent = label;
    b.disabled = !enabled;
    b.style.cssText =
      'padding:6px 14px;border:1px solid #3a3a44;background:#1b1b22;color:#cfd2da;cursor:pointer;font:inherit;' +
      (enabled ? '' : 'opacity:0.45;cursor:default;');
    b.onclick = onClick;
    return b;
  }

  /** 컨테이너 — 가방과 같은 사각 칸 격자. 한 칸 = 한 종류(×개수). 빈 칸은 어둡게 */
  private buildContainer(c: Loot.Container): HTMLDivElement {
    const col = document.createElement('div');
    const g = this.containerGrid(c.entries.length);
    const head = document.createElement('div');
    head.textContent = c.ref.kind === 'chest' ? `상자 안 (${c.entries.length}종)` : `주머니 안 (${c.entries.length}종)`;
    head.style.cssText = `color:${this.pane === 'container' ? '#e8c76a' : '#8a8f9a'};margin-bottom:6px;`;
    col.appendChild(head);
    const grid = document.createElement('div');
    grid.style.cssText = `display:grid;grid-template-columns:repeat(${g.cols}, ${CELL_PX}px);gap:8px;`;
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
      cell.onmousemove = () => {
        if (this.pane === 'container' && this.selC === i) return;
        this.pane = 'container';
        this.selC = i;
        this.rebuild();
      };
      cell.onclick = () => { this.pane = 'container'; this.selC = i; this.act(); };
      cell.oncontextmenu = (ev) => { ev.preventDefault(); this.pane = 'container'; this.selC = i; this.drop(); };
      if (e) {
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
    col.appendChild(grid);
    if (c.entries.length === 0) {
      const empty = document.createElement('div');
      empty.textContent = '비었다';
      empty.style.cssText = 'color:#555c66;margin-top:8px;';
      col.appendChild(empty);
    }
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
    grid.style.cssText = `display:grid;grid-template-columns:repeat(${cfg.cols}, ${CELL_PX}px);gap:8px;`;
    const flyMarked = new Set<string>();
    world.inventory.forEach((slot, i) => {
      const here = this.pane === 'bag' && i === this.selB;
      const cell = document.createElement('div');
      cell.dataset['key'] = `b${i}`;
      cell.style.cssText =
        `width:${CELL_PX}px;height:${CELL_PX}px;box-sizing:border-box;position:relative;border-radius:4px;cursor:pointer;` +
        'display:flex;align-items:center;justify-content:center;' +
        `border:1px solid ${here ? '#e8c76a' : '#3a3a44'};background:${here ? 'rgba(232,199,106,0.12)' : '#1b1b22'};`;
      cell.onmousemove = () => {
        if (this.pane === 'bag' && this.selB === i) return;
        this.pane = 'bag';
        this.selB = i;
        this.rebuild();
      };
      cell.onclick = () => { this.pane = 'bag'; this.selB = i; this.act(); };
      cell.oncontextmenu = (ev) => { ev.preventDefault(); this.pane = 'bag'; this.selB = i; this.drop(); };
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
    let target = this.root.querySelector<HTMLElement>(`[data-fly="${fly.toKey}"]`);
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
