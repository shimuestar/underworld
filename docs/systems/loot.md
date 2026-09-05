# 전리품 — 주머니·상자·루팅 창·E 집기 (2026-09-04)

## 개요

적을 죽이면 아이템이 바닥에 흩어지지 않고 **주머니(pouch)** 하나가 시체 자리(플레이어 반대쪽 0.5m)에
떨어진다. 주머니와 **보물상자**는 컨테이너다 — 바라보며 E(우클릭 병합·패드 B)를 누르면 **루팅 창**이 열리고
**게임은 멈추지 않는다**(실시간 루팅, 2026-09-04 — 아래 절). 창은 두 격자: 왼쪽 컨테이너 칸(가방과 같은 사각 칸, 한 칸 = 한 종류), 오른쪽 내 가방(5×4 — `items.cols×rows`; 컨테이너 격자는 `loot.ui.containerMinRows` 줄부터 든 만큼 늘어난다) + ◆ 골드·화살 카운터. 창 폭은 고정. 커서 칸의 설명은 하단 줄이 아니라 **칸 옆 팝업**(`render/ItemPopup.ts`)으로 — 컨테이너(창 왼쪽) 칸은 오른쪽에, 가방(창 오른쪽) 칸은 왼쪽에 띄운다(2026-09-04). I 창(가방)도 마우스가 얹힌 칸·고른 칸에 같은 팝업. 컨테이너 칸은 가져가도 당겨지지 않는다(빈 칸으로 남고, 새 항목은 첫 빈 칸).
각인(스킬)은 예전처럼 따로 떨어져 밟으면 즉시 습득한다(`Sigils`). 항아리(기믹) 전리품은 1개가 튕겨 나오는 그대로.

| 파일 | 몫 |
|---|---|
| `src/systems/Loot.ts` | 굴림 → 주머니 드랍·병합, 안착, 바라보기(`lootInView`)·E 열기(`lootOpen`), 이전 규칙(takeOne·takeAll·stash·dropToFloor·closeLoot) |
| `src/systems/Chest.ts` | 상자 바라보기·E: 처음이면 뚜껑 열고 1회 롤(`chestItems` = 골드 + 각인) → `lootOpen` |
| `src/systems/Pickups.ts` | 바닥 아이템 물리: 골드·화살·탄약 자석, **소모품 E 집기(`itemInView`)·가득 튕김**, 비석 회수 |
| `src/render/LootUI.ts` | 두 칸 창 — 키보드·마우스·패드, 아이콘 비행·거부 흔들림 |
| `data/balance.json` `loot` | 거리·시간·연출 수치 (확률·양은 `pickups`) |

## 데이터 (`balance.loot`)

- `pouch.scatterRadius` 0.5 / `mergeRadius` 0 (병합 없음; 켜면 이 안 주머니에 합친다) / `minSpacing` 0.8 (다른 주머니와 띄우는 거리) / `radius` 2.0·`facingArcDeg` 110 (뒤질 수 있는 거리·시야각) /
  `settleTicks` 30 (떨어진 뒤 손댈 수 없는 시간 — `noMagnetTicks` 를 안착으로 쓴다) / `reopenGuardTicks` 3 (닫은 E 가 도로 열지 않게)
- `pickup.radius` 1.8·`facingArcDeg` 100 — 바닥 소모품을 E 로 집는 거리
- `bounce.popUp` 0.5·`ticks` 26 — 가득일 때 몸 앞에서 원자리로 튕겨 돌아가는 포물선
- `dropScatter` 0.6 — 창에서 컨테이너 쪽을 바닥에 버릴 때 거리 / `ui.flyMs`·`shakeMs` — 연출 시간
- 굴림 확률·양: `pickups.potion/manaPotion/food.dropChance`, `pickups.gold`, 적의 `arrowDrop` (`Loot.rollLoot` 가 읽는다 — 예전 `Pickups.rollDrops` 와 같다)

## 규칙

- **주머니 내용물** = 소모품(물약·마나·고기) + 골드 + 화살. `LootEntry {kind, count, sigilId?}` 줄로 쌓인다(상한 없음). 상자에는 각인 줄이 있다.
- **각자 떨어진다** — 기본 `mergeRadius` 0(병합 없음). 떨어질 자리는 플레이어 반대쪽 호 안에서 **다른 주머니와 `minSpacing`(0.8m) 이상 떨어지고 벽이 아닌 곳**을 각도·거리를 넓혀 가며 고른다(`landingSpot`). 보관 주머니도 옆으로 비켜 놓인다.
  `mergeRadius` 를 켜면 그 안의 주머니에 합쳐진다(같은 종류면 이름 유지, 다르면 `전리품 주머니`, 보스가 섞이면 금빛).
