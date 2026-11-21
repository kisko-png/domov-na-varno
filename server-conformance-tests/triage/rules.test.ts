// conformance tests of triage:rule-red-flag
// conformance tests of triage:rule-temperature
// conformance tests of triage:rule-pain-curve
import { describe, it, expect } from "vitest";
import { assessCheckIn, expectedForDay, listProtocols } from "protocols";
import type { CheckIn, Protocol } from "protocols";
import { at, makeCheckIn, makePatient, protocolOf } from "./helpers.js";

function assess(protocol: Protocol, checkIn: CheckIn, history: CheckIn[] = []) {
  return assessCheckIn({
    checkIn,
    history,
    protocol,
    patient: makePatient(protocol),
    now: at(checkIn.dayAfterDischarge, 10),
    assessmentId: "as-1",
    alertId: "al-1",
  });
}

/** A check-in on the expected curve for its day. */
function onCurve(protocol: Protocol, day: number, f: Partial<CheckIn> = {}) {
  const e = expectedForDay(protocol, day);
  return makeCheckIn(protocol, makePatient(protocol), day, {
    pain: Math.floor(e.pain),
    wellbeing: Math.ceil(e.wellbeing),
    ...f,
  });
}

describe("triage:rule-red-flag", () => {
  // conformance scenario t1-red-flag-red-alert of triage:rule-red-flag
  it("T1: any check-in with a red flag yields RED and creates an Alert", () => {
    for (const protocol of listProtocols()) {
      for (const flag of protocol.redFlags) {
        const ctx = `${protocol.id} / ${flag.id}`;
        const r = assess(
          protocol,
          onCurve(protocol, 3, { symptoms: [flag.symptom] }),
        );
        expect(r.assessment.status, ctx).toBe("RED");
        expect(
          r.assessment.reasons.map((x) => x.ruleId),
          ctx,
        ).toContain("R1");
        expect(r.alert, ctx).toBeDefined();
        expect(r.alert?.id, ctx).toBe("al-1");
        expect(r.alert?.assessmentId, ctx).toBe("as-1");
        expect(r.alert?.recipientRole, ctx).toBe("NURSE");
      }
    }
  });
});

describe("triage:rule-temperature", () => {
  // conformance scenario t2-temperature of triage:rule-temperature
  it("T2: temperature 38.5 gives RED; 38.2 gives YELLOW", () => {
    const protocol = protocolOf("MEDIUM");
    const red = assess(protocol, onCurve(protocol, 3, { temperatureC: 38.5 }));
    expect(red.assessment.status, JSON.stringify(red)).toBe("RED");
    expect(red.assessment.reasons.map((x) => x.ruleId)).toContain("R2");
    expect(red.alert).toBeDefined();

    const yellow = assess(
      protocol,
      onCurve(protocol, 3, { temperatureC: 38.2 }),
    );
    expect(yellow.assessment.status, JSON.stringify(yellow)).toBe("YELLOW");
    const r2 = yellow.assessment.reasons.find((x) => x.ruleId === "R2");
    expect(r2, JSON.stringify(yellow)).toBeDefined();
    expect(yellow.alert).toBeUndefined();
  });
});

describe("triage:rule-pain-curve", () => {
  // conformance scenario t3-pain-tolerance of triage:rule-pain-curve
  it("T3: pain above tolerance on day 4 gives YELLOW; two consecutive days above twice the tolerance gives RED", () => {
    const protocol = protocolOf("MEDIUM");
    const tol = protocol.painTolerance;
    const e4 = expectedForDay(protocol, 4);
    const e3 = expectedForDay(protocol, 3);

    const yellowPain = Math.floor(e4.pain + tol) + 1; // > tol, <= 2*tol
    expect(yellowPain - e4.pain).toBeLessThanOrEqual(2 * tol);
    const y = assess(protocol, onCurve(protocol, 4, { pain: yellowPain }));
    expect(y.assessment.status, JSON.stringify(y)).toBe("YELLOW");
    expect(y.assessment.reasons.map((x) => x.ruleId)).toContain("R3");

    const p3 = Math.min(10, Math.floor(e3.pain + 2 * tol) + 1);
    const p4 = Math.min(10, Math.floor(e4.pain + 2 * tol) + 1);
    const day3 = onCurve(protocol, 3, { pain: p3 });
    const r = assess(protocol, onCurve(protocol, 4, { pain: p4 }), [day3]);
    expect(r.assessment.status, JSON.stringify(r)).toBe("RED");
    expect(r.assessment.reasons.map((x) => x.ruleId)).toContain("R3");
    expect(r.alert).toBeDefined();
  });
});
