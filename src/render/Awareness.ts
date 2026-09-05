// 위협·소리 기억 — 미니맵과 나침반이 같은 데이터를 읽는다 (한 곳에서만 갱신, 2026-09-04).
// 게임 로직 금지: World 를 읽어 "지금 이 적을 표시하는가"만 판단한다. 규칙은 미니맵의 것 그대로 —
// ① 시야(카메라 호 + 벽에 안 가림) 안 ② 공격을 주고받은 지 얼마 안 된 적(실시간 추적, 끝은 페이드) ③ 신 모드는 전부.
// 위장 중인 천장 거머리는 눈앞이라도 안 보인다 (기습 담당).

import { balance } from '../core/Balance';
import type { EnemyState, PlayerState } from '../core/World';
import type { Level } from '../level/GridLoader';

export interface Ping { x: number; z: number; bornMs: number }

export class Awareness {
  /** 공격을 주고받은 적 — id → 만료 시각(ms). 그동안 실시간 추적된다 */
  readonly combat = new Map<number, number>();
  /** 소리 핑 — 시야 밖 소리가 난 자리에 잠깐 깜빡인다 */
  pings: Ping[] = [];

  /** 공격을 주고받았다 — 이 적은 잠시 실시간으로 추적된다 */
  notifyCombat(enemyId: number): void {
    const cfg = balance.minimap;
    this.combat.set(enemyId, performance.now() + cfg.combatSolidMs + cfg.combatFadeMs);
  }

  /** 소리가 났다 — 그 자리에 흐릿한 점이 잠깐 깜빡인다 */
  ping(x: number, z: number): void {
    this.pings.push({ x, z, bornMs: performance.now() });
    if (this.pings.length > 24) this.pings.shift();
  }

  /** 층이 바뀌었다 — 기억을 비운다 */
  reset(): void {
    this.combat.clear();
    this.pings = [];
  }

  /** 수명이 지난 핑을 걷어낸다 — 그리는 쪽이 매 프레임 부른다 */
  prunePings(now: number): void {
    const ms = balance.minimap.pingMs;
    for (let i = this.pings.length - 1; i >= 0; i--) {
      if (now - this.pings[i]!.bornMs > ms) this.pings.splice(i, 1);
    }
  }

  /** 이 적을 지금 표시하는가 — 불투명도(0~1) 또는 null(표시 안 함) */
  threatAlpha(enemy: EnemyState, player: PlayerState, level: Level, god: boolean, now: number): number | null {
    if (god) return 1;
    const cfg = balance.minimap;
    const expire = this.combat.get(enemy.id);
    if (expire !== undefined && now < expire) {
      const remain = expire - now;
      return remain < cfg.combatFadeMs ? remain / cfg.combatFadeMs : 1;
    }
    if (enemy.lurking) return null;
    const dx = enemy.x - player.x;
    const dz = enemy.z - player.z;
    const dist = Math.hypot(dx, dz);
    const fx = -Math.sin(player.yaw);
    const fz = -Math.cos(player.yaw);
    const arcCos = Math.cos(((cfg.viewArcDeg / 2) * Math.PI) / 180);
    if (dist > 0.001 && (fx * dx + fz * dz) / dist < arcCos) return null; // 시야각 밖
    if (!level.hasLineOfSight(player.x, player.z, enemy.x, enemy.z)) return null; // 벽 뒤
    return 1;
  }
}
