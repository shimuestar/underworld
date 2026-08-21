import { GameAudio } from './core/Audio';
import { balance } from './core/Balance';
import { Events } from './core/Events';
import { Input } from './core/Input';
import { Loop } from './core/Loop';
import { World } from './core/World';
import * as Reaction from './systems/Reaction';
import { Level, buildLevelGroup } from './level/GridLoader';
import { spawnEnemies, spawnEnemyAt } from './level/Spawner';
import { Minimap } from './render/Minimap';
import { Stage } from './render/Stage';
import * as PlayerMove from './systems/PlayerMove';
import * as Enemies from './systems/Enemies';
import * as Weapons from './systems/Weapons';
import * as Projectiles from './systems/Projectiles';
import * as Mana from './systems/Mana';
import * as Sigils from './systems/Sigils';
import * as Lantern from './systems/Lantern';
import { SigilUI } from './render/SigilUI';
import { sigilDef } from './core/SigilData';
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
  mana: { value: 0, chainIndex: 0, outOfCombatTicks: 0, inCombat: false },
  sigils: {
    inventory: [],
    equipped: { eye: null, rightArm: null, leftArm: null, heart: null, spine: null },
  },
  modifiers: Sigils.defaultModifiers(),
  corruption: { applied: 0, pending: 0 },
  enemies: spawnEnemies(levelJson.entities, level),
  level,
});

const stage = new Stage(app);
const minimap = new Minimap(level);
const sigilUI = new SigilUI(world);
window.addEventListener('keydown', (e) => {
  if (e.code === 'Tab') {
    e.preventDefault();
    world.uiOpen = sigilUI.toggle();
    if (world.uiOpen) document.exitPointerLock();
  }
});
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyM') minimap.toggle();
  // 테스트용 마나 풀충전 — 마법 튜닝 편의 (슬라이스 검증 시 제거)
  if (e.code === 'KeyO' && !world.dead) {
    world.mana.value = balance.mana.max;
    showReaction('(테스트) 마나 풀충전');
    console.log('[debug] 마나 풀충전');
  }
  // 연습용 창병 소환 — 패링 튜닝 편의 (슬라이스 검증 시 제거)
  if (e.code === 'KeyP' && !world.dead) {
    const p = world.player;
    // 전방 벽까지 거리를 재고 그 앞에, 막혀 있으면 뒤쪽에 소환
    for (const sign of [1, -1]) {
      const fx = -Math.sin(p.yaw) * sign;
      const fz = -Math.cos(p.yaw) * sign;
      const wallT = level.wallRayT(p.x, p.z, fx, fz);
      const dist = Math.min(6, wallT - 0.8);
      if (dist < 2.5) continue; // 너무 가까우면 반대쪽 시도
      const x = p.x + fx * dist;
      const z = p.z + fz * dist;
      const id = Math.max(0, ...world.enemies.map((en) => en.id)) + 1;
      world.enemies.push(spawnEnemyAt('goblin_spear', x, z, id));
      console.log(`[debug] 연습용 창병 소환 (${x.toFixed(1)}, ${z.toFixed(1)})`);
      break;
    }
  }
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
  'mana_gained',
  'mana_lost',
  'combat_entered',
  'combat_exited',
  'cast_spell',
  'cast_failed',
  'spell_impact',
  'spell_kill',
  'sigil_dropped',
  'sigil_acquired',
  'sigil_attached',
  'sigil_detached',
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
events.on('cast_spell', () => audio.play('cast_fire'));
events.on('spell_impact', () => audio.play('spell_impact'));
events.on('sigil_acquired', () => audio.play('pickup'));
events.on('cast_failed', (payload) => {
  audio.play('cast_fizzle');
  const info = payload as { reason: string; cost?: number; current?: number };
  showReaction(
    info.reason === 'no_mana'
      ? `마나 부족 — ${info.cost} 필요 (패링·처형으로 모아야 한다)`
      : '오른팔에 각인이 없다 — Tab으로 부착',
    2000,
  );
});

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
function showReaction(text: string, durationMs = 1000): void {
  reactionLabel = text;
  reactionLabelUntil = performance.now() + durationMs;
}
events.on('parry_attempt', (payload) => {
  const result = (payload as { result: string }).result;
  showReaction(result === 'perfect' ? '완벽 패링!' : result === 'normal' ? '패링' : '실패 — 경직');
});
events.on('melee_kill', () => showReaction('처형'));
events.on('dodge_step', () => showReaction('회피'));
events.on('sigil_acquired', (payload) => {
  const id = (payload as { id: string }).id;
  showReaction(`각인 획득: ${sigilDef(id).name} — Tab으로 부착`, 3500);
});