- **뒤지기(타르코프식)** — 컨테이너 칸은 처음엔 `?` 로 가려 있다. 창을 열면 배치 순서대로 한 칸씩 `loot.search.perItemMs`(1초) 동안 쿨다운처럼 한 바퀴 도는 덮개가 얹히고, 다 돌면 소리(`loot_reveal`)와 함께 정체가 드러난다(`LootEntry.searched`, `loot_revealed`). 밝혀진 칸만 가져가기·버리기가 된다. 창을 닫으면 멈추고 다시 열면 이어진다(데이터에 남는다). 내가 넣은 것은 바로 보인다.
- **가져오기** — 골드는 항상 전부(카운터, `gold_picked` 는 컨테이너 자리에서 ◆ 팝). 화살은 화살통 상한까지 부분(남은 건 줄에 남는다).
  소모품은 가방에 자리가 있을 때만 1개씩. 각인은 가져가는 순간 `Sigils` 가 `loot_taken` 을 받아 습득(토스트).
  **모두 가져오기**는 골드 → 각인 → 화살 → 소모품 순, 거부 알림은 한 번(소모품이 남았으면 '가방 가득', 화살만 남았으면 '화살통 가득').
- **넣기** — 내 가방 커서 칸에서 컨테이너로 1개(퀵슬롯 등록은 유지). 주머니를 보관함처럼 쓸 수 있다.
- **버리기** — 컨테이너 줄은 통째로 단위별 바닥 아이템(소모품 1개씩·화살 1대씩·골드 한 더미·각인 하나)로 컨테이너 옆에, 가방 칸은 `Inventory.dropSlot`.
  버린 직후 `items.dropNoMagnetTicks` 동안 자석·집기가 물지 않는다. 놓이는 자리는 `World.findFreeSpot` — 다른 바닥 아이템과 `dropSpacing`(0.55m) 이상 떨어지고 벽이 아닌 곳을 각도·거리를 넓혀 가며 고른다(가방 버리기 `items.dropSpacing`, 컨테이너 버리기 `loot.dropSpacing`).
- **닫기** — 빈 주머니는 사라진다. 상자는 비어도 남되(뚜껑 열림) 대상에서 빠진다. 닫은 뒤 `reopenGuardTicks` 동안은 같은 E 로 다시 열리지 않는다.
- **주머니 조준 규칙** — 가까이(`radius` 2m·`facingArcDeg`)면 그냥 대상이고, 멀어도(`aimRadius` 5m) 크로스헤어(시선 3D)가 주머니 높이(`aimHeight`)에서 `aimArcDeg` 안이면 대상이다 — 발치까지 가지 않아도 조준하면 뒤진다. 상자·바닥 아이템은 근접 규칙만.
- **대상 우선순위** 상자 > 주머니 > 바닥 아이템 — 뒤 시스템이 앞 시스템의 `*InView` 를 보고 양보한다. 우클릭(근접)→상호작용 병합에 주머니·상자는 늘 포함,
  **바닥 아이템은 비전투 중에만** 포함(전투 중 휘두르기가 줍기로 새지 않게; E·패드 B 는 늘 된다).
- **바닥 소모품 E 집기** — 바라보며 E → 자석 비행으로 날아온다. 가방이 가득이면 몸까지 왔다가 **원자리로 튕겨 돌아간다**(`pickup_bounced`, 툭 소리 + 안내).
  골드·화살·탄약·수류탄·배터리는 예전처럼 자석.
- **부활·층** — 주머니는 부활해도 남는다(비석과 같은 규칙; 죽인 적은 되살아나지 않으므로). 상자도 다시 잠기지 않는다(재롤 파밍 없음). 층을 오가도 FloorState 가 그대로 들고 있다.
- **슬라임**은 주머니도 먹는다(바닥 아이템 규칙) — "슬라임이 주머니를 먹었다" 안내, 노란 핵이 표시, 죽이면 게워 낸다("게워 냈다" 안내).
- **보관 주머니** — 가방 창(I)에서 P(패드 Y·버튼)로 빈 주머니를 정면 `placeAhead` 에 내려놓고 곧장 루팅 창이 열린다(`pouch_placed`, 제목 '내 주머니').
  넣어 둔 것은 층을 오가도·죽어도 그 자리에 남는다. 비운 채 닫으면 사라진다. 그 근처 처치 전리품은 여기 합쳐질 수 있다(그러면 '전리품 주머니').
