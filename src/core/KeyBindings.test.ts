// 키보드 키 설정 — 기본값, 겹침(스틸), 해제, 복원, 시프트 짝, 표기
import { describe, expect, it } from 'vitest';
import { DEFAULT_KEY_BINDINGS, KEY_ACTIONS, KeyBindings, keyName } from './KeyBindings';

describe('키보드 키 설정', () => {
  it('기본값 — 모든 기능에 서로 다른 키가 걸려 있다', () => {
    const kb = new KeyBindings();
    const codes = KEY_ACTIONS.map((a) => kb.code(a.id));
    expect(new Set(codes).size).toBe(codes.length); // 겹침 없음
    expect(kb.code('forward')).toBe('KeyW');
    expect(kb.code('inventory')).toBe('KeyI');
  });

  it('같은 키를 다른 기능에 걸면 먼저 쓰던 쪽이 (없음)이 된다', () => {
    const kb = new KeyBindings();
    kb.bind('lantern', 'KeyR'); // 재장전 키를 랜턴에
    expect(kb.code('lantern')).toBe('KeyR');
    expect(kb.code('reload')).toBe(''); // 뺏겼다
    expect(keyName(kb.code('reload'))).toBe('(없음)');
  });

  it('해제와 기본값 복원', () => {
    const kb = new KeyBindings();
    kb.unbind('sprint');
    expect(kb.code('sprint')).toBe('');
    kb.resetToDefaults();
    expect(kb.code('sprint')).toBe(DEFAULT_KEY_BINDINGS.sprint);
    expect(kb.isDefault('sprint')).toBe(true);
  });

  it('반응 키가 시프트면 좌·우를 한 키로 본다, 다른 키면 그 키만', () => {
    const kb = new KeyBindings();
    expect(kb.codesOf('reaction').sort()).toEqual(['ShiftLeft', 'ShiftRight']);
    kb.bind('reaction', 'KeyG');
    expect(kb.codesOf('reaction')).toEqual(['KeyG']);
    kb.unbind('reaction');
    expect(kb.codesOf('reaction')).toEqual([]);
  });

  it('키 표기 — 짧고 읽기 좋게', () => {
    expect(keyName('KeyW')).toBe('W');
    expect(keyName('Digit3')).toBe('3');
    expect(keyName('Space')).toBe('Space');
    expect(keyName('ShiftLeft')).toBe('LShift');
    expect(keyName('ArrowUp')).toBe('↑');
    expect(keyName('')).toBe('(없음)');
  });
});
