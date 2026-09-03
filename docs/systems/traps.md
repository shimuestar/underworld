# 함정 시스템 스펙

`systems/Traps.ts`, `render/TrapVisuals.ts`, `data/balance.json` `traps` 작업 시 참조. (2026-09-02)

---

## 1. 목적

던전이 적만으로 위험하지 않게 — 그리고 **적을 유도해 걸리게 하는** 전투 도구로.
함정은 플레이어와 적에게 똑같이 작동한다. AI 는 함정을 모른다(피하지 않는다) → 쫓기면서
함정 위로 유도하는 것이 정답 플레이다.

세 자원과 얽힌다:
- 함정 피해는 `player_damaged` → **마나 연쇄가 끊긴다** (밟은 대가)
- 다트는 **패링·반사 가능** → 받아치면 마나 (반응 버튼 = 마나 수입 정체성)
- 저주 문양은 **오염 pending** (제단에서 정산되는 숨은 장기 비용)

예고는 **소리·모형 동작으로만** 한다 (UI 링·조준선 금지 — 텔레그래프 규칙). 함정마다
랜턴 아래서 알아볼 tell 이 있고, `함정 감지` 각인만 은은한 보라 발광을 얹는다.

## 2. 상태 머신

```
armed ──(몸이 triggerRadius 안)──▶ telegraph ──(telegraphTicks)──▶ firing ──▶ cooldown ──▶ armed
                                                                        └──(charges 소진)──▶ spent
disarmed ◀── 플레이어가 능동 해체 (그물 줄 끊기)
```
- 판정은 **몸 중심 ↔ 함정 중심 반경** (점액 장판과 같은 규약). 셀 판정이 아니다.
- 적 트리거 제외: 죽음·천장 거머리(`lurking`)·죽은 척(`feigning`)·벽 매달림·공중(`jumpY > flyoverHeight`)·`latched`.
  플레이어는 그림자 질주(`blinkLeft > 0`) 중 제외 — 그림자는 무게가 없다.
- 기름·진자는 트리거가 없다 (불이 트리거 / 항시 작동) — `tick` 이 별도 분기로 돈다.
- `charges: -1` = 무한. 부활(`respawnAtAltar`)은 **전부 재무장**(spent 포함) — 부활은 골드 전액이라
  파밍 악용이 안 된다. 층 이동 얼림(`floorStates`)은 상태 그대로.

## 3. 종별

| type | 위험 | 트리거 | 예고 | 플레이어 | 적 | 쿨/장전 | 카운터 |
|---|---|---|---|---|---|---|---|
| `trap_dart` | 低 | 판 1.3 | 30틱 덜컹·판 침강·노즐 붉음(가시판과 같은 결) | 8×3 화살(방패 완전 차단) | 8 풀피해(오사 감쇄 없음) | 90틱 / 2회 | 반사(마나 15)·방어·회피 |
| `trap_dart_auto` | 低 | 없음(자동 순환) | 30틱 쉬익·황동 노즐 붉음 | 8×3 화살 | 8 | 쉼 120 → 예고 30 → 발사 반복 | 박자 읽고 지나가기·반사 |
| `trap_net` | 低 | 줄 1.0 | 없음(낙하 12틱 연출) | 거미줄 상태 | 완전 둔화 6초 | 1회 | 해머·총·투사체로 줄 끊기 |
| `trap_oil` | 低→中 | 불 | — | 둔화 0.55 / 불붙으면 **화염 상태**(6 + 4초 동안 12) | 둔화 / 화상 | 다 타면 spent | 유도 후 점화 |
| `trap_spike` | 中 | 판 1.3 | 60틱 덜컹·판 내려앉음 | 28 **막기·대시 무적 불가** | 45(보스 ×0.5) | 5초 노출 → 45틱 회수 / 무한 | 1초 안에 뛰어 벗어나기·대시로 넘기·그림자 이동 |
| `trap_spike_auto` | 中 | 없음(자동 순환) | 30틱 덜컹 | 서 있는 가시 접촉 28 | 45 | 내려감 90 → 덜컹 30 → 가시 120 → 회수 45 반복 | 안전한 판(반대 위상) 골라 건너기 |
| `trap_gas` (포자 식물) | 中 | 근접 1.5 **또는 원거리 피격**(총·화살·서리·뇌창·해머) · **폭발·화염구는 죽임** | 30틱 개화(꽃잎 벌어짐·개화음) | 포자 구름: 시야 흔들림·스태미너 급감·기침 소음, 피해 0 | 경둔화 0.7 | 5초 구름, 8초 뒤 다시 핀다 | 멀리서 터뜨리기·벗어나기·적을 구름에 몰기 |
| `trap_gas_auto` (포자 군락) | 中 | 없음(자동 순환) | 30틱 부풀며 떨림·개화음 | 포자 구름 3.5초(독 상태) | 경둔화 0.7 | 쉼 4.5초 → 예고 0.5초 → 구름 3.5초 반복 (걷힌 뒤 5초 만에 다시) · **해머·폭발·마법으로 망가짐**(총·화살 X) | 걷힌 5초 틈에 지나가기 / 해머로 짓밟기·수류탄 |
| `trap_glyph` | 中 | 밟기 1.2 | 없음 | 오염 +6·시야 흔들림(피해 0) | **경직 2초 → 처형**(보스 ×0.5) | 1회 | 랜턴 끄고 보기 |
| `trap_rockfall` | 高 | 판 1.3 | 30틱 우르릉·천장 떨림 | 40 감쇠·넉백 | 60 감쇠·넉백 | 1회 · 잔해는 **폭발로 부숨** | 예고 듣고 빠지기·대시 무적 / 잔해는 수류탄·화염구로 치우기 |
| `trap_pendulum` | 高 | 항시 | 휭(14m) | 45·넉백 / **완벽 패링 가능** | 55(보스 ×0.3) | 2초 주기 | 리듬·패링 |

