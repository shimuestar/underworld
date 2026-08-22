import { GameAudio } from './core/Audio';
import { balance } from './core/Balance';
import { Events } from './core/Events';
import { Metrics } from './core/Metrics';
import { DebugOverlay } from './render/DebugOverlay';
import { Input } from './core/Input';
import { Loop } from './core/Loop';
import { World } from './core/World';
import * as Reaction from './systems/Reaction';
import { Level, buildLevelGroup } from './level/GridLoader';
import { spawnEnemies, spawnEnemyAt } from './level/Spawner';
import { Minimap } from './render/Minimap';
import { Stage } from './render/Stage';
import { grenadeThrowSpeed } from './systems/Weapons';
import * as PlayerMove from './systems/PlayerMove';
import * as Enemies from './systems/Enemies';
import * as Weapons from './systems/Weapons';
import * as Projectiles from './systems/Projectiles';
import * as Mana from './systems/Mana';
import * as Sigils from './systems/Sigils';
import * as Corruption from './systems/Corruption';
import * as Altar from './systems/Altar';
import * as Exit from './systems/Exit';
import * as Lever from './systems/Lever';
import * as Lantern from './systems/Lantern';
import { enemyDef } from './core/Entities';
import { SigilUI } from './render/SigilUI';
import { sigilDef } from './core/SigilData';
import levelJson from '../data/levels/z01_f1.json';

const app = document.getElementById('app');
const hud = document.getElementById('hud');
const deathOverlay = document.getElementById('death');
const deathHint = document.getElementById('death-hint');
const flashOverlay = document.getElementById('flash');
const hurtOverlay = document.getElementById('hurt');
const altarPrompt = document.getElementById('altar-prompt');
if (!app || !hud || !deathOverlay || !deathHint || !flashOverlay || !hurtOverlay || !altarPrompt)
  throw new Error('index.html에 필요한 오버레이 요소가 없다');

const events = new Events();
const metrics = new Metrics(events); // 다른 구독보다 먼저 — 이벤트만 구독한다
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
    blocking: false,
    reactionHeldTicks: 0,
  },
  lantern: {
    on: true,
    battery: balance.lantern.batteryMax,
    spares: balance.lantern.spareCells,
  },
  weapon: {
    active: 'pistol',
    mag: balance.weapons.pistol.magSize,
    reserve: balance.weapons.pistol.ammoMax,
    cooldown: 0,
    reloading: 0,
    muzzleFlash: 0,
    grenades: balance.weapons.grenade.startCount,
    meleeCooldown: 0,
    grenadeCharge: 0,
  },
  mana: { value: 0, chainIndex: 0, outOfCombatTicks: 0, inCombat: false },
  sigils: {
    inventory: [],
    equipped: { eye: null, rightArm: null, leftArm: null, heart: null, spine: null },
    scars: { eye: 0, rightArm: 0, leftArm: 0, heart: 0, spine: 0 },
  },
  modifiers: Sigils.defaultModifiers(),
  corruption: { applied: 0, pending: 0 },
  enemies: spawnEnemies(levelJson.entities, level),
  level,
});

const stage = new Stage(app);
const minimap = new Minimap(level);
const debugOverlay = new DebugOverlay();

