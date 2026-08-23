// data/entities.json 로더. 적 스탯은 전부 여기서 읽는다 — 코드에 하드코딩 금지.

import entitiesJson from '../../data/entities.json';

/** 착탄 시 광역 효과. 수호주술사 마법탄의 '내파' — 화염구(밀어냄)와 정반대로 끌어당긴다 */
export interface ProjectileSplashDef {
  /** 광역 반경(m) — 이 밖은 아무 영향 없음 */
  radius: number;
  /** 폭심 피해. 거리 감쇠는 falloffMin까지 */
  damage: number;
  falloffMin: number;
  /** 폭심 쪽으로 끌려가는 거리(m). 감쇠가 함께 적용된다 */
  pullDistance: number;
  pullTicks: number;
  /** 연출 종류 — Stage가 이 값으로 폭발/내파를 고른다 */
  kind: string;
}

export interface EnemyAttackDef {
  type: string;
  windupTicks: number;
  recoverTicks: number;
  /** 유효 전방 호(도). 없으면 각 제한 없음. 찌르기는 좁고 후려치기는 넓다 */
  arcDeg?: number;
  /** 타격 구간 동안 플레이어를 향해 달려드는 속도 (돌격 공격) */
  chargeSpeed?: number;
  /** 예고 뒤 따로 달리는 구간(틱). 있으면 이 동안 chargeSpeed 로 달린 뒤 타격한다.
   *  없으면 타격 창(0.3초) 동안만 파고들어 3~4m 밖에 못 좁힌다 */
  chargeRunTicks?: number;
  /** 이 공격만의 피해량 (없으면 def.damage) */
  damage?: number;
  /** 이 공격만의 플레이어 밀림 거리 (없으면 balance.playerKnockback[type]) */
  playerKnockback?: number;
  /** 밀림에 쓰는 틱 (없으면 balance.playerKnockback.ticks). 크게 날릴수록 길게 잡아야
   *  순간이동처럼 보이지 않는다 */
  playerKnockbackTicks?: number;
  /** 방어 시 밀림 배율 (없으면 balance.playerKnockback.blockedMul).
   *  1.0 이면 방패로 받아도 그대로 날아간다 — 돌격처럼 몸으로 받으면 안 되는 기술용 */
  blockedKnockbackMul?: number;
  /** 방어 시 관통 피해 비율 (없으면 balance.block.chipDamageRatio) */
  blockedDamageRatio?: number;
  /** 지면 강타 — 각과 무관한 원형 판정 반경(m). 있으면 arcDeg·impactRangeMul 대신 쓴다 */
  aoeRadius?: number;
  /** 투사체 발사 위치 — 무기 든 손에서 나가게 (def.radius/def.height 배율) */
  muzzleSideMul?: number;
  muzzleHeightMul?: number;
  /** 헛쳤을 때의 경직 틱 (없으면 recoverTicks). 그동안 마지막 동작으로 굳는다 */
  whiffRecoverTicks?: number;
  impactRangeMul: number;
  parryable: boolean;
  telegraph?: string;
  deflectable?: boolean;
  projectileSpeed?: number;
  projectileRadius?: number;
  projectileKind?: string;
  /** 원거리 공격 사용 최소 거리 (이보다 가까우면 근접) */
  minRange?: number;
  /** 이 거리 안에서만 고른다 (돌격처럼 "중거리 전용" 기술) */
  maxRange?: number;
  /** 시전 중 플레이어가 이 거리 안으로 들어오면 취소하고 근접으로 전환 */
  abortRange?: number;
  /** 맞으면 거미줄에 걸린다 — 수치는 balance.web */
  appliesWeb?: boolean;
  /** 연사 — 1보다 크면 windup 뒤 shotIntervalTicks 간격으로 shots 발을 쏜다 */
  shots?: number;
  shotIntervalTicks?: number;
  /** 이 공격만의 재사용 대기 (연사처럼 큰 기술용) */
  cooldownTicks?: number;
  /** 착탄 시 광역 효과 (없으면 단일 대상) */
  splash?: ProjectileSplashDef;
}

export interface EnemyDef {
  /** 표시 이름 (이름표) */
  name?: string;
  health: number;
  /** 처치 시 획득 경험치 */
  xp: number;
  /** 체급 — 넉백 저항 등에 쓴다 (light / medium / heavy) */
  weight: 'light' | 'medium' | 'heavy';
  speed: number;
  damage: number;
  radius: number;
  height: number;
  aggroRange: number;
  attackRange: number;
  attack: EnemyAttackDef;
  /** 정면 방패 — 전방 투사체 무효 (goblin_spear) */
  frontalShieldBlocksProjectiles?: boolean;
  shieldArcDeg?: number;
  /** 처형 시 드랍하는 각인 id 목록 */
  drops?: string[];
  /** true면 처형이 아니라 사망 시 드랍 (처형 불가능한 적/보스) */
  dropsOnDeath?: boolean;
  behavior?: string;
  /** 마법 방어막 (warden) — 실탄만 관통 */
  magicBarrier?: { blocksMagic: boolean; blocksMelee: boolean; piercedBy: string[] };
  /** caster_kite: 이 거리 안이면 물러난다 */
  kiteMinRange?: number;
  /** 보스 (boss_two_phase) */
  boss?: boolean;
  armoredAttack?: EnemyAttackDef;
  /** 원거리 보조 공격 (족장 바위 투척 등) */
  rangedAttack?: EnemyAttackDef;
  /** 연사 공격 — 예고 뒤 여러 발을 일정 간격으로 (족장 화살 세례) */
  volleyAttack?: EnemyAttackDef;
  /** 돌격 공격 — 멀리 떨어졌을 때 달려들며 찌른다 (창병) */
  chargeAttack?: EnemyAttackDef;
  /** 방패 밀쳐내기 — 연타를 멈추지 않는 상대를 떼어낸다 (창병) */
  shieldBash?: EnemyAttackDef;
  parriesToStagger?: number;
  executeDamage?: number;
  armorHealth?: number;
}

