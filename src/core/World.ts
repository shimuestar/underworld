// 전역 게임 상태 컨테이너. 시스템은 서로를 import 하지 않고
// 이 객체의 상태와 이벤트 버스를 통해서만 통신한다.

import type { ProjectileSplashDef } from './Entities';
import { sigilDef, type SigilSlot } from './SigilData';
import type { Events } from './Events';
import type { InputSnapshot } from './Input';
import type { Level } from '../level/GridLoader';

export interface PlayerState {
  x: number;
  y: number;
  z: number;
  /** 렌더 보간용 직전 틱 위치 */
  prevX: number;
  prevY: number;
  prevZ: number;
  /** 라디안. yaw 0 = -Z 방향 */
  yaw: number;
  pitch: number;
  health: number;
  /** 패링 실패 경직 잔여 틱. >0이면 이동/사격/반응 불가 */
  stunTicks: number;
  /** 회피 대시 잔여 틱 */
  dodgeTicks: number;
  dodgeDirX: number;
  /** 이번 대시의 거리 배율 — 옆 대시는 짧다 (dodgeSideDistanceMul). 시작 시 계산 */
  dodgeDistMul?: number;
  dodgeDirZ: number;
  /** 회피 무적 잔여 틱 */
  iframeTicks: number;
  /** 히트스톱 중 눌린 반응 입력의 버퍼 잔여 틱 */
  reactionBufferTicks: number;
  /** 질주 키를 마지막으로 누른 뒤 남은 연타 인정 틱 (0 = 창 닫힘) */
  sprintTapTicks?: number;
  /** 조금 이르게 누른 패링의 유효 잔여 틱 — 무기가 도달하면 그때 성립한다 */
  parryBufferTicks?: number;
  /** 방어 중 (Shift 홀드) — 정면 피해 경감, 이동·사격 제한 */
  blocking: boolean;
  /** Space를 누르고 있는 누적 틱 — tapThreshold 이내에 떼면 패링 */
  reactionHeldTicks: number;
  /** 피격 밀림 잔여 틱 + 틱당 밀림량 (PlayerMove가 소비) */
  kbTicks?: number;
  kbX?: number;
  kbZ?: number;
  /** 거미줄 — 벗겨내는 데 남은 겹 수. 0보다 크면 걸린 상태(느려진다).
   *  해머 한 스윙 = 한 겹, 몸부림(PlayerMove)도 겹을 찢는다 */
  webSwingsLeft?: number;
  /** 거미줄 몸부림 게이지 (0~1) — 차면 한 겹을 찢는다 (balance.web.struggle) */
  webStruggle?: number;
  /** 초음파 비명 — 남은 조준 흔들림 틱과 진폭 (박쥐 scream, PlayerMove 가 소비) */
  /** 그림자 질주(sig_shadowstep) — 남은 거리·방향·도착 무적. PlayerMove 가 소화한다 */
  blinkLeft?: number;
  blinkDirX?: number;
  blinkDirZ?: number;
  blinkTailIframes?: number;
  /** 도착 후 그림자 여운 — 이 틱 동안은 여전히 적이 못 알아본다 (0.5초 재인지 유예) */
  blinkShroudTicks?: number;
  blinkShroudAfter?: number;
  aimShakeTicks?: number;
  aimShakeAmp?: number;
  /** 반동 — 발사(Weapons)가 예약한 밀림(rad). PlayerMove 가 다음 틱 시선에 얹고 비운다 */
  recoilKickPitch?: number;
  recoilKickYaw?: number;
  /** 아직 되돌아오지 않은 반동 오프셋(rad) — 매 틱 recoilRecoverRate 비율로 줄며 시선을 제자리로 당긴다 */
  recoilPitch?: number;
  recoilYaw?: number;
  recoilRecoverRate?: number;
  /** 밀린 양 중 되돌아오는 비율 — 나머지는 남아 연사하면 조준이 기어오른다 */
  recoilRecoverFrac?: number;
  /** 지속 피해 상태(독·화염) — 종류별 하나. 걸려 있는 동안만 키가 있다 (Traps.tickDots 가 진행) */
  dots?: Partial<Record<DotKind, DotState>>;
  /** 직전 틱의 dodgeTicks — 커지는 순간이 '대시 시도' (조임 즉시 한 방) */
  webLastDodgeTicks?: number;
}

/** 지속 피해(도트) 종류 — 독(포자 구름)·화염(불붙은 기름). 이벤트는 `${kind}_applied/_tick/_ended` */
export type DotKind = 'poison' | 'burn';
export interface DotState {
  /** 남은 틱 — 원인 안에 서 있으면 매 틱 duration 으로 갱신된다 */
  ticks: number;
  /** 전체 길이(HUD 부채꼴 분모) */
  duration: number;
  /** 틱당 피해 — accum 에 쌓아 interval 마다 한 번에 깎는다 (한 번에 '윽') */
  perTick: number;
  accum: number;
  interval: number;
  /** 다음 적용까지 남은 틱 — 시간이 갱신돼도 박자는 흔들리지 않는다 */
  next: number;
}

export interface SigilState {
  /** 소지 중(효과 없음). 부착해야 발동 — economy.md §4 */
  inventory: string[];
  /** 부위에 새겨진 패시브 스킬 — 새겨야 켜진다. 액티브는 부위와 무관 (skillSlots) */
  equipped: Record<SigilSlot, string | null>;
}

/** 부착된 각인에서 매번 재계산되는 파생 수치. Sigils가 갱신한다.
 *  (2026-08: 부위 페널티 폐지 — 각인은 순수 강화이고 대가는 오염으로만 치른다) */
export interface Modifiers {
  dodgeDistanceMul: number;
  dodgeIFrameTicks: number;
  /** 암시야 — 렌더 ambient 가산 계수 */
  ambientVisionBoost: number;
  /** 함정 감지 — 이 반경(m) 안의 함정을 알아챈다. 0 = 없음 */
  revealTrapsRadius: number;
}

export interface CorruptionState {
  /** 몸에 반영된 값 (제단 정산 후) */
  applied: number;
  /** 아직 정산되지 않은 누적분 */
  pending: number;
}

export interface ProjectileState {
  id: number;
  /** player: 적 명중 판정 / enemy: 플레이어 명중 판정 */
  owner: 'player' | 'enemy';
  x: number;
  y: number;
  z: number;
  prevX: number;
  prevY: number;
  prevZ: number;
  vx: number;
  vy: number;
  vz: number;
  lifeTicks: number;
  damage: number;
  burnTicks: number;
  burnDamagePerTick: number;
  radius: number;
  /** 반사된 투사체 — 방어막을 무시한다 */
  deflected?: boolean;
  /** 시전자 (반사 시 되돌아갈 대상) */
  casterId?: number;
  /** 반응 버튼으로 반사 가능한가 (마법탄 true, 화살 false) */
  deflectable?: boolean;
  /** 렌더 형태 */
  kind?: 'fireball' | 'frost' | 'magic' | 'arrow' | 'rock' | 'grenade' | 'web';
  /** 착탄 시 광역 효과. 시전자가 죽어도 남도록 투사체가 들고 다닌다.
   *  반사되면 그대로 적에게 터진다 */
  splash?: ProjectileSplashDef;
  /** 맞은 플레이어가 거미줄에 걸린다 (큰 거미) */
  appliesWeb?: boolean;
  /** 플레이어 투사체로 공중에서 부술 수 있다 (족장이 던진 바위) */
  breakable?: boolean;
  /** 회수 가능한 내 화살 — 꽂히거나 적을 맞히면 바닥 아이템으로 남는다.
   *  적 궁수의 화살은 이 표식이 없어 렌더 잔존물로만 남는다 */
  recoverable?: boolean;
  /** 함정이 쏜 것 — 적 소유지만 동료 오사 감쇄를 받지 않고, 적을 맞히면 피해 숫자가 뜬다 */
  trapShot?: boolean;
}

export interface SpellState {
  /** (구) 전역 쿨다운 — 지금은 스킬별 cooldowns 를 쓴다 */
  cooldown: number;
  /** 스킬 id → 남은 쿨다운 틱 */
  cooldowns?: Record<string, number>;
  /** 채널 중인 스킬(관통 뇌창) — 키를 붙들고 있는 동안만 산다. pulse 는 다음 타까지 남은 틱 */
  channel?: { sigilId: string; pulse: number } | null;
}

/** 바닥에 떨어진 각인. 접근하면 획득 */
/** 보물상자 — E로 한 번 열면 골드 무더기와 각인 하나가 쏟아진다 */
/** 적을 (dirX,dirZ) 쪽으로 distance 만큼 ticks 동안 밀어낸다.
 *  밀리는 동안 적은 아무것도 못 한다 (Enemies 가 kbTicks 를 보고 멈춘다).
 *  방향을 부르는 쪽이 주는 이유: 때린 사람에게서 밀려나는 경우(처형·해머)와
 *  폭심에서 밀려나는 경우(폭발통·수류탄)가 있어 기준점이 하나가 아니다.
 *  balance 는 호출부가 읽어 넘긴다 (pushPlayer 와 같은 규약) */
