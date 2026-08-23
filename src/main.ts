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
import { spawnBarrels, spawnChests, spawnEnemies, spawnEnemyAt } from './level/Spawner';
import { Minimap } from './render/Minimap';
import { Stage } from './render/Stage';
import { grenadeThrowSpeed } from './systems/Weapons';
import * as PlayerMove from './systems/PlayerMove';
import * as Enemies from './systems/Enemies';
import * as Weapons from './systems/Weapons';
import * as Projectiles from './systems/Projectiles';
import * as Mana from './systems/Mana';
import * as Pickups from './systems/Pickups';
import * as Progression from './systems/Progression';
import * as Sigils from './systems/Sigils';
import * as Stamina from './systems/Stamina';
import * as Corruption from './systems/Corruption';
import * as Altar from './systems/Altar';
import * as Barrels from './systems/Barrels';
import * as Chest from './systems/Chest';
import * as Exit from './systems/Exit';
import * as Lever from './systems/Lever';
import * as Lantern from './systems/Lantern';
import { enemyDef, healthBarState } from './core/Entities';
import { ShopUI } from './render/ShopUI';
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
    melee: 'hammer',
    ranged: 'pistol',
    mag: balance.weapons.pistol.magSize,
    reserve: balance.weapons.pistol.ammoMax,
    cooldown: 0,
    reloading: 0,
    muzzleFlash: 0,
    grenades: balance.weapons.grenade.startCount,
    meleeCooldown: 0,
    grenadeCharge: 0,
    comboStep: 0,
    comboTimer: 0,
    swingImpact: 0,
    swingHeavy: false,
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
  barrels: spawnBarrels(levelJson.entities, level),
  chests: spawnChests(levelJson.entities, level),
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
const shopUI = new ShopUI(world);
/** UI 오버레이 열기/닫기 — 닫을 때 포인터 락을 바로 되찾는다.
 *  안 그러면 메뉴를 나온 뒤 커서가 남아 화면을 한 번 클릭해야 조작이 돌아온다 */
