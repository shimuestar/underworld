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
import { spawnBarrels, spawnChests, spawnEnemies, spawnEnemyAt, spawnProps } from './level/Spawner';
import { Minimap } from './render/Minimap';
import { PauseMenu } from './render/PauseMenu';
import { GamepadUI, padDiagramSvg } from './render/GamepadUI';
import { buttonName, type PadAction } from './core/Gamepad';
import { KEY_ACTIONS, keyBindings, type KeyAction } from './core/KeyBindings';
import { Stage } from './render/Stage';
import { grenadeThrowSpeed } from './systems/Weapons';
import * as PlayerMove from './systems/PlayerMove';
import { padAimAssist } from './systems/PlayerMove';
import * as Enemies from './systems/Enemies';
import * as GhoulHeads from './systems/GhoulHeads';
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
import * as Props from './systems/Props';
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
  props: World['props'];
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
const interactKeyEl = document.getElementById('interact-key');
const crosshairEl = document.getElementById('crosshair')!;
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
/** 패드 진동 — 패드로 놀고 있을 때만 (꽂아만 두고 키보드로 노는 사람은 제외) */
let rumbleHoldUntil = 0; // 포효처럼 긴 진동을 잔진동이 덮지 못하게 지키는 시각
function padRumble(
  kind:
    | 'hit' | 'heavy' | 'kill' | 'shot' | 'cast' | 'block' | 'parry' | 'whiff'
    | 'interact' | 'hurt' | 'drain' | 'blast' | 'reload' | 'pickup' | 'use'
    | 'roar' | 'heartbeat' | 'tremble' | 'crumble' | 'webSnag' | 'webTear',
): void {
  if (!input.usingPad) return;
  // 포효가 도는 동안은 아무것도 못 끼어든다 — 패드는 마지막 효과가 앞 효과를
  // 교체해 버려서, 사격 한 방이면 2.2초짜리 포효가 수백 ms 로 잘리던 원인
  if (kind !== 'roar' && performance.now() < rumbleHoldUntil) return;
  const r = balance.input.gamepad.rumble[kind];
  input.gamepad.rumble(r.ms, r.strong, r.weak);
  if (kind === 'roar') rumbleHoldUntil = performance.now() + r.ms;
}

/** 세기 배율이 붙는 진동 — 활 당김(당길수록 굵게)·놓는 반동(당긴 만큼 굵게) */
function padRumbleScaled(kind: 'draw' | 'loose', frac: number): void {
  if (!input.usingPad) return;
  if (performance.now() < rumbleHoldUntil) return; // 포효 우선
  const r = balance.input.gamepad.rumble[kind];
  const m = Math.max(0, Math.min(1, frac));
  input.gamepad.rumble(r.ms, r.strong * m, r.weak * m);
}

let nextHeartbeatAt = 0; // 저체력 맥박 스케줄
const statusHpEl = document.getElementById('status-hp')!;
const statusHpFillEl = document.getElementById('status-hp-fill')!;
// 균열벽 붕괴 — 가까우면 낮은 우르릉 (충격파와 별개의 결)
events.on('crack_wall_broken', (payload) => {
  const c = payload as { x: number; z: number };
  if (Math.hypot(world.player.x - c.x, world.player.z - c.z) <= 12) padRumble('crumble');
});
// 거미줄 — 걸리는 순간 끈적하게, 찢을 때마다 톡, 다 찢으면 걸림과 같은 결로 마침
events.on('web_caught', () => padRumble('webSnag'));
events.on('web_torn', () => padRumble('webTear'));
events.on('web_broken', () => padRumble('webSnag'));

// 돌진 캔슬 — 달려들던 물어뜯기가 총알에 끊겼다: 비명 + 불꽃 + 안내
events.on('charge_broken', (payload) => {
  const cb = payload as { enemyId: number; x: number; z: number };
  audio.play('head_shriek', panAt(cb.x, cb.z)); // 고통의 괴성
  stage.spawnGuardSparks(cb.x, cb.z, 1.2, 0xffa050, 1.6); // 살점이 튀는 주황 불꽃
  stage.flashEnemyHit(cb.enemyId);
  showReaction('달려들기를 끊었다!', 1100);
});

// 타겟 락온 — 걸림/전환은 짧은 철컥, 놓침은 낮은 톤, 허탕은 약한 헛손질
events.on('lockon_start', () => {
  audio.play('reload_end');
  padRumble('interact');
});
events.on('lockon_switch', () => audio.play('reload_end'));
events.on('lockon_end', () => audio.play('reload_start'));
events.on('lockon_fail', () => padRumble('whiff'));

// 폭발 충격파 — 피해가 없어도 근처에서 터지면 거리만큼 진동이 온다 (공기가 때린다).
// 피해를 입은 폭발은 곧이어 오는 player_damaged 의 blast 가 이걸 덮는다
events.on('explosion', (payload) => {
  if (!input.usingPad) return;
  const b = payload as { x: number; z: number; radius: number };
  const cfg = balance.input.gamepad.rumble.blastWave;
  const reach = b.radius * cfg.reachMul;
  const d = Math.hypot(world.player.x - b.x, world.player.z - b.z);
  if (d > reach) return;
  const frac = 1 - d / reach;
  if (performance.now() < rumbleHoldUntil) return; // 포효 우선
  input.gamepad.rumble(cfg.ms, cfg.strong * frac, cfg.weak * Math.min(1, frac + 0.15));
});

/** 안내 문구의 키 표기 — 마지막으로 쓴 장치를 따라간다. 키보드 쪽은 기능 id 면
 *  현재 설정을 읽고, 'Enter'·'우클릭' 같은 고정 표기는 그대로 보여 준다 */
function keyLabel(kb: KeyAction | string, action: PadAction): string {
  if (input.usingPad) return padBtn(action);
  return KEY_ACTIONS.some((a) => a.id === kb) ? keyBindings.label(kb as KeyAction) : kb;
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
  props: spawnProps(levelJson.entities, level),
  chests: spawnChests(levelJson.entities, level),
  level,
});

// 시작 층(지하 1층)은 loadFloor 를 거치지 않는다 — 봉인 여부를 여기서 한 번 세운다.
// 이게 없으면 기본값 false 로 남아 첫 틱에 출구가 열려 버린다 (슬라임 보스 생존 중인데도)
world.exitNeedsKey = world.enemies.some((e) => e.floorBoss || enemyDef(e.type).boss);

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
  if (e.code === keyBindings.code('inventory')) {
    if (shopUI.open || world.dead) return;
    skillUI.hide();
    setUiOpen(inventoryUI.toggle());
  }
});
let restartConfirmUntil = 0;