export function pushEnemy(
  enemy: EnemyState,
  dirX: number,
  dirZ: number,
  distance: number,
  ticks: number,
): void {
  const len = Math.hypot(dirX, dirZ);
  if (len === 0 || ticks <= 0 || distance <= 0) return;
  enemy.kbTicks = ticks;
  enemy.kbX = (dirX / len) * (distance / ticks);
  enemy.kbZ = (dirZ / len) * (distance / ticks);
}

/** 적이 플레이어를 알아챘다 — 추격으로 넘기고 멈칫 시간을 건다.
 *  깨우는 곳이 여섯 군데(시야·랜턴·보스 포효·총소리·화염구·폭발통)라 한 군데서만
 *  멈칫을 걸면 나머지는 느낌표가 뜨자마자 달려든다. balance 는 호출부가 읽어 넘긴다
 *  (pushPlayer 와 같은 규약 — World 는 데이터에 의존하지 않는다) */
/** 서리 걸린 적이 서리가 아닌 공격을 받을 때의 피해 — 돌려주는 값이 실제로 넣을 피해다.
 *  얼어 있으면: 얼음이 그 자리에서 깨지고(enemy_freeze_ended{shattered}) 피해×hitShatterMul + 깨질 때 피해.
 *  둔화만 걸려 있으면: 1겹 ×hitMulStack1, 2겹 이상 ×hitMulStack2.
 *  적에게 피해를 주는 모든 지점이 거친다(서리 자신·화상 DoT 제외 — 화염구 한 발이면 빙결이 곧바로 풀린다) */
export function applyFrostOnHit(events: Events, enemy: EnemyState, damage: number): number {
  const fx = sigilDef('sig_frost').effects;
  if ((enemy.freezeTicks ?? 0) > 0) {
    const breakDamage = enemy.frozenDamage ?? 0;
    enemy.freezeTicks = 0;
    enemy.frozenDamage = 0;
    events.emit('enemy_freeze_ended', {
      enemyId: enemy.id, enemyType: enemy.type, x: enemy.x, z: enemy.z, shattered: true,
    });
    return damage * (fx['hitShatterMul'] ?? 1) + breakDamage;
  }
  const stacks = enemy.frostStacks ?? 0;
  if (stacks >= 1 && (enemy.slowTicks ?? 0) > 0) {
    return damage * (stacks === 1 ? (fx['hitMulStack1'] ?? 1) : (fx['hitMulStack2'] ?? 1));
  }
  return damage;
}

/** 반경 안의 구울 머리 소품을 전부 터트린다 — 폭발(수류탄·화염구·폭발통) 공용.
 *  갓 태어난 머리(graceTicks)는 제 몸을 날린 그 폭발에는 살아남는다 (총·해머와 같은 규약) */
export function breakHeadsInRadius(world: World, x: number, z: number, radius: number): void {
  const heads = world.ghoulHeads;
  if (!heads || heads.length === 0) return;
  for (const head of [...heads]) {
    if ((head.graceTicks ?? 0) > 0) continue;
    if (Math.hypot(head.x - x, head.z - z) <= radius) breakGhoulHead(world, head.id, false);
  }
}

/** 벽 법선 탐침 — 네 방위로 probe 만큼 밀어 보고 벽쪽 진행이 가장 막힌 쪽이 벽.
 *  slideMove 는 {x,z,prevX,prevZ} 만 요구하므로 대리자로 잰다. 벽거미(Enemies)와
 *  스포너(벽 매복 배치)가 함께 쓴다. 반환 법선은 벽에서 바깥쪽, 없으면 null */
export function findWallNormal(
  level: {
    slideMove(e: { x: number; z: number; prevX: number; prevZ: number }, r: number, dx: number, dz: number): void;
  },
  x: number,
  z: number,
  radius: number,
  probe: number,
  thresholdMul: number,
): { nx: number; nz: number } | null {
  let best: { nx: number; nz: number } | null = null;
  let bestMoved = probe * thresholdMul;
  for (const [dx, dz] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const) {
    const proxy = { x, z, prevX: x, prevZ: z };
    level.slideMove(proxy, radius, dx * probe, dz * probe);
    // 벽쪽 진행분만 잰다 — 미끄러져 옆으로 샌 것은 벽이 아니라 모서리다
    const moved = (proxy.x - x) * dx + (proxy.z - z) * dz;
    if (moved < bestMoved) {
      bestMoved = moved;
      best = { nx: -dx, nz: -dz };
    }
  }
  return best;
}

export function alertEnemy(enemy: EnemyState, noticeTicks: number): void {
  enemy.feigning = false; // 죽은 척은 깨는 순간 끝난다
  enemy.ai = 'chase';
  enemy.noticeTicks = noticeTicks;
}

/** 구울 머리를 부순다 — stomp 면 밟아 터트린 것 (연출은 main 이 ghoul_head_broken 으로 잇는다) */
export function breakGhoulHead(world: World, headId: number, stomp: boolean): void {
  const heads = world.ghoulHeads;
  if (!heads) return;
  const idx = heads.findIndex((h) => h.id === headId);
  if (idx < 0) return;
  const head = heads[idx]!;
  heads.splice(idx, 1);
  world.events.emit('ghoul_head_broken', { x: head.x, z: head.z, stomp });
}

/** (x,z)에서 난 소음 — 반경 안의 대기(idle) 적을 깨운다. 각도·시야선 무관 (소리다).
 *  noticeTicks 는 부르는 쪽이 준다 (World 는 데이터에 의존하지 않는다 — pushPlayer 규약) */
/** 소음 도달 필드 — 소리는 열린 칸(열린 문 포함)을 따라 흐른다. 벽·닫힌 문에 막히면
 *  돌아가야 하고, 돌아가는 경로가 예산을 넘으면 못 듣는다. 셀 단위 BFS 라 거칠지만
 *  소음 반경 자체가 개념적 값이라 충분하다. 한 번 흘려서 여러 적 판정에 재사용한다 */
export function noiseField(
  level: { cellSize: number; solidAt(col: number, row: number): boolean },
  x: number,
  z: number,
  budget: number,
): Map<number, number> {
  const cs = level.cellSize;
  const sc = Math.floor(x / cs);
  const sr = Math.floor(z / cs);
  const field = new Map<number, number>();
  field.set(sr * 4096 + sc, 0);
  const queue: [number, number, number][] = [[sc, sr, 0]];
  while (queue.length > 0) {
    const [c, r, d] = queue.shift()!;
    const nd = d + cs;
    if (nd > budget) continue;
    for (const [dc, dr] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nc = c + dc;
      const nr = r + dr;
      const key = nr * 4096 + nc;
      if (field.has(key) || level.solidAt(nc, nr)) continue;
      field.set(key, nd);
      queue.push([nc, nr, nd]);
    }
  }
  return field;
}

export function alertNearbyAt(
  world: World,
  x: number,
  z: number,
  radius: number,
  noticeTicks: number,
): void {
  // 소리는 열린 칸을 따라 흐른다 — 벽·닫힌 문이 막는다 (문이 열리면 그 길로 샌다).
  // 예산은 이 소리를 들을 수 있는 가장 밝은 귀(hearingMul 최대) 기준으로 한 번만 흘린다
  const cs = world.level.cellSize;
  let maxMul = 1;
  for (const enemy of world.enemies) {
    if (enemy.alive && (enemy.hearingMul ?? 1) > maxMul) maxMul = enemy.hearingMul ?? 1;
  }
  const field = noiseField(world.level, x, z, radius * maxMul + cs);
  for (const enemy of world.enemies) {
    if (!enemy.alive || enemy.ai !== 'idle') continue;
    // 천장 잠복(거머리)은 소리에 초연하다 — 기습이 역할이라, 밑 통과와 직접 피격만 깨운다
    if (enemy.lurking) continue;
    // 청각 배율 — 슬라임처럼 귀로 사는 적은 같은 소리를 더 멀리서 듣는다
    const r = radius * (enemy.hearingMul ?? 1);
    if (Math.hypot(enemy.x - x, enemy.z - z) > r) continue;
    const pd = field.get(Math.floor(enemy.z / cs) * 4096 + Math.floor(enemy.x / cs));
    if (pd === undefined || pd > r + cs) continue; // 막혔거나 돌아가는 길이 너무 멀다
    alertEnemy(enemy, noticeTicks);
    world.events.emit('enemy_alerted', { enemyId: enemy.id, enemyType: enemy.type, noise: true });
  }
}

