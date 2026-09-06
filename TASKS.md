# TASKS — 1구역 버티컬 슬라이스

각 체크박스는 하나의 작업 단위다. **완료 시점에 게임이 실행되고 플레이 가능해야 한다.**
"시스템 구현"이 아니라 "무엇을 할 수 있게 되는가"로 기술한다.

---

## M0 — 뼈대

- [x] **0.1** Vite + TS + Three.js 프로젝트 생성. 빈 씬에 바닥 평면 하나가 렌더된다
- [x] **0.2** `core/Loop.ts` — 고정 60Hz 틱 + 보간 렌더. 화면에 현재 틱 수가 표시된다
- [x] **0.3** `core/World.ts`, `core/Events.ts` 골격. 이벤트 발행/구독이 콘솔에 찍힌다
- [x] **0.4** `data/balance.json` 로더. 값 하나를 읽어 화면에 표시한다

**완료 조건** — 브라우저에서 실행되고, 틱 카운터가 정확히 초당 60씩 증가한다

---

## M1 — 이동과 시야

- [x] **1.1** 1인칭 카메라 + 마우스 룩 (포인터 락). 둘러볼 수 있다
- [x] **1.2** WASD 이동 + 스윕 AABB 충돌. 벽을 통과하지 못한다
- [x] **1.3** ASCII 그리드 레벨 로더. `z01_f1.json`이 3D 미로로 생성된다
- [x] **1.4** 랜턴 — 스포트라이트 + ON/OFF 토글 + 배터리 소모. 끄면 앞이 안 보인다

**완료 조건** — 어두운 미로를 랜턴을 켜고 끄며 돌아다닐 수 있다

---

## M2 — 사격과 첫 적

- [x] **2.1** 권총 — 레이캐스트 사격, 총구 화염이 순간적으로 주변을 밝힌다
- [x] **2.2** 탄약 카운터 + 상한. 탄이 떨어지면 발사되지 않는다
- [x] **2.3** 고블린 러너 — 직선 추격 AI, 접촉 피해, 피격 시 사망
- [x] **2.4** 플레이어 체력 + 사망 → 리스타트

**완료 조건** — 미로에서 고블린을 총으로 잡을 수 있고, 총알이 실제로 모자란다

---

## M3 — 반응 버튼 (핵심 검증 구간)

- [x] **3.1** 고블린 창병 — 예비 동작 → 청색 섬광 → 근접 공격. 텔레그래프가 눈에 보인다
- [x] **3.2** 반응 입력 + 틱 기반 판정 창 (완벽 6t / 일반 12t / 실패 경직 20t)
- [x] **3.3** 패링 성공 피드백 — 히트스톱 4t, 화면 탈색, 사운드
- [x] **3.4** 패링 후 반격 처형

**완료 조건** — 창병 하나를 순수 패링만으로 잡을 수 있고, 타이밍이 손에 잡힌다

> 이 구간이 프로토타입의 최대 리스크다. 여기서 손맛이 안 나오면 이후 작업을 진행하지 말고 판정 창과 피드백부터 다시 잡는다.

---

## M4 — 마나 경제

- [x] **4.1** 마나 게이지. 완벽 패링/처형/근접 처치로만 상승. **총기 처치는 0**
- [x] **4.2** 전투 종료 감지 → 마나 휘발 (수 초에 걸쳐 감소)
- [x] **4.3** 연쇄 배율 (1.0 / 1.4 / 1.8 / 2.5). 피격·마법 사용 시 리셋
- [x] **4.4** 패링 실패 시 축적 마나 절반 소실

**완료 조건** — 총으로만 플레이하면 마나가 0에 머무는 것이 명확히 체감된다

---

## M5 — 마법과 각인

- [x] **5.1** 화염구 (소형, 오른팔) — 시전, 투사체, 화상
- [x] **5.2** 각인 추출 — 처형 시 드랍, 인벤토리에 쌓임. 소지만으로는 무효
- [x] **5.3** 각인 부착 UI (부위 5개 슬롯). 부착 시 페널티 즉시 적용
- [x] **5.4** 돌진 회피 (척추), 암시야 (눈) 추가

**완료 조건** — 각인을 부착하면 재장전이 느려지는 것을 플레이어가 알아챈다

---

## M6 — 제단과 오염

- [x] **6.1** 제단 오브젝트 — 접촉 시 탄약 **상한까지** 보급 (잔탄 무관)
- [x] **6.2** 세이브/리스폰 지점 등록
- [x] **6.3** 각인 교체 + 흉터 (페널티 절반 잔존)
- [x] **6.4** 오염 게이지 + 제단 접촉 시 정산
- [x] **6.5** 오염 25 임계 — 벽의 문자 해독 개시, 손 모델 1단계 변화

**완료 조건** — 잔탄을 남기고 제단에 들어가면 손해라는 것을 플레이어가 학습한다

---

## M7 — 상성과 보스

- [x] **7.1** 수호주술사 — 마법 방어막. **9mm 관통탄으로만 격파 가능**
- [x] **7.2** 마법·근접이 방어막에 무효라는 피드백 (튕김 이펙트 + 사운드)
- [x] **7.3** 1구역 보스 — 2페이즈, 패링 구간 + 실탄 구간 교대
- [x] **7.4** 보스 처치 → 암시야 각인 드랍 → 구역 클리어

**완료 조건** — "총알을 아꼈다가 주술사에게 써야 한다"는 판단이 자연스럽게 발생한다

---

## M8 — 계측과 튜닝

