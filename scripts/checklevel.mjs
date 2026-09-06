#!/usr/bin/env node
// 레벨 그리드 검증 — 손으로 그린 맵이 실제로 걸어 다닐 수 있는지 확인한다.
//
//   node scripts/checklevel.mjs data/levels/z01_f1.json [...]
//
// 보는 것:
//  1. 필수 문자(S 스폰 / X 출구 / A 제단)가 있는가
//  2. 스폰에서 모든 바닥이 닿는가 — 문(D·G)을 열어도 못 가는 칸이 있으면 격리다
//  3. 문을 안 열고도 출구까지 가는 길이 있는가 (있으면 문이 장식이라는 뜻)
//  4. 적·폭발통·상자·횃불·글리프가 벽 안에 박혀 있지 않은가
//  5. 레버가 여는 대상(opens)이 실제로 문·관문인가
//
//  6. 보스 아레나(arena·bossArena — 거수 「무저갱 우리」, B3-5): bounds 가 격자 안 바닥이고, 기둥 P 가 전부 그 안에,
//     홈(B)이 안에, 문 D 가 경계에 붙어 있고, 경계 밖 적이 홈에서 alertRadius(18m) 밖인가
//
// 그리드 문자는 data/levels/*.json 의 legend 와 src/level/GridLoader.ts 의
// SOLID_CHARS(#·D·G·C·P)를 따른다.

import { readFileSync } from 'node:fs';

const SOLID = new Set(['#', 'D', 'G', 'C', 'P']); // P = 기둥(거수 아레나, B2-5) — 벽처럼 막힌다
/** 열 수 있는 벽 — 열렸다고 치면 지나갈 수 있다 */
const OPENABLE = new Set(['D', 'G', 'C']);

function parse(path) {
  const level = JSON.parse(readFileSync(path, 'utf8'));
  const grid = level.grid;
  const rows = grid.length;
  const cols = Math.max(...grid.map((r) => r.length));
  if (grid.some((r) => r.length !== cols)) {
    throw new Error(`행 길이가 제각각이다 — ${grid.map((r) => r.length).join(',')}`);
  }
  return { level, grid, rows, cols };
}

const at = (grid, col, row) =>
  row < 0 || row >= grid.length || col < 0 || col >= grid[row].length ? '#' : grid[row][col];

/** (col,row) 에서 4방향 BFS. passable 이 true 인 칸만 지난다 */
function flood(grid, rows, cols, start, passable) {
  const seen = new Set();
  const queue = [start];
  seen.add(`${start[0]},${start[1]}`);
  while (queue.length) {
    const [c, r] = queue.shift();
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nc = c + dc;
      const nr = r + dr;
      const key = `${nc},${nr}`;
      if (seen.has(key)) continue;
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
      if (!passable(at(grid, nc, nr))) continue;
      seen.add(key);
      queue.push([nc, nr]);
    }
  }
  return seen;
}

function findAll(grid, rows, cols, ch) {
  const out = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (at(grid, c, r) === ch) out.push([r, c]);
  return out;
}