/** 현재 공격 정의 — 원거리 모드면 rangedAttack, 보스 armored면 armoredAttack */
export function currentAttack(
  def: EnemyDef,
  enemy: { phase?: string; attackMode?: string },
): EnemyAttackDef {
  if (enemy.attackMode === 'bash' && def.shieldBash) return def.shieldBash;
  if (enemy.attackMode === 'charge' && def.chargeAttack) return def.chargeAttack;
  if (enemy.attackMode === 'volley' && def.volleyAttack) return def.volleyAttack;
  if (enemy.attackMode === 'ranged' && def.rangedAttack) return def.rangedAttack;
  if (enemy.phase === 'armored' && def.armoredAttack) return def.armoredAttack;
  return def.attack;
}

/** 이 근접 공격의 유효 범위 안에 (x,z)가 있는가.
 *  기본은 사거리 × impactRangeMul + 전방 arcDeg — 예비동작에 방향이 고정되므로 옆으로
 *  비키면 빗나간다. aoeRadius 가 있으면 각을 무시한 원형 판정(지면 강타)이다.
 *  Reaction(패링)과 Enemies(피해)가 같은 함수를 쓴다 — 갈리면 "못 막는데 맞는" 구멍이 난다 */
export function attackReaches(
  def: EnemyDef,
  enemy: { x: number; z: number; yaw: number },
  attack: EnemyAttackDef,
  x: number,
  z: number,
): boolean {
  const dx = x - enemy.x;
  const dz = z - enemy.z;
  const dist = Math.hypot(dx, dz);
  if (attack.aoeRadius !== undefined) return dist <= attack.aoeRadius;
  if (dist > def.attackRange * attack.impactRangeMul) return false;
  if (attack.arcDeg === undefined || dist === 0) return true;
  const facingX = -Math.sin(enemy.yaw);
  const facingZ = -Math.cos(enemy.yaw);
  const dot = (facingX * dx + facingZ * dz) / dist;
  return dot >= Math.cos(((attack.arcDeg / 2) * Math.PI) / 180);
}

/** (fromX, fromZ)에서 오는 공격이 정면 방패에 막히는가.
 *  스태거 중이거나 이미 깨졌으면 막지 못한다 — Weapons·Projectiles 공용 규칙 */
export function shieldBlocks(
  def: EnemyDef,
  enemy: {
    x: number;
    z: number;
    yaw: number;
    ai: string;
    shieldBroken?: boolean;
    kbTicks?: number;
  },
  fromX: number,
  fromZ: number,
): boolean {
  if (!def.frontalShieldBlocksProjectiles) return false;
  if (enemy.shieldBroken || enemy.ai === 'staggered') return false;
  const facingX = -Math.sin(enemy.yaw);
  const facingZ = -Math.cos(enemy.yaw);
  const toX = fromX - enemy.x;
  const toZ = fromZ - enemy.z;
  const len = Math.hypot(toX, toZ);
  const dot = len > 0 ? (facingX * toX + facingZ * toZ) / len : 1;
  return dot >= Math.cos(((def.shieldArcDeg ?? 120) / 2) * (Math.PI / 180));
}

/** 투사체(총·마법)가 정면 방패에 막히는가. 뒤로 떠밀리는 동안은 가드를 못 잡으므로
 *  뚫린다 — 해머 3타로 날려 보낸 사이가 총을 박아 넣는 창이다.
 *
 *  근접은 이 예외를 쓰지 않는다(shieldBlocks 그대로): 벽에 붙어 밀려나지 못하는
 *  방패병을 해머로 관통해 "해머는 방패병에게 HP 피해를 주지 않는다" 규칙이 깨진다.
 *  실제로는 밀려난 적이 해머 사거리 밖이라 눈에 띄지 않는 차이다.
 *  Stage 의 방패 내림 연출은 이쪽(투사체) 조건과 맞춘다 */
export function shieldBlocksProjectile(
  def: EnemyDef,
  enemy: {
    x: number;
    z: number;
    yaw: number;
    ai: string;
    shieldBroken?: boolean;
    kbTicks?: number;
  },
  fromX: number,
  fromZ: number,
): boolean {
  if ((enemy.kbTicks ?? 0) > 0) return false;
  return shieldBlocks(def, enemy, fromX, fromZ);
}

export function enemyDef(type: string): EnemyDef {
  const def = (entitiesJson.enemies as Record<string, unknown>)[type];
  if (!def) throw new Error(`entities.json에 없는 적 타입: ${type}`);
  return def as EnemyDef;
}
