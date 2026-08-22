// data/entities.json 로더. 적 스탯은 전부 여기서 읽는다 — 코드에 하드코딩 금지.

import entitiesJson from '../../data/entities.json';

export interface EnemyAttackDef {
  type: string;
  windupTicks: number;
  recoverTicks: number;
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
}

export interface EnemyDef {
  /** 표시 이름 (이름표) */
  name?: string;
  health: number;
  /** 처치 시 획득 경험치 */
  xp: number;
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
  parriesToStagger?: number;
  executeDamage?: number;
  armorHealth?: number;
}

/** 현재 공격 정의 — 원거리 모드면 rangedAttack, 보스 armored면 armoredAttack */
export function currentAttack(
  def: EnemyDef,
  enemy: { phase?: string; attackMode?: string },
): EnemyAttackDef {
  if (enemy.attackMode === 'ranged' && def.rangedAttack) return def.rangedAttack;
  if (enemy.phase === 'armored' && def.armoredAttack) return def.armoredAttack;
  return def.attack;
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
