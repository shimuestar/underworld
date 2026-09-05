# 장비 — 투구·갑옷·부츠·반지 2·목걸이·짐칸 (2026-09-04)

사용자 기획(A안): 각인은 강하지만 오염을 올리고, **장비는 오염이 없지만 칸이 정해져 있다.** 효과는 수치보다 규칙 수정 위주.

## 데이터 · 모델

- `data/equipment.json` — `items.<id> { name, slot(head|body|feet|ring|neck|pack), packKind?(belt|bag), tier, color, price, desc, effects }`. 첫 슬라이스 17종.
- 몸의 칸 `world.equipment: Record<EquipSlot, id|null>` — `head body feet ring1 ring2 neck pack` (`core/EquipData`). 반지 정의 하나가 두 칸 중 빈 곳에 간다.
- 장비는 **가방 아이템**(`ItemKind 'equip'`, `InventorySlot.equipId`, 스택 불가, 퀵슬롯 없음). 바닥·주머니·상자·비석 모두 각인과 같은 경로(`Pickups` E 집기, `Loot` 줄, `graveItems`).
- 효과는 `core/Modifiers.recomputeModifiers` 가 **각인 + 장비**를 합산해 `world.modifiers` 에 쓴다. `*Mul` 은 곱, `perfectBandBonus`·`bagSlots` 는 합, `shopDiscount` 는 (1-a)(1-b).

## 효과 훅 (모두 `world.modifiers` 를 읽는다)

| 키 | 읽는 곳 |
|---|---|
| `damageTakenMul`, `trapDamageMul` | `World.damagePlayer` — 적·투사체·함정의 12개 피해 경로가 전부 이 함수를 지난다 |
| `moveSpeedMul`, `sprintDrainMul` | `PlayerMove` |
| `dodgeDistanceMul` | 각인과 같은 필드 (곱) |
| `manaRegenMul` | `Mana` 기본 충전 |
| `goldMul` | `Pickups` 바닥 골드 · `Loot` 컨테이너 골드 |
| `perfectBandBonus` | `Reaction` 완벽 패링 대역 |
| `stunMul` | `Reaction` 패링 실패 경직 · `Enemies` 방패 격돌 경직 |
| `shopDiscount` | `Altar.shopState` 가격 |
| `itemChannelMul`, `potionHealMul` | `Items` 마시는 시간 · 회복량 |
| `bagSlots` | `Inventory.bagSizeFor` — 기본 `items.cols×rows`(5×3=15) + 짐칸 |

## 짐칸 규칙 (벨트 ↔ 가방, 하나만)

- 벨트: 칸 +5/+10 + 마시는 시간 −20/−35%. 가방: 칸 +10/+15, 큰 가방은 이속 −3%.
- 걸치기/벗기 때 `Inventory.resizeInventory` — 늘면 빈 칸을 붙이고, **줄면 든 것(+벗는 장비 한 칸)이 들어갈 때만** 앞으로 모아 줄인다. 안 들어가면 되돌리고 `equip_denied {reason:'bag_full'}` → "가방을 비워야 한다" (사용자 결정 6-A).

## 조작 (배치 3, 가방 탭)

- **인형(장비 칸)** 이 가방 격자 왼쪽에 2열로 있다: [투구 목걸이] [갑옷 반지 1] [부츠 반지 2] [짐칸]. 걸친 것은 아이콘·이름, 빈 칸은 부위 이름.
- 가방의 장비 칸: Y/E·A = 걸치기(같은 부위 것과 맞바꿈 — 옛것은 그 칸으로), 드래그로 인형 칸에 놓으면 **그 칸**에 걸친다(반지 2 지정 가능, 부위가 다르면 무시), X = 버리기 / 제단 앞이면 팔기(정가 × `equipment.sellRatio`).
- 인형 칸: Y/E·A·X·우클릭 = 벗기 → 가방(첫 빈 칸), 드래그로 가방 칸에 놓으면 그 칸으로. 가방이 가득이면 못 벗는다(안내).
- 패드: 가방 격자 왼쪽 끝에서 한 번 더 왼쪽 = 인형, 인형 왼쪽 열에서 왼쪽 = 이전 탭. 집어 들고(A 길게) 인형 칸에서 놓기 = 걸치기.

## 획득

- 보물상자: `chest.equipChance`(0.6) 로 장비 한 줄 — 몸에 걸친 것·가방에 든 것은 빼고 뽑는다.
- 보스 주머니: 확정 1개(`pickups.equip.bossAlways`). 일반 적은 `pickups.equip.dropChance`(0).
- 제단 상점 판매는 아직 없다(후속). 파는 것만 된다.

이벤트: `equip_changed {slot, id, prev}` · `equip_denied {id, reason}` · `inventory_resized {size}`.