/** 문 잠금을 통째로 푼다 — 레버가 부른다. 미닫이와 개방은 Door 가 이어서 돌리므로
 *  레버는 이 한 줄만 건드리면 된다. balance 는 호출부가 읽어 넘긴다
 *  (pushPlayer·spendStamina 와 같은 규약 — World 는 데이터에 의존하지 않는다) */
export function unlockDoor(door: DoorState, openTicks: number): boolean {
  if (door.opened || door.progress >= openTicks) return false;
  door.progress = openTicks;
  return true;
}

/** 잠긴 문 하나. 격자 정보(위치·미닫이 방향)는 Level.doors 에서 그대로 옮겨 온다 */
export interface DoorState {
  row: number;
  col: number;
  x: number;
  z: number;
  /** 미닫이가 밀려 들어갈 방향 (셀 단위, 둘 중 하나만 0이 아니다) */
  dirX: number;
  dirZ: number;
  /** 레버로만 열리는 관문(G)인가 — 문 앞에서 E 를 눌러도 안 열린다 */
  byLever: boolean;
  /** 잠금을 푸는 중 진행 틱. 0 이면 아무도 손대지 않은 상태 */
  progress: number;
  /** 미닫이 진행 0~1. 1 이 되는 틱에 통행이 열린다 */
  slide: number;
  /** 열리는 방향 +1/-1 — 첫 여닫이 틱에 '여는 사람 반대쪽' 으로 정해진다 (당기지 않고 민다) */
  swingDir?: number;
  /** 렌더 보간용 직전 값 */
  prevSlide: number;
  opened: boolean;
  /** 닫히는 중 — slide 가 1 → 0 으로 되밀린다. 0 이 되는 틱에 셀이 다시 벽이 된다 (opened 는 그때 false) */
  closing?: boolean;
  /** 한 번 자물쇠가 풀렸다 — 닫은 뒤 다시 열 때는 채널 없이 바로 밀린다 (부서진 자물쇠) */
  unlockedOnce?: boolean;
  /** 열려 있는 동안 세워 둔 석조 문틀 차단 — 닫힐 때 걷는다 */
  frameBlockers?: { minX: number; maxX: number; minZ: number; maxZ: number }[];
  /** 닫히는 중 몸에 걸려 멈춰 있는 연속 틱 — 주기적 알림(door_blocked) 박자 */
  blockedTicks?: number;
}

/** 기믹(파괴물) 하나 — 항아리·궤짝·뼈 무더기·석관·광차. 부수면 결과(전리품/매복/폭발
 *  심지)는 Props 시스템이 prop_broken 구독으로 굴린다 (겉보기 같아도 매번 다르다) */
export interface PropState {
  id: number;
  /** balance.props.types 의 키 — 'prop_jar' 등 */
  type: string;
  x: number;
  z: number;
  alive: boolean;
  hits: number;
  /** 폭발 당첨 심지 — 0 이 되는 틱에 Props 가 터뜨린다. -1 = 없음 */
  fuseTicks: number;
  /** 참 = 폭발 롤이 빈손이 된다 — 작은방 배치 기믹 (좁은 방 폭발은 억울하다) */
  noExplode?: boolean;
  blocker?: { minX: number; maxX: number; minZ: number; maxZ: number };
}

/** 함정 상태 머신 — armed(대기) → telegraph(예고) → firing(작동 중) → cooldown → armed.
 *  1회용은 firing 뒤 spent. disarmed = 플레이어가 해체(그물 줄 끊기 등) */
export type TrapPhase = 'armed' | 'telegraph' | 'firing' | 'cooldown' | 'spent' | 'disarmed';
export interface TrapState {
  id: number;
  /** balance.traps.types 의 키 — 'trap_dart' 등 */
  type: string;
  x: number;
  z: number;
  row: number;
  col: number;
  phase: TrapPhase;
  /** 현재 phase 의 잔여 틱 */
  timer: number;
  /** 남은 작동 횟수. -1 = 무한 */
  charges: number;
  /** 방향형 함정(다트·그물·진자·낙석)의 축. 기본 (0,-1) */
  dirX: number;
  dirZ: number;
  triggeredBy?: 'player' | 'enemy';
  /** 진자·자동 가시판 — 주기 카운터 */
  cycleTick?: number;
  /** 자동 순환 함정의 시작 위상(틱). 배치 phase 플래그 — 없으면 종별 기본 규칙 */
  phaseOffset?: number;
  /** 이번 작동에서 이미 맞은 몸 (플레이어 = -1) */
  hitIds?: number[];
  /** 함정 감지 각인이 알아챈 함정 */
  revealed?: boolean;
  /** 낙석 잔해 차단 블록 */
  blocker?: { minX: number; maxX: number; minZ: number; maxZ: number };
  /** 낙석 잔해가 폭발로 부서졌다 — spent 는 그대로(다시 안 떨어진다), 차단만 풀린 상태. 낮은 자갈 더미로 그린다 */
  rubbleBroken?: boolean;
}

/** 겹치지 않는 빈 자리 — 중심(cx,cz)에서 startAngle 방향 거리 r 부터, 각도를 좌우로 벌리고 거리를 늘려 가며
 *  다른 바닥 아이템과 spacing 이상 떨어지고 벽 칸이 아닌 첫 자리를 고른다. 다 실패하면 기본 자리.
 *  버리기(가방·컨테이너)와 주머니 낙하가 함께 쓴다 — 데이터(spacing·r)는 호출부가 준다 */
export function findFreeSpot(
  world: World,
  cx: number,
  cz: number,
  r: number,
  spacing: number,
  startAngle: number,
  skip?: (item: GroundItemState) => boolean,
): { x: number; z: number } {
  const cs = world.level.cellSize;
  const free = (x: number, z: number): boolean =>
    !world.level.solidAt(Math.floor(x / cs), Math.floor(z / cs)) &&
    world.groundItems.every(
      (g) => (skip ? skip(g) : false) || Math.hypot((g.originX ?? g.x) - x, (g.originZ ?? g.z) - z) >= spacing,
    );
  const base = { x: cx + Math.sin(startAngle) * r, z: cz + Math.cos(startAngle) * r };
  if (spacing <= 0 || free(base.x, base.z)) return base;
  const offsets = [0, 0.4, -0.4, 0.8, -0.8, 1.2, -1.2, 1.6, -1.6, 2.0, -2.0, 2.4, -2.4, Math.PI];
  for (const mul of [1, 1.5, 2, 2.6]) {
    for (const off of offsets) {
      const x = cx + Math.sin(startAngle + off) * r * mul;
      const z = cz + Math.cos(startAngle + off) * r * mul;
      if (free(x, z)) return { x, z };
    }
  }
  return base;
}

/** 전리품 낙하점 — 플레이어 '반대쪽' 호(±arcDeg/2)로만 떨어진다. 죽인·부순·연 자리에서
 *  내 입으로 직행하면 뭘 먹었는지 모른다 — 확인하고 줍는 그림을 만든다 (2026-08-30 공통 규칙) */
export function scatterAwayFromPlayer(
  world: World,
  x: number,
  z: number,
  r: number,
  arcDeg: number,
): { x: number; z: number } {
  const p = world.player;
  const adx = x - p.x;
  const adz = z - p.z;
  const away = Math.hypot(adx, adz) > 0.001 ? Math.atan2(adx, adz) : Math.random() * Math.PI * 2;
  const half = ((arcDeg / 2) * Math.PI) / 180;
  const ang = away + (Math.random() - 0.5) * 2 * half;
  return { x: x + Math.sin(ang) * r, z: z + Math.cos(ang) * r };
}

/** 기믹을 부순다 — 상태·차단 해제만 하고 prop_broken 을 낸다. 전리품·매복·폭발 롤은
 *  Props 시스템이 이벤트로 잇는다 (시스템 간 직접 참조 금지 규약) */
export function breakProp(world: World, prop: PropState, source?: string): void {
  if (!prop.alive) return;
  prop.alive = false;
  if (prop.blocker) {
    world.level.removeBlocker(prop.blocker);
    prop.blocker = undefined;
  }
  world.events.emit('prop_broken', { id: prop.id, type: prop.type, x: prop.x, z: prop.z, source });
}

/** 기믹 타격 — 누적 타격량이 hp 에 닿으면 부서진다. amount 는 무기 몫:
 *  총알 1점(일반 기믹 2발), 해머·화살 2점(한 방). 남으면 prop_hit(금 가는 피드백)만.
 *  hp 는 호출부가 balance 에서 읽어 넘긴다 — World 는 데이터에 의존하지 않는다 */
