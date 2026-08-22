# Under World — 프로젝트 규칙

1인칭 부머 슈터 웹 프로토타입 (구명: DESCENT PROTOCOL). 현재 목표는 **1구역 버티컬 슬라이스**.

---

## 절대 규칙

1. **수치를 코드에 하드코딩하지 않는다.** 모든 튜닝값은 `data/*.json`에서 읽는다. 새 수치가 필요하면 JSON에 필드를 추가하고 로더를 확장한다. 매직 넘버가 보이면 즉시 데이터로 뺀다.
2. **게임 로직은 고정 60Hz 틱에서만 돈다.** 렌더 루프와 분리한다. 패링 판정이 프레임 단위(6f/12f)라 `deltaTime` 기반 로직은 판정을 깨뜨린다.
3. **한 파일 = 한 시스템.** 시스템끼리 직접 참조하지 않고 `World` 상태와 이벤트 버스를 경유한다.
4. **계측 로깅을 처음부터 넣는다.** `docs/metrics.md`의 지표는 나중에 붙이는 기능이 아니라 각 시스템의 요구사항이다.
5. **물리 엔진을 도입하지 않는다.** 스윕 AABB + `three-mesh-bvh` 레이캐스트로 처리한다. Rapier/Cannon 제안 금지.
6. **에셋을 찾지 않는다.** 전부 프리미티브 + 단색 머티리얼. 비주얼은 슬라이스 검증 후 단계.

---

## 기술 스택

| 항목 | 선택 | 비고 |
|---|---|---|
| 언어 | TypeScript (strict) | |
| 번들러 | Vite | |
| 렌더 | Three.js | WebGL2 |
| 충돌 | 자체 스윕 AABB + three-mesh-bvh | 물리엔진 없음 |
| 오디오 | Web Audio API 직접 | 라이브러리 없음 |
| 상태 | 평범한 클래스 + 시스템 함수 | ECS 프레임워크 도입 금지 |
| 테스트 | Vitest (순수 로직만) | 렌더 테스트 안 함 |

---

## 폴더 구조

```
src/
├─ core/
│  ├─ Loop.ts          고정 타임스텝 루프. tick(dt=1/60) / render(alpha)
│  ├─ World.ts         전역 게임 상태 컨테이너
│  ├─ Events.ts        이벤트 버스
│  └─ Metrics.ts       계측 수집기
├─ systems/            한 파일 = 한 시스템. tick(world) 시그니처 통일
│  ├─ PlayerMove.ts
│  ├─ Weapons.ts
│  ├─ Reaction.ts      단일 반응 버튼 (패링/반사/회피)
│  ├─ Mana.ts
│  ├─ Enemies.ts
│  ├─ Sigils.ts
│  ├─ Corruption.ts
│  └─ Altar.ts
├─ render/             Three.js 전용. 게임 로직 금지
├─ level/
│  ├─ GridLoader.ts    ASCII 그리드 → 지오메트리 + 충돌 메시
│  └─ Spawner.ts
└─ main.ts

data/
├─ balance.json        타이밍·상한·임계값 전부
├─ sigils.json         각인 24종
├─ entities.json       적 로스터 + 무기 정의
└─ levels/z01_*.json   레벨 그리드

docs/
├─ GDD.md              원본 기획서. 참조 전용, 평소 읽지 말 것
├─ architecture.md     루프·충돌·좌표계
├─ metrics.md          계측 지표 정의
└─ systems/*.md        시스템별 구현 스펙. 해당 작업 시에만 읽을 것
```

---

## 컨벤션

- 좌표계: Three.js 기본. **Y가 위**, 1 unit = 1 meter, 그리드 셀 = 4 units
- 시스템 시그니처: `export function tick(world: World, dt: number): void`
- 시간 단위: 로직은 **틱(tick) 정수**로만 표현. `WINDOW_PERFECT = 6` 같은 상수는 data에서 로드
- 이벤트명: `snake_case` 문자열 (`parry_perfect`, `ammo_spent`, `sigil_attached`)
- 파일명: 시스템은 PascalCase, 데이터는 kebab-case

---

## 작업 방식

- 작업 단위는 `TASKS.md`의 체크박스 하나다. **각 작업이 끝나면 게임이 플레이 가능한 상태여야 한다.**
- 여러 시스템을 한 번에 건드리지 않는다. 의존성이 필요하면 스텁을 만들고 다음 작업으로 미룬다.
- 시스템 스펙이 필요하면 `docs/systems/` 해당 파일만 읽는다. GDD 전체를 읽지 않는다.
- 밸런스가 이상하다고 판단되면 코드를 고치지 말고 JSON을 고치고, 그 이유를 커밋 메시지에 남긴다.

---

## 설계 의도 (변경 시 확인 필요)

이 세 가지는 게임의 정체성이라 임의로 바꾸면 안 된다. 바꿔야 할 이유가 생기면 먼저 물어볼 것.

1. **총으로 죽인 적은 마나를 주지 않는다.** 두 자원 경제를 분리하는 유일한 규칙
2. **제단은 잔탄과 무관하게 상한까지 채운다.** 탄약을 아끼면 손해가 되도록
3. ~~**마나는 전투 종료 후 휘발한다.**~~ **폐지 (2026-08).**
   자동 회복 상한(`regenCap`)과 전투 후 휘발(`decayPerTick`)을 모두 없앴다 —
   마나는 최대치까지 차고 그대로 유지된다. 마나 물약 드랍도 추가됐다.
   되살리려면 `balance.mana.decayPerTick`을 0보다 크게, `regenCap`을 `max`보다 낮게 두면 된다.
   남은 두 규칙(총 처치 마나 0 / 제단은 상한까지 보급)은 그대로 유효하다.
