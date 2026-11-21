import { describe, expect, it } from "vitest";
import { buildSeed } from "./seed.js";
import { getProtocol } from "./protocols.js";

const NOW = "2025-03-05T10:00:00+01:00";
const seed = buildSeed(NOW);
const ofPatient = (id: string) =>
  seed.checkIns.filter((c) => c.patientId === id);

describe("buildSeed", () => {
  it("is deterministic", () => {
    expect(buildSeed(NOW)).toEqual(seed);
    expect(buildSeed(new Date(NOW))).toEqual(seed);
  });
  it("builds 12 patients, 4 per protocol, with ids, tokens and phones", () => {
    expect(seed.patients.map((p) => p.id)).toEqual(
      Array.from(
        { length: 12 },
        (_, i) => `pat-${String(i + 1).padStart(2, "0")}`,
      ),
    );
    expect(seed.patients[11]).toMatchObject({
      reportId: "rep-12",
      accessToken: "tok-12",
      phone: "+386 40 000 012",
    });
    expect(
      seed.patients
        .slice(0, 4)
        .every((p) => p.protocolId === "hip-replacement"),
    ).toBe(true);
    expect(
      seed.patients
        .slice(4, 8)
        .every((p) => p.protocolId === "cardiac-surgery"),
    ).toBe(true);
    expect(
      seed.patients
        .slice(8)
        .every((p) => p.protocolId === "minor-abdominal-surgery"),
    ).toBe(true);
    expect(new Set(seed.patients.map((p) => p.name)).size).toBe(12);
  });
  it("discharges 8 local days before now", () => {
    expect(seed.patients.every((p) => p.dischargeDate === "2025-02-25")).toBe(
      true,
    );
    expect(buildSeed("2025-03-04T23:30:00Z").patients[0]?.dischargeDate).toBe(
      "2025-02-25",
    );
  });
  it("gives each patient a report naming a keyword of its protocol", () => {
    expect(seed.reports).toHaveLength(12);
    for (const p of seed.patients) {
      const r = seed.reports.find((x) => x.id === p.reportId);
      expect(r?.patientId).toBe(p.id);
      const kw = getProtocol(p.protocolId).procedureKeywords;
      expect(kw.some((k) => r?.procedure.toLowerCase().includes(k))).toBe(true);
    }
    expect(
      seed.reports[1]?.medications.some((m) => m.includes("apixaban")),
    ).toBe(true);
  });
  it("places check-ins at the preferred time, twice on days 1-3 for HIGH", () => {
    const p6 = seed.patients[5];
    const c = ofPatient("pat-06");
    expect(c).toHaveLength(10);
    expect(c[0]?.timestamp).toBe(
      `2025-02-26T${p6?.preferredCheckInTime}:00+01:00`,
    );
    expect(
      Date.parse(c[1]?.timestamp ?? "") - Date.parse(c[0]?.timestamp ?? ""),
    ).toBe(12 * 3600_000);
    expect(ofPatient("pat-01").map((x) => x.dayAfterDischarge)).toEqual([
      1, 2, 3, 4, 5, 6, 7,
    ]);
  });
  it("pat-01 deteriorates slowly", () => {
    const c = ofPatient("pat-01");
    expect(c.map((x) => x.pain)).toEqual([6, 6, 5, 5, 5, 6, 7]);
    expect(c.map((x) => x.wellbeing)).toEqual([3, 3, 3, 3, 3, 2, 2]);
    expect(c.map((x) => x.temperatureC)).toEqual([
      37.2, 37.3, 37.4, 37.5, 37.6, 37.8, 38.1,
    ]);
  });
  it("pat-05 stops after day 4", () => {
    const days = ofPatient("pat-05").map((x) => x.dayAfterDischarge);
    expect(Math.max(...days)).toBe(4);
  });
  it("pat-09 is stable", () => {
    const p = getProtocol("minor-abdominal-surgery");
    for (const c of ofPatient("pat-09")) {
      const d = c.dayAfterDischarge;
      expect(c.pain).toBe(
        Math.floor(p.expectedCurve.pain.find((x) => x.day === d)?.value ?? -1),
      );
      expect(c.wellbeing).toBe(
        Math.ceil(
          p.expectedCurve.wellbeing.find((x) => x.day === d)?.value ?? -1,
        ),
      );
      expect(c.temperatureC).toBe(36.8);
      expect(c.symptoms).toEqual([]);
    }
  });
  it("other patients stay within the expected curve", () => {
    for (const pat of seed.patients.filter(
      (x) => !["pat-01", "pat-05", "pat-09"].includes(x.id),
    )) {
      const p = getProtocol(pat.protocolId);
      const flagged = new Set(p.redFlags.map((f) => f.symptom));
      const c = ofPatient(pat.id);
      expect(Math.max(...c.map((x) => x.dayAfterDischarge))).toBe(7);
      for (const x of c) {
        const ep =
          p.expectedCurve.pain.find((v) => v.day === x.dayAfterDischarge)
            ?.value ?? NaN;
        const ew =
          p.expectedCurve.wellbeing.find((v) => v.day === x.dayAfterDischarge)
            ?.value ?? NaN;
        expect(Math.abs(x.pain - ep)).toBeLessThanOrEqual(p.painTolerance);
        expect(x.wellbeing).toBeGreaterThanOrEqual(ew - 1);
        expect(x.temperatureC).toBeLessThan(37.5);
        expect(x.symptoms.some((s) => flagged.has(s))).toBe(false);
        expect(x.protocolVersion).toBe(p.version);
      }
    }
  });
});