- [x] **8.1** `Metrics.ts` — 잔탄율, 마나 휘발률, 패링 성공률, 교전당 패링 시도 수집
- [x] **8.2** 세션 종료 시 JSON 덤프 다운로드 (F2, 사망·클리어 시 콘솔 자동 출력)
- [x] **8.3** 디버그 오버레이 (F1) — 실시간 지표 표시
- [ ] **8.4** 수집 데이터 기반으로 `balance.json` 1차 튜닝 ← **실제 플레이 데이터 필요 — 플레이 후 F2 덤프를 기반으로 진행**

**완료 조건** — 플레이 한 판이 끝나면 `docs/metrics.md`의 지표 전부가 숫자로 나온다

---

## M9 — 던전 함정 (2026-09-02 기획 확정 — 8종 + 함정 감지 각인, 플레이어·적 공용, 低·中·高 혼합)

- [x] **9.0** 골격(`Traps.ts`·`TrapState`·`spawnTraps`·`TrapVisuals`·계측·레벨 검증) + ① 다트 벽 + ④ 가시 압력판 — f1 다트 2·f2 가시 2 배치
- [x] **9.1** ② 그물 덫(해머·총 해체) + ③ 기름 웅덩이(불로 점화·연쇄) + ⑥ 저주 문양(오염 +6 / 적 경직→처형) — f1 그물·기름, f2 문양 배치 → **문양은 2026-09-03 폐기**(재미 없음)
- [x] **9.2** ⑤ 독가스 배기구 + ⑦ 낙석(잔해 저지대·적 경로 차단) + ⑧ 진자 칼날(완벽 패링) — f2 가스, f3 낙석·진자 배치
- [x] **9.3** 함정 감지 각인(`sig_trapsense`) 실구현 + 층별 배치 총점검 + `docs/systems/traps.md`

## M10 — 전리품 주머니 · 루팅 UI (2026-09-04 확정 — 처치 드랩은 주머니로, 상자도 컨테이너, 시간 정지 루팅, 가방 아이템은 E 습득)

- [x] **10.1** 주머니 드랍(`Loot.ts` — 굴림·병합·안착·바라보기·E 열기) + 루팅 창(`LootUI.ts` — 두 칸, 하나/모두 가져오기·넣기·버리기·닫기, 키보드·마우스·패드) + 계측
- [x] **10.2** 보물상자를 컨테이너로(`chestItems` 1회 롤, 각인 줄 → Sigils 습득), 부활 시 상자 재스폰 제거
- [x] **10.3** 연출 마무리(아이콘 비행·거부 흔들림 검수) + 주머니 안착 소리 + 문서(`docs/systems/loot.md`, metrics)
- [x] **10.4** 바닥 소모품 E 줍기(`itemInView`) + 소모품 자석 폐지 + 가득 참 튕김(`pickup_bounced`) + economy 문서 갱신

**완료 조건** — 적을 함정 위로 유도해 잡는 플레이가 실제로 일어나고(`traps.hitsEnemy`), 함정 사망(`traps.deaths`)이 "억울"이 아니라 "내 실수"로 읽힌다

---

## M11 — 낫뿔 거수 (2026-09-04 기획 확정 — `docs/systems/boss_scythe_behemoth.md` §13, 3 배치 · 15 체크박스)

