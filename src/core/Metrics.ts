// 계측 수집기 — docs/metrics.md의 지표 정의를 따른다.
// 이벤트만 구독한다. 시스템 안에 계측 코드를 넣지 않는다 (docs/architecture.md §2).

import { balance } from './Balance';
import type { Events } from './Events';
import type { World } from './World';

export interface MetricsSnapshot {
  session: {
    ticks: number;
    seconds: number;
    deaths: number;
    cleared: boolean;
    corruptionApplied: number;
    corruptionPending: number;
  };
  combat: {
    encounters: number;
    parryAttempts: number;
    parryPerfect: number;
    parryNormal: number;
    parryFail: number;
    deflects: number;
    dodges: number;
    damageTakenTotal: number;
    timesDamaged: number;
    /** 생명 입자 — 흡수 개수 / 그로 인한 회복량 / 못 줍고 사라진 개수 */
    lifeMotesAbsorbed: number;
    lifeMoteHealTotal: number;
    lifeMotesExpired: number;
  };
  kills: { weapon: number; execution: number; spell: number; friendlyFire: number; total: number };
  /** 약점(거수) — 명중 수 / 약점 피해 합 / 파열 수 / 닫힌 노출 창 수와 그 안의 명중 합(노출 활용률 = hits/closed) / 혼절 수 /
   *  돌격 완벽 회피 수 / 절뚝(양 낫 잠김) 진입 수 / 눈멂 유도 수 / 전도 수 / 기둥 충돌 수 / 역류(심장 66 — 발구르기 취소) 수 (기획서 boss_scythe_behemoth §12) */
  weakPoints: { hits: number; damage: number; broken: number; exposuresClosed: number; exposureHits: number; dazes: number; chargeDodges: number; limps: number; blinds: number; topples: number; pillarHits: number; backflows: number };
  /** 페이즈 보스(거수, B2-6) — 전환 수 / 두 경계를 한 번에 넘은(P2 건너뜀) 수 / 페이즈별 소요 초(체력 칸 index 키 '3'·'2'·'1' — 사망까지 포함, 목표 P1 90s / P2 120s / P3 90s) /
   *  갑각판 파괴 수(P2 heavy 타격, B3-3 — 최대 3)와 그 골드 합(기획서 §12 "갑각판 파괴 수") /
   *  P3 기술(B3-4): 포효 발동 수·위압에 걸린 수(boss_roar_hit — 회피로 피한 비율 = 1 − roarHits/roars) / 삼연낫 시작 수·탈진 수(3연속 완벽 — 숙련 지표) / 광란 돌격 선회 수(첫 질주를 완벽 회피하지 못한 수) */
  boss: { phaseShifts: number; phaseSkips: number; phaseSeconds: Record<string, number>; platesBroken: number; plateGold: number; roars: number; roarHits: number; combos: number; exhausts: number; chainTurns: number };
  /** 진액 웅덩이·오염 진액·분출공(거수 P2+, B3-2) — 생긴 웅덩이 수 / 자연 소멸이 아닌 증발 수(불·질식·상한) / 오염 진액이 붙은 횟수 / 오염 진액 도트 피해 합 /
   *  오염 진액이 오염 대기에 더한 양 / 분출공 명중이 오염 대기에서 깎은 양(정화) / 질식 수. 순 오염 변화 = pendingIn − ventCleanse (기획서 §11.1 장부) */
  hazards: { pools: number; evaporated: number; corrosiveApplied: number; corrosiveDamage: number; pendingIn: number; ventCleanse: number; chokes: number };
  pickups: { potions: number; healed: number; gold: number; xp: number };
  shieldsBroken: number;
  ammo: { shotsFired: number; shotsHit: number; altarEntries: number; altarBypasses: number };
  mana: { gained: number; decayed: number; lostToFail: number };
  /** 함정 — 작동 / 플레이어 피격 / 적 피격 / 함정 처치 / 해체 / 진자 패링 / 함정 사망 */
  traps: {
    triggered: number; hitsPlayer: number; hitsEnemy: number; kills: number;
    disarms: number; parried: number; deaths: number;
  };
  /** 전리품 — 주머니 수 / 창 연 횟수 / 가져온·넣은·버린 개수 / 가방 가득 거부 */
  loot: { pouches: number; opened: number; revealed: number; taken: number; stashed: number; dropped: number; deniedFull: number; interrupted: number };
  derived: {
    ammoLeftRatioAtAltar: number | null;
    altarBypassRatio: number | null;
    parryAttemptsPerEncounter: number | null;
    perfectParryRatio: number | null;
    parrySuccessRatio: number | null;
    manaWasteRatio: number | null;
    chainTier3ReachRatio: number | null;
    shotAccuracy: number | null;
  };
  targets: typeof balance.metrics.targets;
}