export function damageProp(
  world: World,
  prop: PropState,
  hp: number,
  amount = 1,
  source?: string,
): void {
  if (!prop.alive) return;
  prop.hits += amount;
  if (prop.hits >= hp) breakProp(world, prop, source);
  else {
    world.events.emit('prop_hit', { id: prop.id, type: prop.type, x: prop.x, z: prop.z, source });
  }
}

/** 반경 안 기믹을 전부 부순다 — 폭발(수류탄·화염구·통·기믹 폭발) 공용 */
/** 함정 해체 — 플레이어가 줄을 끊는 등 능동적으로 무력화했다. 이미 쓴/해체된 것은 무시 */
export function disarmTrap(world: World, trap: TrapState, how: string): void {
  if (trap.phase === 'spent' || trap.phase === 'disarmed') return;
  trap.phase = 'disarmed';
  trap.timer = 0;
  world.events.emit('trap_disarmed', { id: trap.id, type: trap.type, x: trap.x, z: trap.z, how });
}

/** 반경 안 특정 종의 함정을 망가뜨린다 — 폭발이 자동 포자 군락을 짓밟는 데 쓴다. pad = 함정 몸 반지름(호출부가 데이터에서 준다) */
export function disarmTrapsInRadius(world: World, x: number, z: number, radius: number, type: string, pad: number, how: string): void {
  for (const trap of world.traps) {
    if (trap.type !== type) continue;
    if (Math.hypot(trap.x - x, trap.z - z) > radius + pad) continue;
    disarmTrap(world, trap, how);
  }
}

/** 함정을 처음 상태로 되살린다 — 시험방 레버 등. 잔해 차단·경로 막힘도 함께 걷는다 */
export function resetTrap(world: World, trap: TrapState, charges: number): void {
  if (trap.blocker) {
    world.level.removeBlocker(trap.blocker);
    world.level.clearPathBlocked(trap.col, trap.row);
    trap.blocker = undefined;
  }
  trap.rubbleBroken = undefined;
  trap.phase = 'armed';
  trap.timer = 0;
  trap.charges = charges;
  trap.hitIds = undefined;
  trap.cycleTick = undefined;
  trap.triggeredBy = undefined;
  world.events.emit('trap_reset', { id: trap.id, type: trap.type, x: trap.x, z: trap.z });
}

/** 낙석 잔해를 폭발로 치운다 — 폭발 반경이 잔해 상자(가장 가까운 점)에 닿으면 몸 차단·적 경로 막힘이 풀린다.
 *  함정 자체는 spent 그대로(다시 떨어지지 않는다). 수류탄·화염구·폭발통·기믹 폭발 공용 — 호출부가 rubbleBreakable 을 본다 */
export function breakRubbleInRadius(world: World, x: number, z: number, radius: number): void {
  for (const trap of world.traps) {
    if (trap.type !== 'trap_rockfall' || !trap.blocker || trap.rubbleBroken) continue;
    const b = trap.blocker;
    const dx = Math.max(b.minX - x, 0, x - b.maxX);
    const dz = Math.max(b.minZ - z, 0, z - b.maxZ);
    if (Math.hypot(dx, dz) > radius) continue;
    world.level.removeBlocker(b);
    world.level.clearPathBlocked(trap.col, trap.row);
    trap.blocker = undefined;
    trap.rubbleBroken = true;
    world.events.emit('trap_rubble_broken', { id: trap.id, type: trap.type, x: trap.x, z: trap.z });
  }
}

/** 함정을 멀리서 건드렸다(총·화살·마법) — 대기 중이면 곧장 예고로 넘긴다. telegraphTicks 는 호출부가 준다.
 *  포자 식물을 안전한 거리에서 터뜨리거나, 적 옆에서 터뜨려 구름에 몰아넣는 수단 */
export function provokeTrap(world: World, trap: TrapState, telegraphTicks: number, how: string): void {
  if (trap.phase !== 'armed') return;
  trap.triggeredBy = 'player';
  world.events.emit('trap_triggered', { id: trap.id, type: trap.type, x: trap.x, z: trap.z, by: 'player', how });
  trap.phase = 'telegraph';
  trap.timer = Math.max(1, telegraphTicks);
  world.events.emit('trap_telegraph', { id: trap.id, type: trap.type, x: trap.x, z: trap.z });
}

/** 반경 안의 대기 중인 포자 식물을 전부 건드린다 — 폭발(수류탄·화염구·폭발통)이 부른다 */
export function provokeTrapsInRadius(
  world: World, x: number, z: number, radius: number, type: string, telegraphTicks: number, how: string,
): void {
  for (const trap of world.traps) {
    if (trap.type !== type || trap.phase !== 'armed') continue;
    if (Math.hypot(trap.x - x, trap.z - z) > radius) continue;
    provokeTrap(world, trap, telegraphTicks, how);
  }
}

/** 반경 안의 안 붙은 기름 웅덩이에 불을 붙인다 — 폭발·화염구·수류탄·불타는 적이 부른다.
 *  burnTicks 는 호출부가 balance 에서 넘긴다 (World 는 데이터를 읽지 않는다) */
export function igniteOilInRadius(world: World, x: number, z: number, radius: number, burnTicks: number): void {
  for (const trap of world.traps) {
    if (trap.type !== 'trap_oil' || trap.phase !== 'armed') continue;
    if (Math.hypot(trap.x - x, trap.z - z) > radius) continue;
    trap.phase = 'firing';
    trap.timer = burnTicks;
    world.events.emit('trap_ignited', { id: trap.id, x: trap.x, z: trap.z });
  }
}

export function breakPropsInRadius(world: World, x: number, z: number, radius: number): void {
  for (const prop of world.props) {
    if (!prop.alive) continue;
    if (Math.hypot(prop.x - x, prop.z - z) <= radius) breakProp(world, prop);
  }
}

export interface ChestState {
  id: number;
  x: number;
  z: number;
  opened: boolean;
  blocker?: { minX: number; maxX: number; minZ: number; maxZ: number };
  /** 상자 속 — 처음 열 때 1회 롤(골드 + 각인). 루팅 UI 로 가져간다. 비어도 상자는 남는다 */
  chestItems?: LootEntry[];
}

/** 폭발통 — 총·해머로 여러 대 때리면 도화선이 짧아지고, 화염구·수류탄은 즉발 */
export interface BarrelState {
  id: number;
  x: number;
  z: number;
  alive: boolean;
  /** 총·해머로 맞은 누적 횟수 */
  hits: number;
  /** 점화됐으면 0 이상 — 0이 되는 틱에 터진다. -1 은 아직 멀쩡 */
  fuseTicks: number;
  /** 뇌창이 지진 누적 틱 — balance.barrel.zapTicks 를 넘기면 점화된다.
   *  때리는 것과 달리 시간이 쌓이는 방식이라 끊어서 지져도 합산된다 */
  zapTicks?: number;
  /** 몸으로 막는 등록 핸들 (터질 때 뺀다) */
  blocker?: { minX: number; maxX: number; minZ: number; maxZ: number };
}

/** 가방에 들어가는 소모품 종류. 골드·각인은 가방을 쓰지 않는다 */
export type ItemKind = 'potion' | 'mana' | 'food';

export const ITEM_KINDS: ItemKind[] = ['potion', 'mana', 'food'];

/** 가방 한 칸 — 같은 종류가 count 개 쌓여 있다. 빈 칸은 null */
export interface InventorySlot {
  kind: ItemKind;
  count: number;
}

/** 전리품 종류 — 주머니·상자 안에 들어가는 것: 가방 소모품 + 골드 + 화살 (+ 상자의 각인) */
export type LootKind = ItemKind | 'gold' | 'arrow' | 'sigil';
/** 컨테이너(주머니·상자) 한 줄 — 같은 종류는 한 줄에 쌓인다(상한 없음). 각인은 sigilId 별 한 줄 */
export interface LootEntry {
  kind: LootKind;
  count: number;
  sigilId?: string;
  /** 뒤져서 정체가 드러났다 — 창에서 한 칸씩 차례로(1초) 밝혀진다. 드러나기 전엔 가져갈 수 없다. 내가 넣은 것은 처음부터 참 */
  searched?: boolean;
}
/** 바라보는/열어 둔 컨테이너 참조 — 주머니는 groundItems 의 id, 상자는 chests 의 id */
export type LootRef = { kind: 'pouch'; id: number } | { kind: 'chest'; id: number };

/** 생명 입자 — 처치 시 흩뿌려져 가까이 가면 빨려 들어온다 (systems/LifeMotes) */
export interface LifeMoteState {
  id: number;
  x: number;
  /** 렌더용 높이 — 로직은 XZ 만 본다 */
  y: number;
  z: number;
  ageTicks: number;
  /** 자석에 걸렸다 — 한번 걸리면 플레이어가 물러나도 계속 따라온다 */
  homing: boolean;
  speed: number;
}

