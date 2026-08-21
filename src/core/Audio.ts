// Web Audio API 직접 사용 — 라이브러리 없음, 에셋 없음 (전부 합성음).
// 텔레그래프 사운드는 시각 신호보다 먼저 재생된다 — docs/architecture.md §7.
// AudioBufferSourceNode/오실레이터는 매번 새로 만든다 (레이턴시 최소화).

export type SoundName =
  | 'telegraph_blue'
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
  | 'reload_end';

const MASTER_GAIN = 0.25;

export class GameAudio {
  private ctx: AudioContext | null = null;

  /** 사용자 제스처(클릭) 시점에 호출 — 오디오 컨텍스트 생성/재개 */
  unlock(): void {
    if (!this.ctx) this.ctx = new AudioContext();
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
        this.noise(0.18, 0.9, 1200);
        this.tone(220, 0.25, 'sawtooth', 0.6, 0, 80);
        break;
      case 'shot_blocked':
        // 짧은 금속 튕김
        this.tone(988, 0.05, 'square', 0.5);
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
        // 고블린 단말마 — 하강 그르렁 + 무너지는 노이즈
        this.tone(340, 0.32, 'sawtooth', 0.6, 0, 85);
        this.tone(510, 0.18, 'square', 0.3, 0.04, 160);
        this.noise(0.28, 0.45, 750, 0.08);
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
    osc.connect(g).connect(ctx.destination);
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
    src.connect(filter).connect(g).connect(ctx.destination);
    src.start(t0);
  }
}
