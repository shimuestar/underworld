# 전리품 — 주머니·상자·루팅 창·E 집기 (2026-09-04)

## 개요

적을 죽이면 아이템이 바닥에 흩어지지 않고 **주머니(pouch)** 하나가 시체 자리(플레이어 반대쪽 0.5m)에
떨어진다. 주머니와 **보물상자**는 컨테이너다 — 바라보며 E(우클릭 병합·패드 B)를 누르면 **루팅 창**이 열리고
시간이 멈춘다(`uiOpen`). 창은 두 칸: 왼쪽 컨테이너 줄, 오른쫙 내 가방(5×2) + ◆ 골드·화살 카운터.
각인(스킬)은 예전처럼 따로 떨어져 밟으면 즉시 습득한다(`Sigils`). 항아리(기믹) 전리품은 1개가 튕겨 나오는 그대로.

| 파일 | 몫 |
|---|---|
| `src/systems/Loot.ts` | 굴림 → 주머니 드랍·병합, 안착, 바라보기(`lootInView`)·E 열기(`lootOpen`), 이전 규칙(takeOne·takeAll·stash·dropToFloor·closeLoot) |
| `src/systems/Chest.ts` | 상자 바라보기·E: 처음이면 뚜껑 열고 1회 롤(`chestItems` = 골드 + 각인) → `lootOpen` |
| `src/systems/Pickups.ts` | 바닥 아이템 물리: 골드·화살·탄약 자석, **소모품 E 집기(`itemInView`)·가득 튕김**, 비석 회수 |
| `src/render/LootUI.ts` | 두 칸 창 — 키보드·마우스·패드, 아이콘 비행·거부 흔들림 |
| `data/balance.json` `loot` | 거리·시간·연출 수치 (확률·양은 `pickups`) |

## 데이터 (`balance.loot`)

- `pouch.scatterRadius` 0.5 / `mergeRadius` 1.6 (이 안 주머니에 합친다) / `radius` 2.0·`facingArcDeg` 110 (뒤질 수 있는 거리·시야각) /
  `settleTicks` 30 (떨어진 뒤 손댈 수 없는 시간 — `noMagnetTicks` 를 안착으로 쓴다) / `reopenGuardTicks` 3 (닫은 E 가 도로 열지 않게)
- `pickup.radius` 1.8·`facingArcDeg` 100 — 바닥 소모품을 E 로 집는 거리
- `bounce.popUp` 0.5·`ticks` 26 — 가득일 때 몸 앞에서 원자리로 튕겨 돌아가는 포물선
- `dropScatter` 0.6 — 창에서 컨테이너 쪽을 바닥에 버릴 때 거리 / `ui.flyMs`·`shakeMs` — 연출 시간
- 굴림 확률·양: `pickups.potion/manaPotion/food.dropChance`, `pickups.gold`, 적의 `arrowDrop` (`Loot.rollLoot` 가 읽는다 — 예전 `Pickups.rollDrops` 와 같다)

## 규칙

- **주머니 내용물** = 소모품(물약·마나·고기) + 골드 + 화살. `LootEntry {kind, count, sigilId?}` 줄로 쌓인다(상한 없음). 상자에는 각인 줄이 있다.
- **병합** — `mergeRadius` 안에 주머니가 있으면 새 전리품이 거기 합쳐진다. 같은 종류 적이면 이름 유지(`고블린 러너의 주머니`), 다르면 `전리품 주머니`,
  보스가 섞이면 금빛(`pouchTier: 'boss'`, 점광원).
- **가져오기** — 골드는 항상 전부(카운터, `gold_picked` 는 컨테이너 자리에서 ◆ 팝). 화살은 화살통 상한까지 부분(남은 건 줄에 남는다).
  소모품은 가방에 자리가 있을 때만 1개씩. 각인은 가져가는 순간 `Sigils` 가 `loot_taken` 을 받아 습득(토스트).
  **모두 가져오기**는 골드 → 각인 → 화살 → 소모품 순, 거부 알림은 한 번(소모품이 남았으면 '가방 가득', 화살만 남았으면 '화살통 가득').
- **넣기** — 내 가방 커서 칸에서 컨테이너로 1개(퀵슬롯 등록은 유지). 주머니를 보관함처럼 쓸 수 있다.
- **버리기** — 컨테이너 줄은 통째로 단위별 바닥 아이템(소모품 1개씩·화살 1대씩·골드 한 더미·각인 하나)로 컨테이너 옆에, 가방 칸은 `Inventory.dropSlot`.
  버린 직후 `items.dropNoMagnetTicks` 동안 자석·집기가 물지 않는다.
