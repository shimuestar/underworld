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
  pickups: { potions: number; healed: number; gold: number; xp: number };
  shieldsBroken: number;
  ammo: { shotsFired: number; shotsHit: number; altarEntries: number; altarBypasses: number };
  mana: { gained: number; decayed: number; lostToFail: number };
  /** 함정 — 작동 / 플레이어 피격 / 적 피격 / 함정 처치 / 해체 / 진자 패링 / 함정 사망 */
  traps: {
    triggered: number; hitsPlayer: number; hitsEnemy: number; kills: number;
    disarms: number; parried: number; deaths: number;
  };
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
  private potionsPicked = 0;
  private healedTotal = 0;
  private goldCollected = 0;
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
    // 소모품은 이제 줍는 순간이 아니라 마시는 순간을 센다 (가방을 거치므로)
    events.on('item_used', (payload) => {
      this.potionsPicked++;
      this.healedTotal += (payload as { healed: number }).healed;
    });
    events.on('gold_picked', (payload) => {
      this.goldCollected += (payload as { amount: number }).amount;
    });
    // 함정 — 시스템 안에 카운터를 두지 않는다 (CLAUDE.md 4). 전부 이벤트 구독
    events.on('trap_triggered', () => this.trapsTriggered++);
    events.on('trap_hit_player', () => this.trapHitsPlayer++);
    events.on('trap_hit_enemy', () => this.trapHitsEnemy++);
    events.on('trap_kill', () => this.trapKills++);
    events.on('trap_disarmed', () => this.trapDisarms++);
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
