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
// 그리드 문자는 data/levels/*.json 의 legend 와 src/level/GridLoader.ts 의
// SOLID_CHARS(#·D·G·C)를 따른다.

import { readFileSync } from 'node:fs';

const SOLID = new Set(['#', 'D', 'G', 'C']);
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

  // 균열 벽 트리거는 실제로 C 를 가리켜야 한다
  for (const t of level.triggers ?? []) {
    if (t.type !== 'crack_wall') continue;
    const [r, c] = t.cell ?? [];
    if (at(grid, c, r) !== 'C') errors.push(`균열 벽 트리거 [${r},${c}] 가 C 가 아니다 (문자 '${at(grid, c, r)}')`);
  }

  // ④ 레버가 여는 대상
  for (const t of level.triggers ?? []) {
    if (t.type !== 'lever') continue;
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