- **착지·반짝임** — 주머니는 시체 자리에서 **적 머리 높이까지 튀어올랐다가** `settleTicks` 동안 포물선으로 안착점(플레이어 반대쫙)에 떨어진다(`launchY`, 병합은 제자리 `mergeHop`). 안착이 끝나는 틱에 `pouch_landed`(툭 소리 + 낮은 먼지). 놓인 주머니는 가죽이 천천히 숨 쉬듯 반짝이고, 바라보는(`lootInView`) 주머니는 또렷하게 밝다. 보스 주머니는 금빛 점광원.
- **키캡** — 주머니·바닥 소모품이 대상이면 중앙 키캡(E)과 하단 설명이 함께 뜬다(문은 키캡만).
- **툴팁** — 창 아래 한 줄: 소모품은 효과·지금 쓸 값어치·가방 수, 골드·화살은 쓰는 곳·소지량, 각인은 설명.
- 창이 열려 있는 동안은 시간 정지(상점과 같다).

## UI 조작

키보드·마우스: WASD/화살표 이동(←→ 로 칸 전환), Enter·좌클릭 가져오기/넣기, **T** 모두 가져오기, **X·Delete·우클릭** 바닥에 버리기, E/Esc 닫기.
패드(고정 버튼): D-패드 4방향 **또는 왼 스틱**(`input.gamepad.menuStick` — 임계 넘기면 한 칸, 계속 밀면 반복), A 가져오기/넣기, X 모두, Y 버리기, B(또는 Menu) 닫기. 힌트 줄이 장치에 따라 바뀐다.
연출: 옮긴 아이콘이 반대 칸(또는 ◆·화살 카운터)으로 날아가고 도착 칸이 깜빡인다. 거부되면 줄이 좌우로 흔들리고 거절음.

## 이벤트

`pouch_dropped {id,x,z,owner,tier,entries,merged}` · `pouch_landed {id,x,z,tier}` · `pouch_placed {id,x,z}` · `loot_opened {kind,id,entries,first?}` · `loot_closed {kind,id,emptied}` ·
`loot_taken {kind,count,from,sigilId?}` · `loot_stashed {kind,count,to}` · `loot_dropped {kind,count,from}` · `loot_denied {reason,kind}` · `loot_revealed {kind,count,sigilId?}` ·
`pickup_bounced {kind,x,z}`. 재사용: `gold_picked`(컨테이너 자리), `chest_opened`(첫 개봉), `item_dropped`(가방 쪽 버리기), `sigil_acquired`.
소리: `pouch_open`(가죽 스침, 주머니·상자 재개봉), `chest_opened`(첫 개봉), `loot_stash`, `thud`(주머니 착지·튕김 착지), `item_drop`(가방·컨테이너에서 바닥에 버리기 — 달그락), 종류별 `pickup_*`, 거부 `shop_deny`.

## 계측

`loot.pouches / opened / taken / stashed / dropped / deniedFull` — Metrics 가 이벤트만 구독한다 (`docs/metrics.md`).

## 검증

- 테스트: `Loot.test.ts`(굴림·드랍·병합·바라보기·열기·가드·가져오기·모두·넣기·버리기·닫기), `Chest.test.ts`(상자 속·각인 습득·재롤 없음), `Pickups.test.ts`(E 집기·튕김·자석).
- 헤드리스(`?traproom`, `__world/__lootUI`): `enemy_died` 를 직접 내면 주머니가 떨어진다 → 바라보고 E → 창 → Enter/T → E 닫기. 상자는 `spawnChests` 로 하나 놓고 같은 흐름.

## 리스크·주의

- `Pickups.tick` 은 `chestInView/lootInView` 를 지난 틱 값으로 본다(한 틱 지연 — 다른 `*InView` 와 같은 규약).
- `respawnAtAltar` 는 바닥 아이템을 지우되 `grave`·`pouch` 는 남긴다. 새 종류를 추가하면 여기 필터를 볼 것.
- Stage 의 알 수 없는 kind 폴백은 각인 보석(부유)이다 — 새 바닥 아이템 종류는 `makeGroundItem`·`grounded` 둘 다에 넣을 것.