export interface GroundItemState {
  id: number;
  /** 바닥 아이템 종류 — 줍는 주체가 다르다 (sigil: Sigils / potion·gold: Pickups) */
  kind: 'sigil' | 'potion' | 'mana' | 'food' | 'gold' | 'arrow' | 'key' | 'grave' | 'ammo' | 'grenade' | 'battery' | 'pouch';
  x: number;
  z: number;
  /** kind==='sigil' 일 때만 */
  sigilId?: string;
  /** kind==='gold' 일 때 획득량 */
  amount?: number;
  /** kind==='grave' — 죽으며 떨어뜨린 가방 내용물. 회수 시 들어가는 만큼 다시 담는다 */
  graveItems?: { kind: ItemKind; count: number }[];
  /** 자석 흡수 중 — 공중으로 떠서 플레이어에게 날아간다 */
  magnet?: boolean;
  /** 자석이 물기 직전 놓여 있던 자리 — 골드 획득 표기가 이 자리에서 떠오른다 */
  originX?: number;
  originZ?: number;
  /** 비행 중 높이와 현재 속도 (자석 상태에서만 의미 있음) */
  y?: number;
  speed?: number;
  /** 이 틱 수만큼은 자석에 안 걸린다 — 가방에서 버린 직후 도로 주워지는 것을 막는다.
   *  주머니에서는 '떨어져 안착하는 시간'(그동안 뒤질 수 없다) */
  noMagnetTicks?: number;
  /** kind==='pouch' — 처치 전리품 묶음. 뒤져서(루팅 UI) 가져간다. 비면 사라진다 (systems/Loot) */
  pouchItems?: LootEntry[];
  /** 보스 주머니는 금빛 — 뒤져 볼 가치가 보이게 */
  pouchTier?: 'normal' | 'boss';
  /** 떨군 적 종류 — 창 제목용. 다른 종류의 전리품과 병합되면 undefined(전리품 주머니) */
  pouchOwner?: string;
  /** 가득 찬 가방에 튕겨 원자리로 돌아가는 중 — 남은 틱 / 출발점 / 출발 높이 (Pickups 가 굴린다) */
  bounceTicks?: number;
  bounceFromX?: number;
  bounceFromZ?: number;
  bounceY0?: number;
}

export interface ManaState {
  value: number;
  /** 연쇄 단계 (balance.chain.multipliers 인덱스, 상한은 배열 끝) */
  chainIndex: number;
  /** 활성 적이 0이 된 뒤 경과한 틱 (combatExitTicks 초과 시 휘발 시작) */
  outOfCombatTicks: number;
  inCombat: boolean;
}

export interface LanternState {
  on: boolean;
  battery: number;
  spares: number;
}

export type MeleeWeaponKind = 'hammer';
export type RangedWeaponKind = 'pistol' | 'grenade' | 'bow';
export type WeaponKind = MeleeWeaponKind | RangedWeaponKind;
/** 원거리 슬롯 교체 순서 (휠) */
export const RANGED_WEAPONS: RangedWeaponKind[] = ['pistol', 'bow', 'grenade'];

export interface WeaponState {
  /** 장착한 근접 무기 (우클릭) */
  melee: MeleeWeaponKind;
  /** 장착한 원거리 무기 (좌클릭, 휠로 교체) */
  ranged: RangedWeaponKind;
  /** 탄창 잔탄 */
  mag: number;
  /** 예비 탄약 (상한 balance.weapons.*.ammoMax) */
  reserve: number;
  /** 다음 발사까지 남은 틱 */
  cooldown: number;
  /** 장전 완료까지 남은 틱. 0이면 장전 중 아님 */
  reloading: number;
  /** 총구 화염 잔여 틱 (렌더가 읽는다) */
  muzzleFlash: number;
  /** 수류탄 소지 수 (소모성) */
  grenades: number;
  /** 화살 소지 수 (상한 balance.weapons.bow.ammoMax).
   *  가방(ItemKind)이 아니라 무기 탄약이다 — 권총 reserve 와 같은 자리 */
  arrows?: number;
  /** 시위를 당긴 틱 (0 = 안 당김). maxDrawTicks 에서 최대 */
  bowDraw?: number;
  /** 권총 연사 열 — 발마다 쌓이고 틱마다 식는다. 반동 폭이 (1 + heat×heatMul)배 (balance.weapons.pistol.recoil) */
  recoilHeat?: number;
  /** 시위를 내린 뒤 잠금 — 좌클릭을 뗄 때까지 다시 안 당겨진다.
   *  없으면 취소한 다음 틱에 곧바로 다시 당겨져 취소가 취소가 아니게 된다 */
  bowDrawLocked?: boolean;
  /** 해머/수류탄 공용 스윙 쿨다운 */
  meleeCooldown: number;
  /** 후딜 중에 눌린 근접 입력을 기억하는 남은 틱 — 풀리는 즉시 이어 친다 */
  meleeBufferTicks?: number;
  /** 이번 연결에서 실제로 적을 때린 스윙 수 — 3타 모두 적중 판정에 쓴다.
   *  헛치면 0으로 끊기고, 연결이 끝나면(마무리·창 만료) 다시 0 */
  comboHits?: number;
  /** 적중 가속 — 해머가 실제로 적을 때린 뒤에만 켜진다. 다음 스윙의 예비동작과
   *  후딜이 줄고 뷰모델도 같은 배율로 빨라진다. 마무리 3타를 치거나 연결 창이
   *  끊기면 꺼진다 — 즉 1→2→3 안에서만 살아 있고 다음 1타는 다시 원속도다 */
  meleeRush?: boolean;
  /** 수류탄 차징 누적 틱 (홀드 중) */
  grenadeCharge: number;
  /** 휘두른 해머가 닿기까지 남은 틱 (0 = 진행 중인 스윙 없음) */
  swingImpact: number;
  /** 진행 중인 스윙이 마무리 강타인가 */
  swingHeavy: boolean;
  /** 해머 연속타 단계 (0=처음). finisherStep 에 도달하면 강타 */
  comboStep: number;
  /** 연속타가 유지되는 잔여 틱. 0이 되면 단계가 초기화된다 */
  comboTimer: number;
}

// 근접 적 공격 상태 머신 — docs/systems/combat.md §2.
// active_perfect가 active_normal보다 먼저 온다 (완벽 패링 = 가장 이른 순간).
export type EnemyAiState =
  | 'idle'
  | 'chase'
  | 'windup'
  | 'active_perfect'
  | 'active_normal'
  | 'impact'
  | 'recover'
  | 'staggered'
  /** 연사 — 제자리에서 일정 간격으로 여러 발 (족장 화살 세례) */
  | 'volley'
  /** 돌격 달리기 — 예고 뒤 타격 전까지 플레이어를 향해 달린다 */
  | 'charging'
  /** 들러붙어 파먹기 — 플레이어에게 매달려 있다. 근접 연타로 밀쳐내야 풀린다 (구울) */
  | 'latched';

/** 통통 튀는 구울 머리 소품 — GhoulHeads 가 굴리고, Weapons/Projectiles 가 부순다 */
export interface GhoulHeadState {
  id: number;
  x: number;
  z: number;
  /** 렌더·피격용 높이 (바닥 = radius) */
  y: number;
  vy: number;
  vx: number;
  vz: number;
  /** 갓 떨어진 직후 무적 틱 — 콤보 연타가 공중에서 바로 지우지 못하게 */
  graceTicks?: number;
  /** 착지 후 쉬는 틱 — 다 쉬어야 다음 통통 (쉼 없이 튀면 방정맞다) */
  restTicks?: number;
}

/** 슬라임이 남긴 점액 장판 한 방울 — Enemies 가 떨구고 말리며, PlayerMove 가 밟기를 판정한다 */
export interface GooPuddle {
  id: number;
  x: number;
  z: number;
  ticks: number;
}

