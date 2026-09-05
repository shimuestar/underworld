// 마우스 드래그 — 칸(data-key)에서 집어 다른 칸에 놓는다. 포인터 이벤트 기반: HTML5 DnD 는 hover 마다 DOM 을 다시 짓는
// 창(LootUI·InventoryUI)에서 드래그 원본이 사라져 끊긴다. 원본·대상은 data-key 문자열로만 다루고, 놓는 순간
// elementFromPoint 로 대상 칸을 찾는다. 임계(loot.ui.dragThresholdPx)를 넘기 전에 놓으면 보통 클릭이다 (2026-09-04).

import { balance } from '../core/Balance';

let suppressClickUntil = 0;
// 놓는 순간의 click 이 원본·대상 칸의 '가져오기/고르기'로 새지 않게 — 캡처 단계에서 한 번 삼킨다
window.addEventListener(
  'click',
  (e) => {
    if (performance.now() < suppressClickUntil) {
      e.stopPropagation();
      e.preventDefault();
    }
  },
  { capture: true },
);

/** pointerdown 에서 부른다. 드래그가 되면 놓인 칸의 key(없으면 null)를 onDrop 으로 알린다 */
export function beginDrag(ev: PointerEvent, iconHtml: string, onDrop: (targetKey: string | null) => void): void {
  if (ev.button !== 0) return;
  const startX = ev.clientX;
  const startY = ev.clientY;
  const threshold = balance.loot.ui.dragThresholdPx;
  let ghost: HTMLDivElement | null = null;

  const cleanup = (): void => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', cancel);
    if (ghost) {
      ghost.remove();
      ghost = null;
      document.body.classList.remove('dragging');
    }
  };
  const move = (e: PointerEvent): void => {
    if (!ghost) {
      if (Math.hypot(e.clientX - startX, e.clientY - startY) < threshold) return;
      ghost = document.createElement('div');
      ghost.innerHTML = iconHtml;
      ghost.style.cssText =
        'position:fixed;left:0;top:0;pointer-events:none;z-index:50;line-height:0;opacity:0.92;' +
        'transform:translate(-50%,-50%) scale(1.2);filter:drop-shadow(0 4px 8px rgba(0,0,0,0.7));';
      document.body.appendChild(ghost);
      document.body.classList.add('dragging');
    }
    ghost.style.left = `${e.clientX}px`;
    ghost.style.top = `${e.clientY}px`;
  };
  const up = (e: PointerEvent): void => {
    const dragged = ghost !== null;
    cleanup();
    if (!dragged) return; // 안 움직였다 — 보통 클릭으로 흘러간다
    suppressClickUntil = performance.now() + 80;
    const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
    const key = el?.closest<HTMLElement>('[data-key]')?.dataset['key'] ?? null;
    onDrop(key);
  };
  const cancel = (): void => cleanup();
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', cancel);
}