세부 규칙:
- **가시** (2026-09-02 재설계) — 밟으면 덜컹 → **1초 뒤** 가시 → **5초** 서 있음 → 회수(돌 갈림, 45틱) → 걸쇠 철컥(재무장).
  뛰어 지나가면 솟기 전에 벗어나고, 밟은 직후 대시해도 벗어난다 — 그게 컨셉. 대시·그림자 이동으로 지나가는 몸은
  판을 누르지 않는다(모든 밟는 함정 공통). 가시가 서 있을 때 들어오면 몸당 1회(나갔다 오면 또) — **대시 무적도
  소용없다**(`ignoreIframes`), 그림자 이동만 면제. 회수 중엔 피해·트리거 없음, 걸쇠가 물린 뒤에야 다시 밟힌다.
  이벤트 `trap_retract`(회수 시작) · `trap_rearmed`(걸쇠).
- **지속 피해 상태(독·화염)** — 한 틀(`Traps.applyDot`/`tickDots`, `PlayerState.dots[kind]`). 원인에 닿으면 `*Initial` 즉시 피해
  (`player_damaged`, source `poison`/`burn`, 막기 불가) 뒤 `*DurationTicks` 동안 `*Total` 이 `*TickIntervalTicks` 마다 깎인다
  (`poison_tick`/`burn_tick` — 붉은 화면·진동 없이 **'윽' 신음**만: `grunt`/`grunt_fire`). 원인 안에 서 있으면 시간만 매 틱 갱신되고
  박자(`next`)는 그대로 흐른다 — 초기 피해 반복 없음. 회피 무적·그림자 이동 중엔 새로 걸리지 않는다. 부활 시 씻긴다.
  **재시작 알림** — 이미 걸린 채 다시 닿았고 남은 시간이 `traps.dotRefreshMinDrainTicks`(1초) 이상 줄어든 뒤였으면
  `poison_refreshed`/`burn_refreshed`(재시작 소리 + 아이콘 세 번 깜빡임 + 안내). 원인 안에 서 있는 동안은 나지 않는다.
  - 독: 포자 구름, 30초. HUD `#buff-poison`, 체력 바 병든 녹색.
  - 화염(2026-09-03): 불붙은 기름 웅덩이, `trap_oil.playerBurn*`(6 + 4초 12). HUD `#buff-burn` 불꽃 아이콘, 체력 바 주황(독보다 우선).
- **포자 식물** (2026-09-02 재설계) — 배기구 대신 식물. 근접하면 **1초 바르르 떨며** 개화 뒤 분출, **한 번 터지면 끝**(시든 주머니·늘어진
  꽃잎·바닥 포자 자국이 남는다). **모든 공격이 터뜨린다** — 총(히트스캔)·화살·마법 투사체·뇌창 빔이 `hitRadius×height` 상자를
  맞히거나, 해머 부채꼴에 들면 `provokeTrap`(World 헬퍼)으로 곧장 예고 — 멀리서
  안전하게 터뜨리거나 적 옆에서 터뜨려 구름에 몰아넣는다. 시험방에는 재생성 레버(`triggers.resets`)가 있다.
  소리: 개화 `trap_bloom`, 분출 `trap_spore`. 수류탄은 식물·군락(·그물 줄)에 닿으면 **튕기지 않고 그 자리에서 터진다** — 벽·천장만 튕긴다.
  **폭발·화염구는 터뜨리지 않고 죽인다**(2026-09-03) — 수류탄·폭발통·기믹 폭발 반경 안, 화염구 직격·폭발 반경 안의 식물은
  `disarmed`: 포자 없이 검게 그을려 꺾인 모습(그을음 원, 포자 자국 없음)으로 남는다(`trap_disarmed how`, 불길 소리·주황 섬광).
  멀리서 안전하게 제거하는 수단 — 대신 자원(수류탄·마나)을 쓴다. 총·화살·서리·뇌창·해머는 여전히 터뜨린다.
