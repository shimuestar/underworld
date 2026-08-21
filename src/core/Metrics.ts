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
  };
  kills: { weapon: number; execution: number; spell: number; total: number };
  ammo: { shotsFired: number; shotsHit: number; altarEntries: number; altarBypasses: number };
  mana: { gained: number; decayed: number; lostToFail: number };
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
  private timesDamaged = 0;
  private killsWeapon = 0;
  private killsExecution = 0;
  private killsSpell = 0;
  private shotsFired = 0;
  private shotsHit = 0;
  private altarEntries = 0;
  private altarBypasses = 0;
  private ammoLeftRatios: number[] = [];
  private manaGained = 0;
  private manaDecayed = 0;
  private manaLostToFail = 0;
  private tier3Encounters = 0;
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

    events.on('weapon_kill', () => this.killsWeapon++);
    events.on('melee_kill', (payload) => {
      if ((payload as { execution?: boolean }).execution) this.killsExecution++;
    });
    events.on('boss_execute', () => this.killsExecution++); // 처형 타격도 시도로 집계
    events.on('spell_kill', () => this.killsSpell++);

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
      },
      kills: {
        weapon: this.killsWeapon,
        execution: this.killsExecution,
        spell: this.killsSpell,
        total: this.killsWeapon + this.killsExecution + this.killsSpell,
      },
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