export class Metrics {
  private deaths = 0;
  private encounters = 0;
  private parryPerfect = 0;
  private parryNormal = 0;
  private parryFail = 0;
  private deflects = 0;
  private dodges = 0;
  private damageTakenTotal = 0;
  private lifeMotesAbsorbed = 0;
  private lifeMoteHealTotal = 0;
  private lifeMotesExpired = 0;
  private timesDamaged = 0;
  private killsWeapon = 0;
  private killsExecution = 0;
  private killsSpell = 0;
  private killsFriendlyFire = 0; // 적 투사체가 적을 죽인 수 (플레이어 전과 아님)
  private weakPointHits = 0;
  private weakPointDamage = 0;
  private weakPointsBroken = 0;
  private exposuresClosed = 0;
  private exposureHits = 0;
  private dazes = 0;
  private chargeDodges = 0;
  private limps = 0;
  private blinds = 0;
  private topples = 0;
  private pillarHits = 0;
  private backflows = 0;
  private bossPhaseShifts = 0;
  private bossPhaseSkips = 0;
  private bossPhaseTicks: Record<string, number> = {};
  private platesBroken = 0;
  private plateGold = 0;
  private roars = 0;
  private roarHits = 0;
  private combos = 0;
  private exhausts = 0;
  private chainTurns = 0;
  private poolsSpawned = 0;
  private poolsEvaporated = 0;
  private corrosiveApplied = 0;
  private corrosiveDamage = 0;
  private corrosivePendingIn = 0;
  private ventCleanse = 0;
  private chokes = 0;
  private potionsPicked = 0;
  private healedTotal = 0;
  private goldCollected = 0;
  private lootPouches = 0;
  private lootOpened = 0;
  private lootRevealed = 0;
  private lootTaken = 0;
  private lootStashed = 0;
  private lootDropped = 0;
  private lootDeniedFull = 0;
  private lootInterrupted = 0;
  private xpGained = 0;
  private shieldsBroken = 0;
  private shotsFired = 0;
  private shotsHit = 0;
  private altarEntries = 0;
  private altarBypasses = 0;
  private ammoLeftRatios: number[] = [];
  private manaGained = 0;
  private manaDecayed = 0;
  private manaLostToFail = 0;
  private tier3Encounters = 0;
  private trapsTriggered = 0;
  private trapHitsPlayer = 0;
  private trapHitsEnemy = 0;
  private trapKills = 0;
  private trapDisarms = 0;
  private trapParried = 0;
  private trapDeaths = 0;
  private lastDamageWasTrap = false; // 마지막 피해가 함정이었나 — 사망 귀속용
  private maxChainThisEncounter = 0;

