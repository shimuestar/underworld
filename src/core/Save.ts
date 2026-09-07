// 세이브/로드 — 진행 상태를 JSON 으로 적고 되돌린다 (2026-09-07 사용자: 체크포인트 자동 저장 + 테스트용 수동 저장, 여러 개 중 골라 이어하기).
// 스냅샷이 아니라 '재현 레시피' 다. 층은 레벨 JSON 에서 다시 짓고(level/Spawner) 원본과의 차이(FloorDiff)만 적는다 —
// main 의 FloorState.level 과 ArenaState.level 은 BVH·차단 블록을 가진 살아 있는 객체라 그대로 직렬화할 수 없다.
// 살아 있던 적·보스는 배치 자리에서 만피로 돌아온다(사용자 결정). 투사체·웅덩이·상태이상 틱·생명 입자는 적지 않는다.
// 이 파일은 순수 함수만 둔다(Vitest). localStorage 는 core/SaveStorage, 저장 시점·UI 는 main 이 맡는다.

import { balance } from './Balance';
import type { EquipSlot } from './EquipData';
import type { Level } from '../level/GridLoader';
import type {
  BarrelState,
  ChestState,
  DoorState,
  EnemyState,
  GroundItemState,
  InventorySlot,
  ItemKind,
  LootEntry,
  PropState,
  SigilState,
  TrapState,
  World,
} from './World';

/** 한 층의 원본(레벨 JSON 스폰)과의 차이 — 불러올 때 새로 지은 층에 덧씌운다 */
export interface FloorDiff {
  /** 죽인 적 — `type@homeX,homeZ` (배치 자리로 대조; 소환수·분열체는 배치에 없으니 자연히 빠진다) */
  slain: string[];
  /** 연 상자 — 자리 키와 남은 속(부분 루팅). 안 연 상자는 적지 않는다 */
  chests: { key: string; items: LootEntry[] }[];
  /** 당긴 레버 — world.pulledLevers 의 키(`row-col`) 그대로 */
  levers: string[];
  /** 자물쇠가 부서진 문(`row,col`) — 문 자체는 닫힌 채 되돌린다(열림은 곧 저절로 닫히는 순간 상태). 레버로 푼 문도 여기 */
  doorsUnlocked: string[];
  /** 부순 폭발통·소품 — 자리 키 */
  barrelsBroken: string[];
  propsBroken: string[];
  /** 무장(armed) 상태가 아닌 함정 — 자리 키, 단계, 남은 장전, 낙석 잔해가 서 있는가 */
  traps: { key: string; phase: TrapState['phase']; charges: number; rubble: boolean }[];
  /** 바닥 아이템(주머니·비석·버린 것·각인 등) — 평범한 데이터라 그대로. 불러올 때 id 는 새 대역으로 다시 매긴다 */
  groundItems: GroundItemState[];
}

/** 층 차이를 뜰 때 필요한 것 — World 도, main 의 얼려 둔 FloorState 도 이 모양이다 */
export interface FloorLike {
  enemies: EnemyState[];
  chests: ChestState[];
  barrels: BarrelState[];
  props: PropState[];
  traps: TrapState[];
  doors: DoorState[];
  groundItems: GroundItemState[];
  pulledLevers: Set<string>;
}

export type SaveKind = 'auto' | 'manual';

