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
| `trap_dart` | 低 | 판 1.3 | 18틱 쉬익·노즐 붉음 | 8×3 화살(방패 완전 차단) | 8 풀피해(오사 감쇄 없음) | 90틱 / 2회 | 반사(마나 15)·방어·회피 |
| `trap_net` | 低 | 줄 1.0 | 없음(낙하 12틱 연출) | 거미줄 상태 | 완전 둔화 6초 | 1회 | 해머·총·투사체로 줄 끊기 |
| `trap_oil` | 低→中 | 불 | — | 둔화 0.55 / 불붙으면 0.5초마다 4 | 둔화 / 화상 | 다 타면 spent | 유도 후 점화 |
| `trap_spike` | 中 | 판 1.3 | 60틱 덜컹·판 내려앉음 | 28 **막기·대시 무적 불가** | 45(보스 ×0.5) | 5초 노출 → 45틱 회수 / 무한 | 1초 안에 뛰어 벗어나기·대시로 넘기·그림자 이동 |
| `trap_spike_auto` | 中 | 없음(자동 순환) | 30틱 덜컹 | 서 있는 가시 접촉 28 | 45 | 내려감 90 → 덜컹 30 → 가시 120 → 회수 45 반복 | 안전한 판(반대 위상) 골라 건너기 |
| `trap_gas` | 中 | 근접 1.5 | 30틱 쉬익 | 시야 흔들림·스태미너 급감·기침 소음 | 경둔화 0.7 | 480틱 / 무한 | 벗어나기 |
| `trap_glyph` | 中 | 밟기 1.2 | 없음 | 오염 +6·시야 흔들림(피해 0) | **경직 2초 → 처형**(보스 ×0.5) | 1회 | 랜턴 끄고 보기 |
| `trap_rockfall` | 高 | 판 1.3 | 30틱 우르릉·천장 떨림 | 40 감쇠·넉백 | 60 감쇠·넉백 | 1회 | 예고 듣고 빠지기 |
| `trap_pendulum` | 高 | 항시 | 휭(14m) | 45·넉백 / **완벽 패링 가능** | 55(보스 ×0.3) | 2초 주기 | 리듬·패링 |

세부 규칙:
- **가시** (2026-09-02 재설계) — 밟으면 덜컹 → **1초 뒤** 가시 → **5초** 서 있음 → 회수(돌 갈림, 45틱) → 걸쇠 철컥(재무장).
  뛰어 지나가면 솟기 전에 벗어나고, 밟은 직후 대시해도 벗어난다 — 그게 컨셉. 대시·그림자 이동으로 지나가는 몸은
  판을 누르지 않는다(모든 밟는 함정 공통). 가시가 서 있을 때 들어오면 몸당 1회(나갔다 오면 또) — **대시 무적도
  소용없다**(`ignoreIframes`), 그림자 이동만 면제. 회수 중엔 피해·트리거 없음, 걸쇠가 물린 뒤에야 다시 밟힌다.
  이벤트 `trap_retract`(회수 시작) · `trap_rearmed`(걸쇠).
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
`trap_parried` · `trap_revealed`. 플레이어 피해 `source`: `trap_spike / trap_dart / trap_fire / trap_rockfall(폭발 결 진동) / trap_pendulum`.
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
- 낙석 잔해는 영구 — 배치 검증이 연결성을 보장하지만, 새 층을 짤 때 반드시 `check_traps` 를 통과시킬 것.
