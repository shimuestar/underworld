// Web Audio API 직접 사용 — 라이브러리 없음, 에셋 없음 (전부 합성음).
// 텔레그래프 사운드는 시각 신호보다 먼저 재생된다 — docs/architecture.md §7.
// AudioBufferSourceNode/오실레이터는 매번 새로 만든다 (레이턴시 최소화).

export type SoundName =
  | 'telegraph_blue'
  | 'telegraph_red'
  | 'telegraph_purple'
  | 'deflect'
  | 'barrier_blocked'
  | 'boss_phase'
  | 'zone_clear'
  | 'parry_perfect'
  | 'parry_normal'
  | 'parry_fail'
  | 'execute'
  | 'shot_blocked'
  | 'dodge'
  | 'cast_fire'
  | 'cast_fizzle'
  | 'spell_impact'
  | 'pickup'
  | 'gunshot'
  | 'hit_flesh'
  | 'hit_wall'
  | 'enemy_death'
  | 'reload_start'
  | 'reload_end'
  | 'altar_enter'
  | 'corruption_up'
  | 'lever_pull'
  | 'bow_twang'
  | 'headshot'
  | 'player_hurt'
  | 'block_hit'
  | 'hammer_heavy'
  | 'heavy_hit'
  | 'guard_clash'
  | 'enemy_whiff'
  | 'shield_break'
  | 'pickup_potion'
  | 'pickup_gold'
  | 'weapon_switch'
  | 'hammer_swing'
  | 'melee_hit'
  | 'grenade_throw'
  | 'explosion';

const MASTER_GAIN = 0.25;

export class GameAudio {
  private ctx: AudioContext | null = null;
  private out: AudioNode | null = null;

