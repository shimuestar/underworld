# 계측 지표 정의

`core/Metrics.ts`가 수집한다. Metrics는 **이벤트만 구독**하며 시스템 안에 계측 코드를 넣지 않는다
(docs/architecture.md §2). 목표값은 `balance.json`의 `metrics.targets`.

## 핵심 지표 (슬라이스 검증 기준)

| 지표 | 정의 | 원천 이벤트 | 목표 | 해석 |
|---|---|---|---|---|
| `ammoLeftRatioAtAltar` | 제단 진입 시 잔탄율의 평균 | `altar_entered.ammoLeftRatio` | ≤ 0.20 | 0.50 이상이면 호딩 습관을 못 버린 것. 밸런스가 아니라 초반 강제 소진 구간을 레벨에 추가할 것 (economy.md §5) |
| `altarBypassRatio` | 제단 우회 비율 = 우회 / (진입+우회) | `altar_bypassed`, `altar_entered` | ≤ 0.05 | 높으면 제단 보상이 약하다는 신호 |
| `parryAttemptsPerEncounter` | 교전당 반응(패링) 시도 수 | `parry_attempt` / `combat_entered` | ≈ 3 | 낮으면 총만 쏘고 있다는 것 — 코어 루프 미작동 |
| `perfectParryRatio` | 완벽 패링 비율 = 완벽 / 전체 시도 | `parry_attempt.result` | ≥ 0.20 | 낮으면 완벽 창(6t)이 너무 좁거나 텔레그래프가 늦다 |
| `parrySuccessRatio` | 패링 성공률 = (완벽+일반) / 전체 시도 | `parry_attempt.result` | — | 참고용. 실패가 절반을 넘으면 판정 창 재조정 |
| `manaWasteRatio` | 마나 휘발률 = 휘발량 / 획득량 | `mana_decayed` / `mana_gained` | ≤ 0.30 | 0.30 초과면 마나를 벌고도 못 쓰고 있다 — 코어 루프 미작동 신호 (combat.md §8) |
| `chainTier3ReachRatio` | 연쇄 3단(×2.5) 도달 교전 비율 | `chain_changed` + `combat_entered/exited` | ≥ 0.20 | 낮으면 연쇄 유지가 비현실적 — 리셋 조건이 과함 |
| `corruptedAmmoUsageRatio` | 오염탄 사용 비율 | (오염탄 미구현) | 0.30 | **슬라이스 범위 밖 — 수집 안 함** |

## 보조 카운터

원자료로 함께 덤프한다: 처치 수(총기/근접·처형/마법), 발사 수·명중 수, 피격 횟수·총 피해,
사망 수, 반사 수, 회피 수, 교전 수, 제단 진입·우회 수, 오염(확정/대기), 세션 틱,
생명 입자(흡수 개수·회복 총량·못 줍고 사라진 개수 — 사라진 비율이 높으면 원거리 처치가 주력이라는 뜻).

## 수집·확인 방법

- **F1** — 디버그 오버레이 토글 (실시간 지표)
- **F2** — 현재 세션 지표를 JSON 파일로 다운로드
- 사망·구역 클리어 시 콘솔에 스냅샷이 자동 출력된다

## 이벤트 계약

시스템들이 발행해야 하는 계측 이벤트 (누락 시 지표가 침묵으로 왜곡된다):

