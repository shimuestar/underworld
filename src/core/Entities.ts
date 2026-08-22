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
  /** 이 공격만의 피해량 (없으면 def.damage) */
  damage?: number;
  /** 이 공격만의 플레이어 밀림 거리 (없으면 balance.playerKnockback[type]) */
  playerKnockback?: number;
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
  if (enemy.attackMode === 'ranged' && def.rangedAttack) return def.rangedAttack;
  if (enemy.phase === 'armored' && def.armoredAttack) return def.armoredAttack;
  return def.attack;
}

/** 이 근접 공격의 유효 범위(사거리 × impactRangeMul, 전방 arcDeg) 안에 (x,z)가 있는가.
 *  적은 예비동작에 들어가면 방향을 고정하므로, 옆으로 비키면 빗나간다 */
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
  enemy: { x: number; z: number; yaw: number; ai: string; shieldBroken?: boolean },
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

export function enemyDef(type: string): EnemyDef {
  const def = (entitiesJson.enemies as Record<string, unknown>)[type];
  if (!def) throw new Error(`entities.json에 없는 적 타입: ${type}`);
  return def as EnemyDef;
}
