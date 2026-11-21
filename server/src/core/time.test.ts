import { describe, expect, it } from "vitest";
import {
  addDays,
  formatInstant,
  localDayOf,
  localTimeToMillis,
  toMillis,
} from "./time.js";
import { InvalidMomentError } from "../errors.js";

describe("time", () => {
  it("computes the Ljubljana LocalDay", () => {
    expect(localDayOf(Date.parse("2025-06-30T22:30:00Z"))).toBe("2025-07-01");
    expect(localDayOf(Date.parse("2025-01-31T22:30:00Z"))).toBe("2025-01-31");
  });
  it("adds days across months", () => {
    expect(addDays("2025-03-03", -8)).toBe("2025-02-23");
  });
  it("formats with offset including DST", () => {
    expect(formatInstant(localTimeToMillis("2025-01-10", "08:00"))).toBe(
      "2025-01-10T08:00:00+01:00",
    );
    expect(formatInstant(localTimeToMillis("2025-07-10", "08:00"))).toBe(
      "2025-07-10T08:00:00+02:00",
    );
    expect(localTimeToMillis("2025-03-30", "08:00")).toBe(
      Date.parse("2025-03-30T06:00:00Z"),
    );
  });
  it("rejects invalid moments", () => {
    expect(() => toMillis("nope")).toThrow(InvalidMomentError);
  });
});
