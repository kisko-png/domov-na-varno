import { describe, expect, it } from "vitest";
import { getProtocol } from "./protocols.js";
import { buildSeed } from "./seed.js";
import type { CheckIn } from "./seed.js";
import {
  assessCheckIn,
  deviation,
  rulePainCurve,
  rulePainJump,
  ruleRedFlag,
  ruleTemperature,
} from "./triage.js";

const NOW = "2026-03-10T09:00:00+01:00";
const seed = buildSeed(NOW);
const patient = seed.patients[0]!;
const protocol = getProtocol("hip-replacement");

function ci(over: Partial<CheckIn> = {}): CheckIn {
  return {
    id: "chk-x",
    patientId: patient.id,
    protocolVersion: "1.0.0",
    dayAfterDischarge: 3,
    timestamp: NOW,
    wellbeing: 3,
    pain: 5,
    symptoms: [],
    filledBy: "PATIENT",
    ...over,
  };
}

function assess(c: CheckIn) {
  return assessCheckIn({
    checkIn: c,
    history: [],
    protocol,
    patient,
    now: NOW,
    assessmentId: "as-1",
    alertId: "al-1",
  });
}

describe("assessCheckIn", () => {
  it("is GREEN with one R0 reason and no alert when nothing triggers", () => {
    const r = assess(ci({ temperatureC: 37.9 }));
    expect(r.assessment).toEqual({
      id: "as-1",
      patientId: patient.id,
      checkInId: "chk-x",
      status: "GREEN",
      reasons: [{ ruleId: "R0", text: expect.any(String) as string }],
      createdAt: "2026-03-10T09:00:00+01:00",
    });
    expect(r.alert).toBeUndefined();
  });

  it("is YELLOW without alert for a moderate fever", () => {
    const r = assess(ci({ temperatureC: 38.0 }));
    expect(r.assessment.status).toBe("YELLOW");
    expect(r.assessment.reasons.map((x) => x.ruleId)).toEqual(["R2"]);
    expect(r.alert).toBeUndefined();
  });

  it("is RED with a NURSE alert, the most severe of its reasons", () => {
    const r = assess(ci({ temperatureC: 38.2, symptoms: ["chest-pain"] }));
    expect(r.assessment.status).toBe("RED");
    expect(r.assessment.reasons.map((x) => x.ruleId).sort()).toEqual([
      "R1",
      "R2",
    ]);
    expect(r.alert).toEqual({
      id: "al-1",
      assessmentId: "as-1",
      recipientRole: "NURSE",
      createdAt: "2026-03-10T09:00:00+01:00",
    });
  });
});

describe("ruleRedFlag (R1)", () => {
  it("adds a RED reason naming each red-flag symptom label", () => {
    const r = ruleRedFlag(
      ci({ symptoms: ["tiredness", "chest-pain", "calf-pain-swelling"] }),
      protocol,
    );
    expect(r).toHaveLength(2);
    expect(r.every((x) => x.status === "RED")).toBe(true);
    expect(r[0]!.reason.text).toContain("Bolečina v prsih");
    expect(r[1]!.reason.text).toContain("Bolečina ali oteklina v mečih");
  });

  it("ignores symptoms no red flag names", () => {
    expect(ruleRedFlag(ci({ symptoms: ["tiredness"] }), protocol)).toEqual([]);
  });
});

describe("ruleTemperature (R2)", () => {
  it.each([
    [37.9, []],
    [38.0, ["YELLOW"]],
    [38.4, ["YELLOW"]],
    [38.5, ["RED"]],
    [39.5, ["RED"]],
  ])("%s °C gives %j", (t, expected) => {
    expect(
      ruleTemperature(ci({ temperatureC: t })).map((x) => x.status),
    ).toEqual(expected);
  });

  it("triggers nothing without temperatureC", () => {
    expect(ruleTemperature(ci())).toEqual([]);
  });

  it.each([38.25, 38.04, 39.55])("shows %s \u00b0C unrounded", (t) => {
    const [r] = ruleTemperature(ci({ temperatureC: t }));
    expect(r?.reason.text).toContain(`${String(t)} \u00b0C`);
  });
});

