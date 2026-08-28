// Web Audio API 직접 사용 — 라이브러리 없음, 에셋 없음 (전부 합성음).
// 텔레그래프 사운드는 시각 신호보다 먼저 재생된다 — docs/architecture.md §7.
// AudioBufferSourceNode/오실레이터는 매번 새로 만든다 (레이턴시 최소화).

export type SoundName =
  | 'telegraph_blue'
  | 'telegraph_red'
  | 'telegraph_purple'
  | 'deflect'
  | 'barrier_blocked'
  | 'barrier_cracked'
  | 'barrier_broken'
  | 'zone_clear'
  | 'parry_perfect'
  | 'parry_normal'
  | 'parry_fail'
  | 'execute'
  | 'shot_blocked'
  | 'dodge'
  | 'cast_fire'
  | 'cast_fizzle'
  | 'cast_lightning'
  | 'cast_frost'
  | 'blink'
  | 'thaw'
  | 'stairs_travel'
  | 'wall_crumble'
  | 'footstep_run'
  | 'leech_drip'
  | 'leech_chitter'
  | 'leech_shriek'
  | 'ghoul_latch'
  | 'struggle_push'
  | 'ghoul_shriek'
  | 'slime_windup'
  | 'slime_split'
  | 'footstep_walk'
  | 'chain_locked'
  | 'unlock_chain'
  | 'shock'
  | 'freeze'
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
  | 'door_touch'
  | 'lever_pull'
  | 'enemy_alert'
  | 'door_slide'
  | 'bow_twang'
  | 'headshot'
  | 'player_hurt'
  | 'block_hit'
  | 'hammer_heavy'
  | 'heavy_hit'
  | 'guard_clash'
  | 'enemy_whiff'
  | 'shield_break'
  | 'shield_brace'
  | 'shield_crack'
  | 'pickup_potion'
  | 'pickup_mana'
  | 'pickup_gold'
  | 'pickup_food'
  | 'boss_roar'
  | 'boss_volley_draw'
  | 'ground_slam'
  | 'charge_ready'
  | 'web_hit'
  | 'web_break'
  | 'web_tear'
  | 'weapon_switch'
  | 'hammer_swing'
  | 'melee_hit'
  | 'grenade_throw'
  | 'explosion'
  | 'grenade_bounce'
  | 'barrel_hit'
  | 'barrel_armed'
  | 'rock_shattered'
  | 'chest_opened'
  | 'implode'
  | 'shop_buy'
  | 'shop_deny'
  | 'dry_fire'
  | 'exit_opened'
  | 'stamina_empty';

const MASTER_GAIN = 0.25;

export class GameAudio {
  private ctx: AudioContext | null = null;
  private out: AudioNode | null = null;
  /** 이어지는 전류음 — 채널 시전이 끝날 때 끈다 */
  private beam: { gain: GainNode; nodes: (OscillatorNode | AudioBufferSourceNode)[] } | null = null;

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

