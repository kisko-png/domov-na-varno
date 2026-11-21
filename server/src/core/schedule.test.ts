import { describe, expect, it } from "vitest";
import { getProtocol } from "./protocols.js";
import { checkInSlots, dayAfterDischarge, expectedForDay } from "./schedule.js";
import type { Patient } from "./seed.js";

const patient = (dischargeDate: string): Patient => ({
  id: "pat-x",
  name: "Test",
  phone: "+386 40 000 000",
  dischargeDate,
  protocolId: "x",
  reportId: "rep-x",
  preferredCheckInTime: "09:00",
  accessToken: "tok-x",
});

describe("expectedForDay", () => {
  const hip = getProtocol("hip-replacement");
  it("returns the curve values of the day and the tolerance", () => {
    expect(expectedForDay(hip, 7)).toEqual({
      pain: 3.5,
      wellbeing: 3.5,
      painTolerance: 2,
    });
    expect(
      expectedForDay(getProtocol("cardiac-surgery"), 3).painTolerance,
    ).toBe(1);
  });
  it("clamps before day 1 and after the last day", () => {
    expect(expectedForDay(hip, 0)).toEqual({
      pain: 6,
      wellbeing: 3,
      painTolerance: 2,
    });
    expect(expectedForDay(hip, -3).pain).toBe(6);
    expect(expectedForDay(hip, 40)).toEqual({
      pain: 2,
      wellbeing: 4,
      painTolerance: 2,
    });
  });
});

describe("dayAfterDischarge", () => {
  it("counts LocalDays in Ljubljana", () => {
    expect(dayAfterDischarge("2025-03-01", "2025-03-01T10:00:00+01:00")).toBe(
      0,
    );
    expect(dayAfterDischarge("2025-03-01", "2025-03-01T23:30:00Z")).toBe(1);
    expect(
      dayAfterDischarge("2025-03-01", new Date("2025-03-31T12:00:00Z")),
    ).toBe(30);
    expect(dayAfterDischarge("2025-03-05", "2025-03-01T12:00:00Z")).toBe(-4);
  });
  it("rejects an invalid discharge date", () => {
    expect(() => dayAfterDischarge("bad", "2025-03-01T10:00:00Z")).toThrow();
  });
});

describe("checkInSlots", () => {
  it("gives HIGH two slots on days 1-3, 12 hours apart, then one to day 30", () => {
    const s = checkInSlots(
      getProtocol("cardiac-surgery"),
      patient("2025-03-01"),
    );
    expect(s).toHaveLength(33);
    expect(s[0]).toEqual({
      day: 1,
      index: 1,
      dueAt: "2025-03-02T09:00:00+01:00",
    });
    expect(s[1]).toEqual({
      day: 1,
      index: 2,
      dueAt: "2025-03-02T21:00:00+01:00",
    });
    expect(s[6]).toEqual({
      day: 4,
      index: 1,
      dueAt: "2025-03-05T09:00:00+01:00",
    });
    expect(s.at(-1)?.day).toBe(30);
    expect(s.find((x) => x.day === 29)?.dueAt).toBe(
      "2025-03-30T09:00:00+02:00",
    );
  });
  it("gives MEDIUM one slot on days 1 to 14", () => {
    const s = checkInSlots(
      getProtocol("hip-replacement"),
      patient("2025-03-01"),
    );
    expect(s.map((x) => x.day)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14,
    ]);
    expect(s.every((x) => x.index === 1)).toBe(true);
  });
  it("gives LOW days 1-7 then 8, 10, 12", () => {
    const s = checkInSlots(
      getProtocol("minor-abdominal-surgery"),
      patient("2025-03-01"),
    );
    expect(s.map((x) => x.day)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 10, 12]);
  });
});
