// data/balance.json 로더. 튜닝값은 전부 여기서 읽는다 — 코드에 하드코딩 금지.
// Vite가 JSON을 정적 import로 처리하므로 타입은 파일 내용에서 추론된다.

import balanceJson from '../../data/balance.json';

export const balance = balanceJson;

export type Balance = typeof balance;
