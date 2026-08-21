# 경제 · 성장 시스템 스펙

`systems/Altar.ts`, `systems/Corruption.ts`, `systems/Sigils.ts` 작업 시 참조.

---

## 1. 탄약

### 상한 규칙

각 탄종은 `weapons.*.ammoMax`를 가진다. 필드에서 획득하는 탄약은 상한을 넘지 못한다.
상한을 넉넉하게 잡고 싶은 충동이 들면 참을 것. **상한이 크면 저장 공간이 생기고, 저장 공간이 생기면 호딩이 발생하며, 호딩이 발생하면 이 게임의 코어 루프가 죽는다.**

### 제단 보급 — 반직관적 핵심 규칙

```ts
// 올바름
ammo[type] = maxFor(type);

// 틀림 — 절대 이렇게 하지 말 것
ammo[type] += refillAmount;
ammo[type] = Math.min(ammo[type] + refill, max);
```

잔탄이 얼마든 상한으로 **설정**한다. 30발 남기고 온 플레이어는 30발어치 보급을 버린 것이며, 이것이 의도된 동작이다.

### 공격성 보너스

제단 접촉 시 직전 구간의 전투 평가로 **해당 구역 한정 상한 배율**을 계산한다.

```
score = (근접처치수 / 전체처치수) * 0.5
      + min(완벽패링수 / 10, 1) * 0.3
      + (무피해교전수 / 전체교전수) * 0.2

multiplier = 1.0 + clamp(score, 0, 1) * 0.4    // 1.0 ~ 1.4
```

배율은 다음 제단에서 재계산된다. 누적되지 않는다.

### 오염탄

제단 밖에서 제작 가능. 재료는 필드에서 흔하게 드랍.

- 위력 `×0.6`, 명중 산포 증가
- 30발 사용마다 오염 +1 (`Corruption`에 누적 통보)
- **방어막 관통 불가** — `warden`류에게 무효

## 2. 제단

### 상호작용 흐름

```
접촉 → 확인 프롬프트 ("들어가면 오염이 정산됩니다")
     ├─ 진입 → 보급 + 세이브 + 각인 교체 UI + 오염 정산
     └─ 취소 → 아무 일도 없음. 우회 가능
```

**제단은 강제 통과 지점이 아니다.** 레벨 설계상 반드시 우회로가 존재해야 하며, 우회 시 아무 페널티도 주지 않는다 (보급을 못 받는 것 자체가 대가다).

확인 프롬프트에 현재 잔탄율을 표시한다. "9mm 42/60 보유 중" — 플레이어가 손해를 인지할 기회를 준다.

### 리스폰

진입한 제단이 리스폰 지점으로 등록된다. 사망 시:
- 위치·체력 복원
- 탄약 = 상한 (다시 보급된 것으로 처리)
- 마나 = 0
- 각인·오염 = 마지막 정산 상태 유지
- 우회했던 구간의 진행도는 초기화

## 3. 오염

### 누적과 정산

오염은 **대기값(pending)**과 **확정값(applied)**을 분리한다.

```ts
interface Corruption {
  applied: number;   // 몸에 반영된 값. 0~100
  pending: number;   // 아직 정산되지 않은 누적분
}
```

각인 부착, 오염탄 사용, 유틸 마법은 `pending`에 쌓인다. 제단 진입 시에만 `applied += pending; pending = 0`.

UI에는 두 값을 다르게 표시한다. `applied`는 실선, `pending`은 그 위의 반투명 예고 구간. 제단에 들어가면 어디까지 올라가는지 미리 보여야 선택이 성립한다.

### 임계값 처리

`applied`가 임계를 넘는 순간 `corruption_threshold` 이벤트를 발행하고 되돌리지 않는다.

| 임계 | 효과 |
|---|---|
| 25 | 벽 문자 해독 활성화 (`world.canReadGlyphs = true`) |
| 50 | 근접 위력 +25%, 총기 조작 페널티 |
| 75 | 일부 적 비적대화 |
| 90 | 재장전 중 총기 낙하 확률 발생 |

### 시각 변화

12.5 단위로 8단계. `applied` 변화 시 `render/HandModel.ts`에 단계 인덱스만 통보한다.
구조적 변화(모델 교체)는 단계 3/5/7에서, 나머지는 머티리얼 파라미터 보간으로 처리한다.

**슬라이스 범위** — 단계 0~2까지만 구현한다 (오염 25 도달 시점).

## 4. 각인

### 데이터 구조

```ts
interface Sigil {
  id: string;
  slot: 'eye' | 'rightArm' | 'leftArm' | 'heart' | 'spine';
  tier: 'passive' | 'small' | 'medium' | 'large';
  corruptionCost: number;
  effects: Record<string, number>;
}
```

부위별 슬롯은 각 1개. 최대 동시 부착 5개.

### 상태 3종

| 상태 | 효과 | 오염 |
|---|---|---|
| 미획득 | — | — |
| 소지 | **없음** | 없음 |
| 부착 | 효과 + 부위 페널티 | 부착 시 1회 부과 |

소지 상태에서 아무 효과가 없다는 점이 중요하다. 플레이어는 쓰지 못하는 힘을 계속 들고 다니며 유혹받는다.

### 부위 페널티

부착 즉시 적용. `world.player.modifiers`에 누적한다.

| 부위 | 페널티 |
|---|---|
| eye | 섬광탄 자가 피해 활성화 |
| rightArm | 재장전 속도 −35% |
| leftArm | 랜턴 밝기 −50%, 수류탄 사거리 −30% |
| heart | 피격 시 마나 전량 소실 |
| spine | 조준 손떨림 (산포 +40%) |

### 흉터

각인을 제거해도 **페널티의 50%가 영구 잔존**한다.

```ts
// 제거 시
scars[slot] = Math.max(scars[slot], penalty * 0.5);
```

`scars`는 누적 최댓값으로 관리한다. 같은 부위에 여러 번 부착/제거해도 흉터가 무한히 쌓이지는 않는다.

## 5. 계측 이벤트

```
ammo_spent        { type, amount }
altar_entered     { ammoLeftRatio, pendingCorruption, multiplier }
altar_bypassed    { ammoLeftRatio }
corruption_applied{ from, to, threshold?: number }
sigil_acquired    { id }
sigil_attached    { id, slot, corruptionCost }
sigil_detached    { id, slot }
```

`altar_entered.ammoLeftRatio`의 평균이 **제단 도착 시 평균 잔탄율** 지표다. 목표 20% 이하이며, 50%를 넘으면 플레이어가 아직 호딩 습관을 못 버린 것이다. 그 경우 밸런스가 아니라 **초반에 탄약을 강제로 소진시키는 상황**을 레벨에 추가해야 한다.