export interface EnemyState {
  id: number;
  type: string;
  x: number;
  z: number;
  prevX: number;
  prevZ: number;
  /** 바라보는 방향 (플레이어와 같은 규약: yaw 0 = -Z) */
  yaw: number;
  health: number;
  alive: boolean;
  ai: EnemyAiState;
  /** 현재 ai 상태의 남은 틱 */
  timer: number;
  /** 배치된 초기 방향 — 대기 중 시선 훑기의 기준축 */
  homeYaw?: number;
  /** 생성 지점 — 대기 배회의 중심 (Spawner 가 채운다) */
  homeX?: number;
  homeZ?: number;
  /** 배회 목적지·멈춤·흐느낌 카운터 (구울) */
  wanderX?: number;
  wanderZ?: number;
  wanderPause?: number;
  moanTicks?: number;
  /** 도약 중 지면에서 뜬 높이(m). 렌더 전용 — 판정은 XZ 평면 그대로다 */
  jumpY?: number;
  prevJumpY?: number;
  /** 마법 방어막에 해머를 맞은 횟수 / 깨졌는가 (warden) */
  barrierHits?: number;
  barrierBroken?: boolean;
  /** 청각 배율 — 소음 반경이 이 배로 들린다 (World 는 데이터 비의존이라 Spawner 가 def 에서 복사) */
  hearingMul?: number;
  /** 벽거미 — 벽에 붙어 있다 (jumpY = wallCrawl.height). Stage 가 벽 자세로 굴려 그린다 */
  wallCling?: boolean;
  /** 벽 오르내리기/추락 전이 잔여 틱 */
  wallClimbTicks?: number;
  /** 내려오기/추락 시작 높이 */
  wallClimbFromY?: number;
  /** 참 = 붙은 채 맞아 떨어지는 중 — 착지하면 뻗는다 */
  wallFalling?: boolean;
  /** 벽 도약 예고 잔여 틱 (적색 — Stage 섬광이 이 필드를 본다) */
  wallWindupTicks?: number;
  /** 벽 도약 비행 잔여 틱 */
  wallPounceTicks?: number;
  wallPounceFromY?: number;
  /** 돌진 캔슬(cancelOnHit) 기준 체력 — 돌진에 들어간 뒤 이보다 낮아지면 끊긴다 */
  chargeHealthRef?: number;
  /** 이번 도약에서 이미 타격했나 — 비행 접촉과 착지 광역의 중복 타격 방지 */
  wallPounceHitDone?: boolean;
  /** 예고 시점의 먹이 좌표 — 옆으로 비키면 헛짚는다 */
  wallPounceTX?: number;
  wallPounceTZ?: number;
  wallPounceCooldown?: number;
  /** 붙은 벽의 법선 (벽→바깥) — Stage 굴림 방향 */
  wallNX?: number;
  wallNZ?: number;
  /** 기는 소리(사각사각) 간격 카운터 */
  skitterTicks?: number;
  /** 비행체(박쥐) — 직전 틱 체력. 모든 피해 경로를 체력 변화로 잡아 추락 게이지에 싣는다 */
  flyLastHealth?: number;
  /** 추락 게이지 — 쌓이면 날개가 꺾인다 (entities.flying.knockdown) */
  knockdownGauge?: number;
  /** 바닥 기절 잔여 틱 — 뒤집혀 퍼덕이는 처형각 */
  downTicks?: number;
  /** 추락 낙하 잔여 틱 */
  batFallTicks?: number;
  /** 참 = 이 층의 주인 (배치 플래그) — 종 자체가 보스가 아니어도 출구 봉인을 쥔다 */
  floorBoss?: boolean;
  /** 참 = 처치 보상 없음(드랍·골드·XP) — 보스가 소환한 새끼. 생명 입자는 나온다 */
  noLoot?: boolean;
  /** 랜턴 속박 잔여 틱 — 빛기둥에 잡혀 있는 동안 매 틱 갱신된다 (0 = 자유) */
  batLitTicks?: number;
  flyFallFromY?: number;
  flyJinkTicks?: number;
  flyOrbitDir?: number;
  swoopCooldown?: number;
  /** 날갯짓 소리 간격 카운터 */
  flapTicks?: number;
  /** 초음파 비명 재사용 대기 */
  screamCooldown?: number;
  /** 무리 동시 강하 재사용 대기 */
  packDiveCooldown?: number;
  /** 이번 강하의 발사 비명을 이미 냈는가 — 예고 끝(돌진 시작) 순간 한 번 */
  swoopAnnounced?: boolean;
  /** 이번 강하에서 이미 몸이 닿았는가 — 관통 스침 중복 타격 방지 */
  swoopHitDone?: boolean;
  /** 비명 여운 — 파문이 퍼지는 동안 제자리에 떠 있는다 */
  screamHoldTicks?: number;
  /** 관통 돌진의 고정 진행 방향 — 첫 돌진 틱에 예고 좌표로 정해 끝까지 유지한다 */
  batDashDirX?: number;
  batDashDirZ?: number;
  /** 분열을 이미 처리했는가 — 죽은 슬라임을 두 번 가르지 않는다 */
  splitHandled?: boolean;
  /** 다음 점액 방울까지 남은 틱 (슬라임 궤적) */
  gooDropTicks?: number;
  /** 아직 머리에서 튀어나올 새끼 수 / 다음 사출까지 틱 (어미 슬라임 순차 사출) */
  broodLeft?: number;
  broodTicks?: number;
  /** 삼킨 바닥 아이템 — 죽으면 전부 그 자리에 게워 낸다 (슬라임 식탐) */
  eatenItems?: GroundItemState[];
  /** 천장 잠복 중 (거머리) — 매달려 있고 이름표도 없다. 밑 통과·소음·피격이 깨운다 */
  lurking?: boolean;
  /** 낙하 구간 남은 틱 / 이 낙하가 피격 추락(뻗음)인가 / 낙하 목표·시작 높이 */
  dropTicks?: number;
  dropStunned?: boolean;
  dropTargetX?: number;
  dropTargetZ?: number;
  dropFromY?: number;
  /** 얼굴 흡혈 횟수 — maxSucks 에 닿으면 배불러 스스로 떨어진다 */
  suckCount?: number;
  /** 배불리 먹었다 — 무거워서 천장에 다시 못 올라가고 지상에 남는다 (몸도 통통해진다) */
  gorged?: boolean;
  /** 재상승 구간 남은 틱 / 지상에 머문 뒤 재상승까지 남은 틱 */
  ascendTicks?: number;
  groundTicks?: number;
  /** 죽은 척 중 — 엎어져 있고 이름표도 없다. 기척·소음·피격이 깨운다 (구울) */
  feigning?: boolean;
  /** 광란 스택 — 생명 입자를 먹을 때마다 +1, 이속·공속이 빨라진다 (구울) */
  frenzyStacks?: number;
  /** 들러붙은 방향 — 플레이어 → 나 (파먹는 동안 이 방향으로 매달린다) */
  latchDirX?: number;
  latchDirZ?: number;
  /** 화상 잔여 틱 (Projectiles가 피해 적용) */
  burnTicks: number;
  burnDamagePerTick: number;
  /** 화상 도트 피해 누적 — 피해 숫자를 틱마다 띄우면 도배라, 묶어서 하나로 띄운다 */
  burnPopAccum?: number;
  /** 서리 — freezeTicks 동안은 완전히 굳는다(이동·회전·공격·돌진 없음). slowTicks 는 빙결을
   *  포함한 전체 지속이라, 빙결이 풀린 뒤 남은 동안 slowMul 배로 느리다 (Projectiles nova → Enemies) */
  freezeTicks?: number;
  /** 감전 — 이 동안 AI 를 안 돌린다. 빙결과 같은 규약이라 하던 동작이 풀릴 때 그대로 이어진다.
   *  얼음과 달리 몸이 좌우로 떨린다 (떠는 건 렌더 쪽 일) */
  shockTicks?: number;
  /** 끊기지 않고 지져진 누적 틱 — shockChargeTicks 를 넘기면 감전된다 */
  shockCharge?: number;
  /** 전기가 아직 닿아 있다고 볼 유예 틱. 0 이 되면 누적이 0 으로 돌아간다 —
   *  "연속으로" 지져야 감전된다는 규칙이 이 유예로 표현된다 */
  shockGrace?: number;
  slowTicks?: number;
  slowMul?: number;
  /** 얼음이 깨질 때 들어갈 피해 — 얼리는 순간이 아니라 풀리는 순간에 다친다 */
  frozenDamage?: number;
  /** 서리 중첩 — 1 둔화 / 2 완전 둔화 / 3 빙결 / 4+ 빙결 연장. 둔화가 다 풀리면 0 */
  frostStacks?: number;
  /** 보스 전용 — 연속 패링 누적 (parriesToStagger 도달 시 스태거) */
  parryStreak?: number;
  /** 현재 공격이 근접인지 원거리인지 (windup~recover 동안 유지) */
  attackMode?: 'melee' | 'ranged' | 'charge' | 'bash' | 'volley' | 'summon';
  /** 연사 남은 발수 / 재사용 대기 (족장 화살 세례) */
  volleyLeft?: number;
  volleyCooldown?: number;
  /** 무리 소환 재사용 대기 (어미 슬라임) */
  summonCooldown?: number;
  /** 거리 조건으로 나가는 돌격의 재사용 대기 (족장) */
  chargeCooldown?: number;
  /** 돌격이 겨눈 지점 — 예고가 끝나는 순간의 플레이어 좌표로 고정한다.
   *  달리는 동안 추적하면 이동으로 피할 수가 없다 */
  chargeTargetX?: number;
  chargeTargetZ?: number;
  /** 방패로 밀쳐낼 차례 (Weapons가 켜고 Enemies가 실행한다) */
  wantsBash?: boolean;
  /** 연속으로 방패에 막아낸 횟수 — 임계를 넘으면 밀쳐낸다 */
  blockedStreak?: number;
  /** 막아낸 기록이 사라지기까지 남은 틱 (연타를 멈추면 초기화) */
  blockedStreakTicks?: number;
  /** 다음 기회에 돌격을 시도한다 (크게 밀려난 직후 확률적으로 켜진다) */
  wantsCharge?: boolean;
  /** 피탄 경직 잔여 틱 — 발이 묶인다 (공격 진행은 막지 않는다. 총알용) */
  flinchTicks?: number;
  /** 그물에 걸린 잔여 틱 — staggered 와 함께 건다(Traps.fireNet). 몸에 거미줄 고치가 씌워지고, 0 이 되면 찢고 나온다 */
  nettedTicks?: number;
  /** 강한 타격 경직 — 공격 중이라도 그 상태 그대로 굳는다 (해머용) */
  attackFreezeTicks?: number;
  /** 알아챈 직후 멈칫 — 이 틱 동안 몸만 돌리고 이동·공격을 하지 않는다.
   *  머리 위 느낌표를 읽을 틈을 주는 시간이다 (alertEnemy 가 건다) */
  noticeTicks?: number;
  /** 방패에 막히거나 패링당해 튕긴 직후인가 — recover 동안 뒤로 젖혀진 채 굳는다 */
  recoiled?: boolean;
  /** 헛친 직후인가 — recover 동안 마지막 동작으로 굳고 무방비가 된다 */
  whiffed?: boolean;
  /** 정면 방패가 부서졌는가 — 이후 투사체를 막지 못한다 */
  shieldBroken?: boolean;
  /** 이 적에게서 이미 회수 화살을 하나 떨궜는가.
   *  한 마리에 여러 대를 박아도 주울 수 있는 건 한 대뿐이다 — 없으면
   *  체력 높은 적에게 화살을 퍼부어 회수하는 무한 순환이 생긴다 */
  arrowDropped?: boolean;
  /** 방패가 해머 마무리 타를 받아낸 횟수 (금 → 파괴) */
  shieldHits?: number;
  /** 방패로 버티는 중 — 웅크린 채 아무 행동도 하지 않는다 */
  braceTicks?: number;
  /** 타격 진행도 0~1 (무기가 뻗어나가는 정도) 과 그 시점의 무기 끝 거리(중심 기준).
   *  패링은 이 값으로 판정한다 — 시간이 아니라 무기가 실제로 닿았는지 */
  strikeProgress?: number;
  weaponTipDist?: number;
  /** 캐스터 재배치 — 사선이 아군에 막힌 누적 틱 / 현재 횡이동 방향(+1·-1) */
  strafeBlockedTicks?: number;
  strafeDir?: number;
  /** 끼임 감지 — 최근 창(checkTicks)의 시작 좌표·기대 이동·카운터.
   *  순변위로 재야 제자리 진동(매 틱 움직이지만 못 가는 것)까지 잡힌다 */
  stuckFromX?: number;
  stuckFromZ?: number;
  stuckExpect?: number;
  stuckCount?: number;
  /** 벽 재부착 지연 — 벽거미가 내려온 직후 곧장 다시 붙는 맴돌이 방지 */
  wallAttachCooldown?: number;
  /** 끼임 탈출 모드 잔여 틱 — 흐름장 우회 강제 + 분리력 축소 */
  unstickTicks?: number;
  /** 넉백 잔여 틱 + 틱당 밀림량 (해머 등) */
  kbTicks?: number;
  kbX?: number;
  kbZ?: number;
}

