import { GameAudio } from './core/Audio';
import { balance } from './core/Balance';
import { Events } from './core/Events';
import { Metrics } from './core/Metrics';
import { DebugOverlay } from './render/DebugOverlay';
import { Input } from './core/Input';
import { Loop } from './core/Loop';
import { World, type ItemKind } from './core/World';
import { countOf, initInventory, spillInventoryToGrave, itemColor, itemDef } from './core/Inventory';
import * as Reaction from './systems/Reaction';
import { Level, buildLevelGroup } from './level/GridLoader';
import { spawnBarrels, spawnChests, spawnEnemies, spawnEnemyAt } from './level/Spawner';
import { Minimap } from './render/Minimap';
import { PauseMenu } from './render/PauseMenu';
import { GamepadUI } from './render/GamepadUI';
import { buttonName, type PadAction } from './core/Gamepad';
import { Stage } from './render/Stage';
import { grenadeThrowSpeed } from './systems/Weapons';
import * as PlayerMove from './systems/PlayerMove';
import * as Enemies from './systems/Enemies';
import * as Weapons from './systems/Weapons';
import * as Projectiles from './systems/Projectiles';
import * as Mana from './systems/Mana';
import * as Items from './systems/Items';
import * as Pickups from './systems/Pickups';
import * as LifeMotes from './systems/LifeMotes';
import * as Progression from './systems/Progression';
import * as Sigils from './systems/Sigils';
import * as Stamina from './systems/Stamina';
import * as Corruption from './systems/Corruption';
import * as Altar from './systems/Altar';
import * as Barrels from './systems/Barrels';
import * as Chest from './systems/Chest';
import * as Exit from './systems/Exit';
import * as Door from './systems/Door';
import * as Lever from './systems/Lever';
import * as Lantern from './systems/Lantern';
import { enemyDef, healthBarState } from './core/Entities';
import { ShopUI } from './render/ShopUI';
import { InventoryUI, quickslotView } from './render/InventoryUI';
import { SKILL_KEYS, SkillUI } from './render/SkillUI';
import { itemIconSvg } from './render/ItemIcons';
import { allSigilIds, isImplemented, sigilColor, sigilDef } from './core/SigilData';
import z01f1 from '../data/levels/z01_f1.json';
import z01f2 from '../data/levels/z01_f2.json';
import z01f3 from '../data/levels/z01_f3.json';

// 1구역 층 순서 — 출구에서 E 를 누르면 다음 층으로 내려간다. 마지막 층을 나가면 구역 클리어.
// 층마다 스폰(S)이 곧 그 층의 입구이고, 출구(X)가 다음 층의 입구로 이어진다
const ZONE = [z01f1, z01f2, z01f3];
let floorIndex = 0;
let levelJson: (typeof ZONE)[number] = ZONE[0]!;
/** 열쇠로 자물쇠를 딴 층 — 오르내리거나 부활해도 다시 잠기지 않는다 */
const unlockedFloors = new Set<number>();
/** 층 이동 연출 중 — 겹쳐 누른 E 가 이동을 두 번 걸지 않게 */
let traveling = false;

/** 층에 매인 상태 — 층을 떠날 때 통째로 얼려 두고, 되돌아오면 그대로 되살린다.
 *  죽인 적은 죽은 채, 연 문·부순 통·떨어진 아이템도 그대로다 (재소환 없음).
 *  Level 자체를 함께 얼린다 — 열린 문 칸('.')과 차단 블록이 그 안에 살아 있다 */
interface FloorState {
  level: Level;
  enemies: World['enemies'];
  barrels: World['barrels'];
  chests: World['chests'];
  doors: World['doors'];
  groundItems: World['groundItems'];
  lifeMotes: World['lifeMotes'];
  pulledLevers: World['pulledLevers'];
}
const floorStates = new Map<number, FloorState>();

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
let level = new Level(levelJson);
const input = new Input(app);

/** 현재 매핑 기준 패드 버튼 이름 — 안내 문구용 */
function padBtn(action: PadAction): string {
  return buttonName(input.gamepad.binding(action));
}
/** 안내 문구의 키 표기 — 마지막으로 쓴 장치를 따라간다 */
function keyLabel(kb: string, action: PadAction): string {
  return input.usingPad ? padBtn(action) : kb;
}

