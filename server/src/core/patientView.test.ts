import { describe, expect, it } from "vitest";
import { currentSlot } from "./patientView.js";
import { getProtocol } from "./protocols.js";
import { checkInSlots } from "./schedule.js";
import { buildSeed, type CheckIn } from "./seed.js";

const seed = buildSeed("2026-11-21T07:00:00Z");
const patient = seed.patients[0]!;
const protocol = getProtocol(patient.protocolId);
const slots = checkInSlots(protocol, patient);

describe("currentSlot", () => {
  it("skips an uncovered slot due before the latest check-in", () => {
    const day1 = slots[0]!;
    const day2 = slots[1]!;
    const late: CheckIn = {
      id: "chk-x",
      patientId: patient.id,
      protocolVersion: protocol.version,
      dayAfterDischarge: 2,
      timestamp: day2.dueAt,
      wellbeing: 3,
      pain: 5,
      symptoms: [],
      filledBy: "PATIENT",
    };
    const now = Date.parse(day2.dueAt) + 3600_000;
    // Day 1 was never covered, but it is due before the latest check-in.
    expect(currentSlot(protocol, patient, [], new Date(now))).toEqual(day1);
    expect(currentSlot(protocol, patient, [late], new Date(now))).toEqual(
      slots[2],
    );
  });
});
