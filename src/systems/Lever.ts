// 레버 — E로 당기면 연결된 관문(G)이 열린다. 레버-관문 연결은 레벨 데이터의 triggers.
//
// 문(D)은 문 앞에서 직접 열지만 관문은 그 자리에서 열 수 없다. 여는 곳과 열리는 곳을
// 떼어 놓는 게 관문의 값이다 — 보스 아레나 북쪽이 그렇다. 안 당기면 동쪽 상시
// 입구로 크게 돌아가야 한다.
//
// 잠금만 풀어 주고 미닫이·개방은 Door 가 이어서 돌린다 (문 파이프라인은 하나다).

import { balance } from '../core/Balance';
import { resetTrap, unlockDoor, type World } from '../core/World';

export function tick(world: World, _dt: number): void {
  const cfg = balance.door;
  const p = world.player;
  const cs = world.level.cellSize;
  const fx = -Math.sin(p.yaw);
  const fz = -Math.cos(p.yaw);
  const arcCos = Math.cos((cfg.facingArcDeg * Math.PI) / 360);

  world.leverInView = null;
  for (const lever of world.level.levers) {
    const [row, col] = lever.cell;
    if (row === undefined || col === undefined) continue;
    const key = `${row}-${col}`;
    if (world.pulledLevers.has(key)) continue;

    const x = (col + 0.5) * cs;
    const z = (row + 0.5) * cs;
    const toX = x - p.x;
    const toZ = z - p.z;
    const dist = Math.hypot(toX, toZ);
    if (dist > cfg.leverRadius) continue;
    // 제단·상자·문과 같은 규약 — 등지고 서 있는데 당겨지면 "왜 열렸지"가 된다
    if (dist > 0.001 && (toX * fx + toZ * fz) / dist < arcCos) continue;
    world.leverInView = { row, col };

    if (!world.input.interactPressed) continue;

    // 함정 재생성 레버 — 한 번 쓴 함정을 다시 세운다 (재사용, pulledLevers 에 넣지 않는다)
    if (lever.resets) {
      const [tr, tc] = lever.resets;
      const trap = world.traps.find((t) => t.row === tr && t.col === tc);
      if (!trap) continue;
      const types = balance.traps.types as unknown as Record<string, { charges?: number } | undefined>;
      world.events.emit('lever_pulled', { lever: { row, col }, resets: { row: tr, col: tc, type: trap.type } });
      resetTrap(world, trap, types[trap.type]?.charges ?? -1); // 당김 → 재생성 순서로 알린다
      return;
    }

    const [doorRow, doorCol] = lever.opens!;
    if (doorRow === undefined || doorCol === undefined) continue;
    const door = world.doors.find((d) => d.row === doorRow && d.col === doorCol);
    if (!door) continue;

    world.pulledLevers.add(key);
    world.events.emit('lever_pulled', {
      lever: { row, col },
      door: { row: doorRow, col: doorCol },
    });
    if (unlockDoor(door, cfg.openTicks)) {
      world.events.emit('door_unlocked', {
        row: door.row,
        col: door.col,
        x: door.x,
        z: door.z,
        byLever: true,
      });
    }
    return; // 한 틱에 레버 하나
  }
}