  constructor(events: Events) {
    events.on('parry_attempt', (payload) => {
      const result = (payload as { result: string }).result;
      if (result === 'perfect') this.parryPerfect++;
      else if (result === 'normal') this.parryNormal++;
      else this.parryFail++;
    });
    events.on('deflect', () => this.deflects++);
    events.on('dodge_step', () => this.dodges++);
    events.on('life_mote_absorbed', (payload) => {
      const info = payload as { count: number; healed: number };
      this.lifeMotesAbsorbed += info.count;
      this.lifeMoteHealTotal += info.healed;
    });
    events.on('life_mote_expired', (payload) => {
      this.lifeMotesExpired += (payload as { count: number }).count;
    });

    events.on('weapon_kill', () => this.killsWeapon++);
    events.on('melee_kill', (payload) => {
      if ((payload as { execution?: boolean }).execution) this.killsExecution++;
    });
    events.on('boss_execute', () => this.killsExecution++); // 처형 타격도 시도로 집계
    events.on('spell_kill', () => this.killsSpell++);
    events.on('friendly_fire_kill', () => this.killsFriendlyFire++);
    events.on('weak_point_hit', (payload) => {
      this.weakPointHits++;
      this.weakPointDamage += (payload as { damage: number }).damage;
    });
    events.on('weak_point_broken', () => this.weakPointsBroken++);
    events.on('exposure_closed', (payload) => {
      this.exposuresClosed++;
      this.exposureHits += (payload as { hits: number }).hits;
    });
    events.on('boss_staggered', (payload) => {
      if ((payload as { cause?: string }).cause === 'eye') this.dazes++;
    });
    events.on('charge_dodged', () => this.chargeDodges++);
    events.on('boss_status', (payload) => {
      const st = payload as { kind: string; on: boolean };
      if (!st.on) return;
      if (st.kind === 'limp') this.limps++;
      else if (st.kind === 'blind') this.blinds++;
      else if (st.kind === 'topple') this.topples++;
      else if (st.kind === 'backflow') this.backflows++; // 역류(B3-1·B3-2·B3-4) — 심장 66 으로 발구르기를, 분출공 66 으로 갑각 떨기를, 눈 66 으로 포효를 취소시킨 수(cause 'heart'|'vent'|'eye')
      else if (st.kind === 'choke') this.chokes++; // 질식(B3-2) — 분출공 내구 0(반사 4회): 갑각 떨기 봉인 + 웅덩이 증발
      else if (st.kind === 'exhaust') this.exhausts++; // 탈진(B3-4) — 삼연낫 3연속 완벽 패링
    });
    // P3 기술(거수 B3-4) — 포효 발동·위압 적중·삼연낫 시작·광란 돌격 선회. 시스템(Enemies) 안에는 카운터가 없다
    events.on('enemy_roar', () => this.roars++);
    events.on('boss_roar_hit', () => this.roarHits++);
    events.on('enemy_combo_start', () => this.combos++);
    events.on('enemy_chain_turn', () => this.chainTurns++);
    events.on('pillar_hit', () => this.pillarHits++);
    // 진액 웅덩이·오염 진액·분출공 정화(B3-2) — Hazards/Status/hitWeakPoint 는 카운터를 갖지 않는다
    events.on('pool_spawned', () => this.poolsSpawned++);
    events.on('pool_evaporated', (payload) => {
      if ((payload as { reason: string }).reason !== 'expired') this.poolsEvaporated++;
    });
    events.on('corrosive_applied', () => this.corrosiveApplied++);
    events.on('corrosive_tick', (payload) => {
      // 오염 진액 도트 — player_damaged 를 안 쓰므로 받은 피해에 합산(독·화염과 같은 도트 규약). 함정은 아니다
      const amount = (payload as { amount: number }).amount;
      this.corrosiveDamage += amount;
      this.damageTakenTotal += amount;
      this.lastDamageWasTrap = false;
    });
    events.on('corrosive_pending', (payload) => { this.corrosivePendingIn += (payload as { amount: number }).amount; });
    events.on('corruption_cleansed', (payload) => { this.ventCleanse += (payload as { amount: number }).amount; });
    // 페이즈 전환(거수) — from 페이즈에 머문 틱을 쌓는다. phase 0 은 사망(마지막 페이즈 마감)이라 전환으로 세지 않는다
    events.on('boss_phase', (payload) => {
      const ph = payload as { phase: number; from: number; fromTicks: number; skipped?: boolean };
      const key = String(ph.from);
      this.bossPhaseTicks[key] = (this.bossPhaseTicks[key] ?? 0) + ph.fromTicks;
      if (ph.phase > 0) {
        this.bossPhaseShifts++;
        if (ph.skipped) this.bossPhaseSkips++;
      }
    });
    // 갑각판 파괴(거수 P2, B3-3) — 장수와 골드 합. 탈락(plate_shed)은 골드가 없어 세지 않는다
    events.on('plate_broken', (payload) => {
      this.platesBroken++;
      this.plateGold += (payload as { gold: number }).gold;
    });
    // 소모품은 이제 줍는 순간이 아니라 마시는 순간을 센다 (가방을 거치므로)
    events.on('item_used', (payload) => {
      this.potionsPicked++;
      this.healedTotal += (payload as { healed: number }).healed;
    });
    events.on('gold_picked', (payload) => {
      this.goldCollected += (payload as { amount: number }).amount;
    });
    // 전리품 — 주머니·루팅 창 (Loot 는 카운터를 갖지 않는다)
    events.on('pouch_dropped', () => this.lootPouches++);
    events.on('loot_opened', () => this.lootOpened++);
    events.on('loot_revealed', () => this.lootRevealed++);
    events.on('loot_taken', (payload) => { this.lootTaken += (payload as { count: number }).count; });
    events.on('loot_stashed', (payload) => { this.lootStashed += (payload as { count: number }).count; });
    events.on('loot_dropped', (payload) => { this.lootDropped += (payload as { count: number }).count; });
    events.on('loot_denied', (payload) => {
      if ((payload as { reason: string }).reason === 'full') this.lootDeniedFull++;
    });
    events.on('loot_interrupted', () => this.lootInterrupted++); // 실시간 루팅 — 맞거나 밀려나 끊긴 횟수
    // 함정 — 시스템 안에 카운터를 두지 않는다 (CLAUDE.md 4). 전부 이벤트 구독
    events.on('trap_triggered', () => this.trapsTriggered++);
    events.on('trap_hit_player', () => this.trapHitsPlayer++);
    events.on('trap_hit_enemy', () => this.trapHitsEnemy++);
    events.on('trap_kill', () => this.trapKills++);
    events.on('trap_disarmed', () => this.trapDisarms++);
    events.on('trap_rubble_broken', () => this.trapDisarms++); // 잔해 폭파도 함정 무력화의 하나
    events.on('trap_parried', () => this.trapParried++);
    events.on('player_damaged', (payload) => {
      const src = (payload as { source?: string }).source;
      // 독·화염 초기 피해도 함정 피해다 (source 가 상태 이름)
      this.lastDamageWasTrap =
        typeof src === 'string' && (src.startsWith('trap_') || src === 'poison' || src === 'burn');
    });
    events.on('player_died', () => {
      if (this.lastDamageWasTrap) this.trapDeaths++;
    });
    for (const dot of ['poison_tick', 'burn_tick'] as const) {
      events.on(dot, (payload) => {
        // 독·화염 도트 — player_damaged 를 안 쓰므로 여기서 받은 피해에 합산 (도트 사망도 함정 사망으로 친다)
        this.damageTakenTotal += (payload as { amount: number }).amount;
        this.lastDamageWasTrap = true;
      });
    }
    events.on('shield_broken', () => this.shieldsBroken++);
    events.on('xp_gained', (payload) => {
      this.xpGained += (payload as { amount: number }).amount;
    });

    events.on('shot_fired', (payload) => {
      this.shotsFired++;
      if ((payload as { hitEnemy: boolean }).hitEnemy) this.shotsHit++;
    });

    events.on('player_damaged', (payload) => {
      this.timesDamaged++;
      this.damageTakenTotal += (payload as { amount: number }).amount;
    });
    events.on('player_died', () => this.deaths++);

    events.on('combat_entered', () => {
      this.encounters++;
      this.maxChainThisEncounter = 0;
    });
    events.on('combat_exited', () => {
      if (this.maxChainThisEncounter >= 3) this.tier3Encounters++;
    });
    events.on('chain_changed', (payload) => {
      const chain = (payload as { chain: number }).chain;
      this.maxChainThisEncounter = Math.max(this.maxChainThisEncounter, chain);
    });

    events.on('mana_gained', (payload) => {
      this.manaGained += (payload as { amount: number }).amount;
    });
    events.on('mana_decayed', (payload) => {
      this.manaDecayed += (payload as { amount: number }).amount;
    });
    events.on('mana_lost', (payload) => {
      this.manaLostToFail += (payload as { amount: number }).amount;
    });

    events.on('altar_entered', (payload) => {
      this.altarEntries++;
      this.ammoLeftRatios.push((payload as { ammoLeftRatio: number }).ammoLeftRatio);
    });
    events.on('altar_bypassed', () => this.altarBypasses++);
  }