window.addEventListener('keydown', (e) => {
  if (e.code === keyBindings.code('map')) minimap.toggle();
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
      events.emit('enemy_died', { enemyType: enemy.type, x: enemy.x, z: enemy.z, noLoot: enemy.noLoot });
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
  'ghoul_head_broken',
  'ghoul_head_hop',
  'wall_attach',
  'wall_fall',
  'wall_pounce',
  'wall_pounce_land',
  'spider_skitter',
  'bat_flap',
  'bat_scream',
  'bat_pack_dive',
  'bat_drain',
  'bat_swoop',
  'bat_knockdown',
  'bat_parried',
  'bat_downed',
  'ghoul_moan',
  'leech_struggle',
  'leech_face_attach',
  'leech_suck',
  'leech_face_kick',
  'leech_face_detach',
  'leech_drip',
  'leech_chitter',
  'leech_drop',
  'leech_fall',
  'leech_land',
  'leech_splat',
  'leech_ascend',
  'ghoul_latch',
  'ghoul_bite',
  'grapple_struggle',
  'grapple_escape',
  'ghoul_rise',
  'ghoul_ate_mote',
  'slime_spilled',
  'grave_recovered',
  'boss_brood',
  'brood_pop',
  'enemy_died',
  'enemy_damaged',
  'damage_pop',
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
  'prop_broken',
  'prop_hit',
  'prop_fuse_lit',
  'prop_ambush',
  'prop_loot',
  'ammo_picked',
  'grenade_picked',
  'battery_picked',
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
  // 박쥐 박치기는 예고 시작이 '조용한 정지 비행'이다 — 신호는 발사 순간의 비명(bat_swoop)
  if (wind.enemyType === 'bat') return;
  const at = panOf(payload); // 예고음에 방향을 싣는다 — 등 뒤 공격을 귀가 먼저 안다
  // 슬라임 — 몸이 부풀어 오르는 꿀렁임을 텔레그래프 소리에 얹는다
  if (wind.enemyType?.startsWith('slime')) audio.play('slime_windup', at);
  const telegraph = wind.telegraph;
  audio.play(
    telegraph === 'red'
      ? 'telegraph_red'
      : telegraph === 'purple'
        ? 'telegraph_purple'
        : 'telegraph_blue',
    at,
  );
});
events.on('parry_attempt', (payload) => {
  const result = (payload as { result: string }).result;
  if (result === 'perfect') audio.play('parry_perfect');
  else if (result === 'normal') audio.play('parry_normal');
  else audio.play('parry_fail');
  if (result === 'perfect' || result === 'normal') padRumble('parry'); // 받아친 손맛
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
  const kill = payload as { execution: boolean; enemyType?: string; x?: number; z?: number };
  // 구울 머리는 파티클이 아니라 소품(GhoulHeads)이 튄다 — 여기서는 소리만
  if (kill.enemyType === 'ghoul') audio.play('heavy_hit');
  if (kill.execution) presentExecute(1, kill.x, kill.z);
});
// 구울 머리가 다시 뛴다 — 낮은 '통' (여러 개가 자주 뛰므로 소리는 작게, 방향은 패닝)
events.on('ghoul_head_hop', (payload) => {
  const h = payload as { x: number; z: number };
  audio.play('head_hop', panAt(h.x, h.z));
});
// 벽거미 — 붙기/기기(사각사각), 도약, 착지, 맞아서 추락
events.on('wall_attach', (payload) => audio.play('spider_skitter', panOf(payload)));
events.on('spider_skitter', (payload) => audio.play('spider_skitter', panOf(payload)));
events.on('wall_pounce', (payload) => {
  audio.play('spider_pounce', panOf(payload));
  showReaction('거미가 벽에서 덮친다!', 1100);
});
events.on('wall_pounce_land', (payload) => {
  const wl = payload as { x: number; z: number; hit: boolean };
  audio.play(wl.hit ? 'hit_flesh' : 'hit_wall', panAt(wl.x, wl.z));
  if (wl.hit) stage.triggerCameraKick(0.3, 150);
});
events.on('wall_fall', (payload) => audio.play('hit_flesh', panOf(payload)));
// 박쥐 — 날갯짓(상시 단서), 급강하 비명, 날개 꺾여 추락, 바닥에 곤두박질
events.on('bat_flap', (payload) => audio.play('bat_flap', panOf(payload)));
events.on('bat_swoop', (payload) => {
  audio.play('bat_screech', panOf(payload));
  showReaction('박쥐가 내리꽂힌다!', 1000);
});
events.on('bat_parried', (payload) => {
  audio.play('parry_perfect');
  padRumble('parry');
  stage.triggerCameraKick(0.3, 150);
  const bp = payload as { x: number; z: number };
  stage.spawnGuardSparks(bp.x, bp.z, 1.3, 0x9fd8ff, 1.6); // 받아친 불꽃
});
events.on('bat_knockdown', (payload) => {
  audio.play('bat_screech', panOf(payload));
  showReaction('박쥐가 추락했다 — 지금이다!', 1400);
});
events.on('bat_downed', (payload) => audio.play('hit_flesh', panOf(payload)));
// 돌격 반동 — 방패·패링에 부딪힌 박쥐가 제 피를 흘린다 (막기가 곧 반격)
events.on('bat_recoil', (payload) => {
  const r = payload as { enemyId: number; x: number; z: number; amount: number };
  spawnHitBloodOn(r.enemyId, { damage: r.amount, towardPlayer: true });
  audio.play('bat_screech', panOf(r));
  minimap.notifyCombat(r.enemyId);
});
// 랜턴 속박 — 빛기둥에 잡힌 박쥐 (비추는 동안 쏘면 된다)
events.on('bat_transfixed', (payload) => {
  audio.play('bat_screech', panOf(payload));
  showReaction('박쥐가 빛에 얼어붙었다!', 1200);
});
// 초음파 비명 — 조준이 실제로 흔들린다 (PlayerMove 가 yaw·pitch 에 잔떨림을 싣는다)
events.on('bat_scream', (payload) => {
  audio.play('bat_scream', panOf(payload));
  stage.triggerCameraKick(0.1, 90);
  showReaction('초음파 비명 — 조준이 흔들린다!', 1200);
  // 입에서 먹이 쪽으로 퍼지는 파문 — 어느 놈이 질렀는지 눈으로 보인다
  const sc = payload as { enemyId: number };
  const e = world.enemies.find((en) => en.id === sc.enemyId);
  if (e) {
    let dx = world.player.x - e.x;
    let dz = world.player.z - e.z;
    const d = Math.hypot(dx, dz) || 1;
    dx /= d;
    dz /= d;
    stage.spawnSonicScream(
      e.x + dx * 0.3, e.z + dz * 0.3,
      (e.jumpY ?? 0) + enemyDef(e.type).height * 0.45,
      dx, dz,
    );
  }
});
// 무리 동시 강하 — 단독 박치기와 다른 전용음. 겹친 비명 + 낮은 웅웅
events.on('bat_pack_dive', (payload) => {
  const pd = payload as { count: number };
  audio.play('bat_pack_dive', panOf(payload));
  showReaction(`박쥐 ${pd.count}마리가 일제히 덮친다!`, 1600);
});
events.on('bat_drain', (payload) => audio.play('bat_drain', panOf(payload)));
// 구울 머리 소품이 부서졌다 — 밟았으면 발밑 파열, 아니면 살 터지는 소리
events.on('ghoul_head_broken', (payload) => {
  const hb = payload as { x: number; z: number; stomp: boolean };
  stage.spawnDeathBurst(hb.x, hb.z, 'ghoul', hb.stomp ? 1.1 : 0.7);
  audio.play('head_shriek', panAt(hb.x, hb.z)); // 마지막 괴성 — 파열음 뒤에 늦게 시작해 안 묻힌다
  // 머리도 피가 든 살덩이다 — 파편 위에 검붉은 피 + 바닥 얼룩 (밟으면 크게)
  {
    const pl = world.player;
    let dx = hb.x - pl.x;
    let dz = hb.z - pl.z;
    const d = Math.hypot(dx, dz);
    if (d > 0.001) {
      dx /= d;
      dz /= d;
    } else {
      dx = 0;
      dz = 1;
    }
    stage.spawnHitBlood(hb.x, hb.z, balance.ghoulHead.radius, dx, dz, 'ghoul', {
      damage: balance.ghoulHead.breakBlood,
      heavy: hb.stomp,
    });
  }
  if (hb.stomp) {
    audio.play('head_stomp');
    stage.triggerCameraKick(0.42, 160); // 밟는 반동
  } else {
    audio.play('head_break', panAt(hb.x, hb.z)); // 마른 파열 — 총·화살·스윙 공통 타격감
    stage.triggerCameraKick(0.16, 90);
  }
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
// ---- 기믹(파괴물) — 재질별 파괴음 + 파편, 심지, 매복 연출 ----
const PROP_BREAK_SOUND: Record<string, Parameters<typeof audio.play>[0]> = {
  ceramic: 'prop_break_ceramic',
  wood: 'prop_break_wood',
  bone: 'prop_break_bone',
  stone: 'prop_break_stone',
  metal: 'prop_break_metal',
};
const PROP_DEBRIS_COLOR: Record<string, number> = {
  ceramic: 0x8f5a36,
  wood: 0x6e5230,
  bone: 0xcfc7b0,
  stone: 0x8a8f96,
  metal: 0x5d4a30, // 광차 — 나무 널판이 주 파편, 쇳소리는 테두리 몫
};
events.on('prop_broken', (payload) => {
  const pb = payload as { type: string; x: number; z: number };
  const cfg = (balance.props.types as Record<string, { material: string; height: number }>)[pb.type];
  const mat = cfg?.material ?? 'wood';
  audio.play(PROP_BREAK_SOUND[mat] ?? 'prop_break_wood', panAt(pb.x, pb.z));
  stage.spawnPropDebris(pb.x, pb.z, PROP_DEBRIS_COLOR[mat] ?? 0x7a5a34, cfg?.height ?? 0.8);
  if ((pb as { source?: string }).source === 'melee') {
    // 해머로 와장창 — 명중보다 굵은 진동과 흔들림
    padRumble('heavy');
    stage.triggerCameraKick(0.4, 150);
  }
});
events.on('prop_hit', (payload) => {
  // 석관 첫 방 — 금이 갔다 (돌 부딪는 소리로 '한 방 더'를 알린다)
  const ph = payload as { x: number; z: number; source?: string };
  audio.play('hit_wall', panAt(ph.x, ph.z));
  if (ph.source === 'melee') {
    // 해머가 박힌 건 몬스터든 기믹이든 같은 손맛 — 진동 + 화면 흔들림
    padRumble('hit');
    stage.triggerCameraKick(0.25, 120);
  }
});
events.on('prop_fuse_lit', (payload) => {
  const pf = payload as { x: number; z: number };
  audio.play('prop_fuse', panAt(pf.x, pf.z));
  stage.spawnFuseGlow(pf.x, pf.z, (balance.props.fuseTicks / 60) * 1000);
  showReaction('치익 — 숨은 폭발물이다!', 900);
});
events.on('prop_ambush', (payload) => {
  const pa = payload as { enemyType: string; x: number; z: number };
  stage.spawnDeathBurst(pa.x, pa.z, pa.enemyType, 0.6); // 튀어나오는 철퍽
  audio.play('enemy_alert', panAt(pa.x, pa.z));
  showReaction('안에서 뭔가 튀어나왔다!', 1200);
});
events.on('ammo_picked', (payload) => {
  padRumble('pickup');
  audio.play('reload_end');
  showReaction(`권총탄 +${(payload as { amount: number }).amount}`, 900);
});
events.on('grenade_picked', () => {
  padRumble('pickup');
  audio.play('pickup');
  showReaction('수류탄 +1', 900);
});
events.on('battery_picked', () => {
  padRumble('pickup');
  audio.play('pickup');
  showReaction('랜턴 배터리 +1', 900);
});

events.on('web_caught', (payload) => {
  const info = payload as { swings: number };
  audio.play('web_hit');
  showReaction(`거미줄에 걸렸다 — 해머로 ${info.swings}번 걷어내라 (몸부림쳐도 찢긴다)`, 2400);
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
  padRumble('cast'); // 원거리 마법도 손에서 나가는 순간
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
  const boss =
    enemyDef(info.enemyType).boss ||
    world.enemies.find((e) => e.id === info.enemyId)?.floorBoss === true;
  // 포효 진동 — UI 신호라 보스와의 거리와 무관하게 무조건 울린다.
  // rumbleHold 로 활 당김·심장박동 등 프레임 지속 진동이 덮지 못하게 지킨다
  if (boss) padRumble('roar');
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
events.on('ghoul_moan', (payload) => audio.play('ghoul_moan', panOf(payload)));
// 거머리 몸부림 — 연타 한 번 = 쥐어뜯기 한 번
events.on('leech_struggle', () => {
  audio.play('struggle_push');
  stage.triggerHammerSwing(1, 1.7);
  stage.triggerCameraKick(0.16, 80);
});
// 거머리 얼굴 흡혈 — 부착/빨기/걷어차기/자진 이탈
events.on('leech_face_attach', () => {
  audio.play('ghoul_latch');
  // 붙는 순간 크게 밀리는 반동(0.5)이 '뒤로 밀렸다'로 읽혔다 — 살짝 움찔만 (몸은 원래 안 밀린다)
  stage.triggerCameraKick(0.12, 90);
});
events.on('leech_suck', () => {
  audio.play('leech_suck');
  stage.pulseFaceLeech(); // 리그가 훅 조인다
  spawnBloodSplatter(); // 내 피가 화면에 튄다
  stage.triggerCameraKick(0.24, 130);
});
events.on('leech_face_kick', () => {
  audio.play('leech_kick'); // 빨판이 '뽁' 뜯기고 발끝이 퍽
  stage.triggerHammerSwing(2, 1.5); // 떼어서 걷어차는 손맛
  stage.triggerCameraKick(0.38, 180);
  showReaction('걷어찼다!', 1000);
});
events.on('leech_face_detach', () => {
  audio.play('leech_shriek');
  showReaction('거머리가 배불러 떨어져 나갔다', 1500);
});
// 거머리 — 천장 단서(방울·찌륵), 낙하 비명, 착지, 피격 추락
events.on('leech_drip', (payload) => audio.play('leech_drip', panOf(payload)));
events.on('leech_chitter', (payload) => audio.play('leech_chitter', panOf(payload)));
events.on('leech_drop', (payload) => audio.play('leech_shriek', panOf(payload)));
events.on('leech_fall', (payload) => {
  const lf = payload as { x: number; z: number };
  audio.play('hit_flesh', panAt(lf.x, lf.z));
  stage.spawnDeathBurst(lf.x, lf.z, 'leech', 0.5);
  showReaction('거머리가 떨어졌다!', 1200);
});
events.on('leech_land', (payload) => {
  const ll = payload as { hit: boolean };
  audio.play(ll.hit ? 'heavy_hit' : 'hit_wall', panOf(payload));
});
events.on('leech_splat', (payload) => {
  const ls = payload as { x: number; z: number };
  audio.play('hit_flesh', panAt(ls.x, ls.z));
  stage.spawnDeathBurst(ls.x, ls.z, 'leech', 0.7);
});
// 구울 — 붙잡힘/몸부림/밀쳐내기/기상. 파먹히는 동안 근접 키 연타가 유일한 탈출구다
events.on('ghoul_latch', () => {
  audio.play('ghoul_latch');
  stage.triggerCameraKick(0.4, 200);
  showReaction('구울이 물어뜯는다! 근접 공격 연타로 밀쳐내라!', 2600);
});
events.on('ghoul_bite', () => {
  stage.triggerCameraKick(0.28, 130);
  spawnBloodSplatter(); // 파먹히는 동안 화면에 피가 튄다 — 거머리 흡혈과 같은 연출
});
events.on('grapple_struggle', () => {
  // 연타 한 번 = 두 손으로 한 번 밀친다 — 게이지는 HUD(#grapple)가 그린다
  audio.play('struggle_push');
  stage.triggerHammerSwing(1, 1.7);
  stage.triggerCameraKick(0.18, 80);
});
events.on('grapple_escape', () => {
  audio.play('heavy_hit');
  stage.triggerHammerSwing(3, 1.1); // 마지막 큰 밀치기 — 구울이 이 동작에 맞춰 튕겨 나간다
  stage.triggerCameraKick(0.42, 200);
  showReaction('밀쳐냈다!', 1000);
});
events.on('ghoul_rise', (payload) => {
  audio.play('ghoul_shriek', panOf(payload));
  showReaction('시체가 일어난다!', 1600);
});
events.on('ghoul_ate_mote', () => audio.play('hit_flesh'));
// 슬라임 식탐 — 삼킬 때 꿀꺽 (게워 내는 건 죽음 파편·자석 픽업이 이미 요란하다).
// 예고음(slime_windup) 재활용은 공격 신호와 헷갈려서 전용 삼킴음으로 갈랐다
events.on('slime_ate', (payload) => {
  const at = payload as { x: number; z: number };
  audio.play('slime_gulp', panAt(at.x, at.z));
});
// 새끼 사출 — 머리에서 한 마리씩 튀어나올 때마다 철퍽
events.on('brood_pop', (payload) => {
  const bp = payload as { x: number; z: number; enemyType: string };
  audio.play('slime_split', panAt(bp.x, bp.z));
  stage.spawnDeathBurst(bp.x, bp.z, bp.enemyType, 0.55);
});
// 어미 슬라임 새끼 분리 — 크게 철퍽이며 어미 색 파편이 사방으로 튄다
events.on('boss_brood', (payload) => {
  const b = payload as { enemyType: string; x: number; z: number };
  audio.play('slime_split', panAt(b.x, b.z));
  audio.play('heavy_hit', panAt(b.x, b.z));
  stage.spawnDeathBurst(b.x, b.z, b.enemyType, 1.8);
  showReaction('어미가 새끼를 떼어냈다!', 1400);
});
// 슬라임 분열 — 젖은 파열음 + 부모 색 파편이 갈라지는 자리에서 튄다
events.on('enemy_split', (payload) => {
  const sp = payload as { parentType: string; x: number; z: number };
  audio.play('slime_split', panAt(sp.x, sp.z));
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
  // 구울 머리는 소품(GhoulHeads)으로 남는다 — 파티클 머리는 다른 적만
  if (kill.enemyType !== 'ghoul') stage.spawnHeadPop(kill.enemyType, kill.x, kill.z);
  stage.spawnDeathBurst(kill.x, kill.z, kill.enemyType, balance.weapons.headshotKillBurstScale);
  const d = Math.hypot(kill.x - world.player.x, kill.z - world.player.z);
  if (d < 14) stage.triggerCameraKick(0.35 * (1 - d / 14), 200);
});

events.on('block_hit', (payload) => {
  audio.play('block_hit');
  stage.triggerBlockHit((payload as { kind?: string }).kind);
  padRumble('block'); // 챙 — 팔에 오는 충격
});

// ---- 무기 — 원거리(좌클릭, 휠 교체) / 근접(우클릭) ----
events.on('weapon_switched', () => audio.play('weapon_switch'));
events.on('hammer_swing', (payload) => {
  padRumble('whiff'); // 휘두르는 바람 — 명중하면 곧바로 hit/heavy 가 덮는다
  const sw = payload as { heavy?: boolean; step?: number; speedMul?: number };
  audio.play(sw.heavy ? 'hammer_heavy' : 'hammer_swing');
  stage.triggerHammerSwing(sw.step ?? 1, sw.speedMul ?? 1);
  if (sw.heavy) showReaction('강타!', 700);
});
/** 타격 피 파편 — 살아 있는 적에게만 (죽는 타격은 사망 파편이 담당). 분사 방향은
 *  플레이어→적, 높이는 부위별 비율 × 키 (+ 공중이면 jumpY) */
function spawnHitBloodOn(
  enemyId: number,
  hit: {
    damage: number;
    headshot?: boolean;
    heavy?: boolean;
    heightFrac?: number;
    /** 참 = 적→플레이어 쪽(정면)으로 튄다. 원거리 사격은 몸 뒤로 튀면 몸에 가려 안 보인다 */
    towardPlayer?: boolean;
  },
): void {
  const e = world.enemies.find((en) => en.id === enemyId);
  if (!e || !e.alive || e.health <= 0) return;
  const def = enemyDef(e.type);
  const pl = world.player;
  const sign = hit.towardPlayer ? -1 : 1;
  let dirX = (e.x - pl.x) * sign;
  let dirZ = (e.z - pl.z) * sign;
  const d = Math.hypot(dirX, dirZ);
  if (d > 0.001) {
    dirX /= d;
    dirZ /= d;
  } else {
    dirX = 0;
    dirZ = 1;
  }
  const y = (e.jumpY ?? 0) + def.height * (hit.heightFrac ?? 0.55);
  stage.spawnHitBlood(e.x, e.z, y, dirX, dirZ, e.type, hit);
}

// 피해 숫자 — 플레이어가 입힌 피해가 맞은 적 머리 위로 떠오른다.
// 경로별 이벤트: damage_pop(화살·주문·폭발·처형·총 처치·화상 묶음) /
// enemy_damaged(총 비처치 damage·스킬 amount) / melee_hit / bat_recoil(반동 자해)
function popDamageOn(enemyId: number | undefined, amount: number | undefined): void {
  if (enemyId === undefined || amount === undefined || amount < 0.5) return;
  const e = world.enemies.find((en) => en.id === enemyId);
  if (!e) return;
  stage.spawnDamageNumber(e.x, enemyDef(e.type).height + (e.jumpY ?? 0) + 0.25, e.z, amount);
}
events.on('damage_pop', (payload) => {
  const d = payload as { enemyId: number; amount: number };
  popDamageOn(d.enemyId, d.amount);
});
events.on('enemy_damaged', (payload) => {
  const d = payload as { enemyId?: number; amount?: number; damage?: number };
  popDamageOn(d.enemyId, d.amount ?? d.damage);
});
events.on('melee_hit', (payload) => {
  const d = payload as { enemyId: number; damage?: number };
  popDamageOn(d.enemyId, d.damage);
});
events.on('bat_recoil', (payload) => {
  const d = payload as { enemyId: number; amount: number };
  popDamageOn(d.enemyId, d.amount);
});

// 미니맵 전투 추적 — 내가 때린 적은 잠시 실시간으로 보인다 (권총·스킬·해머 공통)
events.on('enemy_damaged', (payload) => {
  const id = (payload as { enemyId?: number }).enemyId;
  if (id !== undefined) {
    minimap.notifyCombat(id);
    stage.shakeEnemyHit(id, false); // 총·화살·스킬도 같은 0.1초 피격 떨림 (해머는 melee_hit 쪽)
  }
});
// 미니맵 소리 핑 — 시야 밖 적의 소리가 난 자리에 흐릿한 점이 깜빡인다 (공간 음향의 시각 짝)
for (const noisyEvent of [
  'ghoul_moan', 'ghoul_rise', 'spider_skitter', 'wall_pounce',
  'bat_flap', 'bat_scream', 'bat_swoop', 'bat_pack_dive',
  'leech_drip', 'leech_chitter',
] as const) {
  events.on(noisyEvent, (payload) => {
    const at = payload as { x?: number; z?: number };
    if (at?.x !== undefined && at?.z !== undefined) minimap.ping(at.x, at.z);
  });
}

// 권총 명중 — 관통 방향으로 핏방울. 부위(zone)에 따라 맞은 높이가 다르다.
// zone 없는 enemy_damaged(주문 피해 등)는 제외 — 마법은 제 이펙트가 담당한다
events.on('enemy_damaged', (payload) => {
  const hit = payload as { enemyId: number; zone?: string; damage?: number };
  if (hit.zone === undefined || hit.damage === undefined) return;
  spawnHitBloodOn(hit.enemyId, {
    damage: hit.damage,
    headshot: hit.zone === 'head',
    heightFrac: hit.zone === 'head' ? 0.85 : hit.zone === 'limb' ? 0.25 : 0.55,
    towardPlayer: true, // 총알이 몸 뒤로 뚫는 그림은 몸에 가려 안 보인다 — 정면으로
  });
});

// 근접 처치 — 원거리 처치는 울리지 않는다 (원거리 진동은 발사 순간뿐)
events.on('melee_kill', (payload) => {
  if ((payload as { execution?: boolean }).execution !== true) {
    padRumble('kill');
    return;
  }
  // 처형 — 이단: 퍽(강모터) … 우드득(둘 다 최대)
  if (!input.usingPad) return;
  if (performance.now() < rumbleHoldUntil) return; // 포효 우선
  const ex = balance.input.gamepad.rumble.execute;
  input.gamepad.rumble(ex.ms, ex.strong, ex.weak);
  window.setTimeout(() => {
    if (performance.now() < rumbleHoldUntil) return; // 포효 우선
    input.gamepad.rumble(ex.tailMs, 1.0, 1.0);
  }, ex.gapMs);
});
events.on('melee_hit', (payload) => {
  const hit = payload as { enemyId: number; damage?: number; heavy?: boolean };
  audio.play(hit.heavy ? 'heavy_hit' : 'melee_hit');
  stage.flashEnemyHit(hit.enemyId);
  stage.shakeEnemyHit(hit.enemyId, hit.heavy === true); // 0.1초 무작위 떨림 — 박힌 손맛
  padRumble(hit.heavy ? 'heavy' : 'hit'); // 근접은 몸에 닿는 순간이 곧 진동이다
  minimap.notifyCombat(hit.enemyId); // 미니맵 전투 추적
  spawnHitBloodOn(hit.enemyId, { damage: hit.damage ?? 10, heavy: hit.heavy });
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
  padRumble('interact');
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
  if ((payload as { source?: string }).source === 'melee') {
    padRumble('hit'); // 해머로 통을 쳤다 — 기믹과 같은 손맛
    stage.triggerCameraKick(0.25, 120);
  }
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

// ---- 월드 고정 피격 마커 — 가해자의 실제 좌표를 기억한다. 시선을 돌리면 마커가 화면 위를
// 미끄러지며 따라오고, 마커가 위 정중앙에 오면 그 적을 정면으로 보고 있다는 뜻이다 ----
const hitMarksEl = document.getElementById('hitmarks');
interface HitMark { x: number; z: number; srcId?: number; bornMs: number; el: HTMLDivElement }
const hitMarks: HitMark[] = [];

/** 시선 기준 방위각(rad) — 정면 0, 오른쪽 +. 피격 마커와 스테레오 패닝이 같은 축을 쓴다 */
function bearingTo(x: number, z: number): number {
  const pl = world.player;
  const dx = x - pl.x;
  const dz = z - pl.z;
  const fx = -Math.sin(pl.yaw);
  const fz = -Math.cos(pl.yaw);
  return Math.atan2(-dx * fz + dz * fx, dx * fx + dz * fz);
}

function addHitMark(x: number, z: number, srcId?: number): void {
  if (!hitMarksEl) return;
  const cfg = balance.hitMarker;
  // 붙잡힌 동안(구울 파먹기·거머리 흡혈)은 생략 — 위협은 이미 붙어 있는 놈이고
  // 화면은 몸부림 게이지 몫이다. 코앞·바로 위(거머리 낙하)도 방위가 무의미해 건너뛴다
  if (world.grappleEnemyId !== null || world.faceLeechId !== null) return;
  const pl = world.player;
  if (Math.hypot(x - pl.x, z - pl.z) < cfg.minDist) return;
  const now = performance.now();
  // 같은 방위의 연타는 갱신으로 합친다 — 구울 떼에게 물릴 때 마커 스팸을 막는다
  const ang = bearingTo(x, z);
  for (const m of hitMarks) {
    let gap = Math.abs(bearingTo(m.x, m.z) - ang);
    if (gap > Math.PI) gap = Math.PI * 2 - gap;
    if (gap < (cfg.mergeDeg * Math.PI) / 180) {
      m.x = x;
      m.z = z;
      m.srcId = srcId;
      m.bornMs = now;
      return;
    }
  }
  // 상한 — 넘치면 가장 오래된 마커를 밀어낸다
  while (hitMarks.length >= cfg.max) hitMarks.shift()!.el.remove();
  const el = document.createElement('div');
  el.className = 'mark';
  hitMarksEl.appendChild(el);
  hitMarks.push({ x, z, srcId, bornMs: now, el });
}

/** 매 프레임 — 현재 시선 기준으로 회전을 다시 계산한다(월드 고정의 핵심). 수명이 다하거나
 *  가해자가 죽으면 지운다. 쐐기는 가까울수록 크다 — 등 뒤 근접과 원거리 궁수가 구분된다 */
function updateHitMarks(): void {
  if (hitMarks.length === 0) return;
  const cfg = balance.hitMarker;
  const now = performance.now();
  const pl = world.player;
  for (let i = hitMarks.length - 1; i >= 0; i--) {
    const m = hitMarks[i]!;
    const age = now - m.bornMs;
    const srcDead =
      m.srcId !== undefined && !world.enemies.some((e) => e.id === m.srcId && e.alive);
    if (age > cfg.lifeMs || world.dead || srcDead) {
      m.el.remove();
      hitMarks.splice(i, 1);
      continue;
    }
    const dist = Math.hypot(m.x - pl.x, m.z - pl.z);
    const t = Math.min(1, Math.max(0, (dist - cfg.nearDist) / (cfg.farDist - cfg.nearDist)));
    const scale = cfg.nearScale + (cfg.farScale - cfg.nearScale) * t;
    m.el.style.transform = `rotate(${bearingTo(m.x, m.z)}rad)`;
    m.el.style.setProperty('--s', String(scale));
    m.el.style.opacity = String(
      age < cfg.holdMs ? 1 : 1 - (age - cfg.holdMs) / (cfg.lifeMs - cfg.holdMs),
    );
  }
}

// ---- 공간 음향 — 적이 낸 소리를 시선 기준 좌우로 패닝하고 거리로 줄인다.
// 시야 밖(등 뒤) 위협은 HUD 보다 귀가 먼저 안다 ----

/** 월드 좌표의 소리 → { pan, vol }. minVol 아래로는 안 줄여 예고음이 항상 들린다 */
function panAt(x: number, z: number): { pan: number; vol: number } {
  const sp = balance.spatialAudio;
  const pl = world.player;
  const dist = Math.hypot(x - pl.x, z - pl.z);
  const pan = dist > 0.001 ? Math.sin(bearingTo(x, z)) * sp.maxPan : 0;
  const vol = Math.max(sp.minVol, 1 - dist / sp.maxDist);
  return { pan, vol };
}

/** 이벤트 페이로드에서 소리 위치를 꺼낸다 — x/z 가 없으면 enemyId 로 찾고, 둘 다 없으면
 *  undefined(= 기존처럼 가운데서 재생) */
function panOf(payload: unknown): { pan: number; vol: number } | undefined {
  const src = payload as { x?: number; z?: number; enemyId?: number } | undefined;
  let x = src?.x;
  let z = src?.z;
  if ((x === undefined || z === undefined) && src?.enemyId !== undefined) {
    const e = world.enemies.find((en) => en.id === src.enemyId);
    if (e) {
      x = e.x;
      z = e.z;
    }
  }
  if (x === undefined || z === undefined) return undefined;
  return panAt(x, z);
}

// ---- 피격 연출 — 붉은 비네트 + 피격음 (방어 성공 시엔 방어음만) ----
const grappleEl = document.getElementById('grapple');
const faceLeechEl = document.getElementById('faceleech');
const bloodFx = document.getElementById('bloodfx');

/** 흡혈 피 튀김 — 화면 가운데(빨판 입) 주변에 핏방울을 흩뿌린다. CSS 가 흘러내림·소멸을 맡는다 */
function spawnBloodSplatter(): void {
  if (!bloodFx) return;
  const n = 6 + Math.floor(Math.random() * 4);
  for (let i = 0; i < n; i++) {
    const blot = document.createElement('div');
    blot.className = 'blot';
    const size = 28 + Math.random() * 120;
    blot.style.width = `${Math.round(size)}px`;
    blot.style.height = `${Math.round(size * (0.6 + Math.random() * 0.7))}px`;
    blot.style.left = `${18 + Math.random() * 64}%`;
    blot.style.top = `${10 + Math.random() * 55}%`;
    blot.style.borderRadius = `${40 + Math.random() * 45}% ${40 + Math.random() * 45}% ${40 + Math.random() * 45}% ${40 + Math.random() * 45}%`;
    blot.style.animationDelay = `${Math.round(Math.random() * 90)}ms`;
    bloodFx.appendChild(blot);
    setTimeout(() => blot.remove(), 1700);
  }
}
const grappleRing = document.getElementById('grapple-ring');
const grappleCount = document.getElementById('grapple-count');
events.on('player_damaged', (payload) => {
  const hit = payload as {
    blocked?: boolean; srcX?: number; srcZ?: number; srcId?: number; source?: string;
  };
  if (hit.blocked) return;
  // 맞았다 — 굵은 충격. 파먹기·흡혈은 약모터의 다른 결, 폭발 피해는 가장 굵고 길게
  padRumble(
    hit.source === 'ghoul_bite' || hit.source === 'leech_suck'
      ? 'drain'
      : hit.source === 'explosion' || hit.source === 'fireball' || hit.source === 'implode'
        ? 'blast'
        : 'hurt',
  );
  audio.play('player_hurt');
  hurtOverlay!.style.transition = 'none';
  hurtOverlay!.style.opacity = '1';
  // 월드 고정 마커 — 가해자 좌표를 기억시킨다 (회전 추적은 updateHitMarks 가 매 프레임)
  if (hit.srcX !== undefined && hit.srcZ !== undefined) {
    addHitMark(hit.srcX, hit.srcZ, hit.srcId);
  }
  if (hit.srcId !== undefined) minimap.notifyCombat(hit.srcId); // 미니맵 전투 추적 (5초)
  requestAnimationFrame(() => {
    hurtOverlay!.style.transition = 'opacity 450ms ease-out';
    hurtOverlay!.style.opacity = '0';
  });
});
events.on('spell_impact', () => audio.play('spell_impact'));
events.on('sigil_acquired', () => audio.play('pickup'));
events.on('sigil_acquired', () => padRumble('pickup'));
events.on('sigil_duplicate', () => audio.play('pickup_gold')); // 각인이 아니라 자원을 먹은 소리
events.on('battery_swapped', () => padRumble('reload')); // 전지 갈아 끼우는 철컥
events.on('reload_started', () => {
  audio.play('reload_start');
  padRumble('reload');
});
events.on('reload_finished', () => {
  audio.play('reload_end');
  padRumble('reload'); // 철컥 — 끝맺음
});
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
    enemyId?: number; enemyType: string; x: number; z: number; blastX?: number; blastZ?: number;
  };
  // 보스 처치 팡파르 — UI 사운드라 거리와 무관하게 나온다 (띠리링 딩~)
  const deadBoss =
    enemyDef(dead.enemyType).boss ||
    world.enemies.find((e) => e.id === dead.enemyId)?.floorBoss === true;
  if (deadBoss) audio.play('boss_fanfare');
  // 폭발로 죽었으면 파편이 폭심 반대쪽으로 날아간다 (살아남은 적은 몸이 밀린다)
  const launch = dead.blastX !== undefined ? balance.explosionKnockback.burstLaunch : 0;
  const deathAt = panAt(dead.x, dead.z);
  // 죽는 순간 피 — 평소 타격의 2배(deathMul)로 터진다. 잘 죽는 잔챙이(작은 거미 등)는
  // 비-사망 타격이 드물어 피를 못 보던 문제도 이걸로 메워진다. 방향은 플레이어 반대쪽
  const spillDeathBlood = (): void => {
    let bdx = dead.x - world.player.x;
    let bdz = dead.z - world.player.z;
    const bd = Math.hypot(bdx, bdz);
    if (bd > 0.001) {
      bdx /= bd;
      bdz /= bd;
    } else {
      bdx = 0;
      bdz = 1;
    }
    stage.spawnHitBlood(
      dead.x, dead.z, enemyDef(dead.enemyType).height * 0.5, bdx, bdz, dead.enemyType,
      {
        damage: balance.hitBlood.deathDamage,
        death: true,
        // 슬라임은 방울을 굵게 — 죽인 자리가 '느려지는 웅덩이'(deathGoo)로 크게 읽히게
        sizeMul: dead.enemyType.startsWith('slime') ? balance.hitBlood.slimeDeathSizeMul : 1,
      },
    );
  };
  if (executedThisFrame) {
    // 처형 — 사망 연출도 해머가 닿는 순간까지 미룬다
    afterMs(executeContactMs, () => {
      audio.play('enemy_death', deathAt);
      stage.spawnDeathBurst(dead.x, dead.z, dead.enemyType, 1.8);
      spillDeathBlood();
    });
  } else {
    audio.play('enemy_death', deathAt);
    stage.spawnDeathBurst(
      dead.x, dead.z, dead.enemyType, 1, dead.blastX ?? 0, dead.blastZ ?? 0, launch,
    );
    spillDeathBlood();
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
  padRumble('pickup');
  const kind = (payload as { kind: ItemKind }).kind;
  audio.play(ITEM_SOUND[kind] ?? 'pickup_potion');
  const def = itemDef(kind);
  const slot = world.quickslots.indexOf(kind);
  showReaction(
    `${def.name} 획득 (가방 ${countOf(world, kind)}개)${slot >= 0 ? `  [${slot + 1}번]` : ''}`,
    1100,
  );
});
// 회복 깜빡임 — 주기·횟수·끝부분 폭은 데이터에서 (CSS 변수로 한 번 주입)
{
  const rf = balance.hud.restoreFlash;
  const rootStyle = document.documentElement.style;
  rootStyle.setProperty('--restore-cycle', `${rf.cycleMs}ms`);
  rootStyle.setProperty('--restore-blinks', String(rf.blinks));
  rootStyle.setProperty('--restore-tip-w', `${rf.tipWidthPx}px`);
  rootStyle.setProperty('--stat-pop-scale', String(balance.hud.statPop.scaleMul));
  rootStyle.setProperty('--stat-pop-ms', `${balance.hud.statPop.durationMs}ms`);
  rootStyle.setProperty('--gain-hold-ms', `${balance.hud.centerGain.holdMs}ms`);
  rootStyle.setProperty('--gain-rise', `${balance.hud.centerGain.risePx}px`);
  rootStyle.setProperty('--gain-font', `${balance.hud.centerGain.fontPx}px`);
  rootStyle.setProperty('--gain-big-mul', String(balance.hud.centerGain.bigScaleMul));
}
const statPopTimers = new Map<string, number>();
/** 획득 팝 — HUD 숫자가 잠깐 커졌다 제자리로 (연달아 먹으면 다시 처음부터) */
function popStat(elId: string): void {
  const el = document.getElementById(elId);
  if (!el) return;
  el.classList.remove('pop');
  void el.offsetWidth; // 리플로우 — 애니메이션 재시작
  el.classList.add('pop');
  const prev = statPopTimers.get(elId);
  if (prev !== undefined) window.clearTimeout(prev);
  statPopTimers.set(
    elId,
    window.setTimeout(() => el.classList.remove('pop'), balance.hud.statPop.durationMs + 40),
  );
}
// 중앙 획득 표시 — 조준선 아래 +골드/+XP. 떠 있는 동안 또 먹으면 같은 표시에 누적
let gainGoldAcc = 0;
let gainXpAcc = 0;
let gainShownGold = 0; // 화면에 지금 보이는 값 — 목표(acc)로 굴러 올라간다
let gainShownXp = 0;
let gainExitTimer: number | undefined;
let gainRollTimer: number | undefined;

function updateGainText(): void {
  const cg = balance.hud.centerGain;
  const goldLine = document.getElementById('gain-center-gold')!;
  const xpLine = document.getElementById('gain-center-xp')!;
  goldLine.style.display = gainGoldAcc > 0 ? '' : 'none';
  xpLine.style.display = gainXpAcc > 0 ? '' : 'none';
  goldLine.querySelector('.gc-num')!.textContent = `+${gainShownGold}`;
  xpLine.querySelector('.gc-num')!.textContent = `+${gainShownXp} XP`;
  // 대량 획득 — 누적이 임계를 넘는 순간 승격 (사이클이 끝나야 풀린다)
  goldLine.classList.toggle('big', gainGoldAcc >= cg.bigGold);
  xpLine.classList.toggle('big', gainXpAcc >= cg.bigXp);
}

/** 카운트업 롤링 — 표시값이 목표로 촤르륵 굴러 올라간다 */
function rollGainNumbers(): void {
  const cg = balance.hud.centerGain;
  if (gainRollTimer !== undefined) return;
  gainRollTimer = window.setInterval(() => {
    let done = true;
    if (gainShownGold !== gainGoldAcc) {
      const diff = gainGoldAcc - gainShownGold;
      const step = Math.max(1, Math.round(Math.abs(diff) * cg.rollStepRatio));
      gainShownGold = Math.abs(diff) <= step ? gainGoldAcc : gainShownGold + step * Math.sign(diff);
      done = false;
    }
    if (gainShownXp !== gainXpAcc) {
      const diff = gainXpAcc - gainShownXp;
      const step = Math.max(1, Math.round(Math.abs(diff) * cg.rollStepRatio));
      gainShownXp = Math.abs(diff) <= step ? gainXpAcc : gainShownXp + step * Math.sign(diff);
      done = false;
    }
    updateGainText();
    if (done && gainRollTimer !== undefined) {
      window.clearInterval(gainRollTimer);
      gainRollTimer = undefined;
    }
  }, cg.rollIntervalMs);
}

/** HUD 흡수 — 중앙 표시가 지갑 표기로 날아가 도착 순간 HUD 숫자가 팝 (들어갔다는 인과) */
function absorbGainToHud(): void {
  gainExitTimer = undefined;
  if (gainRollTimer !== undefined) {
    window.clearInterval(gainRollTimer);
    gainRollTimer = undefined;
  }
  // 날아가는 텍스트는 최종 수량으로 — 굴러가던 중이었어도 여기서 완성한다
  gainShownGold = gainGoldAcc;
  gainShownXp = gainXpAcc;
  updateGainText();
  const cg = balance.hud.centerGain;
  const flights: Array<[number, string, string]> = [
    [gainGoldAcc, 'gain-center-gold', 'status-gold-amt'],
    [gainXpAcc, 'gain-center-xp', 'status-xp-amt'],
  ];
  for (const [amt, lineId, targetId] of flights) {
    if (amt <= 0) continue;
    const line = document.getElementById(lineId)!;
    const target = document.getElementById(targetId)!;
    const from = line.getBoundingClientRect();
    const to = target.getBoundingClientRect();
    // 복제해서 날린다 — 비행 중 새 획득이 와도 본체는 새 표시를 새로 띄울 수 있다
    const ghost = line.cloneNode(true) as HTMLElement;
    const cs = getComputedStyle(line);
    ghost.style.cssText =
      `position:fixed;left:${from.left}px;top:${from.top}px;margin:0;z-index:30;` +
      `pointer-events:none;font:${cs.font};color:${cs.color};` +
      `letter-spacing:${cs.letterSpacing};text-shadow:${cs.textShadow};`;
    document.body.appendChild(ghost);
    const dx = to.left + to.width / 2 - (from.left + from.width / 2);
    const dy = to.top + to.height / 2 - (from.top + from.height / 2);
    const anim = ghost.animate(
      [
        { transform: 'translate(0, 0) scale(1)', opacity: 1 },
        { transform: `translate(${dx}px, ${dy}px) scale(0.5)`, opacity: 0.85 },
      ],
      { duration: cg.absorbMs, easing: 'cubic-bezier(0.45, -0.15, 0.75, 1)', fill: 'forwards' },
    );
    anim.onfinish = () => {
      ghost.remove();
      popStat(targetId);
    };
  }
  document.getElementById('gain-center')!.classList.remove('show');
  gainGoldAcc = 0;
  gainXpAcc = 0;
  gainShownGold = 0;
  gainShownXp = 0;
}

function showCenterGain(gold: number, xp: number): void {
  const cg = balance.hud.centerGain;
  if (gainExitTimer !== undefined) window.clearTimeout(gainExitTimer);
  const box = document.getElementById('gain-center')!;
  if (!box.classList.contains('show')) {
    gainShownGold = 0; // 새 묶음 — 0에서 굴러 올라간다
    gainShownXp = 0;
  }
  gainGoldAcc += gold;
  gainXpAcc += xp;
  updateGainText();
  rollGainNumbers();
  // 아이콘 바운스 — 이번에 먹은 종류만 통통
  for (const [amt, lineId] of [
    [gold, 'gain-center-gold'],
    [xp, 'gain-center-xp'],
  ] as const) {
    if (amt <= 0) continue;
    const icon = document.getElementById(lineId)!.querySelector<HTMLElement>('.gc-icon')!;
    icon.classList.remove('bounce');
    void icon.offsetWidth;
    icon.classList.add('bounce');
  }
  box.classList.add('show');
  gainExitTimer = window.setTimeout(absorbGainToHud, cg.holdMs);
}
const restoreFlashTimers = new Map<string, number>();
/** 회복 깜빡임 — 게이지가 찰 때 채워진 부분을, 이미 가득이면 끝부분만 깜빡인다 */
function flashRestoreBar(fillId: string, wasFull: boolean): void {
  const el = document.getElementById(fillId);
  if (!el) return;
  el.classList.remove('restore-blink', 'restore-tip');
  void el.offsetWidth; // 리플로우 — 연달아 마셔도 애니메이션이 처음부터 다시 돈다
  el.classList.add(wasFull ? 'restore-tip' : 'restore-blink');
  const prev = restoreFlashTimers.get(fillId);
  if (prev !== undefined) window.clearTimeout(prev);
  const rf = balance.hud.restoreFlash;
  restoreFlashTimers.set(
    fillId,
    window.setTimeout(() => el.classList.remove('restore-blink', 'restore-tip'), rf.cycleMs * rf.blinks + 60),
  );
}
events.on('item_used', (payload) => {
  const info = payload as { kind: ItemKind; healed: number; restored: number; left: number };
  audio.play(ITEM_SOUND[info.kind] ?? 'pickup_potion');
  padRumble('use'); // 꿀꺽 — 마시는 손맛
  const parts: string[] = [];
  if (info.healed > 0) parts.push(`+${Math.round(info.healed)} HP`);
  if (info.restored > 0) parts.push(`+${Math.round(info.restored)} 마나`);
  showReaction(`${parts.join('  ')}   (남은 ${info.left}개)`, 1000);
  // 이 아이템이 만지는 게이지만 깜빡인다 — 이미 가득했으면 끝부분만
  const idef = itemDef(info.kind);
  if (idef.heal > 0) flashRestoreBar('status-hp-fill', info.healed <= 0);
  if (idef.restore > 0) flashRestoreBar('status-mana-fill', info.restored <= 0);
  if (idef.regen) flashRestoreBar('status-stamina-fill', false); // 지속 효과 시작 — 스태미너도
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
    info.kind === 'food' && info.reason === 'full'
      ? '아직 효과가 도는 중이다' // 음식은 만피여도 먹는다 — 막히는 건 중복뿐
      : info.reason === 'empty'
        ? `빈 퀵슬롯 — ${keyLabel('inventory', 'inventory')} 에서 등록한다`
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
  showReaction(`가방이 가득 찼다 — ${keyLabel('inventory', 'inventory')} 에서 쓰거나 버려야 한다`, 2000);
});
events.on('gold_picked', (payload) => {
  audio.play('pickup_gold');
  padRumble('pickup');
  // 골드도 XP 와 같은 연출 — 동전이 놓여 있던 자리에서 '◆ +N' 이 떠오른다.
  // 발밑(2.2m 안)이면 같은 방향으로 밀어낸다 — 코앞 스프라이트는 화면을 가린다
  const g = payload as { amount: number; x?: number; z?: number };
  if (g.amount < 1) return;
  let gx = g.x ?? world.player.x;
  let gz = g.z ?? world.player.z;
  const dx = gx - world.player.x;
  const dz = gz - world.player.z;
  const d = Math.hypot(dx, dz);
  if (d < 2.2) {
    const fx = d > 0.3 ? dx / d : -Math.sin(world.player.yaw);
    const fz = d > 0.3 ? dz / d : -Math.cos(world.player.yaw);
    gx = world.player.x + fx * 2.2;
    gz = world.player.z + fz * 2.2;
  }
  stage.spawnGoldNumber(gx, 1.05, gz, g.amount);
});
events.on('xp_gained', (payload) => {
  const gain = payload as { amount: number; enemyType?: string; x?: number; z?: number };
  // 처치 XP — 죽은 적 머리 위, 피해 숫자가 먼저 지나간 뒤에 뜬다 (겹침 방지).
  // 자리가 없는 XP(각인 중복 정산 등)만 기존 중앙 표기로 남는다
  if (gain.x !== undefined && gain.z !== undefined && gain.enemyType) {
    const y = enemyDef(gain.enemyType).height + 0.25;
    const { x, z, amount } = gain;
    window.setTimeout(() => {
      if (!world.dead) stage.spawnXpNumber(x!, y, z!, amount);
    }, balance.hud.xpPop.delayMs);
    return;
  }
  showCenterGain(0, gain.amount);
});
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
  // 놓는 반동 — 살짝 당겨 쏘면 약하게, 풀차지는 굵게
  padRumbleScaled('loose', 0.3 + 0.7 * ((payload as { chargeFrac: number }).chargeFrac ?? 0));
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
  audio.play(long ? 'charge_ready' : 'telegraph_blue', panOf(payload));
  // 창병만 쓰던 기술이 아니다 — 족장도 중·원거리에서 달려든다
  showReaction(`${enemyDef(info.enemyType).name ?? '적'}이 달려든다!`, 1200);
});
events.on('enemy_whiffed', (payload) => {
  audio.play('enemy_whiff', panOf(payload));
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
        ? `액티브 — ${input.usingPad ? `${padBtn('skillSelect')} + ${padBtn(`skill${info.slot + 1}` as PadAction)}` : SKILL_KEYS[info.slot]} 로 쓴다`
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
  deathHint!.textContent = deathHintText();
  deathOverlay.classList.add('visible');
});

events.on('respawned', (payload) => {
  const tribute = (payload as { tribute?: number }).tribute ?? 0;
  if (tribute > 0) showReaction(`부활의 재물 — 골드 ${tribute} 을 제단에 바쳤다`, 3200);
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

/** 죽인 적의 배치 키(층 번호 포함) — 부활을 거듭해도 안 살아난다.
 *  층 좌표는 층마다 겹치므로 층 번호를 키에 넣는다. 전체 재시작(reload)이 곧 초기화다 */
const slainSpawnKeys = new Set<string>();

/** 제단 리스폰 — 위치·체력 복원, 탄약 상한, 마나 0, 각인·오염 유지.
 *  부활의 대가로 골드 전액을 재물로 바치고, 죽였던 적은 되살아나지 않는다 (2026-09) */
function respawnAtAltar(): void {
  const p = world.player;
  const point = world.respawn!;
  const tribute = world.gold;
  world.gold = 0;
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
  // 살아 있던 적만 배치 자리로 되돌린다 — 죽인 적(종·홈 좌표로 대조)은 그대로 죽어 있다.
  // 목록은 부활을 거듭해도 쌓인다 (죽은 적은 배열에서 빠지므로 매번 다시 봐선 잊는다).
  // 소환수·분열체는 배치에 없으므로 함께 사라진다
  for (const e of world.enemies) {
    if (!e.alive) slainSpawnKeys.add(`${floorIndex}:${e.type}@${e.homeX},${e.homeZ}`);
  }
  world.enemies = spawnEnemies(levelJson.entities, level).filter(
    (e) => !slainSpawnKeys.has(`${floorIndex}:${e.type}@${e.homeX},${e.homeZ}`),
  );
  // 주인을 이미 잡은 층이면 쇠창살은 잠기지 않는다 (죽은 주인은 안 살아난다)
  world.exitNeedsKey =
    world.enemies.some((e) => e.floorBoss || enemyDef(e.type).boss) &&
    !unlockedFloors.has(floorIndex);
  world.exitOpen = false;
  // 폭발통도 되살린다 — 남은 차단 블록을 먼저 걷어내야 유령 벽이 쌓이지 않는다
  for (const barrel of world.barrels) if (barrel.blocker) level.removeBlocker(barrel.blocker);
  world.barrels = spawnBarrels(levelJson.entities, level);
  for (const prop of world.props) if (prop.blocker) level.removeBlocker(prop.blocker);
  world.props = spawnProps(levelJson.entities, level);
  for (const chest of world.chests) if (chest.blocker) level.removeBlocker(chest.blocker);
  world.chests = spawnChests(levelJson.entities, level);
  world.chestInView = null;
  world.projectiles.length = 0;
  world.gooPuddles = []; // 점액은 층/판에 속한다 — 새 판에 들고 가지 않는다
  world.ghoulHeads = []; // 튀는 머리도 층에 속한다
  // 바닥 보상은 리셋하되 비석만은 남긴다 — 유품은 다시 죽어도 그 자리에 있다
  world.groundItems = world.groundItems.filter((g) => g.kind === 'grave');
  world.freezeTicks = 0;
  world.grappleEnemyId = null;
  world.grappleMash = 0;
  world.faceLeechId = null;
  world.faceLeechMash = 0;
  world.dead = false;
  deathOverlay!.classList.remove('visible');
  events.emit('respawned', { x: point.x, z: point.z, tribute });
}

events.on('shot_fired', (payload) => {
  const shot = payload as {
    ex: number; ey: number; ez: number; hitEnemy: boolean; blocked?: boolean;
  };
  padRumble('shot'); // 원거리는 손에서 나가는 순간 — 반동
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
/** 사망 화면 안내 — 두 갈래: 부활(골드 재물) / 던전 처음부터. 장치 바뀌면 표기도 따라온다 */
function deathHintText(): string {
  const reviveKey = keyLabel('Enter', 'interact');
  const restartKey = keyLabel('R', 'reload');
  if (!world.respawn) return `${reviveKey} — 던전 다시 공략 (처음부터)`;
  const atFloorStart =
    Math.hypot(world.respawn.x - level.spawn.x, world.respawn.z - level.spawn.z) < 0.01;
  return (
    `${reviveKey} — ${atFloorStart ? '층 입구에서 부활' : '제단에서 부활'}` +
    ` (골드 전액을 재물로 · 죽인 적은 안 살아난다)\n` +
    `${restartKey} — 던전 다시 공략 (처음부터)`
  );
}
window.addEventListener('keydown', (e) => {
  if (!world.dead) return;
  if (e.code === 'Enter') restartAfterDeath();
  else if (e.code === 'KeyR') location.reload();
});

// ---- 제단 ----
events.on('life_mote_absorbed', (payload) => {
  audio.play('pickup');
  padRumble('pickup');
  const healed = (payload as { healed: number }).healed;
  flashRestoreBar('status-hp-fill', healed <= 0);
});

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
  // 주인을 잡아 딴 층인데 상승 연출을 아직 못 봤다면(잡자마자 새끼들에게 죽어
  // 부활했거나, 층을 오갔다 돌아온 경우) 연출을 남겨 둔다 — 계단에 다가가면 올라간다.
  // 그 외(보스 없는 층·이미 본 층)는 연출 없이 처음부터 올라가 있다
  if (unlockedFloors.has(floorIndex) && !barsCineSeen.has(floorIndex)) {
    barsCineArmed = true;
  } else {
    barsCineArmed = false;
    stage.snapBarsUp();
  }
});
// 쇠창살 시네마틱 — 주인을 잡는 순간이 아니라 '플레이어가 계단 10m 안에 처음
// 들어오는 순간' 3초 상승 연출·소리·진동이 시작된다. 멀리서 잡으면 그때는
// 팡파르만 나오고, 계단에 가 보면 눈앞에서 올라간다 (안 보이던 문제의 답)
let barsCineArmed = false;
let barsCineUntil = 0; // 이 시각까지 거리 비례 진동 펄스
let nextBarsPulseAt = 0; // 펄스 간격 관리 — 60Hz 재발행은 모터가 돌기 전에 리셋돼 못 느낀다
const barsCineSeen = new Set<number>(); // 상승 연출을 실제로 본 층 — 못 봤으면 재입장에도 남긴다
events.on('exit_unlocked', () => {
  unlockedFloors.add(floorIndex); // 오르내려도·부활해도 다시 잠기지 않는다
  showReaction('층의 주인이 쓰러졌다 — 쇠창살이 올라간다', 2600);
  barsCineArmed = true;
});
events.on('exit_locked', (payload) => {
  // E 로 흔들어 봤을 때만 소리를 낸다 — 밟기만 해도 짤그랑거리면 시끄럽다
  if ((payload as { tried?: boolean }).tried) audio.play('chain_locked');
});
// ---- 잠긴 문 (E 로 직접 연다) ----
events.on('door_channel_started', () => {
  audio.play('door_touch');
  padRumble('interact'); // 자물쇠에 손을 댔다
});
events.on('door_unlocked', (payload) => {
  const at = payload as { x: number; z: number };
  audio.play('door_slide');
  stage.triggerFlash(at.x, 1.2, at.z, 0x9a7a4a, 220, 2);
  showReaction('잠금이 풀렸다 — 문이 옆으로 밀린다', 2200);
});
events.on('lever_pulled', (payload) => {
  padRumble('interact');
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
  padRumble('interact'); // 문이 밀려 열리는 감각
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
    props: world.props,
    chests: world.chests,
    doors: world.doors,
    groundItems: world.groundItems,
    lifeMotes: world.lifeMotes,
    pulledLevers: world.pulledLevers,
  });

  floorIndex = index;
  minimap.setFloorTitle(`지하 ${index + 1}층`);
  levelJson = ZONE[index]!;
  traveling = false;

  const saved = floorStates.get(index);
  if (saved) {
    // 와 본 층 — 재소환하지 않는다. 죽인 적은 죽은 채로다
    level = saved.level;
    world.level = level;
    world.enemies = saved.enemies;
    world.barrels = saved.barrels;
    world.props = saved.props;
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
    world.props = spawnProps(levelJson.entities, level);
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
  world.ghoulHeads = []; // 튀는 머리도 층에 속한다

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
  // 출구 봉인 — 주인이 배치된 층에서 아직 딴 적이 없으면 쇠창살이 내려온다.
  // 층을 새로 로드하면 적이 초기화되므로, 이미 딴 층(unlockedFloors)만 예외다
  world.exitNeedsKey =
    levelJson.entities.some(
      (e) =>
        e.type !== 'barrel' && e.type !== 'chest' && !e.type.startsWith('prop_') &&
        (enemyDef(e.type).boss || (e as { boss?: boolean }).boss === true),
    ) && !unlockedFloors.has(index);
  world.canAscend = index > 0;
  world.onEntrancePad = false;
  world.exitOpen = false; // 잠기지 않은 층은 Exit 의 첫 틱이 열어 준다
  world.onExitPad = false;
  world.exitLockedNotified = false;
  world.cleared = false;
  world.freezeTicks = 0;
  world.grappleEnemyId = null;
  world.grappleMash = 0;
  world.faceLeechId = null;
  world.faceLeechMash = 0;

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
GhoulHeads.init(world); // 구울 머리 소품 — 목이 날아가면 통통 튀는 머리가 남는다
Props.init(world); // 기믹 — 부서지는 순간의 결과 롤(전리품·매복·폭발 심지)을 구독한다
const systems = [
  PlayerMove.tick,
  Enemies.tick,
  GhoulHeads.tick,
  Reaction.tick,
  Sigils.tick,
  Pickups.tick,
  LifeMotes.tick,
  Items.tick,
  Weapons.tick,
  Projectiles.tick,
  Barrels.tick, // 같은 틱에 쏜 화염구·던진 수류탄이 통을 터뜨릴 수 있게 뒤에 둔다
  Props.tick, // 기믹 심지도 같은 이유로 투사체 뒤
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
  // 구울에게 물린 동안은 병합을 끈다 — 근접 연타(몸부림)가 문·상자 상호작용으로
  // 바뀌면 빠져나올 방법이 없다 (문 앞에서 물리면 연타가 전부 먹히던 버그)
  if (!world.dead && !world.uiOpen && world.grappleEnemyId === null) {
    const interactable =
      (world.doorInView !== null && !world.doorInView.byLever) ||
      world.leverInView !== null ||
      world.chestInView !== null ||
      (world.altarInView && !world.altarEnteredThisApproach) ||
      world.onEntrancePad ||
      (world.onExitPad && (world.exitOpen || world.exitNeedsKey));
    if (interactable && world.input.meleePressed) {
      world.input = { ...world.input, meleePressed: false, interactPressed: true };
    }
    // E → 해머 변환은 없앴다 (2026-08-28, 사용자 결정): E 는 상호작용 전용이고
    // 대상이 없으면 아무 일도 하지 않는다. 근접 키 → 상호작용 방향만 남긴다
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
  if (world.dead) {
    if (input.gamepad.pressed('interact')) restartAfterDeath();
    else if (input.gamepad.pressed('reload')) location.reload();
  }

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
// 음식 버프 아이콘 — 고기 아이콘을 한 번 그려 넣고, 매 프레임 남은 시간 덮개만 갱신
const buffFoodEl = document.getElementById('buff-food')!;
buffFoodEl.insertAdjacentHTML('afterbegin', itemIconSvg('food', 22));
const buffFoodCd = buffFoodEl.querySelector<HTMLElement>('.buff-cd')!;
const buffFoodSec = buffFoodEl.querySelector<HTMLElement>('.buff-sec')!;
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

/** 방금 쓴 칸 번쩍 — 스킬·아이템 공용. 셀이 아니라 frame 에 건다:
 *  셀 className 은 sync 가 매 프레임 다시 짜서 클래스가 그 자리에서 지워진다.
 *  리플로우로 연사에도 애니메이션이 다시 돈다 */
function flashSlotUsed(frame: HTMLElement): void {
  frame.classList.remove('used');
  void frame.offsetWidth;
  frame.classList.add('used');
}
events.on('cast_spell', (payload) => {
  const i = world.skillSlots.indexOf((payload as { sigil: string }).sigil);
  if (i >= 0 && skillCells[i]) flashSlotUsed(skillCells[i]!.frame);
});
events.on('item_used', (payload) => {
  const i = world.quickslots.indexOf((payload as { kind: ItemKind }).kind);
  if (i >= 0 && quickCells[i]) flashSlotUsed(quickCells[i]!.frame);
});

/** 스킬 퀵슬롯 — 마름모 안은 색 원반과 키 하나뿐이라, 고른 칸의 이름만 뭉치 위에 적는다.
 *  마나가 모자라거나 쿨다운이면 원반이 바래고, 쿨다운은 마름모가 비스듬히 차오른다 */
/** 슬롯 키 표기 — 장치를 따라간다: 패드면 조합(선택+버튼), 키보드면 현재 설정 키 */
function shortPadBtn(b: number): string {
  return buttonName(b).replace('D-패드 ', '');
}
function skillSlotKeyLabel(i: number): string {
  if (input.usingPad) {
    // 선택 버튼(RB) 접두는 생략 — 칸마다 반복되면 소음이다 (다이아 라벨이 조합을 안내)
    return shortPadBtn(input.gamepad.binding(`skill${i + 1}` as PadAction));
  }
  return keyBindings.label(`skill${i + 1}` as KeyAction);
}
function quickSlotKeyLabel(i: number): string {
  if (input.usingPad) {
    if (i >= 4) return '—'; // 패드 조합은 D-패드 4방향까지 — 5번 자리가 없다
    return shortPadBtn(input.gamepad.binding(`slot${i + 1}` as PadAction));
  }
  return keyBindings.label(`slot${i + 1}` as KeyAction);
}

function syncSkillSlots(): void {
  world.skillSlots.forEach((id, i) => {
    const ui = skillCells[i];
    if (!ui) return;
    const keyText = skillSlotKeyLabel(i);
    if (ui.key.textContent !== keyText) ui.key.textContent = keyText;
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
    const keyText = quickSlotKeyLabel(i);
    if (ui.key.textContent !== keyText) ui.key.textContent = keyText;
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
  // 안전망 — 어쩌다(클릭 등) 일시정지가 풀린 채 키 설정 화면이 남아 있어도
  // 패드 캡처·탐색은 계속 돌아야 한다. 패드 폴링 자체는 simulate 가 한다
  else if (gamepadUI.open) gamepadUI.poll();
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
  stage.syncGhoulHeads(world.ghoulHeads);
  stage.syncProjectiles(world.projectiles, alpha);
  stage.syncGroundItems(world.groundItems);
  stage.syncLifeMotes(world.lifeMotes);
  stage.syncBarrels(world.barrels);
  stage.syncProps(world.props);
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
  // 프레임 지속 진동 — 우선순위: (포효 홀드) > 쇠창살 상승 > 활 당김 > 초음파 떨림 > 저체력 심장박동
  if (performance.now() < rumbleHoldUntil) {
    // 포효가 손에 남아 있는 동안은 잔진동이 덮지 않는다
  } else if (performance.now() < barsCineUntil && !world.paused && input.usingPad) {
    // 쇠창살이 감겨 올라가는 3초 — 현재 거리에 비례해 손이 떨린다 (다가갈수록 진하게).
    // 겹치는 긴 펄스(300ms 를 230ms 마다) — 매 프레임 재발행하면 모터가 돌기 전에
    // 효과가 리셋돼 실기에서 아무것도 못 느낀다
    const exit = world.level.exitPos;
    const cfg = balance.input.gamepad.rumble.barsRise;
    if (exit && performance.now() >= nextBarsPulseAt) {
      nextBarsPulseAt = performance.now() + cfg.pulseGapMs;
      const d = Math.hypot(world.player.x - exit.x, world.player.z - exit.z);
      const frac = Math.max(cfg.minFrac, Math.min(1, 1 - d / cfg.reach));
      input.gamepad.rumble(cfg.pulseMs, cfg.strong * frac, cfg.weak * frac);
    }
  } else if (bowDrawFrac > 0 && !world.paused) {
    padRumbleScaled('draw', 0.15 + 0.85 * bowDrawFrac); // 당길수록 굵게
  } else if ((world.player.aimShakeTicks ?? 0) > 0 && !world.paused && !world.dead) {
    padRumble('tremble'); // 초음파 비명 — 조준 흔들림과 촉각을 맞춘다
  } else if (
    !world.paused &&
    !world.dead &&
    world.player.health / balance.player.healthMax <=
      balance.input.gamepad.rumble.heartbeat.thresholdFrac
  ) {
    const hbNow = performance.now();
    if (hbNow >= nextHeartbeatAt) {
      nextHeartbeatAt = hbNow + balance.input.gamepad.rumble.heartbeat.intervalMs;
      padRumble('heartbeat');
      window.setTimeout(() => padRumble('heartbeat'), 160); // 두근-두근
      // HP 바도 같은 박자로 두근거린다 — 진동이 없는 키보드에서도 눈으로 온다
      statusHpFillEl.classList.remove('beat');
      void statusHpFillEl.offsetWidth; // 리플로우 — 연속 박동에도 애니메이션이 다시 돈다
      statusHpFillEl.classList.add('beat');
    }
  }
  // 저체력 표시 — 심박 진동과 같은 문턱. 바 테두리가 붉게 달아오른다
  statusHpEl.classList.toggle(
    'low',
    !world.dead &&
      world.player.health / balance.player.healthMax <=
        balance.input.gamepad.rumble.heartbeat.thresholdFrac,
  );
  // 패드 레이어 홀드 — 고르는 중인 퀵슬롯 뭉치가 살짝 커진다 (선택 상태 안내)
  const skillHold = input.usingPad && input.gamepad.held('skillSelect');
  const itemHold = input.usingPad && !skillHold && input.gamepad.held('itemSelect');
  skillPad.classList.toggle('layer-hold', skillHold);
  quickPad.classList.toggle('layer-hold', itemHold);
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
    // 패드에서 조준(LT)을 안 붙들면 총을 내려 쥔다 — 마우스는 항상 견착
    gunLowered: input.usingPad && !world.input.padAiming,
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
  // 쇠창살 시네마틱 트리거 — 무장된 채 계단 reach(10m) 안에 들어오면 시작.
  // 소리 볼륨은 그 순간의 거리(최소 0.35), 진동은 3초 내내 매 프레임 거리 비례
  if (barsCineArmed && world.exitOpen) {
    const exit = world.level.exitPos;
    if (exit) {
      const cfg = balance.input.gamepad.rumble.barsRise;
      const d = Math.hypot(world.player.x - exit.x, world.player.z - exit.z);
      if (d <= cfg.reach) {
        barsCineArmed = false;
        barsCineSeen.add(floorIndex); // 봤다 — 다음 재입장부턴 처음부터 올라가 있다
        stage.startBarsRise(balance.stairs.barsRiseMs);
        const frac = Math.max(cfg.minFrac, 1 - d / cfg.reach);
        audio.play('bars_rise', { pan: panAt(exit.x, exit.z).pan, vol: Math.max(0.35, frac) });
        barsCineUntil = performance.now() + balance.stairs.barsRiseMs;
        nextBarsPulseAt = 0;
      }
    }
  }
  minimap.update(p, world.enemies, alpha, world.exitOpen, world.godMode === true);

  stage.setLockOn(world.lockOnId); // 락온 마름모 — 잡힌 적 머리 위
  // 조준(LT) 연출 — 십자선 + 부드러운 FOV 줌 (누르고 있다는 게 몸에 온다)
  const aiming = input.usingPad && world.input.padAiming && !world.dead && !world.uiOpen;
  crosshairEl.classList.toggle('aim', aiming);
  stage.setAimZoom(aiming, balance.input.gamepad.ads.fovScale, balance.input.gamepad.ads.zoomLerp);

  // 패드 에임 어시스트 표적 표시 — 물고 있으면 조준점이 커지고 붉어진다.
  // 어시스트 자체는 스틱을 젓는 동안만 끌지만, 표시는 표적 위면 항상 — "걸리고 있다"의 증거
  crosshairEl.classList.toggle(
    'lock',
    input.usingPad &&
      world.input.padAiming &&
      !world.dead &&
      !world.uiOpen &&
      padAimAssist(world) !== null,
  );

  // 하단 중앙 상태 표시 — HP 바 + 무기 슬롯
  const wpn = world.weapon;
  const hpFrac = Math.max(0, p.health) / balance.player.healthMax;
  const hpFill = document.getElementById('status-hp-fill')!;
  hpFill.style.width = `${hpFrac * 100}%`;
  // 음식 지속 회복 — 실제로 차오르는 동안만 은은하게 맥동
  hpFill.classList.toggle(
    'regen',
    world.foodRegenTicks > 0 && p.health < balance.player.healthMax && !world.dead,
  );
  // 체력은 붉은 계열 — 낮아지면 더 밝은 경고색으로 (2026-08-29 녹색에서 교체)
  hpFill.style.background = hpFrac > 0.25 ? '#c22e2e' : '#ff4838';
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
  staminaRow.className =
    (world.stamina.exhausted ? 'spent' : '') + (world.foodRegenTicks > 0 ? ' boosted' : '');
  staminaFill.classList.toggle(
    'regen',
    world.foodRegenTicks > 0 &&
      world.stamina.regenDelay <= 0 &&
      world.stamina.value < balance.player.stamina.max,
  );
  // 음식 버프 — 남은 시간만큼 밝은 부채꼴이 시계 방향으로 줄어든다 + 남은 초
  if (world.foodRegenTicks > 0) {
    buffFoodEl.classList.add('on');
    const total = itemDef('food').regen?.durationTicks ?? 1;
    const remainDeg = (world.foodRegenTicks / total) * 360;
    buffFoodCd.style.background =
      `conic-gradient(transparent 0deg ${remainDeg}deg, rgba(0, 0, 0, 0.72) ${remainDeg}deg 360deg)`;
    buffFoodSec.textContent = String(Math.ceil(world.foodRegenTicks / 60));
  } else {
    buffFoodEl.classList.remove('on');
  }
  // 랜턴 — HP·마나 바 아래의 얇은 실선 게이지. 오른쪽에 % 와 예비 전지 개수
  const battFrac = Math.max(0, Math.min(1, world.lantern.battery / balance.lantern.batteryMax));
  const battPct = Math.round(battFrac * 100);
  lanternFill.style.width = `${battFrac * 100}%`;
  lanternText.textContent = `${battPct}% 예비 ${world.lantern.spares}`;
  lanternRow.className =
    (battPct <= 20 ? 'low' : '') + (world.lantern.on ? '' : ' off');
  document.getElementById('status-gold-amt')!.textContent = `◆ ${world.gold}`;
  document.getElementById('status-xp-amt')!.textContent = `XP ${world.xp}`;
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
  // 피격 마커 — 시선이 돌면 마커가 따라 미끄러진다 (월드 고정)
  updateHitMarks();
  // 거머리 얼굴 가림 — 실물 리그(카메라 앞) + 가장자리 비네트(HUD)
  faceLeechEl!.classList.toggle('visible', world.faceLeechId !== null);
  stage.setFaceLeech(world.faceLeechId !== null);
  // 몸부림 게이지 — 구울 파먹기·거머리 흡혈 공용. 연타가 원형 링을 채운다
  const ghoulGrip = world.grappleEnemyId !== null;
  const leechGrip = world.faceLeechId !== null;
  grappleEl!.classList.toggle('visible', ghoulGrip || leechGrip);
  if (ghoulGrip || leechGrip) {
    const need = ghoulGrip
      ? balance.ghoulGrapple.mashToEscape
      : enemyDef('leech').faceSuck!.mashToEscape;
    const done = Math.min(ghoulGrip ? world.grappleMash : world.faceLeechMash, need);
    grappleRing!.style.setProperty('--frac', String(done / need));
    grappleCount!.textContent = `${done}/${need}`;
  }
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
  // 패드는 상호작용 버튼을 보여 준다 — 근접(RT)도 겸하지만("한 키 체계") 안내는
  // 전용 키가 정직하다. 키보드는 우클릭(근접 겸용)이 관례라 그대로
  const IK = keyLabel('우클릭', 'interact');
  // 중앙 키캡 — 이번 프레임에 보여 줄 키 (null = 숨김). 문 같은 단순 대상 전용
  let centerKeycap: string | null = null;
  // 사망 화면 힌트 — 죽은 뒤에 패드를 집거나 내려놔도 표기가 따라온다
  if (world.dead) deathHint!.textContent = deathHintText();
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
    if (world.doorInView!.byLever) {
      altarPrompt!.textContent = '관문 — 손으로는 안 열린다. 어딘가의 레버를 찾아야 한다';
    } else if (frac > 0) {
      altarPrompt!.textContent = `잠금을 푸는 중\n${'█'.repeat(Math.round(frac * 20)).padEnd(20, '░')}  ${Math.round(frac * 100)}%`;
    } else {
      // 단순한 문은 중앙 키캡 하나로 — 긴 설명은 소음이다 (사용자 지시)
      centerKeycap = IK;
    }
  } else if (onExit) {
    // 마지막 층에서만 "나간다" 다 — 그 앞은 아래층으로 내려가는 계단이다
    const last = floorIndex + 1 >= ZONE.length;
    const stairFrac = world.stairHoldTicks / balance.stairs.holdTicks;
    altarPrompt!.textContent = world.exitNeedsKey
      ? '붉은 쇠창살이 내려와 있다 — 이 층의 주인을 잡아야 올라간다'
      : stairFrac > 0
        ? `${last ? '구역을 벗어나는 중' : '내려가는 중'}\n${'█'.repeat(Math.round(stairFrac * 20)).padEnd(20, '░')}  ${Math.round(stairFrac * 100)}%`
        : last
          ? `${IK} 길게 — 구역을 벗어난다`
          : `${IK} 길게 — 아래층으로 내려간다  (${floorIndex + 2}/${ZONE.length})`;
  } else if (onEntrance) {
    const stairFrac = world.stairHoldTicks / balance.stairs.holdTicks;
    altarPrompt!.textContent =
      stairFrac > 0
        ? `올라가는 중\n${'█'.repeat(Math.round(stairFrac * 20)).padEnd(20, '░')}  ${Math.round(stairFrac * 100)}%`
        : `${IK} 길게 — 위층으로 올라간다  (${floorIndex}/${ZONE.length})`;
  }
  if (centerKeycap !== null) {
    interactKeyEl!.textContent = centerKeycap;
    altarPrompt!.classList.remove('visible'); // 하단 안내 대신 중앙 키캡만
  }
  interactKeyEl!.classList.toggle('visible', centerKeycap !== null);

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
      ? `좌스틱 이동  R스틱 시선  ${padBtn('sprint')} 질주  ${padBtn('dodge')} 회피  ${padBtn('ranged')} 조준+${padBtn('melee')} 발사(${padBtn('cycleWeapon')} 무기 교체)  ${padBtn('melee')} 근접·처형·상호작용  ${padBtn('reaction')} 짧게=패링·꾹=방어\n` +
        `${padBtn('skillSelect')}+${padBtn('skill1')}·${padBtn('skill2')}·${padBtn('skill3')}·${padBtn('skill4')} 스킬  ${padBtn('itemSelect')}+D-패드 소모품  ${padBtn('inventory')} 가방→스킬  ${padBtn('reload')} 장전(활=시위 내림)  ${padBtn('lantern')} 랜턴(길게=배터리)  ${padBtn('pause')} 일시정지·키 설정`
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
  // 폴링을 먼저 — 끊겼다 다시 꽂힌 패드는 폴링해야 비로소 잡힌다.
  // connected 를 먼저 보면(구 코드) 일시정지 중 끊긴 패드를 영영 다시 못 알아본다:
  // 패드가 빠지면 게임이 멈추고, 멈춘 동안엔 여기 말고는 폴링할 곳이 없다
  pad.poll();
  if (!pad.connected) return;
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
  openBindings: (mode) => {
    // 일시정지는 유지한 채 설정 화면만 덮는다 — 닫으면 다시 메뉴로 돌아온다
    pauseMenu.hide();
    gamepadUI.show(mode);
  },
  loadSave: () => {
    world.dead = false;
    respawnAtAltar();
    setPaused(false);
    input.requestLock();
  },
},
// 패드가 연결돼 있으면 메뉴 오른쪽에 현재 매핑 다이어그램을 함께 띄운다
() => (input.gamepad.connected ? padDiagramSvg((a) => input.gamepad.binding(a), -1) : null));

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
