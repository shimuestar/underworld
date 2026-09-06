// 미니맵·맵 탭 색 표 — 격자의 막힌 문자(GridLoader SOLID_CHARS)는 전부 지도에 색이 있어야 한다.
// 빠지면 COLORS[ch] ?? FLOOR 로 바닥색이 되어 판정(벽)≠그림(빈 칸) — 기둥 P(B2-5)에서 났던 일. 다음 문자(잔해 등)에서 재발을 막는다.

import { describe, expect, it } from 'vitest';
import { COLOR_GATE, COLOR_PILLAR, SOLID_CHARS } from '../level/GridLoader';
import { MINIMAP } from './Minimap';

const css = (n: number): string => '#' + n.toString(16).padStart(6, '0');

describe('지도 색 표 = 격자 문자', () => {
  it('SOLID 문자 전부가 COLORS 에 있다 — 막힌 칸이 바닥색으로 그려지지 않는다', () => {
    for (const ch of SOLID_CHARS) {
      const color = MINIMAP.colors[ch];
      expect(color, `SOLID '${ch}' 에 지도 색이 없다`).toBeDefined();
      expect(color, ch).not.toBe(MINIMAP.floor);
      expect(color, ch).not.toBe(MINIMAP.fog);
    }
  });

  it('기둥 P·쇠창살 G 는 월드 시각물(GridLoader 상수)과 같은 색', () => {
    expect(MINIMAP.colors['P']).toBe(css(COLOR_PILLAR));
    expect(MINIMAP.colors['G']).toBe(css(COLOR_GATE));
  });
});
