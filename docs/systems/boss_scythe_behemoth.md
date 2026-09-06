# 낫뿔 거수 (scythe_behemoth) — 울트라리스크형 신규 보스 최종 기획서 (검토 반영판)

> **뼈대:** 패링·반응 중심. 패링은 스태거가 아니라 **약점을 열고**, 스태거(혼절)는 **눈 약점 사격**으로만 온다. **접목:** 약점 연쇄(돌격 중 눈 → 눈멂 → 기둥 충돌 → 전도), 아레나(기둥 내구·균열벽 돌격 개방·반캠핑), 경제(갑각판 골드·분출공 정화·처형 마무리 정화).
>
> 모든 수치는 **잠정치**이며 전부 `data/entities.json`(보스·공격 정의) / `data/balance.json`(공용 규칙·상태이상) / `data/equipment.json`(유일 장비) / `data/levels/z01_f4.json`(아레나)으로 간다. 본문의 수치 옆 괄호는 **데이터 필드명**이다. 코드 상수 금지(CLAUDE.md 규칙 1). 코드 훅은 파일 이름 수준으로만 적는다.
>
> **약점 피해 단위:** 이 문서의 모든 임계값은 권총 한 발(11) 기준으로 표기한다 — 눈·심장·분출공(×3.0) 한 발 = **33**, 관절(×2.0) 한 발 = **22**. 임계는 세 단계만 쓴다: **트리거 = 66(권총 2발 / 활 1발)**, **내구 = 132(관절: 권총 6발 / 활 2발, 분출공: 반사 4회)**. 소총은 미구현이라 표에서 제외(§3.3 주석).

---

## 0. 한눈에

| 항목 | 값 |
|---|---|
| 이름 / id | **낫뿔 거수** / `scythe_behemoth` |
| 콘셉트 | 오염된 무저갱에 갇힌 4족 갑각 괴수. 양 어깨에 뼈 낫 두 자루, 이마 위 높은 머리에 뿔 둘, 등에 갑각판 셋, 배 밑에 심장, 가슴에 오염 분출공. 몸 직경 3.2m 라 문틀(개구부 2.1m, `GridLoader DOOR_OPEN_WIDTH`)을 못 지나고, 아레나 경계 밖으로는 이동 목표를 잡지 않는다 — **우리에 갇힌 짐승** |
| 체력 / 체력바 | **1500 / 3칸(500×3)** — 칸 = 페이즈 |
| 이속 | 걷기 3.2 (P3 ×1.2 = 3.84) / 돌격 15 m/s × 72틱 = 18m |
| 처형 | `executeDamage` **240** (16%) — 혼절 한 번 = 처형 한 번. 사이클당 기대 피해 ≤ 372(눈 66~132 + 처형 240) → 4~5 사이클 |
| 기본 피해 | 낫 30 / 돌격 45 / 발구르기 24 / 들이받기 22 / 진액 구슬 16 / 꼬리 채기 12 (플레이어 100 기준) |
| 패링 규칙 | 완벽·일반 **둘 다 성립**. 패링은 스태거가 아니라 **약점을 연다**(일반 = 관절/통제, 완벽 = 눈/피해). 혼절은 **눈 누적 66** 으로만, 혼절 뒤 600틱 쿨다운 |
| 방패 막기 | 끊지 못함(`blockCannotStagger`) + 낫을 막으면 **팔 저림** — "막지 말고 패링하라" |
| 약점 5종 | 어깨 관절 ×2 · 눈 · 배 심장 · 분출공(P2+) — 전부 **조건부 노출**, 판정은 구체 + **정면 원뿔**(§4.2) |
| 새 플레이어 상태이상 5종 | 팔 저림 · 절뚝 · 진탕 · 오염 진액 · 위압 — **동시 2개 상한**, 회피 거리·무적 틱은 어느 것도 건드리지 않음 |
| 보스 상태이상 12종 | 관절 노출 · 관절 파열(낫 잠김 포함) · 절뚝 · 머리 내림 · 혼절 · 역류 · 눈멂 · 전도 · 미끄러짐 · 질식 · 탈진 · 갑각 재생 |
| 페이즈 | P1 돌각 → P2 오염 갑각 → P3 광란 (칸이 비는 순간 전환, 처형·노출 창 중엔 목표 index 로 큐잉) |
| 아레나 | 신규 4층 `z01_f4` 「무저갱 우리」 11×9 셀, 기둥 4(내구 3), 균열벽 2 + 상자 벽감, 기름 함정 2, 남쪽 문 D — **플레이어 진입 시** 봉쇄 |
| 보상 | 골드×12·물약·대형 물약(자동) + 유일 반지 **낫뿔 반지** + 각인 `sig_moment` + 오염 대기 −10(처형 마무리 −15) + 갑각판 골드 파편(P2 한정) + 균열 상자 2 |

### 핵심 루프 (한 사이클 ≈ 12초)

1. 낫 베기(파랑) → **일반 패링** → 그 낫의 어깨 관절 36틱 노출 → 관절 사격(내구 132, 권총 3발씩 두 번) — **통제 노선**(파열 → 낫 잠김 10초)
2. 낫 베기(파랑) → **완벽 패링** → 낫이 바닥에 박혀 머리가 내려옴 90틱 → **눈 66**(권총 2·활 1·해머 2타) → **혼절**(staggered 90틱, 눈 닫힘) → 처형 240 — **피해 노선**
3. 돌격(빨강) → 무적 8틱 안 **완벽 회피** → 미끄러짐 90 + 양 관절 40틱 노출 — **회피 보상**
4. 돌격(빨강) 중 **6m 안에서 눈 66** → **눈멂** → 목표를 지나 오버런 → 플레이어가 세워 둔 기둥·균열벽에 박힘 → **전도**(머리 내림 90) — **조준 노선**(운이 아닌 유도). 눈먼 돌격도 몸에 닿으면 그대로 맞는다
5. (P2+) 발구르기 예고 중 앞발을 들면 배 **심장**이 보임 → 28틱 안 **66** → **역류**(취소 + 자해 45 + 머리 내림 60, 혼절 누적 없음) — **탐욕 노선**
6. (P2+) 진액 구슬 **반사** → 분출공 자가 피격 33 → 4회면 **질식**(갑각 떨기 1800틱 봉인 + 웅덩이 전부 증발) — **반사 노선**

완벽 패링 뒤 "눈(피해)이냐 관절(통제)이냐", 탈진 창에서 "눈(처형·마나)이냐 분출공(정화·기술 봉인)이냐"를 매번 고르게 하는 것이 결정 공간이다.

---

## 1. 콘셉트·정체성

- **울트라리스크의 번역:** 거대(3m·반경 1.6)·중갑(등갑판, 정면은 안 뚫림)·근접 돌격(15 m/s 고정 목표 질주). 원거리는 P2 진액 구슬 하나뿐이고 그것도 **반사 시험**이다.
- **이 게임의 게임성에 맞춘 것:** 모든 약점은 "반응 버튼을 잘 눌렀는가"(패링 품질·회피 무적 타이밍) 또는 "움직이는 좁은 구체를 맞혔는가"로만 열린다. 권총으로 몸통을 긁는 것은 0.8×(`hitZones.bodyMul`) 손해, 활은 배율 없음(1.0 — 기존 규약 유지). 마나는 패링·처형·근접에서만 나오고 총은 약점(과 오염 정화)만 담당 — 두 자원 분리(설계 의도 1) 유지.
- **족장과의 차별:** 족장은 "완벽 패링 3연속만 받는 근접 시험". 거수는 완벽·일반을 모두 받되 **보상 종류가 다르고**, 스태거는 패링이 아닌 **약점 사격**으로만 열린다. 어미 슬라임(소환·분열)과 달리 **1:1 결투**(소환 없음 — 결정 7).
- **세계관:** 족장이 옥좌 로비 바닥을 봉인한 이유. 봉인 아래 무저갱에서 오염 결정을 먹고 자라 갑각 틈에 오염 진액이 고였다. 죽으면 고인 오염이 흩어져 플레이어의 오염 대기(pending)를 조금 씻어 준다.

---

## 2. 외형 — 프리미티브 (셀 4m · 천장 4m 안)