const world = new World(events, {
  input: Input.emptySnapshot(),
  player: {
    x: level.spawn.x,
    y: 0,
    z: level.spawn.z,
    prevX: level.spawn.x,
    prevY: 0,
    prevZ: level.spawn.z,
    yaw: level.spawnYaw, // 등 뒤 계단이 아니라 방을 본다
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
    arrows: balance.weapons.bow.startCount,
    bowDraw: 0,
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
const inventoryUI = new InventoryUI(world); // I — 가방·소모품
const skillUI = new SkillUI(world); // Tab — 스킬 (부위 부착 · 퀵슬롯)
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
    // 상점에서 Tab — 스킬 창으로 넘어간다 (둘이 겹쳐 뜨지 않게). 제단에서는 패시브를 뗄 수 있다
    inventoryUI.hide();
    if (shopUI.open) {
      shopUI.hide();
      setUiOpen(skillUI.toggle(true));
      return;
    }
    setUiOpen(skillUI.toggle());
  }
  if (e.code === 'KeyI') {
    if (shopUI.open || world.dead) return;
    skillUI.hide();
    setUiOpen(inventoryUI.toggle());
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
  // 테스트용 시야 내 몰살 (Alt) — 진행 속도를 위한 편의 (슬라이스 검증 시 제거).
  // 화면에 들어와 있고 벽에 가리지 않은 적만 죽인다.
  // K 에서 옮겼다 — 브라우저 기본 동작(메뉴 포커스)은 막는다
  if ((e.code === 'AltLeft' || e.code === 'AltRight') && !world.dead && !world.uiOpen) {
    e.preventDefault();
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
  // 테스트용 층 바로 이동 (6·7·8 → 1-1·1-2·1-3) — 계단 연출 없이 즉시.
  // 층 상태는 loadFloor 가 얼리고 되살리므로 오가도 진행이 깨지지 않는다 (슬라이스 검증 시 제거)
  if ((e.code === 'Digit6' || e.code === 'Digit7' || e.code === 'Digit8') && !world.dead && !world.uiOpen && !traveling) {
    const target = e.code === 'Digit6' ? 0 : e.code === 'Digit7' ? 1 : 2;
    if (target !== floorIndex && target < ZONE.length) {
      traveling = true;
      screenFade(1, 160);
      afterMs(180, () => {
        loadFloor(target);
        screenFade(0, 240);
      });
      console.log('[debug] 층 바로 이동', `1-${target + 1}`);
    }
  }
  // 테스트용 스킬 전부 획득 — 구현된 것만. 오염은 안 쌓인다 (슬라이스 검증 시 제거)
  if (e.code === 'KeyU' && !world.dead && !world.uiOpen) {
    if (world.skillTestMode) {
      // 두 번째 U — 모드만 끈다. 익힌 스킬은 남고 마나는 다시 닳는다
      world.skillTestMode = false;
      showReaction('(테스트) 스킬 테스트 OFF — 마나가 다시 닳는다', 2000);
    } else {
      const n = grantAllSkills();
      showReaction(
        n > 0
          ? `(테스트) 스킬 테스트 ON — 구현된 스킬 ${n}종 + 마나 무한 (U 로 끔)`
          : '(테스트) 스킬 테스트 ON — 마나 무한 (U 로 끔)',
        2400,
      );
    }
    console.log('[debug] 스킬 테스트', world.skillTestMode);
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
    wallOffset: balance.lighting.torchWallOffset,
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
  'headshot_kill',
  'enemy_split',
  'grave_dropped',
  'slime_ate',
  'slime_spilled',
  'grave_recovered',
  'boss_brood',
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
  'mana_potion_dropped',
  'food_dropped',
  'item_picked',
  'item_gained',
  'item_used',
  'arrow_loosed',
  'arrow_impact',
  'arrow_shielded',
  'arrows_dropped',
  'bow_draw_released',
  'arrow_recovered',
  'arrow_broken',
  'quiver_full',
  'item_channel_started',
  'item_channel_broken',
  'item_denied',
  'item_dropped',
  'inventory_full',
  'quickslot_bound',
  'gold_dropped',
  'gold_picked',
  'xp_gained',
  'sigil_acquired',
  'sigil_duplicate',
  'sigil_attached',
  'sigil_detached',
  'skill_slot_changed',
  'skill_selected',
  'channel_ended',
  'frost_nova',
  'frost_impact',
  'enemy_frozen',
  'enemy_shocked',
  'enemy_thawed',
  'enemy_freeze_ended',
  'blink',
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
  'exit_unlocked',
  'exit_key_dropped',
  'exit_key_picked',
  'floor_ascend',
  'exit_opened',
  'zone_cleared',
  'door_channel_started',
  'door_channel_broken',
  'door_unlocked',
  'door_opened',
  'door_needs_lever',
  'lever_pulled',
]) {
  events.on(name, (payload) => console.log(`[events] ${name}`, payload));
}

// ---- 오디오 (합성음, 에셋 없음) ----
const audio = new GameAudio();
app.addEventListener('click', () => audio.unlock());
events.on('enemy_windup', (payload) => {
  const wind = payload as { telegraph?: string; enemyType?: string };
  // 슬라임 — 몸이 부풀어 오르는 꿀렁임을 텔레그래프 소리에 얹는다
  if (wind.enemyType?.startsWith('slime')) audio.play('slime_windup');
  const telegraph = wind.telegraph;
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
// 방패 튕김음 — 채널형 빔은 초당 10번 막힌다. 그 속도로 같은 소리를 울리면 기관총이 된다.
// 총(14틱=233ms)·화살은 이 간격보다 느려 영향이 없다
const BLOCKED_SOUND_MIN_MS = 110;
let lastBlockedSoundMs = 0;
events.on('shot_blocked', () => {
  const now = performance.now();
  if (now - lastBlockedSoundMs < BLOCKED_SOUND_MIN_MS) return;
  lastBlockedSoundMs = now;
  audio.play('shot_blocked');
});
events.on('dodge_step', () => audio.play('dodge'));
events.on('footstep', (payload) => {
  audio.play((payload as { sprint?: boolean }).sprint ? 'footstep_run' : 'footstep_walk');
});
events.on('cast_spell', (payload) => {
  const { cast, sigil, channel } = payload as { cast?: string; sigil?: string; channel?: boolean };
  // 해머가 지팡이가 된다 — 머리에서 스킬 색 마력.
  // 채널(관통 뇌창)은 붙들고 있는 내내 내민 자세로 붙잡아 둔다
  if (sigil && channel) stage.setChannel(true, sigilColor(sigil));
  else if (sigil) stage.triggerCast(sigilColor(sigil));
  audio.play(cast === 'beam' ? 'cast_lightning' : cast === 'nova' ? 'cast_frost' : cast === 'blink' ? 'blink' : 'cast_fire');
  if (channel) audio.startBeam(); // 시작 크랙 위에 이어지는 전류음을 깐다
});
// 채널이 끊겼다 — 손을 뗐거나, 마나가 말랐거나, 경직에 걸렸거나
events.on('channel_ended', () => {
  stage.setChannel(false);
  stage.clearLightningBeam();
  audio.stopBeam();
});
// 뇌창 빔 — 채널이 도는 동안 매 틱 온다. 끝점만 넘기고 지직거림은 렌더가 매 프레임 흔든다
events.on('lightning_beam', (payload) => {
  const b = payload as {
    hits: number[];
    ex: number; ey: number; ez: number; pulse?: boolean;
    surface: 'wall' | 'floor' | 'ceiling' | null; axis: 'x' | 'z' | null;
    dx: number; dz: number;
  };
  stage.setLightningBeam(b.ex, b.ey, b.ez, b.pulse === true);
  if (!b.pulse) return;
  audio.beamPulse(); // 한 타마다 전류음이 한 번 지직 — 박자를 소리로도 준다
  // 벽·바닥·천장에 닿아 있으면 그 자리가 탄다. 적을 맞히는 중이면 그 뒤 벽이 탄다
  if (b.surface) stage.scorchSurface(b.ex, b.ey, b.ez, b.surface, b.axis, b.dx, b.dz);
  for (const id of b.hits) stage.electrifyEnemy(id); // 꿴 적의 몸에 전류가 흐른다
});
// 감전 — 그 자세 그대로 굳어 좌우로 떤다. 가까우면 몸에 울린다
events.on('enemy_shocked', (payload) => {
  const e = payload as { enemyId: number; x: number; z: number };
  audio.play('shock');
  stage.electrifyEnemy(e.enemyId);
  const d = Math.hypot(e.x - world.player.x, e.z - world.player.z);
  if (d < 8) stage.triggerCameraKick(0.25 * (1 - d / 8), 160);
});
// 뇌창이 통을 지지고 있다 — 띠가 전기색으로 물들며 지직거린다
events.on('barrel_zapped', (payload) => {
  stage.markBarrelZapped((payload as { id: number }).id);
});
// 연쇄 — 적에서 적으로 옮겨붙은 호. 맞은 적은 빔에 맞았을 때와 같이 번쩍인다
events.on('lightning_chain', (payload) => {
  const c = payload as { links: Parameters<typeof stage.spawnChainArc>[0]; hits: number[] };
  stage.spawnChainArc(c.links);
  for (const id of c.hits) stage.electrifyEnemy(id);
});
events.on('frost_nova', (payload) => {
  const n = payload as { x: number; z: number; radius: number; scale?: number };
  stage.spawnNova(n.x, n.z, n.radius * (n.scale ?? 1)); // 첫 타는 작게
});
events.on('blink', () => screenFlash(0.6, 140));
// 얼음이 깨지는 순간 — 파편이 튀고 소리가 나며 (주문 시스템이) 피해를 넣는다
events.on('enemy_freeze_ended', (payload) => {
  const t = payload as { enemyId: number; enemyType: string; x: number; z: number };
  stage.spawnThaw(t.x, t.z, enemyDef(t.enemyType).height);
  stage.flashEnemyShatter(t.enemyId);
  audio.play('thaw');
  // 가까이서 깨지면 화면이 살짝 흔들린다 — 파열이 몸에 닿는 느낌
  const d = Math.hypot(t.x - world.player.x, t.z - world.player.z);
  if (d < 7) stage.triggerCameraKick(0.4 * (1 - d / 7), 200);
});
// 얼음 화살이 벽·바닥·천장에 닿았다 — 그 면에 서리 자국
events.on('frost_impact', (payload) => {
  const f = payload as {
    x: number; y: number; z: number;
    surface: 'wall' | 'floor' | 'ceiling';
    axis: 'x' | 'z' | null;
    dirX: number; dirY: number; dirZ: number; scale?: number;
  };
  stage.spawnFrostDecal(f.x, f.y, f.z, f.surface, f.axis, f.dirX, f.dirY, f.dirZ); // 자국은 늘 1타 크기
});
// 하나라도 실제로 얼어붙었으면 얼려지는 소리 (폭발음과 별개). 둔화만 걸린 건 조용하다
events.on('frost_nova', (payload) => {
  if (((payload as { frozen?: number[] }).frozen?.length ?? 0) > 0) audio.play('freeze');
});
// 얼어붙는 순간 — 적마다 섬광·껍질·결정·발밑 서리, 몸이 잠깐 하얗게
events.on('enemy_frozen', (payload) => {
  const f = payload as { enemyId: number; enemyType: string; x: number; z: number };
  stage.spawnFreeze(f.x, f.z, enemyDef(f.enemyType).height);
  stage.flashEnemyShatter(f.enemyId);
  const d = Math.hypot(f.x - world.player.x, f.z - world.player.z);
  if (d < 8) stage.triggerCameraKick(0.35 * (1 - d / 8), 180); // 가까이서 얼면 화면도 움찔
});
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
/** 인지 효과음은 솎아 낸다 — 보스 포효로 열 마리가 한꺼번에 깨면 열 번 겹쳐 터진다 */
let alertSoundUntil = 0;
const ALERT_SOUND_GAP_MS = 220;
events.on('enemy_alerted', (payload) => {
  const info = payload as { enemyId?: number; enemyType: string; lantern?: boolean };
  // 머리 위 표시는 마리마다 (누가 나를 봤는지가 정보다)
  if (info.enemyId !== undefined) stage.markAlert(info.enemyId);
  // 소리는 한 번만 (겹치면 소리가 뭉개져 오히려 안 들린다).
  // 보스는 포효가 곧 인지음이므로 신호음을 겹쳐 내지 않는다
  const now = performance.now();
  const boss = enemyDef(info.enemyType).boss;
  if (!boss && now >= alertSoundUntil) {
    alertSoundUntil = now + ALERT_SOUND_GAP_MS;
    audio.play('enemy_alert');
  }
  if (info.lantern && performance.now() > lanternSpottedUntil) {
    lanternSpottedUntil = performance.now() + 4000;
    showReaction('랜턴 불빛에 들켰다', 1400);
  }
  if (!boss) return;
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
// 슬라임 식탐 — 삼킬 때 꿀렁 (게워 내는 건 죽음 파편·자석 픽업이 이미 요란하다)
events.on('slime_ate', () => audio.play('slime_windup'));
// 어미 슬라임 새끼 분리 — 크게 철퍽이며 어미 색 파편이 사방으로 튄다
events.on('boss_brood', (payload) => {
  const b = payload as { enemyType: string; x: number; z: number };
  audio.play('slime_split');
  audio.play('heavy_hit');
  stage.spawnDeathBurst(b.x, b.z, b.enemyType, 1.8);
  showReaction('어미가 새끼를 떼어냈다!', 1400);
});
// 슬라임 분열 — 젖은 파열음 + 부모 색 파편이 갈라지는 자리에서 튄다
events.on('enemy_split', (payload) => {
  const sp = payload as { parentType: string; x: number; z: number };
  audio.play('slime_split');
  stage.spawnDeathBurst(sp.x, sp.z, sp.parentType, 0.9);
});
events.on('headshot', (payload) => {
  audio.play('headshot');
  const id = (payload as { enemyId?: number }).enemyId;
  if (id !== undefined) stage.headshotFlinch(id); // 머리가 홱 젖혀진다
  showReaction('헤드샷!', 700);
});
// 헤드샷 처치 — 히트스톱(시스템이 걸었다)에 큰 파열과 묵직한 소리를 얹는다
events.on('headshot_kill', (payload) => {
  const kill = payload as { enemyType: string; x: number; z: number };
  audio.play('heavy_hit');
  stage.spawnHeadPop(kill.enemyType, kill.x, kill.z); // 머리가 떨어져 나간다
  stage.spawnDeathBurst(kill.x, kill.z, kill.enemyType, balance.weapons.headshotKillBurstScale);
  const d = Math.hypot(kill.x - world.player.x, kill.z - world.player.z);
  if (d < 14) stage.triggerCameraKick(0.35 * (1 - d / 14), 200);
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
  const sigil = info.sigilId ? ` · ${sigilDef(info.sigilId).name} 스킬` : '';
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
  const cell = payload as { row: number; col: number; x?: number; z?: number };
  stage.breakCrack(cell.row, cell.col);
  const wx = cell.x ?? (cell.col + 0.5) * world.level.cellSize;
  const wz = cell.z ?? (cell.row + 0.5) * world.level.cellSize;
  stage.spawnWallCrumble(wx, wz);
  audio.play('wall_crumble');
  const d = Math.hypot(wx - world.player.x, wz - world.player.z);
  if (d < 10) stage.triggerCameraKick(0.5 * (1 - d / 10), 260);
  minimap.rebuildBase();
  showReaction('균열 벽이 무너져 내렸다!', 3000);
});

// ---- 피격 연출 — 붉은 비네트 + 피격음 (방어 성공 시엔 방어음만) ----
const dmgDir = document.getElementById('dmgdir');
events.on('player_damaged', (payload) => {
  const hit = payload as { blocked?: boolean; srcX?: number; srcZ?: number };
  if (hit.blocked) return;
  audio.play('player_hurt');
  hurtOverlay!.style.transition = 'none';
  hurtOverlay!.style.opacity = '1';
  // 방향 피격 지시 — 시선 기준 각도로 링 조각을 돌린다: 정면 = 위, 등 뒤 = 아래 호.
  // 뒤에서 맞으면 더 진하고 오래 남는다 ("등 뒤!" — 돌아보라는 신호)
  if (dmgDir && hit.srcX !== undefined && hit.srcZ !== undefined) {
    const pl = world.player;
    const dx = hit.srcX - pl.x;
    const dz = hit.srcZ - pl.z;
    if (Math.hypot(dx, dz) > 0.001) {
      const fx = -Math.sin(pl.yaw);
      const fz = -Math.cos(pl.yaw);
      const ang = Math.atan2(-dx * fz + dz * fx, dx * fx + dz * fz); // 오른쪽 = +
      const behind = Math.abs(ang) > (Math.PI * 2) / 3;
      dmgDir.style.transition = 'none';
      dmgDir.style.transform = `rotate(${ang}rad)`;
      dmgDir.style.opacity = behind ? '1' : '0.7';
      requestAnimationFrame(() => {
        dmgDir.style.transition = `opacity ${behind ? 850 : 500}ms ease-out`;
        dmgDir.style.opacity = '0';
      });
    }
  }
  requestAnimationFrame(() => {
    hurtOverlay!.style.transition = 'opacity 450ms ease-out';
    hurtOverlay!.style.opacity = '0';
  });
});
events.on('spell_impact', () => audio.play('spell_impact'));
events.on('sigil_acquired', () => audio.play('pickup'));
events.on('sigil_duplicate', () => audio.play('pickup_gold')); // 각인이 아니라 자원을 먹은 소리
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
  const dead = payload as {
    enemyType: string; x: number; z: number; blastX?: number; blastZ?: number;
  };
  // 폭발로 죽었으면 파편이 폭심 반대쪽으로 날아간다 (살아남은 적은 몸이 밀린다)
  const launch = dead.blastX !== undefined ? balance.explosionKnockback.burstLaunch : 0;
  if (executedThisFrame) {
    // 처형 — 사망 연출도 해머가 닿는 순간까지 미룬다
    afterMs(executeContactMs, () => {
      audio.play('enemy_death');
      stage.spawnDeathBurst(dead.x, dead.z, dead.enemyType, 1.8);
    });
  } else {
    audio.play('enemy_death');
    stage.spawnDeathBurst(
      dead.x, dead.z, dead.enemyType, 1, dead.blastX ?? 0, dead.blastZ ?? 0, launch,
    );
  }
  executedThisFrame = false;
});
events.on('cast_failed', (payload) => {
  audio.play('cast_fizzle');
  const info = payload as { reason: string; cost?: number; current?: number };
  showReaction(
    info.reason === 'no_mana'
      ? `마나 부족 — ${info.cost} 필요 (패링·처형으로 모아야 한다)`
      : info.reason === 'not_implemented'
        ? '이 빌드에서는 아직 쓸 수 없는 스킬이다 — Tab 에서 다른 스킬을 올린다'
        : '빈 스킬 칸 — Tab 에서 액티브 스킬을 올린다',
    2000,
  );
});

// ---- 패링 화면 탈색 (mix-blend-mode 오버레이) ----
/** 층 이동 암전 — 계단을 내려가는 동안 검게 잠겼다가, 새 층에서 다시 밝아진다 */
const fadeOverlay = document.getElementById('fade')!;
function screenFade(to: number, durationMs: number): void {
  fadeOverlay.style.transition = `opacity ${durationMs}ms ease-in-out`;
  fadeOverlay.style.opacity = String(to);
}

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
// 소모품은 이제 줍는 순간이 아니라 쓰는 순간에 효과가 난다
const ITEM_SOUND: Record<string, 'pickup_potion' | 'pickup_mana' | 'pickup_food'> = {
  potion: 'pickup_potion',
  mana: 'pickup_mana',
  food: 'pickup_food',
};
events.on('item_picked', (payload) => {
  const kind = (payload as { kind: ItemKind }).kind;
  audio.play(ITEM_SOUND[kind] ?? 'pickup_potion');
  const def = itemDef(kind);
  const slot = world.quickslots.indexOf(kind);
  showReaction(
    `${def.name} 획득 (가방 ${countOf(world, kind)}개)${slot >= 0 ? `  [${slot + 1}번]` : ''}`,
    1100,
  );
});
events.on('item_used', (payload) => {
  const info = payload as { kind: ItemKind; healed: number; restored: number; left: number };
  audio.play(ITEM_SOUND[info.kind] ?? 'pickup_potion');
  const parts: string[] = [];
  if (info.healed > 0) parts.push(`+${Math.round(info.healed)} HP`);
  if (info.restored > 0) parts.push(`+${Math.round(info.restored)} 마나`);
  showReaction(`${parts.join('  ')}   (남은 ${info.left}개)`, 1000);
});
const DENY_TEXT: Record<string, string> = {
  empty: '빈 퀵슬롯 — Tab 에서 등록한다',
  none: '다 썼다',
  full: '이미 가득 차 있다',
  cooldown: '아직 못 쓴다',
  busy: '이미 마시는 중',
  blocking: '방패를 내려야 마신다',
};
events.on('item_denied', (payload) => {
  const info = payload as { kind?: ItemKind; reason: string };
  if (info.reason === 'cooldown') return; // 연타는 조용히 무시 — 매번 뜨면 시끄럽다
  const name = info.kind ? itemDef(info.kind).name : '';
  const deny =
    info.reason === 'empty'
      ? `빈 퀵슬롯 — ${keyLabel('I', 'inventory')} 에서 등록한다`
      : (DENY_TEXT[info.reason] ?? info.reason);
  showReaction(`${name ? name + ' — ' : ''}${deny}`, 1100);
});
events.on('item_channel_started', (payload) => {
  const kind = (payload as { kind: ItemKind }).kind;
  audio.play('door_touch'); // 뚜껑을 여는 짧은 소리 — 문 만지는 소리를 같이 쓴다
  showReaction(`${itemDef(kind).name}을 마신다…`, 1200);
});
events.on('item_channel_broken', (payload) => {
  const kind = (payload as { kind: ItemKind }).kind;
  showReaction(`${itemDef(kind).name} — 마시다 말았다`, 1200);
});
events.on('item_dropped', (payload) => {
  const info = payload as { kind: ItemKind; count: number };
  showReaction(`${itemDef(info.kind).name} ${info.count}개를 버렸다`, 1200);
});
let bagFullUntil = 0;
events.on('inventory_full', () => {
  if (performance.now() < bagFullUntil) return; // 밟고 서 있으면 매 틱 뜬다
  bagFullUntil = performance.now() + 2500;
  showReaction(`가방이 가득 찼다 — ${keyLabel('I', 'inventory')} 에서 쓰거나 버려야 한다`, 2000);
});
events.on('gold_picked', () => audio.play('pickup_gold'));
// ---- 활 ----
events.on('bow_draw_started', () => audio.play('reload_start'));
events.on('bow_draw_released', (payload) => {
  // 덜 당기고 놓은 것과 R 로 내린 것을 가른다 — 후자만 알린다
  if (!(payload as { cancelled?: boolean }).cancelled) return;
  audio.play('reload_end');
  showReaction('시위를 내렸다', 900);
});
// 방패에 막힌 화살 — 판에 꽂힌 채 남는다. 소리·번쩍임은 총알이 막힐 때와 같게
// (같은 일이 벌어진 것이므로 다른 신호를 쓸 이유가 없다)
events.on('arrow_shielded', (payload) => {
  const info = payload as { enemyId: number };
  audio.play('shot_blocked');
  stage.flashShield(info.enemyId);
  stage.stickArrowInShield(info.enemyId);
});
events.on('arrow_impact', (payload) => {
  const hit = payload as { x: number; y: number; z: number; hitEnemy: boolean };
  audio.play(hit.hitEnemy ? 'hit_flesh' : 'hit_wall');
});
let quiverFullUntil = 0;
events.on('quiver_full', () => {
  // 화살 위에 서 있으면 매 틱 뜬다 — 가방 안내와 같은 간격으로 솎는다
  if (performance.now() < quiverFullUntil) return;
  quiverFullUntil = performance.now() + 2500;
  showReaction('화살통이 가득 찼다', 1600);
});
events.on('arrow_loosed', (payload) => {
  const shot = payload as { chargeFrac: number; damage: number; remaining: number };
  audio.play('bow_twang');
  stage.triggerRecoil();
  // 풀차지일 때만 알린다 — 매 발 뜨면 잔소리가 된다
  if (shot.chargeFrac >= 0.999) showReaction(`풀차지 ${Math.round(shot.damage)}`, 700);
});
let arrowPickUntil = 0;
events.on('arrow_recovered', (payload) => {
  audio.play('pickup_gold');
  const info = payload as { arrows: number };
  if (performance.now() < arrowPickUntil) return; // 여러 대를 한 번에 주우면 시끄럽다
  arrowPickUntil = performance.now() + 500;
  showReaction(`화살 회수 (${info.arrows})`, 800);
});
events.on('arrow_broken', () => {
  if (performance.now() < arrowPickUntil) return;
  arrowPickUntil = performance.now() + 500;
  showReaction('화살이 부러졌다', 900);
});
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
const sigilToast = document.getElementById('sigil-toast')!;
const sigilToastName = sigilToast.querySelector('.name') as HTMLElement;
const sigilToastSub = sigilToast.querySelector('.sub') as HTMLElement;
let sigilToastUntil = 0;
events.on('sigil_acquired', (payload) => {
  const info = payload as {
    id: string;
    kind: 'active' | 'passive';
    attached?: boolean;
    slot: number | string;
  };
  const def = sigilDef(info.id);
  sigilToastName.textContent = `✦ ${def.name}`;
  sigilToastName.style.color = def.color;
  sigilToastName.style.textShadow = `0 0 12px ${def.color}`;
  const PART: Record<string, string> = { eye: '눈', rightArm: '오른팔', leftArm: '왼팔', heart: '심장', spine: '척추' };
  sigilToastSub.textContent =
    info.kind === 'passive'
      ? info.attached
        ? `패시브 — ${PART[def.slot] ?? def.slot}에 새겨졌다`
        : `패시브 — ${PART[def.slot] ?? def.slot}이 차 있다. Tab 에서 바꾼다`
      : typeof info.slot === 'number' && info.slot >= 0
        ? `액티브 — ${input.usingPad ? `${padBtn('cycleSkill')} 로 골라 ${padBtn('cast')}` : SKILL_KEYS[info.slot]} 로 쓴다`
        : '액티브 — Tab 에서 퀵슬롯에 올린다';
  sigilToast.classList.add('visible');
  sigilToastUntil = performance.now() + SIGIL_TOAST_MS;
});

// 이미 익힌 스킬을 또 주웠다 — 각인 대신 경험치. 같은 자리에 같은 모양으로 띄운다
events.on('sigil_duplicate', (payload) => {
  const info = payload as { id: string; xp: number };
  const def = sigilDef(info.id);
  sigilToastName.textContent = `✦ ${def.name}`;
  sigilToastName.style.color = def.color;
  sigilToastName.style.textShadow = `0 0 12px ${def.color}`;
  sigilToastSub.textContent = `이미 익힌 스킬 — 경험치 +${info.xp}`;
  sigilToast.classList.add('visible');
  sigilToastUntil = performance.now() + SIGIL_TOAST_MS;
});

events.on('player_died', () => {
  Projectiles.endChannel(world);
  if (world.godMode) return; // 무적 중에는 사망 화면도 뜨지 않는다 (자원은 틱 끝에 되돌아간다)
  // 죽은 자리에 비석 — 가방 소모품만 떨어뜨린다 (스킬·기본 무기·탄약·골드는 그대로).
  // 부활 후 그 자리로 돌아와 밟으면 되찾는다
  spillInventoryToGrave(world, world.player.x, world.player.z);
  const dk = keyLabel('Enter', 'interact');
  deathHint!.textContent = !world.respawn
    ? `${dk} 키로 재시작`
    : Math.hypot(world.respawn.x - level.spawn.x, world.respawn.z - level.spawn.z) < 0.01
      ? `${dk} — 이 층 처음부터` // 제단을 아직 안 밟았다 — 층 입구로 돌아간다
      : `${dk} — 제단에서 부활`;
  deathOverlay.classList.add('visible');
});

events.on('grave_dropped', () =>
  showReaction('유품이 비석에 남았다 — 그 자리로 돌아가면 되찾는다', 2600),
);
events.on('grave_recovered', (payload) => {
  audio.play('pickup_gold');
  showReaction(
    (payload as { partial?: boolean }).partial ? '유품 일부 회수 — 가방이 가득하다' : '유품을 모두 회수했다',
    1800,
  );
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
  world.weapon.arrows = balance.weapons.bow.ammoMax;
  world.weapon.bowDraw = 0;
  world.weapon.meleeCooldown = 0;
  world.itemChannel = null; // 마시다 죽었으면 거기서 끊는다 (아이템은 그대로 남는다)
  world.itemCooldown = 0;
  world.mana.value = 0;
  world.mana.chainIndex = 0;
  world.mana.outOfCombatTicks = 0;
  world.mana.inCombat = false;
  world.enemies = spawnEnemies(levelJson.entities, level); // 구간 진행도 초기화
  // 보스도 되살아났다 — 열쇠로 딴 적 없는 층이면 쇠사슬도 다시 잠긴다
  world.exitNeedsKey =
    world.enemies.some((e) => enemyDef(e.type).boss) && !unlockedFloors.has(floorIndex);
  world.hasExitKey = false;
  world.exitOpen = false;
  // 폭발통도 되살린다 — 남은 차단 블록을 먼저 걷어내야 유령 벽이 쌓이지 않는다
  for (const barrel of world.barrels) if (barrel.blocker) level.removeBlocker(barrel.blocker);
  world.barrels = spawnBarrels(levelJson.entities, level);
  for (const chest of world.chests) if (chest.blocker) level.removeBlocker(chest.blocker);
  world.chests = spawnChests(levelJson.entities, level);
  world.chestInView = null;
  world.projectiles.length = 0;
  world.gooPuddles = []; // 점액은 층/판에 속한다 — 새 판에 들고 가지 않는다
  // 바닥 보상은 리셋하되 비석만은 남긴다 — 유품은 다시 죽어도 그 자리에 있다
  world.groundItems = world.groundItems.filter((g) => g.kind === 'grave');
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
/** 테스트 — 구현된 스킬을 전부 익힌다. 패시브는 빈 부위에 새겨지고 액티브는 빈 칸에
 *  올라간다(4종이라 칸 4개에 딱 맞는다). 오염 대기는 되돌려 밸런스 검증을 더럽히지 않는다 */
function grantAllSkills(): number {
  const pendingBefore = world.corruption.pending;
  let granted = 0;
  for (const id of allSigilIds()) {
    const def = sigilDef(id);
    if (!isImplemented(def)) continue;
    if (world.sigils.inventory.includes(id)) continue;
    Sigils.acquire(world, id);
    granted++;
  }
  world.corruption.pending = pendingBefore;
  // 모드를 켠다 — 시뮬레이션이 매 틱 마나를 최대치로 되돌려 소비가 무효가 된다
  world.skillTestMode = true;
  world.mana.value = balance.mana.max;
  return granted;
}

function restartAfterDeath(): void {
  if (world.respawn) respawnAtAltar();
  else location.reload();
}
window.addEventListener('keydown', (e) => {
  if (e.code === 'Enter' && world.dead) restartAfterDeath();
});

// ---- 제단 ----
events.on('life_mote_absorbed', () => audio.play('pickup'));

events.on('altar_entered', () => {
  audio.play('altar_enter');
  shopUI.show(); // 보급 상점 — 무료 보급은 없다. Tab 으로 각인 교체
  setUiOpen(true);
});
const SHOP_LABEL: Record<string, string> = {
  heal: '체력 물약', mana: '마나 물약', ammo: '권총탄', arrow: '화살',
  grenade: '수류탄', battery: '배터리',
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
        ? `${label} — ${deny.item === 'heal' || deny.item === 'mana' ? '가방이 가득 찼다' : '이미 가득 찼다'}`
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
events.on('boss_staggered', () =>
  showReaction(`보스 스태거 — 지금 처형! (${input.usingPad ? padBtn('melee') : 'Space·우클릭'})`),
);
// 이제 exit_opened 는 "보스 없는(또는 이미 딴) 층" 의 로드 직후 신호다 — 조용히 안내만
events.on('exit_opened', () => {
  showReaction('내려가는 계단 — E 로 내려간다', 2200);
});
events.on('exit_key_dropped', () => showReaction('족장이 열쇠를 떨어뜨렸다', 2600));
events.on('exit_key_picked', () => {
  audio.play('pickup_gold');
  showReaction('족장의 열쇠 — 출구의 자물쇠를 열 수 있다', 3200);
});
events.on('exit_unlocked', () => {
  unlockedFloors.add(floorIndex); // 오르내려도·부활해도 다시 잠기지 않는다
  audio.play('unlock_chain');
  showReaction('자물쇠가 열렸다 — 쇠사슬이 흘러내린다', 2600);
});
events.on('exit_locked', (payload) => {
  // E 로 흔들어 봤을 때만 소리를 낸다 — 밟기만 해도 짤그랑거리면 시끄럽다
  if ((payload as { tried?: boolean }).tried) audio.play('chain_locked');
});
// ---- 잠긴 문 (E 로 직접 연다) ----
events.on('door_channel_started', () => audio.play('door_touch'));
events.on('door_unlocked', (payload) => {
  const at = payload as { x: number; z: number };
  audio.play('door_slide');
  stage.triggerFlash(at.x, 1.2, at.z, 0x9a7a4a, 220, 2);
  showReaction('잠금이 풀렸다 — 문이 옆으로 밀린다', 2200);
});
events.on('lever_pulled', (payload) => {
  const info = payload as { lever: { row: number; col: number } };
  audio.play('lever_pull');
  stage.pullLever(info.lever.row, info.lever.col);
  showReaction('레버를 당겼다 — 어딘가에서 관문이 갈리며 열린다', 3200);
});
let needsLeverUntil = 0;
events.on('door_needs_lever', () => {
  if (performance.now() < needsLeverUntil) return; // E 를 두들기면 매 틱 뜬다
  needsLeverUntil = performance.now() + 2000;
  audio.play('shop_deny');
  showReaction('손으로는 안 열린다 — 어딘가의 레버를 찾아야 한다', 2000);
});
events.on('door_opened', (payload) => {
  const at = payload as { row: number; col: number };
  const opened = world.doors.find((d) => d.row === at.row && d.col === at.col);
  stage.openDoor(at.row, at.col, opened?.swingDir ?? 1);
  minimap.rebuildBase();
});
/** 층을 갈아 끼운다 — 처음 밟는 층은 새로 짓고, 와 본 층은 얼려 둔 그대로 되살린다.
 *  들고 있던 것(체력·마나·탄약·스킬·가방·골드·오염·열쇠)은 전부 따라간다 */
function loadFloor(index: number, arrival: 'entrance' | 'exit' = 'entrance'): void {
  // 떠나는 층을 얼려 둔다
  floorStates.set(floorIndex, {
    level,
    enemies: world.enemies,
    barrels: world.barrels,
    chests: world.chests,
    doors: world.doors,
    groundItems: world.groundItems,
    lifeMotes: world.lifeMotes,
    pulledLevers: world.pulledLevers,
  });

  floorIndex = index;
  levelJson = ZONE[index]!;
  traveling = false;

  const saved = floorStates.get(index);
  if (saved) {
    // 와 본 층 — 재소환하지 않는다. 죽인 적은 죽은 채로다
    level = saved.level;
    world.level = level;
    world.enemies = saved.enemies;
    world.barrels = saved.barrels;
    world.chests = saved.chests;
    world.doors = saved.doors;
    world.groundItems = saved.groundItems;
    world.lifeMotes = saved.lifeMotes;
    world.pulledLevers = saved.pulledLevers;
  } else {
    // 처음 밟는 층 — 새로 짓는다. 앞 층의 차단 블록은 그 층 Level 과 함께 얼었다
    level = new Level(levelJson);
    world.level = level;
    world.enemies = spawnEnemies(levelJson.entities, level);
    world.barrels = spawnBarrels(levelJson.entities, level);
    world.chests = spawnChests(levelJson.entities, level);
    world.doors = level.doors.map((d) => ({
      row: d.row, col: d.col, x: d.x, z: d.z, dirX: d.dirX, dirZ: d.dirZ,
      byLever: d.byLever, progress: 0, slide: 0, prevSlide: 0, opened: false,
    }));
    // 새 배열로 갈아 끼운다 — .length = 0 으로 비우면 얼려 둔 앞 층 것까지 지워진다
    world.groundItems = [];
    world.lifeMotes = [];
    world.pulledLevers = new Set();
  }
  world.projectiles.length = 0;
  world.gooPuddles = []; // 점액은 층/판에 속한다 — 새 판에 들고 가지 않는다

  // 도착 지점 — 내려왔으면 입구 계단 앞, 올라왔으면 출구 계단 앞
  const at = arrival === 'exit' && level.exitPos ? level.exitPos : level.spawn;
  const atYaw = arrival === 'exit' && level.exitPos ? level.exitYaw : level.spawnYaw;

  world.chestInView = null;
  world.doorInView = null;
  world.leverInView = null;
  world.altarInView = false;
  world.altarEnteredThisApproach = false;
  // 도착한 계단이 곧 부활 지점이다 — 3층에서 죽었다고 1층부터 다시 하게 만들지 않는다.
  // 제단을 밟으면 그쪽으로 옮겨 가므로 제단은 여전히 "더 가까운 저장점" 값을 한다
  world.respawn = { x: at.x, z: at.z };
  // 출구 잠금 — 보스가 배치된 층에서 아직 열쇠로 딴 적이 없으면 잠긴다.
  // 살아 있는지가 아니라 "딴 적 있는지" 가 기준이다: 보스를 죽이고 열쇠를 안 쓴 채
  // 오가도 사슬은 그대로 걸려 있어야 한다 (열쇠도 손에/바닥에 그대로 있다)
  world.exitNeedsKey =
    levelJson.entities.some(
      (e) => e.type !== 'barrel' && e.type !== 'chest' && enemyDef(e.type).boss,
    ) && !unlockedFloors.has(index);
  world.canAscend = index > 0;
  world.onEntrancePad = false;
  world.exitOpen = false; // 잠기지 않은 층은 Exit 의 첫 틱이 열어 준다
  world.onExitPad = false;
  world.exitLockedNotified = false;
  world.cleared = false;
  world.freezeTicks = 0;

  const p = world.player;
  p.x = at.x;
  p.z = at.z;
  p.prevX = at.x;
  p.prevZ = at.z;
  p.yaw = atYaw; // 도착하자마자 등 뒤 계단을 보고 있으면 안 된다
  p.pitch = 0;
  p.stunTicks = 0;
  p.dodgeTicks = 0;
  p.iframeTicks = 0;
  Projectiles.endChannel(world);
  // 출구에서 누른 그 E 가 새 층에서 한 번 더 먹히지 않게 한다
  world.input = { ...world.input, interactPressed: false, meleePressed: false };

  stage.setLevel(
    buildLevelGroup(level, {
      color: balance.lighting.torchColor,
      intensity: balance.lighting.torchIntensity,
      distance: balance.lighting.torchDistance,
      height: balance.lighting.torchHeight,
      wallOffset: balance.lighting.torchWallOffset,
    }),
    level.ambient,
  );
  // 얼려 둔 층 — 열린 문은 열린 자세로, 당긴 레버는 당긴 자세로 되돌린다
  for (const door of world.doors) {
    if (door.opened) stage.openDoor(door.row, door.col, door.swingDir ?? 1);
  }
  for (const pulled of world.pulledLevers) {
    const [row, col] = pulled.split('-').map(Number);
    if (row !== undefined && col !== undefined) stage.pullLever(row, col);
  }
  minimap.setLevel(level);
  // 해독은 오염 단계에 딸린 상태다 — 새 층 벽에도 그대로 적용해 준다.
  // (setGlyphsReadable 은 씬을 훑으므로 층을 갈아 끼운 뒤 한 번 더 불러야 한다)
  stage.setGlyphsReadable(world.corruption.applied >= (balance.corruption.thresholds[0] ?? 25));
  events.emit('floor_entered', { index, id: levelJson.id, name: levelJson.name, total: ZONE.length });
}

events.on('zone_cleared', () => {
  // 내려갔다는 것은 자물쇠가 열려 있었다는 뜻 — 어떤 경로로 열렸든 여기서 못 박는다.
  // (E 언락 이벤트 한 곳에만 의존하면, 흐름을 우회한 층이 되돌아올 때 다시 잠겨 보인다)
  unlockedFloors.add(floorIndex);
  // 마지막 층이 아니면 나가는 게 아니라 내려가는 것이다.
  // 계단을 밟고 내려가는 동안 화면이 잠기고, 다 잠긴 뒤에 층을 갈아 끼운다 —
  // 그래야 지형이 바뀌는 순간이 안 보인다
  if (floorIndex + 1 < ZONE.length) {
    traveling = true;
    audio.play('stairs_travel');
    // 어디를 보고 있었든 출구 계단 입 쪽으로 몸을 돌리며 내려간다
    stage.startDescent(DESCENT_MS, 1, level.exitYaw + Math.PI);
    screenFade(1, DESCENT_MS);
    afterMs(DESCENT_MS + 40, () => {
      loadFloor(floorIndex + 1);
      screenFade(0, DESCENT_FADE_IN_MS);
    });
    return;
  }
  audio.play('zone_clear');
  deathHint!.textContent = '';
  const clearOverlay = deathOverlay!;
  clearOverlay.querySelector('div')!.textContent = '1구역 클리어';
  (clearOverlay as HTMLElement).style.background = 'rgba(10, 40, 20, 0.6)';
  clearOverlay.classList.add('visible');
});

// 입구 계단으로 위층에 되돌아간다 — 내려갈 때와 같은 연출, 방향만 반대
events.on('floor_ascend', () => {
  if (floorIndex === 0 || traveling) return;
  traveling = true;
  audio.play('stairs_travel');
  // 입구 계단 입 쪽으로 몸을 돌리며 올라간다
  stage.startDescent(DESCENT_MS, -1, level.spawnYaw + Math.PI);
  screenFade(1, DESCENT_MS);
  afterMs(DESCENT_MS + 40, () => {
    loadFloor(floorIndex - 1, 'exit');
    screenFade(0, DESCENT_FADE_IN_MS);
  });
});

// 새 층에 발을 디뎠다 — 어디인지 알려 준다
events.on('floor_entered', (payload) => {
  const f = payload as { index: number; name: string; total: number };
  audio.play('door_slide');
  showReaction(`${f.name}  (${f.index + 1}/${f.total})`, 2600);
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
LifeMotes.init(world);
Projectiles.init(world);
initInventory(world);
Progression.init(world);
Corruption.init(world);
Stamina.init(world);
Exit.init(world); // 보스가 죽으면 열쇠를 떨군다
Enemies.init(world); // 공격 행동 소음 — 시전·휘두름이 코앞의 적을 깨운다
const systems = [
  PlayerMove.tick,
  Enemies.tick,
  Reaction.tick,
  Sigils.tick,
  Pickups.tick,
  LifeMotes.tick,
  Items.tick,
  Weapons.tick,
  Projectiles.tick,
  Barrels.tick, // 같은 틱에 쏜 화염구·던진 수류탄이 통을 터뜨릴 수 있게 뒤에 둔다
  Mana.tick,
  Altar.tick,
  Door.tick,
  Lever.tick,
  Chest.tick,
  Exit.tick,
  Lantern.tick,
  Stamina.tick, // 소모하는 쪽(PlayerMove·Reaction) 뒤에서 회복한다
];

function simulate(dt: number): void {
  world.input = input.sample();

  // 한 키 체계 — 근접·처형과 상호작용은 논리적으로 한 키다.
  // 상호작용 대상 앞에서는 근접 키가 상호작용이 되고(1순위),
  // 대상이 없으면 상호작용 키가 근접·처형이 된다. *_InView 는 지난 틱에
  // 시스템들이 계산한 값이라 한 틱(16ms) 늦지만 체감할 수 없다.
  // 레버 관문(byLever)은 손으로 못 여니 대상으로 안 친다 — 관문 앞 전투에서
  // 근접이 헛손질로 바뀌면 안 된다. 봉인된 출구도 같은 이유로 제외.
  if (!world.dead && !world.uiOpen) {
    const interactable =
      (world.doorInView !== null && !world.doorInView.byLever) ||
      world.leverInView !== null ||
      world.chestInView !== null ||
      (world.altarInView && !world.altarEnteredThisApproach) ||
      world.onEntrancePad ||
      (world.onExitPad && (world.exitOpen || world.exitNeedsKey));
    if (interactable && world.input.meleePressed) {
      world.input = { ...world.input, meleePressed: false, interactPressed: true };
    } else if (!interactable && world.input.interactPressed && !world.input.meleePressed) {
      world.input = { ...world.input, interactPressed: false, meleePressed: true };
    }
  }

  // Menu 버튼 = Tab. 가방·각인 창은 스냅샷을 안 거치는 raw 입력이라 여기서 본다.
  // 렌더 루프에서 읽으면 안 된다 — 폴링은 틱에서 도는데 렌더는 다른 속도로 돌아
  // 같은 엣지를 두 프레임이 먹고 창이 열렸다 곧바로 닫힌다 (실측으로 확인)
  // View = 일시정지. 패드만 쓰는 사람이 메뉴·키 설정에 오는 유일한 길이다
  if (input.gamepad.pressed('pause') && !world.uiOpen && !world.dead && !world.cleared) {
    setPaused(true);
    return;
  }
  // Menu 는 창이 하나뿐인 패드를 위해 순환한다: 닫힘 → 가방 → 스킬 → 닫힘
  if (input.gamepad.pressed('inventory')) {
    if (shopUI.open) {
      shopUI.hide();
      setUiOpen(skillUI.toggle(true));
    } else if (inventoryUI.open) {
      inventoryUI.hide();
      setUiOpen(skillUI.toggle());
    } else if (skillUI.open) {
      skillUI.hide();
      setUiOpen(false);
    } else {
      setUiOpen(inventoryUI.toggle());
    }
  }
  // 상점 — 일시정지 메뉴와 같은 고정 버튼 규약. uiOpen 중엔 게임 시스템이 다
  // 멈춰 있어서 A·B 가 상호작용·회피로 새지 않는다
  if (shopUI.open && input.gamepad.connected) {
    shopUI.padMode = input.usingPad;
    if (input.gamepad.rawPressed(13)) shopUI.padMove(1); // D-패드 ↓
    else if (input.gamepad.rawPressed(12)) shopUI.padMove(-1); // D-패드 ↑
    else if (input.gamepad.rawPressed(0)) shopUI.padBuy(); // A
    else if (input.gamepad.rawPressed(1)) shopUI.padClose(); // B
  }
  if (world.dead && input.gamepad.pressed('interact')) restartAfterDeath();

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
    // 스킬 테스트 — 마나만 무한. 무적과 같은 자리·같은 방식 (시스템은 손대지 않는다)
    if (world.skillTestMode) world.mana.value = balance.mana.max;
  } else {
    // 시스템이 멈춘 사이(사망·창 열림·클리어) 채널이 스스로 못 끊는다 —
    // 그냥 두면 빔이 화면에 얼어붙고 전류음이 남는다
    Projectiles.endChannel(world);
  }
  world.tick++;
  tpsWindowTicks++;
}

/** 무적 중 되돌릴 자원 — 골드·경험치는 제외한다 (상점을 시험할 수 없게 된다) */
function snapshotResources(): {
  health: number; mana: number; mag: number; reserve: number; grenades: number;
  arrows: number; battery: number; spares: number; stamina: number; exhausted: boolean;
} {
  return {
    health: world.player.health,
    mana: world.mana.value,
    mag: world.weapon.mag,
    reserve: world.weapon.reserve,
    grenades: world.weapon.grenades,
    arrows: world.weapon.arrows ?? 0,
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
  world.weapon.arrows = keep.arrows;
  world.lantern.battery = keep.battery;
  world.lantern.spares = keep.spares;
  world.stamina.value = keep.stamina;
  world.stamina.exhausted = keep.exhausted;
  world.dead = false; // 이번 틱에 죽었더라도 없던 일로
}

function spellHudText(): string {
  return world.skillSlots
    .map((id, i) => `${SKILL_KEYS[i]} ${id ? sigilDef(id).name : '-'}`)
    .join('  ');
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

// 층 이동 — 계단을 내려가는 시간과, 새 층에서 화면이 밝아지는 시간
const DESCENT_MS = 1500;
const DESCENT_FADE_IN_MS = 650;

// ---- 사선 십자 퀵슬롯 ----
// 마름모 넷을 위·오른쪽·아래·왼쪽에 놓는다 (시계 방향 = 1·2·3·4번 칸).
// 칸은 한 번만 만들고 이후에는 값만 바꾼다 (매 프레임 DOM 을 다시 그리면 낭비다)
const QUICK_ICON_PX = 22;

/** 마름모 칸 한 개 — 테두리(frame)만 45도 돌리고 안의 글자·아이콘은 세워 둔다 */
function makeDiamondSlot(
  parent: HTMLElement,
  index: number,
  keyLabel: string,
): { cell: HTMLElement; frame: HTMLElement; key: HTMLElement; body: HTMLElement; num: HTMLElement } {
  const cell = document.createElement('div');
  cell.className = `dslot p${index} empty`;
  const frame = document.createElement('div');
  frame.className = 'frame';
  const fill = document.createElement('div');
  fill.className = 'fill';
  frame.appendChild(fill);
  const key = document.createElement('div');
  key.className = 'key';
  key.textContent = keyLabel;
  const body = document.createElement('div');
  body.className = 'body';
  const num = document.createElement('div');
  num.className = 'num';
  cell.append(frame, key, body, num);
  parent.appendChild(cell);
  return { cell, frame, key, body, num };
}

const quickPad = document.getElementById('quick-diamond')!;
const quickLabel = quickPad.querySelector('.label') as HTMLElement;
const quickCells = Array.from({ length: balance.items.quickslots }, (_, i) => {
  const ui = makeDiamondSlot(quickPad, i, String(i + 1));
  // 아이콘 SVG 는 종류가 바뀔 때만 갈아 끼운다 — 매 프레임 innerHTML 을 쓰면 낭비다
  let shownKind: ItemKind | null = null;
  return {
    ...ui,
    setKind(kind: ItemKind | null): void {
      if (shownKind === kind) return;
      shownKind = kind;
      ui.body.innerHTML = kind ? itemIconSvg(kind, QUICK_ICON_PX) : '';
    },
  };
});

const skillPad = document.getElementById('skill-diamond')!;
const skillLabel = skillPad.querySelector('.label') as HTMLElement;
const skillCells = Array.from({ length: balance.skills.quickslots }, (_, i) => {
  const ui = makeDiamondSlot(skillPad, i, SKILL_KEYS[i] ?? String(i + 1));
  const mark = document.createElement('span');
  mark.className = 'mark';
  ui.body.appendChild(mark);
  return { ...ui, mark };
});

/** 스킬 퀵슬롯 — 마름모 안은 색 원반과 키 하나뿐이라, 고른 칸의 이름만 뭉치 위에 적는다.
 *  마나가 모자라거나 쿨다운이면 원반이 바래고, 쿨다운은 마름모가 비스듬히 차오른다 */
function syncSkillSlots(): void {
  world.skillSlots.forEach((id, i) => {
    const ui = skillCells[i];
    if (!ui) return;
    const selected = world.selectedSkill === i;
    if (!id) {
      ui.cell.className = `dslot p${i} skill empty${selected ? ' selected' : ''}`;
      ui.mark.style.background = '';
      ui.frame.style.setProperty('--fill', '0%');
      ui.num.textContent = '';
      return;
    }
    const def = sigilDef(id);
    const cost =
      def.effects['manaCost'] ?? balance.spellCost[def.tier as keyof typeof balance.spellCost] ?? 0;
    const cdLeft = Projectiles.skillCooldown(world, id);
    const cdMax = def.effects['cooldownTicks'] ?? 0;
    const cooling = cdLeft > 0;
    const noMana = world.mana.value < cost;
    ui.cell.className =
      `dslot p${i} skill ${!def.cast ? 'empty' : cooling ? 'cool' : noMana ? 'nomana' : 'ready'}` +
      (selected ? ' selected' : '');
    ui.mark.style.background = def.color;
    ui.mark.style.boxShadow = def.cast && !noMana && !cooling ? `0 0 8px ${def.color}` : 'none';
    // 쿨다운이 1초를 넘으면 남은 초를 적는다 — 짧은 건 차오름만으로 충분하다
    ui.num.textContent = cooling && cdLeft > balance.loop.tickRate ? String(Math.ceil(cdLeft / balance.loop.tickRate)) : '';
    ui.frame.style.setProperty('--fill', cooling && cdMax > 0 ? `${(cdLeft / cdMax) * 100}%` : '0%');
  });
  const chosen = world.skillSlots[world.selectedSkill];
  if (chosen) {
    const def = sigilDef(chosen);
    skillLabel.textContent = def.name;
    skillLabel.style.color = def.color;
  } else {
    skillLabel.textContent = '';
  }
}

function syncQuickslots(): void {
  const view = quickslotView(world);
  const cdFrac = world.itemCooldown / balance.items.useCooldownTicks;
  const channel = world.itemChannel;
  const chFrac = Items.channelFrac(world);
  let labelText = '';
  view.forEach((slot, i) => {
    const ui = quickCells[i];
    if (!ui) return;
    if (!slot.kind) {
      ui.cell.className = `dslot p${i} item empty`;
      ui.setKind(null);
      ui.num.textContent = '';
      ui.frame.style.setProperty('--fill', '0%');
      return;
    }
    // 다 썼거나 지금 마셔 봐야 소용없는 칸은 흐리게 — 급할 때 눈이 안 간다
    const dim = slot.count <= 0 || !slot.useful;
    const drinking = channel?.index === i;
    ui.cell.className = `dslot p${i} item ${dim ? 'spent' : 'ready'}${drinking ? ' drinking' : ''}`;
    ui.setKind(slot.kind);
    ui.num.textContent = String(slot.count);
    // 마시는 중인 칸이 차오른다. 아니면 공용 쿨다운이 차오른다 —
    // 마름모 하나에 띠를 따로 두기엔 좁아서 차오름 하나로 둘을 겸한다
    ui.frame.style.setProperty(
      '--fill',
      drinking ? `${chFrac * 100}%` : cdFrac > 0 && !dim ? `${cdFrac * 100}%` : '0%',
    );
    if (drinking) labelText = balance.items.kinds[slot.kind].name;
  });
  quickLabel.textContent = labelText;
}


function render(alpha: number): void {
  const now = performance.now();
  // 패드는 sample() 에서만 폴링되는데 그건 일시정지 중엔 안 돈다 —
  // 그대로 두면 패드만 쓰는 사람은 멈춘 게임을 풀 방법이 없다 (포인터 락도 못 잡는다).
  // 멈춰 있는 동안에는 여기서 대신 폴링해 메뉴를 조작하게 한다
  if (loop.isPaused) pollPadWhilePaused();
  runDelayedFx(now);
  if (now - tpsWindowStart >= 1000) {
    measuredTps = tpsWindowTicks / ((now - tpsWindowStart) / 1000);
    tpsWindowStart = now;
    tpsWindowTicks = 0;
  }

  // 문 여닫힘 — 진행률을 경첩 회전각으로 바꾼다. 틱 사이는 alpha 로 보간한다
  // (0.75초에 걸쳐 도니 보간이 없으면 계단처럼 끊긴다)
  for (const door of world.doors) {
    if (door.opened || door.slide <= 0) continue;
    stage.setDoorSwing(
      door.row,
      door.col,
      (door.prevSlide + (door.slide - door.prevSlide) * alpha) * (door.swingDir ?? 1),
    );
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
  stage.syncGoo(world.gooPuddles, balance.goo.lifeTicks);
  stage.syncProjectiles(world.projectiles, alpha);
  stage.syncGroundItems(world.groundItems);
  stage.syncLifeMotes(world.lifeMotes);
  stage.syncBarrels(world.barrels);
  stage.syncChests(world.chests);
  const chargeFrac =
    world.weapon.ranged === 'grenade' && world.weapon.grenadeCharge > 0
      ? world.weapon.grenadeCharge / balance.weapons.grenade.maxChargeTicks
      : 0;
  // 활 당김은 chargeFrac 과 따로 둔다 — 화살은 직선이라 투척 궤적을 띄우면 안 되고,
  // 궤적 미리보기가 chargeFrac 을 보고 그려진다
  const bowDrawFrac =
    world.weapon.ranged === 'bow'
      ? (world.weapon.bowDraw ?? 0) / balance.weapons.bow.maxDrawTicks
      : 0;
  // 왼손에 든 원거리 무기 (오른손 해머는 항상 보인다)
  stage.setHandWeapon(world.weapon.ranged);
  stage.updateHands({
    reloading: world.weapon.reloading > 0,
    stunned: p.stunTicks > 0,
    blocking: p.blocking,
    chargeFrac,
    bowDrawFrac,
    doorFrac: Door.channelFrac(world),
    drinkFrac: Items.channelFrac(world),
    drinkColor: world.itemChannel ? itemColor(world.itemChannel.kind) : undefined,
    // 손에 직접 띄우는 수치 — 왼손 탄약 / 오른손 연타 단계
    ammoText:
      world.weapon.ranged === 'pistol'
        ? world.weapon.reloading > 0
          ? '↻'
          : String(world.weapon.mag)
        : world.weapon.ranged === 'bow'
          ? String(world.weapon.arrows ?? 0)
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
  manaRow.classList.toggle('skilltest', world.skillTestMode && !world.godMode);
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
  syncQuickslots();
  syncSkillSlots();
  // 원거리(좌클릭) / 근접(우클릭) 두 슬롯. 원거리는 휠로 교체
  const bowDraw = wpn.bowDraw ?? 0;
  const drawPips = bowDraw > 0
    ? `  ${'▮'.repeat(Math.round((bowDraw / balance.weapons.bow.maxDrawTicks) * 6)).padEnd(6, '▯')}`
    : '';
  const RK = keyLabel('LMB', 'ranged');
  document.getElementById('slot-ranged')!.textContent =
    wpn.ranged === 'pistol'
      ? `${RK} 권총 ${wpn.mag}/${wpn.reserve}${wpn.reloading > 0 ? ' …' : ''}`
      : wpn.ranged === 'bow'
        ? `${RK} 활 ×${wpn.arrows ?? 0}${drawPips}`
        : `${RK} 수류탄 ×${wpn.grenades}`;
  // 연속타 단계 — 다음 타가 강타면 눈에 띄게 표시
  const step = wpn.comboTimer > 0 ? wpn.comboStep : 0;
  const finisher = balance.weapons.hammer.combo.finisherStep;
  const pips = '●'.repeat(step) + '○'.repeat(Math.max(0, finisher - 1 - step));
  const meleeSlot = document.getElementById('slot-melee')!;
  meleeSlot.textContent = `${keyLabel('RMB', 'melee')} ${wpn.melee === 'hammer' ? '해머' : wpn.melee} ${pips}`;
  meleeSlot.className = `weapon-slot active${step >= finisher - 1 ? ' charged' : ''}`;

  // 디버그 오버레이 (F1) — 0.5초마다 갱신
  if (debugOverlay.visible && now - debugOverlayLastUpdate > 500) {
    debugOverlayLastUpdate = now;
    debugOverlay.update(metrics.snapshot(world));
  }

  // 제단/문 프롬프트 — 상호작용 가능한 것 안내
  const nearDoor = world.doorInView !== null && !world.dead && !world.uiOpen;
  const nearLever = world.leverInView !== null && !world.dead && !world.uiOpen;
  const showAltarPrompt =
    world.altarInView && !world.altarEnteredThisApproach && !world.uiOpen && !world.dead;
  // 출구 발판 위 — 서 있는 동안 계속 띄운다 (3초 뒤 사라지면 못 보고 지나친다).
  // 봉인 중이면 이유를, 열렸으면 나가는 방법을 알린다
  const onExit = world.onExitPad && !world.dead && !world.uiOpen && !world.cleared;
  const onEntrance = world.onEntrancePad && !world.dead && !world.uiOpen && !world.cleared;
  const nearChest = world.chestInView !== null && !world.dead && !world.uiOpen;
  altarPrompt!.classList.toggle(
    'visible',
    showAltarPrompt || nearDoor || nearLever || onExit || onEntrance || nearChest,
  );
  // 상호작용 키 표기 — 한 키 체계라 근접 키를 안내한다 (E 도 여전히 동작한다)
  const IK = keyLabel('우클릭', 'melee');
  // 사망 화면 힌트 — 죽은 뒤에 패드를 집거나 내려놔도 표기가 따라온다
  if (world.dead) {
    const dk = keyLabel('Enter', 'interact');
    deathHint!.textContent = !world.respawn
    ? `${dk} 키로 재시작`
    : Math.hypot(world.respawn.x - level.spawn.x, world.respawn.z - level.spawn.z) < 0.01
      ? `${dk} — 이 층 처음부터` // 제단을 아직 안 밟았다 — 층 입구로 돌아간다
      : `${dk} — 제단에서 부활`;
  }
  if (showAltarPrompt) {
    altarPrompt!.textContent =
      `제단 — ${IK} 보급 상점\n` +
      `◆ ${world.gold} 소지 · 체력·마나·탄약·수류탄·배터리를 산다 (무료 보급 없음)\n` +
      `오염 +${world.corruption.pending} 정산 · 리스폰 지점 등록`;
  } else if (nearChest) {
    altarPrompt!.textContent = `${IK} — 보물상자를 연다`;
  } else if (nearLever) {
    altarPrompt!.textContent = `${IK} — 레버를 당긴다 (보스 아레나 북쪽 관문이 열린다)`;
  } else if (nearDoor) {
    // 진행 게이지를 프롬프트 안에 그려 준다 — 손 동작만으로는 얼마나 남았는지 모른다
    const frac = Door.channelFrac(world);
    altarPrompt!.textContent = world.doorInView!.byLever
      ? '관문 — 손으로는 안 열린다. 어딘가의 레버를 찾아야 한다'
      : frac > 0
        ? `잠금을 푸는 중\n${'█'.repeat(Math.round(frac * 20)).padEnd(20, '░')}  ${Math.round(frac * 100)}%\n문에서 떨어지면 처음부터`
        : `${IK} — 문을 연다 (누른 채 기다릴 필요 없이 문 앞에 서 있으면 된다)`;
  } else if (onExit) {
    // 마지막 층에서만 "나간다" 다 — 그 앞은 아래층으로 내려가는 계단이다
    const last = floorIndex + 1 >= ZONE.length;
    altarPrompt!.textContent = world.exitNeedsKey
      ? world.hasExitKey
        ? `${IK} — 열쇠로 자물쇠를 연다`
        : '쇠사슬이 잠겨 있다 — 이 층의 주인이 열쇠를 쥐고 있다'
      : last
        ? `${IK} — 구역을 벗어난다`
        : `${IK} — 아래층으로 내려간다  (${floorIndex + 2}/${ZONE.length})`;
  } else if (onEntrance) {
    altarPrompt!.textContent = `${IK} — 위층으로 올라간다  (${floorIndex}/${ZONE.length})`;
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
    // 패링 카운터가 있는 보스(족장)만 스트릭을 보여 준다 — 어미 슬라임은 패링이 없다
    const streak =
      def.parriesToStagger !== undefined ? `  [패링 ${boss.parryStreak ?? 0}/${def.parriesToStagger}]` : '';
    bossLine = `${def.name ?? '보스'}${stage2} ${bar} ${Math.max(0, Math.round(boss.health))}/${def.health}${streak}\n`;
  }
  // HP·마나·랜턴은 하단 게이지가 이미 보여 준다 — 위에서 숫자로 겹쳐 읽지 않는다.
  // 연쇄 배율만은 어디에도 안 나오므로 spell 줄로 옮겨 살려 둔다
  const mana = world.mana;
  const chainMult = balance.chain.multipliers[Math.min(mana.chainIndex, balance.chain.multipliers.length - 1)]!;
  const hudText =
    `tick ${world.tick}  (${measuredTps.toFixed(1)}/s)\n` +
    // 좌표 — 월드(m)와 격자 칸 [행,열]. 칸 표기는 레벨 JSON entities/torches 와 같은 규약이라
    // "이 자리 이상해" 를 그대로 데이터 좌표로 옮길 수 있다
    `위치 ${floorIndex + 1}층  (${p.x.toFixed(1)}, ${p.z.toFixed(1)})  칸 [${Math.floor(p.z / level.cellSize)},${Math.floor(p.x / level.cellSize)}]\n` +
    `9mm ${w.mag}/${w.reserve}${w.reloading > 0 ? '  [장전중]' : ''}${p.stunTicks > 0 ? '  [경직]' : ''}${p.blocking ? '  [방어]' : ''}\n` +
    `spell ${spellHudText()}   스킬 ${world.sigils.inventory.length}개   chain ×${chainMult}\n` +
    `corruption ${world.corruption.applied}${world.corruption.pending > 0 ? ` (+${world.corruption.pending} 대기)` : ''}/100${world.canReadGlyphs ? '  [해독]' : ''}\n` +
    bossLine +
    `enemies ${aliveCount}${reactionLabel ? `   ${reactionLabel}` : ''}${world.godMode ? '   [무적]' : ''}${world.skillTestMode ? '   [스킬 테스트]' : ''}\n` +
    (input.pointerLocked ? '' : '[클릭] 마우스 잠금\n') +
    (input.usingPad
      ? `좌스틱 이동  R스틱 시선  ${padBtn('sprint')} 질주  ${padBtn('dodge')} 회피  ${padBtn('ranged')} 원거리(${padBtn('cycleWeapon')} 교체)  ${padBtn('melee')} 근접·처형·상호작용  ${padBtn('reaction')} 짧게=패링·꾹=방어\n` +
        `${padBtn('cycleSkill')} 스킬 교체  ${padBtn('cast')} 스킬 사용  D-패드 소모품  ${padBtn('inventory')} 가방→스킬  ${padBtn('reload')} 장전(활=시위 내림)  ${padBtn('lantern')} 랜턴(길게=배터리)  ${padBtn('pause')} 일시정지·키 설정`
      : 'WASD 이동  Space 질주(연타=회피)  좌클릭 원거리(휠 교체)  우클릭 근접·처형·상호작용  Shift 짧게=패링·꾹=방어\n' +
        'Z·X·C·V 스킬  Q 스킬 교체·휠클릭 사용  1~5 소모품  Tab 스킬  I 가방  R 장전(활=시위 내림)  F 랜턴  B 배터리  M 미니맵  F1 지표  F2 덤프  F3 다시하기  P/O/K/G/U 테스트(U=스킬 전부)');

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

/** 일시정지 중 패드 조작 — D-패드 위아래로 커서, 상호작용 버튼으로 결정.
 *  프레임당 한 번만 폴링한다 (simulate 가 안 도는 동안이므로 엣지가 어긋나지 않는다) */
let padMenuRepeat = 0;
function pollPadWhilePaused(): void {
  const pad = input.gamepad;
  if (!pad.connected) return;
  pad.poll();
  if (gamepadUI.open) {
    gamepadUI.poll();
    return;
  }
  if (!pauseMenu.open) return;
  if (padMenuRepeat > 0) padMenuRepeat--;
  // 메뉴 안에서는 매핑을 안 거친 고정 버튼을 쓴다 — 매핑을 잘못 걸어 놓고
  // 메뉴에서 못 빠져나오면 손쓸 방법이 없다 (설정 화면과 같은 규약)
  if (pad.rawPressed(12)) pauseMenu.padMove(-1); // D-패드 ↑
  else if (pad.rawPressed(13)) pauseMenu.padMove(1); // D-패드 ↓
  else if (pad.rawPressed(0)) pauseMenu.padActivate(); // A
  else if (pad.rawPressed(8)) setPaused(false); // View — 다시 눌러 재개
}

const loop = new Loop(balance.loop.tickRate, balance.loop.maxFrameClampSec, {
  simulate,
  render,
});

// ---- 일시정지 ----
// 포인터 락이 풀리면(ESC·알트탭·창 밖 클릭) 곧 화면 밖이라는 뜻이므로 함께 멈춘다.
// 브라우저가 ESC를 포인터 락 해제로 예약해 두었기 때문에 이게 가장 자연스럽다.
const pauseOverlay = document.getElementById('pause')!;
// 메뉴에서 고른 결과는 전부 "멈춤을 푼다 + 포인터 락을 되찾는다"로 끝난다.
// 락이 걸릴 때까지 기다리지 않고 먼저 재개하는 이유: ESC 직후엔 브라우저가
// 락을 약 1.25초 거부한다. 락에 재개를 묶어 두면 그동안 화면이 굳어 보인다
const gamepadUI = new GamepadUI(input.gamepad);
const pauseMenu = new PauseMenu(pauseOverlay, world, {
  resume: () => {
    setPaused(false);
    input.requestLock();
  },
  restart: () => location.reload(),
  openGamepad: () => {
    // 일시정지는 유지한 채 설정 화면만 덮는다 — 닫으면 다시 메뉴로 돌아온다
    pauseMenu.hide();
    gamepadUI.show();
  },
  loadSave: () => {
    world.dead = false;
    respawnAtAltar();
    setPaused(false);
    input.requestLock();
  },
});

function setPaused(paused: boolean): void {
  if (loop.isPaused === paused) return;
  loop.setPaused(paused);
  world.paused = paused;
  // 각인 UI·사망·클리어 화면이 떠 있을 때는 정지 메뉴를 겹쳐 띄우지 않는다
  const showMenu = paused && !world.uiOpen && !world.dead && !world.cleared;
  if (showMenu) pauseMenu.show();
  else pauseMenu.hide();
  if (paused) {
    input.releaseHeld(); // 멈춘 사이 눌려 있던 키가 남지 않게
    Projectiles.endChannel(world); // 틱이 멈추면 채널이 스스로 못 끊는다 — 전류음이 남는다
  }
}
// 설정 화면을 닫으면 일시정지 메뉴로 돌아온다 (게임은 멈춘 채)
gamepadUI.onClose = () => pauseMenu.show();

document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement) setPaused(false);
  // 패드로 놀고 있으면 포인터 락이 없는 게 정상이다 — 여기서 멈추면 영영 멈춘다.
  // 꽂혀만 있고 키보드로 노는 사람에게는 그대로 걸려야 하므로 active 로 가른다
  else if (!world.uiOpen && !input.gamepad.active) setPaused(true);
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) setPaused(true);
});
window.addEventListener('blur', () => setPaused(true));
// 패드를 집어 들면 멈춰 있던 게임이 풀린다 — 패드에는 포인터 락을 잡을 방법이 없다.
// 창이 뒤에 있을 때(document.hidden)는 그대로 멈춰 둔다
window.addEventListener('gamepadconnected', () => {
  showReaction(
    `게임패드 연결됨 — ${padBtn('inventory')} 가방, ${padBtn('pause')} 일시정지·키 설정`,
    3000,
  );
});
window.addEventListener('gamepaddisconnected', () => {
  if (!document.pointerLockElement && !world.uiOpen) setPaused(true);
});

// 개발 빌드 전용 디버그 핸들 (헤드리스 테스트/콘솔 조작용)
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__world = world;
  (window as unknown as Record<string, unknown>).__input = input;
  (window as unknown as Record<string, unknown>).__stage = stage; // 씬 그래프 검증용
}

// ?skills — 시작부터 구현된 스킬을 전부 갖는다 (테스트 편의, U 키와 같다)
if (new URLSearchParams(location.search).has('skills')) grantAllSkills();

loop.start();
events.emit('loop_started', { tickRate: balance.loop.tickRate, level: levelJson.id });
