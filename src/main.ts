import { GameAudio } from './core/Audio';
import { balance } from './core/Balance';
import { Events } from './core/Events';
import { Input } from './core/Input';
import { Loop } from './core/Loop';
import { World } from './core/World';
import * as Reaction from './systems/Reaction';
import { Level, buildLevelGroup } from './level/GridLoader';
import { spawnEnemies } from './level/Spawner';
import { Minimap } from './render/Minimap';
import { Stage } from './render/Stage';
import * as PlayerMove from './systems/PlayerMove';
import * as Enemies from './systems/Enemies';
import * as Weapons from './systems/Weapons';
import * as Lantern from './systems/Lantern';
import levelJson from '../data/levels/z01_f1.json';

const app = document.getElementById('app');
const hud = document.getElementById('hud');
const deathOverlay = document.getElementById('death');
const flashOverlay = document.getElementById('flash');
if (!app || !hud || !deathOverlay || !flashOverlay)
  throw new Error('index.html에 #app / #hud / #death / #flash가 없다');

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
    stunTicks: 0,
    dodgeTicks: 0,
    dodgeDirX: 0,
    dodgeDirZ: 0,
    iframeTicks: 0,
    reactionBufferTicks: 0,
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
const minimap = new Minimap(level);
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyM') minimap.toggle();
});
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
  'telegraph_flash',
  'player_damaged',
  'player_died',
  'parry_attempt',
  'melee_kill',
  'dodge_step',
  'shot_blocked',
]) {
  events.on(name, (payload) => console.log(`[events] ${name}`, payload));
}

// ---- 오디오 (합성음, 에셋 없음) ----
const audio = new GameAudio();
app.addEventListener('click', () => audio.unlock());
events.on('enemy_windup', () => audio.play('telegraph_blue'));
events.on('parry_attempt', (payload) => {
  const result = (payload as { result: string }).result;
  if (result === 'perfect') audio.play('parry_perfect');
  else if (result === 'normal') audio.play('parry_normal');
  else audio.play('parry_fail');
});
events.on('melee_kill', () => audio.play('execute'));
events.on('shot_blocked', () => audio.play('shot_blocked'));
events.on('dodge_step', () => audio.play('dodge'));

// ---- 패링 화면 탈색 (mix-blend-mode 오버레이) ----
function screenFlash(strength: number, durationMs: number): void {
  flashOverlay!.style.transition = 'none';
  flashOverlay!.style.opacity = String(strength);
  requestAnimationFrame(() => {
    flashOverlay!.style.transition = `opacity ${durationMs}ms ease-out`;
    flashOverlay!.style.opacity = '0';
  });
}
events.on('parry_attempt', (payload) => {
  const result = (payload as { result: string }).result;
  if (result === 'perfect') screenFlash(1, 260);
  else if (result === 'normal') screenFlash(0.6, 140);
});

// ---- HUD 반응 결과 표시 ----
let reactionLabel = '';
let reactionLabelUntil = 0;
function showReaction(text: string): void {
  reactionLabel = text;
  reactionLabelUntil = performance.now() + 1000;
}
events.on('parry_attempt', (payload) => {
  const result = (payload as { result: string }).result;
  showReaction(result === 'perfect' ? '완벽 패링!' : result === 'normal' ? '패링' : '실패 — 경직');
});
events.on('melee_kill', () => showReaction('처형'));
events.on('dodge_step', () => showReaction('회피'));

events.on('player_died', () => deathOverlay.classList.add('visible'));

events.on('shot_fired', (payload) => {
  const shot = payload as { ex: number; ey: number; ez: number };
  stage.spawnTracer(shot.ex, shot.ey, shot.ez);
  stage.triggerRecoil();
});
events.on('parry_attempt', (payload) => {
  stage.triggerParry((payload as { result: string }).result);
});
events.on('dodge_step', () => stage.triggerParry('normal'));
events.on('shot_blocked', (payload) => {
  stage.flashShield((payload as { enemyId: number }).enemyId);
});
window.addEventListener('keydown', (e) => {
  if (e.code === 'Enter' && world.dead) location.reload();
});

// 틱 순서: Input → PlayerMove → Enemies → Reaction → Weapons → Lantern (docs/architecture.md §2)
// Reaction이 Enemies 뒤에 오는 이유: 적의 공격 상태가 확정된 뒤 판정해야 한다.
const systems = [PlayerMove.tick, Enemies.tick, Reaction.tick, Weapons.tick, Lantern.tick];

function simulate(dt: number): void {
  world.input = input.sample();

  // 히트스톱 — simulate를 건너뛰되 반응 입력은 버퍼에 보관 (docs/architecture.md §1)
  if (world.freezeTicks > 0) {
    world.freezeTicks--;
    if (world.input.reactionPressed) {
      world.player.reactionBufferTicks = balance.reaction.inputBufferTicks;
    }
    world.tick++;
    tpsWindowTicks++;
    return;
  }

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
  stage.updateHands({ reloading: world.weapon.reloading > 0, stunned: p.stunTicks > 0 });
  minimap.update(p, world.enemies, alpha);

  const w = world.weapon;
  const aliveCount = world.enemies.filter((e) => e.alive).length;
  if (performance.now() > reactionLabelUntil) reactionLabel = '';
  hud!.textContent =
    `tick ${world.tick}  (${measuredTps.toFixed(1)}/s)\n` +
    `HP ${p.health}   9mm ${w.mag}/${w.reserve}${w.reloading > 0 ? '  [장전중]' : ''}${p.stunTicks > 0 ? '  [경직]' : ''}\n` +
    `lantern ${world.lantern.on ? 'ON ' : 'OFF'}  battery ${world.lantern.battery.toFixed(0)}%  spares ${world.lantern.spares}\n` +
    `enemies ${aliveCount}${reactionLabel ? `   ${reactionLabel}` : ''}\n` +
    (input.pointerLocked
      ? ''
      : '[클릭] 마우스 잠금  WASD 이동  Shift 질주  좌클릭 발사  우클릭 반응(패링/회피)  R 장전  F 랜턴  B 배터리  M 미니맵');

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
