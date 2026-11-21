import { describe, expect, it } from "vitest";
import {
  getProtocol,
  listProtocols,
  orderQuestions,
  toProtocol,
} from "./protocols.js";
import {
  DomovError,
  ProtocolFormatError,
  UnknownProtocolError,
} from "../errors.js";
import hip from "./protocols/hip-replacement.json" with { type: "json" };

describe("listProtocols", () => {
  it("returns the catalogue in order with tier settings", () => {
    const ps = listProtocols();
    expect(ps.map((p) => [p.id, p.riskTier])).toEqual([
      ["hip-replacement", "MEDIUM"],
      ["cardiac-surgery", "HIGH"],
      ["minor-abdominal-surgery", "LOW"],
    ]);
    expect(ps.map((p) => [p.durationDays, p.painTolerance])).toEqual([
      [14, 2],
      [30, 1],
      [14, 3],
    ]);
    expect(ps[1]?.checkInSchedule).toEqual([
      { fromDay: 1, toDay: 3, perDay: 2 },
      { fromDay: 4, toDay: 30, perDay: 1 },
    ]);
    expect(ps[2]?.checkInSchedule[1]).toEqual({
      fromDay: 8,
      toDay: 14,
      days: [8, 10, 12],
    });
  });
  it("keeps every field of the file", () => {
    const p = getProtocol("hip-replacement");
    const { checkInSchedule, durationDays, painTolerance, ...rest } = p;
    expect(rest).toEqual(hip);
    expect([checkInSchedule.length, durationDays, painTolerance]).toEqual([
      1, 14, 2,
    ]);
  });
  it("returns copies a caller cannot use to change the catalogue", () => {
    const p = getProtocol("cardiac-surgery");
    p.questions.length = 0;
    expect(getProtocol("cardiac-surgery").questions.length).toBe(12);
  });
});

describe("getProtocol", () => {
  it("throws UnknownProtocolError for an unknown id", () => {
    expect(() => getProtocol("knee")).toThrow(UnknownProtocolError);
    expect(() => getProtocol("knee")).toThrow(DomovError);
  });
});

describe("toProtocol", () => {
  it("rejects malformed files", () => {
    expect(() => toProtocol(null)).toThrow(ProtocolFormatError);
    expect(() => toProtocol({ ...hip, riskTier: "X" })).toThrow(
      ProtocolFormatError,
    );
    expect(() => toProtocol({ ...hip, questions: 1 })).toThrow(
      ProtocolFormatError,
    );
  });
});

describe("question order", () => {
  it("orders questions RED_FLAG, SYMPTOM, MEASUREMENT, stable within a kind", () => {
    const rank = { RED_FLAG: 0, SYMPTOM: 1, MEASUREMENT: 2 } as const;
    for (const p of listProtocols()) {
      const ranks = p.questions.map((q) => rank[q.kind]);
      expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    }
    expect(
      orderQuestions([
        { id: "m", label: "m", kind: "MEASUREMENT" },
        { id: "s1", label: "s", kind: "SYMPTOM" },
        { id: "r", label: "r", kind: "RED_FLAG" },
        { id: "s2", label: "s", kind: "SYMPTOM" },
      ]).map((q) => q.id),
    ).toEqual(["r", "s1", "s2", "m"]);
  });
});
