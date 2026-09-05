// 수량 나누기 대화상자 — 가방의 스택 하나를 둘로 가른다. 상태(SplitState)는 창(LootUI·InventoryUI)이 갖고
// 여기는 DOM 만 그린다. 조작: ←→ ±1, ↑↓ ±splitBigStep, Enter/A 확인, Esc/B 취소, 마우스는 −/+ 와 버튼 (2026-09-04).

import { balance } from '../core/Balance';
import { itemDef } from '../core/Inventory';
import type { ItemKind } from '../core/World';
import { itemIconSvg } from './ItemIcons';
import { keycap } from './ItemPopup';

export interface SplitState {
  /** 나누는 가방 칸 */
  index: number;
  kind: ItemKind;
  total: number;
  /** 새 칸으로 떼어 낼 개수 (1 ~ total-1) */
  amount: number;
}

/** 기본값 — 절반 (홀수면 원래 칸에 하나 더) */
export function makeSplit(index: number, kind: ItemKind, total: number): SplitState {
  return { index, kind, total, amount: Math.max(1, Math.floor(total / 2)) };
}

export function adjustSplit(state: SplitState, delta: number): void {
  state.amount = Math.max(1, Math.min(state.total - 1, state.amount + delta));
}

export interface SplitDialogHandlers {
  padMode: boolean;
  onAdjust: (delta: number) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

/** 화면 가운데 떠 있는 작은 상자 — 두 몫과 비율 막대, −/+, 확인/취소 */
export function renderSplitDialog(state: SplitState, h: SplitDialogHandlers): HTMLElement {
  const big = balance.loot.ui.splitBigStep;
  const box = document.createElement('div');
  box.dataset['split'] = '1';
  box.style.cssText =
    'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:12;width:340px;box-sizing:border-box;' +
    'padding:16px 20px 14px;background:rgba(21,21,27,0.96);border:1px solid #7fbfff;border-radius:6px;' +
    'font:13px/1.6 monospace;color:#cfd2da;text-align:center;box-shadow:0 8px 24px rgba(0,0,0,0.7);';
  const def = itemDef(state.kind);
  const title = document.createElement('div');
  title.textContent = `수량 나누기 — ${def.name} ×${state.total}`;
  title.style.cssText = 'color:#e8c76a;font-size:14px;margin-bottom:10px;';
  box.appendChild(title);

  const row = document.createElement('div');
  row.style.cssText = 'display:flex;align-items:center;justify-content:center;gap:14px;margin-bottom:8px;';
  const left = document.createElement('div');
  left.innerHTML = `${itemIconSvg(state.kind, 26)}<div style="font-size:12px;color:#8a8f9a">원래 칸</div><div style="font-size:18px;color:#e8ecf2">${state.total - state.amount}</div>`;
  const arrow = document.createElement('div');
  arrow.textContent = '⇄';
  arrow.style.cssText = 'color:#7fbfff;font-size:18px;';
  const right = document.createElement('div');
  right.innerHTML = `${itemIconSvg(state.kind, 26)}<div style="font-size:12px;color:#8a8f9a">새 칸</div><div style="font-size:18px;color:#7fbfff">${state.amount}</div>`;
  row.append(left, arrow, right);
  box.appendChild(row);

  // 비율 막대 — 왼쪽(원래 칸) 회색, 오른쪽(새 칸) 푸른색
  const bar = document.createElement('div');
  bar.style.cssText = 'height:8px;border-radius:4px;background:#3a3a44;overflow:hidden;display:flex;margin:0 8px 10px;';
  const fill = document.createElement('div');
  fill.style.cssText = `width:${(state.amount / state.total) * 100}%;background:#7fbfff;margin-left:auto;`;
  bar.appendChild(fill);
  box.appendChild(bar);

  const ctrl = document.createElement('div');
  ctrl.style.cssText = 'display:flex;justify-content:center;gap:8px;margin-bottom:10px;';
  const mk = (label: string, onClick: () => void): HTMLButtonElement => {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = 'padding:3px 12px;border:1px solid #3a3a44;background:#1b1b22;color:#cfd2da;cursor:pointer;font:inherit;';
    b.onclick = onClick;
    return b;
  };
  ctrl.append(mk(`−${big}`, () => h.onAdjust(-big)), mk('−1', () => h.onAdjust(-1)), mk('+1', () => h.onAdjust(1)), mk(`+${big}`, () => h.onAdjust(big)));
  box.appendChild(ctrl);

  const actions = document.createElement('div');
  actions.style.cssText = 'display:flex;justify-content:center;gap:10px;';
  actions.append(mk(`확인 (${h.padMode ? 'A' : 'Enter'})`, h.onConfirm), mk(`취소 (${h.padMode ? 'B' : 'Esc'})`, h.onCancel));
  box.appendChild(actions);

  const hint = document.createElement('div');
  hint.style.cssText = 'margin-top:10px;display:flex;justify-content:center;gap:12px;font-size:11px;color:#8a8f9a;';
  const k1 = document.createElement('span');
  k1.append(keycap(h.padMode ? '◂▸' : '←→', h.padMode), document.createTextNode('±1'));
  const k2 = document.createElement('span');
  k2.append(keycap(h.padMode ? '▴▾' : '↑↓', h.padMode), document.createTextNode(`±${big}`));
  hint.append(k1, k2);
  box.appendChild(hint);
  return box;
}