  snapshot(world: World): MetricsSnapshot {
    const attempts = this.parryPerfect + this.parryNormal + this.parryFail;
    const altarTouches = this.altarEntries + this.altarBypasses;
    const avg = (values: number[]): number | null =>
      values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : null;
    const ratio = (a: number, b: number): number | null => (b > 0 ? a / b : null);

    return {
      session: {
        ticks: world.tick,
        seconds: Math.round(world.tick / balance.loop.tickRate),
        deaths: this.deaths,
        cleared: world.cleared,
        corruptionApplied: world.corruption.applied,
        corruptionPending: world.corruption.pending,
      },
      combat: {
        encounters: this.encounters,
        parryAttempts: attempts,
        parryPerfect: this.parryPerfect,
        parryNormal: this.parryNormal,
        parryFail: this.parryFail,
        deflects: this.deflects,
        dodges: this.dodges,
        damageTakenTotal: this.damageTakenTotal,
        timesDamaged: this.timesDamaged,
        lifeMotesAbsorbed: this.lifeMotesAbsorbed,
        lifeMoteHealTotal: this.lifeMoteHealTotal,
        lifeMotesExpired: this.lifeMotesExpired,
      },
      kills: {
        weapon: this.killsWeapon,
        execution: this.killsExecution,
        spell: this.killsSpell,
        friendlyFire: this.killsFriendlyFire,
        total: this.killsWeapon + this.killsExecution + this.killsSpell,
      },
      weakPoints: {
        hits: this.weakPointHits, damage: this.weakPointDamage, broken: this.weakPointsBroken,
        exposuresClosed: this.exposuresClosed, exposureHits: this.exposureHits, dazes: this.dazes,
        chargeDodges: this.chargeDodges, limps: this.limps, blinds: this.blinds, topples: this.topples, pillarHits: this.pillarHits, backflows: this.backflows,
      },
      boss: {
        phaseShifts: this.bossPhaseShifts,
        phaseSkips: this.bossPhaseSkips,
        phaseSeconds: Object.fromEntries(Object.entries(this.bossPhaseTicks).map(([k, t]) => [k, Math.round(t / balance.loop.tickRate)])),
        platesBroken: this.platesBroken,
        plateGold: this.plateGold,
        roars: this.roars,
        roarHits: this.roarHits,
        combos: this.combos,
        exhausts: this.exhausts,
        chainTurns: this.chainTurns,
      },
      hazards: {
        pools: this.poolsSpawned, evaporated: this.poolsEvaporated, corrosiveApplied: this.corrosiveApplied, corrosiveDamage: round2(this.corrosiveDamage) ?? 0,
        pendingIn: this.corrosivePendingIn, ventCleanse: this.ventCleanse, chokes: this.chokes,
      },
      pickups: {
        potions: this.potionsPicked,
        healed: this.healedTotal,
        gold: this.goldCollected,
        xp: this.xpGained,
      },
      shieldsBroken: this.shieldsBroken,
      ammo: {
        shotsFired: this.shotsFired,
        shotsHit: this.shotsHit,
        altarEntries: this.altarEntries,
        altarBypasses: this.altarBypasses,
      },
      mana: {
        gained: round2(this.manaGained) ?? 0,
        decayed: round2(this.manaDecayed) ?? 0,
        lostToFail: round2(this.manaLostToFail) ?? 0,
      },
      traps: {
        triggered: this.trapsTriggered,
        hitsPlayer: this.trapHitsPlayer,
        hitsEnemy: this.trapHitsEnemy,
        kills: this.trapKills,
        disarms: this.trapDisarms,
        parried: this.trapParried,
        deaths: this.trapDeaths,
      },
      loot: {
        pouches: this.lootPouches,
        opened: this.lootOpened,
        revealed: this.lootRevealed,
        taken: this.lootTaken,
        stashed: this.lootStashed,
        dropped: this.lootDropped,
        deniedFull: this.lootDeniedFull,
        interrupted: this.lootInterrupted,
      },
      derived: {
        ammoLeftRatioAtAltar: round2(avg(this.ammoLeftRatios)),
        altarBypassRatio: round2(ratio(this.altarBypasses, altarTouches)),
        parryAttemptsPerEncounter: round2(ratio(attempts, this.encounters)),
        perfectParryRatio: round2(ratio(this.parryPerfect, attempts)),
        parrySuccessRatio: round2(ratio(this.parryPerfect + this.parryNormal, attempts)),
        manaWasteRatio: round2(ratio(this.manaDecayed, this.manaGained)),
        chainTier3ReachRatio: round2(ratio(this.tier3Encounters, this.encounters)),
        shotAccuracy: round2(ratio(this.shotsHit, this.shotsFired)),
      },
      targets: balance.metrics.targets,
    };
  }
}

function round2(value: number | null): number | null {
  return value === null ? null : Math.round(value * 100) / 100;
}
