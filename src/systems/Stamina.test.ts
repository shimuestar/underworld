// 스태미너 — 질주 소모, 회피 소모, 탈진과 회복선.

import { beforeEach, describe, expect, it } from 'vitest';
import { balance } from '../core/Balance';
import { Events } from '../core/Events';
import { Input } from '../core/Input';
import { World } from '../core/World';
import { Level } from '../level/GridLoader';
import * as PlayerMove from './PlayerMove';
import * as Reaction from './Reaction';
import * as Sigils from './Sigils';
import * as Stamina from './Stamina';
import * as Weapons from './Weapons';

const DT = 1 / 60;
const CFG = balance.player.stamina;

function makeWorld(): World {
  const level = new Level({
    id: 'arena',
    name: 'arena',
    cellSize: 4,
    ceiling: 4,
    grid: ['########', '#S.....#', '#......#', '########'],
    lighting: { ambient: 0.04, torches: [] },
  });
  const world = new World(new Events(), {
    input: Input.emptySnapshot(),
    player: {
      x: 10, y: 0, z: 10, prevX: 10, prevY: 0, prevZ: 10,
      yaw: 0, pitch: 0, health: 100,
      stunTicks: 0, dodgeTicks: 0, dodgeDirX: 0, dodgeDirZ: 0,
      iframeTicks: 0, reactionBufferTicks: 0, blocking: false, reactionHeldTicks: 0,
    },
    lantern: { on: true, battery: 100, spares: 0 },
    weapon: { melee: 'hammer', ranged: 'pistol', mag: 12, reserve: 60, cooldown: 0, reloading: 0, muzzleFlash: 0, grenades: 3, meleeCooldown: 0, grenadeCharge: 0, comboStep: 0, comboTimer: 0, swingImpact: 0, swingHeavy: false },
    mana: { value: 0, chainIndex: 0, outOfCombatTicks: 0, inCombat: false },
    sigils: {
      inventory: [],
      equipped: { eye: null, rightArm: null, leftArm: null, heart: null, spine: null },
    },
    modifiers: Sigils.defaultModifiers(),
    corruption: { applied: 0, pending: 0 },
    enemies: [],
    level,
  });
  Stamina.init(world);
  return world;
}

/** 질주 입력으로 n틱 이동 */
function sprint(world: World, ticks: number, moving = true): void {
  for (let i = 0; i < ticks; i++) {
    world.input = { ...Input.emptySnapshot(), sprint: true, moveForward: moving ? 1 : 0 };
    PlayerMove.tick(world, DT);
    Stamina.tick(world, DT);
    world.input = Input.emptySnapshot();
  }
}

/** 걷기 한 틱 (yaw 0 → −Z 방향) */
function step(world: World): void {
  world.input = { ...Input.emptySnapshot(), moveForward: 1 };
  PlayerMove.tick(world, DT);
  world.input = Input.emptySnapshot();
}

/** from 에서 지금까지 실제로 움직인 거리 (축을 헷갈리지 않게 항상 평면 거리로 잰다) */
function moved(world: World, from: { x: number; z: number }): number {
  return Math.hypot(world.player.x - from.x, world.player.z - from.z);
}

let world: World;
beforeEach(() => {
  world = makeWorld();
});