## 드래그 이동 (2026-09-04)

키보드·마우스 플레이에서 칸을 집어 원하는 칸에 놓는다 (`render/DragDrop.ts` — 포인터 이벤트, 임계 `loot.ui.dragThresholdPx` 를 넘기면 드래그, 그 전에 놓으면 보통 클릭).

| 원본 → 대상 | 규칙 | 코드 |
|---|---|---|
| 가방 → 가방 | 빈 칸 이동 / 같은 종류 `stackMax` 까지 합침(남는 건 제자리) / 다른 종류·둘 다 가득이면 맞바꿈 | `Inventory.moveSlot` |
| 컨테이너 → 컨테이너 | 칸 배치만 바꿈 (데이터는 그대로, 아직 모르는 칸과도 자리를 바꿀 수 있다) | `LootUI.layout` |
| 컨테이너 → 가방 칸 | 그 칸이 비었거나 같은 종류면 들어가는 만큼 통째로. 다른 종류 칸은 거부(흔들림). 골드·화살·각인은 `takeOne` 과 같다 | `Loot.takeStackTo` |
| 가방 → 컨테이너 칸 | 통째로 넣고, 새 항목이면 놓은 칸에 배치(차 있으면 첫 빈 칸). 같은 종류가 있으면 그 항목에 합쳐진다 | `Loot.stashStackTo` |
| I 창: 가방 → 퀵슬롯 | 등록 / 퀵슬롯 ↔ 퀵슬롯 교환 / 퀵슬롯을 빈 곳에 놓으면 해제 | `InventoryUI.onDrop` |

이벤트 `loot_moved`(천에 넣는 소리), `item_moved{from,to,kind,result}`.

## 패드로 칸 옮기기 — 집어 들기 (2026-09-04 구현, 아래 1~3안)

마우스 드래그의 패드 판. 콘솔 인벤토리(디아블로·타르코프 콘솔판) 관례를 따른다. `LootUI.padA`(A 홀드를 매 틱 받는다) →
`pickUp`/`place`/`cancelCarry`/`dropCarried`. 놓기는 마우스와 같은 `onDrop` 이라 규칙이 하나다. 들고 있는 동안 X(모두 가져오기)는 잠긴다.
데이터 `loot.ui.padPickHoldTicks`(15) · `padCarryScale`(1.25). 4안(X 홀드)은 채택하지 않았다.

1. **집어 들기** — 칸에 커서를 두고 **A 를 0.25초 길게** 누른다 (짧게 = 지금처럼 가져오기/넣기). 집힌 칸은 어둡게, 아이콘이 커서를 따라 떠서(밝게, 살짝 크게) '들고 있다'가 보인다. 진동 짧게.
2. **옮기기** — D-패드·왼 스틱으로 커서를 움직인다. ←→ 로 칸(컨테이너↔가방) 전환도 그대로. 들고 있는 동안 커서 칸 팝업은 "여기에 놓기 → 이동/합침/교환"으로 바뀐다.
3. **놓기** — **A**: 마우스와 같은 규칙(빈 칸 이동·같은 종류 합침·다른 종류 교환·컨테이너↔가방 통째 이동). **B**: 취소 — 아이콘이 원래 칸으로 날아 돌아간다. **Y**: 들고 있는 것을 바닥에 버린다.
4. 대안(더 단순): **X 누르는 동안(홀드) 이동 모드** — X 를 쥔 채 D-패드로 커서를 옮기면 아이템이 따라오고, X 를 놓는 순간 그 자리에 놓인다. 손이 두 개 필요하지만 배우기 쉽다. 단 X 는 지금 '모두 가져오기'라 재배치가 필요.
5. 데이터: `loot.ui.padPickHoldMs`(집기 홀드), `loot.ui.padCarryScale`(들고 있을 때 아이콘 배율). 규칙은 마우스와 같은 `moveSlot`·`takeStackTo`·`stashStackTo` 를 그대로 쓴다 — 입력만 다르다.

추천은 1~3안(A 길게). 지금 A 짧게 = 빠른 이동이 살아 있고, 길게 = 정밀 배치라 한 버튼에 두 층이 자연스럽다.