function check(path) {
  const { level, grid, rows, cols } = parse(path);
  const errors = [];
  const warns = [];
  const notes = [];

  const spawn = findAll(grid, rows, cols, 'S');
  const exit = findAll(grid, rows, cols, 'X');
  const altar = findAll(grid, rows, cols, 'A');
  if (spawn.length !== 1) errors.push(`스폰(S)이 ${spawn.length}개 — 정확히 하나여야 한다`);
  if (exit.length !== 1) errors.push(`출구(X)가 ${exit.length}개 — 정확히 하나여야 한다`);
  if (altar.length === 0) warns.push('제단(A)이 없다 — 부활 지점이 없는 층이 된다');
  if (errors.length) return { path, level, errors, warns, notes };

  const [sr, sc] = spawn[0];
  const [xr, xc] = exit[0];

  // ① 문을 열 수 있다고 치고 — 여기서 못 닿는 바닥은 영영 격리된 칸이다
  const open = flood(grid, rows, cols, [sc, sr], (ch) => !SOLID.has(ch) || OPENABLE.has(ch));
  const floors = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (SOLID.has(at(grid, c, r))) continue;
      floors.push([r, c]);
    }
  }
  const isolated = floors.filter(([r, c]) => !open.has(`${c},${r}`));
  if (isolated.length) {
    errors.push(
      `격리된 바닥 ${isolated.length}칸 — 문을 다 열어도 못 간다: ` +
        isolated.slice(0, 8).map(([r, c]) => `[${r},${c}]`).join(' ') +
        (isolated.length > 8 ? ' …' : ''),
    );
  }

  // ② 문을 안 열고 — 출구까지 그냥 갈 수 있으면 문·관문이 장식이다
  const closed = flood(grid, rows, cols, [sc, sr], (ch) => !SOLID.has(ch));
  const exitWithoutDoors = closed.has(`${xc},${xr}`);
  const gates = findAll(grid, rows, cols, 'G').length + findAll(grid, rows, cols, 'D').length;
  if (!open.has(`${xc},${xr}`)) errors.push('출구(X)에 닿을 수 없다');
  else if (exitWithoutDoors && gates > 0) {
    notes.push('문·관문을 하나도 열지 않고 출구까지 갈 수 있다 (우회로가 열려 있다는 뜻 — 의도라면 정상)');
  } else if (!exitWithoutDoors) {
    notes.push('출구로 가려면 문이나 관문을 반드시 열어야 한다');
  }

  // 제단을 밟지 않고 출구까지 가는 우회로가 있는가 (제단은 강제가 아니어야 한다)
  if (altar.length) {
    const bypass = flood(grid, rows, cols, [sc, sr], (ch) => (!SOLID.has(ch) || OPENABLE.has(ch)) && ch !== 'A');
    notes.push(
      bypass.has(`${xc},${xr}`)
        ? '제단을 밟지 않는 우회로가 있다'
        : '제단을 반드시 밟아야 출구에 닿는다 (제단은 선택이어야 한다는 규약과 어긋난다)',
    );
  }

  // ③ 벽 안에 박힌 배치물
  const inWall = (r, c) => SOLID.has(at(grid, c, r));
  const placed = [
    ...(level.entities ?? []).map((e) => [e.cell, `${e.type}`]),
    ...(level.lighting?.torches ?? []).map((t) => [t, '횃불']),
    ...(level.glyphs ?? []).map((g) => [g.cell, '글리프']),
    // 균열 벽 트리거는 그 벽 칸 자체를 가리킨다 — 벽 안이 정상이라 여기서 뺀다
    ...(level.triggers ?? []).filter((t) => t.type !== 'crack_wall').map((t) => [t.cell, `트리거(${t.type})`]),
  ];
  for (const [cell, what] of placed) {
    if (!cell) continue;
    const [r, c] = cell;
    if (r < 0 || r >= rows || c < 0 || c >= cols) errors.push(`${what} [${r},${c}] 이 그리드 밖`);
    else if (inWall(r, c)) errors.push(`${what} 이 벽 안 [${r},${c}] (문자 '${at(grid, c, r)}')`);
    else if (!open.has(`${c},${r}`)) warns.push(`${what} [${r},${c}] 이 격리 구역에 있다`);
  }

  // ③-b 함정 — 바닥 칸(위에서 이미 검사) + 계단 8m 밖 + 다트는 -dir 칸이 벽(노즐 벽)
  {
    const DIRS = { N: [-1, 0], S: [1, 0], E: [0, 1], W: [0, -1] };
    const stairs = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if ('SX'.includes(at(grid, c, r))) stairs.push([r, c]);
    for (const e of level.entities ?? []) {
      if (!e.type.startsWith('trap_')) continue;
      const [r, c] = e.cell;
      for (const [sr, sc] of stairs) {
        const d = Math.hypot((c - sc) * (level.cellSize ?? 4), (r - sr) * (level.cellSize ?? 4));
        if (d < 8) errors.push(`${e.type} [${r},${c}] 이 계단에서 ${d.toFixed(1)}m — 8m 안`);
      }
      if (e.type === 'trap_dart' || e.type === 'trap_dart_auto') {
        const [dr, dc] = DIRS[e.dir ?? 'N'];
        if (at(grid, c - dc, r - dr) !== '#') errors.push(`다트 [${r},${c}] 의 노즐 벽(-dir) 이 벽이 아니다`);
      }
      if (e.type === 'trap_net' || e.type === 'trap_pendulum' || e.type === 'trap_rockfall') {
        const [dr, dc] = DIRS[e.dir ?? 'N'];
        if (at(grid, c + dr, r + dc) !== '#' || at(grid, c - dr, r - dc) !== '#') {
          errors.push(`${e.type} [${r},${c}] 통행 축 양옆이 벽이 아니다`);
        }
      }
    }
    // 낙석 잔해는 몸을 영구히 막는다 — 전부 내려와도 S→X·제단이 이어져야 한다
    const rockCells = new Set((level.entities ?? []).filter((e) => e.type === 'trap_rockfall').map((e) => `${e.cell[1]},${e.cell[0]}`));
    if (rockCells.size > 0) {
      const blockedGrid = grid.map((row, r) => [...row].map((ch, c) => (rockCells.has(`${c},${r}`) ? '#' : ch)).join(''));
      const reach = flood(blockedGrid, rows, cols, [sc, sr], (ch) => !SOLID.has(ch) || OPENABLE.has(ch));
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const ch = at(grid, c, r);
        if ((ch === 'X' || ch === 'A') && !reach.has(`${c},${r}`)) errors.push(`낙석 잔해가 전부 내려오면 ${ch} [${r},${c}] 에 못 간다`);
      }
    }
  }

  // 균열 벽 트리거는 실제로 C 를 가리켜야 한다
  for (const t of level.triggers ?? []) {
    if (t.type !== 'crack_wall') continue;
    const [r, c] = t.cell ?? [];
    if (at(grid, c, r) !== 'C') errors.push(`균열 벽 트리거 [${r},${c}] 가 C 가 아니다 (문자 '${at(grid, c, r)}')`);
  }

  // ⑥ 보스 아레나(B3-5) — bounds·기둥·홈·문·곁방 거리
  if (level.arena || level.bossArena) {
    const a = level.arena;
    if (!a || !Array.isArray(a.bounds) || a.bounds.length !== 4 || !Array.isArray(a.home)) {
      errors.push('bossArena 층인데 arena{bounds:[r0,c0,r1,c1], home:[r,c]} 가 없다');
    } else {
      const [r0, c0, r1, c1] = a.bounds;
      const cs = level.cellSize ?? 4;
      const inB = (r, c) => r >= r0 && r <= r1 && c >= c0 && c <= c1;
      if (r0 < 0 || c0 < 0 || r1 >= rows || c1 >= cols || r0 > r1 || c0 > c1) errors.push(`arena.bounds ${a.bounds} 가 격자 밖이거나 뒤집혔다`);
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
        const ch = at(grid, c, r);
        if (ch !== '.' && ch !== 'P') errors.push(`arena.bounds 안 [${r},${c}] 이 바닥이 아니다 (문자 '${ch}')`);
      }
      for (const [r, c] of findAll(grid, rows, cols, 'P')) if (!inB(r, c)) errors.push(`기둥 P [${r},${c}] 이 arena.bounds 밖`);
      const [hr, hc] = a.home;
      if (!inB(hr, hc) || at(grid, hc, hr) !== '.') errors.push(`arena.home [${hr},${hc}] 이 경계 안 바닥이 아니다`);
      const doors = findAll(grid, rows, cols, 'D').filter(([r, c]) =>
        ((r === r0 - 1 || r === r1 + 1) && c >= c0 && c <= c1) || ((c === c0 - 1 || c === c1 + 1) && r >= r0 && r <= r1));
      if (doors.length !== 1) errors.push(`아레나 경계에 붙은 문 D 가 ${doors.length}개 — 정확히 하나여야 한다(봉쇄 대상)`);
      const boss = (level.entities ?? []).filter((e) => e.boss === true);
      if (boss.length !== 1) errors.push(`boss:true 배치가 ${boss.length}개 — 아레나 주인은 하나여야 한다`);
      else if (!inB(boss[0].cell[0], boss[0].cell[1])) errors.push('아레나 주인이 경계 밖에 있다');
      // 곁방 적은 홈에서 18m(거수 alertRadius) 밖 — 포효 기상에 끼지 않는다. 경계 안에는 주인 말고 적이 없다
      for (const e of level.entities ?? []) {
        if (e.boss || e.type === 'barrel' || e.type === 'chest' || e.type.startsWith('prop_') || e.type.startsWith('trap_')) continue;
        const [r, c] = e.cell;
        if (inB(r, c)) errors.push(`${e.type} [${r},${c}] 이 아레나 경계 안 — 결투는 1:1 이다`);
        const d = Math.hypot((c - hc) * cs, (r - hr) * cs);
        if (d < 18) errors.push(`${e.type} [${r},${c}] 이 보스 홈에서 ${d.toFixed(1)}m — 18m 안(포효 기상 반경)`);
      }
      notes.push(`보스 아레나 ${c1 - c0 + 1}×${r1 - r0 + 1}칸, 기둥 ${findAll(grid, rows, cols, 'P').length}, 홈 [${hr},${hc}]`);
    }
  }

  // ④ 레버가 여는 대상
  for (const t of level.triggers ?? []) {
    if (t.type !== 'lever') continue;
    if (t.resets) {
      // 함정 재생성 레버 — 가리키는 칸에 함정 배치가 있어야 한다
      const [rr, rc] = t.resets;
      const has = (level.entities ?? []).some((e) => e.type.startsWith('trap_') && e.cell[0] === rr && e.cell[1] === rc);
      if (!has) errors.push(`재생성 레버 [${t.cell}] 가 가리키는 [${rr},${rc}] 에 함정이 없다`);
      continue;
    }
    const [r, c] = t.opens ?? [];
    if (r === undefined) { errors.push(`레버 [${t.cell}] 에 opens 가 없다`); continue; }
    const target = at(grid, c, r);
    if (target !== 'G' && target !== 'D') {
      errors.push(`레버가 여는 [${r},${c}] 가 문·관문이 아니다 (문자 '${target}')`);
    }
  }

  return { path, level, errors, warns, notes, stats: { rows, cols, floors: floors.length } };
}

let bad = 0;
for (const path of process.argv.slice(2)) {
  let r;
  try {
    r = check(path);
  } catch (e) {
    console.log(`\n✗ ${path}\n  ${e.message}`);
    bad++;
    continue;
  }
  const head = `${r.level.id ?? '?'} — ${r.level.name ?? ''} (${r.stats?.cols}×${r.stats?.rows}, 바닥 ${r.stats?.floors}칸)`;
  console.log(`\n${r.errors.length ? '✗' : '✓'} ${path}\n  ${head}`);
  for (const e of r.errors) console.log(`  [오류] ${e}`);
  for (const w of r.warns) console.log(`  [주의] ${w}`);
  for (const n of r.notes) console.log(`  · ${n}`);
  if (r.errors.length) bad++;
}
process.exit(bad ? 1 : 0);