```
parry_attempt   { result: 'perfect'|'normal'|'fail', chain, enemyType }
deflect         { casterId }
dodge_step      {}
life_mote_absorbed { count, healed }
life_mote_expired  { count }
mana_gained     { amount, source, chain }
mana_decayed    { amount, wasted }
mana_lost       { amount, reason }
chain_changed   { chain }
weapon_kill     { weapon, enemyType }   ← 마나 이벤트 금지 (하드 룰)
melee_kill      { enemyType, execution }
spell_kill      { enemyType }
weak_point_hit    { enemyId, enemyType, id, damage, x, y, z }   ← 약점 구체 명중 (거수 눈·관절·심장·분출공), 권총·화살·화염구 직격만
weak_point_broken { enemyId, enemyType, id, x, y, z }   ← 약점 내구 0 (관절 파열 — 착탄점)
exposure_closed   { enemyId, enemyType, id, hits }   ← 약점 노출 창이 닫힘 (관절 타이머 소진·머리 내림 종료·혼절·파열). hits = 그 창 안의 명중 수 → 노출 활용률
boss_status       { enemyId, enemyType, kind, on, id?, blade?, ticks?, cause?, cell?, sealed?, selfDamage?, despair? }   ← 보스 상태이상 on/off (expose{id — 관절·돌격 중 눈·갑각 떨기 중 분출공}·head_down{cause? 'topple'|'backflow'}·daze·rupture{id, blade}·limp·skid·blind·topple{cell 'P'|'C', row, col}·rear{sealed — 발구르기 앞발 들기 자세, 심장 열림}·backflow{cause 'heart'|'vent'|'eye', ticks, selfDamage — 심장 66 으로 발구르기 취소(자해 45) / 분출공 66 으로 갑각 떨기 취소(자해 0) / 눈 66 으로 포효 취소(자해 0, B3-4)}·choke{ticks — 분출공 내구 0, 갑각 떨기 봉인·웅덩이 증발·예고 +10, B3-2}·roar{despair — 포효 예고 자세, 눈이 위로 열림, B3-4}·exhaust{ticks — 삼연낫 3연속 완벽, 눈 + 분출공 동시 노출, B3-4} — 기획서 §5 의 12종이 이 하나로)
charge_dodged     { enemyId, enemyType, x, z }   ← 돌격을 무적 8틱 안에 완벽 회피 (거수 미끄러짐 + 양 관절 노출)
enemy_slam_start  { enemyId, enemyType, wake, dist }   ← 거수 발구르기 예고 시작(B3-1). wake = 기상 발구르기(머리 내림·혼절이 끝나며 확정)
slam_landed       { enemyId, enemyType, x, z, radius, wake, hit }   ← 발구르기 착지(ground_slam 과 함께). hit = 플레이어 직격
hobble_applied / hobble_ended   { kind, ticks } / { kind, reason }   ← 절뚝(발구르기 직격, B3-1) — numb_arm·concussion 과 같은 플레이어 상태 규약
cowed_applied / cowed_ended     { kind, ticks } / { kind, reason }   ← 위압(거수 P3 포효 12m 안, B3-4 — 일반 패링이 관절을 열지 못함·마나 5, 완벽 패링 1회로 cured) 플레이어 상태 규약
enemy_roar_start  { enemyId, enemyType, despair, ticks, x, z }   ← 거수 포효 예고 시작(B3-4 — pose roar, 눈이 위로 열린다). despair = 절망의 포효(체력 ≤ 20%)
enemy_roar        { enemyId, enemyType, despair, radius, dist, x, z }   ← 포효 발동(impact 파이프가 아닌 별도 분기 — 피해·방어 판정 없음). 소리·카메라 킥
boss_roar_hit     { enemyId, enemyType, status, pull, push, dist, despair }   ← 포효가 플레이어를 잡았다(12m 안·회피 무적 아님): 위압 + 밀림 push(m) 또는 끌림 pull(m)
enemy_combo_start / enemy_combo_step   { enemyId, enemyType, steps } / { enemyId, enemyType, step, steps, perfectOnly }   ← 삼연낫 ① 시작 / ②③ 진행(perfectOnly = ③ 완벽 전용 — 예고음 고음)
enemy_chain_turn  { enemyId, enemyType, ticks, x, z }   ← 광란 돌격의 제자리 선회(2차 예고) 시작 — 첫 질주를 완벽 회피하지 못했고 눈멂·전도도 아니었다
enemy_volley_start / enemy_volley_shot   { enemyId, enemyType, shots } / { enemyId, enemyType, left }   ← 연사(족장 화살 세례·거수 갑각 떨기 B3-2 — 종류는 def.volleyAttack.projectileKind)
spawn_pool        { kind, x, z, enemyId?, hit? }   ← 진액 웅덩이 요청(거수 P2+, B3-2 — Enemies 낫 착지 'blade'·발구르기 'stomp'·미끄러짐 'skid', Projectiles 구슬 착탄 'orb'). Hazards 가 받아 만든다
pool_spawned      { id, x, z, r, kind }   ← 웅덩이가 생김(balance.hazards.pools)
pool_evaporated   { id, x, z, r, kind, reason }   ← 웅덩이 소멸 — reason 'expired'(자연) / 'fire'(폭발·불붙은 기름) / 'choke'(질식) / 'overflow'(상한 poolMax)
corrosive_applied / corrosive_ended   { kind, ticks } / { kind, reason }   ← 오염 진액(웅덩이 위·진액 구슬 직격 — 막아도, B3-2) 플레이어 상태 규약
corrosive_tick    { amount, health }   ← 오염 진액 도트(dotIntervalTicks 마다 dotPerTick) — player_damaged 를 안 내는 도트 규약(damageTakenTotal 합산, 함정 사망은 아님)
corrosive_pending { amount, total, cap, enemyId }   ← 오염 진액이 오염 대기에 +1(pendingPerTicks 마다, 전투당 상한 pendingCap — 보스 EnemyState.fightPendingIn)
corruption_cleansed { amount, source, enemyId, enemyType, total }   ← 분출공 명중 정화(source 'vent' — 오염 대기 −ventHitCleanse, 부착 중 ×2, 전투당 상한 ventCleanseCap). Corruption.ts 가 구독해 pending 만 깎는다(applied 불변)
pillar_hit        { enemyId, enemyType, row, col, x, z }   ← 거수 돌격이 기둥 P 에 박힘 (전도와 함께 — 내구 −1·붕괴는 B3-5 Arena)
enemy_whiffed     { enemyId, enemyType, ticks, wall? }   ← 헛침 경직. wall = 돌격이 일반 벽·문에 막힘(거수 wallWhiffRecoverTicks — 박히지 않음)
boss_staggered    { enemyId, enemyType, cause }   ← cause 'parry'(족장 연속 패링) / 'eye'(거수 눈 누적 66 혼절)
boss_phase        { enemyId, enemyType, phase, from, skipped, fromTicks, tick, name?, shiftText?, death? }   ← 페이즈 전환(거수 B2-6 — phase = 새 체력 칸 index 3→2→1, from 에 머문 틱 fromTicks, skipped = 한 창에서 두 경계를 넘어 P2 건너뜀). phase 0 = 사망(마지막 페이즈 마감 — 전환으로 세지 않는다)
plate_shed        { enemyId, enemyType, count, x, z }   ← P3 진입에 남은 등갑판이 골드 없이 탈락(파편만)
plate_broken      { enemyId, enemyType, gold, platesLeft, count, ventScale, x, z }   ← P2 갑각판 hp 풀(60/장)이 heavy 타격(해머 강타 3타·수류탄·화염구 폭발·폭발통·낙석)으로 한 장 부서짐(B3-3) — Loot 가 골드 gold 주머니(일반 등급), 분출공 반지름 ×1.15/장(ventScale). 총·화살·마법 직격은 판과 무관
shot_fired      { hitEnemy }
player_damaged  { amount, health }
player_died     { tick }
combat_entered / combat_exited
altar_entered   { ammoLeftRatio, pendingCorruption, multiplier }
altar_bypassed  { ammoLeftRatio }
zone_cleared    { tick }
```

