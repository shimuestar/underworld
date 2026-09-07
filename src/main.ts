import { GameAudio } from './core/Audio';
import { balance } from './core/Balance';
import { Events } from './core/Events';
import { Metrics } from './core/Metrics';
import * as Save from './core/Save';
import * as SaveStorage from './core/SaveStorage';
import { DebugOverlay } from './render/DebugOverlay';
import { Input } from './core/Input';
import { Loop } from './core/Loop';
import { World, type ItemKind, type LootKind } from './core/World';
import { countOf, initInventory, spillInventoryToGrave, itemColor, itemDef } from './core/Inventory';
import * as Reaction from './systems/Reaction';
import * as Status from './systems/Status';
import { Level, buildLevelGroup } from './level/GridLoader';
import { spawnBarrels, spawnChests, spawnEnemies, spawnEnemyAt, spawnNpcs, spawnProps, spawnTraps } from './level/Spawner';
import { Minimap } from './render/Minimap';
import { Awareness } from './render/Awareness';
import { Compass } from './render/Compass';
import { MenuTabs } from './render/MenuTabs';
import { MapPanel } from './render/MapPanel';
import { PauseMenu } from './render/PauseMenu';
import { GamepadUI, padDiagramSvg } from './render/GamepadUI';
import { buttonName, type PadAction } from './core/Gamepad';
import { KEY_ACTIONS, keyBindings, type KeyAction } from './core/KeyBindings';
import { Stage } from './render/Stage';
import { grenadeThrowSpeed } from './systems/Weapons';
import * as PlayerMove from './systems/PlayerMove';
import { assistStrength, padAimAssist } from './systems/PlayerMove';
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
import * as Traps from './systems/Traps';
import * as Hazards from './systems/Hazards';
import * as Arena from './systems/Arena';
import * as Chest from './systems/Chest';
import * as Exit from './systems/Exit';
import * as Door from './systems/Door';
import * as Lever from './systems/Lever';
import * as Lantern from './systems/Lantern';
import * as Loot from './systems/Loot';
import { VENT_WEAK_POINT, enemyDef, healthBarState, resolvePhase } from './core/Entities';
import { ShopUI } from './render/ShopUI';
import { LootUI } from './render/LootUI';
import { InventoryUI, quickslotView } from './render/InventoryUI';
import { SKILL_KEYS, SkillUI } from './render/SkillUI';
import { itemIconSvg } from './render/ItemIcons';
import { allSigilIds, isActiveSkill, isImplemented, sigilColor, sigilDef, type SigilDef } from './core/SigilData';
import z01f1 from '../data/levels/z01_f1.json';
import z01f2 from '../data/levels/z01_f2.json';
import z01f3 from '../data/levels/z01_f3.json';
import z01f4 from '../data/levels/z01_f4.json';
import testTraps from '../data/levels/test_traps.json';
import testMonsters from '../data/levels/test_monsters.json';
import lobbyJson from '../data/levels/lobby.json';
import * as Npc from './systems/Npc';
import { ListDialog } from './render/ListDialog';
import { MerchantUI } from './render/MerchantUI';
import * as Summon from './systems/Summon';
import * as Equipment from './systems/Equipment';
import { equipDef, slotLabel, type EquipSlot } from './core/EquipData';
import { SummonPanel } from './render/SummonPanel';

// 1구역 층 순서 — 출구에서 E 를 누르면 다음 층으로 내려간다. 마지막 층을 나가면 구역 클리어.
// 층마다 스폰(S)이 곧 그 층의 입구이고, 출구(X)가 다음 층의 입구로 이어진다
const ZONE = [z01f1, z01f2, z01f3, z01f4]; // 4층 = 거수 결투 층 「무저갱 우리」(B3-5)
/** 트랩 시험방 — 층 번호 대역 밖의 특수 층. 일시정지 메뉴(또는 ?traproom)로 들어간다.
 *  출구는 영구 봉인, 위층 계단 없음 — 나가는 길은 '처음부터 시작' */
const TRAP_ROOM = 99;
/** 몬스터 시험방 층 번호 — 소환 탭으로 종족별 마리 수를 골라 무한 사냥 (2026-09-04) */
const MONSTER_ROOM = 98;
/** 성소 로비 — 지하 1층 위의 예배당 (2026-09-07 사용자 기획). 죽으면 여기 부활 마법진에서 깨어난다.
 *  대제단은 활성화한 제단으로 워프(그 층 몬스터 전부 부활), 사제(축복)·상인(상점). 남쪽 현관 계단이 지하 1층으로 이어진다 */
const LOBBY = 97;
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
  traps: World['traps'];
  chests: World['chests'];
  doors: World['doors'];
  groundItems: World['groundItems'];
  lifeMotes: World['lifeMotes'];
  pulledLevers: World['pulledLevers'];
  /** 보스 아레나 상태(거수 4층, B3-5) — 봉쇄·기둥 내구·잔해. 아레나 없는 층은 null */
  arena: World['arena'];
  /** NPC(로비의 사제·상인) — 다른 층은 빈 배열 */
  npcs: World['npcs'];
}
const floorStates = new Map<number, FloorState>();
/** 불러온 세이브의 층 차이 — 그 층을 처음 지을 때 loadFloor 가 덧씌우고 지운다 (core/Save) */
let pendingFloorDiffs: Record<string, Save.FloorDiff> = {};
/** 첫 로드·세이브 복원 중에는 층 이동 자동 저장을 하지 않는다 */
let suppressAutosave = false;

const app = document.getElementById('app');
const hud = document.getElementById('hud');
const deathOverlay = document.getElementById('death');
const deathTitle = document.getElementById('death-title');
const deathStats = document.getElementById('death-stats');
const deathHint = document.getElementById('death-hint');
const flashOverlay = document.getElementById('flash');
const hurtOverlay = document.getElementById('hurt');
const altarPrompt = document.getElementById('altar-prompt');
const interactKeyEl = document.getElementById('interact-key');
const crosshairEl = document.getElementById('crosshair')!;
if (!app || !hud || !deathOverlay || !deathTitle || !deathStats || !deathHint || !flashOverlay || !hurtOverlay || !altarPrompt)
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
    | 'roar' | 'heartbeat' | 'tremble' | 'crumble' | 'webSnag' | 'webTear' | 'weakPoint',
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

/** 메뉴 스틱 — 왼 스틱의 기울기를 D-패드 한 칸 이동으로 바꾼다. 임계를 넘긴 순간 한 칸, 계속 밀면
 *  firstRepeatTicks 뒤부터 repeatTicks 마다 반복. 축마다 따로 세지 않고 지배적인 축 하나만 본다 */
const menuStick = { dx: 0, dy: 0, held: 0 };
function menuStickStep(): { dx: number; dy: number } {
  const cfg = balance.input.gamepad.menuStick;
  const none = { dx: 0, dy: 0 };
  if (!input.gamepad.connected) { menuStick.dx = 0; menuStick.dy = 0; menuStick.held = 0; return none; }
  const ax = input.gamepad.axes();
  let dx = 0;
  let dy = 0;
  if (Math.abs(ax.moveX) >= Math.abs(ax.moveY)) {
    if (Math.abs(ax.moveX) >= cfg.threshold) dx = Math.sign(ax.moveX);
  } else if (Math.abs(ax.moveY) >= cfg.threshold) {
    dy = Math.sign(ax.moveY); // 위가 음수 → 위로 이동은 dy -1
  }
  if (dx === 0 && dy === 0) { menuStick.dx = 0; menuStick.dy = 0; menuStick.held = 0; return none; }
  if (dx !== menuStick.dx || dy !== menuStick.dy) {
    menuStick.dx = dx; menuStick.dy = dy; menuStick.held = 0;
    return { dx, dy };
  }
  menuStick.held++;
  if (menuStick.held >= cfg.firstRepeatTicks && (menuStick.held - cfg.firstRepeatTicks) % cfg.repeatTicks === 0) return { dx, dy };
  return none;
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
  traps: spawnTraps(levelJson.entities, level),
  chests: spawnChests(levelJson.entities, level),
  level,
});

// 시작 층(지하 1층)은 loadFloor 를 거치지 않는다 — 봉인 여부를 여기서 한 번 세운다.
// 이게 없으면 기본값 false 로 남아 첫 틱에 출구가 열려 버린다 (슬라임 보스 생존 중인데도)
world.exitNeedsKey = world.enemies.some((e) => e.floorBoss || enemyDef(e.type).boss);
world.canAscend = true; // 지하 1층 입구 계단은 성소 로비로 올라간다 (2026-09-07)
world.arena = Arena.fromLevel(level); // 시작 층에 아레나가 있으면(테스트 ?f4 는 loadFloor 를 탄다) 여기서 짓는다 — 보통 null

const stage = new Stage(app);
const awareness = new Awareness(); // 위협·소리 기억 — 미니맵·나침반 공유
const minimap = new Minimap(level, awareness);
// 나침반 — 상단 중앙, 항상 표시 (2026-09-04). 목표 표식은 미니맵의 안개 기억으로 가린다
const compass = new Compass(awareness, (x, z) => minimap.isRevealedAt(x, z));
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
// 메뉴 창 — 탭(맵·가방·스킬)을 가진 하나의 창. 패널들은 셸의 body 에 그린다 (2026-09-04)
const menuTabsPending: import('./render/MenuTabs').MenuTabDef[] = [];
const menuUI = new MenuTabs(menuTabsPending); // 탭 정의는 아래에서 채운다 (order 는 데이터)
const inventoryUI = new InventoryUI(world, menuUI.body); // 가방 탭 — 소모품
// 보관 주머니 — 가방 탭에서 빈 주머니를 발밑에 내려놓고 곧장 루팅 창으로 (loot_opened 가 창을 연다)
inventoryUI.onClose = () => menuUI.hide(); // B·Esc 로 창 안에서 닫았다 — 셸이 uiOpen 을 되돌린다
// 퀵슬롯 칸 표기는 HUD 물약 마름모와 같은 장치·바인딩 — 패드면 LB 를 누른 채 D-패드 (원 안 글자, 2026-09-07 사용자)
inventoryUI.keyLabel = (i, pad) => quickSlotKeyLabelFor(i, pad);
inventoryUI.padSelectLabel = () => shortPadBtn(input.gamepad.binding('itemSelect'));
inventoryUI.onEdge = (dir) => menuUI.next(dir); // 패드 D-패드로 격자 끝에서 한 번 더 밀면 옆 탭으로 (키보드는 화살표가 곧 탭 전환)
inventoryUI.onPlacePouch = () => {
  menuUI.hide();
  Loot.createPlayerPouch(world);
};
const skillUI = new SkillUI(world, menuUI.body); // 스킬 탭 — 퀵슬롯 마름모 · 익힌 스킬
// 칸 표기는 HUD 와 같은 장치·바인딩을 따른다 — 패드면 RB 를 누른 채 Y·B·A·X (2026-09-07 사용자: 패드인데 Z·X·C·V 로 나왔다)
skillUI.keyLabel = (i, pad) => skillSlotKeyLabelFor(i, pad);
skillUI.padSelectLabel = () => shortPadBtn(input.gamepad.binding('skillSelect'));
skillUI.onEdge = (dir) => menuUI.next(dir); // 패드 D-패드로 끝(마름모 왼쪽 칸 ← / 목록 →)에서 한 번 더 밀면 옆 탭으로
skillUI.onClose = () => menuUI.hide(); // B — 고른 것이 없을 때
const mapPanel = new MapPanel(world, awareness, (x, z) => minimap.isRevealedAt(x, z), menuUI.body); // 맵 탭 — 큰 지도
const summonUI = new SummonPanel(world, menuUI.body); // 소환 탭 — 몬스터 시험방에서만 (available)
summonUI.onEdge = (dir) => menuUI.next(dir);
summonUI.onNotice = (msg) => showReaction(msg, 2500);
summonUI.onAction = () => {
  audio.play('ui_tab');
  padRumble('interact');
};
menuTabsPending.push(
  {
    id: 'map', label: '맵', status: () => minimap.floorTitleText,
    show: () => { mapPanel.setTitle(minimap.floorTitleText); mapPanel.show(); }, hide: () => mapPanel.hide(), update: () => mapPanel.update(),
  },
  {
    id: 'bag', label: '가방',
    status: () => `${world.inventory.filter((s) => s !== null).length}/${world.inventory.length}`,
    show: () => { inventoryUI.padMode = input.lastDevice === 'pad'; inventoryUI.altar = menuUI.altar; inventoryUI.show(); }, hide: () => inventoryUI.hide(), // 제단 앞이면 각인을 팔 수 있다. 첫 그림부터 장치 표기가 맞게(틱 갱신은 열린 뒤에만 돈다)
    blocksArrows: () => inventoryUI.splitting, // 수량 나누기 대화상자가 열려 있으면 화살표는 그쪽 몫
  },
  {
    id: 'skill', label: '스킬',
    status: () => `${world.skillSlots.filter((slot) => slot !== null).length}/${balance.skills.quickslots}`, // 퀵슬롯에 올린 수 ('액티브' 표기는 뺐다 — 2026-09-04 사용자)
    show: () => { skillUI.padMode = input.lastDevice === 'pad'; skillUI.show(menuUI.altar); }, hide: () => skillUI.hide(), // 첫 그림부터 장치 표기가 맞게
  },
  {
    id: 'summon', label: '소환',
    status: () => (world.summonAuto ? '자동 ON' : `${world.enemies.filter((e) => e.alive).length}마리`),
    available: () => world.monsterRoom, // 시험방 밖에서는 탭이 없다
    show: () => summonUI.show(), hide: () => summonUI.hide(), update: () => summonUI.update(),
  },
);
menuUI.onOpenChange = (open) => setUiOpen(open);
menuUI.onTabChange = () => {
  audio.play('ui_tab');
  padRumble('interact');
};
events.on('player_died', () => menuUI.hide());
const shopUI = new ShopUI(world);
/** 사망 메뉴 — #death 오버레이 안에 패널로 뜬다 (2026-09-07 로비 도입). 항목은 showDeathMenu 가 짓는다 */
const deathMenu = new ListDialog(deathOverlay);
/** 로비 대제단 — 활성화한 제단 목록. 고르면 그 층 제단 자리로 워프(몬스터 전부 부활) */
const warpDialog = new ListDialog(undefined, 'warpdialog');
/** 사제 대화 — 축복·(추후) 퀘스트 */
const npcDialog = new ListDialog(undefined, 'npcdialog');
/** 저장 목록 — 정지 메뉴 '불러오기' (2026-09-07 사용자) */
const saveDialog = new ListDialog(undefined, 'savedialog');
/** 상인 창 — 팔기·사기·퀘스트, 인벤토리 방식 (2026-09-07 사용자). 제단 상점(ShopUI)과 품목·재고를 공유한다 */
const merchantUI = new MerchantUI(world);
/** UI 오버레이 열기/닫기 — 닫을 때 포인터 락을 바로 되찾는다.
 *  안 그러면 메뉴를 나온 뒤 커서가 남아 화면을 한 번 클릭해야 조작이 돌아온다 */
function setUiOpen(open: boolean): void {
  world.uiOpen = open;
  if (open) document.exitPointerLock();
  else input.requestLock();
}
shopUI.onClose = () => setUiOpen(false);
/** NPC 창을 닫았다 — 닫은 그 상호작용 키가 다음 틱에 대화를 도로 열지 않게 잠깐 막는다 (2026-09-07 사용자: E 로 나갈 수 없었다) */
function closeNpcUi(): void {
  world.npcReopenGuard = balance.lobby.npc.reopenGuardTicks;
  setUiOpen(false);
}
merchantUI.onClose = closeNpcUi;
// 루팅 창 — 주머니·상자를 뒤진다. 열리는 건 loot_opened(Loot/Chest 가 낸다), 닫히면 규칙(빈 주머니 정리·재오픈 가드)을 Loot 에 맡긴다
const lootUI = new LootUI(world);
lootUI.onClose = () => {
  Loot.closeLoot(world);
  setUiOpen(false);
};
// 실시간 루팅 — 반응(패링·방어)·질주/회피 키는 창을 닫고 그 입력이 그대로 통한다 (Input 이 이미 눌림을 기록한다)
lootUI.escapeKey = (code) => code === keyBindings.code('reaction') || code === keyBindings.code('sprint');
events.on('loot_opened', (payload) => {
  const info = payload as { kind: 'pouch' | 'chest'; first?: boolean };
  // 상자를 처음 여는 소리는 chest_opened 가 낸다 — 다시 뒤질 때와 주머니는 가죽 스침
  if (info.kind === 'pouch' || info.first === false) audio.play('pouch_open');
  padRumble('interact');
  menuUI.hide();
  lootUI.show();
  setUiOpen(true);
});
// 메뉴 창 키 — I·Tab 가방 탭 · M 맵 탭으로 열고, 열려 있으면 어느 키든 닫는다. 스킬 탭은 ←→(LB/RB) 또는 헤더 클릭 (2026-09-04: Tab 기본을 가방으로)
window.addEventListener('keydown', (e) => {
  if (lootUI.open) return; // 루팅 창은 자기 키(E/Esc)로만 닫는다 — 다른 창을 겹쳐 열지 않게
  if (merchantUI.open) return; // 상인 창도 — Tab·1/2/3 은 그 안의 탭 전환이다
  if (e.code === 'Tab') {
    e.preventDefault();
    // 상점에서 Tab — 스킬 탭(제단 모드: 패시브를 뗄 수 있다)으로 넘어간다 (둘이 겹쳐 뜨지 않게)
    if (shopUI.open) {
      shopUI.hide();
      menuUI.show('bag', true); // 제단 앞 — 가방 탭(몸 패널에서 각인 떼기·장비·매각)
      return;
    }
    if (world.dead) return;
    menuUI.toggleTab('bag'); // Tab 기본은 가방 (2026-09-04 사용자) — 스킬은 LB/RB·←→ 로
    return;
  }
  if (shopUI.open || world.dead) return;
  if (e.code === keyBindings.code('inventory')) menuUI.toggleTab('bag');
  else if (e.code === keyBindings.code('map')) menuUI.toggleTab('map');
});
let restartConfirmUntil = 0;