events.on('player_died', () => deathOverlay.classList.add('visible'));

events.on('shot_fired', (payload) => {
  const shot = payload as { ex: number; ey: number; ez: number; hitEnemy: boolean };
  stage.spawnTracer(shot.ex, shot.ey, shot.ez);
  stage.triggerRecoil();
  audio.play('gunshot');
  audio.play(shot.hitEnemy ? 'hit_flesh' : 'hit_wall');
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

// 틱 순서: Input → PlayerMove → Enemies → Reaction → Weapons → Projectiles → Mana →
// Lantern (docs/architecture.md §2). Reaction이 Enemies 뒤에 오는 이유: 적의 공격
// 상태가 확정된 뒤 판정해야 한다.
Mana.init(world);
Sigils.init(world);
const systems = [
  PlayerMove.tick,
  Enemies.tick,
  Reaction.tick,
  Sigils.tick,
  Weapons.tick,
  Projectiles.tick,
  Mana.tick,
  Lantern.tick,
];

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

  if (!world.dead && !world.uiOpen) {
    for (const system of systems) system(world, dt);
  }
  world.tick++;
  tpsWindowTicks++;
}

function spellHudText(): string {
  const id = world.sigils.equipped.rightArm;
  if (!id) return '(오른팔 각인 없음)';
  const def = sigilDef(id);
  const cost = balance.spellCost[def.tier as keyof typeof balance.spellCost] ?? 0;
  let suffix = '';
  if (world.spell.cooldown > 0) suffix = ' [쿨]';
  else if (world.mana.value < cost) suffix = ' [마나 부족]';
  return `${def.name} ${cost}마나${suffix}`;
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
  stage.setLanternIntensityMul(world.modifiers.lanternIntensityMul);
  stage.setAmbientBoost(world.modifiers.ambientVisionBoost);
  stage.setMuzzleFlash(world.weapon.muzzleFlash > 0);
  stage.syncEnemies(world.enemies, alpha);
  stage.syncProjectiles(world.projectiles, alpha);
  stage.syncGroundItems(world.groundItems);
  stage.updateHands({ reloading: world.weapon.reloading > 0, stunned: p.stunTicks > 0 });
  minimap.update(p, world.enemies, alpha);

  const w = world.weapon;
  const aliveCount = world.enemies.filter((e) => e.alive).length;
  if (performance.now() > reactionLabelUntil) reactionLabel = '';
  const mana = world.mana;
  const chainMult = balance.chain.multipliers[Math.min(mana.chainIndex, balance.chain.multipliers.length - 1)]!;
  const manaBar = '█'.repeat(Math.round((mana.value / balance.mana.max) * 20)).padEnd(20, '░');
  hud!.textContent =
    `tick ${world.tick}  (${measuredTps.toFixed(1)}/s)\n` +
    `HP ${p.health}   9mm ${w.mag}/${w.reserve}${w.reloading > 0 ? '  [장전중]' : ''}${p.stunTicks > 0 ? '  [경직]' : ''}\n` +
    `mana ${manaBar} ${mana.value.toFixed(0)}/${balance.mana.max}  chain ×${chainMult}${!mana.inCombat && mana.outOfCombatTicks >= balance.mana.combatExitTicks && mana.value > 0 ? '  [휘발중]' : ''}\n` +
    `spell ${spellHudText()}   각인 ${world.sigils.inventory.length}개 소지\n` +
    `lantern ${world.lantern.on ? 'ON ' : 'OFF'}  battery ${world.lantern.battery.toFixed(0)}%  spares ${world.lantern.spares}\n` +
    `enemies ${aliveCount}${reactionLabel ? `   ${reactionLabel}` : ''}\n` +
    (input.pointerLocked ? '' : '[클릭] 마우스 잠금\n') +
    'WASD 이동  Shift 질주  좌클릭 발사  우클릭 반응(패링/회피)\n' +
    'Q 마법 시전  Tab 각인  R 장전  F 랜턴  B 배터리  M 미니맵  P 연습용 창병  O 마나 충전(테스트)';

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
