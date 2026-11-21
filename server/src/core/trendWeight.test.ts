import { describe, expect, it } from "vitest";
import { getProtocol } from "./protocols.js";
import { buildSeed, type CheckIn } from "./seed.js";
import { assessCheckIn, ruleTrend, ruleWeight } from "./triage.js";

const NOW = "2026-03-10T09:00:00+01:00";
const patient = buildSeed(NOW).patients[0]!;
const hip = getProtocol("hip-replacement");
const cardiac = getProtocol("cardiac-surgery");

function ci(over: Partial<CheckIn> = {}): CheckIn {
  return {
    id: "chk-x",
    patientId: patient.id,
    protocolVersion: "1.1.0",
    dayAfterDischarge: 3,
    timestamp: NOW,
    wellbeing: 3,
    pain: 5,
    symptoms: [],
    filledBy: "PATIENT",
    ...over,
  };
}

const earlier = (hoursBefore: number, over: Partial<CheckIn> = {}): CheckIn =>
  ci({
    id: `h-${hoursBefore}`,
    timestamp: new Date(Date.parse(NOW) - hoursBefore * 3600000).toISOString(),
    dayAfterDischarge: 3 - Math.ceil(hoursBefore / 24),
    ...over,
  });

describe("rule R6 trend", () => {
  it("triggers nothing without trends", () => {
    expect(ruleTrend(ci(), [earlier(24, { painTrend: "WORSE" })], hip)).toEqual(
      [],
    );
  });

  it("WORSE alone triggers nothing; after WORSE or MUCH_WORSE it is YELLOW", () => {
    expect(ruleTrend(ci({ painTrend: "WORSE" }), [], hip)).toEqual([]);
    expect(
      ruleTrend(
        ci({ painTrend: "WORSE" }),
        [earlier(24, { painTrend: "BETTER" })],
        hip,
      ),
    ).toEqual([]);
    const r = ruleTrend(
      ci({ painTrend: "WORSE" }),
      [earlier(24, { painTrend: "MUCH_WORSE" })],
      hip,
    );
    expect(r.map((x) => [x.status, x.reason.ruleId])).toEqual([
      ["YELLOW", "R6"],
    ]);
    expect(r[0]!.reason.text).toContain("Bolečina");
  });

  it("uses only the latest history check-in", () => {
    const r = ruleTrend(
      ci({ wellbeingTrend: "WORSE" }),
      [
        earlier(24, { wellbeingTrend: "WORSE" }),
        earlier(48, { wellbeingTrend: "SAME" }),
      ],
      hip,
    );
    expect(r).toHaveLength(1);
    expect(r[0]!.reason.text).toContain("Počutje");
    expect(
      ruleTrend(
        ci({ wellbeingTrend: "WORSE" }),
        [
          earlier(48, { wellbeingTrend: "WORSE" }),
          earlier(24, { wellbeingTrend: "SAME" }),
        ],
        hip,
      ),
    ).toEqual([]);
  });

  it("MUCH_WORSE is YELLOW, RED in the HIGH tier, one reason per trend", () => {
    const h = [earlier(24, { painTrend: "WORSE", wellbeingTrend: "WORSE" })];
    const c = ci({ painTrend: "MUCH_WORSE", wellbeingTrend: "MUCH_WORSE" });
    expect(ruleTrend(c, h, hip).map((x) => x.status)).toEqual([
      "YELLOW",
      "YELLOW",
    ]);
    expect(ruleTrend(c, h, cardiac).map((x) => x.status)).toEqual([
      "RED",
      "RED",
    ]);
  });

  it("is wired into assessCheckIn", () => {
    const r = assessCheckIn({
      checkIn: ci({ painTrend: "MUCH_WORSE" }),
      history: [],
      protocol: cardiac,
      patient,
      now: NOW,
      assessmentId: "a",
      alertId: "b",
    });
    expect(r.assessment.reasons.map((x) => x.ruleId)).toContain("R6");
    expect(r.alert).toBeDefined();
  });
});

describe("rule R7 weight", () => {
  const w = (kg: number) => ({ measurements: { weightKg: kg } });

  it("triggers nothing without weightKg", () => {
    expect(ruleWeight(ci(), [earlier(24, w(80))])).toEqual([]);
  });

  it("YELLOW for 1 kg over the day before, not 0.9 kg", () => {
    const r = ruleWeight(ci(w(81.4)), [earlier(24, w(80.4))]);
    expect(r.map((x) => [x.status, x.reason.ruleId])).toEqual([
      ["YELLOW", "R7"],
    ]);
    expect(r[0]!.reason.text).toContain("1,0 kg");
    expect(ruleWeight(ci(w(81.3)), [earlier(24, w(80.4))])).toEqual([]);
  });

  it("YELLOW for 2 kg within 7 days, not 1.5 kg or older than 7 days", () => {
    const r = ruleWeight(ci(w(82.5)), [earlier(120, w(80.5))]);
    expect(r).toHaveLength(1);
    expect(r[0]!.reason.text).toContain("2,0 kg");
    expect(ruleWeight(ci(w(82)), [earlier(120, w(80.5))])).toEqual([]);
    expect(ruleWeight(ci(w(85)), [earlier(24 * 7 + 1, w(80))])).toEqual([]);
  });

  it("gives one reason with the largest gain", () => {
    const r = ruleWeight(ci(w(84)), [earlier(24, w(83)), earlier(72, w(81))]);
    expect(r).toHaveLength(1);
    expect(r[0]!.reason.text).toContain("3,0 kg");
  });

  it("is wired into assessCheckIn as YELLOW", () => {
    const r = assessCheckIn({
      checkIn: ci(w(82)),
      history: [earlier(24, w(80))],
      protocol: cardiac,
      patient,
      now: NOW,
      assessmentId: "a",
      alertId: "b",
    });
    expect(r.assessment.status).toBe("YELLOW");
    expect(r.assessment.reasons.map((x) => x.ruleId)).toEqual(["R7"]);
  });
});
