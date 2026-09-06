// 등갑판 hp 풀 — 낫뿔 거수 P2 「오염 갑각」의 경제 접목 (docs/systems/boss_scythe_behemoth.md §4.3, B3-3).
//
// 판 3장은 판정 볼륨이 아니다. "무거운 타격"(heavy — 해머 강타 3타·수류탄·화염구 폭발·폭발통·낙석)이 보스 몸에 들어갈 때마다 그 피해만큼
// 판 hp 풀을 깎고(위치 무관), hpEach 마다 한 장이 부서져 골드 파편 주머니(plate_broken{gold} → Loot)가 떨어지며 판 밑 균열이 벌어져
// 분출공 구체가 ×ventScalePerPlate 커진다(enemy.ventScale — 판정 Entities.weakPointRadius 와 그림 Stage 가 같은 값). 총·화살·마법 직격은 무관.
//
// heavy 의 분류는 호출부다 — breakCrackWalls 를 부르는 "폭발 계열"(수류탄·화염구·폭발통) + 해머의 마무리 타(combo.finisherStep, Weapons 의 heavy) +
// 낙석(Traps.fireRockfall). 데이터에 별도 분류 필드를 두지 않았다(기존 규약 그대로: 균열벽을 부수는 곳이 곧 폭발이다).
// hitWeakPoint 처럼 피해 자체는 호출부가 체력에 넣고, 여기는 판 장부만 적는다. P1·P3(shedPlates)·족장은 아무 일도 없다(Entities.shellPlatesActive).

import { enemyDef, shellPlatesActive } from './Entities';
import type { EnemyState, World } from './World';

/** heavy 타격이 보스 몸에 들어갔다 — 판 hp 풀에서 damage 만큼 깎고 부서진 장수를 돌려준다(0 이면 판에 아무 영향 없음).
 *  넘친 피해는 다음 판으로 이어진다(수류탄 120 = 두 장). 장마다 plate_broken{enemyId, enemyType, gold, platesLeft, count, ventScale, x, z} —
 *  골드는 goldMin~goldMax 균등(rng 주입 가능 — 테스트), 주머니 생성은 Loot(구독), 파편·소리·문구는 main/Stage. (x, z) 는 적 위치(주머니 자리) */
export function hitShellPlates(world: World, enemy: EnemyState, damage: number, rng: () => number = Math.random): number {
  if (damage <= 0 || !enemy.alive) return 0;
  const def = enemyDef(enemy.type);
  const sp = def.shellPlates;
  if (!sp || !shellPlatesActive(def, enemy)) return 0;
  let left = damage;
  let hp = enemy.plateHp ?? sp.hpEach;
  let broken = 0;
  while (left > 0 && (enemy.platesLeft ?? 0) > 0) {
    if (left < hp) {
      hp -= left;
      left = 0;
      break;
    }
    left -= hp;
    hp = sp.hpEach;
    enemy.platesLeft = (enemy.platesLeft ?? 0) - 1;
    enemy.ventScale = (enemy.ventScale ?? 1) * sp.ventScalePerPlate;
    broken++;
    const gold = Math.min(sp.goldMax, sp.goldMin + Math.floor(rng() * (sp.goldMax - sp.goldMin + 1)));
    world.events.emit('plate_broken', {
      enemyId: enemy.id, enemyType: enemy.type, gold, platesLeft: enemy.platesLeft, count: sp.count, ventScale: enemy.ventScale, x: enemy.x, z: enemy.z,
    });
  }
  enemy.plateHp = hp;
  return broken;
}

/** P3 진입(shedPlates) — 남은 판이 골드 없이 탈락한다(기획서 §8 P2→P3 연출). 남은 장수를 0 으로 하고 plate_shed{count} 를 낸다(파편은 Stage, 소리는 main).
 *  판이 이미 다 부서졌거나(0) 갑각판 정의가 없는 페이즈 보스(옛 경로)는 시각 판 수로 — 어느 쪽이든 남은 게 없으면 이벤트도 없다. 분출공 배율은 그대로(균열은 남는다) */
export function shedShellPlates(world: World, enemy: EnemyState): number {
  const def = enemyDef(enemy.type);
  const count = def.shellPlates ? (enemy.platesLeft ?? 0) : (def.visual?.plates.z.length ?? 0);
  if (def.shellPlates) enemy.platesLeft = 0;
  if (count <= 0) return 0;
  world.events.emit('plate_shed', { enemyId: enemy.id, enemyType: enemy.type, count, x: enemy.x, z: enemy.z });
  return count;
}
