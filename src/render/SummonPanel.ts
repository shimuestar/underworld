// 몬스터 시험방 — 메뉴 창의 '소환' 탭 (시험방에서만 보인다, 2026-09-04 사용자 기획).
// 왼쪽: 구현된 몬스터 목록, 한 줄에 [1][3][6] 마리 소환 버튼과 '살아 n / 목표 m'.
// 오른콍: 모두 죽이기(자동 소환이 켜져 있으면 3초 뒤 되살아남) · 초기화(전부 없애고 옵션 OFF) · 자동 소환 ON/OFF.
// 조작: 마우스 클릭 · Enter(커서) · 패드 D-패드/A. 창이 떠 있는 동안 시간은 셸(MenuTabs)이 멈춘다.

import { balance } from '../core/Balance';
import { enemyDef, implementedEnemyTypes } from '../core/Entities';
import type { World } from '../core/World';
import * as Summon from '../systems/Summon';

const RIGHT = ['killAll', 'reset', 'auto'] as const;
type RightAction = (typeof RIGHT)[number];

export class SummonPanel {
  readonly root: HTMLDivElement;
  open = false;
  padMode = false;
  /** 커서 — col 0..counts-1 은 소환 버튼, col === counts 는 오른쪽 패널(row 가 버튼 번호) */
  private row = 0;
  private col = 0;
  private readonly types: string[];
  private readonly counts: number[];
  private readonly rowEls: HTMLDivElement[] = [];
  private readonly statusEls: HTMLSpanElement[] = [];
  private readonly countBtns: HTMLButtonElement[][] = [];
  private readonly rightBtns: HTMLButtonElement[] = [];
  private readonly queueEl: HTMLDivElement;
  private readonly footEl: HTMLDivElement;
  private lastKey = '';
  /** 격자 끝에서 한 번 더 밀었다 — 셸이 옆 탭으로 */
  onEdge?: (dir: number) => void;
  /** 안내 한 줄 — main 이 HUD 반응 줄에 띄운다 */
  onNotice?: (msg: string) => void;
  /** 버튼이 실행됐다 — 소리·진동 */
  onAction?: () => void;

