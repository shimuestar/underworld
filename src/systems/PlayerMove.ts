// 플레이어 시선 회전 + WASD 이동. 충돌은 Level.slideMove(축 분리 스윕 AABB).

import { balance } from '../core/Balance';
import { enemyDef } from '../core/Entities';
import { spendStamina, type EnemyState, type World } from '../core/World';

/** 질주 보폭 카운터 — 뛰는 동안만 차고, 멈추면 리셋된다 */
let strideTicks = 0;

/** 락온 후보 — 살아 있고 위장(죽은 척)이 아니며 사거리·시야선 안. offYaw 는 감은 각 */
function lockCandidates(
  world: World,
  range: number,
): Array<{ e: EnemyState; offYaw: number; dist: number }> {
  const p = world.player;
  const out: Array<{ e: EnemyState; offYaw: number; dist: number }> = [];
  for (const e of world.enemies) {
    if (!e.alive || e.feigning) continue;
    const dx = e.x - p.x;
    const dz = e.z - p.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 1 || dist > range) continue;
    if (!world.level.hasLineOfSight(p.x, p.z, e.x, e.z)) continue;
    let offYaw = Math.atan2(-dx, -dz) - p.yaw;
    offYaw = Math.atan2(Math.sin(offYaw), Math.cos(offYaw));
    out.push({ e, offYaw, dist });
  }
  return out;
}

/** 락온 획득 — 시야각(fovRad) 안에서 화면 중앙에 가장 가까운 적 */
export function acquireLockTarget(world: World, fovRad: number, range: number): EnemyState | null {
  let best: { e: EnemyState; offYaw: number } | null = null;
  for (const c of lockCandidates(world, range)) {
    if (Math.abs(c.offYaw) > fovRad / 2) continue;
    if (!best || Math.abs(c.offYaw) < Math.abs(best.offYaw)) best = c;
  }
  return best ? best.e : null;
}

/** 락온 전환 — 오른스틱을 튕긴 쪽(화면 좌우)의 가장 가까운 다른 적.
 *  오른쪽 튕김 = 시선 오른쪽 = offYaw 음수 방향 (yaw 는 오른쪽 회전이 감소) */
function switchLockTarget(
  world: World,
  current: EnemyState,
  dirSign: number,
  range: number,
): EnemyState | null {
  let best: { e: EnemyState; offYaw: number } | null = null;
  for (const c of lockCandidates(world, range)) {
    if (c.e === current) continue;
    if (Math.sign(c.offYaw) !== dirSign) continue;
    if (!best || Math.abs(c.offYaw) < Math.abs(best.offYaw)) best = c;
  }
  return best ? best.e : null;
}

/** 에임 어시스트 표적 — 조준점에서 각도상 가장 가까운 적 (사거리·시야선 안).
 *  죽은 척 구울만 제외(시체처럼 보여야 한다) — 천장 거머리는 눈에 보이는 표적이라
 *  잠복 중에도 어시스트가 걸린다 (2026-09-01 사용자 지시. 높이는 jumpY 가 안다).
 *  각크기(atan(반지름/거리))를 원뿔에 더해 가까운 적일수록 후하게 잡는다.
 *  pullYaw/pullPitch 는 몸 실루엣 '가장자리'까지의 끌림 — 조준점이 이미 몸 위에
 *  있으면 0 이다. 자석은 붙을 때까지만 돕고, 몸 안에서 머리/몸통을 고르는 건
 *  플레이어 몫이어야 한다 (덩치 큰 적 헤드샷이 중심 끌림과 싸우던 문제) */
