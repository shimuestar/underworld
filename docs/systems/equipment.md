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

## 조작 (배치 2 시점)

- 가방 탭의 장비 칸: Y/E·A = 걸치기(같은 부위 것과 맞바꿈 — 옛것은 그 칸으로), X = 버리기. 팝업에 효과와 지금 걸친 것.
- 인형(paper doll) UI·벗기 UI·획득 경로(상자·보스 주머니·제단 상점)는 배치 3.

이벤트: `equip_changed {slot, id, prev}` · `equip_denied {id, reason}` · `inventory_resized {size}`.