  constructor(private readonly world: World, parent: HTMLElement) {
    // 일반 몬스터 먼저, 보스는 맨 아래 구분선 밑에 — entities.json 순서는 보스가 사이에 섞여 있다
    const impl = implementedEnemyTypes();
    this.types = [...impl.filter((t) => !enemyDef(t).boss), ...impl.filter((t) => enemyDef(t).boss)];
    this.counts = balance.monsterRoom.summon.counts;
    this.root = document.createElement('div');
    this.root.id = 'summonui';
    this.root.style.cssText = 'display:none;gap:18px;align-items:flex-start;font:13px/1.6 monospace;color:#cfd2da;';
    parent.appendChild(this.root);

    // 왼쪽 — 몬스터 목록
    const list = document.createElement('div');
    list.style.cssText = 'background:rgba(21,21,27,0.92);border:1px solid #3a3a44;padding:14px 18px;min-width:520px;';
    this.root.appendChild(list);
    const title = document.createElement('div');
    title.textContent = '소환 — 시선 앞 2~10m 에 놓인다';
    title.style.cssText = 'color:#d8e0ea;font-size:15px;letter-spacing:2px;margin-bottom:10px;';
    list.appendChild(title);
    let bossDivider = false;
    this.types.forEach((type, r) => {
      const def = enemyDef(type);
      if (def.boss && !bossDivider) {
        bossDivider = true;
        const d = document.createElement('div');
        d.textContent = '보스';
        d.style.cssText = 'color:#e8c76a;font-size:11px;letter-spacing:3px;margin-top:10px;border-top:1px solid #3a3a44;padding-top:6px;';
        list.appendChild(d);
      }
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:5px 8px;border-top:1px solid #23232b;';
      const name = document.createElement('span');
      name.textContent = def.name ?? type;
      name.style.cssText = `min-width:130px;font-size:14px;${def.boss ? 'color:#e8c76a;' : ''}`;
      const status = document.createElement('span');
      status.style.cssText = 'min-width:130px;color:#6c7280;font-size:12px;';
      row.appendChild(name);
      row.appendChild(status);
      const btns: HTMLButtonElement[] = [];
      this.counts.forEach((n, c) => {
        const b = this.button(`${n}마리`);
        b.addEventListener('mouseenter', () => this.hover(r, c));
        b.addEventListener('click', () => { this.row = r; this.col = c; this.act(); });
        row.appendChild(b);
        btns.push(b);
      });
      list.appendChild(row);
      this.rowEls.push(row);
      this.statusEls.push(status);
      this.countBtns.push(btns);
    });
    this.footEl = document.createElement('div');
    this.footEl.style.cssText = 'color:#6c7280;font-size:11px;margin-top:12px;';
    list.appendChild(this.footEl);

    // 오른쪽 — 전체 조작
    const side = document.createElement('div');
    side.style.cssText = 'background:rgba(21,21,27,0.92);border:1px solid #3a3a44;padding:14px 18px;min-width:230px;';
    this.root.appendChild(side);
    const stitle = document.createElement('div');
    stitle.textContent = '전체';
    stitle.style.cssText = 'color:#d8e0ea;font-size:15px;letter-spacing:2px;margin-bottom:10px;';
    side.appendChild(stitle);
    const labels: Record<RightAction, string> = { killAll: '모두 죽이기', reset: '초기화', auto: '자동 소환' };
    RIGHT.forEach((a, i) => {
      const b = this.button(labels[a]);
      b.style.cssText += 'display:block;width:100%;margin:0 0 8px;text-align:left;';
      b.addEventListener('mouseenter', () => this.hover(i, this.counts.length));
      b.addEventListener('click', () => { this.row = i; this.col = this.counts.length; this.act(); });
      side.appendChild(b);
      this.rightBtns.push(b);
    });
    const hint = document.createElement('div');
    hint.style.cssText = 'color:#6c7280;font-size:11px;margin-top:6px;line-height:1.5;';
    hint.textContent = '모두 죽이기 — 자동 소환이 켜져 있으면 3초 뒤 되살아난다. 초기화 — 전부 없애고 목표·자동 소환을 끈다.';
    side.appendChild(hint);
    this.queueEl = document.createElement('div');
    this.queueEl.style.cssText = 'color:#8fa3b8;font-size:12px;margin-top:10px;';
    side.appendChild(this.queueEl);

    window.addEventListener('keydown', (e) => {
      if (!this.open) return;
      if (e.code === 'Enter' || e.code === 'NumpadEnter') {
        e.preventDefault();
        this.act();
      }
    });
  }

  private button(text: string): HTMLButtonElement {
    const b = document.createElement('button');
    b.textContent = text;
    b.style.cssText =
      'font:13px monospace;padding:4px 12px;border:1px solid #3a3a44;background:#1c1c24;color:#cfd2da;cursor:pointer;';
    return b;
  }

  show(): void {
    this.open = true;
    this.root.style.display = 'flex';
    this.lastKey = '';
    this.refresh();
  }

  hide(): void {
    this.open = false;
    this.root.style.display = 'none';
  }

  /** 매 프레임 — 살아 있는 수·목표·대기열·커서 */
  update(): void {
    if (this.open) this.refresh();
  }

  private hover(row: number, col: number): void {
    if (this.padMode) return; // 패드 중엔 마우스가 커서를 빼앗지 않는다
    this.row = row;
    this.col = col;
    this.refresh();
  }