export function padAimAssist(
  world: World,
): {
  offYaw: number;
  offPitch: number;
  off: number;
  angRadius: number;
  pullYaw: number;
  pullPitch: number;
} | null {
  const aa = balance.input.gamepad.aimAssist;
  const p = world.player;
  const eyeY = p.y + balance.player.eyeHeight;
  let best: ReturnType<typeof padAimAssist> = null;
  for (const e of world.enemies) {
    if (!e.alive || e.feigning) continue;
    const dx = e.x - p.x;
    const dz = e.z - p.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 1 || dist > aa.range) continue;
    const def = enemyDef(e.type);
    let offYaw = Math.atan2(-dx, -dz) - p.yaw;
    offYaw = Math.atan2(Math.sin(offYaw), Math.cos(offYaw)); // -π..π 로 감는다
    const targetY = (e.jumpY ?? 0) + def.height * 0.55;
    const offPitch = Math.atan2(targetY - eyeY, dist) - p.pitch;
    const off = Math.hypot(offYaw, offPitch);
    const angRadius = Math.atan2(def.radius, dist);
    if (off > (aa.coneDeg * Math.PI) / 180 + angRadius) continue;
    if (!world.level.hasLineOfSight(p.x, p.z, e.x, e.z)) continue;
    if (best && off >= best.off) continue;
    // 실루엣 가장자리 클램프 — 세로는 발목~정수리, 가로는 몸 반지름의 90%
    const pitchTop = Math.atan2((e.jumpY ?? 0) + def.height * 0.95 - eyeY, dist);
    const pitchBot = Math.atan2((e.jumpY ?? 0) + def.height * 0.1 - eyeY, dist);
    const pullPitch =
      p.pitch > pitchTop ? pitchTop - p.pitch : p.pitch < pitchBot ? pitchBot - p.pitch : 0;
    const halfW = Math.atan2(def.radius * 0.9, dist);
    const pullYaw = Math.abs(offYaw) <= halfW ? 0 : offYaw - Math.sign(offYaw) * halfW;
    best = { offYaw, offPitch, off, angRadius, pullYaw, pullPitch };
  }
  return best;
}

