// 플레이어 상태이상 — docs/systems/boss_scythe_behemoth.md §6 (B2-4: 팔 저림·진탕).
//
// 소유 규약(stunTicks 와 같다): 카운터는 PlayerState 옵셔널(numbArmTicks·concussionTicks). 다른 시스템은
// 값을 **세우기만** 한다(Enemies impact → setPlayerStatus / Reaction 일반 패링 → 0 / Items 물약 → 0).
// 감소·상한·`${kind}_applied/_ended` 이벤트는 전부 여기서만 낸다 — 그래서 "누가 지웠든" 해제 문구는 한 곳에서 나온다.
//
// 상한: balance.status.maxConcurrent — 세 번째가 걸리면 가장 오래된 것이 해제된다(statusOrder 가 걸린 순서).
// 어느 상태도 회피 거리·무적 틱을 건드리지 않는다("언제나 반응 버튼으로 답할 수 있다").
//
// 효과의 소비처(값만 읽는다):
//   numb_arm  — Reaction(완벽 대역 ×perfectBandMul·실패 마나 소실 면제·일반 패링 시 해제), PlayerMove(방어 이속 blockSpeedMul)
//   concussion — 조준 흔들림은 여기서 박쥐 aimShake 채널에 싣는다(PlayerMove 가 소비), 화면 기울기·오디오 덕킹·HUD 는 main 이 카운터를 읽는다,
//                Items.drink(체력 물약이 0 으로) / Inventory.isUseful(지울 상태가 있으면 유용)
//
// 실행 순서: Reaction 뒤 — 같은 틱의 일반 패링 해제·impact 부여를 이 틱 안에 이벤트로 낸다.

import { balance } from '../core/Balance';
import {
  PLAYER_STATUS_FIELD,
  PLAYER_STATUS_KINDS,
  playerStatusTicks,
  type PlayerStatusKind,
  type World,
} from '../core/World';

export function tick(world: World, _dt: number): void {
  const p = world.player;
  const cfg = balance.status;
  const order = (p.statusOrder ??= []);

  // 1) 이번 틱에 새로 세워진 상태 — 걸린 순서 뒤에 붙이고 알린다. 상한을 넘기면 맨 앞(가장 오래된 것)부터 해제
  for (const kind of PLAYER_STATUS_KINDS) {
    if (playerStatusTicks(p, kind) <= 0 || order.includes(kind)) continue;
    order.push(kind);
    world.events.emit(`${kind}_applied`, { kind, ticks: playerStatusTicks(p, kind) });
    while (order.length > cfg.maxConcurrent) end(world, order, order[0]!, 'displaced');
  }

  // 2) 감소·종료 — 밖에서 0 으로 지운 것(일반 패링·물약)은 'cured', 다 흐른 것은 'expired'
  for (const kind of [...order]) {
    const ticks = playerStatusTicks(p, kind);
    if (ticks <= 0) {
      end(world, order, kind, 'cured');
      continue;
    }
    setTicks(p, kind, ticks - 1);
    if (ticks - 1 <= 0) end(world, order, kind, 'expired');
  }

  // 3) 진탕 — 조준 흔들림을 박쥐 aimShake 채널에 싣는다(PlayerMove 가 이미 이번 틱 분을 소비했으니 남은 진탕 틱으로 다시 채운다).
  //    위상이 남은 틱에서 나오므로 잔여 틱과 같게 두어야 떨림이 계속 돈다. 더 긴 흔들림이 돌고 있으면(사실상 없다) 그쪽을 존중한다
  const concussion = playerStatusTicks(p, 'concussion');
  if (concussion > 0 && (p.aimShakeTicks ?? 0) <= concussion) {
    p.aimShakeTicks = concussion;
    p.aimShakeAmp = cfg.concussion.aimShakeAmp;
  }
}

/** 전부 해제 — 부활·층 이동·시험방 진입(main.loadFloor). 이벤트 없이 조용히 (HUD·덕킹·기울기는 카운터를 매 프레임 읽어 스스로 꺼진다).
 *  진탕이 빌려 쓴 aimShake 채널도 여기서 놓는다 — 안 놓으면 카운터는 0 인데 남은 틱 내내 조준만 계속 흔들린다 */
export function clearAll(world: World): void {
  const p = world.player;
  releaseConcussionShake(p);
  for (const kind of PLAYER_STATUS_KINDS) setTicks(p, kind, 0);
  p.statusOrder = [];
}

/** 걸려 있는가 — 소비처가 카운터를 직접 읽어도 되지만 이름을 주면 읽기 쉽다 */
export function isActive(world: World, kind: PlayerStatusKind): boolean {
  return playerStatusTicks(world.player, kind) > 0;
}

function setTicks(p: World['player'], kind: PlayerStatusKind, ticks: number): void {
  // setPlayerStatus 는 '긴 쪽으로 갱신' 이라 감소에는 못 쓴다 — 여기(소유자)만 직접 내려 쓴다
  p[PLAYER_STATUS_FIELD[kind]] = ticks;
}

/** 진탕이 빌려 쓴 조준 흔들림 채널을 놓는다 — 물약·상한으로 일찍 끝났거나 clearAll 로 지워질 때 남은 틱만큼 계속 흔들리면 안 된다.
 *  진폭이 우리 값이면 우리가 쥔 채널이다(박쥐·포자는 제 진폭을 쓴다) — 남의 흔들림은 건드리지 않는다 */
function releaseConcussionShake(p: World['player']): void {
  if (p.aimShakeAmp === balance.status.concussion.aimShakeAmp) p.aimShakeTicks = 0;
}

function end(world: World, order: PlayerStatusKind[], kind: PlayerStatusKind, reason: 'cured' | 'expired' | 'displaced'): void {
  const p = world.player;
  const at = order.indexOf(kind);
  if (at >= 0) order.splice(at, 1);
  setTicks(p, kind, 0);
  if (kind === 'concussion') releaseConcussionShake(p);
  world.events.emit(`${kind}_ended`, { kind, reason });
}