충돌 `radius 1.6`, `height 3.0`. 피격 AABB 는 시각 몸통에 맞춘 재정의 `hitBox {halfX 1.25, halfZ 1.85}`(y 0~height) — 옆에서 허공을 맞히는 폭을 0.35m 이하로 줄이고 머리를 AABB 안에 넣는다. 낫을 최대로 들어도 끝이 3.8m 를 넘지 않게 낫 길이 1.8m, 어깨 피벗 2.5m, 최대 올림각 45°(2.5 + 1.8·sin45° = 3.77m). 정면 = −z(Stage 규약). 부위 좌표는 `def.radius`/`def.height` 배율로 JSON 에 두고 Stage 가 곱한다. 색은 Stage 팔레트(튜닝값 아님) — **텔레그래프 3색(#4A9EFF/#FF3B3B/#A855F7)과 스태거 금색(0xcc9922·#ffb648)은 약점 발광에 쓰지 않는다**(combat.md §7 "색이 곧 문법").

| 부위 | 도형 · 크기(m) | 위치(로컬 x, y, z) | 색 | 발광 |
|---|---|---|---|---|
| 몸통 | Box 2.3 × 1.5 × 2.6 | (0, 1.6, 0) → z −1.3~+1.3 | 0x4a3a52 검자주 키틴 | 텔레그래프 색(`flashMaterials`) |
| **등갑판 ×3** (hp 풀, 판정 볼륨 아님) | Box 2.1 × 0.25 × 0.8, 10° 기울임 | (0, 2.45, −0.8 / 0 / +0.8) | 0x6b5a80 | P2: 판 사이 얇은 Box 균열 0x39ff88 점등. 파괴/탈락 시 `spawnDeathBurst` 파편 |
| 머리 (높이 든 머리 — 울트라리스크 실루엣) | Box 1.0 × 0.9 × 0.9 | **(0, 2.35, −1.4)** → y 1.9~2.8, z −1.85~−0.95 (AABB 안) | 0x3d2f45 | — |
| **눈(약점)** | Sphere r 0.26 | 머리 앞면 중앙 (0, 2.35, −1.88) → 앞끝 −2.14 ≤ contactDist 2.15 | 0x0f3a36(닫힘) | 노출 시 **청록 0x3ff0d0** 맥동(크기 ±12%); 혼절 쿨다운 중 노출은 맥동 없이 어두운 청록; P3 상시 붉은 홍채 |
| 뿔 ×2 | Cone r 0.15 h 0.8 | 머리 위 x ±0.35, 앞으로 30° | 0xd9cfa0 뼈 | 돌격 예고 빨강 |
| **어깨 관절 ×2(약점)** | Sphere r 0.30 | (±1.15, 2.5, −0.8) — 몸통 옆면(±1.15)에서 반쯤 돌출 | 0xe8dcb0 | 노출 시 **백황 0xfff4c8** 맥동, 파열 시 0x7a1f3a 어둡게 + 파편 |
| 낫 ×2 | Box 0.12 × 1.8 × 0.5 | 관절에서 앞·아래로 | 0xcfc4a0 | 파랑 텔레그래프. **보이는 낫끝 = 판정 낫끝**(`weaponTipDist`) |
| 다리 ×4 | Cylinder r 0.22 h 1.0 | (±1.0, 0.5, ±1.0) | 0x3a2d40 | 발구르기 예고 앞다리 빨강 |
| **배 심장(약점)** | Sphere r 0.35 | (0, 0.6, −0.4) 몸통 밑면 아래 | 0x7a1f3a | 앞발 들기 중 **진홍 0xff2e63** 맥동 |
| **분출공(약점, P2+)** | Sphere r 0.30 | **(0, 1.65, −1.55)** 가슴 앞, 머리(y ≥ 1.9) 아래 — 반사 복귀 높이 0.6h = 1.8 ± 구슬 r0.35 와 겹침 | 0x1f3a2e | P2 진입 후 **오염 녹색 0x39ff88** 맥동, 갑각 떨기 예고·탈진 중 크기 ×1.4 |
| 입 | Box 1.0 × 0.25 × 0.7, 힌지 | 머리 앞 아래 | 0x2a1f30 | 포효 예고 시 벌어짐(−0.8rad) |
| 꼬리 | Cylinder r 0.15 h 1.2 | 뒤로 (0, 1.2, +1.9) | 0x3a2d40 | 광란 돌격 선회 시 **빨강** + 휘두름 |
| 이름표 | 기존 sprite, `plateScale 2.6`(def.boss 자동) | y = h + 0.7 | — | 체력 3칸 자동 |

**자세(Stage `pose`, 로직 `enemy.pose`/`poseTicks`):** `normal` / `charge`(몸통 −12° 웅크림, 머리 내림 → 눈이 1.1m 높이 정면) / `rear`(몸통 +35°, 앞다리 들림 → 배 노출) / `head_down`(몸통 +20° 앞 기울임, 낫끝 바닥 고정, 머리 0.9m) / `skid`(어깨 높이를 축으로 옆 8° 굴림 + 앞으로 미끄러지며 살짝 뒤로 젖혀 버팀·낮아짐 — 15° 는 양 어깨를 높이 0.6m 갈라 놓아 표(둘 다 2.4)의 구체가 관절 메시를 벗어나 8°(±0.16m) 로 줄임. 눈은 목 IK 로 표 자리(≈0.05m), 관절 메시–구체 어긋남 ≤ 0.2m 를 `Behemoth.test` 가 못박음) / `stunned`(머리 흔들림, 혼절) / `roar`(머리 치켜듦·입 벌림 → 눈이 위로 드러남) / `blind`(머리를 좌우로 휘저으며 직진).

**`poseOffsets` — 자세별 약점 5개 전체 좌표표(판정=그림):**

| pose | eye | joint_r / joint_l | heart | vent |
|---|---|---|---|---|
| normal | (0, 2.35, −1.88) | (±1.15, 2.5, −0.8) | (0, 0.6, −0.4) | (0, 1.65, −1.55) |
| charge | (0, 1.1, −1.95) | (±1.15, 2.3, −0.6) | (0, 0.6, −0.4) | (0, 1.35, −1.5) |
| rear | (0, 3.0, −1.1) | (±1.15, 2.9, −0.3) | **(0, 1.15, −1.0)** | (0, 2.1, −1.2) |
| head_down | (0, 0.9, −1.9) | (±1.15, 2.2, −1.0) | (0, 0.5, −0.2) | (0, 1.2, −1.6) |
| skid | (0, 2.2, −1.8) | (±1.15, 2.4, −0.8) | (0, 0.6, −0.4) | (0, 1.6, −1.5) |
| stunned | (0, 2.0, −1.85) | (±1.15, 2.4, −0.8) | (0, 0.6, −0.4) | (0, 1.55, −1.55) |
| roar | (0, 2.9, −1.3) | (±1.15, 2.7, −0.5) | (0, 0.8, −0.7) | (0, 1.9, −1.35) |
| blind | (0, 1.2, −1.95) | (±1.15, 2.3, −0.6) | (0, 0.6, −0.4) | (0, 1.35, −1.5) |

**렌더 규약:**
- 약점 구체는 `group`(yaw 만 회전)에 붙인다. 자세로 몸이 기울면 **Stage 와 판정이 같은 `poseOffsets` 표를 읽어** 구체를 옮긴다 — torso 기울임 보간에 구체를 딸려 보내지 않는다("보이는 창끝 = 판정 창끝").
- 약점 머티리얼은 `flashMaterials` 에 넣지 않는다(일괄 emissive 대입이 자체 발광을 지운다). 별도 갱신.
- 예고는 **동작·발광·소리로만.** 파랑 = 패링 가능(낫), 빨강 = 불가(돌격·발구르기·들이받기·포효·꼬리), 보라 = 투사체(갑각 떨기). 약점 노출은 **구체 발광 + 크기 맥동 + 짧은 금속성 소리**. 링·조준선·아웃라인 없음. 발구르기 바닥 표식은 결정 16(기본 없음).
- 피 색 `BLOOD_COLORS.scythe_behemoth = 0x4a1a6e`(오염 보라). 파편 색은 몸통색.
- 시각 검증: `debug/behemoth.ts` + `.html`(slime/archer 페이지 형식 복제) 헤드리스 스크린샷 — 자세가 생기는 체크박스에서 찍는다(TASKS M11 과 같은 배분): B1-2 기본 정면·측면·낫 예고·낫 타격 측면/정면·돌격 예고+튕김(6장) + 시험방 3장, B1-3 왼낫 예고·들이받기, B2-2 **head_down**(+측면·쿨다운·혼절), B3-1 rear, B3-2 **정면 P2 normal(분출공이 머리에 가리지 않는지)**, B3-3 P3(등갑판 탈락), B3-4 roar.

---

## 3. 잠정 수치

### 3.1 정의 (entities.json `scythe_behemoth`)

| 필드 | 값 | 비고 |
|---|---|---|
| `boss` / `healthBars` | true / 3 | 칸 = 페이즈 |
| `health` | 1500 | 예산: 처형 3회(720) + 눈·관절·몸통 ~780. 목표 전투 시간(평균 플레이어) 4~6분(P1 90s / P2 120s / P3 90s); 숙련자 하한 ≈ 2분(혼절 쿨다운 600틱 × 4~5 사이클) |
| `weight` | heavy | 해머 넉백 0.25·폭발 0.3 감쇠 자동 |
| `speed` | 3.2 | `phases[2].speedMul 1.2` → 3.84 |
| `damage` | 30 | 공격별 `damage` 가 덮어씀 |
| `radius` / `height` | 1.6 / 3.0 | contactDist = 1.6 + 0.4 + 0.15 = **2.15m** → 옆 대시 1.75m 만으로는 돌격을 못 벗어난다 = 무적 틱 타이밍 시험 |
| `hitBox` (신규) | `{halfX 1.25, halfZ 1.85}` | 피격 AABB 재정의(충돌 반경과 분리). 없으면 기존 radius 정사각 |
| `aggroRange` / `attackRange` | 14 / **4.4** | 낫 1.8 + 어깨 피벗. 데이터 노트: `attackRange × impactRangeMul ≤ reaction.radius(4.6)` — 닿는데 패링 반경 밖인 틈 금지 |
| `alertRadius` (신규) | 18 | 포효 기상 반경 재정의(기본 `bossAlertRadius 45`). 곁방 적을 18m 밖에 두면 된다 |
| `blockCannotStagger` | true | 막기는 끊지 못함 |
| `parryOutcome` (신규) | `"expose"` | 패링이 스태거 대신 약점을 연다. `parriesToStagger`·`perfectParryOnly`·`parryAlwaysNormal` 은 **주지 않음** |
| `executeDamage` | **240** | 없으면 일반 적 즉사 경로 — 필수 |
| `hitZonesImmune` (신규) | true | 권총 부위 배율(head 1.5/limb 0.6) 제거 → 약점 아닌 모든 권총 명중 = body 0.8×; **권총(`Weapons.fire`)·화살(`Projectiles.applyProjectileHit`) 두 곳의 headshot 이벤트·headshot_kill 연출 억제**. 활 피해는 기존대로 배율 없음(1.0) |
| `hammerEyeMul` (신규) | 2.2 | 머리 내림·탈진 중 해머 타격 = 눈 피해 누적(15×2.2 = 33 = 권총 한 발). 2타면 혼절. 이 동안 해머 마무리 넉백 0(`noKnockbackWhileHeadDown`) |
| `chargeOnKnockback` (신규) | false | 해머 강타 뒤 `wantsCharge` 우회 돌격 경로를 끔(포즈·절뚝·쿨다운 무시 방지) |
| `xp` | 400 | 족장 250 |
| `drops` / `dropsOnDeath` | `["sig_moment"]` / true | 찰나(완벽 패링 슬로모) — 보스 정체성과 일치 |
| `equipDrops` (신규) | `["ring_scythe_horn"]` | 유일 반지 확정 |
| `shellPlates` (신규) | `{count 3, hpEach 60, goldMin 6, goldMax 10, ventScalePerPlate 1.15}` | 갑각판 hp 풀(§4.3) |
| `counters` | pistol best, bow best, grenade poor, melee good, magic good, deflect best | 시험방 안내용 데이터. rifle 은 미구현이라 넣지 않음 |

### 3.2 공격별 피해 (플레이어 100, 방패 칩 30% 기본) — 페이즈별 차이는 전부 `phases[].attackOverrides`

| 공격 | 피해 P1 / P2 / P3 | 막기 | 밀림 | 부여 상태 | 예고색 |
|---|---|---|---|---|---|
| 낫 베기 | 30 / 30 / 34 | 칩 9~10 + 경직 10틱 + **팔 저림** | smash 2.0m | 팔 저림(막았을 때) | 파랑 |
| 대지 돌격 | 45 / 45 / 50 | 60% 그대로(27~30) + 밀림 그대로, **막으면 진탕 없음** | 7.0m / 20틱 | **진탕**(직격만) | 빨강 |
| 들이받기 | 22 / 22 / 24 | 칩 7 | 3.5m | — | 빨강 |
| 발구르기 (P2+) | — / 24 / 28 | 칩 7, 절뚝 없음 | 4.0m | **절뚝** | 빨강 |
| 기상 발구르기 (P2+) | — / 24 / 24 | 칩 7 | 4.0m | 절뚝 | 빨강 |
| 진액 구슬 (P2+) | — / 16 / 16 | 칩 5, 진액은 붙음 | magic 2.8m | **오염 진액** | 보라 |
| 포효 (P3) | 0 | 막기 불가(방어 판정·경직 없음). 무적 8틱이면 안 걸림 | 1.5m | **위압** | 빨강 |
| 절망의 포효 (P3, ≤20%) | 0 → 연계 발구르기 28 | 같음 | **끌림 −4m** | 위압 → 절뚝 | 빨강 |
| 삼연낫 ① / ② / ③ (P3) | 34 / 34 / 40 | ①② 칩 10 + 팔 저림 · ③ 칩 12 + 팔 저림 | smash 2.0m | 팔 저림 | 파랑(③은 더 밝음+고음) |
| 꼬리 채기 (P3 광란 돌격 선회) | 12 | 칩 4, 패링 불가 | contact 0.8m | — | 빨강(꼬리) |
| 기둥 붕괴 낙석 | 40 (플레이어) / 60×0.6 = 36 (보스) | `trap_rockfall` 규약 그대로 | 2.5m | — | 함정 규약 |

체감: 낫 3~4방 사망, 돌격 2방 + 낫 1방 사망. armor_chain(0.85) 기준 한 방 더 버틴다.

### 3.3 무기별 약점 피해 (권총 11 · 활 44 · 해머 15/15/36 · 화염구 직격 기준)

| 약점 | 배율 | 권총 | 활 | 해머(특칙) | 임계 → 필요 수 |
|---|---|---|---|---|---|
| 어깨 관절 | ×2.0 | 22 | 88 | — | 내구 **132** → 권총 6 / 활 2 (노출 36틱 = 권총 최대 3 → 두 번 열어야 파열) |
| 눈 (머리 내림) | ×3.0 | 33 | 132 | 33 / 33 / 79 | 혼절 **66** → 권총 2 / 활 1 / 해머 2타 |
| 눈 (돌격 중, 6m 안) | ×3.0 | 33 | 132 | — | 눈멂 **66** → 권총 2(0·14틱) / 활 1 |
| 눈 (포효 예고 30틱, P3) | ×3.0 | 33 | 132 | — | 역류(포효 취소) **66** → 권총 2 / 활 1 |
| 배 심장 (앞발 들기 28틱) | ×3.0 | 33 | 132 | — | 역류 **66** → 권총 2 / 활 1 |
| 분출공 — 반사 자가 피격 | 고정 **33**(`deflectSelfDamage`, 배율 없음) | — | — | — | 내구 **132** → 반사 4회(볼리 2번) |
| 분출공 — 직격(열림 중만) | ×1.5 | 16.5 | 66 | — | 예고 안 **66 → 역류(취소)**; 내구 132 는 취소 2회 분 |
| 분출공 — 탈진 중 | ×3.0 | 33 | 132 | 33 | 150틱 안 4발이면 질식 — 처형(마나)과 양자택일 |

> 소총(`balance.weapons.rifle`)은 정의 스텁만 있고 발사 코드가 없다(미구현). 구현 시 약점 배율은 발당이 아니라 **초당 피해** 기준으로 재산정할 것 — 16/5틱 이 그대로면 눈 ×3.0 은 초당 576 이 된다.

---

## 4. 약점 표 (매우 중요)

약점은 몸 AABB 와 별개인 **구체**(`Entities.ts` 에 `weakPoints[]` + `weakPointWorldPos` + `rayHitsWeakPoint`). 히트스캔(권총)·화살·화염구 직격에만 배율. **해머·수류탄·폭발·빔은 약점 배율 없음**(수류탄 120×3 = 360 방지) — 단 해머는 머리 내림·탈진 중 눈 집계 특칙(`hammerEyeMul`). 명중 시 `weak_point_hit{enemyId, enemyType, id, damage, x, y, z}` → 발광 플래시·"약점!" 문구·패드 진동.

### 4.1 약점 목록

| id | 어디 | 언제 노출되나 (`exposedStates`/트리거) | 어떻게 맞히나 | 배율·내구 | 맞으면 보스가 빠지는 상태이상 |
|---|---|---|---|---|---|
| `joint_r` / `joint_l` **어깨 관절** | 어깨 구체 r0.30, 2.5m, 몸통 옆면 돌출 | ① 그 낫을 **일반 패링** → **36틱**(`exposeOnParry.normalTicks`) ② **완벽 패링** → 90틱(머리도 내려옴 — 눈과 양자택일) ③ 돌격 **완벽 회피** → 양쪽 **40틱**(`perfectDodgeExposes.ticks`) ④ 삼연낫 ①② 일반 패링 → 30틱(`comboAttack.exposeOnParry.normalTicks`) ⑤ **위압 중엔 일반 패링으로 안 열림** | 백황 맥동 동안 사격. 정면·그쪽 옆면에서만(원뿔 §4.2) | ×2.0 · hp **132**(전 페이즈 동일, 갑각 재생 때만 회복) | hp 0 → **관절 파열**: 60틱 비틀거림(`rupture.staggerTicks`) + **그 낫 잠김 600틱**(`rupture.bladeLockTicks`, 그 낫 공격이 선택지에서 빠짐). **양쪽 잠김 → 절뚝**(이속 −35%, 돌격 속도 ×0.7, `limp`) 잠김이 풀릴 때까지 |
| `eye` **눈** | 머리 앞 구체 r0.26 | **A. 머리 내림 중**(0.9m): 낫 박힘(완벽 패링) 90 / 역류 60(**혼절 누적 없음**) / 전도 90 / 탈진 150 — **B. 돌격 중**(1.1m, 플레이어와 거리 ≤ 6m 구간만, `blindRangeM`) — **C. P3 포효 예고 30틱**(머리 치켜듦) | A: 청록 맥동을 정밀 사격, 해머도 닿음(특칙). B: 15 m/s 로 다가오는 구체, 마지막 24틱. C: 위로 치켜든 눈 | ×3.0 | **A:** 한 노출 안 누적 **66 → 혼절**(`staggered` 90틱 = 처형 창, **혼절 중 눈 판정 닫힘**, 연장 없음). 혼절 종료 후 **600틱**(`dazeCooldownTicks`)은 눈이 열려도 ×3.0 피해만, 혼절 누적 없음(어두운 청록으로 표시). **B:** 누적 **66 → 눈멂**(목표 좌표 무시, 직진 +40틱 오버런 → 기둥·균열벽에 박히면 **전도** 90, 아니면 헛돌격 90). B 는 혼절 누적에 안 들어감. **눈먼 돌격도 접촉하면 45 + 진탕이 그대로** — 옆으로 비켜야 한다. **C:** 누적 **66 → 역류**(포효 취소, 위압 안 걸림, 머리 내림 60 피해만) |
| `heart` **배 심장** | 몸통 밑 구체 r0.35, 0.6m (rear 자세에서 (0, 1.15, −1.0) 로 앞·위로 나옴) | 발구르기 예고 46틱 중 **8~36틱 앞발 들기(`rearPose`)**, 절망의 포효 연계 발구르기 예고 40틱 중 8~30틱 | 낮게 조준, 근거리(빨간 범위 안에 서야 보인다) | ×3.0 | 한 노출 안 **66 → 역류**: 발구르기 **취소**(AoE 안 떨어짐, 웅덩이 안 생김) + 자해 45(`backflow.selfDamage`) + 머리 내림 60(눈 ×3.0 피해만, 혼절 누적 없음). 역류 쿨다운 600틱(`heartCooldownTicks`, 그 동안 심장은 어둡게, 판정 없음) |
| `vent` **분출공** (P2+) | 가슴 앞 구체 r0.30, 1.65m, 머리 아래 | **직격 판정은 열림 중만**: 갑각 떨기 예고·시전(volley) 중, 탈진 150틱. **반사된 구슬의 자가 피격은 항상 성립**(복귀 높이 0.6h = 1.8m 규약과 겹침) | 진액 구슬 **반사**(반응 반경 4.6m 안 접근 중인 구슬, 16 m/s 기준 ≈ 17틱 창) → 시전자 가슴으로 되돌아감. 또는 열림 중 직접 사격 | 반사 자가 피격 **고정 33** · 직격 ×1.5(예고·시전) / ×3.0(탈진) · hp **132** | 명중마다 **오염 대기 −1**(`ventHitCleanse`, 전투당 상한 −6, 오염 진액 부착 중 ×2). 갑각 떨기 예고 중 직격 누적 **66 → 역류**(시전 취소 + 머리 내림 60). hp 0 → **질식**: 갑각 떨기 **1800틱 봉인**(`choke.sealTicks`) + 봉인 동안 예고 +10틱(헐떡임) + **아레나 웅덩이 전부 증발**. 봉인 해제 시 hp 회복 |

### 4.2 약점 공통 규칙

- **판정 우선순위(구체 승):** 레이가 구체에 맞고 **`facing` 원뿔 조건**을 만족하면 AABB 보다 우선한다 — 관절·심장이 몸 AABB 안에 있어도 맞는다. 원뿔 조건: 약점마다 데이터 `facing`(단위 벡터, 로컬)과 `coneDeg`(기본 100°)를 두고 `dot(rayDir, facing) ≤ −cos(coneDeg/2)` 일 때만 성립. 눈·분출공·심장 `facing (0,0,−1)`(정면 반구), `joint_r (1, 0.4, −0.4)`/`joint_l (−1, 0.4, −0.4)`(그쪽 옆·앞). **등 뒤에서 몸을 뚫고 눈을 맞힐 수 없고, 오른쪽에서 왼 관절을 맞힐 수 없다.** AABB 미명중(t_aabb = null)이면 구체 단독으로 성립(+∞ 취급). 테스트: 정면 → 눈 ×3 / 후면 → 몸통 0.8× / 우측면 → joint_r ○·joint_l ×.
- **노출 아닐 때는 판정 자체가 없다** → 몸통 0.8× 로 떨어진다. 노출 종료 시 `exposure_closed{id, hits}` 발행(활용률 계측용, 벌칙 없음).
- **패드 조준 보조:** 기본은 실루엣 자석만. 옵션 `balance.input.gamepad.aimAssist.weakPointRadiusMul 1.35` 로 노출 중 약점 구체를 후보에 추가(결정 24).
- **jumpY 버그 동반 수정:** 부위 높이 비율이 `jumpY` 를 빼지 않는 기존 버그를 `weakPointWorldPos` 에서는 처음부터 포함하고, 권총·화살 헤드샷 비율도 같은 손질에서 고친다.
- 투사체(화살·화염구 직격)는 `moveProjectiles` 플레이어 소유 루프에서 `rayHitsWeakPoint(pad = proj.radius)` 를 함께 검사해 `applyProjectileHit` 에 `weak` 로 전달. 반사된 진액 구슬은 kind `'goo'` + `deflected` 면 vent 에 `deflectSelfDamage` 를 적용(배율 무시).

### 4.3 등갑판 — 약점이 아닌 '무거운 타격' hp 풀 (경제 접목)

| 항목 | 값 |
|---|---|
| 판 3장, 각 hp 60 (`shellPlates.hpEach`) | **판정 볼륨이 아니다.** 해머 강타(3타)·수류탄·폭발·낙석이 **보스 몸에 들어갈 때마다** 그 피해만큼 판 hp 풀을 깎는다(위치 무관). 총·화살은 판에 아무 영향 없음 — 몸통 0.8× 그대로(튕김 규칙 없음) |
| 파괴 시 | 60 마다 한 장 → 골드 파편 주머니 6~10g(`pouchTier` 일반) + `plate_broken{gold}` + 파편 연출. 판 밑 균열이 커져 분출공 구체 크기 ×1.15/장(`ventScalePerPlate`) |
| 시한 | **P2 안에서만.** P3 진입 시 남은 판은 골드 없이 탈락(시간 압박) |
| 목적 | 정밀 무기(약점)와 무거운 무기(판)의 역할 분리. 수류탄·해머에 보스전 사용처 |

---

## 5. 보스 상태이상 정의 (12종)

이벤트는 전부 `boss_status{enemyId, kind, on}` 하나로 낸다(개별 이벤트 없음). 표시 열은 발광·동작·소리만.

| 상태 `kind` | 원인 | 지속(틱) — 필드 | 효과 | 표시 |
|---|---|---|---|---|
| **관절 노출** `expose` | 일반 패링 / 완벽 패링 / 완벽 회피 / 삼연낫 일반 패링 | 36 / 90 / 40(양쪽) / 30 — `exposeOnParry.*`, `perfectDodgeExposes.ticks`, `comboAttack.exposeOnParry` | 관절 구체 판정 활성 | 백황 맥동 + `joint_open` |
| **관절 파열** `rupture` | 관절 hp 0 | 비틀거림 60(`rupture.staggerTicks`, recover) → 그 낫 잠김 600(`rupture.bladeLockTicks`) | 잠긴 낫 공격 선택 불가(예측 가능해짐), 잠긴 낫은 축 늘어져 바닥을 긁음. 잠김이 풀려도 관절 hp 는 0 이라 **그 낫 패링·완벽 회피로 다시 열리지 않는다**(`openExposure` 가 hp 0 을 거름 — 갑각 재생까지). 파열은 낫 짝이 있는 관절만 — 분출공 hp 0 은 질식 | 관절 어둡게 + 파편 + `joint_crack` |
| **절뚝** `limp` | 양 낫 동시 잠김 | 잠김이 하나라도 풀릴 때까지 | 이속 ×0.65(`limp.speedMul`), 돌격 속도 ×0.7(`limp.chargeSpeedMul`), 낫 없이 들이받기·발구르기·돌격만. 뒤로 물러나 2.5~6m 유지(`retreatWhenDisarmed{min 2.5, max 6}`) | 다리 절룩 애니 |
| **머리 내림** `head_down` | 낫 박힘(완벽 패링) / 역류 / 전도 / 탈진 | 90 / 60 / 90 / 150 — `headDown.{stuck, backflow, topple, exhaust}Ticks` | 이동·공격 불가, 눈 노출(0.9m), 해머 타격 = 눈 집계(`hammerEyeMul`), 해머 넉백 0. 역류 원인이면 혼절 누적 없음 | `blade_stuck` + 머리 0.9m |
| **혼절** `daze` | 눈 누적 66(`dazeThreshold`) | 90(`reaction.staggerTicks`) → 이후 600 쿨다운(`dazeCooldownTicks`) | `staggered` — 처형 가능, **눈 판정 닫힘**, 이름표 금색. 해머 3타 날림(5m) 면제(`staggerFlingImmune`, 결정 33) | STAGGER_COLOR + "지금 처형" + `eye_burst` |
| **역류** `backflow` | 심장 66(발구르기 예고) / 분출공 66(갑각 떨기 예고) / 눈 66(포효 예고) | 60 (`headDown.backflowTicks`) | 시전 **취소**(AoE·구슬·위압 없음) + 자해 45(`backflow.selfDamage`, 심장 원인만) + 머리 내림 60(눈 ×3.0 피해만). 심장 원인은 쿨 600 | 몸 들썩·고꾸라짐 + `vent_gag` |
| **눈멂** `blind` | 돌격 중(≤ 6m) 눈 66(`blindThreshold`) | 남은 질주 + 40 오버런(`blindOverrunTicks`) | 목표 좌표 무시, 직진, 조향 없음. 접촉 피해는 그대로 | `pose blind`(머리 휘저음) + 비명 |
| **전도** `topple` | 돌격(눈멂 포함)이 기둥 `P`·균열벽 `C` 에 박힘 | 90 (`headDown.toppleTicks`) | 머리 내림(눈 노출, 혼절 누적 가능, `head_down{cause 'topple'}`) + 박힌 몸이 `headDown.toppleReboundM` 2.5m 튕겨 물러남(내려온 눈 z −1.9 가 몸 반경 1.6 보다 앞이라 그대로면 눈 구체가 기둥 안에 묻힌다 — 기둥 앞에 서서 쏜다) + 기둥 내구 −1(`pillar_hit`) / 균열벽 개방 | 몸 처박힘 + `heavy_hit` + 카메라 킥 |
| **미끄러짐** `skid` | 완벽 회피(무적 8틱 안 접촉) | 90 (`skid.ticks`) | 이동·공격 불가, 양 관절 40 노출, (P2+) 궤적에 웅덩이 | `pose skid` + `charge_dodged` |
| **질식** `choke` | 분출공 hp 0 | 1800 (`choke.sealTicks`) | 갑각 떨기 봉인, 봉인 중 예고 +10틱(`choke.windupPenalty`), 웅덩이 전부 증발. 갑각 재생으로 안 풀림. 종료 시 분출공 hp 회복 | 분출공 꺼짐 + 거친 숨 |
| **탈진** `exhaust` (P3) | 삼연낫 3연속 완벽 패링 | 150 (`headDown.exhaustTicks`) | 머리 내림 + 분출공 ×3.0 동시 노출 — **처형(마나) vs 정화(오염·봉인) 선택** | 양낫 박힘 + 헐떡임 |
| **갑각 재생** `molt` | 페이즈 전환 | 90 (`phaseShiftTicks`) | 관절 hp 회복(`weakHp` 132 + `ruptured[id]` 표식 삭제 — 재생된 관절이 다시 0 이 되면 다시 파열)·낫 잠김·절뚝 해제, 쿨다운 절반. 질식·눈멂·전도는 해제 안 함 | 포효 자세 + 균열/탈락 연출 |

반캠핑 자발 박치기(§9.4)의 실신 30틱(`arena.pillarStunTicks`)은 상태가 아니라 짧은 recover 다(눈 노출 없음).

---

## 6. 새 플레이어 상태이상 (5종)

**소유:** 다섯 카운터 전부 `PlayerState` **옵셔널**(`numbArmTicks?`, `hobbleTicks?`, `concussionTicks?`, `corrosiveTicks?`+`corrosiveAccum?`, `cowedTicks?`), **감소·DoT·pending 가산은 새 `src/systems/Status.ts` 한 곳에서만**(규칙 2). 다른 시스템(Enemies/Projectiles/Hazards)은 값을 **세우기만** 한다(`stunTicks` 규약과 동일). `p.dots`(Traps.tickDots 소유)는 쓰지 않는다. 지속·배율은 `balance.status.*`. HUD 는 `#buffs .debuffs` 아이콘(`#buff-burn` 블록 복제) + `${kind}_applied/_ended` 이벤트(기존 poison/burn 규약과 동일) → 안내 문구. 부활·층 이동·시험방 진입 시 전부 해제(`loadFloor` 에 명시).

**공통 상한:** `balance.status.maxConcurrent 2` — 세 번째가 걸리면 가장 오래된 것이 해제된다. **어느 상태도 회피 거리·무적 틱을 건드리지 않는다**("언제나 반응 버튼으로 답할 수 있다").

| id / 이름 | 원인 | 효과 | 지속 | 해제 |
|---|---|---|---|---|
| `numb_arm` **팔 저림** | 낫 공격을 **방패로 막음**(칩 30%·경직 10틱은 기존대로) | **완벽 패링 불가**(대역 0 — 정직하게 "저림 중엔 일반만") · 방어 이속 0.35→0.25. 패링 버퍼는 그대로(8). 저림 중 패링 실패의 마나 소실 면제(`numbArm.noManaLossOnFail`) | 240 | 시간 경과 **또는 일반 패링 1회 성립 시 즉시** — "패링하면 풀린다" |
| `hobble` **절뚝** | 발구르기 직격(막으면 안 걸림) | 회피 스태미너 ×2 · 질주 불가 (회피 거리는 그대로) | 300 | 시간 경과 |
| `concussion` **진탕** | 돌격 **직격**(막으면 안 걸림 — 막기는 이미 60% 피해·7m 밀림으로 충분히 벌받는다) | 조준 흔들림(`aimShake` amp 0.02, 박쥐 채널 재사용) · 화면 기울기 3° · **예고음 외** 오디오 덕킹 −6dB(`concussion.duckDb`; 텔레그래프 버스는 우회 — 로패스 없음, 파랑 예고음 1760/2637Hz 보존) | 360 | 시간 경과 또는 체력 물약(결정 22 — 물약 정의의 `cures: ['concussion']` × `concussion.potionCures`; 말린 고기는 지우지 않는다) |
| `corrosive` **오염 진액** (P2+) | 진액 웅덩이 위 / 진액 구슬 직격(막아도 붙음, 거미줄처럼) | 이속 ×0.6 · DoT 2/30틱(`corrosive_tick`, player_damaged 안 냄 — 도트 규약) · **오염 대기 +1 / 60틱**(전투당 상한 +8, 카운터는 보스 `EnemyState.fightPendingIn` 에, 부활 시 리셋) · 부착 중 분출공 정화 ×2 | 웅덩이 위 + 30(`lingerTicks`) | 웅덩이에서 나감. 웅덩이는 **불**(화염구·불붙은 기름) 즉시 증발 / 질식 시 전부 / 자연 480틱 |
| `cowed` **위압** (P3) | 포효 12m 안(피해 없음, 방어 판정 없음, 무적 8틱이면 안 걸림) | **일반 패링이 관절을 열지 못함**(완벽만) · 일반 패링 마나 11→5 | 360 | 시간 경과 또는 **완벽 패링 1회** |

기존 상태 재사용: 밀림(`playerKnockback`, 공격별 재정의), 방어 경직(`clashPlayerStunTicks`), 패링 실패 경직(`failStunTicks`), 조준 흔들림(`aimShakeTicks/Amp`). **넉다운은 채택하지 않음**(진탕으로 대체, 결정 21).

---

## 7. 페이즈별 공격·스킬 표 (매우 중요)

공통: 낫 공격은 `windup → active_perfect(6) → active_normal(12) → impact → recover` 기존 파이프(hitOnContact 아님 — 순수 타이밍 창). 완벽 = 낫끝이 방패에 닿는 0.4m 대역. 예고는 **동작·발광·소리**만. 공격 슬롯과 `attackMode`: `attack`(오른낫) / `attackAlt`('alt', 왼낫) / `closeAttack`('close') / `chargeAttack`('charge', P3 는 `chain` 플래그) / `slamAttack`('slam') / `volleyAttack`('volley') / `roarAttack`('roar') / `comboAttack`('combo').

### P1 「돌각(突角)」 — 체력바 3칸째 (100~67%) · 두 박자 익히기

| 공격 | 예고(동작 · 발광 · 소리) | 판정 | 피해 · 밀림 | 디버프 | 대응 |
|---|---|---|---|---|---|
| **오른낫 베기** `blade_r` (`attack`) | 오른 어깨 관절이 솟고 낫이 뒤로(pullback 0.3), 32틱 · 낫 파랑 · `telegraph_blue` + `blade_whistle` | 호 110°, 사거리 4.4(`impactRangeMul 1.0`), 낫끝 전진 | 30 · smash 2.0m | 막으면 칩 9 + 경직 10 + **팔 저림** | 패링(완벽 → 낫 박힘·눈 / 일반 → 관절 36틱). 못 하면 **뒤/대각 대시**(옆 1.75m 로는 110° 호를 못 벗어남) |
| **왼낫 베기** `blade_l` (`attackAlt`) | 좌우 대칭, 예고 **28틱**(조금 빠름 — 어느 어깨가 솟는지 읽어야 한다) | 같음 | 30 | 같음 | 같음. 두 낫은 교대(`alternate`), 잠긴 낫은 건너뜀 |
| **대지 돌격** `charge` (`chargeAttack`) | 머리 낮추고 몸통 −12° 웅크림, 앞발로 땅 긁기 `charge_ready` + `behemoth_snort`, 50틱 · 뿔·몸 빨강 | `hitOnContact`, 15 m/s × **72틱 = 18m** 고정 목표 질주(minRange 4.5 / maxRange 15 → 미달 없음), 접촉 2.15m. **플레이어 6m 안에서 눈(1.1m) 노출** | 45 · 7m/20틱. 막아도 60%·7m | **진탕**(직격만) | ① **완벽 회피**(접촉 순간 무적 8틱 안) → 미끄러짐 90 + 양 관절 40 ② **눈 66** → 눈멂 → 기둥·균열벽에 박히게 유도 → 전도 90(눈) — 단 몸은 비켜야 한다 ③ 안전책: 예고 중 미리 3m 이상 옆으로 걸어 두기(보상 없음). 우선순위: 완벽 회피(미끄러짐) > 눈멂(전도/헛돌격) > 헛돌격. 지형별 결과는 §9.3 |
| **들이받기** `headbutt` (`closeAttack`) | 머리를 홱 뒤로 젓기 22틱 · 뿔 빨강 · 짧은 콧김 | 3.0m 안(`closeAttack.maxRange`)에 있을 때, hitOnContact, 쿨 240 | 22 · 3.5m | — | 뒤 대시. 배 밑에 눌러앉는 플레이 방지 |

리듬: 낫(파랑) 2~3회 → 돌격(빨강) 1회 → 다시 낫. 거리 4.4~4.5m 사각은 0.1m — 해머 사거리(3.1 + 1.6 = 4.7)에 서면 돌격(≥ 4.5) 이 온다.

### P2 「오염 갑각」 — 체력바 2칸째 (67~34%) · 반사와 탐욕

등갑판 사이 녹색 균열, 분출공 점등, 갑각판 hp 풀 활성(골드). P1 공격 전부 유지 + 아래.

| 공격 | 예고 | 판정 | 피해 · 밀림 | 디버프 | 대응 |
|---|---|---|---|---|---|
| 낫 베기 | 같음 | 같음 | 30 | 낫끝 착지점에 **진액 웅덩이** r1.6 · 480틱(`hazards.pools.blade`) | 패링은 웅덩이도 막는다(맞은 자리가 없으니). 웅덩이는 불로 지움 |
| **발구르기** `stomp` (`slamAttack`) | 앞발 들고 몸통 +35°(**배 심장 진홍 맥동**, `rearPose{from 8, to 36}`), 46틱 · 앞다리 빨강 · 땅울림 `stomp_ready` → 착지 `ground_slam` | 원형 `aoeRadius 5.0`(각 무시). 착지점 웅덩이 r2.0. minRange 2.5 / maxRange 6 / 쿨 420 | 24 · 4m. 막으면 칩 7, 절뚝 없음 | **절뚝** | ① 예고 8~36틱에 **심장 66** → 역류(취소 + 자해 45 + 머리 내림 60) ② 반경 밖으로 걸어 나가기 또는 막기. 뒤 대시는 항상 나간다(최소 거리 2.0 + 3.5 = 5.5 > 5.0) — 단 **절뚝 중(대시 거리 그대로, 스태미너 ×2)엔 스태미너가 없을 수 있으니 막기** |
| **갑각 떨기** `shake` (`volleyAttack`) | 몸 전체 진동·등갑판 덜그럭 `vent_hiss`, 48틱 · 분출공 보라·크기 ×1.4 · `telegraph_purple` | 진액 구슬 3발, 24틱 간격, 속도 16, r0.35, kind `'goo'`, `deflectable`·`breakable`, minRange 6, abortRange 4, 쿨 540. 착탄 웅덩이 r1.2 | 16/발 · magic 2.8m | **오염 진액**(막아도 붙음) | **반사** → 분출공 고정 33 → 4회(볼리 2번)면 질식. 예고 중 **분출공 직격 66 → 역류**(취소). 또는 옆 대시(구슬 폭 0.35) |
| 대지 돌격 | 같음, 쿨다운 420→360 | 같음 | 45 | 진탕 + 미끄러진 자리에 웅덩이 | 같음 |
| 들이받기 | 같음 | 같음 | 22 | — | 같음 |
| **기상 발구르기** `wake_slam` | **머리 내림(모든 원인)·혼절·탈진**이 끝나며 일어설 때 확정(미끄러짐 뒤는 아님). 예고 30틱(`wakeSlam.windupTicks`), **앞발을 낮게 들어 심장 안 보임** | aoe 5.0 | 24 · 4m | 절뚝 | 처형 넉백(6.5m) 뒤면 이미 밖. **머리에 붙어 때렸는데 눈 66 을 못 채운 근접 플레이어를 밀어내는 벌칙(의도)** — 머리 내림 종료 전에 물러날 것 |

리듬: 멀면 갑각 떨기(반사 시험), 중거리 발구르기(탐욕 시험), 붙으면 낫(패링 시험). 웅덩이가 발판을 조여 "제자리 패링"을 못 하게 한다 — 기름 함정 2곳·화염구·분출공 질식이 정화 수단.

### P3 「광란 — 낫의 폭풍」 — 체력바 1칸째 (34~0%) · 완벽 패링 압박

등갑판 탈락(남은 판 골드 없이 파편), 눈 상시 붉은 홍채, 이속 ×1.2, 공격별 피해 상향(표), 돌격 쿨 300. 갑각 떨기는 질식 봉인 중이 아니면 유지. **P3 진입은 `phase_shift`(갑각 재생) 만 — 복귀 후 첫 선택이 포효**(취소 가능).

| 공격 | 예고 | 판정 | 피해 · 밀림 | 디버프 | 대응 |
|---|---|---|---|---|---|
| **포효** `roar` (`roarAttack`) | 머리 치켜들고 입 벌림 30틱(**눈이 위로 드러남**) · 몸 전체 빨강 · `boss_roar` + 카메라 킥 | 12m 원(`roarAttack.aoeRadius`), **impact 파이프를 타지 않는 별도 분기**: 피해·방어 판정·player_damaged 없음, 무적 8틱이면 안 걸림. P3 복귀 직후 + 1200틱마다(`roarAttack.intervalTicks`) | 밀림 1.5m | **위압** 6초 | ① 예고 중 **눈 66 → 역류**(포효 취소) ② 무적 타이밍 회피(빨강 = 회피 문법 유지) ③ 걸렸으면 완벽 패링 1회로 해제 |
| **절망의 포효** `roar_pull` | 체력 ≤ 20%(`roarAttack.despairHealthFrac 0.2`, 300) 이면 포효가 이 변형으로. 예고 36틱, 입에서 보라 기운 | 12m 원 **끌림 4m**(`pull`, `pushPlayer` 음수) → **발구르기 즉시 연계**(`followUp: 'slam'`, 예고 40, `rearPose{8, 30}` 심장 노출 있음) | 끌림 뒤 stomp 28 · 4m | 위압 + 절뚝 | 끌리기 전 뒤 대시, 또는 끌려가며 심장 66 → 역류로 발구르기 취소. **처형 240 ≤ 300 이므로 절망의 포효 뒤 첫 처형(또는 눈 66 + 처형)이 마무리** |
| **삼연낫** `triple` (`comboAttack`) | ① 오른낫 28틱 → ② 왼낫 22틱 → ③ **양낫 내려찍기** 36틱(두 낫 머리 위 45°, 파랑이 더 밝고 `telegraph_blue` 고음) | ①② 호 110° · ③ 원형 `aoeRadius 3.2`, ③은 **완벽 전용**(`perfectOnly`, `noParryBuffer` — 실효 창 ≈ 완벽 대역 0.4m ≈ 2~3틱). 쿨 600 | 34 / 34 / 40 | 막으면 팔 저림 | 아래 소표. **3연속 완벽 → 탈진 150틱**(눈+분출공 ×3.0) → 처형 240 또는 정화·질식 |
| **광란 돌격** `double_charge` (`chargeAttack` + `chainCharge`) | 돌격 예고 40틱(빨강) → 18m 질주 → **제자리 선회 24틱 = 2차 예고**(꼬리·뿔 빨강, 회전 소리 `tail_whirl`) → **두 번째 질주**(플레이어 새 위치로, 예고 없이 선회에서 바로) | 같음 ×2, 두 질주 모두 6m 안 눈 노출. 선회 중 **꼬리 채기** r2.5(`chainCharge.tailRadius`), 패링 불가, 막기 칩 | 50 · 7m / 꼬리 12 · contact 0.8m | 진탕 | 두 번 회피. 첫 회피가 완벽이면 두 번째는 안 온다(미끄러짐 우선). 첫 질주에서 눈멂이면 두 번째도 없음. 선회 중엔 2.5m 밖으로 |
| 발구르기 (강화) | 같음 | aoe 5.5(`attackOverrides.slam.aoeRadius`) | 28 | 절뚝 + 웅덩이 | 심장 사격이 여전히 정답 |
| 낫 베기 · 들이받기 · 갑각 떨기 | 유지(삼연낫 쿨다운 중 단발) | | 34 / 24 / 16 | | |

**삼연낫 입력 × 결과 소표** (`continueOnParry`: 패링해도 콤보는 이어진다)

| 타 | 완벽 패링 | 일반 패링 | 막기 | 미입력/피격 | 일반 대역에 누름(③ 전용) |
|---|---|---|---|---|---|
| ① 오른낫 | 콤보 계속 · `joint_r` 60틱 · 완벽 카운트 1 | 콤보 계속 · `joint_r` 30틱(위압 중 없음) | 칩 10 + 경직 10 + 팔 저림 · 콤보 계속 | 34 · 콤보 계속 | — |
| ② 왼낫 | 콤보 계속 · `joint_l` 60틱 · 완벽 카운트 2 | 콤보 계속 · `joint_l` 30틱 | 같음 | 34 · 콤보 계속 | — |
| ③ 양낫 내려찍기 | 완벽 카운트 3 → **탈진 150** / 미달 → **머리 내림 90**(단발 완벽과 같음) | (성립 안 함) | 칩 12 + 팔 저림 | 40 + smash 2m | **패링 실패**(기존 규약: 경직 20 + 마나 절반, 팔 저림 중이면 마나 면제) → 40 피격. 대응은 완벽 / 막기 / 뒤 대시(3.2 밖) |

마무리: 처형 240 은 체력 ≤ 240(16%) 이면 곧 마무리다 — 별도 처리 없이 "마지막 완벽 패링 → 눈 66 → 처형" 으로 끝난다.

---

## 8. 페이즈 전환 — 조건·큐잉·연출

| 항목 | 내용 |
|---|---|
| **조건** | `healthBarState(def, health).index` 가 이전 틱과 달라진 순간(칸이 비는 순간). `Enemies.ts` 가 이전 index 를 `enemy.phase` 에 두고 비교 → `boss_phase{enemyId, phase}` 발행. 페이즈 시스템이 없으므로 이 훅이 신규 |
| **큐잉** | `staggered`·`head_down`·`skid`·`blind`·처형 넉백 중에 칸이 비면 **`phaseTarget`(목표 index)** 를 갱신만 하고 `chase` 복귀 시 한 번의 `phase_shift` 로 발동 — 플레이어의 처형·노출 창을 빼앗지 않는다. 한 창 안에서 두 경계를 넘으면(예: 눈 132 + 처형 240) `unlock` 을 누적 적용해 P2 를 건너뛴 P3 로 간다(연출은 P3 것) |
| **전환 상태** `phase_shift` | recover 90(`phaseShiftTicks`) + `pose roar`. 진행 중 공격 취소, 약점 전부 닫힘, **갑각 재생**(관절 hp 회복 + `enemy.ruptured[id]` 삭제·낫 잠김·절뚝 해제 — 질식·전도·눈멂은 유지), 쿨다운 절반. 무적은 아니다(몸통 0.8× 는 들어간다). **위압은 걸지 않는다** |
| **P1→P2 연출** | `boss_roar` + 등갑 균열 발광 점등 + 분출공 점등 + 문구 "갑각이 갈라진다" + HUD 보스 줄 페이즈명("낫뿔 거수 — 오염 갑각") |
| **P2→P3 연출** | 남은 등갑판 `spawnDeathBurst`(power 0.6) 로 튕겨 나감(골드 없음) + `plate_shed` + 눈 붉게 + 문구 "거수가 광란한다". 복귀 후 **첫 선택 = 포효**(예고 30, 취소 가능) |
| **데이터** | `phases: [ {bar 3}, {bar 2, unlock ['slam','volley','wakeSlam'], poolsOn true, shellPlatesOn true, attackOverrides {charge {cooldownTicks 360}}}, {bar 1, speedMul 1.2, unlock ['roar','combo','chainCharge'], shedPlates true, firstPick 'roar', attackOverrides {attack {damage 34}, attackAlt {damage 34}, close {damage 24}, charge {damage 50, cooldownTicks 300}, slam {damage 28, aoeRadius 5.5}}} ]` — 전역 damageMul 없음, 슬롯별 명시 |

---

## 9. AI 규칙

### 9.1 오버라이드 (기존 순서 유지, 신규 삽입)

넉백 > brace > attackFreeze > **`phase_shift` / `head_down` / `skid` / `stunned` / `blind`(포즈 타이머)** > 돌격 캔슬 > notice. `wantsCharge` 우회(해머 강타 뒤)는 `chargeOnKnockback false` 로 이 보스에서 끔.

### 9.2 chase 선택 우선순위

1. **P3 포효**: P3 복귀 직후 첫 선택 + 1200틱 간격, 다른 공격보다 우선. 체력 ≤ 20% 면 절망의 포효.
2. **기상 발구르기**(P2+): `head_down`(전 원인)/`staggered`/`exhaust` 종료 직후 확정(심장 안 열림).
3. dist ≤ 3.0 → 들이받기(쿨 240), 아니면 낫.
4. dist ≤ 4.4 → 낫. P1/P2: 오른·왼 교대(잠긴 낫은 건너뜀). P3: 삼연낫(쿨 600) 우선, 아니면 단발.
5. 2.5 < dist ≤ 6, P2+, 발구르기 쿨(420) → 발구르기.
6. 4.5 ≤ dist ≤ 15, 돌격 쿨(P1 420 / P2 360 / P3 300), LOS → 돌격(P3: 광란 돌격). 절뚝 중엔 속도 ×0.7.
7. dist ≥ 6, P2+, 갑각 떨기 쿨(540), **질식 봉인 아님**, LOS → 갑각 떨기.
8. 그 외 추격(걷기). 보스는 engage 상한 무시(기존).
- 양 낫 잠김(절뚝) → 4번이 비어 붙으면 들이받기·발구르기만 — 뒤로 물러서며 2.5~6m 유지(`retreatWhenDisarmed`).
- 돌격 목표는 예고 종료 좌표에 고정(기존). 눈멂이면 목표 무시·직진 +40틱.
- **이동·돌격 목표는 `arena.bounds` 안으로 클램프**(`Arena.ts` 가 World 에 bounds 를 두고 Enemies 가 읽음) — 균열 상자 벽감·관문 밖으로 나가지 않는다. 노출 낭비 벌칙은 두지 않는다(해머·무탄 플레이어 오탐).

### 9.3 돌격 종료 — 지형·대상별 결과 (아레나 접목)

| 부딛힌 것 | 결과 |
|---|---|
| 플레이어(무적 아님) | 45 + 진탕 + 7m 밀림 → recover. 눈멂 중이어도 동일 |
| 플레이어(무적 8틱 안 접촉) | **완벽 회피** → 미끄러짐 90 + 양 관절 40 + `charge_dodged` (눈멂보다 우선) |
| 일반 벽 `#` · 문 · 문설주 | 헛돌격 60(`chargeAttack.wallWhiffRecoverTicks` — 플레이어를 놓친 헛돌격 `whiffRecoverTicks` 90 과 구분, `enemy_whiffed{wall}`) — 박히지 않음, 눈 안 열림 |
| **기둥 `P`** | **전도** 90(눈 노출) + `toppleReboundM` 튕김 + 기둥 내구 −1 (3회 → 붕괴: `trap_rockfall` 규약 낙석 40/보스 36 + 잔해 — B3-5. B2-5 는 `pillar_hit{row, col}` 만 낸다) |
| **균열벽 `C`** | **전도** 90 + 균열벽 개방(`World.breakCrackWalls` 헬퍼 — 보물 벽 개방, 수류탄 대체 루트) |
| 잔해(붕괴 기둥) | 헛돌격 60 — 진로는 막지만 박히지 않음('연한 기둥'), 총알·시야 통과 |
| 눈멂인데 아무것도 안 부딛힘 | 오버런 40틱 뒤 헛돌격 90(긴 후딜, 관절 안 열림) |
| 충돌 판정 | `charging` 중 이동량 < 기대 30% 가 **2틱 연속**(`chargeStuckTicks 2`, 기존 unstick 기대치 재사용). 부딛힌 셀 문자로 결과 분기 |

### 9.4 반캠핑

| 조건 | 반응 |
|---|---|
| 플레이어를 LOS 없이 **300틱**(`anticampNoLosTicks`) 못 봄(기둥 뒤) | 마지막으로 시야를 가린 **그 기둥으로 돌격**(자발 박치기: 기둥 내구 −1, 실신 30틱만, 눈 안 열림, `anticamp_charge`) — 숨을 곳을 소모시킨다 |
| LOS 있으나 12m 밖 **480틱**(`anticampFarTicks`) | 8m 안에 들 때까지 접근 이속 ×1.5(`anticampSpeedMul`) + 돌격 쿨 즉시 리셋 + (P3) 포효 간격 리셋 — maxRange 안에 들어오는 순간 돌격이 실제로 나간다 |
| 균열벽 뒤 상자 벽감에 들어감 | 보스는 bounds 클램프로 벽감 안에 목표를 잡지 않고 벽감 입구 앞(bounds 경계)까지만 따라와 들이받기 시도(3.0m) — 벽감 깊이 1칸(4m)이라 안쪽 끝은 안전 |

---

## 10. 아레나 — 「무저갱 우리」 (신규 층 `z01_f4`)

### 10.1 격자 (보스방 부분, 11×9 셀 = 44×36m, 천장 4m)

```
######X######      X 출구 벽감(북, 보스 뒤) — 사망 시 쇠창살 상승(자동)
#...........#
#.....B.....#      B 보스 스폰(잠들어 있음, alertRadius 18)
#..P.....P..#      P 기둥(내구 3, 4×4m 단일 셀)
#...........#
#O.........O#      O trap_oil (진액 웅덩이 정화 수단, 보스도 0.55 둔화)
#...........#
#..P.....P..#
C...........C      C 균열벽 → 뒤 1칸 벽감에 상자 — 폭발 또는 돌격 전도로 개방
#...........#
######D######      D 남쪽 문(손으로 여는 문) — 플레이어 진입 시 봉쇄(arena_sealed), 출구 해제 시 재개방
```

| 요소 | 값·규약 |
|---|---|
| 기둥 `P` ×4 | **새 격자 문자** `P`(SOLID, 4×4m). 렌더: Box 4×4×4 밝은 돌 0x8a8378 + 정 자국 띠, 내구 단계마다 붉은 균열선 1→2→3. 위치 (3,3)(9,3)(3,7)(9,7) → 기둥 사이 24m/16m 돌격 레인. `balance.arena.pillarHp 3` |
| 기둥 붕괴 | `fireRockfall` **규약 복제**(`Arena.ts` 가 `addBlocker`+`setPathBlocked` 직접 호출 — Traps import 금지): 낙석 40/보스 36(`bossDamageMul 0.6` 을 balance 에 신설), `rubbleHalf 1.7`. 잔해는 `rubbleBreakable`(수류탄으로 치울 수 있음) |
| 기름 함정 `O` ×2 | `trap_oil` 그대로. 화염구·불붙은 기름으로 웅덩이 즉시 증발 |
| 균열벽 `C` ×2 | 뒤 1칸 벽감(chest 엔티티 — `triggers.reward` 는 코드가 안 읽으니 쓰지 않음). 폭발 또는 전도로 개방. 열린 C 는 4m 통로지만 **bounds 클램프**로 보스가 들어오지 않는다 |
| 입구 `D` | 손으로 여는 문(레버 불필요). **봉쇄 조건 = 보스 각성 && 플레이어 위치가 `arena.bounds`(레벨 JSON, 셀 범위) 안** → `arena_sealed` → 새 `src/systems/Arena.ts` 가 문을 `closing` 으로 세우고(`Door.tick` 규약 — `bodyInDoorway` 면 비켜날 때까지 기다림) 닫힌 뒤 `door.sealed = true`(신규 필드, E 무시) + 쇠창살 연출(출구 창살 빌더 재사용). **밖에서 깨웠으면**(총격·소음) 보스는 chase 대신 홈 셀(B)로 복귀·대기(`holdUntilEntered`)하고 플레이어가 경계를 넘는 틱에 봉쇄. `exit_unlocked` 에 `sealed=false` + `arena_opened`. 부활 시 봉쇄 해제(적 재스폰과 함께) |
| 출구 `X` | 북 벽감. `Exit.tick` 폴링 → def.boss 사망 → 쇠창살 상승(자동) |
| 제단 | 아레나 앞 로비(안전반경 10m 밖). 상점에서 탄·수류탄·물약을 사는 것이 이 보스의 준비 |
| 층 골격 | 시작 3×3 무적 방 → 로비(제단) → 복도 → 문 D → 아레나. 곁방 적은 B 에서 **18m 밖**(`alertRadius`). carve 스크립트 생성 후 헤드리스 스크린샷 검증. `Zone.test.ts` 갱신은 §10.3 |
| FloorState | 봉쇄 상태는 `door.sealed`(doors 배열에 보존) + Level grid 로 자동 보존. 기둥 내구는 `FloorState.arena{pillarHp[]}` 신규 |

### 10.2 웅덩이(P2+) 규칙 — `src/systems/Hazards.ts` 신규 (`balance.hazards.pools`)

| 원인 (`pools.*`) | 반경 | 지속 |
|---|---|---|
| 낫 베기 착지점 `blade` | 1.6 | 480 |
| 발구르기 착지 중심 `stomp` | 2.0 | 480 |
| 진액 구슬 착탄 `orb` | 1.2 | 480 |
| 미끄러짐 궤적 `skid` | 1.6 | 480 |
| 증발 | 불(화염구 폭발·불붙은 기름) 즉시 / 질식 시 전부 / 자연 만료. 동시 상한 12개(`poolMax`, 오래된 것부터 소멸) |

Hazards 는 웅덩이 생성(`spawn_pool` 이벤트 수신)·증발·접촉 검사만 하고, 접촉 시 `p.corrosiveTicks = max(현재, lingerTicks)` 를 세운다. 감소·DoT·pending 은 Status.ts.

### 10.3 Zone.test 와 곁방 로스터

`Zone.test.ts` 는 ZONE 을 3층으로 고정하고(`['z01_f1','z01_f2','z01_f3']`) 층마다 비보스 HP·정예 비율 단조 증가, 밀도 비 < 2.5 를 요구한다. 실측 f3 비보스 HP 2,332·정예 0.59 라 그대로면 f4 에 정예 30여 마리가 필요하다 — 1:1 결투와 충돌. **결정 12** 로 승격:
- ★ (a) `Zone.test` 에 "보스 결투 층(`bossArena: true`) 은 난이도 곡선·밀도 비교에서 제외" 예외 + ZONE 4층 + "`scythe_behemoth` 는 f4 에만" 검사 추가. 로비·곁방은 최소 로스터(창병 3·궁수 2·구울 2·거미 2 = 9, 전부 B 에서 18m 밖)만 둔다.
- (b) 대안: 곡선 유지 — 로비·곁방에 정예 30마리(창병 8·워든 2·대형 거미 6·구울 8·족장 제외) + carve 검증 항목 "B 에서 18m 안 적 없음".

---

## 11. 보상·경제 연동

| 항목 | 내용 | 훅 |
|---|---|---|
| 골드 | 3~9 × 12(`gold.bossMul`) + 균열 상자 2 + 갑각판 파편 6~10g × 최대 3(P2 한정) | Loot 자동 / Chest / 신규 shellPlates |
| 물약·대형 물약 | 확정 | Loot 자동 |
| **유일 장비** `ring_scythe_horn` 「낫뿔 반지」 | ring, tier 3, 색 0xd9cfa0. `perfectBandBonus +0.12`, `dodgeDistanceMul 1.15` — **기존 효과 키만**, Modifiers 무변경. `unique:true` 로 상점·상자·무작위 풀 제외(`Loot.rollLoot`·`Chest.rollEquip` 두 풀 모두 필터), 판매 불가 | equipment.json + `EquipDef.unique` + `equipDrops` |
| 각인 | `sig_moment` 찰나 — 완벽 패링 슬로모 | drops/dropsOnDeath → Sigils 자동 |
| **오염 정화** | 사망 시 `pending −10`(`corruption.bossCleansePending`), **처형으로 마무리하면 −15**(`corruption.bossExecuteCleanse`). 전투 중 분출공 명중 −1(상한 −6, 부착 중 ×2). applied 는 불변(임계 불가역 규칙) | `Corruption.ts` 에 `corruption_cleansed{amount, source}` 구독 신규 |
| 마나 | 패링(완벽 22/일반 11, 위압 중 일반 5)·처형 25·해머 6 만 — 총 처치 0, 완벽 회피 마나 0(약점 노출이 보상). 정체성 규칙 준수 | 기존 |
| 탄 경제 | 약점 배율 2~3× 가 권총·활을 정답 무기로 → 상점 탄 소비. 화살은 회수되니 값싼 약점 무기. 수류탄은 균열벽·갑각판·잔해 정리용 | 기존 |
| XP | 400 | Progression 자동 |

### 11.1 오염 장부 예시 (전투 1회, 순 pending 변화)

| 플레이 | 진액 부착 | 분출공 정화 | 마무리 | 순 변화 |
|---|---|---|---|---|
| 서툰(웅덩이 자주, 반사 못 함, 총으로 마무리) | +8(상한) | 0 | −10 | **−2** |
| 평균(부착 60s, 반사 2회 + 열림 직격 2회 중 부착 중 2회) | +6 | −(2 + 2×2) = −6 | −10 | **−10** |
| 숙련(부착 20s, 질식까지, 처형 마무리) | +2 | −6(상한) | −15 | **−19** |

각인 한 슬롯(8~15)과 비슷한 폭 — 보스전이 "각인 하나를 공짜로 새길 여유"를 준다. `applied` 는 안 줄어들므로 임계 되돌림은 없다.

---

## 12. 계측 (`docs/metrics.md` 추가)

이벤트: `boss_phase{phase}`, `weak_point_hit{enemyType, id, damage}`, `weak_point_broken{id}`, `exposure_closed{id, hits}`, `boss_status{kind, on}`(12종), `charge_dodged`, `boss_roar_hit`, `pillar_hit{hp}`, `pillar_collapsed`, `plate_broken{gold}`, `corruption_cleansed{amount, source}`, `arena_sealed`, `arena_opened`, `anticamp_charge`, 플레이어 상태 `numb_arm_applied/_ended` 등 5종 × 2, `corrosive_tick{amount, health}`(damageTakenTotal 합산 목록에 등록 — 도트 규약).
파생 지표: 페이즈별 완벽/일반 패링 비율, 노출 활용률(hits/열림), 처형 수, 사망 페이즈 분포, 돌격당 완벽 회피율·눈멂 유도율·전도 수, 막기 횟수(팔 저림 발생 = 튜토리얼 미이해 신호), 페이즈별 소요 시간(목표 P1 90s / P2 120s / P3 90s), 기둥 붕괴 수, 순 오염 변화 분포, 갑각판 파괴 수, 동시 디버프 2개 도달 빈도.

---

## 13. 구현 배치 (3 마일스톤 · 15 체크박스 — 각 체크박스 뒤 플레이 가능)

의존 순서는 번호순. 한 체크박스 = `TASKS.md` 한 줄. 각 항목 끝의 **▶** 가 그 시점의 "플레이 가능" 기준이다. **체크 상태는 `TASKS.md` M11 절이 정본** — 이 목록의 칸은 채우지 않는다(계획서).

### 배치 1 — 뼈대: 기존 파이프만으로 싸울 수 있는 거수 (시험방)

- [ ] **B1-1 정의·스포너·테스트** — `data/entities.json` `scythe_behemoth`(`attack` 오른낫 파랑 + `chargeAttack` 빨강 hitOnContact 72틱 = 기존 슬롯만, **임시** `parriesToStagger 2` + `executeDamage 240`, `hitBox`, `alertRadius 18`, `chargeOnKnockback false`), `Spawner.ts` IMPLEMENTED, `Boss.test.ts` describe(패링 2회 → 스태거 → 처형 240, 돌격 접촉·완벽 회피 시 미접촉) + 헤더의 낡은 '2페이즈 교대' 주석 정리. ▶ 시험방 소환 탭 자동 등록, 인간형 폴백 외형으로 낫·돌격·처형이 돈다.
- [ ] **B1-2 외형** — `Stage.ts` ENEMY_COLORS/BLOOD_COLORS + `buildEnemyVisual` behemoth 분기(몸통·다리·높은 머리·뿔·낫 2자루 리그(족장 팔 리그 복제, `weaponTipDist`/`strikeProgress`)·등갑판·약점 구체 5개 **비활성 장식**), `debug/behemoth.ts` + `.html` 스크린샷 6장(기본 정면·측면·낫 예고·낫 타격 측면/정면·돌격 예고+튕김) + 시험방 3장 — rear/head_down/roar/P2 정면/P3 는 그 자세가 생기는 B2/B3 체크박스에서(§2 시각 검증). ▶ 같은 플레이, 외형 확정.
- [ ] **B1-3 왼낫 교대·들이받기** — `Entities.currentAttack` + `World.attackMode` 에 `'alt'|'close'`, `attackAlt`/`closeAttack`, Enemies 교대 선택·3.0m 들이받기, Stage 왼팔 연출. ▶ 세 공격 리듬.

### 배치 2 — P1 완성: 약점·패링 연동·상태 2종·조준 노선·페이즈 골격

- [ ] **B2-1 약점 판정 코어** — `Ray.ts rayVsSphere`(+테스트), `Entities.ts` `WeakPointDef{id, offset, radius, damageMul, hp?, facing, coneDeg}`/`weakPoints[]`/`poseOffsets`/`weakPointWorldPos`(jumpY 포함)/`rayHitsWeakPoint`(원뿔 검사, AABB null = +∞)/`hitBox` 재정의/`hitZonesImmune`; `Weapons.fire` 약점 우선 + zone `'weak'` + headshot 억제 + jumpY 버그 수정; `Projectiles.moveProjectiles`/`applyProjectileHit` weak 전달 + 화살 headshot 억제; `Spawner` 약점 hp 초기화; `weak_point_hit/broken`; Stage 구체 발광·`flashWeakPoint`(`alertAt` 식 Map) — **이 단계에선 약점 항상 노출**. 테스트: 정면/후면/측면 3방향, 기존 몸통 사격 테스트 유지. ▶ 다섯 약점을 쏘면 배율·발광이 붙는다.
- [ ] **B2-2 패링 → 노출·머리 내림·눈 혼절** — `Reaction.ts` `parryOutcome==='expose'` 분기(일반 → 관절 36·recover / 완벽 → `head_down` 90); `Enemies.ts` 노출·포즈 타이머(`exposure{id, ticks}`, `pose`, `poseTicks`), 눈 누적 66 → `staggered` + `boss_staggered`, 혼절 중 눈 닫힘, `dazeCooldownTicks`, `hammerEyeMul` + 머리 내림 중 해머 넉백 0(`Weapons.resolveHammerHit` 특칙), `staggerFlingImmune`; Stage `poseOffsets` 보간; 임시 `parriesToStagger` 제거; `balance.weakPoint` 블록. ▶ 완벽/일반 패링 이원 보상 + 처형 루프 완성.
- [ ] **B2-3 관절 파열·낫 잠김·절뚝·완벽 회피** — rupture/bladeLock 600/limp/`retreatWhenDisarmed`, impact 의 `reaches && iframeTicks>0` → `charge_dodged` + 미끄러짐 90 + 양 관절 40, `boss_status` 이벤트 + Stage 파열·미끄러짐 연출. ▶ 통제 노선·회피 보상. (구현 메모: 낫 ↔ 관절 짝은 `exposeOnParry.joint` 의 역으로 읽는다(새 필드 없음). 파열 비틀거림은 머리 내림·미끄러짐·혼절 중이면 덧붙이지 않는다 — 눈 창을 빼앗지 않게. 미끄러짐 중 로직 이동은 없다(spec "이동·공격 불가") — 미끄러지는 그림은 Stage 의 굴림·전진만)
- [ ] **B2-4 플레이어 상태 2종 + Status.ts** — `PlayerState` 옵셔널 `numbArmTicks/concussionTicks`, `src/systems/Status.ts` 신규(감소·`maxConcurrent`·`${kind}_applied/_ended`), Reaction 저림 게이트(완벽 대역 0·마나 소실 면제·일반 패링 시 해제), Enemies impact 방어 성공 → 저림 / 돌격 직격 → 진탕, `Audio.ts` 예고음 외 덕킹 API, main HUD 아이콘 2개·안내·콘솔 등록, `balance.status`. ▶ 막기 벌칙·진탕 체감.
- [ ] **B2-5 돌격 눈멂·지형 충돌·기둥 문자** — `GridLoader.ts` 새 문자 `P`(SOLID, 기둥 렌더·내구 균열선은 배치 3), `test_monsters.json` 에 `P` 2~4개, Enemies 돌격 중 6m 안 눈 노출·`blindThreshold`·오버런·`chargeStuckTicks` 충돌 감지·셀 문자별 결과(P/C 전도, # whiff), `World.breakCrackWalls` 헬퍼로 이동(Projectiles 는 호출만) + `crack_wall_broken` 유지. 테스트: 눈 66 → 눈멂 → P 전도 / # whiff. ▶ 조준 노선.
- [ ] **B2-6 페이즈 골격** — `healthBarState.index` 비교 훅 → `boss_phase`, `phaseTarget` 큐잉(두 단계 누적), `phase_shift`·갑각 재생(관절 `weakHp` 회복 + `ruptured[id]` 삭제·낫 잠김·절뚝 해제), `phases[]`(speedMul·unlock·attackOverrides) 적용, HUD 보스 줄 페이즈명, `Metrics` 등록. 테스트: 칸 경계 전환·큐잉·2단 건너뜀·재생. ▶ P1 완성판 — P2/P3 는 수치 상승만(공격 동일).

### 배치 3 — P2·P3 기술, 아레나, 보상

- [ ] **B3-1 P2 발구르기·심장·절뚝** — `slamAttack`(`attackMode 'slam'`, aoe 5.0, `rearPose`, 심장 66 → `backflow`·자해·쿨 600), `wakeSlam`, `hobble` 상태(Status), Stage rear 자세. ▶ 탐욕 노선.
- [ ] **B3-2 웅덩이·오염 진액·갑각 떨기·분출공** — `src/systems/Hazards.ts` 신규(`spawn_pool`·불 증발·`poolMax`·접촉 → `corrosiveTicks`), Status 의 corrosive(DoT `corrosive_tick`·pending 가산·전투당 상한, Metrics 등록), `volleyAttack` kind `'goo'`(Stage/Projectiles 처리) + 착탄 웅덩이, `vent` 약점(열림 판정·`deflectSelfDamage` 33·역류·질식 1800·증발·`corruption_cleansed` 발행), `Corruption.ts` 구독. ▶ 반사 노선·바닥 압박.
- [ ] **B3-3 갑각판** — `shellPlates` hp 풀(heavy 타격 연동), 골드 주머니, `ventScalePerPlate`, P3 탈락 연출. ▶ 해머·수류탄 사용처.
- [ ] **B3-4 P3 기술** — `roarAttack`(`attackMode 'roar'`, impact 우회 분기: 위압·`pushPlayer`·`boss_roar_hit`, iframe 존중, 눈 66 → 역류, 절망 변형 `pull`+`followUp`), `comboAttack`(`attackMode 'combo'`, `comboNext`/`continueOnParry`/`perfectOnly`+`noParryBuffer`, Reaction 콤보 진행·완벽 카운트 → 탈진 150), `chainCharge`(선회·꼬리 채기·2차 질주), `cowed` 상태(Status·Reaction 관절 미노출·마나 5). ▶ 전 기술 완성(시험방).
- [ ] **B3-5 아레나 f4 + Arena.ts** — `data/levels/z01_f4.json`(carve, `arena.bounds`, `bossArena true`), `main.ts ZONE` 4층, `Zone.test.ts`(4층·보스 층 곡선 예외·`P` 허용·behemoth f4 한정), `src/systems/Arena.ts` 신규(봉쇄 조건·`door.sealed`·홈 복귀 대기·bounds 클램프 제공·기둥 내구/붕괴·반캠핑·FloorState 보존·부활 해제), GridLoader 기둥 균열선, `balance.arena`, `traps.bossDamageMul`. ▶ f4 에서 완전판.
- [ ] **B3-6 보상·마무리** — `equipment.json` `ring_scythe_horn` + `EquipDef.unique` + Loot/Chest 풀 필터 + `equipDrops`; `corruption.{bossCleansePending 10, bossExecuteCleanse 15, ventHitCleanse 1, ventCleanseCap 6, corrosiveCleanseMul 2}`; `Inventory.isUseful` '지울 상태가 있으면 유용' + `Items.drink` 진탕 해제; `aimAssist.weakPointRadiusMul` 옵션; `docs/systems/boss_behemoth.md`, `docs/metrics.md`, `combat.md` 링크. 커밋·푸시(Pages 배포). ▶ 출시판.

**테스트 요약:** Ray(구체) · Weapons(약점 3방향·배율·헤드샷 억제·기존 몸통 테스트 유지) · Boss(노출 틱, 눈 66 → staggered → 처형 240, 혼절 중 눈 닫힘·쿨다운, 완벽 회피, 막기 → 저림 → 일반 패링 해제, 눈멂 → P 전도 / # whiff, 전환·큐잉·2단, 잠긴 낫 미선택·600틱 해제, 발구르기 심장 역류·쿨, 반사 4회 질식·증발, 위압 중 일반 패링 미노출·완벽 해제, 삼연낫 소표 전 조합, 광란 돌격 완벽 회피 시 2차 없음, 기둥 3회 붕괴·잔해 whiff, 반캠핑 300틱, 밖에서 깨웠을 때 봉쇄 안 됨·진입 시 봉쇄) · Status(상한 2·해제 규칙) · Hazards(웅덩이·불 증발·pending 상한) · Corruption(정화 상한·처형 마무리) · Loot/Chest(유일 반지 풀 제외) · Zone(f4 규칙).

---

## 14. 신규 데이터 필드 정리

| 위치 | 필드 |
|---|---|
| `EnemyDef` | `parryOutcome`, `hitBox{halfX, halfZ}`, `alertRadius`, `hitZonesImmune`, `hammerEyeMul`, `noKnockbackWhileHeadDown`, `staggerFlingImmune`, `chargeOnKnockback`, `weakPoints[]{id, offset, radius, damageMul, hp?, facing, coneDeg?, exposedStates?, openMul?}`, `poseOffsets{pose → {wpId → {x,y,z}}}`, `attackAlt`, `closeAttack{maxRange 3.0, cooldownTicks 240}`, `slamAttack`, `roarAttack`, `comboAttack`, `wakeSlam{windupTicks 30}`, `phases[]{bar, unlock[], speedMul?, attackOverrides?, poolsOn?, shellPlatesOn?, shedPlates?, firstPick?}`, `equipDrops[]`, `shellPlates{count, hpEach, goldMin, goldMax, ventScalePerPlate}`, `retreatWhenDisarmed{min, max}` |
| `EnemyAttackDef` | `alternate`, `perfectOnly`, `noParryBuffer`, `comboNext`, `continueOnParry`, `chainCharge{turnTicks 24, tailRadius 2.5, tailDamage 12, tailTelegraph 'red'}`, `rearPose{from, to}`, `statusOnHit`, `statusOnBlock`, `poolKind`, `exposeOnParry{joint, normalTicks 36, perfectTicks 90}`, `perfectDodgeExposes{ticks 40, joints ['joint_r', 'joint_l']}`(열 관절을 데이터로 명시 — B2-3), `wallWhiffRecoverTicks 60`(돌격이 벽·문에 막힌 헛돌격 — B2-5), `pull 4`, `followUp`, `eyeExposedDuring`, `intervalTicks 1200`, `despairHealthFrac 0.2`, `deflectSelfDamage 33` |
| `World.attackMode` | 기존 `'summon'|'bash'|'charge'|'volley'|'ranged'` + `'alt'|'close'|'slam'|'roar'|'combo'` |
| `World.EnemyState` | `weakHp{id → hp}`, `exposure{id → ticks}`, `exposureHits`, `weakAccum`, `dazeCooldown`, `dazed`, `pose`/`poseTicks`, `bladeLock{r?, l?}`, `ruptured{id → true}`(파열 처리 표식 — Enemies 는 지우지 않고 **갑각 재생이 `weakHp` 회복과 함께 지운다**), `limping` |
| `balance.status` | `maxConcurrent 2`, `numbArm{ticks 240, perfectBandMul 0, blockSpeedMul 0.25, noManaLossOnFail true}`, `hobble{ticks 300, dodgeStaminaMul 2, noSprint true}`, `concussion{ticks 360, aimShakeAmp 0.02, tiltDeg 3, duckDb −6, potionCures true}`, `corrosive{moveSpeedMul 0.6, dotPerTick 2, dotIntervalTicks 30, lingerTicks 30, pendingPerTicks 60, pendingCap 8}`, `cowed{ticks 360, normalParryOpensJoint false, normalParryMana 5}` |
| `balance.items.kinds.*` | `cures?: PlayerStatusKind[]` — 마시면 지워지는 상태. `potion`·`potion_large` 에 `['concussion']`(B2-4). `Inventory.curableStatuses` 가 `cures` × `status.<kind>.potionCures` × 지금 걸림 으로 판정하고 `isUseful`·`Items.drink` 가 같은 판정을 쓴다 — `heal` 로 판정하지 않는다(말린 고기 heal 5 는 물약 노릇을 못 한다) |
| `balance.weakPoint` | `dazeThreshold 66, dazeCooldownTicks 600, blindThreshold 66, blindRangeM 6, blindOverrunTicks 40, heartTrigger 66, heartCooldownTicks 600, roarCancelThreshold 66, ventGagThreshold 66, ventOpenMul 3.0, ventCleanseCap 6, headDown{stuckTicks 90, backflowTicks 60, toppleTicks 90, toppleReboundM 2.5, toppleReboundTicks 10, exhaustTicks 150}, backflow{selfDamage 45}, rupture{staggerTicks 60, bladeLockTicks 600}, limp{speedMul 0.65, chargeSpeedMul 0.7}, skid{ticks 90}, choke{sealTicks 1800, windupPenalty 10}, phaseShiftTicks 90, chargeStuckTicks 2` |
| `balance.hazards` | `pools{blade{radius 1.6, ticks 480}, stomp{2.0, 480}, orb{1.2, 480}, skid{1.6, 480}}, poolMax 12` |
| `balance.arena` | `pillarHp 3, pillarStunTicks 30, anticampNoLosTicks 300, anticampFarTicks 480, anticampFarM 12, anticampSpeedMul 1.5, rubbleHalf 1.7` |
| `balance.traps` | `bossDamageMul 0.6`(현재 키 없음 → 신설) |
| `balance.corruption` | `bossCleansePending 10, bossExecuteCleanse 15, ventHitCleanse 1, ventCleanseCap 6, corrosiveCleanseMul 2` |
| `balance.input.gamepad.aimAssist` | `weakPointRadiusMul 1.35`(옵션) |
| `equipment.json` | `unique: true` |
| 레벨 JSON | `arena{bounds:[r0,c0,r1,c1], home:[r,c]}`, `bossArena: true`; 격자 문자 `P` 기둥(SOLID) |
| `FloorState` | `arena{pillarHp[]}` |

---

## 15. 재사용 가능한 기존 훅 — 구현 가능성 근거 (파일 수준)

| 필요한 것 | 기존 훅 | 상태 |
|---|---|---|
| 낫 베기 타이밍 창 | `Enemies.ts` windup→active_perfect→active_normal→impact 파이프, `startWindup` 예고(`main.ts` 소리·`Stage.ts` 발광), `Reaction.ts` gap 판정(`parrySpace`) | 데이터만 |
| 돌격 | `chargeAttack` hitOnContact + chargeRunTicks 고정 목표 질주, contactDist | 데이터만 |
| **완벽 회피 감지** | `Enemies.ts` impact 의 `reaches && iframeTicks<=0` 옆 `reaches && iframeTicks>0` 분기 | 한 줄 신규 |
| 발구르기 원형 판정·소리 | `Entities.ts attackReaches`(aoeRadius) + `ground_slam` | 데이터만 |
| 진액 구슬 연사·반사 | `volleyAttack`, `fireProjectile` deflectable/breakable, `Reaction.ts` 반사가 시전자 0.6h 로 되돌림(위력 ×1.5 는 코드 상수 — 이 보스는 `deflectSelfDamage` 고정값으로 우회) | kind `'goo'` 처리 신규 |
| 체력 3칸 | `healthBars` + `healthBarState` → HUD(`main.ts`)·이름표(`Stage.ts`) | 데이터만 |
| 페이즈 트리거 | `healthBarState.index` 이전 틱 비교 — 현재 없음 | `Enemies.ts` 소형 훅 신규 |
| 처형·마나·지표·문구 | `executeDamage` 경로(`Reaction.ts`), `boss_staggered`/`boss_execute` 소비자(`Mana.ts`·`Metrics.ts`·`main.ts`) | 데이터만 |
| 패링→노출 분기 | `Reaction.ts` 의 `def.boss && parriesToStagger` 옆 `parryOutcome==='expose'` | 분기 신규 |
| 약점 구체 판정 | `Entities.ts enemyHitBox` + `Ray.ts rayVsAabb` 패턴, 호출부 `Weapons.ts`·`Projectiles.ts` 두 곳, `applyFrostOnHit` 전에 배율 | `rayVsSphere` + 함수 3개 신규 |
| 포효(피해 없는 범위 상태 부여) | 없음 — impact 파이프는 damagePlayer(0)·player_damaged·방어 경직 부작용 | `type==='roar'` 별도 분기 신규 |
| 머리 내림 중 해머=눈 | `Weapons.ts resolveHammerHit` 플래그 특칙(높이 밴드 불필요) | 플래그 신규 |
| 약점 발광·피격 연출 | `Stage.ts` 옵션 부위 패턴(`aoeRing/chargeOrb/barrier`), `flashEnemyHit`/`headshotFlinch`, `alertAt` Map, `spawnDeathBurst` power | Stage 확장 |
| 플레이어 상태 | `World.ts` PlayerState 옵셔널 규약, 다섯 게이트(`Reaction.ts`·`PlayerMove.ts`·`Weapons.ts`·`Projectiles.ts`·`Items.ts`), `aimShake` 채널, HUD `#buff-burn`·`syncDotIcon`(`main.ts`) | `Status.ts` 신규 + 게이트 조건 |
| 오디오 덕킹 | `Audio.ts` 마스터 게인 구조 | 예고음 외 게인 API 신규 |
| 오염 대기 가산·정화 | `world.corruption.pending` 직접 가산 규약(`Sigils.ts` 선례), `Corruption.ts` 이벤트 구동 정산 | 구독 1개 신규 |
| 웅덩이 | `Traps.ts` `tickOil`(playerSlowMul·불 전파), `goo` 규약 | `Hazards.ts` 로 복제(Traps import 없음) |
| 기둥 붕괴·잔해 | `Traps.ts fireRockfall` 규약(`rubbleHalf`·`addBlocker`+`setPathBlocked`) | `Arena.ts` 가 규약 복제 |
| 균열벽 개방 | `Projectiles.ts breakCrackWalls` → `core/World.ts` 순수 헬퍼로 이동(`igniteOilInRadius` 선례), `main.ts crack_wall_broken` 핸들러 그대로 | 이동 + 호출 1개 |
| 문 봉쇄 | `Door.ts` closing 규약·`bodyInDoorway`, `GridLoader closeCell`, 출구 창살 빌더 | `Arena.ts` + `door.sealed` 신규 |
| 출구 봉인·해제 | `Exit.ts` 폴링 — def.boss 면 자동 | 자동 |
| 유일 장비 | `Loot.ts rollLoot` 보스 분기·`Chest.ts rollEquip` 소유 제외 — 두 풀 모두 필터 | `EquipDef.unique` 신규 |
| 넉백 면제·체급 | def.boss 폭발 넉백 면제(`Projectiles.ts`), weight heavy 감쇠(`Weapons.ts`·`Explosion.ts`) | 자동 |
| 포효 기상·HUD·전리품·팡파르·시험방 등록 | def.boss 만으로 자동(`Enemies.ts`·`main.ts`·`Loot.ts`·`SummonPanel.ts`); 기상 반경만 `alertRadius` 재정의 | 자동 + 필드 1 |
| 테스트 | `Boss.test.ts` `makeWorld/tickEnemiesUntil/pressReaction/parryBoss`, `Weapons.test.ts` 부위 테스트, `Traps.test.ts` DoT 패턴, `Zone.test.ts` 층 검증 | 복제 |

---

## 확인이 필요한 결정

**2026-09-04 사용자 결정: 아래 35개 전부 ★ 추천안으로 확정.** 구현은 §13 배치 순서대로 진행한다.


★ = 추천

1. **이름·id** — ★ 「낫뿔 거수」 `scythe_behemoth`. 대안 「갑각 돌격수」 `carapace_charger`, 「묘굴 갑수」 `tomb_ravager`.
2. **약점 배율 적용 무기** — ★ 권총·활·화염구 직격만 + 머리 내림·탈진 중 해머 눈 집계(`hammerEyeMul 2.2`, 한 타 = 권총 한 발). 수류탄·폭발·빔 제외. 대안: 해머 완전 제외(근접 처형 경로 없음).
3. **혼절 출처·쿨다운** — ★ 눈 누적 66 만 + 혼절 중 눈 닫힘 + 혼절 뒤 600틱 동안 눈은 피해만(배치 1 에서만 임시 `parriesToStagger 2`). 대안: 쿨다운 없음(숙련자 2분 컷 감수) / 패링 N연속 폴백 병행.
4. **처형 피해** — ★ 240(16%, 사이클당 ≤ 372 → 4~5 사이클). 대안: 320(21%, 3~4 사이클).
5. **돌격 중 눈 사격 → 눈멂 → 전도(조준 노선)** — ★ 채택, 임계 66(권총 2·활 1) + 6m 안 마지막 24틱만 유효. 눈먼 돌격도 접촉 피해는 그대로. 대안: 미채택(기둥 충돌은 우연만).
6. **완벽 회피 보상** — ★ 양 관절 40틱 노출만(마나 0 — "마나는 패링·처형으로만" 유지). 대안: 마나 +8.
7. **P2 소환(균열 부르기)** — ★ 없음(1:1 결투). 대안: 반캠핑 480틱 반응으로만 소환.
8. **오염 정화 수치** — ★ 사망 −10 / 처형 마무리 −15 / 분출공 명중 −1(상한 −6, 부착 중 ×2). pending 만. 대안: 사망 −10 단일.
9. **갑각판** — ★ hp 풀(heavy 타격이 몸에 들어갈 때 감소, 판정 볼륨 없음, 총알 튕김 없음) + P2 한정 골드. 대안: 판은 P3 탈락 연출만.
10. **유일 보상 형태** — ★ 반지 「낫뿔 반지」(기존 키만). 대안 A: 등껍질 갑옷(새 키 `knockbackMul`). 대안 B: 목걸이(새 키 `corruptionSettleMul`).
11. **각인 드랍** — ★ `sig_moment`. 대안: `sig_reflect` / `sig_weakpoint`.
12. **아레나 층과 Zone.test** — ★ 신규 4층 + "보스 결투 층은 난이도 곡선·밀도 비교 제외" 예외 + 최소 로스터 9마리(§10.3 a). 대안: 곡선 유지·정예 30마리 이중 구조(§10.3 b) / f3 족장 교체.
13. **기둥 표현** — ★ 새 격자 문자 `P`(SOLID, 내구 3, 붕괴 시 낙석 규약 잔해). 대안: `#` 2×2 블록 + 레벨 JSON `pillars[]`.
14. **기둥 충돌 결과 강도** — ★ 전도 = 머리 내림 90(눈 노출, 혼절 누적 가능, 스태거 아님). 대안: 즉시 `staggered`.
15. **반캠핑** — ★ LOS 없이 300틱 → 그 기둥으로 자발 돌격 / 12m 밖 480틱 → 접근 이속 ×1.5 + 돌격 쿨 리셋. 대안: 플레이어 칸 낙석.
16. **발구르기 바닥 표식** — ★ 없음(앞발 들기 + 앞다리 빨강 + 땅울림). 대안: 족장 `aoeRing` 재사용.
17. **완벽 전용 3타 발광** — ★ 같은 파랑을 더 밝게 + 예고음 고음. 대안: 청백색 4번째 색(색 문법 확장).
18. **위압(P3) 강도** — ★ 6초, 일반 패링 관절 미노출 + 마나 절반, 회피는 그대로. 대안: 마나만 절반.
19. **포효와 회피** — ★ 무적 8틱이면 위압이 안 걸린다(빨강 = 회피 문법 유지) + 눈 66 취소. 대안: 포효는 iframe 무시(취소·완벽 패링 해제만).
20. **절망의 포효(≤20%, 끌림 4m → 발구르기 연계)** — ★ 채택. 대안: 미채택.
21. **넉다운 상태** — ★ 미채택(진탕으로 대체). 대안: 돌격 직격 넉다운 72틱.
22. **체력 물약이 진탕 해제** — ★ 채택(`Inventory.isUseful` 에 '지울 상태가 있으면 유용' 분기 + `Items.drink`; 어느 아이템이 지우는지는 `items.kinds.*.cures` 데이터 — 체력 물약·대형 체력 물약만, 말린 고기는 아니다). 대안: 물약은 회복만.
23. **진탕 오디오 표현** — ★ 예고음 버스 우회 덕킹 −6dB(로패스 없음 — 파랑 예고음 보존). 대안: 오디오 무변경(aimShake+기울기만).
24. **패드 조준 보조 약점 반경 ×1.35** — ★ 옵션 채택(기본 켬). 대안: 보조 없음.
25. **관문 봉쇄 조건** — ★ "각성 && 플레이어가 bounds 안" + 밖에서 깨우면 홈 대기, 입구는 D(레버 불필요). 대안: D 안쪽 첫 칸 진입 트리거 = 각성 + 봉쇄 한 이벤트.
26. **질식 지속** — ★ 1800틱 봉인 + 웅덩이 증발 + 해제 시 분출공 hp 회복. 대안: 영구(hp 264 로 상향 동반).
27. **누출(관절 파열 → 걷는 자리 웅덩이)** — ★ 미채택(보스 상태 12종으로 압축). 대안: 채택(P2+, 180틱, r0.66).
28. **시작 수치** — ★ 체력 1500·3칸, 처형 240, 임계 66/내구 132, 관절 노출 36/90/40, 혼절 쿨 600, 낫 잠김 600. 플레이테스트 후 목표 4~6분에 맞춰 `health`·`dazeThreshold`·`dazeCooldownTicks` 조정.
29. **상태이상 층 이동 유지** — ★ 전부 해제(짧다). `loadFloor` 에 명시.
30. **약점 관통 차단 규칙** — ★ 구체 승 + `facing` 원뿔(정면 반구/그쪽 옆면) — 테스트는 정면 ×3 / 후면 0.8× / 측면 관절 좌우 구분. 대안: `t_sphere ≤ t_aabb` 만(관절·심장은 몸통 밖으로 더 돌출시켜야 함).
31. **피격 AABB 재정의(`hitBox`)** — ★ 채택(halfX 1.25 / halfZ 1.85, 시각 몸통 일치). 대안: 기존 radius 정사각(옆 허공 0.35m 감수).
32. **팔 저림 강도** — ★ 완벽 불가 + 방어 이속 0.25 + 실패 마나 소실 면제, 버퍼 그대로. 대안: 완벽 대역 −0.25 + 버퍼 4.
33. **혼절 중 해머 3타 날림(5m) 면제** — ★ 채택(`staggerFlingImmune` — 처형 반경 4.6 밖으로 날아가는 것 방지). 대안: 의도된 상호작용으로 두고 처형 대신 강타 마무리 선택지로 문서화.
34. **활 몸통 배율** — ★ 기존대로 1.0(활은 부위 배율이 없다). 대안: 이 보스만 활 몸통 0.8×.
35. **디버프 동시 상한** — ★ 2개(새 것이 가장 오래된 것을 대체). 대안: 상한 없음 + 절뚝을 스태미너만으로.

---

## 검토 반영

1 / 46 (배치 분할) — **반영.** 3 마일스톤을 15 체크박스(B1-1~3, B2-1~6, B3-1~6)로 쪼개고 의존 순서·각 체크박스의 "플레이 가능(▶)" 기준을 적었다.
2 (봉쇄 소프트락) — **반영.** 봉쇄 조건을 "각성 && 플레이어가 `arena.bounds` 안" 으로, 밖에서 깨우면 홈 대기, `bodyInDoorway` 면 Door closing 규약으로 대기. 결정 25.
3 / 52 (Zone.test 충돌·로스터 없음) — **반영.** §10.3 신설, 결정 12 로 승격(예외 규칙 ★ / 정예 30 로스터 대안), 최소 로스터 명시, `alertRadius 18` 로 45m 제약을 없앴다. Zone.test 갱신은 B3-5 에 명시.
4 / 45 (상자 방 안전지대 근거) — **반영.** `DOOR_OPEN_WIDTH 2.1` 은 GridLoader 에 실재하므로 문틀 서술은 유지하되 열린 C(4m)는 통과 가능함을 인정하고, `arena.bounds` 클램프 규칙으로 벽감 안전을 보장. 2.1m 출처를 표기.
5 / 44 (등갑판 판정 볼륨) — **반영.** 판은 hp 풀만 — heavy 타격이 몸에 들어갈 때 감소, 총알 튕김·판정 볼륨 삭제.
6 (포효 impact 부작용) — **반영.** `type==='roar'` 별도 분기(피해·방어·player_damaged 없음, `boss_roar_hit`), §15 에 훅 추가.
7 (관문 G 여는 수단) — **반영.** 입구를 D 로 바꾸고 봉쇄는 `door.sealed` 필드로.
8 (색 규약 위반) — **반영.** 약점 팔레트를 백황/청록/진홍/오염 녹색으로, 텔레그래프 3색·스태거 금색 사용 금지 명시.
9 / 50 (몸 형태와 판정 불일치) — **반영.** radius 1.6(contactDist 2.15), `hitBox{1.25, 1.85}`, 몸통 2.3 폭, 머리를 AABB 안(z −1.85~−0.95)으로, 눈 앞끝 2.14 ≤ 2.15. AABB 미명중 = +∞ 명시.
10 / 31 (소총 미구현) — **반영.** 소총 열·counters.rifle 삭제, 초당 피해 재산정 주석.
11 (법선 내적 무의미) — **반영.** 구체 표면 법선 대신 데이터 `facing` 벡터 원뿔 검사로 교체, 테스트를 3방향 명중 여부로.
12 (wantsCharge 우회) — **반영.** `chargeOnKnockback false` 필드, B1-1 에서 적용.
13 (attackMode 누락) — **반영.** §14 에 `'alt'|'close'|'slam'|'roar'|'combo'` 등록, B1-3(alt/close)·B3-1/B3-4(slam/roar/combo) 분배.
14 (import 경계) — **반영.** `breakCrackWalls` → `core/World.ts` 헬퍼, Arena 가 잔해 규약 복제, corrosive 는 `p.dots` 를 쓰지 않고 Status.ts 단일 소유(이슈 47 과 함께 정리 — 14 의 "DotKind 로 Traps 소유" 대안은 pending 가산이 Traps 에 들어가야 해서 채택 안 함).
15 / 49 (데이터화 누락) — **반영.** §14 에 headDown/backflow/rupture/limp/skid/choke/despair/wakeSlam/close/hazards.pools/arena/roar interval 등 전부 필드로, 본문에 필드명 병기. 벌칙(punishNext)은 삭제.
16 / 51-후반 (발구르기 회피 산술) — **반영.** "뒤 대시는 항상 나간다(2.0+3.5 > 5.0)" 로 고치고 절뚝 중 스태미너 부족을 막기 사유로. `attackRange × impactRangeMul ≤ 4.6` 데이터 노트 추가.
17 (해머 눈 집계 시간) — **반영.** `hammerEyeMul 2.2`(2타 = 66), 머리 내림 중 해머 넉백 0, 혼절 중 3타 날림 면제(결정 33).
18 (물약 isUseful·hitZonesImmune 범위) — **반영.** B3-6 에 `isUseful` 분기 명시; `hitZonesImmune` 를 "권총 부위 배율 제거 + 권총/화살 headshot 이벤트 억제 두 곳" 으로 정확히 기술; 활 몸통 배율은 결정 34.
19 / 35 (완벽 패링 1회 = 절반) — **반영.** 혼절 중 눈 닫힘, +12 연장 폐지, 혼절 쿨다운 600, 처형 240, 사이클 ≤ 372 로 예산 재계산(§0·§3.1 일치).
20 (약점 3/5 판정 불가) — **반영.** "구체 승 + facing 원뿔" 규칙으로 AABB 안의 관절·심장도 맞고, 관절은 x ±1.15 로 돌출, 3방향 테스트 명시.
21 (로패스 900Hz) — **반영.** 로패스 삭제, 예고음 버스 우회 덕킹 −6dB, 접근성 토글 결정은 오디오 표현 결정(23)으로 대체.
22 (관절 파열 과다) — **반영.** 낫 잠김 600틱, 절뚝 중 돌격 ×0.7 유지, 관절 hp 132 전 페이즈 동일, 일반 패링 노출 36(권총 3 = 미달), 완벽 회피 40.
23 (심장 25 = 정답 노선) — **반영.** 임계 66(28틱 안 권총 2), 역류 머리 내림은 혼절 누적 없음(피해만), 자해 45 유지.
24 / 53 (분출공 사격 표적) — **반영.** 직격 판정은 열림(예고·시전·탈진) 중만, 반사 자가 피격은 항상, 고정 33 → 4회, hp 132, 질식은 1800틱 봉인(결정 26).
25 (눈멂 1발·접촉 미정·우선순위) — **반영.** 임계 66 + 6m 안 유효, 눈먼 돌격도 접촉 피해 그대로, 우선순위 완벽 회피 > 눈멂 > 헛돌격 명시.
26 (팔 저림 이중 벌칙) — **반영.** 완벽 불가로 정직하게 기술, 버퍼 유지, 저림 중 실패 마나 소실 면제. 결정 32.
27 (P1 사각) — **반영.** attackRange 4.4, 돌격 minRange 4.5, 들이받기 3.0.
28 (벌칙 오탐) — **반영.** punishNext 삭제, 반캠핑만 유지, `exposure_closed` 는 계측 전용.
29 (디버프 겹침) — **반영.** `maxConcurrent 2`, 진탕은 직격만, 절뚝은 스태미너만, 위압 회피 배율 삭제 — "어느 상태도 회피를 건드리지 않음".
30 (임계 8종·상태 16종) — **반영.** 임계를 66/132 두 값 + 권총·활 발수 표기로 통일, 보스 상태 12종(눈부심·누출·낫 잠김 개별·구역질 통합).
32 / 42 (돌격 사거리 불일치·반캠핑 무효) — **반영.** chargeRunTicks 72(18m), maxRange 15, 반캠핑 far 를 "접근 이속 ×1.5 + 쿨 리셋" 으로 실제 발동하게.
33 (수치 서술 오류) — **반영.** "≤ 240(16%) 이면 처형이 마무리" + 절망의 포효 관계 한 줄, 발구르기 탈출 서술 수정.
34 (포효 iframe·perfectOnly 버퍼) — **반영.** 포효는 iframe 존중(결정 19), ③에 `noParryBuffer` + 실효 창 2~3틱 서술.
36 (분출공이 머리 안) — **반영.** 머리를 y 2.35 로 올리고 분출공 (0, 1.65, −1.55), 반사 복귀 1.8 ± 0.35 와 겹침 확인, 스크린샷 7장(정면 P2 추가).
37 (반사 배율 모순) — **반영.** 반사 자가 피격을 고정 33(배율 무시)으로, 4회 유지; 직격 배율은 예고·시전 ×1.5 / 탈진 ×3.0 으로 분리.
38 (페이즈 수치 하드코딩) — **반영.** `phases[].attackOverrides` 슬롯별 명시, 전역 damageMul·P2 32 삭제.
39 (역류 정의 없음·심장 ②) — **반영.** §5 에 역류 행(심장·분출공·포효 취소 통합) + `backflow{selfDamage}`, 심장 ②(절뚝 넉다운) 삭제.
40 (꼬리 채기 표 누락) — **반영.** §3.2 행 추가(12·칩 4·contact·빨강·패링 불가), 2차 질주 예고 = 선회 24틱(꼬리·뿔 빨강), `chainCharge.tailTelegraph`.
41 (삼연낫 규칙 불완전) — **반영.** 입력×타 소표 신설(①② 완벽 = 관절 60·콤보 지속, ③ 완벽 미달 = 머리 내림 90, 일반 대역 = 기존 실패 규약, 막기 = 팔 저림), §3.2 열 분리.
43 (poseOffsets 눈만) — **반영.** 8 자세 × 5 약점 전체 표, Stage 와 판정이 같은 표를 읽음.
47 (corrosive 소유·이벤트·상한 리셋) — **반영.** Status.ts 단일 소유(카운터·DoT·pending), Hazards 는 접촉 시 값만 세움, `corrosive_tick` Metrics 등록, 전투당 카운터는 보스 EnemyState 에 두고 부활 시 리셋.
48 (전환·포효 이중·큐잉 boolean) — **반영.** P3 진입 = phase_shift 만(위압 없음), 복귀 후 `firstPick 'roar'`, `phaseTarget` index 큐잉 + 2단 누적 규칙.
51 (수치 잔불일치) — **반영.** P3 이속 3.84 한 값, 발구르기 P3 28 은 override 로 명시, 해머 강타 79 반영, 발구르기 탈출 서술 수정.
54 (이벤트 규약·기상 발구르기 조건) — **반영.** 플레이어 `${kind}_applied/_ended`, 보스 `boss_status{kind,on}` 단일화, 기상 발구르기 발동 상태(머리 내림 전 원인·혼절·탈진, 미끄러짐 제외)와 "눈 66 미달 근접 벌칙" 의도 명시.

**반영하지 않은 것:** 이슈 14 의 "corrosive 를 DotKind 로 두고 Traps.tickDots 가 감소" 대안 — pending 가산(오염 규약)을 Traps 가 떠안게 되어 이슈 47 의 단일 소유 제안과 충돌하므로 Status.ts 소유를 택했다. 이슈 30 의 "관절 hp 85(활 2발 정확)" — 활 2발 = 88 ≥ 132 아님이지만, 활 2발/권총 6발이 정확히 맞는 132 로 두는 쪽이 임계 단위(66 배수)와 일치해 채택하지 않았다.