window.addEventListener('keydown', (e) => {
  // F3 두 번 — 중간 다시 하기 (제단 등록 시 제단에서, 아니면 처음부터)
  if (e.code === 'F3') {
    e.preventDefault();
    if (performance.now() < restartConfirmUntil) {
      // 로비 마법진에서 — 제단 부활은 폐지 (2026-09-07 사용자)
      reviveInLobby();
    } else {
      restartConfirmUntil = performance.now() + 2000;
      showReaction('F3 한 번 더 — 성소 로비에서 다시 시작', 2000);
    }
  }
  // 테스트용 무적 토글 — HP·마나·탄약·배터리·스태미너가 줄지 않는다 (슬라이스 검증 시 제거).
  // 켤 때 구현된 액티브 스킬을 전부 익힌다 — 스킬 시험이 목적이라 스킬 탭이 비어 있으면 쓸 게 없다 (2026-09-07 사용자).
  // 끌 때 스킬은 남는다 — 정식으로 익힌 것과 구분할 수 없어 빼앗지 않는다 (U 와 같은 규약)
  if (e.code === 'KeyG') {
    world.godMode = !world.godMode;
    const n = world.godMode ? grantActiveSkills() : 0;
    showReaction(
      world.godMode
        ? n > 0
          ? `(테스트) 무적 ON — 액티브 스킬 ${n}종 익힘`
          : '(테스트) 무적 ON'
        : '(테스트) 무적 OFF',
      1400,
    );
    console.log('[debug] 무적', world.godMode, '액티브 익힘', n);
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
  'lantern_denied',
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
  'weak_point_hit',
  'weak_point_broken',
  'exposure_closed',
  'boss_status',
  'boss_phase',
  'plate_shed',
  'plate_broken',
  'charge_dodged',
  'pillar_hit',
  'pillar_damaged',
  'pillar_collapsed',
  'arena_sealed',
  'arena_unsealed',
  'arena_hold',
  'arena_rubble_broken',
  'anticamp_charge',
  'anticamp_stun',
  'anticamp_far',
  'door_sealed',
  'numb_arm_applied',
  'numb_arm_ended',
  'concussion_applied',
  'concussion_ended',
  'hobble_applied',
  'hobble_ended',
  'enemy_slam_start',
  'slam_landed',
  'spawn_pool',
  'pool_spawned',
  'pool_evaporated',
  'corrosive_applied',
  'corrosive_tick',
  'corrosive_ended',
  'corrosive_pending',
  'corruption_cleansed',
  'cowed_applied',
  'cowed_ended',
  'enemy_roar_start',
  'enemy_roar',
  'boss_roar_hit',
  'enemy_combo_start',
  'enemy_combo_step',
  'enemy_chain_turn',
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
  'grave_channel_started',
  'grave_channel_broken',
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
  'trap_triggered',
  'trap_telegraph',
  'trap_fired',
  'trap_spent',
  'trap_hit_player',
  'trap_hit_enemy',
  'trap_net_caught',
  'trap_net_torn',
  'trap_kill',
  'trap_disarmed',
  'trap_parried',
  'trap_ignited',
  'trap_gas_cough',
  'trap_whoosh',
  'trap_creak',
  'trap_revealed',
  'trap_retract',
  'trap_rearmed',
  'poison_applied',
  'poison_tick',
  'poison_ended',
  'burn_applied',
  'burn_tick',
  'burn_ended',
  'poison_refreshed',
  'burn_refreshed',
  'trap_reset',
  'trap_rubble_broken',
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
  'pouch_dropped',
  'pouch_landed',
  'pouch_placed',
  'loot_opened',
  'loot_closed',
  'loot_taken',
  'loot_stashed',
  'loot_dropped',
  'loot_denied',
  'loot_revealed',
  'pickup_bounced',
  'item_picked',
  'item_gained',
  'item_used',
  'arrow_loosed',
  'arrow_impact',
  'arrow_shielded',
  'bow_draw_released',
  'grenade_cancelled',
  'loot_moved',
  'item_moved',
  'loot_carry_started',
  'loot_carry_cancelled',
  'item_split',
  'food_regen_tick',
  'loot_interrupt',
  'loot_interrupted',
  'aim_snapped',
  'arrow_recovered',
  'arrow_broken',
  'quiver_full',
  'item_channel_started',
  'item_channel_broken',
  'item_denied',
  'item_dropped',
  'inventory_full',
  'quickslot_bound',
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
  'game_saved',
  'game_loaded',
  'save_deleted',
  'lobby_altar_entered',
  'lobby_warp',
  'npc_talked',
  'blessed',
  'blessing_denied',
  'blessing_ended',
  'item_sold',
  'item_sell_denied',
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
  'door_closing',
  'door_closed',
  'door_blocked',
  'door_reopened',
  'lever_pulled',
]) {
  events.on(name, (payload) => console.log(`[events] ${name}`, payload));
}

// ---- 오디오 (합성음, 에셋 없음) ----
const audio = new GameAudio();
app.addEventListener('click', () => audio.unlock());
events.on('enemy_windup', (payload) => {
  const wind = payload as { telegraph?: string; enemyType?: string; perfectOnly?: boolean };
  // 박쥐 박치기는 예고 시작이 '조용한 정지 비행'이다 — 신호는 발사 순간의 비명(bat_swoop)
  if (wind.enemyType === 'bat') return;
  const at = panOf(payload); // 예고음에 방향을 싣는다 — 등 뒤 공격을 귀가 먼저 안다
  // 슬라임 — 몸이 부풀어 오르는 꿀렁임을 텔레그래프 소리에 얹는다
  if (wind.enemyType?.startsWith('slime')) audio.play('slime_windup', at);
  const telegraph = wind.telegraph;
  // 완벽 전용 파랑(거수 삼연낫 ③, attack.perfectOnly — 결정 17)은 같은 파랑 예고음을 고음으로
  audio.play(
    telegraph === 'red'
      ? 'telegraph_red'
      : telegraph === 'purple'
        ? 'telegraph_purple'
        : wind.perfectOnly
          ? 'telegraph_blue_high'
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
// ---- 함정 — 예고는 소리·모형 동작으로만 (UI 표시 없음) ----
// 가시판 소리는 같은 틱에 여러 장이 함께 울리면(자동 순환 필드) 한 번만 낸다 — 겹치면 뭉개진다
const spikeSoundTick: Record<string, number> = {};
function spikeSoundOnce(kind: string): boolean {
  if (spikeSoundTick[kind] === world.tick) return false;
  spikeSoundTick[kind] = world.tick;
  return true;
}
const isSpikeType = (type: string): boolean => type === 'trap_spike' || type === 'trap_spike_auto';
const isAutoTrap = (type: string): boolean =>
  type === 'trap_spike_auto' || type === 'trap_dart_auto' || type === 'trap_pendulum' || type === 'trap_gas_auto';
/** 함정 소리 위치 — 밟는 함정은 일반 공간 음향(멀리서도 최소 볼륨), 자동 순환 장치는
 *  reach 밖 무음·안에서는 거리 제곱 감쇠 (null = 안 들린다) */
function trapSoundAt(type: string, x: number, z: number): { pan: number; vol: number } | null {
  if (!isAutoTrap(type)) return panAt(x, z);
  const cfg = balance.traps.autoSound;
  const d = Math.hypot(world.player.x - x, world.player.z - z);
  if (d >= cfg.reach) return null;
  return { pan: panAt(x, z).pan, vol: Math.pow(1 - d / cfg.reach, cfg.curve) };
}
events.on('trap_telegraph', (payload) => {
  const t = payload as { type: string; x: number; z: number };
  if (t.type === 'trap_rockfall') {
    // 천장이 우르릉 — 가까우면 손도 떨린다 (돌이 떨어지기 0.5초 전)
    audio.play('trap_rumble', panAt(t.x, t.z));
    const d = Math.hypot(world.player.x - t.x, world.player.z - t.z);
    if (d < 12) {
      padRumble('tremble');
      stage.triggerCameraKick(0.12 * (1 - d / 12), 400);
    }
    return;
  }
  if (isSpikeType(t.type) || t.type === 'trap_dart') {
    // 묵직한 판 침강(가시판·다트 압력판 공통) — 내가 밟았으면 발밑 진동도 온다
    const at = trapSoundAt(t.type, t.x, t.z);
    if (at && spikeSoundOnce('tele')) audio.play('trap_click', at);
    const trap = world.traps.find((tr) => tr.id === (payload as { id: number }).id);
    if ((trap?.type === 'trap_spike' || trap?.type === 'trap_dart') && trap.triggeredBy === 'player') {
      padRumble('heavy');
    }
    return;
  }
  if (t.type === 'trap_gas' || t.type === 'trap_gas_auto') {
    // 포자 식물이 벌어진다 / 군락이 부푼다 — 지금 물러나라. 자동 군락도 10m 감쇠를 쓰지 않는다:
    // 구름은 위험하니 매번 멀리서도 들려야 한다 (자동 가시·다트의 딸깍과 다른 결)
    audio.play('trap_bloom', panAt(t.x, t.z));
    return;
  }
  // 자동 다트 발사기 — 발판 없이 쉬익 (같은 틱에 여러 개면 한 번, 자동은 10m 감쇠)
  const at = trapSoundAt(t.type, t.x, t.z);
  if (at && spikeSoundOnce('hiss')) audio.play('trap_hiss', at);
});
// 작동이 끝나고 다시 장전되는 과정도 들린다 — 가시가 들어가고(회수), 래칫이 걸린다(재장전)
events.on('trap_retract', (payload) => {
  const t = payload as { type: string; x: number; z: number };
  const at = trapSoundAt(t.type, t.x, t.z);
  if (isSpikeType(t.type) && at && spikeSoundOnce('retract')) audio.play('trap_spike_down', at);
});
events.on('trap_rearmed', (payload) => {
  const t = payload as { type: string; x: number; z: number };
  const at = trapSoundAt(t.type, t.x, t.z);
  if (!at) return;
  if (isSpikeType(t.type)) {
    if (spikeSoundOnce('rearm')) audio.play('trap_rearm', at);
  } else if (t.type === 'trap_dart' || t.type === 'trap_gas') {
    audio.play('trap_rearm', at);
  }
});
events.on('trap_gas_cough', () => audio.play('trap_cough')); // 내 기침 — 패닝 없음
// 낙석 잔해가 폭발에 부서졌다 — 붕괴와 같은 결(돌·먼지·진동)로 한 번 더, 길이 열렸다고 알린다
events.on('trap_rubble_broken', (payload) => {
  const t = payload as { x: number; z: number };
  audio.play('wall_crumble', panAt(t.x, t.z));
  stage.spawnWallCrumble(t.x, t.z);
  const d = Math.hypot(world.player.x - t.x, world.player.z - t.z);
  if (d < 12) {
    stage.triggerCameraKick(0.3 * (1 - d / 12), 200);
    padRumble('crumble');
  }
  showReaction('잔해가 부서졌다 — 길이 열렸다', 2000);
});
// ---- 보스 아레나(거수 「무저갱 우리」 4층, B3-5 — systems/Arena) ----
// 봉쇄: 문 D 에 붉은 쇠창살(출구 창살과 같은 문법) + 쇠사슬 소리. 해제: 주인이 죽으면 문이 다시 열린다는 안내, 밖으로 빠져나갔으면 거수가 물러선다
events.on('arena_sealed', (payload) => {
  const a = payload as { row?: number; col?: number; x?: number; z?: number };
  if (a.row !== undefined && a.col !== undefined) stage.setDoorSealed(a.row, a.col, true);
  audio.play('chain_locked', a.x !== undefined && a.z !== undefined ? panAt(a.x, a.z) : undefined);
  padRumble('heavy');
  stage.triggerCameraKick(0.25, 300);
  showReaction('우리가 닫혔다 — 거수를 쓰러뜨려야 문이 열린다', 3000);
});
events.on('arena_unsealed', (payload) => {
  const a = payload as { reason: string; row?: number; col?: number; x?: number; z?: number };
  if (a.row !== undefined && a.col !== undefined) stage.setDoorSealed(a.row, a.col, false);
  if (a.reason === 'boss_dead') {
    audio.play('door_slide', a.x !== undefined && a.z !== undefined ? panAt(a.x, a.z) : undefined);
    showReaction('봉쇄가 풀렸다 — 남쪽 문이 다시 열린다', 2600);
  } else if (a.reason === 'left') {
    showReaction('우리 밖으로 나왔다 — 거수가 제자리로 물러선다', 2000);
  }
});
events.on('arena_hold', () => showReaction('거수가 우리 안에서 기다린다 — 들어서면 문이 닫힌다', 2400));
// 기둥 내구 — 금이 갈 때마다 붉은 균열선 + 낮은 우르릉. 붕괴는 낙석과 같은 결(돌·먼지·진동), 잔해는 지도에서 바닥이 된다(총알·시야 통과)
events.on('pillar_damaged', (payload) => {
  const d = payload as { row: number; col: number; hp: number; max: number; x: number; z: number };
  if (d.hp <= 0) return; // 붕괴는 pillar_collapsed 가 낸다
  stage.setPillarDamage(d.row, d.col, d.hp, d.max);
  audio.play('trap_rumble', panAt(d.x, d.z));
  showReaction(`기둥에 금이 갔다 (${d.max - d.hp}/${d.max})`, 1400);
});
events.on('pillar_collapsed', (payload) => {
  const c = payload as { row: number; col: number; x: number; z: number };
  stage.collapsePillar(c.row, c.col, c.x, c.z, balance.arena.rubbleHalf);
  audio.play('wall_crumble', panAt(c.x, c.z));
  const d = Math.hypot(world.player.x - c.x, world.player.z - c.z);
  if (d < 12) {
    stage.triggerCameraKick(0.6 * (1 - d / 12), 300); // 함정 낙석(trap_rockfall)과 같은 결
    padRumble('crumble');
  }
  minimap.rebuildBase();
  showReaction('기둥이 무너졌다 — 잔해가 길을 막는다 (돌격은 헛돈다 · 폭발로 부술 수 있다)', 2800);
});
events.on('arena_rubble_broken', (payload) => {
  const r = payload as { row: number; col: number; x: number; z: number };
  stage.breakRubble(r.row, r.col, r.x, r.z, balance.arena.rubbleHalf);
  audio.play('wall_crumble', panAt(r.x, r.z));
  showReaction('잔해가 부서졌다 — 길이 열렸다', 2000);
});
// 반캠핑 — 자발 돌격은 예고음(enemy_windup telegraph_red)이 따로 나므로 안내만, 박치기는 둔탁한 충돌음, 접근 가속은 안내
events.on('anticamp_charge', () => {
  padRumble('tremble');
  showReaction('거수가 숨은 기둥을 노린다 — 비켜라!', 1600);
});
events.on('anticamp_stun', (payload) => {
  audio.play('thud', panOf(payload));
  showReaction('거수가 기둥에 머리를 박고 잠깐 멈췄다', 1000);
});
events.on('anticamp_far', (payload) => {
  if ((payload as { on: boolean }).on) showReaction('거수가 거리를 좁힌다 — 빨라진다!', 1600);
});
let doorSealedUntil = 0;
events.on('door_sealed', (payload) => {
  const d = payload as { x: number; z: number };
  audio.play('chain_locked', panAt(d.x, d.z));
  if (performance.now() < doorSealedUntil) return; // E 를 두들기면 매 틱 뜬다
  doorSealedUntil = performance.now() + 1500;
  showReaction('봉쇄된 문 — 우리의 주인이 살아 있는 동안 열리지 않는다', 1800);
});
// 지속 피해 상태(독·화염) — 걸리는 순간 알리고(초기 피해는 player_damaged 가 이미 붉게 알린다), 풀리면 알린다.
// 도트 틱은 붉은 화면·진동 없이 '윽' 신음만 — 깎일 때마다 귀로 세게 (2026-09-03)
const dotSeconds = (payload: unknown): number => Math.round(((payload as { ticks: number }).ticks ?? 0) / 60);
events.on('poison_applied', (payload) => {
  showReaction(`독에 중독됐다 — ${dotSeconds(payload)}초 동안 체력이 조금씩 깎인다`, 2600);
});
events.on('poison_tick', (payload) => {
  audio.play('grunt');
  showDamageTaken((payload as { amount: number }).amount, 'poison'); // 도트는 이미 박자마다 묶여 온다
});
events.on('poison_ended', () => showReaction('독이 풀렸다', 1400));
events.on('burn_applied', (payload) => {
  showReaction(`불이 붙었다 — ${dotSeconds(payload)}초 동안 타며 체력이 깎인다`, 2200);
});
events.on('burn_tick', (payload) => {
  audio.play('grunt_fire');
  showDamageTaken((payload as { amount: number }).amount, 'burn');
});
events.on('burn_ended', () => showReaction('불이 꺼졌다', 1200));
// 이미 걸린 채 다시 닿았다 — 시간이 처음부터. 재시작 소리 + 아이콘 깜빡임 (구름·불길 안에 서 있는 동안은 나지 않는다)
events.on('poison_refreshed', (payload) => {
  audio.play('poison_refresh');
  flashBuffIcon(buffPoisonEl);
  showReaction(`독이 다시 퍼졌다 — ${dotSeconds(payload)}초 처음부터`, 1600);
});
events.on('burn_refreshed', (payload) => {
  audio.play('burn_refresh');
  flashBuffIcon(buffBurnEl);
  showReaction(`불이 다시 붙었다 — ${dotSeconds(payload)}초 처음부터`, 1400);
});
let trapRevealHintShown = false;
events.on('trap_revealed', (payload) => {
  const t = payload as { x: number; z: number };
  audio.play('trap_ping', panAt(t.x, t.z));
  if (!trapRevealHintShown) {
    trapRevealHintShown = true;
    showReaction('함정 감지 — 보랏빛이 도는 자리는 밟지 마라', 2400);
  }
});
events.on('trap_whoosh', (payload) => {
  const t = payload as { x: number; z: number };
  const at = trapSoundAt('trap_pendulum', t.x, t.z);
  if (at) audio.play('trap_whoosh', at);
});
events.on('trap_creak', (payload) => {
  const t = payload as { x: number; z: number };
  const at = trapSoundAt('trap_pendulum', t.x, t.z);
  if (at) audio.play('trap_creak', at);
});
events.on('trap_parried', (payload) => {
  const t = payload as { x: number; z: number };
  audio.play('parry_perfect');
  padRumble('parry');
  stage.spawnGuardSparks(t.x, t.z, 1.2, 0xfff0b0, 1.2);
  showReaction('칼날을 받아냈다!', 1200);
});
events.on('trap_fired', (payload) => {
  const t = payload as { type: string; x: number; z: number };
  if (isSpikeType(t.type)) {
    const at = trapSoundAt(t.type, t.x, t.z);
    if (at && spikeSoundOnce('fire')) audio.play('trap_spikes', at);
    // 발밑에서 쇠가 솟는다 — 가까울수록 화면이 흔들린다 (피해 유무와 무관)
    const d = Math.hypot(world.player.x - t.x, world.player.z - t.z);
    if (d < 12) stage.triggerCameraKick(0.35 * (1 - d / 12), 120);
  } else if (t.type === 'trap_dart' || t.type === 'trap_dart_auto') {
    const at = trapSoundAt(t.type, t.x, t.z);
    if (at && spikeSoundOnce('dart')) audio.play('trap_dart', at);
  } else if (t.type === 'trap_net') {
    audio.play('trap_net', panAt(t.x, t.z));
  } else if (t.type === 'trap_rockfall') {
    // 돌이 떨어진다 — 균열 벽 붕괴와 같은 결 (돌·먼지·진동)
    audio.play('wall_crumble', panAt(t.x, t.z));
    stage.spawnWallCrumble(t.x, t.z);
    const d = Math.hypot(world.player.x - t.x, world.player.z - t.z);
    if (d < 12) {
      stage.triggerCameraKick(0.6 * (1 - d / 12), 300);
      padRumble('crumble');
    }
    showReaction('천장이 무너졌다 — 잔해가 길을 막는다 (총알은 넘어간다 · 폭발로 부술 수 있다)', 2600);
  } else if (t.type === 'trap_gas' || t.type === 'trap_gas_auto') {
    audio.play('trap_spore', panAt(t.x, t.z)); // 포자가 쏟아진다 — 매 분출, 자동 군락도 일반 공간 음향
  }
});
// 적이 그물에 걸렸다 — 끈적한 걸림음 + 안내(처형 기회). 찢고 나올 때는 줄 끊는 소리
events.on('trap_net_caught', (payload) => {
  const t = payload as { x: number; z: number };
  audio.play('net_snag', panAt(t.x, t.z));
  showReaction('적이 그물에 걸렸다 — 굳은 동안 처형할 수 있다', 1800);
});
events.on('trap_net_torn', (payload) => {
  const t = payload as { x: number; z: number };
  audio.play('trap_cut', panAt(t.x, t.z));
});
events.on('trap_disarmed', (payload) => {
  const t = payload as { type: string; x: number; z: number; how: string };
  if (t.type === 'trap_gas') {
    // 포자 식물이 폭발·화염구에 타 죽었다 — 터지지 않는다. 불길 소리 + 주황 섬광
    audio.play('trap_ignite', panAt(t.x, t.z));
    stage.spawnGuardSparks(t.x, t.z, 0.5, 0xff8a2a, 0.5);
    stage.triggerFlash(t.x, 0.8, t.z, 0xff7a1a, 200, 2.5);
    showReaction('포자 식물이 타 죽었다 — 포자는 나오지 않는다', 1600);
    return;
  }
  if (t.type === 'trap_gas_auto') {
    // 포자 군락을 짓밟았다 — 축축한 퍽, 포자가 한 번 흩날리고 끝
    audio.play('trap_squash', panAt(t.x, t.z));
    stage.spawnGuardSparks(t.x, t.z, 0.5, 0x9ccf3c, 0.5);
    stage.triggerFlash(t.x, 0.6, t.z, 0x9ccf3c, 180, 2.5);
    showReaction('포자 군락을 짓밟았다 — 더는 뿜지 않는다', 1600);
    return;
  }
  audio.play('trap_cut', panAt(t.x, t.z));
  stage.spawnGuardSparks(t.x, t.z, 0.45, 0xfff0b0, 0.6);
  showReaction(t.type === 'trap_net' ? '줄을 끊었다 — 그물이 늘어진다' : '함정을 해체했다', 1400);
});
events.on('trap_ignited', (payload) => {
  const t = payload as { x: number; z: number };
  audio.play('trap_ignite', panAt(t.x, t.z));
  stage.triggerFlash(t.x, 0.8, t.z, 0xff7a1a, 260, 3);
  const d = Math.hypot(world.player.x - t.x, world.player.z - t.z);
  if (d < 8) stage.triggerCameraKick(0.25 * (1 - d / 8), 150);
});
events.on('trap_spent', (payload) => {
  const t = payload as { type: string; x: number; z: number };
  if (t.type === 'trap_dart') audio.play('trap_empty', panAt(t.x, t.z)); // 빈 노즐 — 텅
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
  // 족장 화살 세례 — 발사할 때마다 시위 소리 (바위 투척과 구분). 거수 갑각 떨기(진액 구슬, B3-2)는 젖은 분출음
  const boss = world.enemies.find((e) => e.id === info.enemyId);
  if (boss?.ai === 'volley') {
    const goo = enemyDef(boss.type).volleyAttack?.projectileKind === 'goo';
    audio.play(goo ? 'goo_spit' : 'bow_twang', goo ? panAt(boss.x, boss.z) : undefined);
  }
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
  const info = payload as { enemyId: number; enemyType: string; shots: number };
  // 거수 갑각 떨기(B3-2) — 예고음(telegraph_purple)은 enemy_windup 이 냈다. 여기선 분출공 증기·등갑판 덜그럭(vent_hiss, 예고음 버스)과 안내만
  if (enemyDef(info.enemyType).volleyAttack?.projectileKind === 'goo') {
    const e = world.enemies.find((en) => en.id === info.enemyId);
    audio.play('vent_hiss', e ? panAt(e.x, e.z) : undefined);
    showReaction(`갑각 떨기 — 진액 구슬 ${info.shots}발, 반사해 분출공에 되돌리라! (예고 중 분출공 직격 = 역류)`, 2000);
    return;
  }
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
  const at = payload as { x: number; z: number; kind: string };
  audio.play('slime_gulp', panAt(at.x, at.z));
  // 주머니를 통째로 삼켰다 — 전리품이 사라진 게 아니다. 노란 핵이 그 표시고, 죽이면 게워 낸다
  if (at.kind === 'pouch') showReaction('슬라임이 주머니를 먹었다 — 죽이면 게워 낸다', 2200);
});
events.on('slime_spilled', (payload) => {
  const sp = payload as { count: number };
  showReaction(`슬라임이 먹은 것 ${sp.count}개를 게워 냈다`, 1600);
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
/** 같은 틱에 약점을 맞힌 적 — weak_point_hit 가 피해 숫자(damage_pop/enemy_damaged)보다 먼저 오므로
 *  숫자를 띄울 때 이 표시를 보고 옆에 '약점!' 을 붙인다 */
let lastWeakHit: { enemyId: number; tick: number } | null = null;
function popDamageOn(enemyId: number | undefined, amount: number | undefined): void {
  if (enemyId === undefined || amount === undefined || amount < 0.5) return;
  const e = world.enemies.find((en) => en.id === enemyId);
  if (!e) return;
  const weak = lastWeakHit !== null && lastWeakHit.enemyId === enemyId && lastWeakHit.tick === world.tick;
  stage.spawnDamageNumber(e.x, enemyDef(e.type).height + (e.jumpY ?? 0) + 0.25, e.z, amount, weak ? '약점!' : undefined);
}
// 약점 명중(거수 눈·관절·심장·분출공) — 구체가 번쩍이고, 짧은 금속성 소리, 패드 진동. '약점!' 은 피해 숫자 옆에 붙는다(popDamageOn)
events.on('weak_point_hit', (payload) => {
  const hit = payload as { enemyId: number; id: string; damage: number };
  lastWeakHit = { enemyId: hit.enemyId, tick: world.tick };
  stage.flashWeakPoint(hit.enemyId, hit.id);
  audio.play('weak_point_hit');
  padRumble('weakPoint');
});
// 약점 파열(관절 내구 0) — 착탄점에서 몸통색 파편(소형)만. 소리는 다음 틱 boss_status rupture 의 joint_crack 하나다(기획서 §5 표시 열 — 옛 heavy_hit 이중음 제거, B2-3 잔여 메모 → B3-6).
// 분출공 내구 0 은 파열이 아니라 질식(choke) — 소리·문구는 boss_status choke 가 낸다(파편·파열음 없음, B3-2 잔여 메모 → B3-6)
events.on('weak_point_broken', (payload) => {
  const b = payload as { x: number; z: number; enemyType: string; id: string };
  if (b.id === VENT_WEAK_POINT) return;
  stage.spawnDeathBurst(b.x, b.z, b.enemyType, 0.4);
});
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
  const hit = payload as { enemyId: number; zone?: string; damage?: number; heightFrac?: number };
  if (hit.zone === undefined || hit.damage === undefined) return;
  spawnHitBloodOn(hit.enemyId, {
    damage: hit.damage,
    headshot: hit.zone === 'head',
    // 약점은 부위 비율이 없다 — 실제 명중 높이(Weapons 가 실어 준다)
    heightFrac: hit.zone === 'weak' ? (hit.heightFrac ?? 0.55) : hit.zone === 'head' ? 0.85 : hit.zone === 'limb' ? 0.25 : 0.55,
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
// 보물상자 — 뚜껑이 열리고(1회) 루팅 창이 뜬다. 무엇이 들었는지는 창이 보여 준다
events.on('chest_opened', () => {
  padRumble('interact');
  audio.play('chest_opened');
  showReaction('보물상자를 열었다 — 안을 뒤진다', 1600);
});
// 날아오던 것을 공중에서 깼다 — 바위가 파편으로 흩어진다
const PROJECTILE_DEBRIS_COLORS: Record<string, number> = { rock: 0x6b675e, web: 0xe6e9e0, goo: 0xa855f7 };
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
  // 진액 구슬(거수)은 불에 타 흩어진다 — 웅덩이도 남지 않는다
  showReaction(info.kind === 'goo' ? '진액 구슬을 공중에서 태웠다!' : '바위를 공중에서 깼다!', 1200);
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
/** 루팅이 끊겼다 — 창을 닫고(규칙은 onClose → Loot.closeLoot) 이유를 알린다 */
function interruptLoot(reason: 'damage' | 'distance'): void {
  if (!lootUI.open) return;
  lootUI.close();
  audio.play('shop_deny');
  showReaction(reason === 'damage' ? '공격받아 루팅이 끊겼다' : '멀어져 루팅이 끊겼다', 1200);
  events.emit('loot_interrupted', { reason });
}
events.on('loot_interrupt', (payload) => interruptLoot((payload as { reason: 'distance' }).reason));
events.on('player_damaged', (payload) => {
  const hit = payload as {
    amount?: number; blocked?: boolean; srcX?: number; srcZ?: number; srcId?: number; source?: string;
  };
  if (balance.loot.live.interruptOnDamage) interruptLoot('damage'); // 실시간 루팅 — 맞으면 창이 닫힌다 (도트 틱은 player_damaged 가 아니다)
  // 받은 피해 숫자 — 막힌 타격도 칩 피해가 있으면 회색으로 보여 준다
  if (hit.amount !== undefined) showDamageTaken(hit.amount, hit.blocked ? 'blocked' : 'hit');
  if (hit.blocked) return;
  // 맞았다 — 굵은 충격. 파먹기·흡혈은 약모터의 다른 결, 폭발 피해는 가장 굵고 길게
  padRumble(
    hit.source === 'ghoul_bite' || hit.source === 'leech_suck'
      ? 'drain'
      : hit.source === 'explosion' || hit.source === 'fireball' || hit.source === 'implode' ||
          hit.source === 'trap_rockfall' || hit.source === 'pillar_rockfall'
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
        ? '이 빌드에서는 아직 쓸 수 없는 스킬이다 — 스킬 탭에서 다른 스킬을 올린다'
        : '빈 스킬 칸 — 스킬 탭에서 스킬을 올린다',
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
  const { kind, sigilId, equipId } = payload as { kind: ItemKind; sigilId?: string; equipId?: string };
  if (kind === 'equip') {
    audio.play('pickup');
    showReaction(`${equipId ? equipDef(equipId).name : '장비'} — 가방에 들어왔다. 가방 탭(I)에서 걸친다`, 2400);
    return;
  }
  if (kind === 'sigil') {
    // 패시브 각인은 가방 아이템 (2026-09-04) — 가방 탭의 몸에 새긴다. 액티브는 집는 순간 익혀 sigil_acquired 토스트가 뜬다
    audio.play('pickup');
    if (!(payload as { active?: boolean }).active) {
      showReaction(`✦ ${sigilId ? sigilDef(sigilId).name : '각인'} — 가방에 들어왔다. 가방 탭(I)의 몸에 새긴다`, 2400);
    }
    return;
  }
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
  rootStyle.setProperty('--dmg-ms', `${balance.hud.damageNumbers.ms}ms`); // 적 피해 숫자와 같은 시간
  rootStyle.setProperty('--dmg-rise', `${balance.hud.damageTaken.risePx}px`);
  rootStyle.setProperty('--dmg-font', `${balance.hud.damageTaken.fontPx}px`);
  rootStyle.setProperty('--dmg-big-mul', String(balance.hud.damageTaken.bigScaleMul));
}

// ---- 플레이어 수치 숫자 — 받은 피해는 붉게(-N), 회복은 초록/파랗게(+N) 바 위로 튄다 (적 머리 위 피해 숫자의 플레이어 판) ----
type DamageTone = 'hit' | 'blocked' | 'poison' | 'burn';
/** 회복 결 — heal(체력 물약·생명 입자) · mana(마나 물약) · regen(음식 지속 회복, 1초 묶음) */
type StatTone = DamageTone | 'heal' | 'mana' | 'regen';
type StatBar = 'hp' | 'mana';
const GAIN_TONES: ReadonlySet<StatTone> = new Set(['heal', 'mana', 'regen']);
const dmgTakenBox = document.getElementById('dmg-taken')!;
let lastStatNum: { el: HTMLElement; amount: number; at: number; tone: StatTone; bar: StatBar } | null = null;
function renderStatNumber(rec: { el: HTMLElement; amount: number; tone: StatTone }): void {
  const cfg = balance.hud.damageTaken;
  const n = Math.max(1, Math.round(rec.amount));
  rec.el.textContent = GAIN_TONES.has(rec.tone) ? `+${n}` : `-${n}`;
  rec.el.classList.toggle('big', rec.amount >= cfg.bigAt);
  // 애니메이션을 처음부터 — 합산돼 커질 때 다시 튄다
  rec.el.style.animation = 'none';
  void rec.el.offsetWidth;
  rec.el.style.animation = '';
}
/** 수치 변화를 해당 바(hp/mana) 위에 띄운다. mergeMs 안의 같은 결은 하나로 합산. 바마다 따로 층을 쌓는다 */
function showStatNumber(amount: number, tone: StatTone, bar: StatBar): void {
  if (!(amount > 0)) return;
  const cfg = balance.hud.damageTaken;
  const now = performance.now();
  if (lastStatNum && lastStatNum.tone === tone && lastStatNum.bar === bar && now - lastStatNum.at < cfg.mergeMs && lastStatNum.el.isConnected) {
    lastStatNum.amount += amount;
    lastStatNum.at = now;
    renderStatNumber(lastStatNum);
    return;
  }
  const el = document.createElement('div');
  el.className = `dmg-num ${tone}`;
  el.dataset['bar'] = bar;
  // 해당 바 위 — 좌우로 조금 흔들어 연타가 겹치지 않게
  const rect = document.getElementById(bar === 'hp' ? 'status-hp' : 'status-mana')?.getBoundingClientRect();
  const cx = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
  const top = rect ? rect.top - 6 : window.innerHeight - 120;
  el.style.left = `${cx + (Math.random() * 2 - 1) * cfg.jitterPx}px`;
  // 같은 바에 아직 사라지지 않은 숫자가 있으면 그 위에 층을 쌓는다 — 다른 결이 동시에 떠도 겹치지 않게
  const stacked = dmgTakenBox.querySelectorAll(`[data-bar="${bar}"]`).length;
  el.style.top = `${top - stacked * cfg.stackPx}px`;
  el.addEventListener('animationend', () => el.remove());
  dmgTakenBox.appendChild(el);
  const rec = { el, amount, at: now, tone, bar };
  lastStatNum = rec;
  renderStatNumber(rec);
}
/** 받은 피해 — HP 바 위 붉은 -N */
function showDamageTaken(amount: number, tone: DamageTone): void {
  showStatNumber(amount, tone, 'hp');
}
// 음식 지속 회복 — 틱마다 아주 조금 차므로 regenFlushMs 마다 묶어 한 번에 띄운다 (render 가 흘린다)
let regenAcc = 0;
let regenFlushAt = 0;
events.on('food_regen_tick', (payload) => { regenAcc += (payload as { amount: number }).amount; });
// 대형 물약 지속분 — 체력은 음식 회복과 같은 초록 묶음, 마나는 파란 묶음 (2026-09-04)
let manaRegenAcc = 0;
events.on('potion_regen_tick', (payload) => {
  const d = payload as { stat: 'hp' | 'mp'; amount: number };
  if (d.stat === 'hp') regenAcc += d.amount;
  else manaRegenAcc += d.amount;
});
function flushRegenNumber(now: number): void {
  if ((regenAcc <= 0 && manaRegenAcc <= 0) || now < regenFlushAt) return;
  if (regenAcc >= 0.5) {
    showStatNumber(regenAcc, 'regen', 'hp');
    regenAcc = 0;
  }
  if (manaRegenAcc >= 0.5) {
    showStatNumber(manaRegenAcc, 'mana', 'mana');
    manaRegenAcc = 0;
  }
  regenFlushAt = now + balance.hud.damageTaken.regenFlushMs;
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
  // 회복량을 피해 숫자와 같은 연출로 — 체력은 HP 바 위 초록 +N, 마나는 마나 바 위 파란 +N (2026-09-04)
  if (info.healed > 0) showStatNumber(info.healed, 'heal', 'hp');
  if (info.restored > 0) showStatNumber(info.restored, 'mana', 'mana');
  audio.play(ITEM_SOUND[info.kind] ?? 'pickup_potion');
  padRumble('use'); // 꿀꺽 — 마시는 손맛
  const parts: string[] = [];
  const idef = itemDef(info.kind);
  const ot = idef.overTime;
  const secs = ot ? Math.round(ot.durationTicks / 60) : 0;
  if (ot && ot.instantRatio <= 0) {
    // 일반 물약 — 마신 순간엔 안 차고 전부 천천히 (2026-09-07). 총량을 '~초 동안' 으로 말한다
    if (idef.heal > 0) parts.push(`+${Math.round(idef.heal * world.modifiers.potionHealMul)} HP`);
    if (idef.restore > 0) parts.push(`+${Math.round(idef.restore)} 마나`);
    parts.push(`${secs}초 동안 천천히`);
  } else {
    if (info.healed > 0) parts.push(`+${Math.round(info.healed)} HP`);
    if (info.restored > 0) parts.push(`+${Math.round(info.restored)} 마나`);
    if (ot) parts.push(`나머지는 ${secs}초 동안`); // 대형 물약 — 절반 즉시
  }
  showReaction(`${parts.join('  ')}   (남은 ${info.left}개)`, 1200);
  // 이 아이템이 만지는 게이지만 깜빡인다 — 이미 가득했으면 끝부분만 (즉시분이 0인 물약은 게이지로 판정)
  if (idef.heal > 0) flashRestoreBar('status-hp-fill', world.player.health >= balance.player.healthMax);
  if (idef.restore > 0) flashRestoreBar('status-mana-fill', world.mana.value >= balance.mana.max);
  if (idef.regen) flashRestoreBar('status-stamina-fill', false); // 지속 효과 시작 — 스태미너도
});
const DENY_TEXT: Record<string, string> = {
  empty: '빈 퀵슬롯 — 가방 탭(Tab·I)에서 등록한다',
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
  audio.play('item_drop'); // 가방에서 버렸다 — 발밑에서 달그락 (I 창·루팅 창 가방 칸 공용)
  padRumble('interact');
  showReaction(`${itemDef(info.kind).name} ${info.count}개를 버렸다`, 1200);
});
let bagFullUntil = 0;
events.on('inventory_full', () => {
  if (performance.now() < bagFullUntil) return; // 밟고 서 있으면 매 틱 뜬다
  bagFullUntil = performance.now() + 2500;
  showReaction(`가방이 가득 찼다 — ${keyLabel('inventory', 'inventory')} 에서 쓰거나 버려야 한다`, 2000);
});
// 루팅 — 가져오면 종류별 습득음, 넣으면 천 소리, 버리면 툭, 거부는 상점과 같은 거절음 + 이유
events.on('loot_taken', (payload) => {
  const t = payload as { kind: LootKind; count: number };
  if (t.kind === 'gold' || t.kind === 'arrow') audio.play('pickup_gold');
  else if (t.kind === 'sigil') audio.play('pickup');
  else audio.play(ITEM_SOUND[t.kind] ?? 'pickup');
  padRumble('pickup');
});
events.on('loot_stashed', () => audio.play('loot_stash'));
events.on('loot_revealed', () => {
  audio.play('loot_reveal'); // 칸 하나가 밝혀졌다 — 뒤지기 한 바퀴의 마침표
  padRumble('pickup');
});
// 주머니가 바닥에 닿았다 — 자루가 돌바닥에 툭, 먼지가 낮게 인다 (안착 시간이 끝나는 틱)
events.on('pouch_landed', (payload) => {
  const d = payload as { x: number; z: number; tier: 'normal' | 'boss' };
  audio.play('thud', panAt(d.x, d.z));
  stage.spawnDust(d.x, d.z, d.tier === 'boss' ? 1.6 : 1);
});
events.on('pouch_placed', () => showReaction('주머니를 내려놓았다 — 넣어 둔 것은 이 자리에 남는다', 2000));
// 가방이 가득 — 집으려던 소모품이 몸까지 왔다가 튕겨 돌아가 떨어졌다
events.on('pickup_bounced', (payload) => {
  const d = payload as { x: number; z: number };
  audio.play('thud', panAt(d.x, d.z));
  padRumble('interact');
  showReaction('가방이 가득 — 집을 수 없다. I 에서 쓰거나 버려야 한다', 1600);
});
events.on('loot_dropped', (payload) => {
  const d = payload as { kind: LootKind; count: number; from: 'container' | 'bag' };
  // 가방 쪽은 item_dropped 가 소리·안내를 이미 낸다 — 컨테이너 쪽만 여기서
  if (d.from !== 'container') return;
  audio.play('item_drop');
  padRumble('interact');
  showReaction(`${Loot.entryName({ kind: d.kind, count: d.count })} ${d.count}개를 바닥에 버렸다`, 1200);
});
events.on('loot_denied', (payload) => {
  const d = payload as { reason: 'full' | 'quiver' };
  audio.play('shop_deny');
  showReaction(d.reason === 'quiver' ? '화살통이 가득 — 더 못 넣는다' : '가방이 가득 — 자리를 비워야 가져온다', 1600);
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
// 드래그로 칸을 옮겼다 — 천에 넣는 소리를 짧게 (가져오기·넣기는 각자 소리가 있다)
events.on('loot_moved', () => audio.play('loot_stash'));
// 패드로 집어 들었다 / 내려놓기를 취소했다
events.on('loot_carry_started', () => {
  audio.play('pickup');
  padRumble('interact');
});
events.on('loot_carry_cancelled', () => audio.play('loot_stash'));
events.on('item_split', () => audio.play('loot_stash')); // 스택을 갈랐다
// 수류탄 차징 취소(LT 놓음·R) — 활의 시위 내리기와 같은 소리·안내
events.on('grenade_cancelled', () => {
  audio.play('reload_end');
  showReaction('수류탄을 거뒀다', 900);
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
  const hit = payload as { x: number; y: number; z: number; hitEnemy: boolean; trapShot?: boolean };
  // 내 화살은 그대로(어디에 박혔든 내가 쏜 것). 함정 다트의 착탄은 자동 장치 규칙 — 10m 밖 무음,
  // 안에서는 거리 제곱 감쇠 (멀리서 자동 다트가 벽을 두드리는 소리가 층 전체에 울리던 원인)
  if (hit.trapShot) {
    const at = trapSoundAt('trap_dart_auto', hit.x, hit.z);
    if (at) audio.play(hit.hitEnemy ? 'hit_flesh' : 'hit_wall', at);
    return;
  }
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
  // 돌격이 벽·문에 막힌 헛돌격(거수 B2-5, wall) — 박히진 않았다. 둔탁한 충돌음 + 안내
  if ((payload as { wall?: boolean }).wall) {
    audio.play('thud', panOf(payload));
    showReaction('돌격이 벽에 막혔다 — 반격 기회!', 900);
    return;
  }
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
/** 테스트 일괄 지급(grantAllSkills) 동안 스킬별 토스트를 내지 않는다 — 7개가 갈아 끼워져 마지막 것만 남아 보였다 */
let sigilToastMuted = false;
events.on('sigil_acquired', (payload) => {
  if (sigilToastMuted) return;
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
        : `패시브 — ${PART[def.slot] ?? def.slot}이 차 있다. 가방 탭의 몸에서 바꾼다`
      : typeof info.slot === 'number' && info.slot >= 0
        ? `액티브 — ${input.usingPad ? `${padBtn('skillSelect')} + ${padBtn(`skill${info.slot + 1}` as PadAction)}` : SKILL_KEYS[info.slot]} 로 쓴다`
        : '스킬 탭에서 퀵슬롯에 올린다';
  sigilToast.classList.add('visible');
  sigilToastUntil = performance.now() + SIGIL_TOAST_MS;
});

// 새기기 거부 — 이미 익힌 각인(중복)이거나 부위가 차 있다. 떼기 거부 — 가방이 가득. 매각 — 골드
events.on('sigil_learn_denied', (payload) => {
  const d = payload as { id: string; reason: 'known' | 'part_full'; slot?: string };
  const PART: Record<string, string> = { eye: '눈', rightArm: '오른팔', leftArm: '왼팔', heart: '심장', spine: '척추' };
  showReaction(
    d.reason === 'known'
      ? `${sigilDef(d.id).name} — 이미 익힌 각인이다. 제단에서 팔 수 있다`
      : `${sigilDef(d.id).name} — ${PART[d.slot ?? ''] ?? d.slot}이 차 있다. 제단 앞에서 가방 탭의 몸 소켓을 눌러 떼고 새긴다`,
    2400,
  );
  audio.play('shop_deny');
});
// 장비 — 걸치기/벗기 안내 (2026-09-04)
events.on('equip_changed', (payload) => {
  const d = payload as { slot: EquipSlot; id: string | null; prev: string | null };
  audio.play('pickup');
  padRumble('pickup');
  if (d.id) showReaction(`${equipDef(d.id).name} 을(를) ${slotLabel(d.slot)}에 걸쳤다${d.prev ? ` — ${equipDef(d.prev).name} 은(는) 가방으로` : ''}`, 2200);
  else if (d.prev) showReaction(`${equipDef(d.prev).name} 을(를) 벗었다 — 가방으로`, 2000);
});
events.on('equip_sold', (payload) => {
  const d = payload as { id: string; gold: number; total: number };
  audio.play('pickup_gold');
  showReaction(`${equipDef(d.id).name} 을(를) 팔았다 — ◆ +${d.gold} (소지 ◆ ${d.total})`, 2000);
});
// 유일 장비(낫뿔 반지, B3-6)는 제단에서 팔 수 없다 — 거부 소리 + 안내만, 가방에 그대로
events.on('equip_sell_denied', (payload) => {
  const d = payload as { id: string; reason: string };
  audio.play('shop_deny');
  showReaction(`${equipDef(d.id).name} — 유일한 장비는 팔 수 없다`, 2200);
});
events.on('equip_denied', (payload) => {
  const d = payload as { id: string; reason: string };
  showReaction(`${equipDef(d.id).name} — 가방을 비워야 한다 (칸이 줄어들어 든 것이 안 들어간다)`, 2600);
  audio.play('shop_deny');
});
events.on('sigil_detach_denied', () => {
  showReaction('가방이 가득 — 떼어 낸 각인을 둘 곳이 없다', 2400);
  audio.play('shop_deny');
});
events.on('sigil_sold', (payload) => {
  const d = payload as { id: string; gold: number; total: number };
  audio.play('pickup_gold');
  showReaction(`${sigilDef(d.id).name} 각인을 팔았다 — ◆ +${d.gold} (소지 ◆ ${d.total})`, 2000);
});

// 이미 익힌 스킬을 또 주웠다 — 각인 대신 경험치. 같은 자리에 같은 모양으로 띄운다 (직접 acquire 경로에만 남았다)
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
  // 사망 화면 — YOU DIED · 시간 · 이번 플레이 획득 경험치 (2026-09-07 사용자). 클리어 화면이 머리글을 바꿨을 수 있어 매번 되돌린다
  deathTitle!.textContent = 'YOU DIED';
  deathStats!.textContent = deathSummary();
  deathHint!.textContent = '';
  (deathOverlay as HTMLElement).style.background = '';
  deathOverlay.classList.add('visible');
  // 사망 메뉴 — 1) 로비 2·3) 개발용. 개발 항목이 꺼져 있으면 메뉴 없이 사망 화면만 보이다 로비에서 깨어난다 (balance.lobby)
  if (!balance.lobby.devDeathOptions) {
    scheduleLobbyRevive();
    return;
  }
  showDeathMenu();
});

/** 이번 플레이(깨어난 뒤)로 얻은 경험치 — 사망 화면에 적는다. finishRevive 가 0 으로 되돌린다 */
let runXpGained = 0;
events.on('xp_gained', (payload) => { runXpGained += (payload as { amount: number }).amount; });

/** 사망 화면 본문 — 게임플레이 시간(전체, 시:분:초 — 시뮬레이션이 멈춘 동안은 흐르지 않는다)과 이번 플레이로 얻은 경험치 */
function deathSummary(): string {
  return `시간: ${Save.formatPlayTime(world.tick)}\n획득 경험치: ✦ ${runXpGained.toLocaleString()}`;
}

/** 로비 부활 예약 — 사망 화면을 lobbyReviveDelayMs 동안 보여 준 뒤 로비 마법진에서 깨어난다.
 *  그 사이 다른 길(F3)로 먼저 살아났으면 아무것도 안 한다 */
let lobbyReviveToken = 0;
function scheduleLobbyRevive(): void {
  deathMenu.hide();
  const ms = balance.lobby.lobbyReviveDelayMs;
  deathHint!.textContent = `${Math.round(ms / 1000)}초 뒤 성소 로비의 부활 마법진에서 깨어난다`;
  const token = ++lobbyReviveToken;
  afterMs(ms, () => {
    if (world.dead && token === lobbyReviveToken) reviveInLobby();
  });
}

/** 사망 메뉴 항목 — 개발 항목 유무에 따라 달라지므로 열 때마다 짓는다 */
function showDeathMenu(): void {
  const entries = [
    { id: 'lobby', label: '성소 로비에서 부활', sub: '로비의 부활 마법진에서 깨어난다 — 무료 · 죽은 자리의 유품(비석)은 그대로 남는다' },
  ];
  if (balance.lobby.devDeathOptions) {
    entries.push(
      { id: 'here', label: '(개발) 현재 층에서 즉시 부활', sub: '죽은 그 자리에서 체력·마나만 채워 일어난다 — 적은 그대로다' },
      { id: 'restart', label: '(개발) 현재 층에서 새로 시작', sub: '이 층을 처음 들어온 상태로 되돌린다 (적·문·상자·바닥 아이템 전부)' },
    );
  }
  deathMenu.padMode = input.usingPad;
  deathMenu.show({
    title: '', // 오버레이의 YOU DIED 머리글·시간·경험치가 이미 있다
    entries,
    closable: false,
    onPick: (id) => {
      if (id === 'lobby') scheduleLobbyRevive(); // 사망 화면을 잠시 더 보여 준 뒤 로비 (2026-09-07 사용자)
      else if (id === 'here') reviveHere();
      else if (id === 'restart') restartCurrentFloor();
    },
  });
}

events.on('respawned', (payload) => {
  const r = payload as { kind?: string };
  if (r.kind === 'lobby') showReaction('성소의 빛이 몸을 되돌렸다 — 대제단에서 활성화한 제단으로 돌아갈 수 있다', 3600);
});

// 제단 활성화 — 체크포인트 자동 저장 (balance.save.autosave.altarActivated)
events.on('respawn_registered', () => {
  if (balance.save.autosave.altarActivated) saveGame('auto');
});

events.on('grave_dropped', () =>
  showReaction('유품이 비석에 남았다 — 그 자리로 돌아가 상호작용으로 거둔다 (문을 열 때처럼 잠시 걸린다)', 3000),
);
// 비석에 손을 댔다 — 문 자물쇠와 같은 소리·진동 (채널도 같은 시간)
events.on('grave_channel_started', () => {
  audio.play('door_touch');
  padRumble('interact');
});
events.on('grave_recovered', (payload) => {
  audio.play('pickup_gold');
  showReaction(
    (payload as { partial?: boolean }).partial ? '유품 일부 회수 — 가방이 가득하다' : '유품을 모두 회수했다',
    1800,
  );
});

/** 부활 공통 — 체력·상태·탄약·마나를 되돌린다. 자리는 부르는 쪽이 정한다 */
function restorePlayer(): void {
  const p = world.player;
  p.health = balance.player.healthMax;
  p.dots = {}; // 독·화염도 씻긴다
  Status.clearAll(world); // 팔 저림·진탕도
  p.stunTicks = 0;
  p.dodgeTicks = 0;
  p.iframeTicks = 0;
  p.iframeSource = undefined;
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
  world.freezeTicks = 0;
  world.grappleEnemyId = null;
  world.grappleMash = 0;
  world.faceLeechId = null;
  world.faceLeechMash = 0;
  world.lootOpen = null;
  world.lootInView = null;
  world.itemInView = null;
  lootUI.hide();
}

/** 사망 화면을 걷고 되살아났음을 알린다 */
function finishRevive(payload: Record<string, unknown>): void {
  world.dead = false;
  runXpGained = 0; // 새 플레이 — 사망 화면의 '획득 경험치'는 여기부터 센다
  deathMenu.hide();
  deathOverlay!.classList.remove('visible');
  events.emit('respawned', payload);
}

// '최근 접촉한 제단에서 부활'(골드 비용, reviveAtAltar)은 폐지 (2026-09-07 사용자) — 부활은 로비(와 개발 항목)에서만.
// 제단 진입은 여전히 world.respawn·world.altars 를 적는다 — 로비 대제단 워프 목록이 그것을 쓴다

/** 로비 부활 — 성소 로비의 부활 마법진(스폰)에서 깨어난다. 무료. 죽은 층은 그대로 얼려 둔다 (비석도 거기 남는다) */
function reviveInLobby(): void {
  restorePlayer();
  loadFloor(LOBBY);
  finishRevive({ x: world.player.x, z: world.player.z, kind: 'lobby' });
}

/** (개발) 현재 층에서 즉시 부활 — 죽은 자리에서 자원만 채워 일어난다. 적은 그대로 (슬라이스 검증 시 제거) */
function reviveHere(): void {
  restorePlayer();
  finishRevive({ x: world.player.x, z: world.player.z, kind: 'here' });
}

/** (개발) 현재 층에서 새로 시작 — 얼려 둔 상태·죽인 적 기록·봉인 해제를 버리고 층을 처음처럼 다시 짓는다 (슬라이스 검증 시 제거) */
function restartCurrentFloor(): void {
  restorePlayer();
  forgetFloor(floorIndex);
  loadFloor(floorIndex, 'entrance', true);
  finishRevive({ x: world.player.x, z: world.player.z, kind: 'restart' });
}

// ---- 세이브/로드 (2026-09-07 사용자) — 규칙은 core/Save, 저장소는 core/SaveStorage. 여기는 시점과 창만 ----

/** 저장할 수 없는 곳 — 시험방(함정·몬스터)은 진행과 섞이지 않는다 */
function canSaveHere(): boolean {
  return floorIndex !== TRAP_ROOM && floorIndex !== MONSTER_ROOM;
}

/** 지금 상태를 저장한다 — 현재 층은 살아 있는 world 에서, 다녀온 층은 얼려 둔 FloorState 에서 차이를 뜬다. 성공하면 저장 데이터 */
function saveGame(kind: Save.SaveKind): Save.SaveData | null {
  if (!canSaveHere()) return null;
  const floors: Record<string, Save.FloorDiff> = {};
  for (const [idx, fs] of floorStates) {
    if (idx === TRAP_ROOM || idx === MONSTER_ROOM) continue;
    floors[String(idx)] = Save.captureFloorDiff(fs);
  }
  floors[String(floorIndex)] = Save.captureFloorDiff(world);
  // 아직 안 가 본 층에 남겨 둔(불러온 뒤 미방문) 차이도 그대로 물려준다
  for (const [k, d] of Object.entries(pendingFloorDiffs)) if (!(k in floors)) floors[k] = d;
  const data = Save.serialize(world, { kind, floorLabel: floorLabel(floorIndex), floors, unlockedFloors, barsCineSeen });
  if (!SaveStorage.putSave(data)) {
    showReaction('저장 실패 — 브라우저 저장 공간을 쓸 수 없다', 3000);
    return null;
  }
  events.emit('game_saved', { kind, id: data.id, floor: floorIndex });
  lastSaveAt = performance.now();
  lastSaveKind = kind;
  return data;
}
let lastSaveAt = -Infinity;
let lastSaveKind: Save.SaveKind | null = null;

/** 저장 데이터로 되돌린다 — 진행을 복원하고 저장한 층을 새로 지어(차이 덧씌움) 저장한 자리에 세운다.
 *  다른 층의 차이는 그 층에 처음 들어갈 때 적용된다. 살아 있던 적·보스는 만피로 돌아온다 */
function loadGame(data: Save.SaveData): void {
  suppressAutosave = true;
  try {
    // 떠 있는 창을 전부 걷는다 — 사망 화면에서 불러올 수도 있다
    deathMenu.hide();
    deathOverlay!.classList.remove('visible');
    warpDialog.hide();
    npcDialog.hide();
    lootUI.hide();
    menuUI.hide();
    if (shopUI.open) shopUI.hide();
    world.uiOpen = false;
    world.dead = false;
    // 진행 기록 — 이 세션 것은 버리고 저장된 것으로
    floorStates.clear();
    unlockedFloors.clear();
    for (const f of data.unlockedFloors) unlockedFloors.add(f);
    barsCineSeen.clear();
    for (const f of data.barsCineSeen) barsCineSeen.add(f);
    pendingFloorDiffs = { ...data.floors };
    Save.restoreProgress(world, data); // loadFloor 보다 먼저 — 봉인·해독 판정이 진행 값을 읽는다
    loadFloor(data.floorIndex, 'entrance', true);
    floorStates.clear(); // loadFloor 가 떠나는(불러오기 전) 층을 얼려 둔 것도 버린다 — 그 층은 차이로 다시 짓는다
    Save.applyPlayerPose(world, data);
    world.player.dots = {};
    Status.clearAll(world);
    world.itemChannel = null;
    world.itemCooldown = 0;
    Sigils.recompute(world); // 각인·장비 파생 수치
    runXpGained = 0;
    events.emit('game_loaded', { kind: data.kind, id: data.id, floor: data.floorIndex });
    showReaction(`${Save.kindLabel(data.kind)} 저장 불러옴 — ${data.floorLabel} · ${Save.formatSavedAt(data.savedAt)}`, 3200);
  } finally {
    suppressAutosave = false;
  }
}

/** 저장 목록 창 — 정지 메뉴 '불러오기'. 고르면 그 시점으로, 줄의 '삭제'(X/Delete·패드 X)로 지우고, 닫으면 정지 메뉴로 돌아간다 */
function showSaveDialog(): void {
  let saves = SaveStorage.listSaves();
  const build = () =>
    saves.length
      ? saves.map((s) => ({
          id: s.id,
          label: Save.displayName(s),
          sub: `시간 ${Save.formatPlayTime(s.tick)} · ◆ ${s.gold} · ✦ ${s.xp} · 체력 ${Math.round(s.player.health)} · 활성 제단 ${s.altars.length}곳`,
          deletable: true,
        }))
      : [{ id: 'none', label: '저장된 게임이 없다', sub: '층을 옮기거나 제단을 활성화하면 자동으로 저장되고, 정지 메뉴에서 수동 저장도 할 수 있다', enabled: false }];
  const subtitle = () => `저장 ${saves.length}개 — 개수 제한 없음, 안 쓰는 것은 삭제로 지운다`;
  pauseMenu.hide();
  saveDialog.padMode = input.usingPad;
  saveDialog.show({
    title: '불러오기',
    subtitle: subtitle(),
    entries: build(),
    onPick: (id) => {
      const data = saves.find((s) => s.id === id);
      if (!data) { pauseMenu.show(); return; }
      loadGame(data);
      setPaused(false);
      input.requestLock();
    },
    onDelete: (id) => {
      const gone = saves.find((s) => s.id === id);
      SaveStorage.deleteSave(id);
      saves = SaveStorage.listSaves();
      saveDialog.refresh(build(), subtitle());
      if (gone) events.emit('save_deleted', { id, kind: gone.kind });
    },
    onClose: () => pauseMenu.show(),
  });
}

/** 층 기록을 잊는다 — 봉인 해제·쇠창살 연출 기억. 새로 짓거나 몬스터를 전부 되살릴 때 */
function forgetFloor(index: number): void {
  unlockedFloors.delete(index);
  barsCineSeen.delete(index);
}

/** 층 이름 — 사망 메뉴·워프 목록용. 진행 층은 '지하 N층', 특수 층은 제 이름 */
function floorLabel(index: number): string {
  if (index === LOBBY) return '성소 로비';
  if (index === TRAP_ROOM) return '트랩 시험방';
  if (index === MONSTER_ROOM) return '몬스터 시험방';
  return `지하 ${index + 1}층`;
}

/** 로비 대제단 워프 — 활성화한 제단이 있는 층으로 가서 그 제단 자리에 선다. 그 층의 몬스터는 전부 되살아난다 (죽인 것 포함, 2026-09-07 사용자).
 *  문·상자·바닥 아이템(비석)은 그대로 — 되살리는 것은 몬스터만이다 */
function warpToAltar(floor: number): void {
  const spot = world.altars.find((a) => a.floor === floor);
  if (!spot || traveling) return;
  traveling = true;
  audio.play('altar_enter');
  screenFade(1, 320);
  afterMs(340, () => {
    loadFloor(floor);
    // 몬스터 전부 부활 — 죽인 적 기록을 잊고 배치대로 다시 놓는다. 주인이 되살아나면 쇠창살도 다시 내려온다
    forgetFloor(floor);
    world.enemies = spawnEnemies(levelJson.entities, level);
    if (world.arena) world.arena.bossId = null; // 새 몸은 Arena.tick 이 다시 찾는다
    world.exitNeedsKey = world.enemies.some((e) => e.floorBoss || enemyDef(e.type).boss);
    world.exitOpen = false;
    const p = world.player;
    p.x = spot.x;
    p.z = spot.z;
    p.prevX = spot.x;
    p.prevZ = spot.z;
    // 도착한 제단을 바라본다 (어디에 왔는지 먼저 읽히게) — facing = (-sin yaw, -cos yaw)
    const a = level.altarPos;
    if (a) p.yaw = Math.atan2(-(a.x - spot.x), -(a.z - spot.z));
    p.pitch = 0;
    world.altarEnteredThisApproach = true; // 도착하자마자 상점이 다시 열리지 않게
    events.emit('lobby_warp', { floor, x: spot.x, z: spot.z, revived: world.enemies.length });
    screenFade(0, 400);
  });
}

/** 마지막으로 총을 쏜 시각 — 그 뒤 afterShotMs 동안 십자선을 유지한다 (키보드도 패드와 같은 조준 느낌) */
let lastShotMs = -Infinity;
events.on('shot_fired', (payload) => {
  const shot = payload as {
    ex: number; ey: number; ez: number; hitEnemy: boolean; blocked?: boolean;
  };
  lastShotMs = performance.now();
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
/** 트랩 시험방 — 함정 8종이 한 방에 깔린 특수 층. 시험용이라 스킬·탄·마나를 채워 준다
 *  (기름 점화용 화염구, 줄 끊기용 화살 등). 진행 층 상태는 얼려 두지만 되돌아오는
 *  길은 없다 — '처음부터 시작' 으로 나간다 */
function enterTrapRoom(): void {
  world.dead = false;
  loadFloor(TRAP_ROOM);
  grantAllSkills();
  world.weapon.grenades = balance.weapons.grenade.ammoMax;
  world.weapon.arrows = balance.weapons.bow.ammoMax;
  world.weapon.reserve = balance.weapons.pistol.ammoMax;
  world.player.health = balance.player.healthMax;
  world.player.dots = {};
  showReaction('트랩 시험방 — 스킬·탄 전부 지급. 나가는 길은 일시정지 → 처음부터', 4000);
}

/** 몬스터 시험방 — 소환 탭에서 종족별 1·3·6 마리를 시선 앞에 놓고 무한 사냥한다 (2026-09-04 사용자 기획).
 *  전리품·경험치 없음(소환수 noLoot), HP·MP 는 자동 회복, 출구 없음. 스킬은 전부 익히되 마나는 소모·회복이 보이게 스킬 테스트(무한)는 끈다 */
function enterMonsterRoom(): void {
  world.dead = false;
  loadFloor(MONSTER_ROOM);
  grantAllSkills();
  world.skillTestMode = false;
  world.weapon.grenades = balance.weapons.grenade.ammoMax;
  world.weapon.arrows = balance.weapons.bow.ammoMax;
  world.weapon.reserve = balance.weapons.pistol.ammoMax;
  world.player.health = balance.player.healthMax;
  world.mana.value = balance.mana.max;
  world.player.dots = {};
  showReaction('몬스터 시험방 — 소환 탭(I·Menu)에서 몬스터를 놓는다. 나가는 길은 일시정지 → 처음부터', 4000);
}

/** 다시 시작 — 주소의 테스트 옵션(?skills·?traproom)을 지운 채 새로 고친다.
 *  reload() 는 주소를 그대로 두어 "처음부터 시작"이 매번 스킬 전부·시험방으로 시작했다 (2026-09-04 사용자) */
function reloadClean(): void {
  location.assign(location.pathname);
}

/** 테스트 — 조건에 맞는 구현된 스킬을 익힌다(이미 익힌 것은 건너뛴다). 패시브는 빈 부위에 새겨지고
 *  액티브는 빈 칸에 올라간다(시전 가능 4종이라 칸 4개에 딱 맞는다).
 *  오염 대기는 되돌려 밸런스 검증을 더럽히지 않는다. 모드 전환은 부르는 쪽이 정한다 */
function grantSkills(pick: (def: SigilDef) => boolean): number {
  const pendingBefore = world.corruption.pending;
  let granted = 0;
  sigilToastMuted = true; // 스킬별 토스트 대신 부르는 쪽이 한 줄 안내를 낸다
  try {
    for (const id of allSigilIds()) {
      const def = sigilDef(id);
      if (!isImplemented(def) || !pick(def)) continue;
      if (world.sigils.inventory.includes(id)) continue;
      Sigils.acquire(world, id);
      granted++;
    }
  } finally {
    sigilToastMuted = false;
  }
  world.corruption.pending = pendingBefore;
  return granted;
}

/** 테스트(U·?skills·몬스터 시험방) — 구현된 스킬 전부 + 스킬 테스트 모드(마나 무한) */
function grantAllSkills(): number {
  const granted = grantSkills(() => true);
  // 모드를 켠다 — 시뮬레이션이 매 틱 마나를 최대치로 되돌려 소비가 무효가 된다
  world.skillTestMode = true;
  world.mana.value = balance.mana.max;
  return granted;
}

/** 테스트(무적 G) — 구현된 액티브 스킬만. 패시브(가방 아이템·몸 새김)와 마나 모드는 건드리지 않는다:
 *  무적이 이미 자원을 틱마다 되돌리므로 스킬 테스트 모드를 겹쳐 켤 이유가 없다 */
function grantActiveSkills(): number {
  return grantSkills((def) => isActiveSkill(def));
}

// ---- 제단 ----
events.on('life_mote_absorbed', (payload) => {
  const healed = (payload as { healed?: number }).healed ?? 0;
  if (healed > 0) showStatNumber(healed, 'heal', 'hp'); // 생명 입자 회복도 같은 연출
  audio.play('pickup');
  padRumble('pickup');
  flashRestoreBar('status-hp-fill', healed <= 0);
});

events.on('altar_entered', () => {
  audio.play('altar_enter');
  shopUI.show(); // 보급 상점 — 무료 보급은 없다. Tab 으로 각인 교체
  setUiOpen(true);
});
// 로비 대제단 — 활성화한(진입한) 제단 목록. 고르면 그 층으로 워프하고 몬스터가 전부 되살아난다 (2026-09-07 사용자)
events.on('lobby_altar_entered', () => {
  audio.play('altar_enter');
  const sorted = [...world.altars].sort((a, b) => a.floor - b.floor);
  const entries = sorted.map((a) => ({
    id: `f${a.floor}`,
    label: `${floorLabel(a.floor)} 제단`,
    sub: ((ZONE[a.floor] as { name?: string } | undefined)?.name ?? '').split(' - ')[1] ?? '',
  }));
  if (entries.length === 0) {
    entries.push({ id: 'none', label: '활성화한 제단이 없다', sub: '지하의 제단에 들러(상호작용) 활성화하면 여기서 바로 갈 수 있다. 지하 1층은 남쪽 현관 계단으로', enabled: false } as typeof entries[number]);
  }
  warpDialog.padMode = input.usingPad;
  warpDialog.show({
    title: '대제단 — 워프',
    subtitle: '활성화한 제단 자리로 곧장 간다 · 그 층의 몬스터는 전부 되살아난다',
    entries,
    tone: 'holy',
    onPick: (id) => {
      setUiOpen(false);
      const floor = Number.parseInt(id.slice(1), 10);
      if (Number.isFinite(floor)) warpToAltar(floor);
    },
    onClose: () => setUiOpen(false),
  });
  setUiOpen(true);
});
events.on('lobby_warp', (payload) => {
  const w = payload as { floor: number; revived: number };
  showReaction(`${floorLabel(w.floor)} 제단으로 워프 — 몬스터 ${w.revived}마리가 되살아났다`, 3200);
});

// ---- NPC (로비) ----
/** 사제 대화 항목 — 축복 값·상태에 따라 설명이 바뀌므로 매번 짓는다 */
function priestEntries(): { id: string; label: string; sub: string; enabled?: boolean }[] {
  const b = balance.lobby.blessing;
  const sec = Math.round(b.durationTicks / balance.loop.tickRate);
  const pct = Math.round((1 - b.damageTakenMul) * 100);
  return [
    {
      id: 'bless',
      label: b.cost > 0 ? `축복을 받는다  (◆ ${b.cost})` : '축복을 받는다',
      sub:
        `체력·마나를 가득 채우고 독·화염·상태이상을 씻는다 · ${sec}초 동안 받는 피해 ${pct}% 감소` +
        (world.blessingTicks > 0 ? `\n(축복 중 — ${Math.ceil(world.blessingTicks / balance.loop.tickRate)}초 남음, 다시 받으면 새로 센다)` : ''),
      enabled: world.gold >= b.cost,
    },
    { id: 'quest', label: '퀘스트', sub: '아직 준비 중이다 — "빛이 닿지 않는 곳의 이야기는 곧 들려주겠네"', enabled: false },
    { id: 'leave', label: '물러난다', sub: '' },
  ];
}
events.on('npc_talked', (payload) => {
  const npc = payload as { kind: 'priest' | 'merchant' };
  audio.play('ui_tab');
  padRumble('interact');
  if (npc.kind === 'merchant') {
    merchantUI.padMode = input.usingPad;
    merchantUI.show(); // 팔기·사기·퀘스트 — 인벤토리 방식
    setUiOpen(true);
    return;
  }
  npcDialog.padMode = input.usingPad;
  npcDialog.show({
    title: '성직자 사제',
    subtitle: '"빛이 그대와 함께하기를. 지하에서 돌아온 이에게 성소는 늘 열려 있네."',
    entries: priestEntries(),
    tone: 'holy',
    closeOnPick: false,
    onPick: (id) => {
      if (id === 'bless') {
        if (Npc.bless(world)) npcDialog.refresh(priestEntries(), '"가거라. 빛이 그대의 상처를 감쌀 것이다."');
        else npcDialog.refresh(priestEntries());
        return;
      }
      npcDialog.hide();
      closeNpcUi();
    },
    onClose: closeNpcUi,
  });
  setUiOpen(true);
});
events.on('blessed', (payload) => {
  const b = payload as { healed: number; durationTicks: number };
  audio.play('altar_enter');
  padRumble('pickup');
  if (b.healed > 0) showStatNumber(Math.round(b.healed), 'heal', 'hp');
  flashRestoreBar('status-hp-fill', false);
  flashRestoreBar('status-mana-fill', false);
  showReaction(`사제의 축복 — 체력·마나 회복 · ${Math.round(b.durationTicks / balance.loop.tickRate)}초 동안 받는 피해 감소`, 3000);
});
events.on('blessing_denied', (payload) => {
  audio.play('shop_deny');
  showReaction(`골드 부족 — ◆ ${(payload as { cost: number }).cost} 필요`, 1400);
});
events.on('blessing_ended', () => showReaction('축복이 스러졌다', 1600));
// 로비에서는 랜턴을 쓰지 않는다 — 켜려 하면 이유만 알린다 (Lantern 이 들어올 때 끄고 나갈 때 되돌린다)
events.on('lantern_denied', () => {
  audio.play('shop_deny');
  showReaction('성소의 빛 아래선 랜턴이 필요 없다 — 지하로 내려가면 다시 켜진다', 1800);
});
// 상인 매입(소모품) — 장비·각인 매각(equip_sold·sigil_sold)과 같은 소리·문구
events.on('item_sold', (payload) => {
  const d = payload as { kind: ItemKind; count: number; gold: number; total: number };
  audio.play('pickup_gold');
  showReaction(`${itemDef(d.kind).name} ×${d.count} 을(를) 팔았다 — ◆ +${d.gold} (소지 ◆ ${d.total})`, 2000);
});
events.on('item_sell_denied', (payload) => {
  audio.play('shop_deny');
  showReaction(`${itemDef((payload as { kind: ItemKind }).kind).name} — 상인이 사지 않는다`, 1600);
});
const SHOP_LABEL: Record<string, string> = {
  heal: '체력 물약', mana: '마나 물약', healLarge: '대형 체력 물약', manaLarge: '대형 마나 물약', ammo: '권총탄', arrow: '화살',
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
events.on('boss_staggered', (payload) => {
  // 거수 혼절(눈 누적 66) — 눈이 터지는 소리 + 같은 처형 안내. 족장의 연속 패링 스태거는 예전 문구 그대로
  const cause = (payload as { cause?: string }).cause;
  if (cause === 'eye') audio.play('eye_burst');
  showReaction(`${cause === 'eye' ? '거수 혼절' : '보스 스태거'} — 지금 처형! (${input.usingPad ? padBtn('melee') : 'Space·우클릭'})`);
});
// 거수 상태이상(기획서 §5 boss_status 하나로) — 관절 노출(일반 패링): 짧은 금속음 + 안내 / 머리 내림(완벽 패링): 낫이 박히는 소리 + 안내 /
// 관절 파열(내구 0): 갑각 갈라지는 소리 + 그 낫이 잠겼다는 안내 / 절뚝(양 낫 잠김): 안내. 미끄러짐(skid)은 charge_dodged 가 소리·문구를 낸다.
// 표시는 구체 발광·자세가 하고(Stage), 여기서는 소리와 한 줄 문구만
events.on('boss_status', (payload) => {
  const st = payload as { enemyId: number; enemyType: string; kind: string; on: boolean; id?: string; blade?: string; cause?: string; cell?: string };
  const e = world.enemies.find((en) => en.id === st.enemyId);
  const at = e ? panAt(e.x, e.z) : undefined;
  if (st.kind === 'expose' && st.on) {
    // 갑각 떨기 중 분출공(B3-2)도 같은 노출 타이머지만 소리·문구는 enemy_volley_start(vent_hiss·안내)가 이미 냈다 — 여기선 조용히
    if (st.id === 'vent') return;
    audio.play('joint_open', at);
    // 돌격 중 6m 안 눈(B2-5)도 같은 노출 타이머다 — 문구만 다르다
    showReaction(st.id === 'eye' ? '눈이 다가온다 — 쏴서 눈멀게 하라!' : '어깨 관절이 벌어졌다 — 쏴라!', 900);
  } else if (st.kind === 'head_down' && st.on) {
    // 전도(topple)·역류(backflow)로 내려온 머리는 그쪽 이벤트가 소리·문구를 냈다 — 낫 박힘만 여기서
    if (st.cause !== 'topple' && st.cause !== 'backflow') {
      audio.play('blade_stuck', at);
      showReaction('낫이 바닥에 박혔다 — 눈을 노려라!', 1400);
    }
  } else if (st.kind === 'blind' && st.on) {
    // 눈멂(B2-5) — 비명. 거수는 겨눈 자리를 잊고 직진한다: 비켜서 기둥·균열벽에 박히게
    audio.play('behemoth_scream', at);
    padRumble('weakPoint');
    showReaction('거수가 눈멀었다 — 직진한다, 비켜서 기둥에 박히게 하라!', 1600);
  } else if (st.kind === 'topple' && st.on) {
    // 전도(B2-5) — 돌격이 기둥·균열벽에 박혔다: 무거운 충격음 + 카메라 킥(가까울수록 크게) + 안내. 머리 내림(눈)은 head_down 이 이어 세운다
    audio.play('heavy_hit', at);
    const d = e ? Math.hypot(e.x - world.player.x, e.z - world.player.z) : 20;
    stage.triggerCameraKick(0.6 + 1.2 * Math.max(0, 1 - d / 14), 420);
    padRumble('crumble');
    showReaction(st.cell === 'C' ? '거수가 균열벽에 박혔다 — 벽이 뚫렸다, 눈을 노려라!' : '거수가 기둥에 박혔다 — 눈을 노려라!', 1600);
  } else if (st.kind === 'rupture' && st.on) {
    audio.play('joint_crack', at);
    // 잠김 시간은 데이터(bladeLockTicks)에서 초로 — 낫 짝(blade)이 있는 관절만 낫 문구
    const lockSec = Math.round(balance.weakPoint.rupture.bladeLockTicks / balance.loop.tickRate);
    showReaction(st.blade ? `관절 파열 — ${st.blade === 'l' ? '왼' : '오른'}낫이 늘어졌다 (${lockSec}초)` : `관절 파열 (${lockSec}초)`, 1600);
  } else if (st.kind === 'limp' && st.on) {
    showReaction('두 낫이 다 늘어졌다 — 거수가 절뚝인다', 1800);
  } else if (st.kind === 'rear' && st.on) {
    // 앞발 들기(B3-1, 발구르기 예고 8~36틱) — 배 심장이 보인다(진홍 맥동은 Stage). 봉인(역류 쿨다운) 중이면 어둡고 판정이 없으니 문구도 없다
    if (!(st as { sealed?: boolean }).sealed) {
      audio.play('joint_open', at);
      showReaction('앞발을 들었다 — 배 심장을 쏴라!', 700);
    }
  } else if (st.kind === 'backflow' && st.on) {
    // 역류(B3-1 심장 66 → 발구르기 취소 + 자해 / B3-2 분출공 66 → 갑각 떨기 취소, 자해 없음) — 머리 내림(눈 피해만). 구역질 소리 + 몸 들썩(Stage) + 안내
    audio.play('vent_gag', at);
    stage.lurchBehemoth(st.enemyId);
    padRumble('weakPoint');
    showReaction(
      st.cause === 'vent'
        ? '역류 — 갑각 떨기가 무너졌다, 머리가 내려온다 (혼절은 안 된다)'
        : st.cause === 'eye'
          ? '역류 — 포효가 막혔다, 머리가 내려온다 (위압 없음·혼절은 안 된다)'
          : '역류 — 발구르기가 무너졌다, 머리가 내려온다 (혼절은 안 된다)',
      1600,
    );
  } else if (st.kind === 'roar' && st.on) {
    // 포효 예고(B3-4) — 머리를 치켜들어 눈이 위로 드러났다(청록 맥동은 Stage). 예고음(telegraph_red)은 enemy_windup 이 냈다. 절망의 포효는 입에서 보라 기운
    showReaction((st as { despair?: boolean }).despair ? '절망의 포효 — 끌어당긴다! 눈 66 이면 취소, 아니면 뒤 대시' : '포효 — 눈이 위로 드러났다: 66 이면 취소, 아니면 무적 타이밍 회피', 1200);
  } else if (st.kind === 'exhaust' && st.on) {
    // 탈진(B3-4) — 삼연낫 3연속 완벽: 양낫이 박히고 눈(처형)과 분출공(정화·질식 ×3.0)이 함께 열린다. 헐떡임 + 안내
    audio.play('behemoth_pant', at);
    padRumble('weakPoint');
    const sec = Math.round(balance.weakPoint.headDown.exhaustTicks / balance.loop.tickRate);
    showReaction(`탈진 ${sec}초 — 눈(혼절·처형)이냐 분출공(정화·질식)이냐, 골라 쏴라!`, 2600);
  } else if (st.kind === 'choke') {
    // 질식(B3-2) — 분출공 내구 0(반사 4회): 갑각 떨기 봉인 + 웅덩이 전부 증발 + 예고가 늘어진다. 거친 숨소리 + 안내 / 풀리면 안내만
    if (st.on) {
      audio.play('vent_choke', at);
      padRumble('weakPoint');
      const sec = Math.round(balance.weakPoint.choke.sealTicks / balance.loop.tickRate);
      showReaction(`질식 — 분출공이 막혔다: 갑각 떨기 봉인 ${sec}초, 웅덩이가 마르고 예고가 느려진다`, 2600);
    } else {
      showReaction('거수가 숨을 되찾았다 — 분출공이 다시 열린다', 1600);
    }
  }
});
// 발구르기 예고 시작(거수 B3-1) — 예고음(telegraph_red)은 enemy_windup 이 냈다. 여기선 땅울림(stomp_ready, 예고음 버스)과 안내만.
// 기상 발구르기(wake)는 머리 내림·혼절이 끝나며 확정으로 나오는 벌칙 — 문구를 나눈다
events.on('enemy_slam_start', (payload) => {
  const s = payload as { enemyId: number; enemyType: string; wake: boolean; despair?: boolean; dist: number };
  audio.play('stomp_ready', panOf(payload));
  showReaction(
    s.wake ? '일어서며 발을 구른다 — 물러나라!' : s.despair ? '끌려온 자리에 발구르기 — 심장 66 으로 무너뜨리거나 뒤 대시!' : '발구르기 — 반경 밖으로 나가거나 막아라 (앞발 들 때 심장)',
    1200,
  );
});
// 포효(거수 P3, B3-4) — 예고 시작 안내(예고음 telegraph_red 는 enemy_windup, 눈 노출 문구는 boss_status roar), 발동엔 포효 소리 + 카메라 킥 + 진동(가까울수록 크게),
// 맞으면(12m 안·회피 무적 아님) 위압·밀림/끌림 안내. 피해는 없다 — 방어 판정도 없다
events.on('enemy_roar', (payload) => {
  const r = payload as { enemyId: number; despair: boolean; radius: number; dist: number; x: number; z: number };
  audio.play('boss_roar', panAt(r.x, r.z));
  stage.triggerCameraKick(0.5 + 0.7 * Math.max(0, 1 - r.dist / r.radius), 420);
  padRumble('roar');
});
events.on('boss_roar_hit', (payload) => {
  const h = payload as { status?: string; pull: number; push: number; despair: boolean };
  const cw = balance.status.cowed;
  showReaction(
    h.pull > 0
      ? `끌려간다 — 위압 ${Math.round(cw.ticks / balance.loop.tickRate)}초: 일반 패링이 관절을 열지 못한다(마나 ${cw.normalParryMana}), 완벽 패링 한 번이면 풀린다`
      : `위압 ${Math.round(cw.ticks / balance.loop.tickRate)}초 — 일반 패링이 관절을 열지 못한다(마나 ${cw.normalParryMana}). 완벽 패링 한 번이면 풀린다`,
    2800,
  );
});
// 삼연낫(거수 P3, B3-4) — ① 시작·② ③ 진행 안내. 예고음은 enemy_windup 이 타마다 낸다(③ 은 고음 telegraph_blue_high)
events.on('enemy_combo_start', () => showReaction('삼연낫 — ①오른 ②왼 ③양낫(완벽만): 셋 다 완벽이면 탈진', 1400));
events.on('enemy_combo_step', (payload) => {
  const c = payload as { step: number; steps: number; perfectOnly: boolean };
  showReaction(c.perfectOnly ? `삼연낫 ③ 양낫 내려찍기 — 완벽 패링만 통한다(일반 대역은 실패), 아니면 3.2m 밖으로` : `삼연낫 ${c.step + 1}/${c.steps} — 왼낫`, 1100);
});
// 광란 돌격 선회(거수 P3, B3-4) — 첫 질주 뒤 제자리 선회 = 2차 예고: 회전 소리(예고음 버스) + 안내. 두 번째 질주는 예고 없이 온다
events.on('enemy_chain_turn', (payload) => {
  const t = payload as { enemyType: string; x: number; z: number };
  audio.play('tail_whirl', panAt(t.x, t.z));
  const tailRadius = enemyDef(t.enemyType).chargeAttack?.chainCharge?.tailRadius;
  showReaction(`선회 — 꼬리${tailRadius !== undefined ? ` ${tailRadius}m` : ''} 밖으로! 두 번째 돌격이 온다(예고 없음)`, 1400);
});
// 페이즈 전환(거수 B2-6, 기획서 §8) — 포효 소리 + 카메라 킥 + 진동 + 전환 문구(phases[].shiftText: "갑각이 갈라진다" / "거수가 광란한다").
// 균열 발광·분출공 점등·등갑판 탈락·붉은 홍채는 Stage 가 enemy.phase 로 매 프레임 그린다. phase 0 은 사망 신호(계측 전용) — 연출 없음
events.on('boss_phase', (payload) => {
  const ph = payload as { enemyId: number; enemyType: string; phase: number; from: number; name?: string; shiftText?: string; x: number; z: number };
  if (ph.phase <= 0) return;
  audio.play('boss_roar', panAt(ph.x, ph.z));
  stage.triggerCameraKick(0.6, 420);
  padRumble('roar');
  const bossName = enemyDef(ph.enemyType).name ?? '보스';
  showReaction(ph.shiftText ? `${ph.shiftText} — ${bossName}${ph.name ? ` · ${ph.name}` : ''}` : `${bossName} — ${ph.name ?? ''}`, 2600);
});
// 갑각판 파괴(거수 P2, B3-3) — heavy 타격(해머 강타·수류탄·폭발·낙석)이 판 hp 풀 한 장(60)을 깎았다: 갑각 갈라지는 소리 + 그 판 자리 파편(소형) + 진동 + 안내.
// 골드 파편 주머니는 Loot 가 떨구고, 판 숨김·커진 분출공은 Stage 가 enemy.platesLeft/ventScale 로 매 프레임 그린다
events.on('plate_broken', (payload) => {
  const d = payload as { enemyId: number; enemyType: string; gold: number; platesLeft: number; count: number; x: number; z: number };
  audio.play('joint_crack', panAt(d.x, d.z));
  stage.breakBehemothPlate(d.enemyId, d.enemyType, d.platesLeft);
  padRumble('weakPoint');
  showReaction(`갑각판이 부서졌다 — 금 파편 ${d.gold}g (${d.count - d.platesLeft}/${d.count}장), 분출공이 커진다`, 1600);
});
// 등갑판 탈락(P3 진입) — 남은 판이 파편으로 튕겨 나간다(골드 없음). 판 숨김은 Stage 가 페이즈 표로
events.on('plate_shed', (payload) => {
  const d = payload as { enemyId: number; enemyType: string; x: number; z: number };
  audio.play('heavy_hit', panAt(d.x, d.z));
  stage.shedBehemothPlates(d.enemyId, d.enemyType);
});
// 돌격 완벽 회피(무적 8틱 안 접촉) — 미끄러지는 소리 + 안내. 관절 노출 소리(joint_open)는 boss_status expose 가 따로 낸다
events.on('charge_dodged', (payload) => {
  const d = payload as { x: number; z: number };
  audio.play('charge_dodged', panAt(d.x, d.z));
  padRumble('weakPoint');
  showReaction('완벽 회피 — 거수가 미끄러진다, 양 관절을 쏴라!', 1400);
});
// 플레이어 상태(B2-4, 기획서 §6) — 걸림·해제 안내. 아이콘은 HUD 가 카운터(numbArmTicks·concussionTicks)를 읽어 그리고,
// 기울기·덕킹은 render 가 매 프레임 세운다. 해제 이유: cured(패링·물약) / expired / displaced(상한에 밀림)
const statusSeconds = (payload: unknown): number =>
  Math.round(((payload as { ticks: number }).ticks ?? 0) / balance.loop.tickRate);
events.on('numb_arm_applied', (payload) => {
  audio.play('grunt');
  showReaction(`팔이 저리다 — ${statusSeconds(payload)}초 동안 완벽 패링 불가·방어가 느리다. 일반 패링 한 번이면 풀린다`, 2600);
});
events.on('numb_arm_ended', (payload) => {
  const reason = (payload as { reason: string }).reason;
  showReaction(reason === 'cured' ? '패링 — 팔 저림이 풀렸다' : '팔 저림이 풀렸다', 1200);
});
events.on('concussion_applied', (payload) => {
  stage.triggerCameraKick(0.35, 260);
  showReaction(`진탕 — ${statusSeconds(payload)}초 동안 조준이 흔들리고 시야가 기운다. 체력 물약이 지운다`, 2800);
});
events.on('concussion_ended', (payload) => {
  const reason = (payload as { reason: string }).reason;
  showReaction(reason === 'cured' ? '물약 — 진탕이 가라앉았다' : '진탕이 가라앉았다', 1400);
});
// 절뚝(B3-1, 거수 발구르기 직격) — 회피 스태미너 ×2·질주 불가. 회피 거리는 그대로라 "막거나 걸어 나가라" 는 안내
events.on('hobble_applied', (payload) => {
  audio.play('grunt');
  showReaction(`절뚝 — ${statusSeconds(payload)}초 동안 질주 불가·회피 스태미너 ×${balance.status.hobble.dodgeStaminaMul}. 발구르기는 막거나 걸어 나가라`, 2800);
});
events.on('hobble_ended', () => showReaction('다리가 풀렸다 — 절뚝이 끝났다', 1200));
// 위압(B3-4, 거수 P3 포효) — 일반 패링이 관절을 열지 못하고 마나가 준다. 걸림 안내는 boss_roar_hit 이 냈다(같은 틱) — 여기선 해제만
events.on('cowed_ended', (payload) => {
  const reason = (payload as { reason: string }).reason;
  showReaction(reason === 'cured' ? '완벽 패링 — 위압이 풀렸다' : '위압이 풀렸다', 1200);
});
// 오염 진액(B3-2, 거수 진액 웅덩이·구슬) — 이속 ×0.6·도트·오염 대기 가산. 도트 틱은 붉은 화면·진동 없이 신음만(독·화염 규약), 정화는 분출공 명중이 알린다
events.on('corrosive_applied', () => {
  audio.play('grunt');
  const cc = balance.status.corrosive;
  showReaction(`오염 진액이 붙었다 — 느려지고 체력이 닳는다, ${Math.round(cc.pendingPerTicks / balance.loop.tickRate)}초마다 오염 +1. 웅덩이에서 나가라(불이 지운다)`, 2600);
});
events.on('corrosive_tick', (payload) => {
  audio.play('grunt');
  showDamageTaken((payload as { amount: number }).amount, 'poison');
});
events.on('corrosive_ended', () => showReaction('진액이 씻겼다', 1200));
// 정화(기획서 §11) — source 'vent': 분출공 명중마다 오염 대기가 줄어든다(부착 중 ×2, 전투당 상한 — 소리는 weak_point_hit 이 냈다, B3-2).
// 'boss_death'/'boss_execute'(B3-6): 보스가 죽으며 고인 오염이 흩어진다 — 처형으로 마무리했으면 더 크게(−15). 팡파르는 enemy_died 가 낸다
events.on('corruption_cleansed', (payload) => {
  const c = payload as { amount: number; total: number; source: string };
  if (c.source === 'boss_execute') {
    showReaction(`처형 마무리 — 고인 오염이 흩어진다: 오염 대기 −${c.amount} (지금 ${world.corruption.pending})`, 3000);
    return;
  }
  if (c.source === 'boss_death') {
    showReaction(`고인 오염이 흩어진다 — 오염 대기 −${c.amount} (지금 ${world.corruption.pending})`, 3000);
    return;
  }
  const cap = balance.corruption.ventCleanseCap;
  showReaction(`분출공 명중 — 오염 대기 −${c.amount} (이번 전투 ${c.total}/${cap})`, 900);
});
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
  const info = payload as { lever: { row: number; col: number }; resets?: { type: string } };
  audio.play('lever_pull');
  stage.pullLever(info.lever.row, info.lever.col);
  if (info.resets) {
    // 함정 재생성 레버(시험방) — 손잡이는 잠시 뒤 제자리로, 다시 당길 수 있다
    afterMs(600, () => stage.resetLever(info.lever.row, info.lever.col));
    showReaction(
      info.resets.type === 'trap_gas' ? '레버를 당겼다 — 포자 식물이 다시 핀다' : '레버를 당겼다 — 함정이 다시 서린다',
      2200,
    );
    return;
  }
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
// 닫기 — 되밀리는 소리로 시작해 다 닫히면 쿵·철컥. 다시 열 때는 채널 없이 미닫이 소리만
events.on('door_closing', () => {
  audio.play('door_slide');
  padRumble('interact');
});
events.on('door_closed', (payload) => {
  const at = payload as { row: number; col: number; x: number; z: number };
  audio.play('door_close', panAt(at.x, at.z));
  padRumble('interact');
  stage.setDoorSwing(at.row, at.col, 0);
  minimap.rebuildBase(); // 다시 벽으로 그린다
});
// 문이 안 닫힌다 — 소리로 먼저 알린다(문이 몸을 툭 치고 되튕김). 누가 막는지 문장으로: 내 몸이면 비켜서라고
let doorBlockedUntil = 0;
events.on('door_blocked', (payload) => {
  const b = payload as { x: number; z: number; by: 'player' | 'enemy'; during: 'start' | 'closing' };
  audio.play('door_bump', panAt(b.x, b.z));
  padRumble('interact');
  if (performance.now() < doorBlockedUntil) return; // 문장은 도배하지 않는다 (소리는 매번)
  doorBlockedUntil = performance.now() + 1200;
  showReaction(
    b.by === 'player'
      ? '문틈에 서 있다 — 문 칸에서 비켜서야 닫힌다'
      : b.during === 'closing'
        ? '문이 적의 몸에 걸렸다 — 문틈이 비면 다시 닫힌다'
        : '문틈에 적이 있다 — 비워야 닫힌다',
    1600,
  );
});
events.on('door_reopened', () => {
  audio.play('door_slide');
  padRumble('interact');
});
/** 아레나 시각 상태(거수 4층, B3-5) — 층을 (다시) 그린 뒤 기둥 균열선·붕괴 잔해·문 봉쇄 창살을 World.arena 에서 되살린다(FloorState 복원).
 *  붕괴한 기둥 칸은 격자에서 이미 '.' 이라 기둥 메시가 안 서고, 잔해만 여기서 놓는다 */
function syncArenaVisuals(): void {
  const arena = world.arena;
  if (!arena) return;
  const max = balance.arena.pillarHp;
  for (const [key, hp] of Object.entries(arena.pillarHp)) {
    const [row, col] = key.split('-').map(Number);
    if (row === undefined || col === undefined) continue;
    if (hp > 0 && hp < max) stage.setPillarDamage(row, col, hp, max);
  }
  for (const r of arena.rubble) stage.addRubble(r.row, r.col, r.x, r.z, balance.arena.rubbleHalf, r.broken);
  if (arena.door) stage.setDoorSealed(arena.door.row, arena.door.col, arena.sealed);
}

/** 층을 갈아 끼운다 — 처음 밟는 층은 새로 짓고, 와 본 층은 얼려 둔 그대로 되살린다.
 *  들고 있던 것(체력·마나·탄약·스킬·가방·골드·오염·열쇠)은 전부 따라간다 */
function loadFloor(index: number, arrival: 'entrance' | 'exit' = 'entrance', fresh = false): void {
  // 떠나는 층을 얼려 둔다
  floorStates.set(floorIndex, {
    level,
    enemies: world.enemies,
    barrels: world.barrels,
    props: world.props,
    traps: world.traps,
    chests: world.chests,
    doors: world.doors,
    groundItems: world.groundItems,
    lifeMotes: world.lifeMotes,
    pulledLevers: world.pulledLevers,
    arena: world.arena,
    npcs: world.npcs,
  });
  if (fresh) floorStates.delete(index); // 새로 짓는다 — 얼려 둔 것이 있어도 버린다 ((개발) 현재 층 새로 시작)

  floorIndex = index;
  world.floorIndex = index;
  const trapRoom = index === TRAP_ROOM;
  const monsterRoom = index === MONSTER_ROOM;
  const lobby = index === LOBBY;
  world.monsterRoom = monsterRoom;
  world.lobby = lobby;
  // 소환 상태는 시험방 것 — 층을 옮기면 비운다 (들어올 때도 새로 시작)
  world.summonTargets = {};
  world.summonQueue = [];
  world.summonAuto = false;
  minimap.setFloorTitle(floorLabel(index)); // 맵 탭은 미니맵의 층 이름을 그대로 읽는다
  levelJson = trapRoom
    ? (testTraps as unknown as typeof z01f1)
    : monsterRoom
      ? (testMonsters as unknown as typeof z01f1)
      : lobby
        ? (lobbyJson as unknown as typeof z01f1)
        : ZONE[index]!;
  traveling = false;

  const saved = floorStates.get(index);
  if (saved) {
    // 와 본 층 — 재소환하지 않는다. 죽인 적은 죽은 채로다
    level = saved.level;
    world.level = level;
    world.enemies = saved.enemies;
    world.barrels = saved.barrels;
    world.props = saved.props;
    world.traps = saved.traps;
    world.chests = saved.chests;
    world.doors = saved.doors;
    world.groundItems = saved.groundItems;
    world.lifeMotes = saved.lifeMotes;
    world.pulledLevers = saved.pulledLevers;
    world.arena = saved.arena; // 봉쇄·기둥 내구·잔해도 그대로(기둥 칸은 Level 격자에, 잔해 차단은 Level.props 에 이미 살아 있다)
    world.npcs = saved.npcs;
  } else {
    // 처음 밟는 층 — 새로 짓는다. 앞 층의 차단 블록은 그 층 Level 과 함께 얼었다
    level = new Level(levelJson);
    world.level = level;
    world.enemies = spawnEnemies(levelJson.entities, level);
    world.barrels = spawnBarrels(levelJson.entities, level);
    world.props = spawnProps(levelJson.entities, level);
    world.traps = spawnTraps(levelJson.entities, level);
    world.chests = spawnChests(levelJson.entities, level);
    world.doors = level.doors.map((d) => ({
      row: d.row, col: d.col, x: d.x, z: d.z, dirX: d.dirX, dirZ: d.dirZ,
      byLever: d.byLever, progress: 0, slide: 0, prevSlide: 0, opened: false,
    }));
    // 새 배열로 갈아 끼운다 — .length = 0 으로 비우면 얼려 둔 앞 층 것까지 지워진다
    world.groundItems = [];
    world.lifeMotes = [];
    world.pulledLevers = new Set();
    world.arena = Arena.fromLevel(level); // 아레나(거수 4층, B3-5) — arena 정의가 없는 층은 null
    world.npcs = spawnNpcs(levelJson.entities, level); // 로비의 사제·상인 — 다른 층은 빈 배열
    // 불러온 세이브의 층 — 원본과의 차이(죽인 적·연 상자·부순 통…)를 덧씌운다. 한 번 쓰면 지운다 ((개발) 새로 시작은 원본으로)
    const diff = pendingFloorDiffs[String(index)];
    if (diff) {
      Save.applyFloorDiff(world, level, diff);
      delete pendingFloorDiffs[String(index)];
    }
  }
  world.npcInView = null;
  world.projectiles.length = 0;
  world.gooPuddles = []; // 점액은 층/판에 속한다 — 새 판에 들고 가지 않는다
  Hazards.clearAll(world); // 진액 웅덩이도
  world.ghoulHeads = []; // 튀는 머리도 층에 속한다

  // 도착 지점 — 내려왔으면 입구 계단 앞, 올라왔으면 출구 계단 앞
  const at = arrival === 'exit' && level.exitPos ? level.exitPos : level.spawn;
  const atYaw = arrival === 'exit' && level.exitPos ? level.exitYaw : level.spawnYaw;

  world.chestInView = null;
  world.lootInView = null;
  world.lootOpen = null;
  world.itemInView = null;
  world.doorInView = null;
  world.leverInView = null;
  world.altarInView = false;
  world.altarEnteredThisApproach = false;
  // 부활 지점은 제단만이다 (2026-09-07 로비 도입) — 계단 도착 자리는 더 이상 저장점이 아니다.
  // 제단을 안 찍었으면 죽어서 성소 로비로 돌아간다
  // 출구 봉인 — 주인이 배치된 층에서 아직 딴 적이 없으면 쇠창살이 내려온다.
  // 층을 새로 로드하면 적이 초기화되므로, 이미 딴 층(unlockedFloors)만 예외다
  world.exitNeedsKey =
    levelJson.entities.some(
      (e) =>
        e.type !== 'barrel' && e.type !== 'chest' && !e.type.startsWith('prop_') &&
        !e.type.startsWith('trap_') && !e.type.startsWith('npc_') && // 함정·NPC 는 적이 아니다 — enemyDef 가 던진다
        (enemyDef(e.type).boss || (e as { boss?: boolean }).boss === true),
    ) && !unlockedFloors.has(index);
  if (trapRoom) world.exitNeedsKey = true; // 시험방 출구는 영구 봉인 — 진행과 섞이지 않는다
  if (monsterRoom) world.exitNeedsKey = false; // 출구가 없다 — Exit 은 시험방에서 돌지 않는다
  if (lobby) world.exitNeedsKey = false; // 로비 현관 계단은 늘 열려 있다 — 지하 1층으로 내려간다
  world.canAscend = !trapRoom && !monsterRoom && !lobby; // 지하 1층의 입구 계단은 성소 로비로 올라간다
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
  p.iframeSource = undefined;
  Status.clearAll(world); // 플레이어 상태(팔 저림·진탕)는 층을 넘지 않는다 — 시험방 진입도 여기를 지난다
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
  syncArenaVisuals(); // 아레나 — 기둥 균열선·붕괴 잔해·봉쇄 창살(B3-5)
  minimap.setLevel(level);
  // 해독은 오염 단계에 딸린 상태다 — 새 층 벽에도 그대로 적용해 준다.
  // (setGlyphsReadable 은 씬을 훑으므로 층을 갈아 끼운 뒤 한 번 더 불러야 한다)
  stage.setGlyphsReadable(world.corruption.applied >= (balance.corruption.thresholds[0] ?? 25));
  events.emit('floor_entered', { index, id: levelJson.id, name: levelJson.name, total: ZONE.length });
  // 체크포인트 자동 저장 — 층을 옮길 때(로비 도착·부활 포함). 첫 로드와 세이브 복원 중, 시험방은 제외 (balance.save.autosave)
  if (!suppressAutosave && balance.save.autosave.floorChange) saveGame('auto');
}

events.on('zone_cleared', () => {
  // 성소 로비의 현관 계단 — 구역 클리어가 아니라 지하 1층으로 내려가는 길이다
  if (floorIndex === LOBBY) {
    traveling = true;
    audio.play('stairs_travel');
    stage.startDescent(DESCENT_MS, 1, level.exitYaw + Math.PI);
    screenFade(1, DESCENT_MS);
    afterMs(DESCENT_MS + 40, () => {
      loadFloor(0);
      screenFade(0, DESCENT_FADE_IN_MS);
    });
    return;
  }
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
  deathStats!.textContent = '';
  const clearOverlay = deathOverlay!;
  deathTitle!.textContent = '1구역 클리어';
  (clearOverlay as HTMLElement).style.background = 'rgba(10, 40, 20, 0.6)';
  clearOverlay.classList.add('visible');
});

// 입구 계단으로 위층에 되돌아간다 — 내려갈 때와 같은 연출, 방향만 반대
events.on('floor_ascend', () => {
  if (traveling || floorIndex >= ZONE.length) return;
  traveling = true;
  audio.play('stairs_travel');
  // 입구 계단 입 쪽으로 몸을 돌리며 올라간다. 지하 1층 위는 성소 로비 — 현관 계단(출구 X) 앞에 도착한다
  const target = floorIndex === 0 ? LOBBY : floorIndex - 1;
  stage.startDescent(DESCENT_MS, -1, level.spawnYaw + Math.PI);
  screenFade(1, DESCENT_MS);
  afterMs(DESCENT_MS + 40, () => {
    loadFloor(target, 'exit');
    screenFade(0, DESCENT_FADE_IN_MS);
  });
});

// 새 층에 발을 디뎠다 — 어디인지 알려 준다
events.on('floor_entered', (payload) => {
  const f = payload as { index: number; name: string; total: number };
  audio.play('door_slide');
  // 특수 층(로비·시험방)은 번호가 없다
  showReaction(f.index < f.total ? `${f.name}  (${f.index + 1}/${f.total})` : f.name, 2600);
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
Loot.init(world); // 처치 드랍 → 주머니 (Pickups 는 바닥 아이템 물리만)
Summon.init(world); // 몬스터 시험방 — 처치 → 자동 재소환 대기열
Equipment.init(world); // 장비 — 파생 수치·가방 칸을 장비 상태에 맞춘다
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
Traps.init(world); // 함정 — 기름 점화 소음 구독
Hazards.init(world); // 진액 웅덩이(거수 P2+) — spawn_pool·불(폭발)·질식 구독
Arena.init(world); // 보스 아레나(거수 4층) — 기둥 충돌(내구)·폭발(잔해)·사망(봉쇄 해제) 구독
const systems = [
  PlayerMove.tick,
  Enemies.tick,
  Arena.tick, // 아레나 봉쇄·기둥·반캠핑 — 같은 틱의 각성(Enemies)에 바로 봉쇄하고, 문 닫기(Door)보다 앞서 closing 을 세운다
  GhoulHeads.tick,
  Reaction.tick,
  Status.tick, // 플레이어 상태(팔 저림·진탕) — 같은 틱의 impact 부여·일반 패링 해제를 바로 이벤트로 낸다
  Sigils.tick,
  Pickups.tick,
  Summon.tick, // 몬스터 시험방 — 자동 재소환 대기열
  LifeMotes.tick,
  Items.tick,
  Weapons.tick,
  Projectiles.tick,
  Barrels.tick, // 같은 틱에 쏜 화염구·던진 수류탄이 통을 터뜨릴 수 있게 뒤에 둔다
  Props.tick, // 기믹 심지도 같은 이유로 투사체 뒤
  Traps.tick, // 함정 — 다트가 같은 틱에 나가고, 반응(Reaction)은 다음 틱부터 받아친다
  Hazards.tick, // 진액 웅덩이 — 같은 틱의 착지·착탄(Enemies·Projectiles)이 만든 웅덩이를 말리고, 불붙은 기름(Traps) 뒤에서 증발·접촉을 본다
  Mana.tick,
  Altar.tick,
  Npc.tick, // 로비의 사제·상인 — 제단과 같은 접근 규약. 축복 잔여 틱도 여기서 줄인다
  Door.tick,
  Lever.tick,
  Chest.tick,
  Loot.tick, // 주머니 대상·E 열기 — 상자 뒤에서 돈다 (상자가 우선)
  Exit.tick,
  Lantern.tick,
  Stamina.tick, // 소모하는 쪽(PlayerMove·Reaction) 뒤에서 회복한다
];

function simulate(dt: number): void {
  world.input = input.sample();
  if (input.gamepad.touched) audio.unlock(); // 창 전환 뒤 멈춘 소리 — 패드 입력도 재개 계기로 (500ms 에 한 번만 시도)

  // 상호작용은 전용 키(E·패드 B)만 — 근접 키(우클릭·RT)는 더 이상 상호작용으로 바뀌지 않는다
  // (2026-09-04 사용자 결정: 문·주머니 앞에서 휘두르려다 창이 열리는 사고를 없앤다).
  // 예전 "한 키 체계"(근접 → 상호작용 병합)는 여기 있었다 — 되살리려면 *_InView 로 대상을 보고
  // meleePressed 를 interactPressed 로 바꾸는 한 줄이면 된다
  // Menu 버튼 = Tab. 가방·각인 창은 스냅샷을 안 거치는 raw 입력이라 여기서 본다.
  // 렌더 루프에서 읽으면 안 된다 — 폴링은 틱에서 도는데 렌더는 다른 속도로 돌아
  // 같은 엣지를 두 프레임이 먹고 창이 열렸다 곧바로 닫힌다 (실측으로 확인)
  // View = 일시정지. 패드만 쓰는 사람이 메뉴·키 설정에 오는 유일한 길이다
  if (input.gamepad.pressed('pause') && !world.uiOpen && !world.dead && !world.cleared) {
    setPaused(true);
    return;
  }
  // Menu = 메뉴 창 열기/닫기 (순환 폐지 — 탭은 LB/RB). 상점에서는 스킬 탭(제단 모드)으로
  if (input.gamepad.pressed('inventory')) {
    if (lootUI.open) {
      lootUI.padClose(); // 루팅 창은 Menu 로도 닫힌다 (다른 창으로 넘어가지 않는다)
    } else if (shopUI.open) {
      shopUI.hide();
      menuUI.show('bag', true); // 제단 앞 — 가방 탭(몸 패널에서 각인 떼기·장비·매각)
    } else {
      menuUI.toggle();
    }
  }
  if (menuUI.open && input.gamepad.connected) {
    menuUI.padMode = input.lastDevice === 'pad';
    if (input.gamepad.rawPressed(4)) menuUI.next(-1); // LB — 왼쪽 탭 (빙글)
    else if (input.gamepad.rawPressed(5)) menuUI.next(1); // RB — 오른쪽 탭
    else if (input.gamepad.rawPressed(1) && menuUI.active !== 'bag' && menuUI.active !== 'skill') menuUI.hide(); // B — 가방·스킬 탭은 제 창이 들기·고르기 취소를 먼저 본다
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
  // 상인 창 — 가방 창과 같은 규약: D-패드·왼 스틱 커서, A 팔기(한 개)/구매, X 칸 통째로 팔기, LB/RB 탭, B 닫기
  if (merchantUI.open) {
    merchantUI.padMode = input.lastDevice === 'pad';
    if (input.gamepad.connected) {
      const ms = menuStickStep();
      if (input.gamepad.rawPressed(13)) merchantUI.padMove(0, 1);
      else if (input.gamepad.rawPressed(12)) merchantUI.padMove(0, -1);
      else if (input.gamepad.rawPressed(15)) merchantUI.padMove(1, 0);
      else if (input.gamepad.rawPressed(14)) merchantUI.padMove(-1, 0);
      else if (ms.dx !== 0 || ms.dy !== 0) merchantUI.padMove(ms.dx, ms.dy);
      else if (input.gamepad.rawPressed(4)) merchantUI.padTab(-1); // LB
      else if (input.gamepad.rawPressed(5)) merchantUI.padTab(1); // RB
      else if (input.gamepad.rawPressed(0)) merchantUI.padA();
      else if (input.gamepad.rawPressed(2)) merchantUI.padX();
      else if (input.gamepad.rawPressed(1)) merchantUI.padB();
    }
  }
  // 메뉴 스틱 — 왼 스틱을 D-패드처럼 (한 번 밀면 한 칸, 계속 밀면 반복). 루팅 창·상점 공용
  const stick = menuStickStep();
  if (shopUI.open && input.gamepad.connected && stick.dy !== 0) shopUI.padMove(stick.dy);
  // 가방 창 — 루팅 창과 같은 패드 규약: D-패드·왼 스틱 커서, A 고르기/등록(길게 집어 옮기기), X 버리기(길게 나누기),
  // Y 보관 주머니 내려놓기, B 닫기(들기·대화상자는 취소). A·X 는 홀드 판정이라 매 틱 상태를 넘긴다
  if (inventoryUI.open) {
    inventoryUI.padMode = input.lastDevice === 'pad';
    if (input.gamepad.connected) {
      inventoryUI.padA(input.gamepad.rawHeld(0));
      if (input.gamepad.rawPressed(13)) inventoryUI.padMove(0, 1);
      else if (input.gamepad.rawPressed(12)) inventoryUI.padMove(0, -1);
      else if (input.gamepad.rawPressed(15)) inventoryUI.padMove(1, 0);
      else if (input.gamepad.rawPressed(14)) inventoryUI.padMove(-1, 0);
      else if (stick.dx !== 0 || stick.dy !== 0) inventoryUI.padMove(stick.dx, stick.dy);
      else if (input.gamepad.rawPressed(1)) inventoryUI.padClose();
      inventoryUI.padX(input.gamepad.rawHeld(2)); // X 짧게 버리기 · 길게 수량 나누기
      inventoryUI.padY(input.gamepad.rawHeld(3)); // Y 짧게 사용 · 길게 보관 주머니 내려놓기
    }
  }
  // 스킬 탭 — 칸 표기(Y·B·A·X / Z·X·C·V)가 마지막으로 쓴 장치를 따라간다.
  // 패드: D-패드·왼 스틱 커서(← 마름모 / → 목록), A 고르기/올리기(빈손 = 비우기), X 칸 비우기, B 취소/닫기 (2026-09-07 사용자)
  if (skillUI.open) {
    skillUI.padMode = input.lastDevice === 'pad';
    if (input.gamepad.connected) {
      if (input.gamepad.rawPressed(13)) skillUI.padMove(0, 1);
      else if (input.gamepad.rawPressed(12)) skillUI.padMove(0, -1);
      else if (input.gamepad.rawPressed(15)) skillUI.padMove(1, 0);
      else if (input.gamepad.rawPressed(14)) skillUI.padMove(-1, 0);
      else if (stick.dx !== 0 || stick.dy !== 0) skillUI.padMove(stick.dx, stick.dy);
      else if (input.gamepad.rawPressed(0)) skillUI.padA();
      else if (input.gamepad.rawPressed(2)) skillUI.padX();
      else if (input.gamepad.rawPressed(1)) skillUI.padB();
    }
  }
  // 소환 탭(몬스터 시험방) — D-패드·왼 스틱 커서([1][3][6] → 오른쪽 패널), A 실행. B·LB/RB 는 셸이 맡는다
  if (summonUI.open) {
    summonUI.padMode = input.lastDevice === 'pad';
    if (input.gamepad.connected) {
      if (input.gamepad.rawPressed(13)) summonUI.padMove(0, 1);
      else if (input.gamepad.rawPressed(12)) summonUI.padMove(0, -1);
      else if (input.gamepad.rawPressed(15)) summonUI.padMove(1, 0);
      else if (input.gamepad.rawPressed(14)) summonUI.padMove(-1, 0);
      else if (stick.dx !== 0 || stick.dy !== 0) summonUI.padMove(stick.dx, stick.dy);
      else if (input.gamepad.rawPressed(0)) summonUI.padA();
    }
  }
  // 루팅 창 — D-패드 네 방향(←→ 로 칸 전환), A 짧게 가져오기/넣기 · 길게 집어 들기(→ 이동 → A 놓기),
  // X 모두, Y 바닥에 버리기(들고 있으면 그것을), B 닫기(들고 있으면 취소). A 는 홀드 판정이라 매 틱 상태를 넘긴다
  if (lootUI.open && input.gamepad.connected && (input.gamepad.pressed('melee') || input.gamepad.pressed('ranged'))) {
    lootUI.close(); // 무기를 쥐면 창이 닫히고 그 입력은 이 틱에 그대로 통한다 (실시간 루팅 — 위협에 즉시 대응)
  }
  if (lootUI.open) {
    // 표기는 '마지막으로 쓴 장치'를 따른다 — 창을 벗어난 사이 브라우저가 패드를 감춰도(connected=false) 패드 표기를 유지하고,
    // 그 상태면 창 안에 "패드가 잠들었다 — 클릭·아무 키" 안내를 띄운다 (브라우저 규칙: 새 제스처 전까지 패드 노출이 막힌다)
    lootUI.padMode = input.lastDevice === 'pad';
    lootUI.setNotice(
      input.lastDevice === 'pad' && !input.gamepad.connected
        ? '패드 입력이 들어오지 않는다 — 창을 벗어났다 돌아왔다면 화면을 한 번 클릭하거나 아무 키를 누르면 다시 잡힌다 (브라우저 규칙)'
        : null,
    );
  }
  if (lootUI.open && input.gamepad.connected) {
    lootUI.padA(input.gamepad.rawHeld(0));
    if (input.gamepad.rawPressed(13)) lootUI.padMove(0, 1);
    else if (input.gamepad.rawPressed(12)) lootUI.padMove(0, -1);
    else if (input.gamepad.rawPressed(15)) lootUI.padMove(1, 0);
    else if (input.gamepad.rawPressed(14)) lootUI.padMove(-1, 0);
    else if (stick.dx !== 0 || stick.dy !== 0) lootUI.padMove(stick.dx, stick.dy);
    else if (input.gamepad.rawPressed(3)) lootUI.padDrop();
    else if (input.gamepad.rawPressed(1)) lootUI.padClose();
    lootUI.padX(input.gamepad.rawHeld(2)); // X 짧게 모두 가져오기 · 길게 수량 나누기 (홀드 판정이라 매 틱)
  }
  // 사망 메뉴·워프 목록·사제 대화 — 일시정지 메뉴와 같은 고정 버튼 규약 (D-패드 ↑↓, A 결정, B 닫기)
  for (const dlg of [deathMenu, warpDialog, npcDialog, saveDialog]) {
    if (!dlg.open) continue;
    dlg.padMode = input.usingPad;
    if (!input.gamepad.connected) continue;
    if (input.gamepad.rawPressed(13)) dlg.padMove(1);
    else if (input.gamepad.rawPressed(12)) dlg.padMove(-1);
    else if (stick.dy !== 0) dlg.padMove(stick.dy);
    else if (input.gamepad.rawPressed(0)) dlg.padActivate();
    else if (input.gamepad.rawPressed(1)) dlg.padClose();
    else if (input.gamepad.rawPressed(2)) dlg.padDelete(); // 저장 목록 — 커서 줄 삭제
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

  // 실시간 루팅 — 루팅 창은 시간을 멈추지 않는다(상점·가방·스킬 창은 여전히 멈춘다). 대신 플레이어는 뿌리내린다:
  // 이동·시선·공격 입력을 비운다(WASD·왼 스틱은 커서를 옮기는 중이다). 적은 그대로 다가와 때리고, 맞으면 창이 닫힌다
  const lootLive = world.uiOpen && world.lootOpen !== null;
  if (lootLive) world.input = Input.emptySnapshot();
  if (!world.dead && (!world.uiOpen || lootLive) && !world.cleared) {
    // 무적(테스트) — 시스템을 손대지 않고 한 곳에서 자원만 되돌린다.
    // HP를 깎는 지점이 여섯 군데라 각각 분기를 심으면 금방 어긋난다
    const keep = world.godMode ? snapshotResources() : null;
    // 성소 로비 — 총·화살·수류탄을 써도 줄지 않는다 (2026-09-07 사용자). 무적과 같은 방식: 시스템은 손대지 않고 틱 끝에 되돌린다
    const keepAmmo = world.lobby && !keep
      ? { mag: world.weapon.mag, reserve: world.weapon.reserve, grenades: world.weapon.grenades, arrows: world.weapon.arrows ?? 0 }
      : null;
    for (const system of systems) system(world, dt);
    if (keep) restoreResources(keep);
    if (keepAmmo) {
      world.weapon.mag = keepAmmo.mag;
      world.weapon.reserve = keepAmmo.reserve;
      world.weapon.grenades = keepAmmo.grenades;
      world.weapon.arrows = keepAmmo.arrows;
    }
    // 스킬 테스트 — 마나만 무한. 무적과 같은 자리·같은 방식 (시스템은 손대지 않는다)
    if (world.skillTestMode) world.mana.value = balance.mana.max;
    // 몬스터 시험방 — HP·MP 가 소모되되 초당 regen 만큼 자동으로 찬다 (2026-09-04 사용자)
    if (world.monsterRoom && !world.dead) {
      const rg = balance.monsterRoom.regen;
      world.player.health = Math.min(balance.player.healthMax, world.player.health + rg.healthPerSec / 60);
      world.mana.value = Math.min(balance.mana.max, world.mana.value + rg.manaPerSec / 60);
    }
  } else {
    // 시스템이 멈춘 사이(사망·창 열림·클리어) 채널이 스스로 못 끊는다 —
    // 그냥 두면 빔이 화면에 얼어붙고 전류음이 남는다
    Projectiles.endChannel(world);
    // 달리다 창을 열면 prev→현재 보간이 매 틱 처음부터 되감겨 카메라가 위아래로 계속 흔들렸다(걷기 bob 이 그 왕복을 걸음으로 본다) —
    // 멈춘 동안은 지난 자리를 지금 자리에 맞춘다 (2026-09-07 사용자)
    const p = world.player;
    p.prevX = p.x;
    p.prevY = p.y;
    p.prevZ = p.z;
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
// 독 디버프 아이콘 — 해골 대신 포자 주머니 픽토그램 (프리미티브 규칙: 단색 SVG)
const buffPoisonEl = document.getElementById('buff-poison')!;
buffPoisonEl.insertAdjacentHTML(
  'afterbegin',
  '<svg width="22" height="22" viewBox="0 0 22 22"><circle cx="11" cy="9" r="6.5" fill="#8fd35a"/>' +
    '<circle cx="8.5" cy="7.5" r="1.3" fill="#2f4a1e"/><circle cx="13.5" cy="10" r="1.1" fill="#2f4a1e"/>' +
    '<rect x="10" y="14" width="2" height="6" fill="#4d6b2e"/><circle cx="5" cy="17" r="1.8" fill="#6f9a3a"/><circle cx="17" cy="17" r="1.8" fill="#6f9a3a"/></svg>',
);
const buffPoisonCd = buffPoisonEl.querySelector<HTMLElement>('.buff-cd')!;
const buffPoisonSec = buffPoisonEl.querySelector<HTMLElement>('.buff-sec')!;
// 화염 디버프 아이콘 — 불꽃 픽토그램 (바깥 주황 혀 + 안쪽 노란 심)
const buffBurnEl = document.getElementById('buff-burn')!;
buffBurnEl.insertAdjacentHTML(
  'afterbegin',
  '<svg width="22" height="22" viewBox="0 0 22 22">' +
    '<path d="M11 1.5 C13.2 5.5 16.5 7.5 16.5 12.2 A5.5 5.5 0 0 1 5.5 12.2 C5.5 9.4 7.6 8.2 8.2 5.6 C9.2 7.2 10.4 7.4 11 1.5Z" fill="#ff8a2a"/>' +
    '<path d="M11 9.5 C12.3 11.6 13.8 12.3 13.8 14.4 A2.8 2.8 0 0 1 8.2 14.4 C8.2 12.6 9.9 12 11 9.5Z" fill="#ffd25a"/></svg>',
);
const buffBurnCd = buffBurnEl.querySelector<HTMLElement>('.buff-cd')!;
const buffBurnSec = buffBurnEl.querySelector<HTMLElement>('.buff-sec')!;
// 팔 저림 디버프 아이콘(B2-4, 거수 낫을 방패로 막음) — 지그재그로 저린 팔 + 찌릿한 불꽃
const buffNumbEl = document.getElementById('buff-numb')!;
buffNumbEl.insertAdjacentHTML(
  'afterbegin',
  '<svg width="22" height="22" viewBox="0 0 22 22">' +
    '<path d="M3.5 17 L8.5 11.5 L12.5 13.5 L18 5.5" stroke="#9ec5ff" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<path d="M4.5 5 l2 2 M2.5 10 h2.4 M16 15.5 l2 2 M17.5 11.5 h2.4" stroke="#e2eeff" stroke-width="1.6" stroke-linecap="round"/></svg>',
);
const buffNumbCd = buffNumbEl.querySelector<HTMLElement>('.buff-cd')!;
const buffNumbSec = buffNumbEl.querySelector<HTMLElement>('.buff-sec')!;
// 진탕 디버프 아이콘(거수 돌격 직격) — 머리 둘레를 도는 별 궤도(어지러움)
const buffConcussionEl = document.getElementById('buff-concussion')!;
buffConcussionEl.insertAdjacentHTML(
  'afterbegin',
  '<svg width="22" height="22" viewBox="0 0 22 22">' +
    '<circle cx="11" cy="12.5" r="5.5" fill="#d9b24a"/>' +
    '<ellipse cx="11" cy="8" rx="8.5" ry="2.8" fill="none" stroke="#fff0b0" stroke-width="1.5"/>' +
    '<circle cx="3" cy="7.2" r="1.2" fill="#fff6d0"/><circle cx="19" cy="9.2" r="1.2" fill="#fff6d0"/></svg>',
);
const buffConcussionCd = buffConcussionEl.querySelector<HTMLElement>('.buff-cd')!;
const buffConcussionSec = buffConcussionEl.querySelector<HTMLElement>('.buff-sec')!;
// 절뚝 디버프 아이콘(B3-1, 거수 발구르기 직격) — 꺾인 다리 + 발밑 충격선
const buffHobbleEl = document.getElementById('buff-hobble')!;
buffHobbleEl.insertAdjacentHTML(
  'afterbegin',
  '<svg width="22" height="22" viewBox="0 0 22 22">' +
    '<path d="M8 3 L9.5 10 L6 15.5 L11 18.5" stroke="#ff8fa6" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<path d="M13 3 L14.5 10 L16.5 18.5" stroke="#ff8fa6" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<path d="M2.5 20.5 h5 M14.5 20.5 h5" stroke="#ffd0da" stroke-width="1.6" stroke-linecap="round"/></svg>',
);
const buffHobbleCd = buffHobbleEl.querySelector<HTMLElement>('.buff-cd')!;
const buffHobbleSec = buffHobbleEl.querySelector<HTMLElement>('.buff-sec')!;
// 오염 진액 디버프 아이콘(B3-2, 거수 진액 웅덩이·구슬) — 발밑 웅덩이에서 오르는 방울 셋(오염 녹색)
const buffCorrosiveEl = document.getElementById('buff-corrosive')!;
buffCorrosiveEl.insertAdjacentHTML(
  'afterbegin',
  '<svg width="22" height="22" viewBox="0 0 22 22">' +
    '<ellipse cx="11" cy="17.5" rx="8.5" ry="3" fill="#39ff88" opacity="0.85"/>' +
    '<path d="M11 3 C13.2 6.4 14.6 8.4 14.6 10.4 A3.6 3.6 0 0 1 7.4 10.4 C7.4 8.4 8.8 6.4 11 3Z" fill="#8dffb8"/>' +
    '<circle cx="4.5" cy="12.5" r="1.4" fill="#8dffb8"/><circle cx="17.8" cy="11.5" r="1.1" fill="#8dffb8"/></svg>',
);
const buffCorrosiveCd = buffCorrosiveEl.querySelector<HTMLElement>('.buff-cd')!;
const buffCorrosiveSec = buffCorrosiveEl.querySelector<HTMLElement>('.buff-sec')!;
// 위압 디버프 아이콘(B3-4, 거수 P3 포효) — 벌어진 입(포효)과 그 앞에서 눌린 방패 — "일반 패링이 관절을 열지 못한다"
const buffCowedEl = document.getElementById('buff-cowed')!;
buffCowedEl.insertAdjacentHTML(
  'afterbegin',
  '<svg width="22" height="22" viewBox="0 0 22 22">' +
    '<path d="M2.5 6 L10 9.5 L2.5 15.5 Z" fill="#c9a6ff"/>' +
    '<path d="M4.5 9 l1.6 -1.2 M4.5 12.8 l1.6 1.2" stroke="#efe4ff" stroke-width="1.2" stroke-linecap="round"/>' +
    '<path d="M13 5.5 h6.5 v6.2 c0 3.1 -1.9 5.2 -3.25 5.8 c-1.35 -0.6 -3.25 -2.7 -3.25 -5.8 Z" fill="#6b5a80" stroke="#c9a6ff" stroke-width="1.2"/>' +
    '<path d="M14.6 9.3 l3.3 3.3 M17.9 9.3 l-3.3 3.3" stroke="#ff8fa6" stroke-width="1.5" stroke-linecap="round"/></svg>',
);
const buffCowedCd = buffCowedEl.querySelector<HTMLElement>('.buff-cd')!;
const buffCowedSec = buffCowedEl.querySelector<HTMLElement>('.buff-sec')!;
/** 디버프 아이콘 깜빡임 — 상태가 다시 시작됐다. 클래스를 떼고 리플로우로 애니메이션을 처음부터 다시 돌린다 */
function flashBuffIcon(el: HTMLElement): void {
  el.classList.remove('refresh');
  void el.offsetWidth;
  el.classList.add('refresh');
  window.setTimeout(() => el.classList.remove('refresh'), 800);
}
/** 지속 피해·상태 디버프 아이콘 — 남은 시간만큼 밝은 부채꼴이 시계 방향으로 줄어든다 + 남은 초.
 *  DotState 도, 상태 카운터를 {ticks, duration} 으로 묶은 것도 받는다(팔 저림·진탕) */
function syncDotIcon(el: HTMLElement, cd: HTMLElement, sec: HTMLElement, dot: { ticks: number; duration: number } | undefined): void {
  if (!dot || dot.ticks <= 0 || world.dead) {
    el.classList.remove('on');
    return;
  }
  el.classList.add('on');
  const remainDeg = Math.min(360, (dot.ticks / dot.duration) * 360);
  cd.style.background =
    `conic-gradient(transparent 0deg ${remainDeg}deg, rgba(0, 0, 0, 0.72) ${remainDeg}deg 360deg)`;
  sec.textContent = String(Math.ceil(dot.ticks / balance.loop.tickRate));
}
/** 플레이어 상태 카운터 → 아이콘 인자 (없으면 undefined = 숨김). 분모는 balance.status 의 지속 틱 */
function statusIconArg(ticks: number | undefined, duration: number): { ticks: number; duration: number } | undefined {
  return ticks && ticks > 0 ? { ticks, duration } : undefined;
}
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
function skillSlotKeyLabelFor(i: number, pad: boolean): string {
  if (pad) {
    // 선택 버튼(RB) 접두는 생략 — 칸마다 반복되면 소음이다 (다이아 라벨이 조합을 안내)
    return shortPadBtn(input.gamepad.binding(`skill${i + 1}` as PadAction));
  }
  return keyBindings.label(`skill${i + 1}` as KeyAction);
}
function skillSlotKeyLabel(i: number): string {
  return skillSlotKeyLabelFor(i, input.usingPad);
}
function quickSlotKeyLabelFor(i: number, pad: boolean): string {
  if (pad) {
    if (i >= 4) return '—'; // 패드 조합은 D-패드 4방향까지 — 5번 자리가 없다
    return shortPadBtn(input.gamepad.binding(`slot${i + 1}` as PadAction));
  }
  return keyBindings.label(`slot${i + 1}` as KeyAction);
}
function quickSlotKeyLabel(i: number): string {
  return quickSlotKeyLabelFor(i, input.usingPad);
}

function syncSkillSlots(): void {
  const padCls = input.usingPad ? ' pad' : ''; // 패드면 키 글자를 원 안에 (2026-09-07 사용자)
  world.skillSlots.forEach((id, i) => {
    const ui = skillCells[i];
    if (!ui) return;
    const keyText = skillSlotKeyLabel(i);
    if (ui.key.textContent !== keyText) ui.key.textContent = keyText;
    const selected = world.selectedSkill === i;
    if (!id) {
      ui.cell.className = `dslot p${i} skill empty${selected ? ' selected' : ''}${padCls}`;
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
      (selected ? ' selected' : '') + padCls;
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
  const padCls = input.usingPad ? ' pad' : ''; // 패드면 키 글자를 원 안에 — 스킬 마름모와 같은 꼴
  view.forEach((slot, i) => {
    const ui = quickCells[i];
    if (!ui) return;
    const keyText = quickSlotKeyLabel(i);
    if (ui.key.textContent !== keyText) ui.key.textContent = keyText;
    if (!slot.kind) {
      ui.cell.className = `dslot p${i} item empty${padCls}`;
      ui.setKind(null);
      ui.num.textContent = '';
      ui.frame.style.setProperty('--fill', '0%');
      return;
    }
    // 다 썼거나 지금 마셔 봐야 소용없는 칸은 흐리게 — 급할 때 눈이 안 간다
    const dim = slot.count <= 0 || !slot.useful;
    const drinking = channel?.index === i;
    ui.cell.className = `dslot p${i} item ${dim ? 'spent' : 'ready'}${drinking ? ' drinking' : ''}${padCls}`;
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
    if ((door.opened && !door.closing) || door.slide <= 0) continue; // 닫히는 중은 되밀리는 그림을 그린다
    stage.setDoorSwing(
      door.row,
      door.col,
      (door.prevSlide + (door.slide - door.prevSlide) * alpha) * (door.swingDir ?? 1),
    );
  }

  const p = world.player;
  // 진탕(concussion, B2-4) — 화면 기울기(Stage 카메라 롤)·예고음 외 오디오 덕킹은 카운터를 매 프레임 읽어 세운다.
  // 부활·층 이동이 이벤트 없이 지워도(Status.clearAll) 저절로 꺼진다
  const concussed = (p.concussionTicks ?? 0) > 0 && !world.dead;
  stage.cameraTiltDeg = concussed ? balance.status.concussion.tiltDeg : 0;
  audio.setDuckDb(concussed ? balance.status.concussion.duckDb : 0);
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
  stage.syncPools(world.pools, performance.now()); // 진액 웅덩이(거수 P2+, B3-2)
  stage.syncGhoulHeads(world.ghoulHeads);
  stage.syncProjectiles(world.projectiles, alpha);
  // 바라보는 것(주머니 또는 바닥 소모품)이 밝아지고, 선 끝 키캡은 지금 장치의 상호작용 키를 보여 준다
  stage.syncGroundItems(
    world.groundItems,
    world.lootInView?.kind === 'pouch' ? world.lootInView.id : world.itemInView?.id,
    keyLabel('interact', 'interact'),
    input.usingPad, // 패드는 원형 버튼 글리프
    Loot.groundItemName, // 키캡 옆 한글 이름 판 — "저건 B 로 집는 체력 물약"
  );
  stage.syncLifeMotes(world.lifeMotes);
  stage.syncBarrels(world.barrels);
  stage.syncProps(world.props);
  stage.syncNpcs(world.npcs, performance.now(), world.npcInView?.id ?? null, world.player);
  stage.syncTraps(world.traps, world.level.cellSize);
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
    doorFrac: Math.max(Door.channelFrac(world), Pickups.graveChannelFrac(world)), // 비석 회수도 같은 손 뻗기
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
  compass.update(world, hitMarks); // 위협·목표의 방향 — 조준선 바로 위
  menuUI.update(); // 메뉴 창 — 헤더 상태·맵 탭 다시 그리기
  flushRegenNumber(performance.now()); // 음식 지속 회복 +N (1초 묶음)

  stage.setLockOn(world.lockOnId); // 락온 마름모 — 잡힌 적 머리 위
  // 조준(LT) 연출 — 십자선 + 부드러운 FOV 줌 (누르고 있다는 게 몸에 온다)
  const aiming = input.usingPad && world.input.padAiming && !world.dead && !world.uiOpen;
  // 십자선(네 선)은 패드·키보드가 같다: 패드 조준(LT) 중, 활을 꺼내 들었을 때, 총을 쏜 뒤 afterShotMs 동안 (2026-09-04 사용자 — 패드 기준 통일).
  // 활 당김 흔들림·권총 연사 열이 클수록 선이 벌어진다(정확도 표시)
  const ch = balance.hud.crosshair;
  const bowOut = world.weapon.ranged === 'bow' && !world.dead && !world.uiOpen;
  const recentlyShot = performance.now() - lastShotMs < ch.afterShotMs && !world.dead && !world.uiOpen;
  crosshairEl.classList.toggle('aim', aiming || bowOut || recentlyShot);
  const swayFrac = bowOut ? Math.min(1, (p.aimSwayAmp ?? 0) / ((balance.weapons.bow.sway.ampMaxDeg * Math.PI) / 180)) : 0;
  const heatFrac = world.weapon.ranged === 'pistol' ? Math.min(1, (world.weapon.recoilHeat ?? 0) / balance.weapons.pistol.recoil.heatMax) : 0;
  crosshairEl.style.setProperty('--ch-gap', `${ch.gapPx + ch.swayGapPx * Math.max(swayFrac, heatFrac)}px`);
  // 활 당김 확대 — 당긴 시간만큼 아주 조금 다가간다 (상한 1). 놓으면 bowDrawTotal 이 0 이 되어 스르르 돌아온다
  const bowZoom = balance.weapons.bow.zoom;
  const bowZoomTarget =
    world.weapon.ranged === 'bow' && !world.dead && !world.uiOpen
      ? Math.min(1, (world.weapon.bowDrawTotal ?? 0) / bowZoom.rampTicks)
      : 0;
  stage.setAimZoom(
    aiming, balance.input.gamepad.ads.fovScale, balance.input.gamepad.ads.zoomLerp,
    bowZoomTarget, bowZoom.fovScale, bowZoom.lerp,
  );

  // 패드 에임 어시스트 표적 표시 — 물고 있으면 조준점이 커지고 붉어진다.
  // 어시스트 자체는 스틱을 젓는 동안만 끌지만, 표시는 표적 위면 항상 — "걸리고 있다"의 증거
  crosshairEl.classList.toggle(
    'lock',
    input.usingPad &&
      world.input.padAiming &&
      !world.dead &&
      !world.uiOpen &&
      assistStrength(world) > 0.05 && // 오래 당겨 어시스트가 사라졌으면 물었다는 표시도 끈다
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
  // 불타는 중엔 주황, 중독 중엔 병든 녹색으로 물든다 (저체력 경고색보다 우선하지 않는다)
  const burning = (p.dots?.burn?.ticks ?? 0) > 0;
  const poisoned = (p.dots?.poison?.ticks ?? 0) > 0;
  hpFill.style.background =
    hpFrac <= 0.25 ? '#ff4838' : burning ? '#e0762a' : poisoned ? '#6f9a3a' : '#c22e2e';
  // 바 안 숫자 — '남은 양 / 최대치'. 바뀔 때만 써서 리플로우를 아낀다
  const hpText = `${Math.ceil(Math.max(0, p.health))} / ${balance.player.healthMax}`;
  const hpNum = document.getElementById('status-hp-num')!;
  if (hpNum.textContent !== hpText) hpNum.textContent = hpText;
  // 마나 — 중앙 오른쪽. 연쇄 중에는 밝게
  const manaFrac = Math.max(0, Math.min(1, world.mana.value / balance.mana.max));
  const manaFill = document.getElementById('status-mana-fill')!;
  manaFill.style.width = `${manaFrac * 100}%`;
  manaFill.style.background = world.mana.chainIndex > 0 ? '#7fc4ff' : '#4a9eff';
  const manaText = `${Math.floor(Math.max(0, world.mana.value))} / ${balance.mana.max}`;
  const manaNum = document.getElementById('status-mana-num')!;
  if (manaNum.textContent !== manaText) manaNum.textContent = manaText;
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
  // 독·화염 디버프 — 남은 시간 부채꼴 + 남은 초 (오른쪽 정렬 묶음). 도트 소리는 *_tick 이 따로 낸다
  syncDotIcon(buffPoisonEl, buffPoisonCd, buffPoisonSec, p.dots?.poison);
  syncDotIcon(buffBurnEl, buffBurnCd, buffBurnSec, p.dots?.burn);
  // 팔 저림·진탕(B2-4) — 같은 틀. 카운터는 Status.ts 가 줄인다
  syncDotIcon(buffNumbEl, buffNumbCd, buffNumbSec, statusIconArg(p.numbArmTicks, balance.status.numbArm.ticks));
  syncDotIcon(buffConcussionEl, buffConcussionCd, buffConcussionSec, statusIconArg(p.concussionTicks, balance.status.concussion.ticks));
  syncDotIcon(buffHobbleEl, buffHobbleCd, buffHobbleSec, statusIconArg(p.hobbleTicks, balance.status.hobble.ticks)); // 절뚝(B3-1)
  // 오염 진액(B3-2) — 웅덩이 위에선 매 틱 lingerTicks 로 되살아나 부채꼴이 꽉 찬 채, 나오면 30틱에 걸쳐 줄어든다
  syncDotIcon(buffCorrosiveEl, buffCorrosiveCd, buffCorrosiveSec, statusIconArg(p.corrosiveTicks, balance.status.corrosive.lingerTicks));
  syncDotIcon(buffCowedEl, buffCowedCd, buffCowedSec, statusIconArg(p.cowedTicks, balance.status.cowed.ticks)); // 위압(B3-4)
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
  const nearLoot = world.lootInView !== null && !world.dead && !world.uiOpen;
  const nearItem = world.itemInView !== null && !world.dead && !world.uiOpen;
  const nearGrave = world.graveInView !== null && !world.dead && !world.uiOpen;
  const nearNpc = world.npcInView !== null && !world.dead && !world.uiOpen;
  altarPrompt!.classList.toggle(
    'visible',
    showAltarPrompt || nearDoor || nearLever || onExit || onEntrance || nearChest || nearLoot || nearItem || nearGrave || nearNpc,
  );
  // 상호작용 키 표기 — 전용 키만 상호작용이다 (키보드는 현재 바인딩, 패드는 상호작용 버튼)
  const IK = keyLabel('interact', 'interact');
  // 중앙 키캡 — 이번 프레임에 보여 줄 키 (null = 숨김). 문 같은 단순 대상 전용
  let centerKeycap: string | null = null;
  let keycapWithPrompt = false; // 키캡과 하단 설명을 함께 (주머니·바닥 아이템)
  // 사망 화면 힌트 — 죽은 뒤에 패드를 집거나 내려놔도 표기가 따라온다
  if (showAltarPrompt && world.lobby) {
    altarPrompt!.textContent =
      `대제단 — ${IK} 활성화한 제단으로 워프  (${world.altars.length}곳)\n` +
      `지하에서 진입한 제단 자리로 곧장 간다 · 그 층의 몬스터는 전부 되살아난다`;
  } else if (showAltarPrompt) {
    altarPrompt!.textContent =
      `제단 — ${IK} 보급 상점\n` +
      `◆ ${world.gold} 소지 · 체력·마나·탄약·수류탄·배터리를 산다 (무료 보급 없음)\n` +
      `오염 ${world.corruption.pending >= 0 ? '+' : ''}${world.corruption.pending} 정산 · 이 제단을 활성화 (로비 대제단에서 여기로 워프)`;
  } else if (nearNpc) {
    const npc = world.npcInView!;
    altarPrompt!.textContent =
      npc.kind === 'priest'
        ? `${IK} — 성직자 사제와 이야기한다  (축복 · 퀘스트)`
        : `${IK} — 상인과 거래한다  (◆ ${world.gold} 소지 · 사고팔기)`;
    centerKeycap = IK;
    keycapWithPrompt = true;
  } else if (nearChest) {
    altarPrompt!.textContent = `${IK} — ${world.chestInView!.opened ? '보물상자를 뒤진다' : '보물상자를 연다'}`;
  } else if (nearLoot) {
    // 주머니·바닥 아이템은 중앙 키캡 + 하단 설명 둘 다 — 바닥의 작은 물건은 키캡이 "지금 눌러라"를 바로 보여 준다
    altarPrompt!.textContent = `${IK} — ${Loot.titleOf(world, world.lootInView!)}를 뒤진다`;
    centerKeycap = IK;
    keycapWithPrompt = true;
  } else if (nearGrave) {
    // 비석 — 문 자물쇠와 같은 채널. 진행 게이지를 프롬프트 안에 그린다 (2026-09-07 사용자)
    const frac = Pickups.graveChannelFrac(world);
    if (frac > 0) {
      altarPrompt!.textContent = `유품을 거두는 중\n${'█'.repeat(Math.round(frac * 20)).padEnd(20, '░')}  ${Math.round(frac * 100)}%`;
    } else {
      altarPrompt!.textContent = `${IK} — 비석의 유품을 거둔다 (곁에 서서 기다린다)`;
      centerKeycap = IK;
      keycapWithPrompt = true;
    }
  } else if (nearItem) {
    altarPrompt!.textContent = `${IK} — ${itemDef(world.itemInView!.kind).name} 줍기`;
    centerKeycap = IK;
    keycapWithPrompt = true;
  } else if (nearLever) {
    const leverDef = world.level.levers.find(
      (l) => l.cell[0] === world.leverInView!.row && l.cell[1] === world.leverInView!.col,
    );
    altarPrompt!.textContent = leverDef?.resets
      ? `${IK} — 레버를 당긴다 (터진 포자 식물을 다시 심는다)`
      : `${IK} — 레버를 당긴다 (보스 아레나 북쪽 관문이 열린다)`;
  } else if (nearDoor) {
    // 진행 게이지를 프롬프트 안에 그려 준다 — 손 동작만으로는 얼마나 남았는지 모른다
    const frac = Door.channelFrac(world);
    if (world.doorInView!.byLever && !world.doorInView!.unlockedOnce) {
      altarPrompt!.textContent = '관문 — 손으로는 안 열린다. 어딘가의 레버를 찾아야 한다';
    } else if (frac > 0) {
      altarPrompt!.textContent = `잠금을 푸는 중\n${'█'.repeat(Math.round(frac * 20)).padEnd(20, '░')}  ${Math.round(frac * 100)}%`;
    } else {
      // 단순한 문은 중앙 키캡 하나로 — 긴 설명은 소음이다 (사용자 지시)
      centerKeycap = IK;
    }
  } else if (onExit) {
    // 마지막 층에서만 "나간다" 다 — 그 앞은 아래층으로 내려가는 계단이다. 로비 현관 계단은 지하 1층으로
    const lobbyStairs = floorIndex === LOBBY;
    const last = !lobbyStairs && floorIndex + 1 >= ZONE.length;
    const stairFrac = world.stairHoldTicks / balance.stairs.holdTicks;
    altarPrompt!.textContent = world.exitNeedsKey
      ? '붉은 쇠창살이 내려와 있다 — 이 층의 주인을 잡아야 올라간다'
      : stairFrac > 0
        ? `${last ? '구역을 벗어나는 중' : '내려가는 중'}\n${'█'.repeat(Math.round(stairFrac * 20)).padEnd(20, '░')}  ${Math.round(stairFrac * 100)}%`
        : last
          ? `${IK} 길게 — 구역을 벗어난다`
          : lobbyStairs
            ? `${IK} 길게 — 지하 1층으로 내려간다`
            : `${IK} 길게 — 아래층으로 내려간다  (${floorIndex + 2}/${ZONE.length})`;
  } else if (onEntrance) {
    const stairFrac = world.stairHoldTicks / balance.stairs.holdTicks;
    altarPrompt!.textContent =
      stairFrac > 0
        ? `올라가는 중\n${'█'.repeat(Math.round(stairFrac * 20)).padEnd(20, '░')}  ${Math.round(stairFrac * 100)}%`
        : floorIndex === 0
          ? `${IK} 길게 — 성소 로비로 올라간다`
          : `${IK} 길게 — 위층으로 올라간다  (${floorIndex}/${ZONE.length})`;
  }
  if (centerKeycap !== null) {
    interactKeyEl!.textContent = centerKeycap;
    interactKeyEl!.classList.toggle('pad', input.usingPad); // 패드는 원형 버튼, 키보드는 사각 키캡
    if (!keycapWithPrompt) altarPrompt!.classList.remove('visible'); // 문은 하단 안내 대신 중앙 키캡만
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
    // 페이즈명(거수, B2-6 — "낫뿔 거수 — 오염 갑각"): 게임플레이 페이즈(enemy.phase)를 따른다 — 칸이 비어도 전환(포효)까지는 이전 이름
    const phaseName = resolvePhase(def, boss.phase)?.name;
    bossLine = `${def.name ?? '보스'}${phaseName ? ` — ${phaseName}` : ''}${stage2} ${bar} ${Math.max(0, Math.round(boss.health))}/${def.health}${streak}\n`;
  }
  // HP·마나·랜턴은 하단 게이지가 이미 보여 준다 — 위에서 숫자로 겹쳐 읽지 않는다.
  // 연쇄 배율만은 어디에도 안 나오므로 spell 줄로 옮겨 살려 둔다
  const mana = world.mana;
  const chainMult = balance.chain.multipliers[Math.min(mana.chainIndex, balance.chain.multipliers.length - 1)]!;
  const hudText =
    `tick ${world.tick}  (${measuredTps.toFixed(1)}/s)\n` +
    // 좌표 — 월드(m)와 격자 칸 [행,열]. 칸 표기는 레벨 JSON entities/torches 와 같은 규약이라
    // "이 자리 이상해" 를 그대로 데이터 좌표로 옮길 수 있다
    `위치 ${floorLabel(floorIndex)}  (${p.x.toFixed(1)}, ${p.z.toFixed(1)})  칸 [${Math.floor(p.z / level.cellSize)},${Math.floor(p.x / level.cellSize)}]\n` +
    `9mm ${w.mag}/${w.reserve}${w.reloading > 0 ? '  [장전중]' : ''}${p.stunTicks > 0 ? '  [경직]' : ''}${p.blocking ? '  [방어]' : ''}\n` +
    `spell ${spellHudText()}   스킬 ${world.sigils.inventory.length}개   chain ×${chainMult}\n` +
    `corruption ${world.corruption.applied}${world.corruption.pending !== 0 ? ` (${world.corruption.pending > 0 ? '+' : ''}${world.corruption.pending} 대기)` : ''}/100${world.canReadGlyphs ? '  [해독]' : ''}\n` +
    bossLine +
    `enemies ${aliveCount}${reactionLabel ? `   ${reactionLabel}` : ''}${world.godMode ? '   [무적]' : ''}${world.skillTestMode ? '   [스킬 테스트]' : ''}\n` +
    (input.pointerLocked ? '' : '[클릭] 마우스 잠금\n') +
    (input.usingPad
      ? `좌스틱 이동  R스틱 시선  ${padBtn('sprint')} 질주  ${padBtn('dodge')} 회피  ${padBtn('ranged')} 조준+${padBtn('melee')} 발사(${padBtn('cycleWeapon')} 무기 교체)  ${padBtn('melee')} 근접·처형  ${padBtn('interact')} 상호작용  ${padBtn('reaction')} 짧게=패링·꾹=방어\n` +
        `${padBtn('skillSelect')}+${padBtn('skill1')}·${padBtn('skill2')}·${padBtn('skill3')}·${padBtn('skill4')} 스킬  ${padBtn('itemSelect')}+D-패드 소모품  ${padBtn('inventory')} 가방→스킬  ${padBtn('reload')} 장전(활=시위 내림)  ${padBtn('lantern')} 랜턴(길게=배터리)  ${padBtn('pause')} 일시정지·키 설정`
      : 'WASD 이동  Space 질주(연타=회피)  좌클릭 원거리(휠 교체)  우클릭 근접·처형  E 상호작용  Shift 짧게=패링·꾹=방어\n' +
        'Z·X·C·V 스킬  Q 스킬 교체·휠클릭 사용  1~5 소모품  Tab·I 가방  R 장전(활=시위 내림)  F 랜턴  B 배터리  F1 지표  F2 덤프  F3 다시하기  P/O/K/G/U 테스트(U=스킬 전부)');

  // 보스 줄만 색을 입힌다 — 나머지는 그대로 텍스트로 두고 필요할 때만 innerHTML 을 쓴다.
  // (HUD 문자열에는 <>& 가 들어가지 않으므로 이스케이프가 필요 없다)
  // 미니맵을 끄면 왼쪽 위 안내 글도 함께 숨긴다 — 화면을 비우고 싶을 때 (일시정지 메뉴 7번)
  hud!.style.display = minimap.visible ? '' : 'none';
  // 패드로 노는 중엔 OS 커서를 숨긴다 — 루팅·가방·일시정지가 포인터락을 풀어도 화살표가 안 뜨게.
  // 마우스를 움직이거나 클릭하면 Input 이 장치를 kb 로 돌려 곧바로 다시 보인다 (일시정지 중에도 render 는 돈다)
  document.documentElement.classList.toggle('padcursor', input.usingPad);
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
  input.notePadInput(); // 일시정지 중에도 패드를 만지면 즉시 패드 표기로 (키보드로 멈췄다가 패드를 집는 경우)
  updatePauseNotice();
  if (!pad.connected) return;
  if (pad.touched) audio.unlock(); // 패드를 만졌다 — 멈춰 있던 소리도 함께 깨워 본다
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
  else if (pad.rawPressed(14)) pauseMenu.padMoveH(-1); // D-패드 ← — 메뉴 열
  else if (pad.rawPressed(15)) pauseMenu.padMoveH(1); // D-패드 → — 맵 목록
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
  restart: () => reloadClean(),
  // 세이브/로드 (2026-09-07 사용자) — 수동 저장은 메뉴에 남아 안내 줄로 결과를 알리고, 불러오기는 목록 창을 연다
  save: () => {
    if (!canSaveHere()) return '시험방에서는 저장할 수 없다 — 진행 층이나 성소 로비에서';
    const data = saveGame('manual');
    if (!data) return '저장 실패 — 브라우저 저장 공간을 쓸 수 없다';
    // 화면에 '저장되었습니다' — 불러오기 목록의 이름 그대로 (2026-09-07 사용자). 정지 오버레이가 덮고 있으니 게임으로 돌아가며 띄운다
    setPaused(false);
    input.requestLock();
    showReaction(`저장되었습니다 — ${Save.displayName(data)}`, 3200);
    return `수동 저장 완료 — ${Save.displayName(data)}`;
  },
  load: () => showSaveDialog(),
  saveSummary: () => {
    const n = SaveStorage.listSaves().length;
    const last = lastSaveKind ? `마지막 ${Save.kindLabel(lastSaveKind)} 저장 ${Math.round((performance.now() - lastSaveAt) / 1000)}초 전 · ` : '';
    return `${last}저장 ${n}개 · 층 이동·제단 활성화 때 자동 저장, 여기서는 테스트용 수동 저장`;
  },
  openBindings: (mode) => {
    // 일시정지는 유지한 채 설정 화면만 덮는다 — 닫으면 다시 메뉴로 돌아온다
    pauseMenu.hide();
    gamepadUI.show(mode);
  },
  // 미니맵 — 키(M)가 아니라 일시정지 메뉴에서만 켜고 끈다. 꺼지면 왼쪽 위 안내 글도 함께 (render 가 본다)
  toggleMinimap: () => minimap.toggle(),
  minimapOn: () => minimap.visible,
  // 맵 목록 워프 (2026-09-07 사용자) — 층은 입구로, 시험방은 각자의 진입 함수로 (시험방 메뉴 항목은 목록으로 통합)
  warp: (id) => {
    if (id === 'trap') {
      enterTrapRoom();
    } else if (id === 'lobby') {
      world.dead = false;
      loadFloor(LOBBY);
      showReaction('성소 로비로 워프했다', 2000);
    } else if (id === 'monster') {
      enterMonsterRoom();
      setPaused(false);
      menuUI.show('summon');
      return;
    } else {
      const idx = Number.parseInt(id.slice(1), 10);
      if (Number.isFinite(idx) && idx >= 0 && idx < ZONE.length && idx !== floorIndex) {
        world.dead = false;
        loadFloor(idx);
        showReaction(`${minimap.floorTitleText}로 워프했다`, 2000);
      }
    }
    setPaused(false);
    input.requestLock();
  },
},
// 패드가 연결돼 있으면 메뉴 오른쪽에 현재 매핑 다이어그램을 함께 띄운다
() => (input.gamepad.connected ? padDiagramSvg((a) => input.gamepad.binding(a), -1) : null),
// 맵 목록 — 층 넷 + 시험방 둘. 지금 있는 곳을 표시한다
() => [
  { id: 'lobby', label: '성소 로비', sub: '부활 마법진 · 대제단(워프) · 사제 · 상인', current: floorIndex === LOBBY },
  ...ZONE.map((z, i) => ({
    id: `f${i}`,
    label: `지하 ${i + 1}층`,
    sub: ((z as { name?: string }).name ?? '').split(' - ')[1] ?? '',
    current: floorIndex === i,
  })),
  { id: 'trap', label: '트랩 시험방', sub: '함정 8종', current: floorIndex === TRAP_ROOM },
  { id: 'monster', label: '몬스터 시험방', sub: '소환 탭에서 몬스터를 놓는다', current: floorIndex === MONSTER_ROOM },
]);

/** 창 포커스 상실(알트탭·다른 창·탭 숨김)로 멈췄는가 — 돌아온 뒤 안내와 재개 규칙이 다르다 */
let pausedByFocusLoss = false;
function setPaused(paused: boolean): void {
  if (!paused) pausedByFocusLoss = false;
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
// ---- 창을 벗어났다 돌아오기 ----
// 브라우저 규칙: 포커스를 잃었다 되찾으면 페이지가 새 제스처(클릭·키)를 받기 전까지 게임패드 노출과 오디오 재개가
// 막힐 수 있다(핑거프린팅·자동재생 정책). 없앨 수는 없으니 ① 어떤 계기에서든 소리 재개를 시도하고
// ② 한 번의 제스처(아무 키·클릭)로 재개·패드·소리가 다 살아나게 하며 ③ 메뉴에 이유를 적어 둔다 (2026-09-04)
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (world.uiOpen) return; // 창(루팅·상점·가방)이 열려 있으면 이미 시간이 멈춰 있다 — 멈추면 패드 폴링까지 끊겨 창이 굳는다
    if (!loop.isPaused) pausedByFocusLoss = true;
    setPaused(true);
  } else {
    onFocusRegained();
  }
});
window.addEventListener('blur', () => {
  // 창이 열려 있으면 멈추지 않는다 — uiOpen 이 곧 시간 정지다. 멈추면 루팅 창의 패드 폴링(simulate)이 끊겨
  // 돌아온 뒤 패드로 아무것도 못 하는 채 굳는다 (2026-09-04 사용자 보고)
  if (world.uiOpen) return;
  if (!loop.isPaused) pausedByFocusLoss = true;
  setPaused(true);
});
window.addEventListener('focus', onFocusRegained);
function onFocusRegained(): void {
  audio.unlock(); // 제스처 없이도 되살아나는 브라우저에선 여기서 곧바로 돌아온다
  input.gamepad.resetEdges(); // 사이에 멈춰 있던 버튼 상태가 유령 엣지가 되지 않게
}
// 아무 키·클릭 = 제스처. 소리를 깨우고, 패드 사용자가 창 전환으로 멈춘 상태라면 메뉴를 거치지 않고 바로 재개한다
// (Esc 한 번 → 다시 클릭 한 번의 두 단계를 한 단계로)
window.addEventListener(
  'keydown',
  (e) => {
    audio.unlock();
    if (
      e.code !== 'Escape' && // Esc 는 메뉴가 '계속'으로 처리한다
      pausedByFocusLoss && loop.isPaused && pauseMenu.open && !gamepadUI.open && input.lastDevice === 'pad'
    ) {
      setPaused(false);
    }
  },
  { capture: true },
);
window.addEventListener('pointerdown', () => audio.unlock(), { capture: true });
/** 일시정지 메뉴 안내 — 창 전환 뒤 패드·소리가 잠든 이유. 매 프레임(pollPadWhilePaused) 갱신 */
function updatePauseNotice(): void {
  if (!pauseMenu.open) return;
  let text: string | null = null;
  if (pausedByFocusLoss && input.lastDevice === 'pad') {
    text = input.gamepad.connected
      ? '창을 벗어났다 돌아왔다 — 패드가 반응하지 않으면 화면을 한 번 클릭하거나 아무 키를 누른다 (브라우저 규칙). 그 한 번으로 게임·패드·소리가 함께 돌아온다'
      : '창을 벗어난 사이 브라우저가 패드를 감췄다 — 화면을 한 번 클릭하거나 아무 키를 누르면 게임·패드·소리가 함께 돌아온다';
  } else if (audio.created && !audio.running) {
    text = '소리가 멈춰 있다 — 화면을 클릭하거나 아무 키를 누르면 다시 켜진다 (브라우저 규칙)';
  }
  pauseMenu.setNotice(text);
}
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
  (window as unknown as Record<string, unknown>).__save = { save: saveGame, load: loadGame, list: SaveStorage.listSaves, dialog: showSaveDialog, loadFloor, pause: () => setPaused(true) }; // 세이브/로드 검증용 (pause: 헤드리스엔 포인터 락이 없어 ESC 로 못 연다)
  (window as unknown as Record<string, unknown>).__input = input;
  (window as unknown as Record<string, unknown>).__stage = stage; // 씬 그래프 검증용
  (window as unknown as Record<string, unknown>).__audio = audio; // 소리 재생 호출 추적용(헤드리스)
  (window as unknown as Record<string, unknown>).__lootUI = lootUI; // 루팅 창 패드 경로 검증용
  (window as unknown as Record<string, unknown>).__summonUI = summonUI; // 몬스터 시험방 소환 탭 검증용
  (window as unknown as Record<string, unknown>).__equipment = Equipment; // 장비 검증용
  (window as unknown as Record<string, unknown>).__compass = compass;
  (window as unknown as Record<string, unknown>).__menuUI = menuUI;
  (window as unknown as Record<string, unknown>).__skillUI = skillUI;
  (window as unknown as Record<string, unknown>).__loadFloor = loadFloor; // 층 이동 검증용(헤드리스)
  (window as unknown as Record<string, unknown>).__setPaused = setPaused; // 일시정지 메뉴(맵 목록 워프) 검증용 — 헤드리스엔 포인터 락이 없다
  (window as unknown as Record<string, unknown>).__pauseMenu = pauseMenu;
  (window as unknown as Record<string, unknown>).__deathMenu = deathMenu; // 사망 메뉴 검증용
  (window as unknown as Record<string, unknown>).__warpDialog = warpDialog; // 로비 대제단 워프 목록 검증용
  (window as unknown as Record<string, unknown>).__npcDialog = npcDialog;
  (window as unknown as Record<string, unknown>).__merchantUI = merchantUI; // 상인 창(팔기·사기·퀘스트) 검증용
  (window as unknown as Record<string, unknown>).__LOBBY = LOBBY;
}
// 게임은 성소 로비에서 시작한다 (2026-09-07 사용자). 지하 1층은 로비 남쪽 현관 계단으로 내려간다.
// 지하 1층 상태는 여기서 얼려 두었다가 내려갈 때 그대로 되살린다. ?b1 이면 예전처럼 지하 1층 입구에서 시작 (테스트 편의)
if (!new URLSearchParams(location.search).has('b1')) {
  suppressAutosave = true; // 첫 로드는 저장하지 않는다 — 빈 게임으로 목록을 채우지 않게
  loadFloor(LOBBY);
  suppressAutosave = false;
}
{
  const n = SaveStorage.listSaves().length;
  if (n > 0) afterMs(1200, () => showReaction(`저장된 게임 ${n}개 — ESC 정지 메뉴 → 불러오기 로 이어할 수 있다`, 4000));
}

// ?skills — 시작부터 구현된 스킬을 전부 갖는다 (테스트 편의, U 키와 같다)
if (new URLSearchParams(location.search).has('skills')) {
  const n = grantAllSkills();
  showReaction(`(테스트 ?skills) 구현된 스킬 ${n}종 지급 + 마나 무한`, 3000);
}
// ?f4 — 시작부터 지하 4층 「무저갱 우리」(거수 결투 층 검증, B3-5). 시험방처럼 스킬·탄을 채워 준다 — 앞 층 상태는 없다(처음부터 시작으로 나간다)
if (new URLSearchParams(location.search).has('f4')) {
  loadFloor(ZONE.length - 1);
  grantAllSkills();
  world.weapon.grenades = balance.weapons.grenade.ammoMax;
  world.weapon.arrows = balance.weapons.bow.ammoMax;
  world.weapon.reserve = balance.weapons.pistol.ammoMax;
  world.player.health = balance.player.healthMax;
  showReaction('(테스트 ?f4) 지하 4층 무저갱 우리 — 스킬·탄 전부 지급', 3000);
}
// ?traproom — 시작부터 트랩 시험방 (일시정지 메뉴와 같은 곳)
if (new URLSearchParams(location.search).has('traproom')) enterTrapRoom();
if (new URLSearchParams(location.search).has('monsterroom')) {
  enterMonsterRoom();
  menuUI.show('summon');
}

loop.start();
events.emit('loop_started', { tickRate: balance.loop.tickRate, level: levelJson.id });