  /** 패드 D-패드 — 소환 격자 안에서 움직이고, 오른쪽 끝에서 한 번 더 밀면 전체 패널로, 그 밖은 옆 탭 */
  padMove(dx: number, dy: number): void {
    if (!this.open) return;
    const rightCol = this.counts.length;
    if (this.col === rightCol) {
      if (dy !== 0) this.row = (this.row + dy + RIGHT.length) % RIGHT.length;
      else if (dx < 0) { this.col = rightCol - 1; this.row = Math.min(this.row, this.types.length - 1); }
      else if (dx > 0) this.onEdge?.(1);
    } else {
      if (dy !== 0) this.row = (this.row + dy + this.types.length) % this.types.length;
      else if (dx > 0) {
        if (this.col + 1 < rightCol) this.col++;
        else { this.col = rightCol; this.row = Math.min(this.row, RIGHT.length - 1); }
      } else if (dx < 0) {
        if (this.col > 0) this.col--;
        else this.onEdge?.(-1);
      }
    }
    this.refresh();
  }

  /** 패드 A — 커서의 버튼 */
  padA(): void {
    if (this.open) this.act();
  }

  private act(): void {
    const w = this.world;
    if (this.col === this.counts.length) {
      const a = RIGHT[this.row]!;
      if (a === 'killAll') {
        const n = Summon.killAll(w);
        this.onNotice?.(n > 0 ? `몬스터 ${n}마리를 죽였다${w.summonAuto ? ' — 3초 뒤 되살아난다' : ''}` : '살아 있는 몬스터가 없다');
      } else if (a === 'reset') {
        Summon.reset(w);
        this.onNotice?.('초기화 — 전부 없애고 목표·자동 소환을 껐다');
      } else {
        w.summonAuto = !w.summonAuto;
        if (!w.summonAuto) w.summonQueue = [];
        this.onNotice?.(w.summonAuto ? '자동 소환 ON — 죽은 마리당 3초 뒤 같은 종족 1마리' : '자동 소환 OFF');
      }
    } else {
      const type = this.types[this.row]!;
      const n = this.counts[this.col]!;
      const placed = Summon.summon(w, type, n);
      const name = enemyDef(type).name ?? type;
      this.onNotice?.(placed === n ? `${name} ${n}마리 소환` : placed > 0 ? `${name} — 자리가 모자라 ${placed}마리만 놓였다` : `${name} — 앞에 놓을 자리가 없다`);
    }
    this.onAction?.();
    this.lastKey = '';
    this.refresh();
  }

  private refresh(): void {
    const w = this.world;
    const alive: Record<string, number> = {};
    for (const e of w.enemies) if (e.alive) alive[e.type] = (alive[e.type] ?? 0) + 1;
    const key = `${this.padMode ? 'p' : 'k'}|${this.row},${this.col}|${w.summonAuto ? 1 : 0}|${w.summonQueue.length}|${this.types.map((t) => `${alive[t] ?? 0}/${w.summonTargets[t] ?? 0}`).join(',')}`;
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.types.forEach((t, r) => {
      this.statusEls[r]!.textContent = `살아 ${alive[t] ?? 0} / 목표 ${w.summonTargets[t] ?? 0}`;
      this.rowEls[r]!.style.background = this.col !== this.counts.length && r === this.row ? 'rgba(232,199,106,0.06)' : 'transparent';
      this.countBtns[r]!.forEach((b, c) => this.paint(b, this.col === c && r === this.row));
    });
    this.rightBtns.forEach((b, i) => {
      if (RIGHT[i] === 'auto') b.textContent = `자동 소환: ${w.summonAuto ? 'ON' : 'OFF'}`;
      this.paint(b, this.col === this.counts.length && i === this.row);
      if (RIGHT[i] === 'auto' && w.summonAuto) b.style.borderColor = '#6fbf73';
    });
    this.queueEl.textContent = w.summonQueue.length > 0 ? `재소환 대기 ${w.summonQueue.length}` : '';
    this.footEl.textContent = this.padMode ? 'D-패드 이동 · A 실행 · LB/RB 탭 · B 닫기' : '마우스 클릭 · Enter 커서 실행 · ←→ 탭 · Esc 닫기';
  }

  private paint(b: HTMLButtonElement, here: boolean): void {
    b.style.borderColor = here ? '#e8c76a' : '#3a3a44';
    b.style.color = here ? '#e8c76a' : '#cfd2da';
    b.style.background = here ? 'rgba(232,199,106,0.12)' : '#1c1c24';
  }
}