## 함정 (traps) — 2026-09-02

| 카운터 | 이벤트 | 뜻 |
|---|---|---|
| `traps.triggered` | `trap_triggered` | 함정이 작동을 시작한 횟수 (플레이어·적 구분은 페이로드 `by`) |
| `traps.hitsPlayer` | `trap_hit_player` | 함정 피해를 플레이어가 받은 횟수 (다트 포함) |
| `traps.hitsEnemy` | `trap_hit_enemy` | 함정 피해를 적이 받은 횟수 — 유도 플레이 지표 |
| `traps.kills` | `trap_kill` | 함정으로 죽은 적 (마나 없음 — 총 처치와 같은 결) |
| `traps.disarms` | `trap_disarmed` · `trap_rubble_broken` | 플레이어가 무력화한 함정(그물 줄 끊기·낙석 잔해 폭파) |
| `traps.parried` | `trap_parried` | 진자 칼날 완벽 패링 |
| `traps.deaths` | `player_died` 직전 `player_damaged.source` 가 `trap_*`/`poison`/`burn`, 또는 `poison_tick`/`burn_tick` | 함정(독·화염 도트 포함)으로 죽은 횟수 |
| `damageTakenTotal` (기존) | `player_damaged` + `poison_tick` + `burn_tick` | 도트는 player_damaged 를 안 내므로 따로 합산 |

시스템(`src/systems/Traps.ts`) 안에는 카운터가 없다 — Metrics 가 이벤트를 구독한다 (CLAUDE.md 규칙 4).

## 진액 웅덩이·오염 진액·분출공 (hazards) — 2026-09-06 (거수 B3-2)

