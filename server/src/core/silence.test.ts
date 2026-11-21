import { describe, expect, it } from "vitest";
import { getProtocol } from "./protocols.js";
import { checkInSlots } from "./schedule.js";
import { buildSeed } from "./seed.js";
import type { CheckIn } from "./seed.js";
import { assessSilence } from "./triage.js";

const seed = buildSeed("2026-03-10T09:00:00+01:00");
const H = 3600000;

function setup(patientId: string, protocolId: string) {
  const patient = seed.patients.find((p) => p.id === patientId)!;
  const protocol = getProtocol(protocolId);
  const slots = checkInSlots(protocol, patient);
  const checkIns = seed.checkIns.filter((c) => c.patientId === patientId);
  return { patient, protocol, slots, checkIns };
}

function at(iso: string, hours: number): string {
  return new Date(Date.parse(iso) + hours * H).toISOString();
}

describe("assessSilence", () => {
  const hip = setup("pat-01", "hip-replacement");
  const day8 = hip.slots.find((s) => s.day === 8)!;
  const run = (now: string, checkIns: CheckIn[] = hip.checkIns) =>
    assessSilence({
      patient: hip.patient,
      protocol: hip.protocol,
      checkIns,
      now,
      assessmentId: "as-s",
      alertId: "al-s",
    });

  it("is null before the yellow threshold", () => {
    expect(run(at(day8.dueAt, 23.9))).toBeNull();
  });

  it("is null when every due slot is covered", () => {
    expect(run(at(hip.slots.find((s) => s.day === 7)!.dueAt, 30))).toBeNull();
  });

  it("is YELLOW without alert at yellowAfterHours", () => {
    const r = run(at(day8.dueAt, 24))!;
    expect(r.alert).toBeUndefined();
    expect(r.assessment.status).toBe("YELLOW");
    expect(r.assessment.id).toBe("as-s");
    expect(r.assessment.patientId).toBe("pat-01");
    expect(r.assessment).not.toHaveProperty("checkInId");
    expect(r.assessment.reasons).toEqual([
      { ruleId: "R5", text: expect.stringContaining("24") as string },
    ]);
  });

  it("is RED with a NURSE alert at redAfterHours, createdAt now with offset", () => {
    const now = at(day8.dueAt, 48);
    const r = run(now)!;
    expect(r.assessment.status).toBe("RED");
    expect(Date.parse(r.assessment.createdAt)).toBe(Date.parse(now));
    expect(r.assessment.createdAt).toMatch(/[+-]\d{2}:\d{2}$/);
    expect(r.alert).toEqual({
      id: "al-s",
      assessmentId: "as-s",
      recipientRole: "NURSE",
      createdAt: r.assessment.createdAt,
    });
  });

  it("counts the earliest uncovered slot after the latest check-in", () => {
    // pat-05 stopped after day 4: day 5 slot is the counted one
    const c = setup("pat-05", "cardiac-surgery");
    const day5 = c.slots.find((s) => s.day === 5)!;
    const r = assessSilence({
      patient: c.patient,
      protocol: c.protocol,
      checkIns: c.checkIns,
      now: at(day5.dueAt, 24),
      assessmentId: "a",
      alertId: "b",
    })!;
    expect(r.assessment.status).toBe("RED");
    expect(
      assessSilence({
        patient: c.patient,
        protocol: c.protocol,
        checkIns: c.checkIns,
        now: at(day5.dueAt, 12),
        assessmentId: "a",
        alertId: "b",
      })!.assessment.status,
    ).toBe("YELLOW");
  });

  it("treats a slot of index 2 as uncovered when its day has one check-in", () => {
    const c = setup("pat-05", "cardiac-surgery");
    const d1 = c.checkIns.filter((x) => x.dayAfterDischarge === 1);
    const first = d1[0]!;
    // only the first check-in of day 1, made before slot 2 is due
    const slot2 = c.slots.find((s) => s.day === 1 && s.index === 2)!;
    const r = assessSilence({
      patient: c.patient,
      protocol: c.protocol,
      checkIns: [first],
      now: at(slot2.dueAt, 12),
      assessmentId: "a",
      alertId: "b",
    });
    expect(r?.assessment.status).toBe("YELLOW");
    // a covered slot (day has 2 check-ins) is not counted even if due after latest
    const late = { ...first, id: "x", timestamp: at(slot2.dueAt, -13) };
    expect(
      assessSilence({
        patient: c.patient,
        protocol: c.protocol,
        checkIns: [first, late],
        now: at(slot2.dueAt, 11),
        assessmentId: "a",
        alertId: "b",
      }),
    ).toBeNull();
  });

  it("counts from the first slot when there are no check-ins", () => {
    const first = hip.slots[0]!;
    expect(run(at(first.dueAt, 48), [])?.assessment.status).toBe("RED");
  });
});