function setUiOpen(open: boolean): void {
  world.uiOpen = open;
  if (open) document.exitPointerLock();
  else input.requestLock();
}
shopUI.onClose = () => setUiOpen(false);
window.addEventListener('keydown', (e) => {
  if (e.code === 'Tab') {
    e.preventDefault();
    // 상점에서 Tab — 각인 교체로 넘어간다 (둘이 겹쳐 뜨지 않게)
    if (shopUI.open) {
      shopUI.hide();
      setUiOpen(sigilUI.toggle(true));
      return;
    }
    setUiOpen(sigilUI.toggle());
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
  // 테스트용 무적 토글 — HP·마나·탄약·배터리·스태미너가 줄지 않는다 (슬라이스 검증 시 제거)
  if (e.code === 'KeyG') {
    world.godMode = !world.godMode;
    showReaction(world.godMode ? '(테스트) 무적 ON' : '(테스트) 무적 OFF', 1400);
    console.log('[debug] 무적', world.godMode);
  }
  // 테스트용 시야 내 몰살 — 진행 속도를 위한 편의 (슬라이스 검증 시 제거).
  // 화면에 들어와 있고 벽에 가리지 않은 적만 죽인다
  if (e.code === 'KeyK' && !world.dead && !world.uiOpen) {
    const p = world.player;
    let killed = 0;
    for (const enemy of world.enemies) {
      if (!enemy.alive) continue;
      const def = enemyDef(enemy.type);
      if (!stage.isInView(enemy.x, def.height * 0.5, enemy.z, def.radius)) continue;
      if (!level.hasLineOfSight(p.x, p.z, enemy.x, enemy.z)) continue; // 벽 너머는 제외
      enemy.alive = false;
      killed++;
      // enemy_died 만 발행한다 — 드랍·경험치·파편은 돌리되 무기 명중률 통계는 더럽히지 않게
      events.emit('enemy_died', { enemyType: enemy.type, x: enemy.x, z: enemy.z });
    }
    showReaction(killed > 0 ? `(테스트) 시야 내 ${killed}마리 처치` : '(테스트) 시야에 적 없음');
    console.log('[debug] 시야 내 몰살', killed);
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
  'web_caught',
  'web_torn',
  'web_broken',
  'stamina_empty',
  'stamina_recovered',
  'stamina_blocked',
  'weapon_kill',
  'enemy_died',
  'enemy_damaged',
  'enemy_alerted',
  'enemy_windup',
  'enemy_whiffed',
  'enemy_charge',
  'ground_slam',
  'enemy_volley_start',
  'enemy_volley_shot',
  'guard_clash',
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
  'grenade_bounce',
  'barrel_hit',
  'barrel_exploded',
  'projectile_broken',
  'chest_opened',
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
  'potion_dropped',
  'potion_picked',
  'mana_potion_dropped',
  'mana_potion_picked',
  'food_dropped',
  'food_picked',
  'gold_dropped',
  'gold_picked',
  'xp_gained',
  'sigil_acquired',
  'sigil_attached',
  'sigil_detached',
  'altar_entered',
  'altar_bypassed',
  'shop_purchased',
  'shop_denied',
  'respawn_registered',
  'respawned',
  'corruption_applied',
  'corruption_threshold',
  'enemy_cast',
  'enemy_repositioning',
  'deflect',
  'barrier_blocked',
  'barrier_cracked',
  'barrier_broken',
  'shield_broken',
  'stagger_fling',
  'shield_cracked',
  'shield_braced',
  'shield_bash_start',
  'boss_staggered',
  'boss_execute',
  'exit_locked',
  'exit_opened',
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
// 보스는 boss_execute(타격) 후 치명타면 melee_kill 도 같은 틱에 온다 — 연출 1회만
let executePresentedTick = -1;
// 연출 지연 큐 — 처형처럼 "동작이 닿는 순간"에 맞춰야 하는 효과를 담는다.
// 로직이 아니라 화면용이므로 render 루프의 벽시계로 돈다 (HandModel과 동일 기준)
const delayedFx: { at: number; run: () => void }[] = [];
function afterMs(ms: number, run: () => void): void {
  delayedFx.push({ at: performance.now() + ms, run });
}
function runDelayedFx(now: number): void {
  for (let i = delayedFx.length - 1; i >= 0; i--) {
    if (now < delayedFx[i]!.at) continue;
    const fx = delayedFx.splice(i, 1)[0]!;
    fx.run();
  }
}

/** 처형 연출 — 해머가 닿는 순간에 소리·섬광·카메라 킥을 몰아준다.
 *  즉발로 터뜨리면 아직 치켜든 상태에서 적이 터져 동작과 어긋난다 */
let executeContactMs = 0;
function presentExecute(power: number, x?: number, z?: number): void {
  if (executePresentedTick === world.tick) return;
  executePresentedTick = world.tick;
  executeContactMs = stage.triggerExecuteFinisher(); // 방패가 아니라 해머로 끝낸다
  afterMs(executeContactMs, () => {
    audio.play('execute');
    stage.triggerCameraKick(power);
    if (x !== undefined && z !== undefined) stage.triggerExecuteFlash(x, z);
  });
}
events.on('boss_execute', () => presentExecute(1.15));
events.on('melee_kill', (payload) => {
  // 처형(방패 강타)만 전용 연출 — 해머 처치는 자체 타격음이 이미 난다
  const kill = payload as { execution: boolean; x?: number; z?: number };
  if (kill.execution) presentExecute(1, kill.x, kill.z);
});
// 불발 — 소리·모션은 누를 때마다, 글자 안내만 연타에도 한 번씩
let emptyHintUntil = 0;
events.on('weapon_empty', (payload) => {
  const info = payload as { weapon?: string };
  audio.play('dry_fire');
  stage.triggerDryFire();
  const now = performance.now();
  if (now < emptyHintUntil) return;
  emptyHintUntil = now + 1200;
  showReaction(
    info.weapon === 'grenade' ? '수류탄 없음' : '탄약 없음 — 제단에서 사야 한다',
    1100,
  );
});
events.on('web_caught', (payload) => {
  const info = payload as { swings: number };
  audio.play('web_hit');
  showReaction(`거미줄에 걸렸다 — 해머로 ${info.swings}번 걷어내라`, 2400);
});
events.on('web_torn', (payload) => {
  const info = payload as { left: number; total: number };
  if (info.left <= 0) return; // 마지막 한 겹은 web_broken 이 맡는다
  audio.play('web_tear');
  stage.spawnWebTear();
  stage.triggerCameraKick(0.35, 180);
  showReaction(`거미줄 — ${info.total - info.left}/${info.total}`, 700);
});
events.on('web_broken', () => {
  audio.play('web_break');
  stage.spawnWebTear();
  stage.triggerCameraKick(0.5, 220);
  showReaction('거미줄을 걷어냈다', 900);
});
events.on('stamina_empty', () => {
  audio.play('stamina_empty');
  showReaction('숨이 찼다 — 질주 불가', 1200);
});
events.on('stamina_blocked', () => {
  audio.play('stamina_empty');
  showReaction('스태미너 부족 — 회피 불가', 1000);
});
events.on('shot_blocked', () => audio.play('shot_blocked'));
events.on('dodge_step', () => audio.play('dodge'));
events.on('cast_spell', () => audio.play('cast_fire'));
events.on('enemy_cast', (payload) => {
  const info = payload as { enemyType: string; enemyId: number };
  if (info.enemyType === 'goblin_archer') audio.play('bow_twang');
  // 족장 화살 세례 — 발사할 때마다 시위 소리 (바위 투척과 구분)
  const boss = world.enemies.find((e) => e.id === info.enemyId);
  if (boss?.ai === 'volley') audio.play('bow_twang');
});
// 보스가 처음 알아채는 순간 — 포효로 조우를 알린다
// 랜턴에 들킨 첫 순간만 알려 준다 — 한 마리씩 깰 때마다 뜨면 잔소리가 된다
let lanternSpottedUntil = 0;
events.on('enemy_alerted', (payload) => {
  const info = payload as { enemyType: string; lantern?: boolean };
  if (info.lantern && performance.now() > lanternSpottedUntil) {
    lanternSpottedUntil = performance.now() + 4000;
    showReaction('랜턴 불빛에 들켰다', 1400);
  }
  if (!enemyDef(info.enemyType).boss) return;
  audio.play('boss_roar');
  stage.triggerCameraKick(0.7, 420);
  showReaction(`${enemyDef(info.enemyType).name ?? '보스'}가 포효한다`, 2500);
});
// 지면 강타 — 맞든 안 맞든 땅이 울린다. 가까울수록 크게 흔들린다
events.on('ground_slam', (payload) => {
  const slam = payload as { radius: number; dist: number };
  audio.play('ground_slam');
  const outside = Math.max(0, slam.dist - slam.radius);
  const near = Math.max(0, 1 - outside / 9); // 반경 안이면 1, 9m 더 멀면 0
  stage.triggerCameraKick(0.45 + 1.35 * near, 430);
});
events.on('enemy_volley_start', (payload) => {
  const info = payload as { shots: number };
  audio.play('boss_volley_draw');
  showReaction(`화살 세례 — ${info.shots}발이 온다!`, 2000);
});
events.on('headshot', () => {
  audio.play('headshot');
  showReaction('헤드샷!', 700);
});

events.on('block_hit', (payload) => {
  audio.play('block_hit');
  stage.triggerBlockHit((payload as { kind?: string }).kind);
});

// ---- 무기 — 원거리(좌클릭, 휠 교체) / 근접(우클릭) ----
events.on('weapon_switched', () => audio.play('weapon_switch'));
events.on('hammer_swing', (payload) => {
  const sw = payload as { heavy?: boolean; step?: number; speedMul?: number };
  audio.play(sw.heavy ? 'hammer_heavy' : 'hammer_swing');
  stage.triggerHammerSwing(sw.step ?? 1, sw.speedMul ?? 1);
  if (sw.heavy) showReaction('강타!', 700);
});
events.on('melee_hit', (payload) => {
  const hit = payload as { enemyId: number; heavy?: boolean };
  audio.play(hit.heavy ? 'heavy_hit' : 'melee_hit');
  stage.flashEnemyHit(hit.enemyId);
  if (hit.heavy) {
    stage.triggerCameraKick(1.2, 300);
    const e = world.enemies.find((x) => x.id === hit.enemyId);
    if (e) stage.spawnGuardSparks(e.x, e.z, 1.0, 0xffc27a, 1.8);
  }
});
events.on('grenade_thrown', () => {
  audio.play('grenade_throw');
  stage.triggerGrenadeThrow();
});
events.on('explosion', (payload) => {
  const info = payload as { x: number; y: number; z: number; radius: number; kind?: string };
  // 내파(수호주술사 마법탄)는 보라·수축, 그 외는 주황·팽창
  if (info.kind === 'implode') {
    audio.play('implode');
    stage.spawnImplosion(info.x, info.y, info.z, info.radius);
    return;
  }
  audio.play('explosion');
  stage.spawnExplosion(info.x, info.y, info.z, info.radius);
});
// 보물상자 — 골드 무더기와 각인 하나가 쏟아진다
events.on('chest_opened', (payload) => {
  const info = payload as { gold: number; sigilId: string | null };
  audio.play('chest_opened');
  const sigil = info.sigilId ? ` · ${sigilDef(info.sigilId).name} 각인` : '';
  showReaction(`보물상자 — ◆ ${info.gold}${sigil}`, 2600);
});
// 날아오던 것을 공중에서 깼다 — 바위가 파편으로 흩어진다
const PROJECTILE_DEBRIS_COLORS: Record<string, number> = { rock: 0x6b675e, web: 0xe6e9e0 };
events.on('projectile_broken', (payload) => {
  const info = payload as { x: number; y: number; z: number; kind?: string; radius: number };
  audio.play('rock_shattered');
  stage.spawnProjectileDebris(
    info.x,
    info.y,
    info.z,
    info.radius,
    PROJECTILE_DEBRIS_COLORS[info.kind ?? ''] ?? 0x8a8f9a,
  );
  showReaction('바위를 공중에서 깼다!', 1200);
});
// 폭발통 — 때리면 통 울리는 소리, 도화선에 불이 붙으면 알려 준다
events.on('barrel_hit', (payload) => {
  const info = payload as { hits: number; fuse: number };
  audio.play('barrel_hit');
  if (info.fuse < 0) return;
  audio.play('barrel_armed');
  const sec = (info.fuse / 60).toFixed(info.fuse >= 60 ? 0 : 1);
  showReaction(info.fuse === 0 ? '폭발통 — 터진다!' : `폭발통 점화 — ${sec}초`, 1200);
});
// 벽 튕김 — 소리만. 세게 부딪힐수록 크게 들린다
events.on('grenade_bounce', () => audio.play('grenade_bounce'));
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
let executedThisFrame = false; // 직전 melee_kill 이 처형이었는지 (파편 세기 결정)
events.on('melee_kill', (payload) => {
  const kill = payload as { execution: boolean; enemyId?: number };
  executedThisFrame = kill.execution;
  // 해머가 닿기 전에 시체가 사라지면 허공을 치는 그림이 된다 — 접촉까지 붙잡아 둔다
  if (kill.execution && kill.enemyId !== undefined) {
    stage.holdExecutionVictim(kill.enemyId, executeContactMs);
  }
});
events.on('enemy_died', (payload) => {
  const dead = payload as { enemyType: string; x: number; z: number };
  if (executedThisFrame) {
    // 처형 — 사망 연출도 해머가 닿는 순간까지 미룬다
    afterMs(executeContactMs, () => {
      audio.play('enemy_death');
      stage.spawnDeathBurst(dead.x, dead.z, dead.enemyType, 1.8);
    });
  } else {
    audio.play('enemy_death');
    stage.spawnDeathBurst(dead.x, dead.z, dead.enemyType, 1);
  }
  executedThisFrame = false;
});
events.on('cast_failed', (payload) => {
  audio.play('cast_fizzle');
  const info = payload as { reason: string; cost?: number; current?: number };
  showReaction(
    info.reason === 'no_mana'
      ? `마나 부족 — ${info.cost} 필요 (패링·처형으로 모아야 한다)`
      : '오른팔에 각인이 없다 — 각인을 주우면 자동으로 새겨진다',
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
const SIGIL_TOAST_MS = 2800;
function showReaction(text: string, durationMs = 1000): void {
  reactionLabel = text;
  reactionLabelUntil = performance.now() + durationMs;
}
events.on('parry_attempt', (payload) => {
  const result = (payload as { result: string }).result;
  showReaction(result === 'perfect' ? '완벽 패링!' : result === 'normal' ? '패링' : '실패 — 경직');
});
events.on('melee_kill', (payload) => {
  if ((payload as { execution: boolean }).execution) showReaction('처형!');
});
events.on('dodge_step', () => showReaction('회피'));
events.on('potion_picked', (payload) => {
  const info = payload as { healed: number; health: number };
  audio.play('pickup_potion');
  showReaction(`+${Math.round(info.healed)} HP`, 900);
});
events.on('mana_potion_picked', (payload) => {
  const info = payload as { restored: number };
  audio.play('pickup_mana');
  showReaction(`+${Math.round(info.restored)} 마나`, 900);
});
events.on('food_picked', (payload) => {
  const info = payload as { healed: number; restored: number };
  audio.play('pickup_food');
  showReaction(`+${Math.round(info.healed)} HP  +${Math.round(info.restored)} 마나`, 900);
});
events.on('gold_picked', () => audio.play('pickup_gold'));
const PARRY_SPARK_COLOR = 0xbfe0ff; // 패링은 청백색 (텔레그래프 청색 계열)
events.on('guard_clash', (payload) => {
  const c = payload as { kind: string; x: number; z: number };
  const parry = c.kind !== 'block';
  const perfect = c.kind === 'parry_perfect';
  audio.play('guard_clash');
  stage.triggerCameraKick(perfect ? 1.0 : parry ? 0.85 : 0.75, 200);
  // 플레이어와 적 사이 — 무기가 부딪힌 지점에서 불꽃
  const p2 = world.player;
  const midX = (p2.x + c.x) / 2;
  const midZ = (p2.z + c.z) / 2;
  stage.spawnGuardSparks(
    midX,
    midZ,
    balance.player.eyeHeight * 0.72,
    parry ? PARRY_SPARK_COLOR : 0xfff0b0,
    perfect ? 1.6 : parry ? 1.3 : 1,
  );
  if (!parry) showReaction('막았다! 반격 기회', 800);
});
events.on('enemy_charge', (payload) => {
  const info = payload as { enemyType: string };
  // 멀리서 달려오는 긴 돌격은 예비동작이 길어 전용 소리를 붙인다 (발로 땅을 긁는 소리)
  const long = enemyDef(info.enemyType).chargeAttack?.chargeRunTicks !== undefined;
  audio.play(long ? 'charge_ready' : 'telegraph_blue');
  // 창병만 쓰던 기술이 아니다 — 족장도 중·원거리에서 달려든다
  showReaction(`${enemyDef(info.enemyType).name ?? '적'}이 달려든다!`, 1200);
});
events.on('enemy_whiffed', () => {
  audio.play('enemy_whiff');
  showReaction('빗나감 — 반격 기회!', 900);
});
events.on('shield_braced', (payload) => {
  const c = payload as { x: number; z: number };
  audio.play('shield_brace');
  const p2 = world.player;
  stage.spawnGuardSparks((p2.x + c.x) / 2, (p2.z + c.z) / 2, 1.0, 0xdfe6ef, 0.7);
});
events.on('shield_bash_start', () => {
  audio.play('telegraph_blue');
  showReaction('방패로 밀쳐낸다!', 900);
});
events.on('shield_cracked', (payload) => {
  const info = payload as { enemyId: number; remaining: number; half: boolean };
  audio.play('shield_crack');
  stage.flashEnemyHit(info.enemyId);
  stage.triggerCameraKick(info.half ? 0.75 : 0.45, 180);
  showReaction(
    info.half ? '방패 반파 — 금이 갈라졌다!' : `방패를 깎았다 — ${info.remaining}대 더`,
    info.half ? 1400 : 900,
  );
});
// 경직 중 3타 마무리 — 크게 날린다. 무게가 실린 소리와 카메라 킥으로 알린다
events.on('stagger_fling', () => {
  audio.play('hammer_heavy');
  stage.triggerCameraKick(1.1, 260);
  showReaction('강타 — 날려 버렸다!', 900);
});
events.on('shield_broken', (payload) => {
  const info = payload as { enemyId: number };
  audio.play('shield_break');
  stage.shatterShield(info.enemyId);
  showReaction('방패 파괴!', 1200);
});
// 각인 획득 — 화면 가운데에 각인 색으로 크게 띄운다.
// 이 시점은 아직 attach 전이라, 슬롯이 비어 있으면 곧 몸에 새겨진다는 뜻이다
const sigilToast = document.getElementById('sigil-toast')!;
const sigilToastName = sigilToast.querySelector('.name') as HTMLElement;
const sigilToastSub = sigilToast.querySelector('.sub') as HTMLElement;
let sigilToastUntil = 0;
const SLOT_NAMES: Record<string, string> = {
  eye: '눈',
  rightArm: '오른팔',
  leftArm: '왼팔',
  heart: '심장',
  spine: '척추',
};
events.on('sigil_acquired', (payload) => {
  const id = (payload as { id: string }).id;
  const def = sigilDef(id);
  const willAttach = world.sigils.equipped[def.slot] === null;
  const slot = SLOT_NAMES[def.slot] ?? def.slot;
  sigilToastName.textContent = `✦ ${def.name}`;
  sigilToastName.style.color = def.color;
  sigilToastName.style.textShadow = `0 0 12px ${def.color}`;
  sigilToastSub.textContent = willAttach
    ? `${slot}에 새겨졌다`
    : `${slot} 슬롯이 차 있다 — Tab 에서 교체`;
  sigilToast.classList.add('visible');
  sigilToastUntil = performance.now() + SIGIL_TOAST_MS;
});

events.on('player_died', () => {
  if (world.godMode) return; // 무적 중에는 사망 화면도 뜨지 않는다 (자원은 틱 끝에 되돌아간다)
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
  // 폭발통도 되살린다 — 남은 차단 블록을 먼저 걷어내야 유령 벽이 쌓이지 않는다
  for (const barrel of world.barrels) if (barrel.blocker) level.removeBlocker(barrel.blocker);
  world.barrels = spawnBarrels(levelJson.entities, level);
  for (const chest of world.chests) if (chest.blocker) level.removeBlocker(chest.blocker);
  world.chests = spawnChests(levelJson.entities, level);
  world.chestInView = null;
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
events.on('altar_entered', () => {
  audio.play('altar_enter');
  shopUI.show(); // 보급 상점 — 무료 보급은 없다. Tab 으로 각인 교체
  setUiOpen(true);
});
const SHOP_LABEL: Record<string, string> = {
  heal: '체력', mana: '마나', ammo: '권총탄', grenade: '수류탄', battery: '배터리',
};
events.on('shop_purchased', (payload) => {
  const buy = payload as {
    item: string; price: number; amount: number; stock: number; stockMax: number;
  };
  audio.play('shop_buy');
  const left = buy.stockMax > 1 ? `  재고 ${buy.stock}/${buy.stockMax}` : '';
  showReaction(
    `${SHOP_LABEL[buy.item] ?? buy.item} +${buy.amount}  (◆ ${buy.price})${left}`,
    1200,
  );
});
events.on('shop_denied', (payload) => {
  const deny = payload as { item: string; reason: string; price: number; cooldown: number };
  audio.play('shop_deny');
  const label = SHOP_LABEL[deny.item] ?? deny.item;
  const sec = Math.ceil(deny.cooldown / balance.loop.tickRate);
  showReaction(
    deny.reason === 'cooldown'
      ? `${label} — 재입고까지 ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
      : deny.reason === 'full'
        ? `${label} — 이미 가득 찼다`
        : `골드 부족 — ◆ ${deny.price} 필요`,
    1400,
  );
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
  showReaction(
    info.kind === 'shield' ? '방패에 막혔다 — 화염구로 부술 수 있다' : '방어막 — 9mm만 뚫는다',
  );
});
// 마법 방어막 — 해머로 두들기면 금이 가고, 끝내 터진다
events.on('barrier_cracked', (payload) => {
  const info = payload as { enemyId: number; remaining: number };
  audio.play('barrier_cracked');
  stage.flashBarrier(info.enemyId);
  showReaction(`방어막에 금이 간다 — ${info.remaining}대 더`, 900);
});
events.on('barrier_broken', (payload) => {
  const info = payload as { enemyType: string; x: number; z: number };
  const def = enemyDef(info.enemyType);
  audio.play('barrier_broken');
  stage.spawnBarrierShatter(info.x, info.z, def.radius + 0.7, def.height * 0.55);
  stage.triggerCameraKick(0.6, 220);
  showReaction('방어막이 부서졌다!', 1600);
});
events.on('shot_blocked', () => showReaction('방패 — 정면은 막힌다 (화염구로 부술 수 있다)'));
events.on('boss_staggered', () => showReaction('보스 스태거 — 지금 처형! (Space·우클릭)'));
events.on('exit_opened', () => {
  audio.play('exit_opened');
  showReaction('족장이 쓰러졌다 — 출구의 봉인이 풀렸다', 3500);
});
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
Pickups.init(world);
Progression.init(world);
Corruption.init(world);
Stamina.init(world);
const systems = [
  PlayerMove.tick,
  Enemies.tick,
  Reaction.tick,
  Sigils.tick,
  Pickups.tick,
  Weapons.tick,
  Projectiles.tick,
  Barrels.tick, // 같은 틱에 쏜 화염구·던진 수류탄이 통을 터뜨릴 수 있게 뒤에 둔다
  Mana.tick,
  Altar.tick,
  Lever.tick,
  Chest.tick,
  Exit.tick,
  Lantern.tick,
  Stamina.tick, // 소모하는 쪽(PlayerMove·Reaction) 뒤에서 회복한다
];

function simulate(dt: number): void {
  world.input = input.sample();

  // 히트스톱 — simulate를 건너뛰되 반응 입력(릴리즈)은 버퍼에 보관 (docs/architecture.md §1)
  if (world.freezeTicks > 0) {
    world.freezeTicks--;
    if (world.input.reactionPressed) {
      world.player.reactionBufferTicks = balance.reaction.inputBufferTicks;
    }
    world.tick++;
    tpsWindowTicks++;
    return;
  }

  if (!world.dead && !world.uiOpen && !world.cleared) {
    // 무적(테스트) — 시스템을 손대지 않고 한 곳에서 자원만 되돌린다.
    // HP를 깎는 지점이 여섯 군데라 각각 분기를 심으면 금방 어긋난다
    const keep = world.godMode ? snapshotResources() : null;
    for (const system of systems) system(world, dt);
    if (keep) restoreResources(keep);
  }
  world.tick++;
  tpsWindowTicks++;
}

/** 무적 중 되돌릴 자원 — 골드·경험치는 제외한다 (상점을 시험할 수 없게 된다) */
function snapshotResources(): {
  health: number; mana: number; mag: number; reserve: number; grenades: number;
  battery: number; spares: number; stamina: number; exhausted: boolean;
} {
  return {
    health: world.player.health,
    mana: world.mana.value,
    mag: world.weapon.mag,
    reserve: world.weapon.reserve,
    grenades: world.weapon.grenades,
    battery: world.lantern.battery,
    spares: world.lantern.spares,
    stamina: world.stamina.value,
    exhausted: world.stamina.exhausted,
  };
}

function restoreResources(keep: ReturnType<typeof snapshotResources>): void {
  world.player.health = keep.health;
  world.mana.value = keep.mana;
  world.weapon.mag = keep.mag;
  world.weapon.reserve = keep.reserve;
  world.weapon.grenades = keep.grenades;
  world.lantern.battery = keep.battery;
  world.lantern.spares = keep.spares;
  world.stamina.value = keep.stamina;
  world.stamina.exhausted = keep.exhausted;
  world.dead = false; // 이번 틱에 죽었더라도 없던 일로
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

const webOverlay = document.getElementById('web-overlay')!;
const hpRow = document.getElementById('status-hp')!;
const manaRow = document.getElementById('status-mana')!;
const staminaRow = document.getElementById('status-stamina')!;
const staminaFill = document.getElementById('status-stamina-fill')!;
const lanternRow = document.getElementById('status-lantern')!;
const lanternFill = document.getElementById('status-lantern-fill')!;
const lanternText = document.getElementById('status-lantern-text')!;

// 보스 체력 칸 색 — 마지막 칸(×1)은 HUD 기본색과 같은 계열, 그 앞 칸은 보라로 구분한다
const BOSS_BAR_COLORS = { outer: '#b070e8', last: '#ff7a6b' };

function render(alpha: number): void {
  const now = performance.now();
  runDelayedFx(now);
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
  stage.setAmbientBoost(world.modifiers.ambientVisionBoost);
  stage.setMuzzleFlash(world.weapon.muzzleFlash > 0);
  stage.syncEnemies(world.enemies, alpha);
  stage.syncProjectiles(world.projectiles, alpha);
  stage.syncGroundItems(world.groundItems);
  stage.syncBarrels(world.barrels);
  stage.syncChests(world.chests);
  const chargeFrac =
    world.weapon.ranged === 'grenade' && world.weapon.grenadeCharge > 0
      ? world.weapon.grenadeCharge / balance.weapons.grenade.maxChargeTicks
      : 0;
  // 왼손에 든 원거리 무기 (오른손 해머는 항상 보인다)
  stage.setHandWeapon(world.weapon.ranged);
  stage.updateHands({
    reloading: world.weapon.reloading > 0,
    stunned: p.stunTicks > 0,
    blocking: p.blocking,
    chargeFrac,
    // 손에 직접 띄우는 수치 — 왼손 탄약 / 오른손 연타 단계
    ammoText:
      world.weapon.ranged === 'pistol'
        ? world.weapon.reloading > 0
          ? '↻'
          : String(world.weapon.mag)
        : String(world.weapon.grenades),
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
  stage.setExitOpen(world.exitOpen);
  minimap.update(p, world.enemies, alpha, world.exitOpen);

  // 하단 중앙 상태 표시 — HP 바 + 무기 슬롯
  const wpn = world.weapon;
  const hpFrac = Math.max(0, p.health) / balance.player.healthMax;
  const hpFill = document.getElementById('status-hp-fill')!;
  hpFill.style.width = `${hpFrac * 100}%`;
  hpFill.style.background = hpFrac > 0.5 ? '#3fae5a' : hpFrac > 0.25 ? '#c9a227' : '#e04444';
  // 마나 — 중앙 오른쪽. 연쇄 중에는 밝게
  const manaFrac = Math.max(0, Math.min(1, world.mana.value / balance.mana.max));
  const manaFill = document.getElementById('status-mana-fill')!;
  manaFill.style.width = `${manaFrac * 100}%`;
  manaFill.style.background = world.mana.chainIndex > 0 ? '#7fc4ff' : '#4a9eff';
  // 무적 — HP·마나 바를 깜빡여 켜져 있다는 걸 계속 알린다 (CSS 애니메이션)
  hpRow.classList.toggle('god', world.godMode === true);
  manaRow.classList.toggle('god', world.godMode === true);
  // 거미줄 — 남은 타수만큼 진하다. 한 대 걷어낼 때마다 눈에 띄게 옅어진다
  const webLeft = (p.webSwingsLeft ?? 0) / balance.web.breakSwings;
  webOverlay.style.opacity = String(webLeft > 0 ? 0.3 + 0.6 * webLeft : 0);

  // 스태미너 — HP·마나 바 바로 아래. 탈진하면 붉게 죽는다
  const stamFrac = Math.max(0, Math.min(1, world.stamina.value / balance.player.stamina.max));
  staminaFill.style.width = `${stamFrac * 100}%`;
  staminaRow.className = world.stamina.exhausted ? 'spent' : '';
  // 랜턴 — HP·마나 바 아래의 얇은 실선 게이지. 오른쪽에 % 와 예비 전지 개수
  const battFrac = Math.max(0, Math.min(1, world.lantern.battery / balance.lantern.batteryMax));
  const battPct = Math.round(battFrac * 100);
  lanternFill.style.width = `${battFrac * 100}%`;
  lanternText.textContent = `${battPct}% 예비 ${world.lantern.spares}`;
  lanternRow.className =
    (battPct <= 20 ? 'low' : '') + (world.lantern.on ? '' : ' off');
  document.getElementById('status-gold')!.textContent = `◆ ${world.gold}   XP ${world.xp}`;
  // 원거리(좌클릭) / 근접(우클릭) 두 슬롯. 원거리는 휠로 교체
  document.getElementById('slot-ranged')!.textContent =
    wpn.ranged === 'pistol'
      ? `LMB 권총 ${wpn.mag}/${wpn.reserve}${wpn.reloading > 0 ? ' …' : ''}`
      : `LMB 수류탄 ×${wpn.grenades}`;
  // 연속타 단계 — 다음 타가 강타면 눈에 띄게 표시
  const step = wpn.comboTimer > 0 ? wpn.comboStep : 0;
  const finisher = balance.weapons.hammer.combo.finisherStep;
  const pips = '●'.repeat(step) + '○'.repeat(Math.max(0, finisher - 1 - step));
  const meleeSlot = document.getElementById('slot-melee')!;
  meleeSlot.textContent = `RMB ${wpn.melee === 'hammer' ? '해머' : wpn.melee} ${pips}`;
  meleeSlot.className = `weapon-slot active${step >= finisher - 1 ? ' charged' : ''}`;

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
    world.altarInView && !world.altarEnteredThisApproach && !world.uiOpen && !world.dead;
  // 출구 발판 위 — 서 있는 동안 계속 띄운다 (3초 뒤 사라지면 못 보고 지나친다).
  // 봉인 중이면 이유를, 열렸으면 나가는 방법을 알린다
  const onExit = world.onExitPad && !world.dead && !world.uiOpen && !world.cleared;
  const nearChest = world.chestInView !== null && !world.dead && !world.uiOpen;
  altarPrompt!.classList.toggle(
    'visible',
    showAltarPrompt || (nearLever && !world.dead) || onExit || nearChest,
  );
  if (showAltarPrompt) {
    altarPrompt!.textContent =
      `제단 — E 보급 상점\n` +
      `◆ ${world.gold} 소지 · 체력·마나·탄약·수류탄·배터리를 산다 (무료 보급 없음)\n` +
      `오염 +${world.corruption.pending} 정산 · 리스폰 지점 등록`;
  } else if (nearChest) {
    altarPrompt!.textContent = 'E — 보물상자를 연다';
  } else if (nearLever) {
    altarPrompt!.textContent = 'E — 레버를 당긴다';
  } else if (onExit) {
    altarPrompt!.textContent = world.exitOpen ? 'E — 구역을 벗어난다' : '출구가 봉인되어 있다';
  }

  const w = world.weapon;
  const aliveCount = world.enemies.filter((e) => e.alive).length;
  if (performance.now() > reactionLabelUntil) reactionLabel = '';
  if (sigilToastUntil > 0 && performance.now() > sigilToastUntil) {
    sigilToast.classList.remove('visible');
    sigilToastUntil = 0;
  }

  // 보스 체력 바 (어그로 상태일 때만) — 칸(×N)마다 색이 다르다
  const boss = world.enemies.find((e) => e.alive && enemyDef(e.type).boss && e.ai !== 'idle');
  let bossLine = '';
  let bossBarColor = '';
  if (boss) {
    const def = enemyDef(boss.type);
    const hb = healthBarState(def, boss.health);
    bossBarColor = hb.index > 1 ? BOSS_BAR_COLORS.outer : BOSS_BAR_COLORS.last;
    const bar = '█'.repeat(Math.round(hb.frac * 24)).padEnd(24, '░');
    const stage2 = hb.count > 1 ? ` ×${hb.index}` : '';
    const streak = `패링 ${boss.parryStreak ?? 0}/${def.parriesToStagger}`;
    bossLine = `족장${stage2} ${bar} ${Math.max(0, Math.round(boss.health))}/${def.health}  [${streak}]\n`;
  }
  // HP·마나·랜턴은 하단 게이지가 이미 보여 준다 — 위에서 숫자로 겹쳐 읽지 않는다.
  // 연쇄 배율만은 어디에도 안 나오므로 spell 줄로 옮겨 살려 둔다
  const mana = world.mana;
  const chainMult = balance.chain.multipliers[Math.min(mana.chainIndex, balance.chain.multipliers.length - 1)]!;
  const hudText =
    `tick ${world.tick}  (${measuredTps.toFixed(1)}/s)\n` +
    `9mm ${w.mag}/${w.reserve}${w.reloading > 0 ? '  [장전중]' : ''}${p.stunTicks > 0 ? '  [경직]' : ''}${p.blocking ? '  [방어]' : ''}\n` +
    `spell ${spellHudText()}   각인 ${world.sigils.inventory.length}개 소지   chain ×${chainMult}\n` +
    `corruption ${world.corruption.applied}${world.corruption.pending > 0 ? ` (+${world.corruption.pending} 대기)` : ''}/100${world.canReadGlyphs ? '  [해독]' : ''}\n` +
    bossLine +
    `enemies ${aliveCount}${reactionLabel ? `   ${reactionLabel}` : ''}${world.godMode ? '   [무적]' : ''}\n` +
    (input.pointerLocked ? '' : '[클릭] 마우스 잠금\n') +
    'WASD 이동  Shift 질주  좌클릭 원거리(휠 교체)  우클릭 근접·처형  Space 짧게=패링·꾹=방어  Shift+Space 회피\n' +
    'Q 마법  Tab 각인  R 장전  F 랜턴  B 배터리  M 미니맵  F1 지표  F2 덤프  F3 다시하기  P/O/K/G 테스트';

  // 보스 줄만 색을 입힌다 — 나머지는 그대로 텍스트로 두고 필요할 때만 innerHTML 을 쓴다.
  // (HUD 문자열에는 <>& 가 들어가지 않으므로 이스케이프가 필요 없다)
  if (bossLine) {
    hud!.innerHTML = hudText.replace(
      bossLine.slice(0, -1),
      `<span style="color:${bossBarColor}">${bossLine.slice(0, -1)}</span>`,
    );
  } else {
    hud!.textContent = hudText;
  }

  stage.render();
}

const loop = new Loop(balance.loop.tickRate, balance.loop.maxFrameClampSec, {
  simulate,
  render,
});

// ---- 일시정지 ----
// 포인터 락이 풀리면(ESC·알트탭·창 밖 클릭) 곧 화면 밖이라는 뜻이므로 함께 멈춘다.
// 브라우저가 ESC를 포인터 락 해제로 예약해 두었기 때문에 이게 가장 자연스럽다.
const pauseOverlay = document.getElementById('pause')!;
function setPaused(paused: boolean): void {
  if (loop.isPaused === paused) return;
  loop.setPaused(paused);
  world.paused = paused;
  // 각인 UI·사망·클리어 화면이 떠 있을 때는 정지 안내를 겹쳐 띄우지 않는다
  const showOverlay = paused && !world.uiOpen && !world.dead && !world.cleared;
  pauseOverlay.classList.toggle('visible', showOverlay);
  if (paused) input.releaseHeld(); // 멈춘 사이 눌려 있던 키가 남지 않게
}
document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement) setPaused(false);
  else if (!world.uiOpen) setPaused(true);
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) setPaused(true);
});
window.addEventListener('blur', () => setPaused(true));

// 개발 빌드 전용 디버그 핸들 (헤드리스 테스트/콘솔 조작용)
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__world = world;
  (window as unknown as Record<string, unknown>).__input = input;
  (window as unknown as Record<string, unknown>).__stage = stage; // 씬 그래프 검증용
}

loop.start();
events.emit('loop_started', { tickRate: balance.loop.tickRate, level: levelJson.id });