function downloadMetrics(): void {
  const data = JSON.stringify(metrics.snapshot(world), null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `underworld-metrics-${Date.now()}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

window.addEventListener('keydown', (e) => {
  if (e.code === 'F1') {
    e.preventDefault();
    debugOverlay.toggle();
  }
  if (e.code === 'F2') {
    e.preventDefault();
    downloadMetrics();
    console.log('[metrics] 덤프 다운로드', metrics.snapshot(world));
  }
});

// 세션 경계에서 콘솔에 스냅샷 자동 출력
events.on('player_died', () => console.log('[metrics] 사망 시점 스냅샷', metrics.snapshot(world)));
events.on('zone_cleared', () => console.log('[metrics] 클리어 스냅샷', metrics.snapshot(world)));
const sigilUI = new SigilUI(world);
window.addEventListener('keydown', (e) => {
  if (e.code === 'Tab') {
    e.preventDefault();
    world.uiOpen = sigilUI.toggle();
    if (world.uiOpen) document.exitPointerLock();
  }
});
let restartConfirmUntil = 0;

window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyM') minimap.toggle();
  // F3 두 번 — 중간 다시 하기 (제단 등록 시 제단에서, 아니면 처음부터)
  if (e.code === 'F3') {
    e.preventDefault();
    if (performance.now() < restartConfirmUntil) {
      if (world.respawn) {
        world.dead = false;
        respawnAtAltar();
      } else {
        location.reload();
      }
    } else {
      restartConfirmUntil = performance.now() + 2000;
      showReaction(
        world.respawn ? 'F3 한 번 더 — 제단에서 다시 시작' : 'F3 한 번 더 — 처음부터 다시 시작',
        2000,
      );
    }
  }
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
  'enemy_died',
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
  'weapon_switched',
  'hammer_swing',
  'melee_hit',
  'grenade_thrown',
  'explosion',
  'crack_wall_broken',
  'mana_gained',
  'mana_lost',
  'combat_entered',
  'combat_exited',
  'cast_spell',
  'cast_failed',
  'spell_impact',
  'spell_kill',
  'friendly_fire_kill',
  'sigil_dropped',
  'sigil_acquired',
  'sigil_attached',
  'sigil_detached',
  'altar_entered',
  'altar_bypassed',
  'respawn_registered',
  'respawned',
  'corruption_applied',
  'corruption_threshold',
  'enemy_cast',
  'enemy_repositioning',
  'deflect',
  'barrier_blocked',
  'armor_hit',
  'boss_phase',
  'boss_staggered',
  'boss_execute',
  'exit_locked',
  'zone_cleared',
  'lever_pulled',
]) {
  events.on(name, (payload) => console.log(`[events] ${name}`, payload));
}

// ---- 오디오 (합성음, 에셋 없음) ----
const audio = new GameAudio();
app.addEventListener('click', () => audio.unlock());
events.on('enemy_windup', (payload) => {
  const telegraph = (payload as { telegraph?: string }).telegraph;
  audio.play(
    telegraph === 'red'
      ? 'telegraph_red'
      : telegraph === 'purple'
        ? 'telegraph_purple'
        : 'telegraph_blue',
  );
});
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
events.on('enemy_cast', (payload) => {
  if ((payload as { enemyType: string }).enemyType === 'goblin_archer') audio.play('bow_twang');
});
events.on('headshot', () => {
  audio.play('headshot');
  showReaction('헤드샷!', 700);
});

events.on('block_hit', (payload) => {
  audio.play('block_hit');
  stage.triggerBlockHit((payload as { kind?: string }).kind);
});

// ---- 무기 3종 (1 해머 / 2 수류탄 / 3 권총) ----
events.on('weapon_switched', (payload) => {
  const kind = (payload as { weapon: 'hammer' | 'grenade' | 'pistol' }).weapon;
  audio.play('weapon_switch');
  stage.setHandWeapon(kind);
});
events.on('hammer_swing', () => {
  audio.play('hammer_swing');
  stage.triggerHammerSwing();
});
events.on('melee_hit', () => audio.play('melee_hit'));
events.on('grenade_thrown', () => {
  audio.play('grenade_throw');
  stage.triggerGrenadeThrow();
});
events.on('explosion', (payload) => {
  const info = payload as { x: number; y: number; z: number; radius: number };
  audio.play('explosion');
  stage.spawnExplosion(info.x, info.y, info.z, info.radius);
});
events.on('crack_wall_broken', (payload) => {
  const cell = payload as { row: number; col: number };
  stage.breakCrack(cell.row, cell.col);
  minimap.rebuildBase();
  showReaction('균열 벽이 무너져 내렸다!', 3000);
});

// ---- 피격 연출 — 붉은 비네트 + 피격음 (방어 성공 시엔 방어음만) ----
events.on('player_damaged', (payload) => {
  if ((payload as { blocked?: boolean }).blocked) return;
  audio.play('player_hurt');
  hurtOverlay!.style.transition = 'none';
  hurtOverlay!.style.opacity = '1';
  requestAnimationFrame(() => {
    hurtOverlay!.style.transition = 'opacity 450ms ease-out';
    hurtOverlay!.style.opacity = '0';
  });
});
events.on('spell_impact', () => audio.play('spell_impact'));
events.on('sigil_acquired', () => audio.play('pickup'));
events.on('reload_started', () => audio.play('reload_start'));
events.on('reload_finished', () => audio.play('reload_end'));
events.on('enemy_died', (payload) => {
  const dead = payload as { enemyType: string; x: number; z: number };
  audio.play('enemy_death');
  stage.spawnDeathBurst(dead.x, dead.z, dead.enemyType);
});
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

events.on('player_died', () => {
  deathHint!.textContent = world.respawn ? 'Enter — 제단에서 부활' : 'Enter 키로 재시작';
  deathOverlay.classList.add('visible');
});

/** 제단 리스폰 — 위치·체력 복원, 탄약 상한, 마나 0, 각인·오염 유지, 구간 진행도 초기화 */
function respawnAtAltar(): void {
  const p = world.player;
  const point = world.respawn!;
  p.x = point.x;
  p.z = point.z;
  p.prevX = point.x;
  p.prevZ = point.z;
  p.health = balance.player.healthMax;
  p.stunTicks = 0;
  p.dodgeTicks = 0;
  p.iframeTicks = 0;
  p.reactionBufferTicks = 0;
  world.weapon.mag = balance.weapons.pistol.magSize;
  world.weapon.reserve = balance.weapons.pistol.ammoMax;
  world.weapon.cooldown = 0;
  world.weapon.reloading = 0;
  world.weapon.muzzleFlash = 0;
  world.weapon.grenades = balance.weapons.grenade.ammoMax; // 보급 상한
  world.weapon.meleeCooldown = 0;
  world.mana.value = 0;
  world.mana.chainIndex = 0;
  world.mana.outOfCombatTicks = 0;
  world.mana.inCombat = false;
  world.enemies = spawnEnemies(levelJson.entities, level); // 구간 진행도 초기화
  world.projectiles.length = 0;
  world.groundItems.length = 0;
  world.freezeTicks = 0;
  world.dead = false;
  deathOverlay!.classList.remove('visible');
  events.emit('respawned', { x: point.x, z: point.z });
}

events.on('shot_fired', (payload) => {
  const shot = payload as {
    ex: number; ey: number; ez: number; hitEnemy: boolean; blocked?: boolean;
  };
  stage.spawnTracer(shot.ex, shot.ey, shot.ez);
  stage.triggerRecoil();
  audio.play('gunshot');
  // 방패에 막힌 샷은 shot_blocked의 금속 클랭이 담당 — 벽 착탄음으로 덮지 않는다
  if (!shot.blocked) audio.play(shot.hitEnemy ? 'hit_flesh' : 'hit_wall');
  // 벽 착탄 탄흔
  if (!shot.blocked && !shot.hitEnemy) stage.spawnBulletMark(shot.ex, shot.ey, shot.ez);
});
events.on('arrow_stuck', (payload) => {
  const a = payload as { x: number; y: number; z: number; dx: number; dy: number; dz: number };
  stage.spawnStuckArrow(a.x, a.y, a.z, a.dx, a.dy, a.dz);
});
events.on('parry_attempt', (payload) => {
  stage.triggerParry((payload as { result: string }).result);
});
events.on('dodge_step', () => stage.triggerParry('normal'));
events.on('shot_blocked', (payload) => {
  stage.flashShield((payload as { enemyId: number }).enemyId);
});
window.addEventListener('keydown', (e) => {
  if (e.code === 'Enter' && world.dead) {
    if (world.respawn) respawnAtAltar();
    else location.reload();
  }
});

// ---- 제단 ----
events.on('altar_entered', (payload) => {
  const info = payload as { multiplier: number; pendingCorruption: number };
  audio.play('altar_enter');
  showReaction(
    `제단 — 탄약 상한 보급 (배율 ×${info.multiplier.toFixed(2)})`,
    3000,
  );
  sigilUI.show(true); // 각인 교체 UI (제단 모드: 해제 가능)
  world.uiOpen = true;
  document.exitPointerLock();
});
events.on('corruption_applied', (payload) => {
  const info = payload as { from: number; to: number };
  showReaction(`오염 정산: ${info.from} → ${info.to}`, 3000);
});
// ---- M7: 상성·보스 피드백 ----
events.on('deflect', () => {
  audio.play('deflect');
  showReaction('반사!');
});
events.on('barrier_blocked', (payload) => {
  const info = payload as { enemyId: number; kind: string };
  audio.play('barrier_blocked');
  stage.flashBarrier(info.enemyId);
  showReaction(info.kind === 'armor' ? '장갑 — 실탄만 통한다' : '방어막 — 9mm만 뚫는다');
});
events.on('shot_blocked', () => showReaction('방패 — 정면은 막힌다'));
events.on('boss_staggered', () => showReaction('보스 스태거 — 지금 처형 타격!'));
events.on('boss_phase', (payload) => {
  const phase = (payload as { phase: string }).phase;
  audio.play('boss_phase');
  showReaction(phase === 'armored' ? '장갑 페이즈 — 실탄으로 파괴하라' : '장갑 파괴 — 패링 구간', 3000);
});
events.on('exit_locked', () => showReaction('출구가 봉인되어 있다 — 족장이 살아 있다', 3000));
events.on('lever_pulled', (payload) => {
  const info = payload as { lever: { row: number; col: number }; door: { row: number; col: number } };
  audio.play('lever_pull');
  stage.pullLever(info.lever.row, info.lever.col);
  stage.openDoor(info.door.row, info.door.col);
  minimap.rebuildBase();
  showReaction('어딘가에서 돌 문이 갈리며 열렸다', 3500);
});
events.on('zone_cleared', () => {
  audio.play('zone_clear');
  deathHint!.textContent = '';
  const clearOverlay = deathOverlay!;
  clearOverlay.querySelector('div')!.textContent = '1구역 클리어';
  (clearOverlay as HTMLElement).style.background = 'rgba(10, 40, 20, 0.6)';
  clearOverlay.classList.add('visible');
});

events.on('corruption_threshold', (payload) => {
  const threshold = (payload as { threshold: number }).threshold;
  audio.play('corruption_up');
  if (threshold === 25) {
    stage.setGlyphsReadable(true);
    showReaction('벽의 문자가 읽히기 시작한다…', 5000);
  } else {
    showReaction(`오염 임계 ${threshold} 도달`, 4000);
  }
});

// 틱 순서: Input → PlayerMove → Enemies → Reaction → Weapons → Projectiles → Mana →
// Lantern (docs/architecture.md §2). Reaction이 Enemies 뒤에 오는 이유: 적의 공격
// 상태가 확정된 뒤 판정해야 한다.
Mana.init(world);
Sigils.init(world);
Corruption.init(world);
Altar.init(world);
const systems = [
  PlayerMove.tick,
  Enemies.tick,
  Reaction.tick,
  Sigils.tick,
  Weapons.tick,
  Projectiles.tick,
  Mana.tick,
  Altar.tick,
  Lever.tick,
  Exit.tick,
  Lantern.tick,
];

function simulate(dt: number): void {
  world.input = input.sample();

  // 히트스톱 — simulate를 건너뛰되 반응 입력(릴리즈)은 버퍼에 보관 (docs/architecture.md §1)
  if (world.freezeTicks > 0) {
    world.freezeTicks--;
    if (world.input.reactionReleased) {
      world.player.reactionBufferTicks = balance.reaction.inputBufferTicks;
    }
    world.tick++;
    tpsWindowTicks++;
    return;
  }

  if (!world.dead && !world.uiOpen && !world.cleared) {
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

let debugOverlayLastUpdate = 0;

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
  // 배터리 임박 경고 — 잔여 flickerWarnSec부터 깜빡임. 처음엔 드물게(1~2회),
  // 방전에 가까워질수록 빠르게 가속하다 꺼진다
  let lanternVisible = world.lantern.on;
  if (lanternVisible) {
    const warnBattery =
      balance.lantern.drainPerTick * balance.lantern.flickerWarnSec * balance.loop.tickRate;
    if (world.lantern.battery <= warnBattery) {
      const dyingProgress = 1 - world.lantern.battery / warnBattery; // 0 → 1
      const blinkFreq = 0.75 + 6 * Math.pow(Math.max(0, (dyingProgress - 0.35) / 0.65), 1.6);
      lanternVisible = ((now / 1000) * blinkFreq) % 1 > 0.22; // 22% 꺼짐 듀티
    }
  }
  stage.setLanternOn(lanternVisible);
  stage.setLanternIntensityMul(world.modifiers.lanternIntensityMul);
  stage.setAmbientBoost(world.modifiers.ambientVisionBoost);
  stage.setMuzzleFlash(world.weapon.muzzleFlash > 0);
  stage.syncEnemies(world.enemies, alpha);
  stage.syncProjectiles(world.projectiles, alpha);
  stage.syncGroundItems(world.groundItems);
  const chargeFrac =
    world.weapon.active === 'grenade' && world.weapon.grenadeCharge > 0
      ? world.weapon.grenadeCharge / balance.weapons.grenade.maxChargeTicks
      : 0;
  stage.updateHands({
    reloading: world.weapon.reloading > 0,
    stunned: p.stunTicks > 0,
    blocking: p.blocking,
    chargeFrac,
  });

  // 수류탄 차징 궤적 미리보기 — 실제 투척 물리와 동일한 시뮬레이션
  if (chargeFrac > 0) {
    const grenade = balance.weapons.grenade;
    const speed = grenadeThrowSpeed(chargeFrac);
    const cosPitch = Math.cos(p.pitch);
    let sx = p.x;
    let sy = p.y + balance.player.eyeHeight;
    let sz = p.z;
    let vx = -Math.sin(p.yaw) * cosPitch * speed;
    let vy = Math.sin(p.pitch) * speed + grenade.throwUpBias;
    let vz = -Math.cos(p.yaw) * cosPitch * speed;
    const step = 2 / 60; // 2틱 간격 샘플
    const points: { x: number; y: number; z: number }[] = [];
    for (let i = 0; i < 40; i++) {
      vy -= grenade.gravity * step;
      sx += vx * step;
      sy += vy * step;
      sz += vz * step;
      if (sy <= 0.05) break;
      const cs = world.level.cellSize;
      if (world.level.solidAt(Math.floor(sx / cs), Math.floor(sz / cs))) break;
      points.push({ x: sx, y: sy, z: sz });
    }
    stage.updateThrowArc(points);
  } else {
    stage.updateThrowArc(null);
  }
  stage.setCorruptionStage(Math.floor(world.corruption.applied / 12.5));
  minimap.update(p, world.enemies, alpha);

  // 하단 중앙 상태 표시 — HP 바 + 무기 슬롯
  const wpn = world.weapon;
  const hpFrac = Math.max(0, p.health) / balance.player.healthMax;
  const hpFill = document.getElementById('status-hp-fill')!;
  hpFill.style.width = `${hpFrac * 100}%`;
  hpFill.style.background = hpFrac > 0.5 ? '#3fae5a' : hpFrac > 0.25 ? '#c9a227' : '#e04444';
  document.getElementById('slot-hammer')!.className =
    `weapon-slot${wpn.active === 'hammer' ? ' active' : ''}`;
  document.getElementById('slot-grenade')!.className =
    `weapon-slot${wpn.active === 'grenade' ? ' active' : ''}`;
  document.getElementById('slot-pistol')!.className =
    `weapon-slot${wpn.active === 'pistol' ? ' active' : ''}`;
  document.getElementById('slot-grenade')!.textContent = `2 수류탄 ×${wpn.grenades}`;
  document.getElementById('slot-pistol')!.textContent =
    `3 권총 ${wpn.mag}/${wpn.reserve}${wpn.reloading > 0 ? ' …' : ''}`;

  // 디버그 오버레이 (F1) — 0.5초마다 갱신
  if (debugOverlay.visible && now - debugOverlayLastUpdate > 500) {
    debugOverlayLastUpdate = now;
    debugOverlay.update(metrics.snapshot(world));
  }

  // 제단/레버 프롬프트 — 상호작용 가능한 것 안내
  const nearLever = world.level.levers.some((lever) => {
    const [row, col] = lever.cell;
    if (row === undefined || col === undefined) return false;
    if (world.pulledLevers.has(`${row}-${col}`)) return false;
    const cs = world.level.cellSize;
    return (
      Math.hypot(p.x - (col + 0.5) * cs, p.z - (row + 0.5) * cs) <=
      balance.interaction.leverRadius
    );
  });
  const showAltarPrompt =
    world.nearAltar && !world.altarEnteredThisApproach && !world.uiOpen && !world.dead;
  altarPrompt!.classList.toggle('visible', showAltarPrompt || (nearLever && !world.dead));
  if (showAltarPrompt) {
    const w2 = world.weapon;
    const capNow = balance.weapons.pistol.magSize + balance.weapons.pistol.ammoMax;
    altarPrompt!.textContent =
      `제단 — E 진입\n` +
      `9mm ${w2.mag + w2.reserve}/${capNow} 보유 중 · 들어가면 상한까지 재보급 (잔탄 무관)\n` +
      `오염 +${world.corruption.pending} 정산 · 리스폰 지점 등록`;
  } else if (nearLever) {
    altarPrompt!.textContent = 'E — 레버를 당긴다';
  }

  const w = world.weapon;
  const aliveCount = world.enemies.filter((e) => e.alive).length;
  if (performance.now() > reactionLabelUntil) reactionLabel = '';

  // 보스 체력 바 (어그로 상태일 때만)
  const boss = world.enemies.find((e) => e.alive && enemyDef(e.type).boss && e.ai !== 'idle');
  let bossLine = '';
  if (boss) {
    const def = enemyDef(boss.type);
    const frac = Math.max(0, boss.health / def.health);
    const bar = '█'.repeat(Math.round(frac * 24)).padEnd(24, '░');
    const phaseLabel =
      boss.phase === 'armored'
        ? `장갑 ${Math.max(0, boss.armorHealth ?? 0)}`
        : `패링 ${boss.parryStreak ?? 0}/${def.parriesToStagger}`;
    bossLine = `족장 ${bar} ${Math.max(0, Math.round(boss.health))}/${def.health}  [${phaseLabel}]\n`;
  }
  const mana = world.mana;
  const chainMult = balance.chain.multipliers[Math.min(mana.chainIndex, balance.chain.multipliers.length - 1)]!;
  const manaBar = '█'.repeat(Math.round((mana.value / balance.mana.max) * 20)).padEnd(20, '░');
  hud!.textContent =
    `tick ${world.tick}  (${measuredTps.toFixed(1)}/s)\n` +
    `HP ${Math.max(0, Math.round(p.health))}   9mm ${w.mag}/${w.reserve}${w.reloading > 0 ? '  [장전중]' : ''}${p.stunTicks > 0 ? '  [경직]' : ''}${p.blocking ? '  [방어]' : ''}\n` +
    `mana ${manaBar} ${mana.value.toFixed(0)}/${balance.mana.max}  chain ×${chainMult}${!mana.inCombat && mana.outOfCombatTicks >= balance.mana.combatExitTicks && mana.value > 0 ? '  [휘발중]' : ''}\n` +
    `spell ${spellHudText()}   각인 ${world.sigils.inventory.length}개 소지\n` +
    `corruption ${world.corruption.applied}${world.corruption.pending > 0 ? ` (+${world.corruption.pending} 대기)` : ''}/100${world.canReadGlyphs ? '  [해독]' : ''}${world.altarBonusMul > 1 ? `  탄약 배율 ×${world.altarBonusMul.toFixed(2)}` : ''}\n` +
    `lantern ${world.lantern.on ? 'ON ' : 'OFF'}  battery ${world.lantern.battery.toFixed(0)}%  spares ${world.lantern.spares}\n` +
    bossLine +
    `enemies ${aliveCount}${reactionLabel ? `   ${reactionLabel}` : ''}\n` +
    (input.pointerLocked ? '' : '[클릭] 마우스 잠금\n') +
    'WASD 이동  Shift 질주  좌클릭 공격  우클릭 짧게=패링(뗄 때)·꾹=방어  Shift+우클릭 회피  1/2/3 무기\n' +
    'Q 마법  Tab 각인  R 장전  F 랜턴  B 배터리  M 미니맵  F1 지표  F2 덤프  F3 다시하기  P/O 테스트';

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