  /** 채널 시전(관통 뇌창) — 붙들고 있는 동안 이어지는 전류음.
   *  한 타마다 cast_lightning 을 울리면 기관총이 되므로, 시작 크랙 위에 이 웅웅거림을 깐다 */
  startBeam(): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || this.beam) return;
    const t0 = ctx.currentTime;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(0.5 * MASTER_GAIN, t0 + 0.06);
    gain.connect(this.out ?? ctx.destination);

    // 톱니 두 겹을 살짝 어긋나게 — 맥놀이가 전류의 지직거림이 된다
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 118;
    const osc2 = ctx.createOscillator();
    osc2.type = 'sawtooth';
    osc2.frequency.value = 124.5;
    // 밴드패스를 통과한 노이즈 — 위에 얹히는 쉭 소리
    const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const hiss = ctx.createBufferSource();
    hiss.buffer = buffer;
    hiss.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 2600;
    band.Q.value = 0.8;
    const hissGain = ctx.createGain();
    hissGain.gain.value = 0.35;

    osc.connect(gain);
    osc2.connect(gain);
    hiss.connect(band).connect(hissGain).connect(gain);
    osc.start(t0);
    osc2.start(t0);
    hiss.start(t0);
    this.beam = { gain, nodes: [osc, osc2, hiss] };
  }

  /** 한 타가 들어갔다 — 이어지는 전류음 위에 순간적으로 세게 지직거린다 */
  beamPulse(): void {
    const beam = this.beam;
    const ctx = this.ctx;
    if (!beam || !ctx) return;
    const t0 = ctx.currentTime;
    const base = 0.5 * MASTER_GAIN;
    beam.gain.gain.cancelScheduledValues(t0);
    beam.gain.gain.setValueAtTime(base * 1.7, t0);
    beam.gain.gain.exponentialRampToValueAtTime(base, t0 + 0.05);
  }

  /** 채널이 끊겼다 — 짧게 꺼지며 끝을 남긴다 */
  stopBeam(): void {
    const beam = this.beam;
    const ctx = this.ctx;
    if (!beam || !ctx) return;
    this.beam = null;
    const t0 = ctx.currentTime;
    beam.gain.gain.cancelScheduledValues(t0);
    beam.gain.gain.setValueAtTime(Math.max(0.0001, beam.gain.gain.value), t0);
    beam.gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.09);
    for (const node of beam.nodes) node.stop(t0 + 0.1);
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
      case 'barrier_cracked':
        // 금이 간다 — 막힘음보다 높고 짧게, 유리에 실금이 가는 느낌
        this.tone(880, 0.09, 'triangle', 0.5, 0, 1500);
        this.noise(0.05, 0.3, 4200);
        break;
      case 'barrier_broken':
        // 막이 터진다 — 유리 파열. 저역 붐 없이 고역만 흩어지게
        this.tone(1600, 0.12, 'triangle', 0.6, 0, 400);
        this.noise(0.35, 0.9, 3200);
        this.noise(0.5, 0.35, 6000, 0.05);
        break;
      case 'barrier_blocked':
        // 방어막 튕김 — 마법적 둔탁음
        this.tone(320, 0.16, 'sine', 0.7, 0, 180);
        this.tone(1400, 0.06, 'triangle', 0.35);
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
        // 회피 대시 — 몸이 공기를 가르는 휙. 노이즈 하나로는 전투 소음에 묻혀
        // 안 들린다는 피드백이 있어 스윕 톤을 겹치고 키웠다 (2026-08-27)
        this.tone(900, 0.16, 'sawtooth', 0.5, 0, 160);
        this.noise(0.18, 1.0, 1900);
        this.noise(0.1, 0.7, 800, 0.05);
        break;
      case 'cast_fire':
        // 화염 방출 — 저음 스윕 + 노이즈
        this.tone(320, 0.3, 'sawtooth', 0.5, 0, 140);
        this.noise(0.25, 0.5, 700);
        break;
      case 'cast_lightning':
        // 뇌창 — 날카로운 고음 크랙 + 짧은 노이즈 파열
        this.tone(1800, 0.08, 'sawtooth', 0.35, 0, 400);
        this.noise(0.12, 0.6, 3500);
        this.tone(140, 0.16, 'square', 0.3, 0.02, 60);
        break;
      case 'cast_frost':
        // 서리 — 유리 같은 고음이 내려앉고 차가운 노이즈가 퍼진다
        this.tone(1400, 0.35, 'sine', 0.3, 0, 500);
        this.tone(2100, 0.25, 'triangle', 0.2, 0.05, 900);
        this.noise(0.4, 0.3, 2400);
        break;
      case 'footstep_walk':
        // 걷기 발소리 — 질주보다 낮고 부드럽다. 이건 나만 듣는다 (적 감지는 질주만)
        this.tone(78, 0.06, 'sine', 0.3, 0, 44);
        this.noise(0.04, 0.18, 360);
        break;
      case 'struggle_push':
        // 몸부림 — 짧은 힘쓰는 소리 (낮은 퍽 + 숨)
        this.tone(130, 0.07, 'square', 0.4, 0, 80);
        this.noise(0.05, 0.3, 700);
        break;
      case 'leech_drip':
        // 점액 방울 — 뚝. 천장에 뭔가 있다는 유일한 소리 단서라 또렷하고 짧게
        this.tone(1100, 0.05, 'sine', 0.3, 0, 260);
        break;
      case 'leech_chitter':
        // 찌륵 — 마른 이빨 부딪는 소리
        this.tone(1900, 0.03, 'square', 0.22, 0, 1400);
        this.tone(1600, 0.04, 'square', 0.18, 0, 1100);
        break;
      case 'leech_shriek':
        // 낙하 비명 — 치솟는 쇳소리 (구울보다 가늘고 높다)
        this.tone(1500, 0.2, 'sawtooth', 0.45, 0, 2600);
        this.noise(0.12, 0.25, 3200);
        break;
      case 'ghoul_latch':
        // 물컹 붙잡힘 — 젖은 노이즈 + 뚝 떨어지는 톤
        this.noise(0.12, 0.6, 1100);
        this.tone(320, 0.16, 'sawtooth', 0.45, 0, 90);
        break;
      case 'ghoul_shriek':
        // 비명 — 치솟는 쇳소리. 죽은 척이 벌떡 일어날 때
        this.tone(680, 0.3, 'sawtooth', 0.5, 0, 1450);
        this.noise(0.18, 0.3, 2400);
        break;
      case 'slime_windup':
        // 꿀렁 — 낮은 사인이 미끄러져 내려가고 젖은 노이즈가 낀다 (몸이 부풀어 오르는 소리)
        this.tone(180, 0.28, 'sine', 0.5, 0, 70);
        this.noise(0.2, 0.25, 500);
        break;
      case 'slime_split':
        // 철퍽 — 갈라지는 젖은 파열
        this.noise(0.16, 0.55, 900);
        this.tone(240, 0.12, 'triangle', 0.35, 0, 110);
        break;
      case 'footstep_run':
        // 질주 발소리 — 낮고 짧은 쿵. 두 번 키웠다 (0.4→0.62→0.95 + 저음 겹)
        this.tone(95, 0.09, 'sine', 0.95, 0, 46);
        this.tone(58, 0.07, 'sine', 0.55, 0, 40);
        this.noise(0.06, 0.65, 560);
        break;
      case 'wall_crumble':
        // 벽 붕괴 — 첫 쩍(고음 크랙) + 묵직한 파열, 돌덩이가 잇달아 떨어지고 구른다.
        // 작다는 피드백에 전체를 크게 키웠다 (2026-08-27)
        this.noise(0.06, 1.0, 4200);
        this.tone(55, 0.55, 'square', 1.1, 0, 26);
        this.noise(0.45, 1.4, 460);
        this.noise(0.14, 0.9, 950, 0.18);
        this.noise(0.12, 0.75, 720, 0.36);
        this.noise(0.1, 0.6, 600, 0.54);
        this.tone(80, 0.24, 'sine', 0.6, 0.3, 42);
        break;
      case 'stairs_travel': {
        // 계단을 밟는 발걸음 — 낮은 쿵이 조금씩 낮아지며 이어진다.
        // 내려갈 때·올라갈 때·게임 시작(내려온 직후) 모두 이 소리다
        for (let i = 0; i < 7; i++) {
          const at = i * 0.16 + (i % 2) * 0.02;
          this.tone(150 - i * 9, 0.09, 'sine', 0.5, at, 55 - i * 3);
          this.noise(0.05, 0.28, 500 - i * 30, at);
        }
        break;
      }
      case 'chain_locked':
        // 잠긴 쇠사슬을 흔든 소리 — 짧은 금속 짤그랑 두 번
        this.tone(2200, 0.05, 'square', 0.22, 0, 1600);
        this.noise(0.05, 0.5, 5200);
        this.tone(1900, 0.06, 'square', 0.2, 0.09, 1400);
        this.noise(0.06, 0.45, 4800, 0.09);
        break;
      case 'unlock_chain':
        // 자물쇠 딸깍 + 사슬이 흘러내려 바닥에 쏟아진다
        this.tone(1300, 0.05, 'square', 0.4, 0, 900);
        this.noise(0.05, 0.4, 5600, 0.12);
        this.noise(0.05, 0.36, 5100, 0.19);
        this.noise(0.05, 0.32, 4600, 0.26);
        this.noise(0.05, 0.28, 4100, 0.33);
        this.tone(90, 0.18, 'sine', 0.45, 0.45, 50);
        break;
      case 'shock':
        // 감전 — 낮게 우는 전류에 지직거리는 노이즈가 겹친다 (얼어붙는 소리와 대비되게 거칠게)
        this.tone(70, 0.5, 'sawtooth', 0.5, 0, 58);
        this.tone(148, 0.45, 'square', 0.3, 0, 132);
        this.noise(0.5, 0.5, 3200);
        this.noise(0.1, 0.6, 5200, 0.12);
        this.noise(0.1, 0.5, 4600, 0.3);
        break;
      case 'freeze':
        // 얼려짐 — 묵직한 쿵으로 잡히고, 세 번 쩍쩍 굳는 크랙, 치솟는 유리음, 긴 서리 잔향
        this.tone(60, 0.28, 'square', 0.55, 0, 30);
        this.noise(0.06, 0.9, 5000);
        this.noise(0.05, 0.7, 5600, 0.07);
        this.noise(0.05, 0.6, 6200, 0.15);
        this.tone(500, 0.42, 'sine', 0.4, 0.02, 2400);
        this.tone(1200, 0.34, 'triangle', 0.28, 0.06, 3200);
        this.tone(2800, 0.5, 'sine', 0.14, 0.12, 3600);
        this.noise(0.55, 0.22, 3000, 0.1);
        break;
      case 'thaw':
        // 얼음 파열 — 묵직한 쿵 + 두 번 쩍 갈라지는 크랙 + 유리 조각이 흩어지는 긴 꼬리
        this.tone(85, 0.22, 'square', 0.5, 0, 40);
        this.noise(0.09, 0.85, 4500);
        this.noise(0.07, 0.6, 5200, 0.045);
        this.tone(2600, 0.34, 'sine', 0.28, 0.03, 900);
        this.tone(3400, 0.28, 'triangle', 0.2, 0.06, 1500);
        this.noise(0.38, 0.28, 2600, 0.08);
        break;
      case 'blink':
        // 그림자 이동 — 순간적으로 빨려 들어가는 하강음
        this.tone(900, 0.14, 'triangle', 0.4, 0, 120);
        this.noise(0.08, 0.25, 600);
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
      case 'chest_opened':
        // 낡은 경첩이 삐걱 열리고 금붙이가 쏟아진다
        this.tone(180, 0.35, 'sawtooth', 0.22, 0, 90);
        this.tone(660, 0.5, 'sine', 0.4, 0.1);
        this.tone(880, 0.6, 'sine', 0.35, 0.2);
        this.noise(0.35, 0.3, 5200, 0.15);
        break;
      case 'rock_shattered':
        // 바위가 공중에서 깨진다 — 둔탁한 파열 + 자갈 흩어지는 소리
        this.tone(140, 0.22, 'square', 0.5, 0, 60);
        this.noise(0.3, 0.7, 1400);
        this.noise(0.45, 0.3, 3600, 0.06);
        break;
      case 'barrel_hit':
        // 쇠통을 때린 소리 — 속이 빈 둔탁한 울림
        this.tone(210, 0.16, 'triangle', 0.5, 0, 90);
        this.noise(0.06, 0.3, 1600);
        break;
      case 'barrel_armed':
        // 도화선에 불이 붙었다 — 치익 하고 타들어간다
        this.noise(0.5, 0.35, 5200);
        this.tone(1200, 0.18, 'sawtooth', 0.18, 0, 2600);
        break;
      case 'grenade_bounce':
        // 벽에 튕긴 쇳덩이 — 짧고 마른 딸깍. 폭발과 헷갈리면 안 되므로 아주 가볍게
        this.tone(430, 0.05, 'square', 0.22, 0, 300);
        this.noise(0.04, 0.18, 2600);
        break;
      case 'explosion':
        // 폭발 — 깊은 붐 + 파열
        this.tone(60, 0.7, 'sine', 1.6, 0, 28);
        this.noise(0.5, 1.3, 900);
        this.noise(0.9, 0.5, 300, 0.1);
        break;
      case 'stamina_empty':
        // 숨이 찬다 — 짧게 두 번 헐떡이는 저역 노이즈
        this.noise(0.16, 0.3, 700);
        this.noise(0.2, 0.24, 520, 0.2);
        break;
      case 'exit_opened':
        // 봉인 해제 — 낮게 깔린 돌 갈림 뒤에 위로 열리는 화음
        this.noise(0.5, 0.5, 320);
        this.tone(150, 0.5, 'triangle', 0.5, 0.12, 300);
        this.tone(300, 0.7, 'sine', 0.45, 0.24, 450);
        this.tone(450, 0.9, 'sine', 0.3, 0.36, 600);
        break;
      case 'dry_fire':
        // 불발 — 공이가 빈 약실을 때리는 금속 딸깍. 저음을 넣으면 발사음처럼 들리므로
        // 고역 노이즈와 짧은 금속 티만 쓴다
        this.noise(0.03, 0.55, 5600);
        this.tone(2200, 0.045, 'square', 0.09, 0, 850);
        this.noise(0.05, 0.2, 1600, 0.05);
        break;
      case 'shop_buy':
        // 구매 — 동전이 떨어지는 짧은 2음 상승
        this.tone(880, 0.07, 'square', 0.16);
        this.tone(1320, 0.1, 'square', 0.13, 0.05);
        this.noise(0.06, 0.12, 5000, 0.02);
        break;
      case 'shop_deny':
        // 거절 — 낮은 2음 하강
        this.tone(220, 0.09, 'square', 0.16);
        this.tone(160, 0.13, 'square', 0.14, 0.07);
        break;
      case 'implode':
        // 내파 — 빨려드는 상승음 3겹 뒤에 압착. 폭발과 반대로 음이 올라갔다 꺼진다
        this.tone(170, 0.18, 'sawtooth', 0.14, 0, 520);
        this.tone(240, 0.16, 'sawtooth', 0.22, 0.1, 780);
        this.tone(330, 0.14, 'triangle', 0.36, 0.2, 1200);
        this.tone(70, 0.42, 'sine', 1.0, 0.32, 38);
        this.noise(0.3, 0.55, 620, 0.32);
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
      case 'shield_brace':
        // 방패로 받아냄 — 둔중한 나무·금속 충돌, 여운 짧게
        this.tone(110, 0.14, 'sine', 0.9);
        this.tone(430, 0.1, 'square', 0.45);
        this.noise(0.09, 0.75, 2600);
        break;
      case 'shield_crack':
        // 금이 가는 소리 — 위 충돌음 위에 갈라짐을 얹는다
        this.tone(95, 0.2, 'sine', 1.0);
        this.noise(0.13, 0.9, 3400);
        this.tone(680, 0.22, 'sawtooth', 0.5, 0.03, 240);
        this.noise(0.26, 0.6, 1100, 0.06);
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
      case 'pickup_mana':
        // 마나 회복 — 차가운 상승 배음 (회복과 구분되는 푸른 음색)
        this.tone(523, 0.2, 'triangle', 0.4);
        this.tone(784, 0.24, 'sine', 0.4, 0.05);
        this.tone(1046, 0.34, 'sine', 0.32, 0.1);
        this.tone(1568, 0.3, 'triangle', 0.16, 0.14);
        break;
      case 'boss_roar':
        // 족장 포효 — 낮게 깔리는 으르렁 + 위로 찢는 배음. 길고 크게
        this.tone(70, 1.5, 'sawtooth', 1.5, 0, 46);
        this.tone(104, 1.3, 'sawtooth', 0.9, 0.05, 132);
        this.tone(210, 1.0, 'square', 0.35, 0.1, 300);
        this.noise(1.4, 0.85, 620);
        this.noise(0.7, 0.4, 220, 0.5);
        break;
      case 'web_hit':
        // 거미줄에 걸림 — 끈적하게 감기는 소리. 타격음처럼 들리면 안 된다
        this.noise(0.35, 0.45, 2600);
        this.tone(420, 0.3, 'triangle', 0.22, 0, 180);
        this.noise(0.25, 0.2, 700, 0.12);
        break;
      case 'web_tear':
        // 한 겹 뜯긴다 — 짧고 거친 찢김. 완전히 끊길 때(web_break)보다 둔탁하게
        this.noise(0.14, 0.38, 3200);
        this.noise(0.1, 0.2, 900, 0.03);
        break;
      case 'web_break':
        // 줄이 끊긴다 — 짧게 툭 끊기는 고역 + 해방되는 상승음
        this.noise(0.09, 0.4, 4200);
        this.tone(300, 0.14, 'square', 0.2, 0, 720);
        break;
      case 'charge_ready':
        // 달려들기 직전 — 발로 땅을 긁고 낮게 으르렁. 짧고 굵게
        this.noise(0.22, 0.5, 900);
        this.noise(0.16, 0.35, 420, 0.16);
        this.tone(88, 0.42, 'sawtooth', 0.7, 0, 62);
        this.tone(150, 0.3, 'square', 0.22, 0.08, 110);
        break;
      case 'ground_slam':
        // 지면 강타 — 서브베이스 충격 + 돌 갈리는 저역 + 흩어지는 파편
        this.tone(42, 0.85, 'sine', 1.7, 0, 24);
        this.tone(88, 0.5, 'sawtooth', 0.8, 0, 40);
        this.noise(0.55, 1.1, 480);
        this.noise(0.9, 0.35, 2200, 0.06);
        break;
      case 'boss_volley_draw':
        // 활 시위를 당긴다 — 삐걱이며 조여드는 상승음. 화살 세례 예고
        this.tone(150, 0.75, 'sawtooth', 0.3, 0, 520);
        this.noise(0.7, 0.3, 1400);
        this.tone(880, 0.14, 'triangle', 0.22, 0.72);
        break;
      case 'pickup_food':
        // 음식 — 회복음과 마나음을 섞은 낮고 둔탁한 상승. 포션보다 수수하게
        this.tone(330, 0.16, 'sine', 0.38);
        this.tone(494, 0.2, 'triangle', 0.3, 0.06);
        this.noise(0.09, 0.14, 900, 0.02);
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
      case 'door_touch':
        // 문에 손을 얹는 순간 — 마른 돌을 긁는 짧은 소리
        this.noise(0.12, 0.22, 900, 0.0);
        this.tone(140, 0.05, 'square', 0.25);
        break;
      case 'enemy_alert':
        // 들켰다 — 짧게 치솟는 두 음. 놀란 숨소리 대신 쓰는 신호음이라
        // 짧고 날카롭게 두고, 여럿이 동시에 깨도 겹치지 않게 main 이 솎아 낸다
        this.tone(520, 0.07, 'square', 0.32, 0, 760);
        this.tone(880, 0.1, 'triangle', 0.28, 0.05);
        break;
      case 'lever_pull':
        // 육중한 금속 걸쇠가 넘어가는 딸깍 — 그 뒤에 문 갈리는 소리가 따로 난다
        this.tone(210, 0.06, 'square', 0.55);
        this.tone(140, 0.09, 'square', 0.45, 0.06);
        this.noise(0.18, 0.35, 1200, 0.02);
        break;
      case 'door_slide':
        // 잠금이 풀리고 돌 문이 갈리며 옆으로 밀린다
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
