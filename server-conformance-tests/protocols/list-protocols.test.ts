// conformance tests of protocols:list-protocols
import { describe, expect, it } from "vitest";
import { listProtocols } from "protocols";

const RANK: Record<string, number> = {
  RED_FLAG: 0,
  SYMPTOM: 1,
  MEASUREMENT: 2,
};

describe("protocols:list-protocols", () => {
  // conformance scenario questions-red-flags-first of protocols:list-protocols
  it("questions-red-flags-first", () => {
    const all = listProtocols();
    expect(all.length, "listProtocols() length").toBe(3);
    for (const p of all) {
      const kinds = p.questions.map((q) => q.kind);
      const ranks = kinds.map((k) => RANK[k] ?? -1);
      const sorted = [...ranks].sort((a, b) => a - b);
      expect(ranks, `${p.id} question kinds ${JSON.stringify(kinds)}`).toEqual(
        sorted,
      );
      expect(ranks, `${p.id} unknown kind`).not.toContain(-1);
    }
    const cardiac = all.find((p) => p.id === "cardiac-surgery");
    expect(cardiac, "cardiac-surgery protocol").toBeDefined();
    const w = cardiac?.questions.find((q) => q.id === "weightKg");
    expect(
      w,
      `weightKg in ${JSON.stringify(cardiac?.questions)}`,
    ).toMatchObject({
      kind: "MEASUREMENT",
      unit: "kg",
    });
  });
});