- **자동 순환 포자 군락**(2026-09-03) — 말불버섯 무리(잿빛 보라 자실체 넷·검은 숨구멍·사마귀 돌기·균사 바닥), 포자 식물과 형태·색이
  다르다. `idleTicks → telegraphTicks → cloudTicks` 반복 — 구름은 일반 포자(5초)보다 짧은 3.5초, 걷힌 뒤 정확히 5초(쉼 4.5 + 예고 0.5) 만에
  다시 뿜는다. 구름 효과·독 상태는 `tickGasCloud` 공용. armed 상태가 없어 총·화살·폭발로 **터지지는** 않는다.
  **망가뜨리기** — 해머 부채꼴, 폭발(수류탄·화염구·폭발통·기믹 — `disarmTrapsInRadius`), 마법 투사체·뇌창 빔(`hitRadius×height` 상자)이
  닿으면 `disarmed`: 더 안 뿜고(진행 중 구름도 그친다) 납작하게 터진 자실체·포자 얼룩·껍질 조각으로 남는다(`trap_disarmed how`,
  소리 `trap_squash`). **총알·화살은 못 부순다** — 부드러운 자실체를 그냥 지나간다(막히지도 않는다). 레버 리셋으로 복구. 위상 `phase`/짝홀은 다른
  자동 장치와 같지만 **소리(개화·분출)는 10m 감쇠를 쓰지 않는다** — 구름은 위험하니 매 분출이 멀리서도 들린다. 이벤트 `trap_telegraph`(부풂) · `trap_fired`(뿜기) · `trap_retract`(걷힘).
- **자동 순환 장치의 소리**(자동 가시판·자동 다트·진자 — 포자 군락은 예외) — `balance.traps.autoSound`: reach(10m) 밖은 무음, 안에서는
  `(1 - d/reach)^curve` 로 줄어든다(경계에서 거의 안 들리고 바로 옆에서 제 크기). 밟는 함정은 일반 공간 음향.
- **자동 순환 다트 발사기** — 발판 없이 `-dir` 벽의 황동 노즐만. `idleTicks → telegraphTicks → 발사` 반복. 위상 `phase`/짝홀 규칙은
  자동 가시판과 같다 — 복도에 줄지어 놓고 위상을 30틱씩 어긋내면 순차 발사 회랑.
- **자동 순환 가시판** — 트리거 없이 `downTicks → telegraphTicks → upTicks → cooldownTicks` 를 돈다. 위상은 배치 `phase`(틱),
  없으면 `(row+col)` 짝홀로 반주기 어긋남(체커보드 — 인접 판이 서로 반대). 발판은 녹슨 붉은색으로 구분. 소음 없음.
  같은 틱에 여러 장이 울리면 main 이 종류별로 한 번만 소리를 낸다.
- **다트** — `ProjectileState.trapShot`. 적 소유지만 `friendlyFireDamageMul` 을 받지 않고, 적을 맞히면
  `damage_pop`·처치 `trap_kill`. `casterId` 없음 → 반사되면 속도 반전(Reaction 기존 경로).
- **그물** — 해체 판정: 해머 부채꼴(`Weapons`), 권총 히트스캔·플레이어 투사체(y 0.3~lineHeight+0.15 상자)
  → `disarmTrap` → `trap_disarmed {how}`.
- **기름** — 점화 훅 `igniteOilInRadius`: `Explosion.explodeAt`, 화염구 폭발, 수류탄, 불타는 적 통과,
  타는 기름의 `chainRadius` 연쇄. 적 화상은 기존 `Projectiles.applyBurns` 가 피해·처치를 맡는다.
  둔화는 점액과 **겹쳐도 더 센 하나만**(PlayerMove).
- **문양** — 가시성 = `랜턴 꺼짐 || 오염 ≥ 25(문양 해독) || revealed`. 적 경직은 패링 스태거와 같은 필드
  (`ai='staggered'`, `timer`, `attackFreezeTicks=0`, `wantsBash=false`) → Reaction 처형 대상.