| 카운터 | 이벤트 | 뜻 |
|---|---|---|
| `hazards.pools` | `pool_spawned` | 생긴 웅덩이 수(낫 착지·발구르기·구슬 착탄·미끄러짐) — 바닥 압박 밀도 |
| `hazards.evaporated` | `pool_evaporated` (`reason !== 'expired'`) | 자연 소멸이 아닌 증발(불·질식·상한) — 플레이어가 웅덩이를 지운 수 |
| `hazards.corrosiveApplied` | `corrosive_applied` | 오염 진액이 붙은 횟수 — 웅덩이를 밟는 빈도 |
| `hazards.corrosiveDamage` | `corrosive_tick` (`amount` 합) | 오염 진액 도트 피해 합(damageTakenTotal 에도 합산) |
| `hazards.pendingIn` | `corrosive_pending` (`amount` 합) | 오염 진액이 오염 대기에 더한 양(전투당 ≤ 8) |
| `hazards.ventCleanse` | `corruption_cleansed` (`amount` 합) | 분출공 명중이 오염 대기에서 깎은 양(전투당 ≤ 6) — 반사·직격 노선 성공 지표 |
| `hazards.chokes` | `boss_status` (`kind 'choke'`, on) | 질식 수 — 반사 4회 달성 |
| `weakPoints.backflows` (기존) | `boss_status` (`kind 'backflow'`, on) | 심장(cause 'heart')·분출공(cause 'vent')·눈(cause 'eye' — 포효 취소, B3-4) 역류 합 |

순 오염 변화(기획서 §11.1 장부) = `pendingIn − ventCleanse`(처형·사망 정화는 B3-6). 시스템(`Hazards.ts`·`Status.ts`) 안에는 카운터가 없다 — Metrics 가 이벤트를 구독한다 (CLAUDE.md 규칙 4).

## P3 기술 (boss) — 2026-09-06 (거수 B3-4)

| 카운터 | 이벤트 | 뜻 |
|---|---|---|
| `boss.roars` | `enemy_roar` | 포효 발동 수(절망 포함) |
| `boss.roarHits` | `boss_roar_hit` | 위압에 걸린 수 — 회피로 피한 비율 = 1 − roarHits/roars |
| `boss.combos` | `enemy_combo_start` | 삼연낫 시작 수 |
| `boss.exhausts` | `boss_status` (`kind 'exhaust'`, on) | 탈진 수 — 3연속 완벽 패링(숙련 지표) |
| `boss.chainTurns` | `enemy_chain_turn` | 광란 돌격 선회 수 — 첫 질주를 완벽 회피하지 못한 수 |

위압 걸림·해제는 `cowed_applied/_ended`(플레이어 상태 규약). 시스템(`Enemies.ts`·`Reaction.ts`) 안에는 카운터가 없다 — Metrics 가 이벤트를 구독한다 (CLAUDE.md 규칙 4).

## 전리품 (loot) — 2026-09-04

| 카운터 | 이벤트 | 뜻 |
|---|---|---|
| `loot.pouches` | `pouch_dropped` | 떨어진 주머니 수 (병합도 1회로 센다 — 페이로드 `merged`) |
| `loot.opened` | `loot_opened` | 루팅 창을 연 횟수 (주머니·상자, `kind`) |
| `loot.revealed` | `loot_revealed` | 뒤져서 밝힌 칸 수 — `taken` 과 비교하면 밝힌 것 중 얼마나 가져가는지 |
| `loot.taken` | `loot_taken` (`count` 합) | 가져온 아이템 개수 (골드는 금액) |
| `loot.stashed` | `loot_stashed` (`count` 합) | 내 가방에서 컨테이너로 넣은 개수 — 보관함 사용 지표 |
| `loot.dropped` | `loot_dropped` (`count` 합) | 창에서 바닥에 버린 개수 |
| `loot.deniedFull` | `loot_denied` (`reason === 'full'`) | 가방이 가득해 못 가져온 횟수 — 가방 칸·스택 튜닝 지표 |

`loot.taken / loot.pouches` 가 낮으면 주머니를 안 뒤지고 지나간다는 뜻(전리품이 매력 없거나 뒤지기 귀찮다).
시스템(`src/systems/Loot.ts`) 안에는 카운터가 없다 — Metrics 가 이벤트를 구독한다 (CLAUDE.md 규칙 4).