describe("rulePainCurve (R3)", () => {
  // hip day 3: expected pain 5, wellbeing 3, painTolerance 2
  const status = (c: CheckIn, h: CheckIn[] = []) =>
    rulePainCurve(c, h, protocol).map((r) => [r.reason.ruleId, r.status]);

  it("computes the deviation", () => {
    expect(deviation(ci({ pain: 8, wellbeing: 1 }), protocol)).toEqual({
      pain: 3,
      wellbeing: 2,
    });
  });

  it("is silent at the tolerance and YELLOW above it", () => {
    expect(status(ci({ pain: 7 }))).toEqual([]);
    expect(status(ci({ pain: 8 }))).toEqual([["R3", "YELLOW"]]);
    expect(status(ci({ pain: 9 }))).toEqual([["R3", "YELLOW"]]);
  });

  it("is RED above twice the tolerance", () => {
    expect(status(ci({ pain: 10 }))).toEqual([["R3", "RED"]]);
  });

  it("is YELLOW for wellbeing 2 or more below expected", () => {
    expect(status(ci({ wellbeing: 2 }))).toEqual([]);
    expect(status(ci({ wellbeing: 1 }))).toEqual([["R3", "YELLOW"]]);
  });

  it("turns pain YELLOW RED when the day before also deviated", () => {
    // day 2 expected pain 6: 9 deviates by 3
    const prev = ci({ id: "p", dayAfterDischarge: 2, pain: 9 });
    expect(status(ci({ pain: 8 }), [prev])).toEqual([["R3", "RED"]]);
    const ok = ci({ id: "p", dayAfterDischarge: 2, pain: 8 });
    expect(status(ci({ pain: 8 }), [ok])).toEqual([["R3", "YELLOW"]]);
    const older = ci({ id: "p", dayAfterDischarge: 1, pain: 9 });
    expect(status(ci({ pain: 8 }), [older])).toEqual([["R3", "YELLOW"]]);
  });

  it("turns wellbeing YELLOW RED when the day before also deviated", () => {
    const prev = ci({ id: "p", dayAfterDischarge: 2, wellbeing: 1 });
    expect(status(ci({ wellbeing: 1 }), [prev])).toEqual([["R3", "RED"]]);
    const ok = ci({ id: "p", dayAfterDischarge: 2, wellbeing: 2 });
    expect(status(ci({ wellbeing: 1 }), [ok])).toEqual([["R3", "YELLOW"]]);
  });

  it("feeds assessCheckIn", () => {
    const r = assess(ci({ pain: 10 }));
    expect(r.assessment.status).toBe("RED");
    expect(r.assessment.reasons.map((x) => x.ruleId)).toEqual(["R3"]);
    expect(r.alert).toBeDefined();
  });
});

describe("rulePainJump (R4)", () => {
  const at = (iso: string, pain: number) =>
    ci({ id: iso, timestamp: iso, pain });

  it("is YELLOW for a jump of 3 within the 24 hours before", () => {
    const r = rulePainJump(ci({ pain: 6 }), [
      at("2026-03-09T10:00:00+01:00", 3),
    ]);
    expect(r.map((x) => [x.reason.ruleId, x.status])).toEqual([
      ["R4", "YELLOW"],
    ]);
  });

  it("ignores a jump of 2, and check-ins older than 24 hours", () => {
    expect(
      rulePainJump(ci({ pain: 5 }), [at("2026-03-09T10:00:00+01:00", 3)]),
    ).toEqual([]);
    expect(
      rulePainJump(ci({ pain: 6 }), [at("2026-03-09T08:59:00+01:00", 3)]),
    ).toEqual([]);
    expect(rulePainJump(ci({ pain: 6 }), [])).toEqual([]);
  });

  it("feeds assessCheckIn as YELLOW", () => {
    const r = assessCheckIn({
      checkIn: ci({ pain: 6 }),
      history: [at("2026-03-10T01:00:00+01:00", 3)],
      protocol,
      patient,
      now: NOW,
      assessmentId: "as-1",
      alertId: "al-1",
    });
    expect(r.assessment.status).toBe("YELLOW");
    expect(r.assessment.reasons.map((x) => x.ruleId)).toEqual(["R4"]);
  });
});