/** 피격 밀림 시작 — (dirX,dirZ) 방향으로 distance 만큼 ticks 동안 밀린다.
 *  balance는 호출하는 시스템이 읽어 넘긴다 (World는 데이터에 의존하지 않는다) */
export function pushPlayer(
  player: PlayerState,
  dirX: number,
  dirZ: number,
  distance: number,
  ticks: number,
): void {
  const len = Math.hypot(dirX, dirZ);
  if (len === 0 || distance <= 0 || ticks <= 0) return;
  player.kbTicks = ticks;
  player.kbX = (dirX / len) * (distance / ticks);
  player.kbZ = (dirZ / len) * (distance / ticks);
}

/** 스태미너 소모 — 깎고 회복을 미룬다. 이번 소모로 바닥나면 true (호출한 시스템이
 *  stamina_empty 를 발행한다). pushPlayer 와 같은 규약: balance 는 호출부가 읽어 넘긴다 */
export function spendStamina(
  stamina: { value: number; regenDelay: number; exhausted: boolean },
  amount: number,
  regenDelayTicks: number,
): boolean {
  stamina.value = Math.max(0, stamina.value - amount);
  stamina.regenDelay = regenDelayTicks;
  if (stamina.value > 0 || stamina.exhausted) return false;
  stamina.exhausted = true;
  return true;
}

/** 폭발통에 총·해머가 한 대 들어갔다. 맞은 수만큼 도화선이 짧아진다 —
 *  이미 더 짧은 도화선이 돌고 있으면 늘리지 않는다.
 *  balance 는 호출하는 시스템이 읽어 넘긴다 (pushPlayer 와 같은 규약) */
export function hitBarrel(barrel: BarrelState, fuseByHits: readonly number[]): void {
  if (!barrel.alive) return;
  barrel.hits++;
  const fuse = fuseByHits[Math.min(barrel.hits, fuseByHits.length) - 1] ?? 0;
  barrel.fuseTicks = barrel.fuseTicks < 0 ? fuse : Math.min(barrel.fuseTicks, fuse);
}

/** 즉발 — 화염구·수류탄·다른 통의 폭발 */
export function igniteBarrel(barrel: BarrelState): void {
  if (!barrel.alive) return;
  barrel.fuseTicks = 0;
}

/** (sourceX, sourceZ)에서 오는 공격을 방어 중인가 — 정면 arcDeg 안일 때만 */
export function playerBlocks(
  world: World,
  sourceX: number,
  sourceZ: number,
  arcDeg: number,
): boolean {
  const p = world.player;
  if (!p.blocking) return false;
  const toX = sourceX - p.x;
  const toZ = sourceZ - p.z;
  const len = Math.hypot(toX, toZ);
  if (len === 0) return true;
  const facingX = -Math.sin(p.yaw);
  const facingZ = -Math.cos(p.yaw);
  const dot = (facingX * toX + facingZ * toZ) / len;
  return dot >= Math.cos(((arcDeg / 2) * Math.PI) / 180);
}

export class World {
  /** 시작 이후 경과한 시뮬레이션 틱 수. 모든 시간 판정의 기준. */
  tick = 0;

  /** 히트스톱 잔여 틱. 0보다 크면 시스템들이 상태 진행을 멈춘다 (입력 버퍼는 계속 받음). */
  freezeTicks = 0;

  /** 플레이어 사망 시 true. 시뮬레이션이 멈춘다. */
  dead = false;

  /** 각인 UI 등이 열려 있으면 true — 시뮬레이션 일시정지 */
  uiOpen = false;

  /** 이번 틱의 입력 스냅샷. 매 틱 시작 시 main이 갱신한다. */
  input: InputSnapshot;

  player: PlayerState;
  lantern: LanternState;
  weapon: WeaponState;
  mana: ManaState;
  sigils: SigilState;
  modifiers: Modifiers;
  corruption: CorruptionState;
  projectiles: ProjectileState[] = [];
  spell: SpellState = { cooldown: 0 };
  groundItems: GroundItemState[] = [];
  lifeMotes: LifeMoteState[] = [];

  /** 폭발통 — Barrels 가 도화선을 돌리고 터뜨린다 */
  barrels: BarrelState[] = [];
  /** 부술 수 있는 기믹들 — 층 전환 시 main 이 갈아 끼운다 */
  props: PropState[] = [];
  /** 함정 — Traps 시스템이 상태 머신을 돈다. 층에 속한다 (floorStates 동행) */
  traps: TrapState[] = [];

  /** 소모품 가방 — 빈 칸은 null. 칸 수는 Items.init 이 balance 를 읽어 잡는다
   *  (World 는 데이터에 의존하지 않는다 — pushPlayer 와 같은 규약) */
  inventory: (InventorySlot | null)[] = [];

  /** 퀵슬롯 — 1~5 키에 등록된 종류. 칸이 아니라 종류를 기억한다 (balance.items._bindNote) */
  quickslots: (ItemKind | null)[] = [];
  /** 스킬 퀵슬롯 — 액티브 스킬 id. 키보드 Z·X·C·V (Sigils.ensureSkillSlots 가 칸 수를 맞춘다) */
  skillSlots: (string | null)[] = [];
  /** 선택된 스킬 칸 — Q(패드 cycleSkill)로 회전, 가운데 클릭(패드 cast)으로 쓴다 */
  selectedSkill = 0;

