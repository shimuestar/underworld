import { defineConfig } from 'vite';

export default defineConfig({
  // GitHub Pages 는 https://<user>.github.io/underworld/ 하위 경로로 서비스된다 —
  // 상대 경로면 어디에 얹혀도 깨지지 않는다 (개발 서버 주소는 그대로다)
  base: './',
  server: {
    // 모든 인터페이스에 바인딩 — localhost가 IPv4(127.0.0.1)로 풀려도 접속된다
    host: true,
    // 5173 고정. 점유 중이면 조용히 다른 포트로 옮기지 않고 에러를 낸다
    // (서버가 몰래 5174로 밀려나 "연결 안 됨"으로 보이는 사고 방지)
    port: 5173,
    strictPort: true,
  },
});