export function tick(world: World, dt: number): void {
  const p = world.player;
  const input = world.input;

  // ── 타겟 락온 (R3, 소울라이크) — 토글·유지·해제 판단이 시선 처리보다 먼저다
  const lk = balance.input.gamepad.lockOn;
  const sens = balance.input.mouseSensitivity;
  const pitchMax = (balance.input.pitchMaxDeg * Math.PI) / 180;
  if (input.lockOnPressed && !world.dead) {
    if (world.lockOnId !== null) {
      world.lockOnId = null;
      world.events.emit('lockon_end', {});
    } else {
      const t = acquireLockTarget(world, (lk.acquireFovDeg * Math.PI) / 180, lk.range);
      if (t) {
        world.lockOnId = t.id;
        world.lockOnPitchOffset = 0;
        world.lockOnLosLost = 0;
        world.events.emit('lockon_start', { enemyId: t.id });
      } else {
        world.events.emit('lockon_fail', {});
      }
    }
  }
  if (world.lockOnSwitchCooldown > 0) world.lockOnSwitchCooldown--;

  let lockTarget: EnemyState | null = null;
  if (world.lockOnId !== null) {
    lockTarget = world.enemies.find((e) => e.id === world.lockOnId && e.alive) ?? null;
    if (!lockTarget) {
      // 대상이 죽었다 — 근처의 다음 적으로 자동 전환, 없으면 해제
      const next = acquireLockTarget(world, Math.PI * 2, lk.range);
      world.lockOnId = next ? next.id : null;
      world.lockOnPitchOffset = 0;
      lockTarget = next;
      if (next) world.events.emit('lockon_switch', { enemyId: next.id });
      else world.events.emit('lockon_end', {});
    }
    if (lockTarget) {
      const dist = Math.hypot(lockTarget.x - p.x, lockTarget.z - p.z);
      const seen = world.level.hasLineOfSight(p.x, p.z, lockTarget.x, lockTarget.z);
      world.lockOnLosLost = seen ? 0 : world.lockOnLosLost + 1;
      if (dist > lk.breakRange || world.lockOnLosLost > lk.losGraceTicks) {
        // 멀어졌거나 기둥 하나를 지나는 유예(1초)를 넘겨 가려졌다 — 놓친다
        world.lockOnId = null;
        lockTarget = null;
        world.events.emit('lockon_end', {});
      }
    }
  }

  if (lockTarget) {
    // ── 락온 카메라 — 대상 몸통을 상한 걸린 속도로 부드럽게 추적
    // 오른스틱 좌우 튕김 = 대상 전환 (오른쪽 튕김 = 화면 오른쪽 적)
    if (Math.abs(input.padLookAxisX) >= lk.switchFlick && world.lockOnSwitchCooldown <= 0) {
      const next = switchLockTarget(world, lockTarget, input.padLookAxisX > 0 ? -1 : 1, lk.range);
      if (next) {
        world.lockOnId = next.id;
        world.lockOnPitchOffset = 0;
        world.lockOnSwitchCooldown = lk.switchCooldownTicks;
        lockTarget = next;
        world.events.emit('lockon_switch', { enemyId: next.id });
      }
    }
    // 상하 입력 = pitch 오프셋 (머리/다리를 고른다). 놓으면 몸통으로 스르르 복귀
    const dyIn = (input.lookDY + input.padLookDY) * sens;
    const maxOff = (lk.pitchOffsetMaxDeg * Math.PI) / 180;
    if (dyIn !== 0) {
      world.lockOnPitchOffset = Math.max(
        -maxOff,
        Math.min(maxOff, world.lockOnPitchOffset - dyIn),
      );
    } else {
      world.lockOnPitchOffset *= 0.94;
    }
    const ldx = lockTarget.x - p.x;
    const ldz = lockTarget.z - p.z;
    const ldist = Math.hypot(ldx, ldz) || 1;
    let dYaw = Math.atan2(-ldx, -ldz) - p.yaw;
    dYaw = Math.atan2(Math.sin(dYaw), Math.cos(dYaw));
    const aimY =
      (lockTarget.jumpY ?? 0) + enemyDef(lockTarget.type).height * lk.aimHeightFrac;
    const wantPitch =
      Math.atan2(aimY - (p.y + balance.player.eyeHeight), ldist) + world.lockOnPitchOffset;
    const cap = (lk.turnDegPerTick * Math.PI) / 180;
    p.yaw += Math.max(-cap, Math.min(cap, dYaw));
    p.pitch = Math.max(
      -pitchMax,
      Math.min(pitchMax, p.pitch + Math.max(-cap, Math.min(cap, wantPitch - p.pitch))),
    );
  } else {
    // ── 자유 시선 — 마우스 델타를 이번 틱에 소비. 패드 스틱만 에임 어시스트를 거친다:
    // 조준점이 적 위를 지나면 스틱이 무거워지고(마찰), 스틱을 움직이는 동안엔
    // 적 중심으로 살짝 끌린다(자석). 손을 떼면 절대 저절로 조준하지 않는다
    const aa = balance.input.gamepad.aimAssist;
    let padDX = input.padLookDX;
    let padDY = input.padLookDY;
    const stickActive = padDX !== 0 || padDY !== 0 || input.padMoveActive;
    // 에임 보정은 조준(LT) 중에만 — 평시 시선은 온전히 자유다 (2026-09-01 ADS 개편)
    const assist = stickActive && input.padAiming ? padAimAssist(world) : null;
    if (assist) {
      padDX *= aa.frictionMul;
      padDY *= aa.frictionMul;
    }
    p.yaw -= (input.lookDX + padDX) * sens;
    p.pitch = Math.max(
      -pitchMax,
      Math.min(pitchMax, p.pitch - (input.lookDY + padDY) * sens),
    );
    if (assist && assist.off <= (aa.magnetConeDeg * Math.PI) / 180 + assist.angRadius) {
      // 몸 실루엣 가장자리까지만 끈다 — 이미 몸 위면 0 (머리를 노리는 손을 방해하지 않는다)
      const step = (aa.magnetDegPerTick * Math.PI) / 180;
      p.yaw += Math.max(-step, Math.min(step, assist.pullYaw));
      p.pitch += Math.max(-step * 0.7, Math.min(step * 0.7, assist.pullPitch));
    }
  }

  // 반동 — 남은 오프셋을 먼저 매 틱 recoverRate 비율로 되돌리고, 그 뒤 발사(Weapons.kickAim)가 예약한 밀림을 얹는다
  // (되돌림이 먼저라 새 밀림은 이 틱에 온전히 튄다). 연출이 아니라 실제 조준이 움직인다:
  // 연사하면 위로 기어오르고, 손을 멈추면 대부분 제자리로 내려온다
  if ((p.recoilPitch ?? 0) !== 0 || (p.recoilYaw ?? 0) !== 0) {
    const rate = p.recoilRecoverRate ?? 0;
    const backPitch = (p.recoilPitch ?? 0) * rate;
    const backYaw = (p.recoilYaw ?? 0) * rate;
    p.recoilPitch = (p.recoilPitch ?? 0) - backPitch;
    p.recoilYaw = (p.recoilYaw ?? 0) - backYaw;
    p.pitch = Math.max(-pitchMax, Math.min(pitchMax, p.pitch - backPitch));
    p.yaw -= backYaw;
    if (Math.abs(p.recoilPitch) < 1e-6) p.recoilPitch = 0;
    if (Math.abs(p.recoilYaw) < 1e-6) p.recoilYaw = 0;
  }
  if ((p.recoilKickPitch ?? 0) !== 0 || (p.recoilKickYaw ?? 0) !== 0) {
    const kickPitch = p.recoilKickPitch ?? 0;
    const kickYaw = p.recoilKickYaw ?? 0;
    p.recoilKickPitch = 0;
    p.recoilKickYaw = 0;
    const before = p.pitch;
    p.pitch = Math.max(-pitchMax, Math.min(pitchMax, p.pitch + kickPitch));
    p.yaw += kickYaw;
    // 실제로 밀린 만큼만(천장 클램프) × 돌아오는 비율만 되돌림 대상에 쌓는다
    const frac = p.recoilRecoverFrac ?? 1;
    p.recoilPitch = (p.recoilPitch ?? 0) + (p.pitch - before) * frac;
    p.recoilYaw = (p.recoilYaw ?? 0) + kickYaw * frac;
  }

  // 초음파 비명(박쥐) — 조준이 잔떨림에 실려 흔들린다. 시선 입력 뒤에 얹어
  // 조준 자체를 어긋나게 한다 (연출이 아니라 실제 탄착이 흔들린다)
  if ((p.aimShakeTicks ?? 0) > 0) {
    p.aimShakeTicks = (p.aimShakeTicks ?? 0) - 1;
    const amp = (p.aimShakeAmp ?? 0) * Math.min(1, (p.aimShakeTicks ?? 0) / 12 + 0.4);
    // 위상은 남은 틱으로 — 끝나갈수록 잦아드는 잔떨림
    const ph = p.aimShakeTicks ?? 0;
    p.yaw += Math.sin(ph * 0.9) * amp;
    p.pitch += Math.sin(ph * 1.3 + 1) * amp * 0.6;
  }

  p.prevX = p.x;
  p.prevY = p.y;
  p.prevZ = p.z;

  // 구울에게 붙잡혔다 — 시선만 자유. 이동·질주·밀림 소화는 몸부림(근접 연타)으로 풀릴 때까지 없다
  if (world.grappleEnemyId !== null) return;

  // 그림자 질주(sig_shadowstep) — 시전 방향으로 아주 빠르게 실제로 달린다.
  // 달리는 동안 매 틱 무적을 갱신하고(적 인지 차단은 Enemies 가 blinkLeft 를 본다),
  // 벽에 막히면 거기서 끝난다. 몸은 직진뿐 — 시선(위)은 자유다
  if ((p.blinkLeft ?? 0) > 0) {
    const step = Math.min(balance.skills.blinkSpeed * dt, p.blinkLeft ?? 0);
    const bx = p.x;
    const bz = p.z;
    world.level.slideMove(p, balance.player.radius, (p.blinkDirX ?? 0) * step, (p.blinkDirZ ?? 0) * step);
    const moved = Math.hypot(p.x - bx, p.z - bz);
    p.blinkLeft = moved < step * 0.5 ? 0 : (p.blinkLeft ?? 0) - step;
    p.iframeTicks = Math.max(p.iframeTicks, 2);
    if ((p.blinkLeft ?? 0) <= 0) {
      p.blinkLeft = 0;
      p.iframeTicks = Math.max(p.iframeTicks, p.blinkTailIframes ?? 0);
      p.blinkShroudTicks = p.blinkShroudAfter ?? 0; // 여운 — 도착 직후 재인지 유예
      world.events.emit('blink_end', { x: p.x, z: p.z });
    }
    return;
  }
  if ((p.blinkShroudTicks ?? 0) > 0) p.blinkShroudTicks = (p.blinkShroudTicks ?? 0) - 1;

  // 거미줄 — 느려지고, 몸부림이 겹을 찢는다(해머 한 스윙 = 한 겹과 같은 값어치):
  // 걷기 3초/질주 1.5초에 한 겹, 회피 대시는 시도하는 순간 한 겹, 가만히 있어도
  // 5초에 한 겹은 느슨해진다. 해머(Weapons)가 여전히 가장 빠른 해제 수단이다
  const webbed = (p.webSwingsLeft ?? 0) > 0;
  if (webbed && !world.dead) {
    const cw = balance.web.struggle;
    if (p.dodgeTicks > (p.webLastDodgeTicks ?? 0)) {
      p.webStruggle = (p.webStruggle ?? 0) + 1; // 대시 한 번 = 한 겹
    } else if (
      p.dodgeTicks <= 0 &&
      p.stunTicks <= 0 &&
      Math.hypot(input.moveForward, input.moveX) > 0.01
    ) {
      p.webStruggle =
        (p.webStruggle ?? 0) + 1 / (input.sprint ? cw.sprintTicksPerTear : cw.moveTicksPerTear);
    } else {
      p.webStruggle = (p.webStruggle ?? 0) + 1 / cw.idleTicksPerTear;
    }
    p.webLastDodgeTicks = p.dodgeTicks;
    // 부동소수 누적 오차 — 정확히 N틱째에 차도록 엡실론을 준다
    if ((p.webStruggle ?? 0) >= 1 - 1e-9) {
      p.webStruggle = Math.max(0, (p.webStruggle ?? 0) - 1);
      p.webSwingsLeft = (p.webSwingsLeft ?? 1) - 1;
      world.events.emit('web_torn', { left: p.webSwingsLeft, total: balance.web.breakSwings });
      if ((p.webSwingsLeft ?? 0) <= 0) world.events.emit('web_broken', { reason: 'struggle' });
    }
  } else {
    p.webStruggle = 0;
    p.webLastDodgeTicks = 0;
  }

  // 피격 밀림 — 입력·경직과 무관하게 먼저 적용된다. 벽에 막히면 거기서 멈춘다.
  // (감산 전에 기억해 둔다 — 마지막 한 틱도 감속 대상이다)
  const shoved = (p.kbTicks ?? 0) > 0;
  if ((p.kbTicks ?? 0) > 0) {
    p.kbTicks = (p.kbTicks ?? 0) - 1;
    world.level.slideMove(p, balance.player.radius, p.kbX ?? 0, p.kbZ ?? 0);
  }

  // 경직/회피 대시 중에는 일반 이동 불가 (시선은 위에서 이미 처리 — 계속 돌아본다)
  if (p.stunTicks > 0 || p.dodgeTicks > 0) {
    resolveEnemyOverlap(world); // 밀리거나 대시로 파묻혀도 겹친 채로 두지 않는다
    return;
  }

  // 이동 방향 (yaw 기준, XZ 평면)
  const fx = -Math.sin(p.yaw);
  const fz = -Math.cos(p.yaw);
  const rx = Math.cos(p.yaw);
  const rz = -Math.sin(p.yaw);
  let wx = fx * input.moveForward + rx * input.moveX;
  let wz = fz * input.moveForward + rz * input.moveX;
  const len = Math.hypot(wx, wz);
  if (len === 0) {
    strideTicks = 0; // 멈추면 보폭도 처음부터
    resolveEnemyOverlap(world); // 가만히 서 있어도 적이 파고들면 밀려난다
    return;
  }
  // 방향만 정규화하고 크기는 남긴다 — 정규화만 하면 스틱을 살짝 밀어도 전력이 된다.
  // 키보드는 len 이 1 또는 √2 라 언제나 1로 잘려 예전과 똑같이 움직인다
  const mag = Math.min(1, len);
  wx = (wx / len) * mag;
  wz = (wz / len) * mag;

  // 질주 — 스태미너가 있어야 하고, 움직이는 동안만 닳는다 (제자리 쉬프트는 무소모).
  // 탈진 중에는 아무리 눌러도 평속
  const st = world.stamina;
  const stam = balance.player.stamina;
  const sprinting = input.sprint && !st.exhausted && st.value > 0;
  if (sprinting) {
    if (spendStamina(st, stam.sprintDrainPerTick, stam.regenDelayTicks)) {
      world.events.emit('stamina_empty', {});
    }
  }
  // 발소리 — 보폭마다 한 번. 걷기는 작게(플레이어에게만), 질주는 크게(적도 듣는다)
  strideTicks++;
  const strideInterval = sprinting
    ? balance.player.sprintFootstepTicks
    : balance.player.walkFootstepTicks;
  if (strideTicks >= strideInterval) {
    strideTicks = 0;
    world.events.emit('footstep', { sprint: sprinting });
  }
  let speed = sprinting ? balance.player.sprintSpeed : balance.player.moveSpeed;
  if (st.exhausted) speed *= stam.exhaustedSpeedMul; // 숨이 차 제대로 못 걷는다
  if (webbed) speed *= balance.web.moveSpeedMul; // 거미줄에 발이 묶인다
  // 점액 장판 — 슬라임이 기어간 자리. 밟는 동안 미끄러워 느리다
  const oil = balance.traps.types.trap_oil;
  const gooOn = world.gooPuddles?.some((g) => Math.hypot(p.x - g.x, p.z - g.z) <= balance.goo.radius) ?? false;
  const oilOn = world.traps.some(
    (t) => t.type === 'trap_oil' && (t.phase === 'armed' || t.phase === 'firing') &&
      Math.hypot(p.x - t.x, p.z - t.z) <= oil.radius,
  );
  // 점액·기름은 둘 다 '바닥 미끄러움' — 겹쳐도 더 센 하나만 (곱하면 못 걷는다)
  if (gooOn || oilOn) {
    speed *= Math.min(gooOn ? balance.goo.playerSlowMul : 1, oilOn ? oil.playerSlowMul : 1);
  }
  // 밀리는 동안은 발이 안 붙는다 — 밀림과 이동이 더해지는 구조라 배율로 눌러 준다
  if (shoved) speed *= balance.playerKnockback.moveSpeedMul;
  if (p.blocking) speed *= balance.block.speedMul; // 방어 중 감속 페널티
  if (world.itemChannel) speed *= balance.items.channelMoveSpeedMul; // 마시는 중엔 못 뛴다
  // 시위를 당기는 동안 발이 무거워진다 (마시기와 같은 자리·같은 규약)
  if ((world.weapon.bowDraw ?? 0) > 0) speed *= balance.weapons.bow.drawMoveSpeedMul;
  world.level.slideMove(p, balance.player.radius, wx * speed * dt, wz * speed * dt);
  resolveEnemyOverlap(world);
}

