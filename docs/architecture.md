# 아키텍처

## 1. 고정 타임스텝 루프

패링 판정이 프레임 단위(완벽 6f, 일반 12f)이므로 로직은 반드시 고정 60Hz에서 돈다. 렌더는 가변이며 보간만 담당한다.

```ts
const STEP = 1 / 60;
let acc = 0, tick = 0;

function frame(now: number) {
  acc += Math.min((now - last) / 1000, 0.25);  // 스파이크 클램프
  while (acc >= STEP) {
    simulate(world, STEP);   // 여기서만 게임 상태 변경
    tick++;
    acc -= STEP;
  }
  render(world, acc / STEP); // alpha 보간
  requestAnimationFrame(frame);
}
```

**규칙**
- 게임 로직에서 `deltaTime`을 쓰지 않는다. 전부 틱 정수로 센다
- 히트스톱은 `simulate` 호출을 건너뛰는 방식이 아니라 `world.freezeTicks` 카운터로 처리한다 (입력 버퍼는 계속 받아야 함)
- 스파이크 클램프 0.25초 — 탭 전환 후 복귀 시 수백 틱이 몰아치는 것을 막는다

## 2. 시스템 구조

```ts
export interface System {
  tick(world: World, dt: number): void;
}
```

시스템은 서로를 import 하지 않는다. 통신은 두 가지 경로만 허용한다.

- **상태 공유** — `world.player.ammo` 같은 직접 읽기/쓰기
- **이벤트** — `events.emit('parry_perfect', { enemyId, chain })`

Metrics는 이벤트만 구독한다. 시스템 안에 계측 코드를 넣지 않는다.

### 틱 순서

고정 순서로 실행한다. 순서가 바뀌면 판정이 1틱씩 밀린다.

```
Input → PlayerMove → Enemies(AI/공격예약) → Reaction(판정) →
Weapons → Projectiles → Damage → Mana → Corruption → Altar → Metrics
```

`Reaction`이 `Enemies` 뒤에 오는 이유: 적의 공격 상태가 확정된 뒤에 판정 창을 계산해야 한다.

## 3. 충돌

물리 엔진 없음. 두 가지만 쓴다.

**캐릭터 이동** — 스윕 AABB. 플레이어는 반지름 0.4, 높이 1.8의 AABB로 근사한다. 축 분리 방식(X 이동 → 해결 → Z 이동 → 해결)으로 벽 슬라이딩을 얻는다. 계단·경사 없음, 전부 평면 + 수직 벽.

**사격/시야** — `three-mesh-bvh`로 레벨 메시에 BVH를 붙이고 레이캐스트한다. 적 히트박스는 별도 AABB로 관리하고 레이-AABB 교차를 직접 계산한다 (Three.js Raycaster는 틱 루프에서 쓰기엔 무겁다).

**적 이동** — 그리드 기반. 셀 단위 A*로 경로를 뽑고 그 사이는 직선 보간. 부머 슈터 적은 정교한 내비게이션이 필요 없다.

## 4. 좌표계와 스케일

| 항목 | 값 |
|---|---|
| 축 | Three.js 기본, Y가 위 |
| 단위 | 1 unit = 1 meter |
| 그리드 셀 | 4 × 4 units |
| 천장 높이 | 4 units |
| 플레이어 눈높이 | 1.6 |
| 이동 속도 | 6 u/s (질주 9) |

## 5. 레벨 포맷 — ASCII 그리드

레벨은 3D 에디터가 아니라 텍스트로 저작한다. 이 프로토타입에서 가장 중요한 결정이다 — 레벨을 코드로 생성/수정할 수 있어야 반복 속도가 나온다.

```json
{
  "id": "z01_f1",
  "name": "봉인된 성소 - 1층",
  "cellSize": 4,
  "ceiling": 4,
  "grid": [
    "###########",
    "#....#....#",
    "#.##.#.##.#",
    "#.#S...#..#",
    "#.#####.#.#",
    "#.......#.#",
    "###########"
  ],
  "legend": {
    "#": "wall",
    ".": "floor",
    "S": "spawn",
    "A": "altar",
    "L": "lever",
    "D": "door_locked",
    "G": "gate_lever",
    "C": "crack_wall",
    "P": "pit_trap",
    "X": "exit"
  },
  "entities": [
    { "type": "goblin_runner", "cell": [5, 1], "group": "amb01" },
    { "type": "goblin_spear",  "cell": [7, 3] },
    { "type": "warden",        "cell": [9, 5] }
  ],
  "triggers": [
    { "type": "ambush", "cell": [4, 2], "spawns": "amb01" },
    { "type": "lever", "cell": [3, 5], "opens": [7, 1], "note": "레버가 관문(G)을 연다" }
  ],
  "lighting": { "ambient": 0.04, "torches": [[2, 1], [8, 5]] }
}
```

**규칙**
- `grid`의 인덱스는 `[row][col]` = `[z][x]`. 월드 좌표는 `x = col * cellSize`, `z = row * cellSize`
- `ambient`는 0.04 이하를 유지한다. 랜턴이 유일한 광원이라는 전제가 무너지면 조명 트레이드오프가 죽는다
- 매복 그룹은 `group` 문자열로 묶고 트리거가 활성화될 때까지 비활성 상태로 둔다

## 6. 렌더

- 머티리얼은 `MeshLambertMaterial` 단색만. PBR 안 씀
- 레벨 지오메트리는 로드 시 셀 단위로 생성 후 `BufferGeometryUtils.mergeGeometries`로 하나로 합친다
- 적/투사체는 인스턴싱 없이 개별 메시. 슬라이스 규모에서는 충분하다
- 포스트프로세싱 없음. 패링 탈색 효과는 오버레이 DOM 요소의 `mix-blend-mode`로 처리한다 (가장 싸고 확실하다)

## 7. 오디오

Web Audio API 직접 사용. 텔레그래프 사운드 3종(청색 금속성 / 적색 저주파 / 보라색 마법음)은 **시각 신호보다 먼저 재생되어야 한다.** 어두운 던전에서 화면 밖 적의 공격을 소리로 예고하는 것이 이 게임의 핵심 정보 채널이다.

레이턴시 최소화를 위해 `AudioBufferSourceNode`를 매번 새로 만들고, 사전 디코딩된 버퍼를 재사용한다.

## 8. 하지 않는 것

- 물리 엔진 (Rapier, Cannon, Ammo)
- ECS 프레임워크 (bitECS, miniplex)
- 상태 관리 라이브러리
- 애셋 파이프라인 / glTF 로딩
- 네트워킹
- 모바일 대응