  /** 사용자 제스처(클릭) 시점에 호출 — 오디오 컨텍스트 생성/재개 */
  unlock(): void {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      // 마스터 컴프레서 — 소리가 겹칠 때 뭉개지지 않고 펀치가 살도록
      const compressor = this.ctx.createDynamicsCompressor();
      compressor.threshold.value = -18;
      compressor.ratio.value = 6;
      compressor.attack.value = 0.003;
      compressor.release.value = 0.25;
      compressor.connect(this.ctx.destination);
      this.out = compressor;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  play(name: SoundName): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;

    switch (name) {
      case 'telegraph_blue':
        // 금속성 고음 2연타 — 청색(패링 가능) 예고
        this.tone(1760, 0.09, 'triangle', 0.9);
        this.tone(2637, 0.12, 'triangle', 0.7, 0.05);
        break;
      case 'telegraph_red':
        // 저주파 웅웅 — 적색(회피 전용) 예고
        this.tone(65, 0.5, 'sawtooth', 0.9);
        this.tone(62, 0.5, 'sawtooth', 0.7, 0.02);
        break;
      case 'telegraph_purple':
        // 마법 상승음 — 보라(반사 가능) 예고
        this.tone(440, 0.5, 'sine', 0.7, 0, 1320);
        this.tone(660, 0.4, 'triangle', 0.4, 0.1, 1760);
        break;
      case 'deflect':
        // 반사 성공 — 즉각적인 금속 팅 + 상승 스윕 + 종소리 화음 꼬리 (보상감)
        this.tone(2637, 0.08, 'triangle', 0.9); // 팅
        this.tone(880, 0.18, 'sine', 0.7, 0.02, 2637); // 상승
        this.tone(1568, 0.45, 'sine', 0.65, 0.09); // 종 (G6)
        this.tone(2349, 0.4, 'sine', 0.45, 0.12); // 종 (D7)
        this.tone(3136, 0.35, 'sine', 0.3, 0.15); // 종 (G7)
        this.noise(0.07, 0.45, 5000, 0.02); // 반짝임
        break;
      case 'barrier_blocked':
        // 방어막/장갑 튕김 — 마법적 둔탁음
        this.tone(320, 0.16, 'sine', 0.7, 0, 180);
        this.tone(1400, 0.06, 'triangle', 0.35);
        break;
      case 'boss_phase':
        // 페이즈 전환 — 무거운 북
        this.tone(70, 0.5, 'sine', 1.0, 0, 40);
        this.noise(0.3, 0.6, 300);
        break;
      case 'zone_clear':
        // 구역 클리어 — 3음 화음 상행
        this.tone(523, 0.5, 'sine', 0.7);
        this.tone(659, 0.5, 'sine', 0.7, 0.12);
        this.tone(784, 0.8, 'sine', 0.7, 0.24);
        break;
      case 'parry_perfect':
        // 밝은 종소리 + 노이즈 스파크
        this.tone(2093, 0.28, 'sine', 1.0);
        this.tone(3136, 0.2, 'sine', 0.5);
        this.noise(0.06, 0.5, 4000);
        break;
      case 'parry_normal':
        this.tone(1319, 0.14, 'sine', 0.7);
        this.noise(0.04, 0.3, 3000);
        break;
      case 'parry_fail':
        // 저음 둔탁음
        this.tone(110, 0.22, 'square', 0.8, 0, 55);
        break;
      case 'execute':
        // 방패 강타 — 금속 임팩트(즉시) + 뼈 파쇄(35ms) + 서브 붐(꼬리)
        this.tone(880, 0.1, 'square', 0.85);
        this.tone(1320, 0.08, 'triangle', 0.5);
        this.noise(0.06, 0.9, 5200);
        this.noise(0.14, 0.8, 900, 0.035);
        this.tone(150, 0.3, 'sawtooth', 0.7, 0.035, 52);
        this.tone(62, 0.42, 'sine', 0.95, 0.02, 34);
        break;
      case 'shot_blocked':
        // 방패 막힘 — 크고 명확한 금속 클랭 (비화성 배음 + 밝은 스파크)
        this.tone(620, 0.22, 'square', 0.9);
        this.tone(987, 0.2, 'triangle', 0.8);
        this.tone(1480, 0.16, 'triangle', 0.6);
        this.tone(2210, 0.12, 'triangle', 0.4);
        this.noise(0.05, 0.6, 6000);
        break;
      case 'dodge':
        this.noise(0.12, 0.35, 800);
        break;
      case 'cast_fire':
        // 화염 방출 — 저음 스윕 + 노이즈
        this.tone(320, 0.3, 'sawtooth', 0.5, 0, 140);
        this.noise(0.25, 0.5, 700);
        break;
      case 'cast_fizzle':
        // 마나 부족 — 힘없는 하강음
        this.tone(240, 0.18, 'triangle', 0.5, 0, 90);
        break;
      case 'spell_impact':
        this.noise(0.16, 0.7, 1000);
        this.tone(180, 0.2, 'square', 0.5, 0, 90);
        break;
      case 'pickup':
        // 밝은 2음 차임
        this.tone(1568, 0.12, 'sine', 0.6);
        this.tone(2093, 0.2, 'sine', 0.6, 0.07);
        break;
      case 'gunshot':
        // 권총 — 날카로운 노이즈 크랙 + 저음 펀치
        this.noise(0.09, 1.0, 4500);
        this.tone(150, 0.12, 'square', 0.7, 0, 55);
        break;
      case 'hit_flesh':
        // 적 명중 — 둔탁한 살점음 (착탄 지연 살짝)
        this.noise(0.07, 0.6, 480, 0.035);
        this.tone(210, 0.1, 'sine', 0.6, 0.035, 120);
        break;
      case 'hit_wall':
        // 벽 명중 — 높은 돌 튕김
        this.noise(0.05, 0.4, 2600, 0.035);
        this.tone(1180, 0.07, 'triangle', 0.35, 0.035, 700);
        break;
      case 'enemy_death':
        // 처치 — 총성(0ms) 크랙이 지나간 뒤 별도의 '쿵'이 들리도록 50ms 지연 레이어링
        this.tone(85, 0.24, 'sine', 1.5, 0.05, 36); // 서브베이스 펀치
        this.noise(0.1, 1.2, 1400, 0.05); // 크런치
        this.tone(500, 0.14, 'square', 0.9, 0.08, 90); // 하강 킬 톰
        this.tone(300, 0.28, 'sawtooth', 0.55, 0.11, 70); // 단말마
        this.noise(0.3, 0.5, 420, 0.15); // 무너지는 잔향
        break;
      case 'reload_start':
        // 탄창 분리 — 딸깍 + 낮은 슬라이드
        this.tone(620, 0.04, 'square', 0.4);
        this.noise(0.09, 0.3, 1200, 0.05);
        this.tone(300, 0.06, 'square', 0.3, 0.12, 220);
        break;
      case 'reload_end':
        // 새 탄창 삽입 + 슬라이드 후퇴/전진 스냅
        this.tone(500, 0.05, 'square', 0.45);
        this.noise(0.05, 0.35, 2000, 0.06);
        this.tone(880, 0.05, 'square', 0.5, 0.09);
        break;
      case 'altar_enter':
        // 깊은 공명 화음
        this.tone(110, 1.2, 'sine', 0.7);
        this.tone(165, 1.0, 'sine', 0.45, 0.1);
        this.tone(220, 0.8, 'sine', 0.3, 0.25);
        break;
      case 'weapon_switch':
        this.tone(700, 0.04, 'square', 0.4);
        this.tone(500, 0.05, 'square', 0.35, 0.05);
        break;
      case 'hammer_swing':
        // 휘두름 바람 + 끝에 육중한 내리침 임팩트
        this.noise(0.14, 0.7, 700);
        this.tone(120, 0.12, 'sine', 0.5, 0.03, 60);
        this.tone(75, 0.16, 'sine', 1.3, 0.11, 38); // 내리침 쿵
        this.noise(0.07, 0.8, 1500, 0.11);
        break;
      case 'melee_hit':
        // 해머 적중 — 내리찍는 모션(스윙 후반)에 맞춰 둔탁한 3겹 충격
        this.tone(65, 0.26, 'sine', 1.7, 0.06, 28); // 서브베이스 펀치
        this.tone(150, 0.12, 'square', 0.9, 0.06, 55); // 몸통 스맥
        this.noise(0.09, 1.3, 1100, 0.06); // 뼈 크런치
        this.noise(0.22, 0.45, 350, 0.12); // 둔중한 잔향
        break;
      case 'grenade_throw':
        this.noise(0.12, 0.35, 1200);
        break;
      case 'explosion':
        // 폭발 — 깊은 붐 + 파열
        this.tone(60, 0.7, 'sine', 1.6, 0, 28);
        this.noise(0.5, 1.3, 900);
        this.noise(0.9, 0.5, 300, 0.1);
        break;
      case 'hammer_heavy':
        // 강타 스윙 — 길고 낮은 바람 가르는 소리
        this.noise(0.34, 0.7, 900);
        this.tone(120, 0.3, 'sawtooth', 0.35, 0, 55);
        break;
      case 'heavy_hit':
        // 강타 적중 — 서브베이스 폭발 + 금속 파열 + 긴 여운
        this.tone(48, 0.5, 'sine', 1.0, 0, 26);
        this.tone(90, 0.34, 'sawtooth', 0.85, 0, 40);
        this.noise(0.12, 1.0, 2200);
        this.noise(0.3, 0.7, 700, 0.05);
        this.tone(320, 0.4, 'triangle', 0.4, 0.03, 120);
        break;
      case 'guard_clash':
        // 방패 격돌 — 묵직한 충돌(저음) + 금속 마찰 + 여운 있는 링
        this.tone(90, 0.16, 'sine', 0.95);
        this.noise(0.06, 0.9, 3800);
        this.tone(520, 0.14, 'square', 0.6, 0.01);
        this.tone(1180, 0.3, 'triangle', 0.42, 0.02);
        this.tone(1760, 0.42, 'sine', 0.24, 0.03);
        break;
      case 'enemy_whiff':
        // 허공을 가르는 헛창 — 바람 소리만 남고 타격음이 없다
        this.noise(0.22, 0.5, 2600);
        this.tone(180, 0.2, 'sine', 0.25, 0.02, 95);
        break;
      case 'shield_break':
        // 방패 파괴 — 금속 갈라짐 + 나무 쪼개짐(40ms) + 화염 삼킴(저음 스윕)
        this.tone(740, 0.09, 'square', 0.8);
        this.tone(1100, 0.12, 'triangle', 0.55);
        this.noise(0.07, 0.85, 5600);
        this.noise(0.2, 0.75, 1400, 0.04); // 쪼개지는 파편
        this.tone(300, 0.28, 'sawtooth', 0.6, 0.04, 90);
        this.noise(0.3, 0.5, 620, 0.06); // 화염 삼킴
        this.tone(70, 0.34, 'sine', 0.8, 0.03, 40);
        break;
      case 'pickup_potion':
        // 회복 — 따뜻하게 차오르는 상승 3화음
        this.tone(392, 0.18, 'sine', 0.5);
        this.tone(523, 0.2, 'sine', 0.45, 0.05);
        this.tone(659, 0.3, 'sine', 0.4, 0.1);
        this.tone(784, 0.35, 'triangle', 0.25, 0.14);
        break;
      case 'pickup_gold':
        // 동전 — 짧고 밝은 금속 딸랑
        this.tone(1568, 0.07, 'triangle', 0.35);
        this.tone(2093, 0.1, 'triangle', 0.28, 0.03);
        this.tone(2637, 0.08, 'sine', 0.18, 0.06);
        break;
      case 'block_hit':
        // 브레이서 방어 — 묵직한 금속 튕김 (피격음보다 단단한 느낌)
        this.tone(420, 0.1, 'square', 0.8, 0, 260);
        this.tone(1240, 0.07, 'triangle', 0.5);
        this.noise(0.06, 0.5, 2400);
        break;
      case 'player_hurt':
        // 피격 — 둔탁한 충격 + 낮은 신음조
        this.noise(0.08, 0.9, 900);
        this.tone(140, 0.16, 'square', 0.8, 0, 70);
        this.tone(260, 0.22, 'sawtooth', 0.5, 0.04, 110);
        break;
      case 'headshot':
        // 헤드샷 확인음 — 짧고 높은 스냅 (착탄 지연에 맞춤)
        this.tone(2800, 0.06, 'square', 0.6, 0.035);
        this.tone(1400, 0.09, 'triangle', 0.5, 0.05);
        break;
      case 'bow_twang':
        // 활시위 튕김 + 화살 바람 소리
        this.tone(220, 0.06, 'square', 0.7, 0, 140);
        this.noise(0.18, 0.5, 1600, 0.02);
        break;
      case 'lever_pull':
        // 육중한 기계 딸깍 + 멀리서 돌 문이 갈리는 소리
        this.tone(180, 0.08, 'square', 0.6);
        this.tone(120, 0.1, 'square', 0.5, 0.1);
        this.noise(0.7, 0.4, 250, 0.25);
        break;
      case 'corruption_up':
        // 불길한 상승 — 오염 임계
        this.tone(90, 1.1, 'sawtooth', 0.5, 0, 320);
        this.noise(0.9, 0.25, 400, 0.15);
        break;
    }
  }

  /** 단일 오실레이터 톤. freqEnd가 있으면 지수 슬라이드 */
  private tone(
    freq: number,
    durSec: number,
    type: OscillatorType,
    gain: number,
    delaySec = 0,
    freqEnd?: number,
  ): void {
    const ctx = this.ctx!;
    const t0 = ctx.currentTime + delaySec;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (freqEnd) osc.frequency.exponentialRampToValueAtTime(freqEnd, t0 + durSec);
    g.gain.setValueAtTime(gain * MASTER_GAIN, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + durSec);
    osc.connect(g).connect(this.out ?? ctx.destination);
    osc.start(t0);
    osc.stop(t0 + durSec);
  }

  /** 화이트 노이즈 버스트 (로우패스) */
  private noise(durSec: number, gain: number, filterFreq: number, delaySec = 0): void {
    const ctx = this.ctx!;
    const t0 = ctx.currentTime + delaySec;
    const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * durSec), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = filterFreq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain * MASTER_GAIN, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + durSec);
    src.connect(filter).connect(g).connect(this.out ?? ctx.destination);
    src.start(t0);
  }
}