- **낙석** — 잔해 = `Level.addBlocker`(몸) + `Level.setPathBlocked`(적 추격 흐름장이 벽으로 본다).
  **잔해 폭파**(2026-09-03, `rubbleBreakable`) — 폭발(수류탄·화염구·폭발통·기믹 폭발) 반경이 잔해 상자의 가장 가까운 점에 닿으면
  `breakRubbleInRadius`(World 헬퍼)가 차단·경로 막힘을 걷고 `rubbleBroken` 을 세운다 → `trap_rubble_broken`(붕괴 소리·먼지·진동,
  "길이 열렸다"). 함정은 spent 그대로(다시 안 떨어짐), 모형은 낮은 자갈 더미. 총·화살·해머로는 안 부서진다 — 돌아가기 vs 자원 쓰기.
  총알·소음은 넘어간다. 배치 검증: 잔해가 전부 내려와도 S→X·제단 연결 유지(소프트락 방지).
- **진자** — `cycleTick` 주기. 최저점 창(±`hitWindowTicks/2`) 안 몸당 1회(`hitIds`). 최저점 `parryLeadTicks`
  전에 누른 반응은 `parryBufferTicks` 로 살려 두고, 타격 틱에 `reactionPressed || parryBufferTicks` 면
  완벽 패링 — `parry_attempt {result:'perfect', enemyType:'trap_pendulum'}` (Mana·Metrics 가 듣는다).
  Reaction 을 건드리지 않는다 (박쥐 돌진 패링과 같은 방식). 진폭 끝에서 시작해 진입 직후 사고 방지.
- **적 둔화 공통** — `frostStacks > 0` 인 적은 건너뛴다(둔화 만료가 서리 겹을 지우므로), `slowTicks` 는 max,
  `slowMul` 은 min.

## 4. 함정 감지 각인 (`sig_trapsense`, 눈·패시브)

`Modifiers.revealTrapsRadius`(기본 0). `Traps.tick` 첫머리에서 반경 안 미spent 함정을 `revealed=true` 로 —
`trap_revealed` 1회(띵), 이후 보라 점광 명멸. 한 번 알아챈 것은 각인을 빼도 잊지 않는다.
저주 문양은 revealed 면 랜턴을 켠 채로도 보인다.

## 5. 이벤트 계약

`trap_triggered {id,type,x,z,by}` · `trap_telegraph` · `trap_fired {…,dirX,dirZ}` · `trap_spent` ·
`trap_hit_player {id,type,amount}` · `trap_hit_enemy {…,enemyId,amount}` · `trap_kill {enemyType,trapType}` ·
`trap_disarmed {…,how}` · `trap_ignited` · `trap_glyph_burst {…,victim}` · `trap_gas_cough` · `trap_whoosh` ·
`trap_parried` · `trap_revealed` · `trap_rubble_broken`. 플레이어 피해 `source`: `trap_spike / trap_dart / trap_fire / trap_rockfall(폭발 결 진동) / trap_pendulum`.
Metrics 는 `docs/metrics.md` 함정 표.

## 6. 데이터·배치

- 수치: `balance.traps.types[type]` (절대 하드코딩 금지). 렌더 상수(색·크기)만 `TrapVisuals`.
- 배치: 레벨 JSON `entities` `{type:'trap_*', cell, dir?, note?}`. 생성은 `/tmp/lv/genlevel2.py` `trap()`.
- 검증(세 곳 동일): 바닥 칸 / 계단 8m 밖 / 제단 10m 밖 / 다트 `-dir` 칸 벽 / 그물·진자·낙석 통행 축 양옆 벽 /
  낙석 연결성 — `check_traps`(genlevel2) · `scripts/checklevel.mjs` · `Zone.test.ts`.
- 층별: 1층 다트 2·그물 2·기름 3 (배우는 층) / 2층 가시 2·문양 2·가스 2·다트 1 / 3층 진자 2·낙석 1·가시·문양.

## 7. 알려진 긴장

- 진자 타이밍에 반응을 눌렀는데 4.6m 안에 windup 중인 적이 있으면 Reaction 실패 경직(20틱) — 의도된 긴장.
- 히트스톱은 systems 전체를 멈추므로 진자도 멈춘다 (자연스럽다).
- 낙석 잔해는 폭발로만 치울 수 있다(수류탄 1개 또는 화염구 마나) — 배치 검증이 연결성을 보장하지만, 새 층을 짤 때 반드시 `check_traps` 를 통과시킬 것.