export interface SaveData {
  version: number;
  /** 목록에서 고르는 열쇠 — 저장 시각 + 난수 */
  id: string;
  kind: SaveKind;
  /** epoch ms */
  savedAt: number;
  floorIndex: number;
  /** 목록에 보일 층 이름 (main 의 floorLabel) */
  floorLabel: string;
  /** 게임플레이 틱 누계 — 사망 화면의 '시간' 과 상점 재고 회복(shopReadyTick)의 기준 */
  tick: number;
  player: { x: number; z: number; yaw: number; pitch: number; health: number };
  mana: number;
  lantern: { on: boolean; battery: number; spares: number };
  weapon: { melee: World['weapon']['melee']; ranged: World['weapon']['ranged']; mag: number; reserve: number; grenades: number; arrows: number };
  gold: number;
  xp: number;
  inventory: (InventorySlot | null)[];
  quickslots: (ItemKind | null)[];
  skillSlots: (string | null)[];
  selectedSkill: number;
  equipment: Record<EquipSlot, string | null>;
  sigils: SigilState;
  corruption: { applied: number; pending: number };
  altars: { floor: number; x: number; z: number }[];
  respawn: { floor: number; x: number; z: number } | null;
  shopStock: Record<string, number>;
  shopReadyTick: Record<string, number>;
  /** main 의 진행 기록 — 봉인 해제 층, 쇠창살 상승 연출을 본 층 */
  unlockedFloors: number[];
  barsCineSeen: number[];
  /** 층 번호(문자열) → 차이 */
  floors: Record<string, FloorDiff>;
}

