// 패드 매핑 — 데드존·곡선, 엣지, 리매핑, 저장. 실기 없이 검증할 수 있는 부분만.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { balance } from './Balance';
import { DEFAULT_BINDINGS, GamepadInput, PAD_ACTIONS, buttonName } from './Gamepad';

const CFG = balance.input.gamepad;

/** 가짜 패드 하나를 navigator 에 물린다 */
function fakePad(buttons: number[] = [], axes: number[] = [0, 0, 0, 0]): void {
  const pad = {
    index: 0,
    connected: true,
    axes,
    buttons: Array.from({ length: 17 }, (_, i) => ({
      pressed: buttons.includes(i),
      value: buttons.includes(i) ? 1 : 0,
    })),
  };
  vi.stubGlobal('navigator', { getGamepads: () => [pad] });
}

function noPad(): void {
  vi.stubGlobal('navigator', { getGamepads: () => [] });
}

let pad: GamepadInput;
beforeEach(() => {
  const store: Record<string, string> = {};
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
  });
  noPad();
  pad = new GamepadInput();
});

describe('기본 매핑', () => {
  it('전투에 필요한 기능은 전부 걸려 있다 — 빈 채로 출발하지 않는다', () => {
    for (const { id } of PAD_ACTIONS) {
      // 배터리만 예외 — 랜턴(R3) 길게 누르기가 맡는다
      if (id === 'battery') continue;
      expect(DEFAULT_BINDINGS[id]).toBeGreaterThanOrEqual(0);
    }
  });

  it('평상시 버튼끼리, 조합 레이어 버튼끼리 겹치지 않는다', () => {
    // 칩(조합) 방식: 스킬 1~4 는 skillSelect 를 누른 채, 퀵슬롯 1~4 는 itemSelect 를
    // 누른 채 눌리는 레이어라 평상시 버튼(회피·상호작용 등)과 겹쳐도 된다.
    // 겹치면 안 되는 것: 평상시끼리 / 같은 레이어 안끼리 / 대상 버튼과 그 레이어의 선택 버튼
    const skillIds = ['skill1', 'skill2', 'skill3', 'skill4'] as const;
    const slotIds = ['slot1', 'slot2', 'slot3', 'slot4'] as const;
    const chord = new Set<string>([...skillIds, ...slotIds]);
    const plainUsed = PAD_ACTIONS.filter((a) => !chord.has(a.id))
      .map((a) => DEFAULT_BINDINGS[a.id])
      .filter((b) => b >= 0);
    expect(new Set(plainUsed).size).toBe(plainUsed.length);
    const skills = skillIds.map((id) => DEFAULT_BINDINGS[id]);
    expect(new Set(skills).size).toBe(skills.length);
    expect(skills).not.toContain(DEFAULT_BINDINGS.skillSelect); // 선택 버튼과 대상이 같으면 못 누른다
    const slots = slotIds.map((id) => DEFAULT_BINDINGS[id]);
    expect(new Set(slots).size).toBe(slots.length);
    expect(slots).not.toContain(DEFAULT_BINDINGS.itemSelect);
  });

  it('Xbox 배치 안의 버튼만 쓴다 (0~15)', () => {
    for (const b of Object.values(DEFAULT_BINDINGS)) {
      if (b < 0) continue;
      expect(b).toBeLessThanOrEqual(15);
      expect(buttonName(b)).not.toMatch(/^버튼 /); // 이름을 아는 버튼이다
    }
  });

  it('일시정지가 걸려 있다 — 없으면 패드만 쓰는 사람이 설정 화면에 못 온다', () => {
    expect(DEFAULT_BINDINGS.pause).toBe(8); // View
  });

  it('가장 많이 쓰는 것이 오른쪽 트리거·범퍼에 있다', () => {
    expect(DEFAULT_BINDINGS.ranged).toBe(7); // RT
    expect(DEFAULT_BINDINGS.melee).toBe(5); // RB
    expect(DEFAULT_BINDINGS.reaction).toBe(6); // LT
  });
});

describe('폴링과 엣지', () => {
  it('패드가 없으면 아무것도 안 눌린 상태다', () => {
    pad.poll();
    expect(pad.connected).toBe(false);
    expect(pad.held('ranged')).toBe(false);
    expect(pad.axes()).toEqual({ moveX: 0, moveY: 0, lookX: 0, lookY: 0 });
  });

  it('누른 첫 틱만 pressed, 떼는 틱만 released', () => {
    fakePad([DEFAULT_BINDINGS.ranged]);
    pad.poll();
    expect(pad.pressed('ranged')).toBe(true);
    expect(pad.held('ranged')).toBe(true);

    pad.poll(); // 계속 누르고 있다
    expect(pad.pressed('ranged')).toBe(false);
    expect(pad.held('ranged')).toBe(true);

    fakePad([]);
    pad.poll();
    expect(pad.released('ranged')).toBe(true);
    expect(pad.held('ranged')).toBe(false);
  });

  it('트리거는 아날로그다 — 문턱을 넘으면 눌린 것으로 본다', () => {
    const pressedPad = {
      index: 0, connected: true, axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 17 }, (_, i) => ({
        pressed: false, // 브라우저가 pressed 를 안 올려도
        value: i === DEFAULT_BINDINGS.ranged ? CFG.triggerThreshold + 0.01 : 0,
      })),
    };
    vi.stubGlobal('navigator', { getGamepads: () => [pressedPad] });
    pad.poll();
    expect(pad.held('ranged')).toBe(true);
  });

  it('문턱 아래로 살짝 당긴 트리거는 안 눌린 것이다', () => {
    const light = {
      index: 0, connected: true, axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 17 }, (_, i) => ({
        pressed: false,
        value: i === DEFAULT_BINDINGS.ranged ? CFG.triggerThreshold - 0.01 : 0,
      })),
    };
    vi.stubGlobal('navigator', { getGamepads: () => [light] });
    pad.poll();
    expect(pad.held('ranged')).toBe(false);
  });
});