/** 적 몸통은 통과할 수 없다 — 겹치면 겹친 만큼 밀려난다.
 *  벽으로 밀리지 않도록 밀어내기도 slideMove를 거친다 */
function resolveEnemyOverlap(world: World): void {
  const p = world.player;
  for (const enemy of world.enemies) {
    if (!enemy.alive) continue;
    // 얼굴에 붙은 거머리(latched)는 좌표가 플레이어와 겹치게 유지된다 — 장애물이 아니라
    // 몸에 붙은 것이므로 밀어내면 안 된다. 안 그러면 매 틱 한쪽으로 끌려간다 (실측 버그)
    if (enemy.ai === 'latched') continue;
    // 어깨 위를 나는 몸은 밀지 않는다 — 박쥐 관통 비행·벽/천장의 적 밑 통과
    if ((enemy.jumpY ?? 0) > balance.flyoverHeight) continue;
    const minDist = balance.player.radius + enemyDef(enemy.type).radius;
    let dx = p.x - enemy.x;
    let dz = p.z - enemy.z;
    let dist = Math.hypot(dx, dz);
    if (dist >= minDist) continue;
    if (dist === 0) {
      dx = 1; // 완전히 겹친 경우 — 임의 방향으로 뺀다
      dz = 0;
      dist = 1;
    }
    const push = minDist - dist;
    world.level.slideMove(p, balance.player.radius, (dx / dist) * push, (dz / dist) * push);
  }
}