- **닫기** — 빈 주머니는 사라진다. 상자는 비어도 남되(뚜껑 열림) 대상에서 빠진다. 닫은 뒤 `reopenGuardTicks` 동안은 같은 E 로 다시 열리지 않는다.
- **대상 우선순위** 상자 > 주머니 > 바닥 아이템 — 뒤 시스템이 앞 시스템의 `*InView` 를 보고 양보한다. 우클릭(근접)→상호작용 병합에 주머니·상자는 늘 포함,
  **바닥 아이템은 비전투 중에만** 포함(전투 중 휘두르기가 줍기로 새지 않게; E·패드 B 는 늘 된다).
- **바닥 소모품 E 집기** — 바라보며 E → 자석 비행으로 날아온다. 가방이 가득이면 몸까지 왔다가 **원자리로 튕겨 돌아간다**(`pickup_bounced`, 툭 소리 + 안내).
  골드·화살·탄약·수류탄·배터리는 예전처럼 자석.
- **부활·층** — 주머니는 부활해도 남는다(비석과 같은 규칙; 죽인 적은 되살아나지 않으므로). 상자도 다시 잠기지 않는다(재롤 파밍 없음). 층을 오가도 FloorState 가 그대로 들고 있다.
- **슬라임**은 주머니도 먹는다(바닥 아이템 규칙) — 죽이면 게워 낸다.
- 창이 열려 있는 동안은 시간 정지(상점과 같다).

## UI 조작

키보드·마우스: WASD/화살표 이동(←→ 로 칸 전환), Enter·좌클릭 가져오기/넣기, **T** 모두 가져오기, **X·Delete·우클릭** 바닥에 버리기, E/Esc 닫기.
패드(고정 버튼): D-패드 4방향, A 가져오기/넣기, X 모두, Y 버리기, B(또는 Menu) 닫기. 힌트 줄이 장치에 따라 바뀐다.
연출: 옮긴 아이콘이 반대 칸(또는 ◆·화살 카운터)으로 날아가고 도착 칸이 깜빡인다. 거부되면 줄이 좌우로 흔들리고 거절음.

## 이벤트

`pouch_dropped {id,x,z,owner,tier,entries,merged}` · `loot_opened {kind,id,entries,first?}` · `loot_closed {kind,id,emptied}` ·
`loot_taken {kind,count,from,sigilId?}` · `loot_stashed {kind,count,to}` · `loot_dropped {kind,count,from}` · `loot_denied {reason,kind}` ·
`pickup_bounced {kind,x,z}`. 재사용: `gold_picked`(컨테이너 자리), `chest_opened`(첫 개봉), `item_dropped`(가방 쪽 버리기), `sigil_acquired`.
소리: `pouch_open`(가죽 스침, 주머니·상자 재개봉), `chest_opened`(첫 개봉), `loot_stash`, `thud`(주머니 착지·튕김 착지·버리기), 종류별 `pickup_*`, 거부 `shop_deny`.

## 계측

`loot.pouches / opened / taken / stashed / dropped / deniedFull` — Metrics 가 이벤트만 구독한다 (`docs/metrics.md`).

## 검증

- 테스트: `Loot.test.ts`(굴림·드랍·병합·바라보기·열기·가드·가져오기·모두·넣기·버리기·닫기), `Chest.test.ts`(상자 속·각인 습득·재롤 없음), `Pickups.test.ts`(E 집기·튕김·자석).
- 헤드리스(`?traproom`, `__world/__lootUI`): `enemy_died` 를 직접 내면 주머니가 떨어진다 → 바라보고 E → 창 → Enter/T → E 닫기. 상자는 `spawnChests` 로 하나 놓고 같은 흐름.

## 리스크·주의

- `Pickups.tick` 은 `chestInView/lootInView` 를 지난 틱 값으로 본다(한 틱 지연 — 다른 `*InView` 와 같은 규약).
- `respawnAtAltar` 는 바닥 아이템을 지우되 `grave`·`pouch` 는 남긴다. 새 종류를 추가하면 여기 필터를 볼 것.
- Stage 의 알 수 없는 kind 폴백은 각인 보석(부유)이다 — 새 바닥 아이템 종류는 `makeGroundItem`·`grounded` 둘 다에 넣을 것.