describe('축 — 데드존과 곡선', () => {
  it('데드존 안은 0 이다 — 스틱이 안 돌아와도 안 흐른다', () => {
    fakePad([], [CFG.moveDeadzone - 0.01, 0, CFG.lookDeadzone - 0.01, 0]);
    pad.poll();
    const a = pad.axes();
    expect(a.moveX).toBe(0);
    expect(a.lookX).toBe(0);
  });

  it('데드존 바깥은 0 부터 다시 편다 — 경계에서 값이 튀지 않는다', () => {
    fakePad([], [CFG.moveDeadzone + 0.001, 0, 0, 0]);
    pad.poll();
    expect(pad.axes().moveX).toBeCloseTo(0, 2);
  });

  it('끝까지 밀면 1 이다', () => {
    fakePad([], [1, -1, 1, -1]);
    pad.poll();
    const a = pad.axes();
    expect(a.moveX).toBeCloseTo(1, 5);
    expect(a.moveY).toBeCloseTo(-1, 5);
    expect(a.lookX).toBeCloseTo(1, 5);
  });

  it('이동은 선형, 시선은 중앙부를 눌러 정밀 조준을 살린다', () => {
    fakePad([], [0.6, 0, 0.6, 0]);
    pad.poll();
    const a = pad.axes();
    expect(a.lookX).toBeLessThan(a.moveX); // 같은 기울기에서 시선이 더 느리다
    expect(CFG.lookCurve).toBeGreaterThan(1);
  });
});

describe('리매핑', () => {
  it('바꾼 매핑이 곧바로 먹는다', () => {
    pad.bind('ranged', 0); // A 로 옮긴다
    fakePad([0]);
    pad.poll();
    expect(pad.held('ranged')).toBe(true);
    expect(pad.binding('ranged')).toBe(0);
  });

  it('같은 버튼을 다른 기능에 걸면 먼저 쓰던 쪽이 비워진다', () => {
    // 안 비우면 한 번 눌러 두 기능이 같이 나가 어느 쪽이 의도인지 알 수 없다
    const before = DEFAULT_BINDINGS.melee;
    pad.bind('skillSelect', before);
    expect(pad.binding('skillSelect')).toBe(before);
    expect(pad.binding('melee')).toBe(-1);
  });

  it('안 걸린 기능(-1)은 어떤 버튼에도 반응하지 않는다', () => {
    pad.unbind('skillSelect');
    fakePad(Array.from({ length: 17 }, (_, i) => i)); // 전부 누른다
    pad.poll();
    expect(pad.held('skillSelect')).toBe(false);
  });

  it('기본값으로 되돌린다', () => {
    pad.bind('ranged', 0);
    pad.resetToDefaults();
    expect(pad.allBindings()).toEqual(DEFAULT_BINDINGS);
  });

  it('설정이 저장되고 다음 판에 그대로 돌아온다', () => {
    pad.bind('skillSelect', 14);
    const reloaded = new GamepadInput();
    expect(reloaded.binding('skillSelect')).toBe(14);
  });

  it('저장본이 깨져 있어도 기본값으로 뜬다', () => {
    localStorage.setItem('underworld.gamepad.bindings.v2', '{{{');
    expect(new GamepadInput().allBindings()).toEqual(DEFAULT_BINDINGS);
  });

  it('저장본에 없는 기능은 기본값을 쓴다 — 기능이 늘어도 설정이 안 깨진다', () => {
    localStorage.setItem('underworld.gamepad.bindings.v2', JSON.stringify({ skillSelect: 14 }));
    const reloaded = new GamepadInput();
    expect(reloaded.binding('skillSelect')).toBe(14);
    expect(reloaded.binding('ranged')).toBe(DEFAULT_BINDINGS.ranged);
  });

  it('설정 화면용 rawPressed 는 매핑을 안 거친다 — 잘못 걸어도 빠져나올 수 있다', () => {
    pad.bind('ranged', 0); // A 를 다른 데 걸어도
    fakePad([0]);
    pad.poll();
    expect(pad.rawPressed(0)).toBe(true); // A 는 여전히 A 다
  });

  it('대기 중 아무 버튼이나 잡는다', () => {
    fakePad([]);
    pad.poll();
    fakePad([9]);
    pad.poll();
    expect(pad.firstNewButton()).toBe(9);
  });
});
