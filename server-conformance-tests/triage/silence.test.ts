// conformance tests of triage:assess-silence
import { describe, it, expect } from "vitest";
import {
  RISK_TIERS,
  assessCheckIn,
  assessSilence,
  checkInSlots,
} from "protocols";
import type { Assessment, CheckIn, Protocol, RiskTier } from "protocols";
import { at, makeCheckIn, makePatient, protocolOf } from "./helpers.js";

function silence(protocol: Protocol, checkIns: CheckIn[], now: Date | string) {
  return assessSilence({
    patient: makePatient(protocol),
    protocol,
    checkIns,
    now,
    assessmentId: "as-s",
    alertId: "al-s",
  });
}

describe("triage:assess-silence", () => {
  // conformance scenario t4-silence of triage:assess-silence
  it("T4: two days without a check-in gives RED for MEDIUM; one missed day gives RED for HIGH", () => {
    const med = protocolOf("MEDIUM");
    const pm = makePatient(med);
    const medIns = [1, 2, 3].map((d) => makeCheckIn(med, pm, d));
    // day-4 slot due at(4); two days later
    const m = silence(med, medIns, at(6));
    expect(m, "MEDIUM after two silent days").not.toBeNull();
    expect(m?.assessment.status, JSON.stringify(m)).toBe("RED");
    expect(m?.assessment.checkInId).toBeUndefined();
    expect(m?.assessment.reasons.map((x) => x.ruleId)).toEqual(["R5"]);
    expect(m?.alert?.id).toBe("al-s");
    expect(m?.alert?.recipientRole).toBe("NURSE");

    const high = protocolOf("HIGH");
    const ph = makePatient(high);
    const highIns = [1, 2, 3].flatMap((d) => [
      makeCheckIn(high, ph, d, {}, 9),
      makeCheckIn(high, ph, d, {}, 21),
    ]);
    const h = silence(high, highIns, at(5));
    expect(h, "HIGH after one missed day").not.toBeNull();
    expect(h?.assessment.status, JSON.stringify(h)).toBe("RED");
    expect(h?.assessment.reasons.map((x) => x.ruleId)).toEqual(["R5"]);
    expect(h?.alert).toBeDefined();
  });

  // conformance scenario t5-reason-rule-id of triage:assess-silence
  it("T5: every Assessment has at least one reason with a ruleId", () => {
    const assessments: Assessment[] = [];
    const med = protocolOf("MEDIUM");
    const pm = makePatient(med);
    const ins = [1, 2, 3].map((d) => makeCheckIn(med, pm, d, { pain: 5 }));
    for (const ci of ins) {
      assessments.push(
        assessCheckIn({
          checkIn: ci,
          history: [],
          protocol: med,
          patient: pm,
          now: ci.timestamp,
          assessmentId: `a-${ci.id}`,
          alertId: "x",
        }).assessment,
      );
    }
    assessments.push(
      assessCheckIn({
        checkIn: makeCheckIn(med, pm, 4, { temperatureC: 38.6 }),
        history: ins,
        protocol: med,
        patient: pm,
        now: at(4),
        assessmentId: "a-red",
        alertId: "x",
      }).assessment,
    );
    for (const now of [at(5), at(6)]) {
      const s = silence(med, ins, now);
      if (s) assessments.push(s.assessment);
    }
    expect(assessments.length).toBeGreaterThanOrEqual(6);
    for (const a of assessments) {
      expect(a.reasons.length, JSON.stringify(a)).toBeGreaterThanOrEqual(1);
      for (const r of a.reasons) {
        expect(r.ruleId, JSON.stringify(a)).toMatch(/^R[0-5]$/);
      }
    }
  });

  // conformance scenario t14-risk-tier of triage:assess-silence
  it("T14: the risk tier sets check-in frequency, duration and silence escalation speed", () => {
    const tiers: RiskTier[] = ["HIGH", "MEDIUM", "LOW"];
    for (const tier of tiers) {
      const settings = RISK_TIERS[tier];
      const protocol = protocolOf(tier);
      expect(protocol.durationDays, tier).toBe(settings.durationDays);
      const slots = checkInSlots(protocol, makePatient(protocol));
      const expected: Record<number, number> = {};
      for (const e of settings.checkInSchedule) {
        if ("perDay" in e) {
          for (let d = e.fromDay; d <= e.toDay; d++) expected[d] = e.perDay;
        } else {
          for (const d of e.days) expected[d] = 1;
        }
      }
      const actual: Record<number, number> = {};
      for (const s of slots) actual[s.day] = (actual[s.day] ?? 0) + 1;
      expect(actual, `${tier} slots per day`).toEqual(expected);
      expect(Math.max(...slots.map((s) => s.day)), tier).toBeLessThanOrEqual(
        settings.durationDays,
      );
    }
    expect(RISK_TIERS.HIGH.checkInSchedule.length).toBeGreaterThan(0);

    // silence escalation: first slot (day 1, at(1)) missed, no check-ins
    for (const tier of tiers) {
      const { yellowAfterHours, redAfterHours } = RISK_TIERS[tier].silence;
      const protocol = protocolOf(tier);
      const due = Date.parse(at(1));
      const iso = (h: number) => new Date(due + h * 3600_000);
      const before = silence(protocol, [], iso(yellowAfterHours - 1));
      expect(before, `${tier} before yellowAfterHours`).toBeNull();
      const y = silence(protocol, [], iso(yellowAfterHours));
      expect(y?.assessment.status, `${tier} at yellowAfterHours`).toBe(
        "YELLOW",
      );
      expect(y?.alert).toBeUndefined();
      const r = silence(protocol, [], iso(redAfterHours));
      expect(r?.assessment.status, `${tier} at redAfterHours`).toBe("RED");
      expect(r?.alert).toBeDefined();
    }
  });
});
