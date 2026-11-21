import { describe, expect, it } from "vitest";
import { buildSeed } from "../core/seed.js";
import { openDb } from "../repositories/db.js";
import {
  memoryStoreRepository,
  sqliteStoreRepository,
} from "../repositories/store.js";
import { sqliteClockRepository } from "../repositories/clock.js";
import { buildAssessedSeed, seedStoreIfEmpty } from "./seed.js";

const NOW = new Date("2026-11-21T07:00:00Z");

describe("seedStoreIfEmpty", () => {
  it("fills an empty store with buildSeed(now) and one assessment per check-in", () => {
    const store = memoryStoreRepository();
    expect(seedStoreIfEmpty(store, NOW)).toBe(true);
    const seed = buildSeed(NOW);
    expect(store.listPatients()).toEqual(seed.patients);
    expect(store.listReports()).toEqual(seed.reports);
    expect(store.listCheckIns()).toHaveLength(seed.checkIns.length);
    const assessments = store.listAssessments();
    expect(assessments).toHaveLength(seed.checkIns.length);
    expect(assessments.map((a) => a.id)).toEqual(
      assessments.map((_, i) => `asm-${i + 1}`),
    );
  });

  it("does not seed a store that has data", () => {
    const store = memoryStoreRepository();
    seedStoreIfEmpty(store, NOW);
    expect(seedStoreIfEmpty(store, NOW)).toBe(false);
    expect(store.listPatients()).toHaveLength(12);
  });
});

describe("buildAssessedSeed", () => {
  const s = buildAssessedSeed(NOW);

  it("assesses check-ins in time order, createdAt their timestamp", () => {
    const times = s.checkIns.map((c) => Date.parse(c.timestamp));
    expect(times).toEqual([...times].sort((a, b) => a - b));
    s.assessments.forEach((a, i) => {
      expect(a.checkInId).toBe(s.checkIns[i]?.id);
      expect(Date.parse(a.createdAt)).toBe(times[i]);
    });
  });

  it("uses the history: pat-01 day 7 sees the pain jump-free curve rise as RED persisting", () => {
    const day7 = s.checkIns.find(
      (c) => c.patientId === "pat-01" && c.dayAfterDischarge === 7,
    );
    const a = s.assessments.find((x) => x.checkInId === day7?.id);
    // day 6 pain 6 vs expected 4 (tol 2) is not > tol; day 7 pain 7 vs 3.5 is.
    expect(a?.reasons.map((r) => r.ruleId)).toContain("R2");
    expect(a?.reasons.some((r) => r.ruleId === "R3")).toBe(true);
  });

  it("numbers alerts alr-1.. for the RED assessments, in order", () => {
    const red = s.assessments.filter((a) => a.status === "RED");
    expect(s.alerts.map((a) => a.assessmentId)).toEqual(red.map((a) => a.id));
    expect(s.alerts.map((a) => a.id)).toEqual(
      s.alerts.map((_, i) => `alr-${i + 1}`),
    );
  });
});

describe("sqlite repositories", () => {
  it("round-trip the seeded store and the clock offset", () => {
    const db = openDb(":memory:");
    const store = sqliteStoreRepository(db);
    expect(store.isEmpty()).toBe(true);
    seedStoreIfEmpty(store, NOW);
    const expected = buildAssessedSeed(NOW);
    expect(store.listCheckIns()).toEqual(expected.checkIns);
    expect(store.listAssessments()).toEqual(expected.assessments);
    expect(store.listAlerts()).toEqual(expected.alerts);
    const clock = sqliteClockRepository(db);
    expect(clock.getOffsetMinutes()).toBe(0);
    clock.setOffsetMinutes(30);
    expect(clock.getOffsetMinutes()).toBe(30);
  });
});