// ---- 키 ----
export function enemyKey(e: { type: string; homeX: number; homeZ: number }): string {
  return `${e.type}@${e.homeX},${e.homeZ}`;
}
export function posKey(o: { x: number; z: number }): string {
  return `${o.x},${o.z}`;
}
export function trapKey(t: { type: string; x: number; z: number }): string {
  return `${t.type}@${t.x},${t.z}`;
}
export function doorKey(d: { row: number; col: number }): string {
  return `${d.row},${d.col}`;
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

// ---- 층 차이 ----

/** 살아 있는 층(또는 얼려 둔 층)에서 원본과의 차이를 뜬다 */
export function captureFloorDiff(f: FloorLike): FloorDiff {
  return {
    slain: f.enemies.filter((e) => !e.alive && e.homeX !== undefined && e.homeZ !== undefined).map((e) => enemyKey(e as { type: string; homeX: number; homeZ: number })),
    chests: f.chests.filter((c) => c.opened).map((c) => ({ key: posKey(c), items: clone(c.chestItems ?? []) })),
    levers: [...f.pulledLevers],
    doorsUnlocked: f.doors.filter((d) => d.unlockedOnce || (d.byLever && d.progress > 0)).map(doorKey),
    barrelsBroken: f.barrels.filter((b) => !b.alive).map(posKey),
    propsBroken: f.props.filter((p) => !p.alive).map(posKey),
    traps: f.traps
      .filter((t) => t.phase !== 'armed' || t.rubbleBroken)
      .map((t) => ({ key: trapKey(t), phase: t.phase, charges: t.charges, rubble: !!t.blocker && !t.rubbleBroken })),
    groundItems: clone(f.groundItems.map(stripGroundItem)),
  };
}

/** 바닥 아이템에서 순간 상태(날아가는 속도·자석 잠금)를 뺀다 — 불러오면 제자리에 놓인 채 시작한다 */
function stripGroundItem(g: GroundItemState): GroundItemState {
  const { speed: _s, noMagnetTicks: _n, ...rest } = g;
  return rest;
}

/** 죽은 적은 슬라임 분열체처럼 홈 좌표가 없을 수 있다 — 그런 것은 배치에도 없으니 빼도 된다 */
let nextRestoredItemId = balance.save.restoredItemIdBase;

/** 새로 지은 층(Spawner 결과가 world 에 실린 상태)에 차이를 덧씌운다. level 은 world.level 과 같은 객체여야 한다 */
export function applyFloorDiff(world: World, level: Level, diff: FloorDiff): void {
  const slain = new Set(diff.slain);
  world.enemies = world.enemies.filter((e) => !slain.has(enemyKey(e as { type: string; homeX: number; homeZ: number })));

  const chestBy = new Map(diff.chests.map((c) => [c.key, c] as const));
  for (const chest of world.chests) {
    const saved = chestBy.get(posKey(chest));
    if (!saved) continue;
    chest.opened = true;
    chest.chestItems = clone(saved.items);
  }

  const barrels = new Set(diff.barrelsBroken);
  for (const b of world.barrels) {
    if (!barrels.has(posKey(b))) continue;
    b.alive = false;
    b.fuseTicks = -1;
    if (b.blocker) { level.removeBlocker(b.blocker); b.blocker = undefined; }
  }
  const props = new Set(diff.propsBroken);
  for (const p of world.props) {
    if (!props.has(posKey(p))) continue;
    p.alive = false;
    if (p.blocker) { level.removeBlocker(p.blocker); p.blocker = undefined; }
  }

  const trapBy = new Map(diff.traps.map((t) => [t.key, t] as const));
  const trapTypes = balance.traps.types as unknown as Record<string, { rubbleHalf?: number } | undefined>;
  for (const t of world.traps) {
    const saved = trapBy.get(trapKey(t));
    if (!saved) continue;
    t.phase = saved.phase;
    t.charges = saved.charges;
    t.timer = 0;
    if (saved.rubble) {
      // 낙석이 떨어진 자리 — 잔해가 몸을 막고 길을 끊는다 (Traps.tickRockfall 과 같은 등록)
      t.blocker = level.addBlocker(t.x, t.z, trapTypes[t.type]?.rubbleHalf ?? 1.5);
      level.setPathBlocked(t.col, t.row);
    } else if (t.type === 'trap_rockfall' && saved.phase === 'spent') {
      t.rubbleBroken = true; // 떨어졌고 잔해도 치웠다
    }
  }

  const doors = new Set(diff.doorsUnlocked);
  for (const d of world.doors) if (doors.has(doorKey(d))) d.unlockedOnce = true;

  world.pulledLevers = new Set(diff.levers);

  // 바닥 아이템 — id 를 새 대역으로 (세션 카운터와 겹치면 Stage 모형 캐시·주머니 참조가 엉킨다)
  for (const g of diff.groundItems) world.groundItems.push({ ...clone(g), id: nextRestoredItemId++ });
}

// ---- 캐릭터 진행 ----

export interface SerializeExtras {
  kind: SaveKind;
  floorLabel: string;
  floors: Record<string, FloorDiff>;
  unlockedFloors: Iterable<number>;
  barsCineSeen: Iterable<number>;
  /** 테스트에서 시각을 고정할 때 */
  now?: number;
}

export function serialize(world: World, extras: SerializeExtras): SaveData {
  const now = extras.now ?? Date.now();
  const p = world.player;
  const w = world.weapon;
  return {
    version: balance.save.version,
    id: `${now.toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
    kind: extras.kind,
    savedAt: now,
    floorIndex: world.floorIndex,
    floorLabel: extras.floorLabel,
    tick: world.tick,
    player: { x: p.x, z: p.z, yaw: p.yaw, pitch: p.pitch, health: p.health },
    mana: world.mana.value,
    lantern: { on: world.lantern.on, battery: world.lantern.battery, spares: world.lantern.spares },
    weapon: { melee: w.melee, ranged: w.ranged, mag: w.mag, reserve: w.reserve, grenades: w.grenades, arrows: w.arrows ?? 0 },
    gold: world.gold,
    xp: world.xp,
    inventory: clone(world.inventory),
    quickslots: clone(world.quickslots),
    skillSlots: clone(world.skillSlots),
    selectedSkill: world.selectedSkill,
    equipment: clone(world.equipment),
    sigils: clone(world.sigils),
    corruption: { applied: world.corruption.applied, pending: world.corruption.pending },
    altars: clone(world.altars),
    respawn: world.respawn ? clone(world.respawn) : null,
    shopStock: clone(world.shopStock),
    shopReadyTick: clone(world.shopReadyTick),
    unlockedFloors: [...extras.unlockedFloors],
    barsCineSeen: [...extras.barsCineSeen],
    floors: clone(extras.floors),
  };
}

/** 캐릭터 진행을 되돌린다 — 층·자리는 건드리지 않는다(main 이 loadFloor 뒤 applyPlayerPose 로).
 *  파생 수치(modifiers)는 부르는 쪽이 Sigils.recompute 로 다시 계산한다 */
export function restoreProgress(world: World, data: SaveData): void {
  world.tick = data.tick;
  world.floorIndex = data.floorIndex;
  world.player.health = data.player.health;
  world.mana.value = data.mana;
  world.mana.chainIndex = 0;
  world.mana.outOfCombatTicks = 0;
  world.mana.inCombat = false;
  world.lantern.on = data.lantern.on;
  world.lantern.battery = data.lantern.battery;
  world.lantern.spares = data.lantern.spares;
  world.lantern.lobbyOff = undefined;
  const w = world.weapon;
  w.melee = data.weapon.melee;
  w.ranged = data.weapon.ranged;
  w.mag = data.weapon.mag;
  w.reserve = data.weapon.reserve;
  w.grenades = data.weapon.grenades;
  w.arrows = data.weapon.arrows;
  w.cooldown = 0;
  w.reloading = 0;
  w.muzzleFlash = 0;
  w.bowDraw = 0;
  world.gold = data.gold;
  world.xp = data.xp;
  world.inventory = clone(data.inventory);
  world.quickslots = clone(data.quickslots);
  world.skillSlots = clone(data.skillSlots);
  world.selectedSkill = data.selectedSkill;
  world.equipment = clone(data.equipment);
  world.sigils = clone(data.sigils);
  world.corruption.applied = data.corruption.applied;
  world.corruption.pending = data.corruption.pending;
  world.altars = clone(data.altars);
  world.respawn = data.respawn ? clone(data.respawn) : null;
  world.shopStock = clone(data.shopStock);
  world.shopReadyTick = clone(data.shopReadyTick);
  world.dead = false;
}

/** 저장한 자리·시선으로 — loadFloor 가 도착 지점에 세운 뒤에 부른다 */
export function applyPlayerPose(world: World, data: SaveData): void {
  const p = world.player;
  p.x = data.player.x;
  p.z = data.player.z;
  p.prevX = data.player.x;
  p.prevZ = data.player.z;
  p.yaw = data.player.yaw;
  p.pitch = data.player.pitch;
}

// ---- 검증·표기 ----

/** 저장 데이터인가 — 다른 버전·깨진 JSON 은 거른다(불러오기 목록에서 빼고 알린다) */
export function isSaveData(x: unknown): x is SaveData {
  if (!x || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  return (
    o['version'] === balance.save.version &&
    typeof o['id'] === 'string' &&
    (o['kind'] === 'auto' || o['kind'] === 'manual') &&
    typeof o['savedAt'] === 'number' &&
    typeof o['floorIndex'] === 'number' &&
    typeof o['tick'] === 'number' &&
    !!o['player'] && typeof (o['player'] as Record<string, unknown>)['x'] === 'number' &&
    Array.isArray(o['inventory']) &&
    Array.isArray(o['quickslots']) &&
    !!o['sigils'] && typeof o['sigils'] === 'object' &&
    !!o['floors'] && typeof o['floors'] === 'object'
  );
}

/** 틱 수 → `00:00:00` (시:분:초). 사망 화면·저장 목록이 같은 표기를 쓴다 */
export function formatPlayTime(ticks: number): string {
  const total = Math.floor(ticks / balance.loop.tickRate);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const two = (n: number) => String(n).padStart(2, '0');
  return `${two(h)}:${two(m)}:${two(s)}`;
}

export function kindLabel(kind: SaveKind): string {
  return kind === 'auto' ? '자동' : '수동';
}

/** 불러오기 목록 한 줄의 이름 — 저장 완료 문구도 이 이름을 그대로 쓴다 (2026-09-07 사용자) */
export function displayName(d: Pick<SaveData, 'kind' | 'floorLabel' | 'savedAt'>): string {
  return `${kindLabel(d.kind)} · ${d.floorLabel} · ${formatSavedAt(d.savedAt)}`;
}

/** 저장 시각 — 목록 한 줄용 `09-07 20:45` */
export function formatSavedAt(ms: number): string {
  const d = new Date(ms);
  const two = (n: number) => String(n).padStart(2, '0');
  return `${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`;
}
