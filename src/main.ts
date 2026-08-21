import { balance } from './core/Balance';
import { Events } from './core/Events';
import { Input } from './core/Input';
import { Loop } from './core/Loop';
import { World } from './core/World';
import { Level, buildLevelGroup } from './level/GridLoader';
import { spawnEnemies } from './level/Spawner';
import { Stage } from './render/Stage';
import * as PlayerMove from './systems/PlayerMove';
import * as Enemies from './systems/Enemies';
import * as Weapons from './systems/Weapons';
import * as Lantern from './systems/Lantern';
import levelJson from '../data/levels/z01_f1.json';

const app = document.getElementById('app');
const hud = document.getElementById('hud');
const deathOverlay = document.getElementById('death');
if (!app || !hud || !deathOverlay) throw new Error('index.html에 #app / #hud / #death가 없다');

const events = new Events();
const level = new Level(levelJson);
const input = new Input(app);

const world = new World(events, {
  input: Input.emptySnapshot(),
  player: {
    x: level.spawn.x,
    y: 0,
    z: level.spawn.z,
    prevX: level.spawn.x,
    prevY: 0,
    prevZ: level.spawn.z,
    yaw: 0,
    pitch: 0,
    health: balance.player.healthMax,
  },
  lantern: {
    on: true,
    battery: balance.lantern.batteryMax,
    spares: balance.lantern.spareCells,
  },
  weapon: {
    mag: balance.weapons.pistol.magSize,
    reserve: balance.weapons.pistol.ammoMax,
    cooldown: 0,
    reloading: 0,
    muzzleFlash: 0,
  },
  enemies: spawnEnemies(levelJson.entities, level),
  level,
});

const stage = new Stage(app);
stage.setLevel(
  buildLevelGroup(level, {
    color: balance.lighting.torchColor,
    intensity: balance.lighting.torchIntensity,
    distance: balance.lighting.torchDistance,
    height: balance.lighting.torchHeight,
  }),
  level.ambient,
);

// 이벤트 → 콘솔 (Metrics는 M8에서 이 자리를 대체한다)
for (const name of [
  'loop_started',
  'lantern_toggled',
  'lantern_died',
  'battery_swapped',
  'ammo_spent',
  'reload_started',
  'reload_finished',
  'weapon_empty',
  'weapon_kill',
  'enemy_damaged',
  'enemy_alerted',
  'enemy_windup',
  'player_damaged',
  'player_died',
]) {
  events.on(name, (payload) => console.log(`[events] ${name}`, payload));
}

events.on('player_died', () => deathOverlay.classList.add('visible'));
window.addEventListener('keydown', (e) => {
  if (e.code === 'Enter' && world.dead) location.reload();
});

// 틱 순서: Input → PlayerMove → Enemies → Weapons → Lantern (docs/architecture.md §2)
const systems = [PlayerMove.tick, Enemies.tick, Weapons.tick, Lantern.tick];

function simulate(dt: number): void {
  world.input = input.sample();
  if (!world.dead) {
    for (const system of systems) system(world, dt);
  }
  world.tick++;
  tpsWindowTicks++;
}

// HUD용 실측 TPS
let tpsWindowStart = performance.now();
let tpsWindowTicks = 0;
let measuredTps = 0;

function render(alpha: number): void {
  const now = performance.now();
  if (now - tpsWindowStart >= 1000) {
    measuredTps = tpsWindowTicks / ((now - tpsWindowStart) / 1000);
    tpsWindowStart = now;
    tpsWindowTicks = 0;
  }

  const p = world.player;
  stage.updateCamera(
    p.prevX + (p.x - p.prevX) * alpha,
    p.prevY + (p.y - p.prevY) * alpha,
    p.prevZ + (p.z - p.prevZ) * alpha,
    p.yaw,
    p.pitch,
  );
  stage.setLanternOn(world.lantern.on);
  stage.setMuzzleFlash(world.weapon.muzzleFlash > 0);
  stage.syncEnemies(world.enemies, alpha);

  const w = world.weapon;
  const aliveCount = world.enemies.filter((e) => e.alive).length;
  hud!.textContent =
    `tick ${world.tick}  (${measuredTps.toFixed(1)}/s)\n` +
    `HP ${p.health}   9mm ${w.mag}/${w.reserve}${w.reloading > 0 ? '  [장전중]' : ''}\n` +
    `lantern ${world.lantern.on ? 'ON ' : 'OFF'}  battery ${world.lantern.battery.toFixed(0)}%  spares ${world.lantern.spares}\n` +
    `enemies ${aliveCount}\n` +
    (input.pointerLocked
      ? ''
      : '[클릭] 마우스 잠금  WASD 이동  Shift 질주  좌클릭 발사  R 장전  F 랜턴  B 배터리');

  stage.render();
}

const loop = new Loop(balance.loop.tickRate, balance.loop.maxFrameClampSec, {
  simulate,
  render,
});

// 개발 빌드 전용 디버그 핸들 (헤드리스 테스트/콘솔 조작용)
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__world = world;
  (window as unknown as Record<string, unknown>).__input = input;
}

loop.start();
events.emit('loop_started', { tickRate: balance.loop.tickRate, level: levelJson.id });