  /** 소모품 공용 사용 쿨다운 — 한 프레임에 물약을 들이붓지 못하게 */
  itemCooldown = 0;
  /** 계단 홀드 진행 틱 — 발판에서 상호작용을 붙든 시간. 놓거나 떠나면 0 */
  stairHoldTicks = 0;
  /** 타겟 락온(R3) — 잡힌 적 id. 추적·전환·해제는 PlayerMove 가 맡는다 */
  lockOnId: number | null = null;
  /** 락온 pitch 오프셋(rad) — 오른스틱 상하로 몸통 위/아래를 고른다. 놓으면 복귀 */
  lockOnPitchOffset = 0;
  /** 락온 시야 상실 유예 카운터 / 대상 전환 쿨다운 */
  lockOnLosLost = 0;
  lockOnSwitchCooldown = 0;
  /** 음식 지속 회복 잔여 틱 — HP 미세 회복 + 스태미너 회복 가속 (Items 가 줄인다) */
  foodRegenTicks = 0;

  /** 마시는 중 — 끝까지 가야 효과가 난다. 끊기면 아이템은 소모되지 않는다.
   *  PlayerMove 가 이걸 보고 걸음을 늦추고, 손 연출도 여기서 읽는다 */
  itemChannel: { kind: ItemKind; index: number; ticks: number; total: number } | null = null;

  /** 보물상자 — Chest 가 연다 */
  chests: ChestState[] = [];

  /** 지금 바라보고 있는 열 수 있는 상자 (없으면 null) — HUD 안내가 읽는다 */
  chestInView: ChestState | null = null;
  /** 지금 바라보는 컨테이너(주머니·상자) — Loot 가 계산, HUD 안내·상호작용 병합이 읽는다 */
  lootInView: LootRef | null = null;
  /** 열어 둔 컨테이너 — 루팅 UI 가 이걸 보고 그린다. null 이면 닫힘 */
  lootOpen: LootRef | null = null;
  /** 지금 바라보는 바닥 소모품(E 로 집는 것) — Pickups 가 계산 */
  itemInView: { id: number; kind: ItemKind } | null = null;
  /** 창을 닫은 E 가 다음 틱에 같은 것을 다시 열지 않게 — 닫은 뒤 이 틱 동안 열기 무시 */
  lootReopenGuard = 0;

  /** 보유 골드 — 적 처치 드랍으로 모인다 (사용처는 이후 구역) */
  /** 스태미너 — 질주로 닳고 회피로 크게 깎인다. 0이 되면 지쳐서 질주 불가 */
  stamina = { value: 0, regenDelay: 0, exhausted: false };

  gold = 0;

  /** 제단 상점 남은 재고 — 품목별. 비어 있으면 stock 만큼 있는 것으로 본다 */
  shopStock: Record<string, number> = {};
  /** 재고가 0이 된 품목이 다시 채워지는 tick.
   *  UI가 열린 동안은 시뮬레이션이 멈추므로 상점에 서서 기다려도 줄지 않는다 */
  shopReadyTick: Record<string, number> = {};

  /** 누적 경험치 — 적 처치 시 획득 (레벨업은 이후 구역) */
  xp = 0;

  /** 일시정지 중 — 렌더는 계속되지만 시뮬레이션은 멈춰 있다 */
  paused = false;

  /** 처형 연출 잔여 틱 — 그동안 모든 적이 멈춘다 (플레이어 동작을 보여주는 시간) */
  executeFocusTicks = 0;

  /** 마지막으로 진입한 제단 (리스폰 지점). 없으면 사망 시 완전 재시작 */
  respawn: { x: number; z: number } | null = null;

  /** 제단 반경 안 (프롬프트 표시용, Altar가 갱신) */
  nearAltar = false;
  /** 반경 안 + 제단을 바라보는 중 — E 안내와 진입 조건 */
  altarInView = false;
  /** 이번 접근에서 이미 진입했는가 (우회 판정용) */
  altarEnteredThisApproach = false;

  /** 오염 25 임계 — 벽의 문자 해독 */
  canReadGlyphs = false;

  /** 구역 클리어 — 시뮬레이션 정지 */
  cleared = false;
  /** 출구 접근 중 잠김 안내 중복 방지 */
  exitLockedNotified = false;
  /** 테스트용 무적 — HP·마나·탄약·배터리·스태미너가 소모되지 않는다 (G 토글) */
  godMode = false;
  /** 스킬 테스트(U · ?skills) — 켜 있는 동안 마나가 매 틱 최대치로 돌아온다 */
  skillTestMode = false;
  /** 서리 연속 시전 — 이펙트 크기용. 창(comboWindowTicks) 안에 이어지면 count 가 는다 */
  frostCombo = { count: 0, lastTick: -1_000_000 };

  /** 출구 개방 여부 — 보스가 죽으면 열린다. 렌더·미니맵이 이 값을 본다 */
  exitOpen = false;

  /** 출구 쇠사슬이 열쇠를 요구하는가 — 보스 층에서만 참. 열쇠로 풀면 거짓 */
  exitNeedsKey = false;

  /** 족장이 떨군 열쇠를 주웠는가 */

  /** 입구 계단으로 위층에 올라갈 수 있는가 — 첫 층은 거짓 (층 번호는 main 이 안다) */
  canAscend = false;

  /** 입구 발판 위인가 — 위층 안내와 E 입력을 렌더·시스템이 읽는다 */
  onEntrancePad = false;
  /** 출구 발판 위에 서 있는가 — 봉인 안내를 계속 띄우기 위한 플래그 */
  onExitPad = false;

  /** 잠긴 문 — Door 가 E 채널을 돌리고 미닫이를 민다 (레버는 2026-08 폐지) */
  doors: DoorState[] = [];

  /** 지금 바라보고 있는 아직 안 열린 문 (없으면 null) — HUD 안내가 읽는다.
   *  관문(byLever)도 여기 잡힌다 — "이건 레버로만 열린다"를 알려 줘야 하므로 */
  doorInView: DoorState | null = null;

  /** 당겨진 레버 ("row-col") — 레버는 1회용 */
  pulledLevers = new Set<string>();

  /** 지금 바라보고 있는 아직 안 당긴 레버 (없으면 null) — HUD 안내가 읽는다 */
  leverInView: { row: number; col: number } | null = null;

  /** 슬라임 점액 장판 — 층 이동 시 loadFloor 가 비운다. 없으면 빈 배열로 취급 */
  gooPuddles?: GooPuddle[];

  /** 통통 튀는 구울 머리들 — 층 이동·부활 시 비운다 */
  ghoulHeads?: GhoulHeadState[];

  /** 구울에게 붙잡혀 파먹히는 중 — 그 구울의 id. 근접 연타로 밀쳐내야 풀린다 */
  grappleEnemyId: number | null = null;
  /** 붙잡힌 동안 누적한 몸부림(근접 키) 횟수 */
  grappleMash = 0;
  /** 얼굴에 붙어 흡혈 중인 거머리 id — 근접 연타(mashToEscape)로 떼어 걷어찬다 */
  faceLeechId: number | null = null;
  /** 거머리를 떼어내려 누른 연타 횟수 */
  faceLeechMash = 0;

  enemies: EnemyState[];
  level: Level;

  constructor(
    readonly events: Events,
    init: {
      input: InputSnapshot;
      player: PlayerState;
      lantern: LanternState;
      weapon: WeaponState;
      mana: ManaState;
      sigils: SigilState;
      modifiers: Modifiers;
      corruption: CorruptionState;
      enemies: EnemyState[];
      /** 폭발통 — 없는 레벨(테스트 아레나 등)에서는 생략한다 */
      barrels?: BarrelState[];
      props?: PropState[];
      traps?: TrapState[];
      chests?: ChestState[];
      level: Level;
    },
  ) {
    this.input = init.input;
    this.player = init.player;
    this.lantern = init.lantern;
    this.weapon = init.weapon;
    this.mana = init.mana;
    this.sigils = init.sigils;
    this.modifiers = init.modifiers;
    this.corruption = init.corruption;
    this.enemies = init.enemies;
    if (init.barrels) this.barrels = init.barrels;
    if (init.props) this.props = init.props;
    if (init.traps) this.traps = init.traps;
    if (init.chests) this.chests = init.chests;
    this.level = init.level;
    this.doors = init.level.doors.map((d) => ({
      row: d.row,
      col: d.col,
      x: d.x,
      z: d.z,
      dirX: d.dirX,
      dirZ: d.dirZ,
      byLever: d.byLever,
      progress: 0,
      slide: 0,
      prevSlide: 0,
      opened: false,
    }));
  }
}
