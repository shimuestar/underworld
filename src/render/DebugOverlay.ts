// F1 디버그 오버레이 — 실시간 계측 지표 표시. 표시 전용, 게임 로직 금지.

import type { MetricsSnapshot } from '../core/Metrics';

export class DebugOverlay {
  private readonly el: HTMLPreElement;
  visible = false;

  constructor() {
    this.el = document.createElement('pre');
    this.el.style.cssText =
      'position:fixed;top:8px;left:50%;transform:translateX(-50%);display:none;' +
      'background:rgba(8,8,12,0.88);border:1px solid #3a3a44;color:#cfd2da;' +
      'font:11px/1.55 monospace;padding:10px 16px;margin:0;z-index:20;pointer-events:none;';
    document.body.appendChild(this.el);
  }

  toggle(): void {
    this.visible = !this.visible;
    this.el.style.display = this.visible ? 'block' : 'none';
  }

  update(s: MetricsSnapshot): void {
    const d = s.derived;
    const t = s.targets;
    const fmt = (v: number | null): string => (v === null ? '—' : String(v));
    const mark = (v: number | null, target: number, lowerIsBetter: boolean): string => {
      if (v === null) return ' ';
      const ok = lowerIsBetter ? v <= target : v >= target;
      return ok ? '✓' : '✗';
    };
    this.el.textContent =
      `── 계측 (F1 닫기 · F2 JSON 덤프) ─ ${s.session.seconds}s · 사망 ${s.session.deaths}${s.session.cleared ? ' · 클리어' : ''}\n` +
      `제단 잔탄율   ${fmt(d.ammoLeftRatioAtAltar)}  (목표 ≤${t.ammoLeftRatioAtAltar}) ${mark(d.ammoLeftRatioAtAltar, t.ammoLeftRatioAtAltar, true)}\n` +
      `제단 우회율   ${fmt(d.altarBypassRatio)}  (목표 ≤${t.altarBypassRatio}) ${mark(d.altarBypassRatio, t.altarBypassRatio, true)}\n` +
      `교전당 패링   ${fmt(d.parryAttemptsPerEncounter)}  (목표 ≈${t.parryAttemptsPerEncounter})\n` +
      `완벽 패링률   ${fmt(d.perfectParryRatio)}  (목표 ≥${t.perfectParryRatio}) ${mark(d.perfectParryRatio, t.perfectParryRatio, false)}\n` +
      `패링 성공률   ${fmt(d.parrySuccessRatio)}   시도 ${s.combat.parryAttempts} (완${s.combat.parryPerfect}/일${s.combat.parryNormal}/실${s.combat.parryFail})\n` +
      `마나 휘발률   ${fmt(d.manaWasteRatio)}  (목표 ≤${t.manaWasteRatio}) ${mark(d.manaWasteRatio, t.manaWasteRatio, true)}  획득 ${s.mana.gained} 휘발 ${s.mana.decayed}\n` +
      `연쇄3 도달률  ${fmt(d.chainTier3ReachRatio)}  (목표 ≥${t.chainTier3ReachRatio}) ${mark(d.chainTier3ReachRatio, t.chainTier3ReachRatio, false)}\n` +
      `명중률 ${fmt(d.shotAccuracy)} (${s.ammo.shotsHit}/${s.ammo.shotsFired})   처치 총${s.kills.weapon}/처형${s.kills.execution}/마법${s.kills.spell}   교전 ${s.combat.encounters}   반사 ${s.combat.deflects}\n` +
      `피격 ${s.combat.timesDamaged}회 ${s.combat.damageTakenTotal}dmg   오염 ${s.session.corruptionApplied}(+${s.session.corruptionPending})`;
  }
}
