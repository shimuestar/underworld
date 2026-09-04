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