## 수량 나누기 (2026-09-04)

가방의 스택(2개 이상)을 둘로 가른다 — `Inventory.splitSlot(index, amount)`: amount 개를 떼어 첫 빈 칸에 새 스택으로(빈 칸이 없으면 거부, 개수 불변).
대화상자(`render/SplitDialog.ts`)는 루팅 창·가방 창 공용: 원래 칸/새 칸 몫과 비율 막대, −/+ 버튼, 확인·취소.

| 여는 법 | 조정 | 확인 / 취소 |
|---|---|---|
| 마우스 Shift+클릭 · 키보드 Shift+Enter(루팅 창) | ←→ ±1, ↑↓ ±`loot.ui.splitBigStep` | Enter / Esc |
| 패드 X 길게(`loot.ui.padSplitHoldTicks`; 짧게는 모두 가져오기) | D-패드·스틱 ←→ ±1, ↑↓ ±big | A / B |

나눈 뒤 커서(루팅 창)·고른 칸(가방 창)이 새 칸으로 옮겨져 바로 끌어다 놓거나 집어 들 수 있다. 컨테이너 항목은 종류별로 합쳐져
있어(mergeEntry) 나누지 않는다 — 부분 이동은 컨테이너→가방 칸 드래그(들어가는 만큼)나 Enter(1개씩)로. 이벤트 `item_split`.

## 실시간 루팅 (2026-09-04)

루팅 창이 열려도 시간은 흐른다(상점·가방·스킬 창은 여전히 멈춘다 — `main.simulate` 의 `lootLive`). 대신 플레이어는 **뿌리내린다**:
이동·시선·공격 입력을 비운다(WASD·왼 스틱은 커서를 옮기는 중). 적은 그대로 다가와 때린다.

- **끊김** — `player_damaged`(도트 틱 제외)를 받으면 창이 닫힌다(`loot.live.interruptOnDamage`). 밀려나 컨테이너에서
  열 수 있는 최대 거리(`max(pouch.radius, pouch.aimRadius)`) + `loot.live.closeSlack` 넘게 멀어지면 `Loot.tick` 이 `loot_interrupt{distance}` 를 내고 main 이 닫는다. 둘 다 소리 + "…끊겼다" 안내,
  계측 `loot.interrupted`.
- **즉시 대응** — 반응(Shift)·질주/회피(Space) 키(`LootUI.escapeKey`, 키 설정을 따른다)와 패드 RT/LT 는 창을 닫으며 그 입력이 같은 틱에
  그대로 통한다(Input 은 창과 무관하게 눌림을 기록한다). 창 제목 아래 한 줄이 이 규칙을 말한다.
- 뒤지기(1초/칸)는 벽시계 그대로. 창을 벗어났다 돌아와도(blur) 멈추지 않는다(uiOpen 은 포커스 상실 일시정지 예외).

## 가방 창(I) 패드·키보드 조작 (2026-09-04)

마우스 전용이던 가방 창에 루팅 창과 같은 커서 규약을 넣었다(`InventoryUI`). 커서 하나를 마우스 hover·키보드·패드가 함께 움직인다
(가방 5×4 격자 ↔ 퀵슬롯 십자: 격자 오른쪽 끝에서 → 로 십자의 왼쪽 칸, 십자 왼쪽 칸에서 ← 로 격자 같은 줄 오른쪽 끝).

| 조작 | 패드 | 키보드·마우스 |
|---|---|---|
| 커서 | D-패드·왼 스틱 | WASD·화살표·hover |
| 고르기 → 퀵슬롯에 등록(빈손이면 해제) | A → 퀵슬롯 칸에서 A | Enter/클릭 → Enter/클릭(숫자 키도) |
| 집어 옮기기(이동·합침·교환·퀵슬롯이면 등록) | A 길게 → 이동 → A 놓기 / B 취소 | 드래그 |
| 바닥에 버리기(퀵슬롯 칸이면 등록 해제) | X | X·우클릭 |
| 수량 나누기 | X 길게 | Shift+Enter·Shift+클릭 |
| 보관 주머니 내려놓기 | Y | P |
| 닫기 | B(들기·대화상자는 취소) | Esc·I |

main 이 `padA/padX`(홀드 판정)·`padMove`·`padClose` 를 틱마다 부르고, 표기는 `input.lastDevice` 를 따른다. 팝업은 커서 칸에 붙는다.