describe('질주', () => {
  it('가득 찬 상태로 시작하고, 달리는 동안만 닳는다', () => {
    expect(world.stamina.value).toBe(CFG.max);
    sprint(world, 10);
    expect(world.stamina.value).toBeCloseTo(CFG.max - 10 * CFG.sprintDrainPerTick, 5);
  });

  it('제자리에서 쉬프트만 누르면 닳지 않는다', () => {
    sprint(world, 30, false);
    expect(world.stamina.value).toBe(CFG.max);
  });

  it('달리는 동안에는 회복하지 않는다 (regenDelay)', () => {
    sprint(world, 5);
    const after = world.stamina.value;
    sprint(world, 5);
    expect(world.stamina.value).toBeLessThan(after);
  });

  it('바닥나면 탈진 — 회복선까지 차야 다시 질주할 수 있다', () => {
    const empty: unknown[] = [];
    const recovered: unknown[] = [];
    world.events.on('stamina_empty', () => empty.push(1));
    world.events.on('stamina_recovered', () => recovered.push(1));

    sprint(world, Math.ceil(CFG.max / CFG.sprintDrainPerTick) + 1);
    expect(world.stamina.value).toBe(0);
    expect(world.stamina.exhausted).toBe(true);
    expect(empty).toHaveLength(1); // 한 번만

    // 탈진 중엔 쉬프트를 눌러도 질주가 안 되고, 걸음마저 절반이다.
    // (오래 달려 벽에 붙었으므로 방 가운데로 되돌려 놓고 잰다)
    world.player.x = 10;
    world.player.z = 10;
    const from = { x: world.player.x, z: world.player.z };
    sprint(world, 1);
    const walked = moved(world, from);
    expect(walked).toBeCloseTo(balance.player.moveSpeed * CFG.exhaustedSpeedMul * DT, 5);
    expect(walked).toBeLessThan(balance.player.moveSpeed * DT); // 평속보다도 느리다

    // 회복선(exhaustRecoverTo)에 닿는 순간 풀린다 — 그 전에는 계속 탈진
    world.input = Input.emptySnapshot();
    let ticks = 0;
    while (world.stamina.exhausted && ticks < 600) {
      expect(world.stamina.value).toBeLessThan(CFG.exhaustRecoverTo);
      Stamina.tick(world, DT);
      ticks++;
    }
    expect(world.stamina.exhausted).toBe(false);
    expect(world.stamina.value).toBeGreaterThanOrEqual(CFG.exhaustRecoverTo);
    expect(recovered).toHaveLength(1);
  });

  it('탈진 구간은 회복이 훨씬 느리고, 해제선을 넘으면 원래 속도로 돌아온다', () => {
    expect(CFG.exhaustedRegenPerTick).toBeLessThan(CFG.regenPerTick);
    const st = world.stamina;
    st.value = 0;
    st.exhausted = true;
    st.regenDelay = 0;

    Stamina.tick(world, DT);
    expect(st.value).toBeCloseTo(CFG.exhaustedRegenPerTick, 5); // 느린 회복

    // 해제선 직전까지 감아 두고 한 틱 — 여기까지는 여전히 느리다
    st.value = CFG.exhaustRecoverTo - CFG.exhaustedRegenPerTick * 1.5;
    const before = st.value;
    Stamina.tick(world, DT);
    expect(st.value).toBeCloseTo(before + CFG.exhaustedRegenPerTick, 5);
    expect(st.exhausted).toBe(true);

    // 해제선을 넘긴 뒤에는 원래 속도
    Stamina.tick(world, DT);
    expect(st.exhausted).toBe(false);
    const after = st.value;
    Stamina.tick(world, DT);
    expect(st.value).toBeCloseTo(after + CFG.regenPerTick, 5);
  });

  it('탈진 중 이동 속도는 절반 — 방어 감속과는 곱해진다', () => {
    world.stamina.exhausted = true;
    world.stamina.value = 5;

    // 대조군: 멀쩡할 때 한 틱
    world.stamina.exhausted = false;
    let from = { x: world.player.x, z: world.player.z };
    step(world);
    const normal = moved(world, from);
    expect(normal).toBeCloseTo(balance.player.moveSpeed * DT, 5);

    world.stamina.exhausted = true;
    from = { x: world.player.x, z: world.player.z };
    step(world);
    expect(moved(world, from)).toBeCloseTo(normal * CFG.exhaustedSpeedMul, 5);

    world.player.blocking = true;
    from = { x: world.player.x, z: world.player.z };
    step(world);
    expect(moved(world, from)).toBeCloseTo(
      normal * CFG.exhaustedSpeedMul * balance.block.speedMul,
      5,
    );
  });

  it('탈진 걸음은 거미줄에 걸린 걸음과 같은 속도다', () => {
    // 2026-08: 발이 묶이는 두 상태의 체감을 하나로 맞췄다.
    // 배율은 각각 남겨 둔다 — 같은 값일 뿐 같은 손잡이가 아니다
    expect(CFG.exhaustedSpeedMul).toBeCloseTo(balance.web.moveSpeedMul, 5);

    const webbed = makeWorld();
    webbed.player.webSwingsLeft = balance.web.breakSwings;
    let from = { x: webbed.player.x, z: webbed.player.z };
    step(webbed);
    const webStep = moved(webbed, from);

    const tired = makeWorld();
    tired.stamina.exhausted = true;
    from = { x: tired.player.x, z: tired.player.z };
    step(tired);
    expect(moved(tired, from)).toBeCloseTo(webStep, 5);
  });

  it('탈진과 거미줄이 겹치면 곱해진다 — 둘 다면 훨씬 느리다', () => {
    const both = makeWorld();
    both.stamina.exhausted = true;
    both.player.webSwingsLeft = balance.web.breakSwings;
    const from = { x: both.player.x, z: both.player.z };
    step(both);
    expect(moved(both, from)).toBeCloseTo(
      balance.player.moveSpeed * CFG.exhaustedSpeedMul * balance.web.moveSpeedMul * DT,
      5,
    );
  });

  it('쉬면 회복한다 — 단 한동안 기다린 뒤에야 (regenDelayTicks)', () => {
    sprint(world, 60); // 상한에 부딪히지 않게 넉넉히 쓴다
    const spent = world.stamina.value;
    expect(spent).toBeLessThan(CFG.max - 12 * CFG.regenPerTick);
    world.input = Input.emptySnapshot();

    // 지연 구간 동안은 미동도 없다
    for (let i = 0; i < CFG.regenDelayTicks - 2; i++) Stamina.tick(world, DT);
    expect(world.stamina.value).toBe(spent);

    // 지연이 풀리면 regenPerTick 씩 오른다
    for (let i = 0; i < 12; i++) Stamina.tick(world, DT);
    expect(world.stamina.value).toBeGreaterThan(spent);
    const mid = world.stamina.value;
    Stamina.tick(world, DT);
    expect(world.stamina.value).toBeCloseTo(mid + CFG.regenPerTick, 5);
  });
});

