import { balance } from './core/Balance';
import { Events } from './core/Events';
import { Loop } from './core/Loop';
import { World } from './core/World';
import { Stage } from './render/Stage';

const app = document.getElementById('app');
const hud = document.getElementById('hud');
if (!app || !hud) throw new Error('index.html에 #app / #hud가 없다');

const events = new Events();
const world = new World(events);
const stage = new Stage(app, balance.player.eyeHeight);

// M0.3 — 이벤트 발행/구독 확인
events.on('loop_started', (payload) => {
  console.log('[events] loop_started', payload);
});

// HUD용 실측 TPS — 완료 조건 "초당 정확히 60" 검증용
let tpsWindowStart = performance.now();
let tpsWindowTicks = 0;
let measuredTps = 0;

function simulate(_dt: number): void {
  world.tick++;
  tpsWindowTicks++;
}

function render(_alpha: number): void {
  const now = performance.now();
  if (now - tpsWindowStart >= 1000) {
    measuredTps = tpsWindowTicks / ((now - tpsWindowStart) / 1000);
    tpsWindowStart = now;
    tpsWindowTicks = 0;
  }

  hud!.textContent =
    `tick ${world.tick}  (${measuredTps.toFixed(1)}/s)\n` +
    `tickRate(balance) ${balance.loop.tickRate}`;

  stage.render();
}

const loop = new Loop(balance.loop.tickRate, balance.loop.maxFrameClampSec, {
  simulate,
  render,
});

loop.start();
events.emit('loop_started', { tickRate: balance.loop.tickRate });
