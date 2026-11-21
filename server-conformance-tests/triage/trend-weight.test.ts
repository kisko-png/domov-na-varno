// conformance tests of triage:rule-trend
// conformance tests of triage:rule-weight
import { describe, expect, it } from "vitest";
import { assessCheckIn, expectedForDay } from "protocols";
import type { CheckIn, Protocol } from "protocols";
import { at, makeCheckIn, makePatient, protocolOf } from "./helpers.js";

const HIP = protocolOf("MEDIUM");
const CARDIAC = protocolOf("HIGH");

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

function onCurve(protocol: Protocol, day: number, f: Partial<CheckIn> = {}) {
  const e = expectedForDay(protocol, day);
  return makeCheckIn(protocol, makePatient(protocol), day, {
    pain: Math.floor(e.pain),
    wellbeing: Math.ceil(e.wellbeing),
    ...f,
  });
}

function rule(r: ReturnType<typeof assess>, id: string) {
  return r.assessment.reasons.filter((x) => x.ruleId === id);
}

describe("triage:rule-trend", () => {
  // conformance scenario worse-twice-yellow of triage:rule-trend
  it("worse-twice-yellow", () => {
    const cur = onCurve(HIP, 5, { painTrend: "WORSE" });
    const r = assess(HIP, cur, [onCurve(HIP, 4, { painTrend: "WORSE" })]);
    const ctx = JSON.stringify(r.assessment);
    expect(rule(r, "R6").length, ctx).toBeGreaterThan(0);
    expect(["YELLOW", "RED"], ctx).toContain(r.assessment.status);
    const r2 = assess(HIP, cur, [onCurve(HIP, 4, { painTrend: "SAME" })]);
    expect(rule(r2, "R6"), JSON.stringify(r2.assessment)).toEqual([]);
  });

  // conformance scenario much-worse-by-tier of triage:rule-trend
  it("much-worse-by-tier", () => {
    const hip = assess(HIP, onCurve(HIP, 5, { wellbeingTrend: "MUCH_WORSE" }));
    let ctx = JSON.stringify(hip);
    expect(rule(hip, "R6").length, ctx).toBe(1);
    expect(hip.assessment.status, ctx).toBe("YELLOW");
    const car = assess(
      CARDIAC,
      onCurve(CARDIAC, 5, { wellbeingTrend: "MUCH_WORSE" }),
    );
    ctx = JSON.stringify(car);
    expect(rule(car, "R6").length, ctx).toBe(1);
    expect(car.assessment.status, ctx).toBe("RED");
    expect(car.alert?.recipientRole, ctx).toBe("NURSE");
  });

  // conformance scenario no-trend-first-check-in of triage:rule-trend
  it("no-trend-first-check-in", () => {
    const r = assess(HIP, onCurve(HIP, 1), []);
    expect(rule(r, "R6"), JSON.stringify(r.assessment)).toEqual([]);
  });
});

describe("triage:rule-weight", () => {
  const w = (day: number, kg: number) =>
    onCurve(CARDIAC, day, { measurements: { weightKg: kg } });

  // conformance scenario gain-since-yesterday of triage:rule-weight
  it("gain-since-yesterday", () => {
    const r = assess(CARDIAC, w(5, 81.0), [w(4, 80.0)]);
    const r7 = rule(r, "R7");
    expect(r7.length, JSON.stringify(r.assessment)).toBe(1);
    expect(r.assessment.status, JSON.stringify(r.assessment)).toBe("YELLOW");
    const r2 = assess(CARDIAC, w(5, 81.0), [w(4, 80.5)]);
    expect(rule(r2, "R7"), JSON.stringify(r2.assessment)).toEqual([]);
  });

  // conformance scenario gain-within-week of triage:rule-weight
  it("gain-within-week", () => {
    const r = assess(CARDIAC, w(8, 82.0), [w(3, 80.0), w(7, 81.5)]);
    expect(rule(r, "R7").length, JSON.stringify(r.assessment)).toBe(1);
    expect(r.assessment.status, JSON.stringify(r.assessment)).toBe("YELLOW");
  });
});