describe('해머', () => {
  /** 한 번 휘두르고 해머가 닿을 때까지 진행한다 */
  function swing(): void {
    world.weapon.meleeCooldown = 0;
    world.input = { ...Input.emptySnapshot(), meleePressed: true };
    Weapons.tick(world, DT);
    world.input = Input.emptySnapshot();
    for (let i = 0; i < 20 && world.weapon.swingImpact > 0; i++) Weapons.tick(world, DT);
  }

  it('휘두르면 닳는다 — 마무리 3타가 더 크게', () => {
    swing();
    expect(world.stamina.value).toBe(CFG.max - CFG.hammerCost);
    swing();
    expect(world.stamina.value).toBe(CFG.max - CFG.hammerCost * 2);
    swing(); // 3타 = 강타
    expect(world.weapon.swingHeavy).toBe(true);
    expect(world.stamina.value).toBe(CFG.max - CFG.hammerCost * 2 - CFG.hammerHeavyCost);
    expect(CFG.hammerHeavyCost).toBeGreaterThan(CFG.hammerCost);
  });

  it('헛쳐도 낸다 — 휘두른 값이다', () => {
    expect(world.enemies).toHaveLength(0);
    swing();
    expect(world.stamina.value).toBe(CFG.max - CFG.hammerCost);
  });

  it('모자라도 스윙 자체는 막지 않는다 — 거미줄을 걷어낼 유일한 수단이라', () => {
    world.stamina.value = 1;
    const empty: unknown[] = [];
    world.events.on('stamina_empty', () => empty.push(1));

    swing();
    expect(world.weapon.swingImpact).toBe(0); // 스윙이 끝까지 나갔다
    expect(world.stamina.value).toBe(0);
    expect(world.stamina.exhausted).toBe(true);
    expect(empty).toHaveLength(1);

    swing(); // 탈진 중에도 계속 휘두를 수는 있다
    expect(world.stamina.value).toBe(0);
    expect(empty).toHaveLength(1); // 알림은 한 번만
  });
});

describe('회피', () => {
  /** Shift 연타 — 첫 타는 창만 열고 두 번째 타에 나간다 */
  function dodge(world: World): void {
    for (let i = 0; i < 2; i++) {
      world.input = { ...Input.emptySnapshot(), sprint: true, sprintPressed: true };
      Reaction.tick(world, DT);
      world.input = Input.emptySnapshot();
    }
  }

  it('질주보다 훨씬 크게 깎인다 — dodgeCost 만큼', () => {
    dodge(world);
    expect(world.player.dodgeTicks).toBe(balance.reaction.dodgeDashTicks);
    expect(world.stamina.value).toBe(CFG.max - CFG.dodgeCost);
    expect(CFG.dodgeCost).toBeGreaterThan(CFG.sprintDrainPerTick * 10);
  });

  it('모자라면 회피가 아예 나가지 않는다 — 스태미너도 그대로', () => {
    world.stamina.value = CFG.dodgeCost - 1;
    const blocked: { action: string }[] = [];
    world.events.on('stamina_blocked', (payload) => blocked.push(payload as { action: string }));

    dodge(world);
    expect(world.player.dodgeTicks).toBe(0);
    expect(world.stamina.value).toBe(CFG.dodgeCost - 1);
    expect(blocked[0]).toMatchObject({ action: 'dodge' });
  });
});