- [x] **B1-1** 정의·스포너·테스트 — `scythe_behemoth`(attack 오른낫 파랑 + chargeAttack 빨강 hitOnContact 72틱, 임시 parriesToStagger 2 + executeDamage 240, hitBox·alertRadius·chargeOnKnockback), Spawner IMPLEMENTED, Boss.test describe
- [x] **B1-2** 외형 — Stage behemoth 분기(몸통·다리·높은 머리·뿔·낫 2자루 리그·등갑판·약점 구체 5개 장식), `debug/behemoth` 스크린샷 6장(기본 정면·측면·낫 예고·낫 타격 측면/정면·돌격 예고 + 튕김) + 시험방 3장 — rear/head_down/roar/P2 정면/P3 는 해당 자세가 생기는 B2/B3 에서
- [x] **B1-3** 왼낫 교대·들이받기 — `attackAlt`(왼낫 28틱, `alternate`)/`closeAttack`(들이받기 3.0m 안 우선·쿨 240·패링 불가·빨강), attackMode 'alt'|'close', Enemies 교대 선택(`lastBlade`)·`pickMeleeMode`, Stage 왼팔 연출·머리 뒤로 젓기+뿔 빨강, `debug/behemoth` windup-left/headbutt/headbutt-strike 뷰
- [x] **B2-1** 약점 판정 코어 — `rayVsSphere`, `weakPoints[]`/`poseOffsets`/`rayHitsWeakPoint`, hitZonesImmune, 권총·화살 약점 우선. Stage: `poseBehemothRig` 끝의 anchors 추종 루프 제거 → `poseOffsets` 표로 구체 배치(현재 앵커 추종은 표와 어긋남 — 돌격 예고 눈 (0,1.02,−2.32) vs 표 (0,1.1,−1.95)). 구체 발광·`flashWeakPoint`, `weak_point_hit/broken`, HUD '약점!'·진동, `debug/behemoth ?view=weak`·`&pose=`, WeakPoint.test·Behemoth.test(render)
- [x] **B2-2** 패링 → 노출·머리 내림·눈 혼절 — `parryOutcome expose`(일반 = 그 낫의 관절 36틱 `exposeOnParry` / 완벽 = 관절 90 + `head_down` 90), `weakPointOpen` 조건부(노출 타이머 `exposure`·`exposedStates`), 눈 누적 66(`weakPoint.dazeThreshold`) → staggered + `boss_staggered{cause 'eye'}`, 혼절 중 눈 닫힘, `dazeCooldownTicks` 600(피해만·어두운 청록), 해머 `hammerEyeMul`·`noKnockbackWhileHeadDown`·`staggerFlingImmune`, 임시 parriesToStagger 제거. Stage: 목 IK(`solveNeckToEye`)로 머리 메시 눈 = 표 구체(charge·head_down·stunned), 다리 바닥 보정, 박힌 낫, `poseBlend` 보간. Boss.test 의 리그 검사 → `src/render/Behemoth.test.ts`. `debug/behemoth` 스크린샷 head_down·head_down-side·head_down-cooldown·stunned
- [x] **B2-3** 관절 파열·낫 잠김·절뚝·완벽 회피 — 관절 hp 132 → 0 이면 `ruptureJoint`(recover 60 비틀거림 + 그 낫 `bladeLock` 600, 낫 ↔ 관절 짝은 `exposeOnParry.joint` 의 역 `bladeOfJoint`), `pickMeleeMode` 가 잠긴 낫을 건너뛰고 둘 다 잠기면 null → `holdDisarmedRange`(`retreatWhenDisarmed{2.5, 6}` 물러서기·유지), 절뚝 `limping`(이속 ×0.65·돌격 ×0.7), impact 의 `reaches && iframeTicks > 0` + `perfectDodgeExposes{40, joints}` → `charge_dodged` + `beginPose(skid 90)` + 양 관절 노출, `boss_status` rupture{id, blade}/limp/skid. Stage: 잠긴 낫 늘어져 바닥 긁기·skid 옆 8° 굴림(어깨 축 — 15° 는 양 어깨를 높이 0.6m 갈라 표(둘 다 2.4)의 구체가 관절 메시를 벗어나 줄임; 앞으로 −0.15 미끄러지며 +0.06 뒤로 젖혀 어깨 z 를 표에 맞춤, 눈은 목 IK 로 표 자리·관절 메시–구체 ≤ 0.2m(움찔 ≤ 0.30 = 구체 반지름, 측정 0.25) 를 Behemoth.test 가 못박음 — 다리 되돌림 ZXY)·절뚝 걸음·파열 파편(main). 소리 `joint_crack`·`charge_dodged`. `balance.weakPoint.{rupture, limp, skid}`. `debug/behemoth` 스크린샷 skid·rupture·limp + 시험방(파열·절뚝·미끄러짐)
- [x] **B2-4** 플레이어 상태 2종(팔 저림·진탕) + `Status.ts` — `PlayerState` 옵셔널 `numbArmTicks/concussionTicks/statusOrder`, `core/World` `PlayerStatusKind`·`setPlayerStatus`(긴 쪽 갱신, 0 = 해제 예약), `src/systems/Status.ts` 신규(감소·`maxConcurrent` 2 상한 = 가장 오래된 것 해제·`${kind}_applied/_ended{reason expired|cured|displaced}`·진탕 aimShake 채널 싣기/일찍 끝나면 놓기), main systems 배열(Reaction 뒤). `EnemyAttackDef.statusOnHit/statusOnBlock` — 낫 `statusOnBlock 'numb_arm'`(impact blocked), 돌격 `statusOnHit 'concussion'`(막지 않은 직격만). 팔 저림 240: Reaction 완벽 대역 ×`perfectBandMul 0`(정직하게 일반만)·실패 `parry_attempt.noManaLoss`(Mana 소실 면제, 연쇄 리셋은 그대로)·일반 패링 1회 → 0, PlayerMove 방어 이속 `blockSpeedMul 0.25`. 진탕 360: aimShake 0.02, Stage `cameraTiltDeg` 3° 롤(부드럽게 들고 남), `Audio.setDuckDb` −6dB(예고음 버스 `TELEGRAPH_SOUNDS` = telegraph_*·charge_ready 우회), `Items.drink` 체력 물약이 지움(`items.kinds.potion/potion_large.cures ['concussion']` × `potionCures` — `Inventory.curableStatuses`, 말린 고기는 지우지 않는다) + `Inventory.isUseful` '지울 상태가 있으면 유용'. `Status.clearAll` 은 진탕이 빌린 aimShake 채널도 놓는다. HUD `#buff-numb`·`#buff-concussion`(#buff-burn 틀) + 안내 문구 + 콘솔 등록, `loadFloor`/`respawnAtAltar` 에서 `Status.clearAll`. `balance.status`. Status.test 21건 + Boss.test (b) 갱신. 시험방 스크린샷 1장(막기 → 저림, 돌격 직격 → 진탕 — 아이콘 2개·기울기·문구)
- [x] **B2-5** 돌격 눈멂·지형 충돌·기둥 문자 `P` — `GridLoader` `P`(SOLID, 밝은 돌 0x8a8378 상자 + 정 자국 띠, `pillar-r-c` 개별 메시 — 내구 균열선·붕괴는 B3-5), `test_monsters.json` P 넷(가운데 표식 동서남북 16m, 소환 부채꼴 밖), Zone/GridLoader 테스트 P 허용. Enemies: 질주 중 플레이어 ≤ `blindRangeM` 6 → 눈 노출 타이머(매 틱 되살림, `expose{id eye}`), 누적 `blindThreshold` 66 → `blind`(목표 무시·yaw 직진·조향 없음·timer += `blindOverrunTicks` 40·눈 닫힘, 접촉 피해 그대로, 완벽 회피가 우선), `chargeStuckTicks` 2(이동 < 기대 × unstick.minProgress 연속) → `chargeCollide` 가 막힌 몸의 선두 면 너머 칸을 몸 폭 전체로 읽어(`Level.blockedAhead` — slideMove 와 같은 AABB 기하, 중심 칸 우선·모서리 스침 포함, 소품·아군에 막힌 것은 충돌 아님) 셀 문자: P → `pillar_hit` + `topple`(`head_down` `toppleTicks` 90, cause 'topple', 혼절 누적 가능) + `toppleReboundM` 2.5m 튕김(내려온 눈이 기둥에 묻히지 않게 — 기획서엔 없던 추가) / C → `World.breakCrackWalls`(Projectiles 에서 core 로 이동, 호출만) + 같은 전도 / #·문 → `chargeAttack.wallWhiffRecoverTicks` 60 헛돌격(`enemy_whiffed{wall}`, 눈 안 열림). Stage `blind` 목 yaw 휘저음, Audio `behemoth_scream`, main 문구·`heavy_hit`·카메라 킥, Metrics blinds/topples/pillarHits. Boss.test 7건 + GridLoader/Zone/Behemoth/Metrics 테스트, `debug/behemoth ?view=blind|topple`. 시험방 스크린샷(기둥·전도) + 돌격을 P 에 박게 유도한 헤드리스 로그(/tmp/pw/behemoth-b25-*.png)
- [x] **B2-6** 페이즈 골격 — `EnemyDef.phases[]{bar, name, shiftText, unlock, speedMul, attackOverrides, poolsOn, shellPlatesOn, shedPlates, firstPick}` + `Entities.resolvePhase`(누적 합치기 — 낮은 bar 가 덮고 unlock 은 합침)·`attackInPhase`/`currentAttack`(슬롯별 damage·cooldownTicks·aoeRadius 덮어쓰기, 캐시)·`slotUnlocked`(volley 는 P2 부터 — 족장은 늘 참). `EnemyState.phase/phaseTarget/phaseSince/molting`, Spawner 초기 phase = 첫 칸. Enemies `tickPhase`: `healthBarState.index < phase` 면 `phaseTarget` 갱신 → 막는 창(staggered·포즈 타이머·blind·넉백) 밖의 첫 틱에 `beginPhaseShift` 한 번(두 경계를 넘었으면 P2 건너뛴 P3, 연출은 P3 것) → `boss_phase{phase, from, skipped, fromTicks}` + `boss_status molt on/off`: recover `phaseShiftTicks` 90 + pose `roar`, 진행 중 공격 취소(attackMode melee·질주·연사), 노출 전부 닫힘 + `molting` 이 `weakPointOpen` 을 막음, 갑각 재생(낫 짝 관절 `weakHp` 회복 + `ruptured[id]` 삭제 + `bladeLock` 해제 → rupture off·limp off), 공격 쿨다운 × `phaseShiftCooldownMul` 0.5(혼절 쿨다운은 그대로), 무적 아님. `moveSpeed` × speedMul(걷기만), chase 의 돌격·들이받기 쿨다운은 `attackInPhase`. 사망 시 `boss_phase{phase 0, death}` 로 마지막 페이즈 시간. main: HUD 보스 줄 페이즈명(`낫뿔 거수 — 오염 갑각`), `boss_phase` → `boss_roar`·카메라 킥·진동·문구(`갑각이 갈라진다`/`거수가 광란한다`), `plate_shed` → `Stage.shedBehemothPlates`(판 위치에서 몸통색 파편 power 0.6, 등 뒤로). Stage: 등갑판 이음새 2 + 실금 3 균열(0x39ff88 숨쉬기, P2 `shellPlatesOn`), 분출공 점등(`lit` — 은은한 발광·맥동 없음), P3 `shedPlates` 에 판·균열 숨김 + 눈 붉은 홍채(눈 구체 자식), `pose roar`(목 IK 눈 2.9m·턱 −0.8rad·두 낫 벌려 들기·`roarLean` 0.02 — 천장 3.8 검사 통과), `setBehemothPhaseLook`/`behemothVentLit`. Metrics `boss{phaseShifts, phaseSkips, phaseSeconds}`. `balance.weakPoint.{phaseShiftTicks 90, phaseShiftCooldownMul 0.5}`. Boss.test B2-6 9건(데이터·경계 전환·공격 취소·큐잉(머리 내림→혼절→처형 넉백 뒤 1회)·2단 건너뜀·갑각 재생(재파열 포함)·P3 낫 34 실타격·족장 무변화·사망 계측) + Metrics.test + Behemoth.test(roar 천장·IK·턱, 균열·홍채·점등). `debug/behemoth ?view=roar|p2|p3`. 시험방 스크린샷(P2 전환 연출) /tmp/pw/behemoth-b26-room-p2.png
- [x] **B3-1** P2 발구르기·심장·절뚝 — `slamAttack`(attackMode 'slam', P2 해금 'slam': type contact 원형 aoe 5.0 각 무시·패링 불가·빨강·46틱·24·4m/14틱·2.5 < d ≤ 6·쿨 420·`statusOnHit 'hobble'`, 막으면 칩 7.2 만) — chase 선택 순위 낫·들이받기 다음, 돌격 앞(`trySlam`, 양 낫 잠김이면 물러서기보다 먼저). `rearPose{8, 36}`: 예고 경과 8 ≤ t < 36(28틱) 에 pose 'rear'(④ enterRear/exitRear — `boss_status rear{sealed}` on/off, 심장 exposedStates 로 열림, 표 (0, 1.15, −1.0), 닫힐 때 `exposure_closed{heart, hits}`). 심장 누적 `weakPoint.heartThreshold` 66 → `beginBackflow`(⑪ — ④ 앞에서 봐 마지막 틱도 잡는다): 발구르기 취소(AoE·ground_slam 없음) + 자해 `backflow.selfDamage` 45(damage_pop) + `head_down` `headDown.backflowTicks` 60(cause 'backflow' — `poseCause`, 눈 ×3.0 피해만·혼절 누적 없음) + 심장 `weakCooldown` `heartCooldownTicks` 600(`Entities.weakPointOpen` 이 닫음·Stage sealed 어둡게) + `boss_status backflow{ticks, selfDamage}` on/off. `wakeSlam{windupTicks 30}`(P2 해금 'wakeSlam'): 머리 내림(전 원인)·혼절(시간·처형)이 끝나는 자리(endPose·③)에서 `wakeSlamPending` → 다음 추격 틱에 거리·쿨 무관 확정(`Entities.wakeSlamAttack` = slamAttack + 예고 30 − rearPose, 슬롯 'wakeSlam' 이라 P3 덮어쓰기 없음 24/5.0), 미끄러짐 뒤엔 없음·전환이 지움. 착지 `slam_landed{radius, wake, hit}`(웅덩이는 B3-2) + `enemy_slam_start{wake}`. 플레이어 `hobble`(`PlayerStatusKind` 3종째, `hobbleTicks`, `balance.status.hobble{300, dodgeStaminaMul 2, noSprint}`): Reaction.tryDodge 스태미너 ×2(거리·무적 그대로), PlayerMove 질주 불가, HUD `#buff-hobble` + 안내. Stage: `pose rear`(몸통 +35° 를 몸통 가운데 축으로 — `behemothRearOffset` 축 보정 앞 1.02·위 0.43, 앞다리 들림(바닥 보정 없음)·뒷다리 바닥·두 낫 앞아래·꼬리 되듦·머리 faceUp IK 3.0m, 심장 진홍 맥동 = weakPointOpen), 발구르기 예고 앞발 낮게(`slamCoil`)·착지 내리찍음(`slamming`), 역류 머리 내림은 낫 안 박힘(두 낫 매달림, `poseCause`)·`lurchBehemoth` 들썩, 봉인 심장 `sealed` 어둡게. 소리 `stomp_ready`(예고음 버스)·`vent_gag`. Metrics `weakPoints.backflows`. Boss.test B3-1 8건 + Behemoth.test(rear 천장·바닥·심장 메시 = 구체 ≤ 0.03·앞발 공중·뒷발 바닥, 역류 팔, sealed 표시) + Status.test 데이터. `debug/behemoth ?view=rear|rear-side|rear-sealed|wake-slam|backflow`. 스크린샷 /tmp/pw/behemoth-b31-rear.png·-rear-side.png + 시험방 /tmp/pw/behemoth-b31-room-rear.png
- [ ] **B3-2** 웅덩이·오염 진액·갑각 떨기·분출공 — `Hazards.ts`, `debug/behemoth` 스크린샷(P2 정면 — 분출공이 머리에 가리지 않는지)
- [ ] **B3-3** 갑각판 hp 풀·골드, `debug/behemoth` 스크린샷(P3 등갑판 탈락)
- [ ] **B3-4** P3 기술 — 포효·삼연낫·광란 돌격·위압, `debug/behemoth` 스크린샷(roar)
- [ ] **B3-5** 아레나 f4 + `Arena.ts`
- [ ] **B3-6** 보상·마무리 — 유일 반지·오염 정화·문서

**완료 조건** — 4층 「무저갱 우리」에서 완벽/일반 패링·회피·약점 사격 노선이 전부 열리고, 평균 플레이어 4~6분 · 숙련자 하한 ≈ 2분

---

### 배치 2 검토 잔여 메모 (전부 저순위 — 배치 3 구현 때 함께 처리, 2026-09-04)

- [ ] (B2-1) 관절 원뿔 기하 — facing (1, 0.4, −0.4)·coneDeg 100 을 그대로 쓰면 정면(패링 자리, 4.4m·눈높이 1.6)에서 joint_r 을 겨눈 레이의 dot(rayDir, facing) ≈ +0.02 로 임계 −0.643 을 크게 벗어나, 보이는 관절을 정면에서는 절대 못 맞힌다(성립하려면 보스 정면축 기준 ≥ 약 43° 우측 전방). data/entities.json·기획서 §4.2 수치 그대로라 구현 결함은 아니지만, 기획서 본문의 '정면·그쪽 옆면에서만' 과 어긋나고 B2-2 에서 패링(정면)→관절 노출 36틱이 붙으면 노출 창 안에 우측으로 크게 돌아야 해 체감이 깨질 수 있다.
  → B2-2 전에 기획서 소유자가 확인: facing 을 (1, 0.3, −0.7) 처럼 더 앞으로 기울이거나 관절 coneDeg 를 140° 안팎으로 넓혀 정면 4.4m 에서 성립하게 하고, WeakPoint.test 에 '정면 4.4m 에서 joint_r ○' 케이스를 추가. 코드 변경 없이 entities.json 만 고치면 된다(src/core/Entities.ts rayHitsWeakPoint 는 데이터를 그대로 읽는다).
- [ ] (B2-1) 돌격 예고·질주·들이받기 중 눈 구체가 표(normal 2.35m)에 남아 내려간 머리 메시와 0.38~0.49m 떨어져 보인다(/tmp/pw/behemoth-b21-charge-pose.png 에선 &pose=charge 로 구체가 머리 메시 안에 숨는다). 실제 게임에선 enemy.pose 를 세우는 코드가 아직 없어 돌격 중 눈 구체가 머리 위에 떠 있다. 판정=그림은 지켜지지만 그림≠메시. 구현자가 공개했고 TASKS B2-2 메모(BH_NECK_DOWN·neck 피벗·chargeCrouch 재조정 + enemy.pose 세우기)에 들어 있다.
  → B2-2 에서 Enemies 가 돌격 예고·질주에 enemy.pose='charge' 를 세우고 Stage 의 목 피벗을 표의 charge 눈 (0,1.1,−1.95)/head_down (0,0.9,−1.9) 에 맞춘다. src/render/Behemoth.test.ts 에 'charge 자세에서 anchor(eye) 와 구체 거리 < 0.1m' 검사를 추가해 잠근다.
- [x] (B2-1) docs/metrics.md 의 weak_point_broken 페이로드가 { enemyId, enemyType, id } 로 적혀 있는데 src/core/World.ts hitWeakPoint 는 x, y, z 도 함께 발행한다(main.ts 가 panAt(b.x, b.z) 로 소비).
  → docs/metrics.md 45~46행을 weak_point_broken { enemyId, enemyType, id, x, y, z } 로 맞춘다.
- [ ] (B2-2) 판정과 그림의 일시적 어긋남 — /Users/shimu/Dev/GameDev/underworld/src/render/Stage.ts 의 poseBlend(BH_POSE_BLEND_K 0.35/프레임)는 head_down 이 서는 순간 구체·머리를 normal → 표 자리로 약 10 프레임에 걸쳐 보간하지만, 로직(Entities.weakPointWorldPos, enemy.pose)은 같은 틱에 즉시 표 자리(눈 0.9m)로 간다. 완벽 패링 히트스톱 4틱 동안 렌더가 계속 돌아 대부분 가려지지만(4프레임 뒤 82%), 로직 재개 직후 ~5프레임은 보이는 눈 구체가 실제 판정 자리보다 최대 ~0.26m 위에 있다. 혼절 전이(head_down → stunned)에서도 열려 있는 관절 구체가 0.28m 를 몇 프레임 늦게 따라간다.
  → 규약 '보이는 자리 = 판정 자리' 를 엄격히 지키려면 pose 가 새로 서는 프레임엔 bhBlend 를 1 로 스냅하고(사라질 때만 부드럽게), 또는 로직 쪽에서 head_down 첫 N 틱을 히트스톱에 포함시켜 보간이 끝난 뒤 판정이 열리게 한다. 현재는 히트스톱 4틱이 대부분을 가리므로 배포 차단 사유는 아니다.
- [x] (B2-2, B3-1 에서 처리) 기획서 드리프트 — /Users/shimu/Dev/GameDev/underworld/docs/systems/boss_scythe_behemoth.md §14 의 exposeOnParry{normalTicks, perfectTicks} 에 코드가 추가한 joint 필드가 없고, §2 자세 표의 head_down '몸통 +20° 앞 기울임' 은 구현(BEHEMOTH_TORSO.headDownLean −0.26 ≈ 15°)과 다르다. 또 visual.neck 피벗이 (0,1.95,−1.0) → (0,2.35,−0.5) 로 바뀐 것도 §2 표에 반영되지 않았다. 커밋 본문에 이유는 있으나 문서가 정본이라 다음 사람이 혼동할 수 있다.
  → §14 EnemyAttackDef 행에 exposeOnParry{joint, normalTicks 36, perfectTicks 90} 로 고치고, §2 head_down 을 '몸통 +15° 앞 기울임(목 IK 가 눈 0.9m 를 만들 수 있는 각)' 으로, 목 피벗 좌표를 갱신한다(B2-3 문서 손질 때 함께).
- [x] (B2-2, B3-1 에서 처리 — 의도로 고정, tickWeakPointStatus 주석) 처형 연출 정지(executeFocusTicks 32) 동안 /Users/shimu/Dev/GameDev/underworld/src/systems/Enemies.ts tick 이 첫머리에서 return 하므로 tickWeakPointStatus 도 돌지 않는다 — 노출 타이머(관절 90)와 dazeCooldown 이 32틱 늦게 흐르고, dazed → 쿨다운 전이도 32틱 뒤에 걸린다(Boss.test (c) 는 executeFocusTicks = 0 으로 건너뛰어 이를 재지 않는다). 기존 '모든 적이 멈춘다' 규약과 일치하고 플레이어도 그 동안 입력이 막히므로 실제 이득은 없지만, '노출 창은 플레이어의 시간' 이라는 주석과는 어긋난다.
  → 의도된 것이면 tickWeakPointStatus 주석에 '처형 연출 중엔 멈춘다' 를 한 줄 적고, 아니면 executeFocus 분기 앞에서 약점 보스의 노출 타이머만 깎는 소형 루프를 둔다. 기능 차단 사유는 아니다.
- [ ] (B2-2) 해머 1·2타의 attackFreezeTicks(chainFlinchTicks 14)가 §9.1 순서(attackFreeze > 포즈)대로 head_down 포즈 시계를 멈춰, 해머로 눈을 두들기면 머리 내림이 사실상 90 + 14×타수 틀이 된다(권총은 90 그대로). 기획서에 규정이 없고 커밋 본문에 기록돼 있어 규칙 위반은 아니나, 해머 노선이 권총 노선보다 눈 창이 길어지는 비대칭이 생긴다.
  → 밸런스 검증 뒤 원치 않으면 Weapons.resolveHammerHit 의 eyeHammer 분기에서 attackFreezeTicks 부여를 건너뛰거나(머리 내림 중엔 이미 굳어 있다), 기획서 §5 head_down 행에 '해머 경직은 포즈 시계를 멈춘다' 를 명시해 의도로 고정한다.
- [ ] (B2-3) 완벽 회피 판정이 `p.iframeTicks > 0` 전체에 걸린다(src/systems/Enemies.ts impact 분기). 회피 무적(Reaction.ts:349, dodgeIFrameTicks 8) 외에 그림자 이동(블링크) 무적(src/systems/Projectiles.ts:662, PlayerMove.ts:363-366)과 그래플 탈출 무적(src/systems/Enemies.ts:456, escapeIframeTicks 24)으로 접촉해도 charge_dodged + skid 90 + 양 관절 40 이 나간다. 기획서 §7/§9.3 문구 '무적 8틱 안 접촉' 은 글자 그대로는 만족하지만 '회피 보상' 의도라면 넓다. 시험방(구울 그립 뒤 돌격)에서만 실질 발생.
  → 설계 결정 사항. 회피만 보상하려면 조건을 `p.iframeTicks > 0 && p.dodgeTicks > 0`(또는 회피 출처 플래그) 로 좁히고 기획서 §9.3 문구를 '회피 무적' 으로 명시; 블링크도 보상하려면 현재 그대로 두고 문서에 '무적 종류 무관' 을 한 줄 적는다.
- [x] (B2-3, B3-1 에서 처리) TASKS.md B2-3 줄의 '관절 메시–구체 ≤ 0.2m(움찔 ≤ 0.25)' 가 실제와 어긋난다 — src/render/Behemoth.test.ts 의 움찔(skid+flinch) 허용치는 jointR.radius = 0.30 이고 구현자 측정 최악값은 0.253 이라 '≤ 0.25' 는 참이 아니다(Stage 주석은 '움찔 최악 0.25(반지름 0.30 안)' 으로 반올림 표기).
  → TASKS.md B2-3 의 '(움찔 ≤ 0.25)' 를 '(움찔 ≤ 0.30 = 구체 반지름, 측정 0.25)' 로 고쳐 테스트 허용치와 맞춘다.
- [x] (B2-3, B3-1 부터 커밋 본문 '검증' 절에 경로를 남긴다) 체크박스가 요구한 '시험방 헤드리스로 관절 사격 → 파열 로그 확인' 과 스크린샷 'rupture·limp + 시험방(파열·절뚝·미끄러짐)' 이 c4112e4/c10e23b/dcceb53 커밋 본문과 구현자 보고(스크린샷 skid·front 2장만)에 없다. 검토에서 직접 돌려 통과를 확인했다(권총 6발 → weak_point_broken → exposure_closed{hits 6} → boss_status rupture{joint_r, r} → bladeLock.r 600; 양 잠김 → limp on·2.00→2.52m 후퇴; 무적 접촉 → charge_dodged + skid 90 + joint_l 만 노출). 코드 문제는 아니고 보고 누락.
  → 다음 배치부터 체크박스의 시험방 검증·스크린샷 항목을 커밋 본문 '검증' 절에 경로와 함께 남긴다(B2-2 커밋 형식). 이번 건은 /tmp/review_room_{rupture,limp,skid}.png, /tmp/review_bh_{rupture,limp,skid}.png 로 대체 확인됨.
- [ ] (B2-3) 관절 파열 순간 소리가 두 번 겹친다 — weak_point_broken(명중 틱, src/main.ts) 의 heavy_hit 와 다음 틱 boss_status rupture 의 joint_crack. 기획서 §5 표시 열은 '관절 어둡게 + 파편 + joint_crack' 만이다. heavy_hit 는 B2-1 잔존.
  → 선택 사항: main 의 weak_point_broken 핸들러에서 audio.play('heavy_hit') 를 빼고 파편만 남겨 joint_crack 하나로 통일하거나, 의도된 '착탄 + 파열' 이중음이면 §5 표시 열에 heavy_hit 를 적는다.
- [x] (B2-4, B3-1 에서 처리) /Users/shimu/Dev/GameDev/underworld/TASKS.md B2-4 줄이 'Status.test 18건' 이라 적혀 있지만 3c5fe70 이후 src/systems/Status.test.ts 의 it 블록은 21건이다(검토 반영으로 +3). 문서 수치 드리프트일 뿐 동작·게이트에는 영향 없음.
  → TASKS.md B2-4 줄의 'Status.test 18건' 을 '21건' 으로 고친다.
- [x] (B2-4, B3-1 에서 처리 — Status.ts 3단계 주석) src/systems/Status.ts tick() 3단계가 매 틱 aimShakeAmp 를 0.02 로 다시 세우므로, 진탕 중 박쥐 비명(shakeAmp 0.012·55틱)이 오면 남은 진탕 틱이 55 이상일 땐 비명 흔들림이 진탕 진폭에 묻히고, 비명이 진탕보다 오래 남으면(aimShakeTicks > concussion) 반대로 진탕의 남은 구간이 박쥐 진폭 0.012 로 약해진다. 기획서 '박쥐 채널 재사용' 의 자연스러운 결과이고 판정·회피에는 무관하지만, 의도한 트레이드오프임을 주석이나 기획서 §6 에 한 줄 남겨 두면 뒤에 '진탕이 갑자기 약해진다' 는 오탐을 막는다.
  → Status.ts 3단계 주석(또는 기획서 §6 진탕 행)에 '진탕과 박쥐 비명이 겹치면 더 긴 흔들림의 진폭이 이긴다' 를 명시. 코드 변경은 불필요.
- [ ] (B2-5) 기획서 §9.3 표가 이번 커밋으로 자기모순이 됐다. /Users/shimu/Dev/GameDev/underworld/docs/systems/boss_scythe_behemoth.md 328행 '잔해(붕괴 기둥) | 헛돌격 60 — 진로는 막지만 박히지 않음' 과, 330행에 새로 쓴 '벽이 아닌 소품·아군·잔해에 막혀 선 것은 충돌이 아니다(질주 계속 → 시간이 다하면 헛돌격 90)' 가 같은 표 안에서 충돌한다. 현재 구현(Level.blockedAhead 는 props 를 null 로 돌리고, rayBlockers 는 문설주만 push 된다)은 330행 쪽이다 — 잔해는 '총알·시야 통과' 라 rayBlockers 에 들지 않을 테니 B3-5 가 이 표를 그대로 따르면 어느 행을 구현할지 갈린다. 이번 체크박스(B2-5) 동작엔 영향 없음.
  → 둘 중 하나로 문서를 맞춘다. (a) 328행을 '질주 계속 → 시간이 다하면 헛돌격 90(B2-5 규칙, 잔해는 props)' 로 고치거나, (b) 330행 끝에 '잔해는 B3-5 에서 Level.blockedAhead 가 잔해 rect 를 별도 목록으로 인식해 헛돌격 60 을 낸다(TODO)' 를 덧붙여 B3-5 작업 항목으로 남긴다. 어느 쪽이든 TASKS.md B3-5 항목에 한 줄 반영.
- [ ] (B2-5) 체크박스의 헤드리스 요구 '돌격을 P 에 박게 유도한 로그' 가 파일로 남아 있지 않다. /tmp/pw 에는 behemoth-b25-pillar.png(기둥 스크린샷 — 확인: 밝은 돌 상자 + 정 자국 띠 3줄, 시험방), behemoth-b25-topple.png(HUD 문구 '거수가 기둥에 박혔다 — 눈을 노려라!' 가 찍힘 — pillar_hit·topple 경로가 실제로 돌았다는 증거로는 충분), pillarshot.mjs·debug.mjs 만 있고 전도 유도 스크립트·콘솔 로그는 804bbfd 커밋 본문의 한 줄 서술로만 남았다. 6642c4e(재검토 반영)는 렌더·데이터를 안 건드려 스크린샷을 새로 찍지 않았다는 이유는 타당하다.
  → 선택 사항 — 다음 헤드리스 작업 때 전도 유도 스크립트를 /tmp/pw/behemoth-b25-topple.mjs 로 남기고 콘솔 로그(pillar_hit·boss_status topple/head_down cause topple·kbTicks)를 /tmp/pw/behemoth-b25-topple.log 로 저장해 두면 검토가 재현할 수 있다. 지금 상태로도 체크박스 완료 판정은 유지.
- [ ] (B2-6) roar 자세에서 어깨 관절 메시와 판정 구체(poseOffsets.roar joint_r/l = (±1.15, 2.70, −0.50))가 0.31m 어긋난다(debug/behemoth?view=roar 안내문 '어긋남 r 0.31m / l 0.31m'). skid 에 못박은 기준(≤ 0.20m)보다 크고 Behemoth.test 의 roar 검사는 눈(2.9m·어긋남 0.00)·턱·팔·천장만 본다. 지금은 molting 동안 약점이 전부 닫혀 게임플레이 영향은 없고, 구체 자체는 표 자리에 그려져 '판정 = 그림' 규약은 지켜진다.
  → B3-4 포효 예고(roar 자세 재사용) 또는 다음 리그 손질 때 roar 팔 들기(BH_ARM_ROAR/BH_ARM_ROAR_YAW)로 어깨 메시가 표 (2.70, −0.50) 근처에 오게 조정하고, Behemoth.test 191 의 관절 메시–구체 검사 목록에 roar 를 추가.
- [ ] (B2-6) 일반 패링으로 연 관절 노출(36틱, 보스는 recover 반동 중)은 막는 창이 아니라서 그 순간 칸이 비면 전환이 즉시 일어나 방금 얻은 노출이 exposure_closed 로 닫힌다. 기획서 §8 이 보호 창을 staggered·head_down·skid·blind·처형 넉백으로 한정했으므로 구현은 문서 그대로지만, 플레이어가 패링 보상을 빼앗기는 느낌이 날 수 있다.
  → 기획 판단 사안 — 원하면 phaseShiftBlocked 에 '타이머 노출(enemy.exposure 에 양수)이 있는 동안'을 추가하고 §8 큐잉 표를 갱신. 코드 수정 없이 넘겨도 무방.
- [x] (B2-6, B3-1 에서 처리 — '안전망(도달 불가)' 주석) beginPhaseShift 의 endBlind(world, enemy) 호출은 도달 불가(blind 는 phaseShiftBlocked 가 막아 여기 오지 않음) — 주석에도 그렇게 적혀 있다. 무해한 안전망이지만 기획서 '눈멂은 유지' 와 겉으로 어긋나 보인다.
  → 그대로 두어도 되나, 남길 거면 주석을 '안전망(도달 불가)' 로 명시하거나 호출을 제거.
- [ ] (B2-6) 구현자도 보고한 대로 roar 자세(faceUp 가지)의 눈 구체는 플레이어 눈높이 1.6m 에서 머리 상자에 가려 잘 보이지 않는다(room-p2 스크린샷에서도 눈이 안 보임). 전환 중엔 눈이 닫혀 문제 없으나 B3-4 포효 예고(눈 노출 C, 66 → 역류)에서는 표적이 보여야 한다.
  → B3-4 착수 시 roar 표의 눈 z(−1.3) 를 앞으로 빼거나 머리 상자 크기/IK 가지를 손봐 1.6m 정면에서 눈 구체가 보이는지 헤드리스로 확인.

## 의존성 주의

- M3 이전에 M4를 건드리지 않는다. 패링 감각이 확정되기 전 마나 수치를 잡으면 전부 다시 한다
- M7의 수호주술사는 M2 탄약 상한이 실제로 빡빡할 때만 의미가 있다. 상한을 넉넉히 잡은 채 넣지 않는다
- M6.1(상한 보급)은 이 게임에서 가장 반직관적인 규칙이다. 구현 시 `CLAUDE.md`의 "설계 의도" 항목을 재확인할 것

## 슬라이스 제외 범위

무기 개조, 오염 50 이상 단계, 2~5구역, 회차 계승, 엔딩. 슬라이스 검증 후 판단한다.
