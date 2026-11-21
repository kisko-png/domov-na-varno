import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { memoryClockRepository } from "../repositories/clock.js";
import {
  memoryStoreRepository,
  type StoreRepository,
} from "../repositories/store.js";
import { buildAssessedSeed } from "./seed.js";

const REAL = Date.parse("2026-11-21T07:00:00Z");
let app: FastifyInstance | undefined;
let store: StoreRepository;

async function make(): Promise<FastifyInstance> {
  store = memoryStoreRepository();
  store.addAll(buildAssessedSeed(new Date(REAL)));
  app = await buildApp({
    clockRepository: memoryClockRepository(0),
    storeRepository: store,
    realNow: () => REAL,
    logLevel: "silent",
  });
  return app;
}

const post = (a: FastifyInstance, token: string, payload: object) =>
  a.inject({
    method: "POST",
    url: "/checkins",
    headers: { "x-patient-token": token },
    payload,
  });

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe("POST /checkins draft", () => {
  it("saves the draft of the current slot, replacing an earlier one", async () => {
    const a = await make();
    await post(a, "tok-01", { final: false, pain: 5, wellbeing: 3 });
    const res = await post(a, "tok-01", { final: false, pain: 4 });
    expect(res.statusCode).toBe(200);
    const view = (await a.inject({ url: "/p/tok-01" })).json();
    expect(res.json()).toEqual({
      patientId: "pat-01",
      slotDay: view.currentSlot.day,
      slotIndex: view.currentSlot.index,
      updatedAt: "2026-11-21T08:00:00+01:00",
      pain: 4,
    });
    expect(view.draft).toEqual(res.json());
  });

  it("needs a token", async () => {
    const a = await make();
    const res = await a.inject({
      method: "POST",
      url: "/checkins",
      payload: { final: false },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe("POST /checkins final", () => {
  it("stores a GREEN check-in with reassurance and deletes the draft", async () => {
    const a = await make();
    await post(a, "tok-09", { final: false, pain: 9 });
    const before = store.listAssessments().length;
    const res = await post(a, "tok-09", {
      final: true,
      pain: 2,
      wellbeing: 4,
      symptoms: [],
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.checkIn).toEqual({
      id: "chk-1",
      patientId: "pat-09",
      protocolVersion: "1.1.0",
      dayAfterDischarge: 8,
      timestamp: "2026-11-21T08:00:00+01:00",
      wellbeing: 4,
      pain: 2,
      symptoms: [],
      filledBy: "PATIENT",
    });
    expect(body.assessment.id).toBe(`asm-${before + 1}`);
    expect(body.assessment.status).toBe("GREEN");
    expect(body.comparison).toEqual({
      pain: { actual: 2, expected: 2, tolerance: 3 },
      wellbeing: { actual: 4, expected: 4, tolerance: 2 },
    });
    expect(body.reassuranceAllowed).toBe(true);
    expect(body.reassuranceText).toBe("v okviru pričakovanega za ta dan");
    expect(body.alertCreated).toBe(false);
    expect(body.demoNotice).toContain("demonstracijske");
    expect(store.listCheckIns().at(-1)?.id).toBe("chk-1");
    const view = (await a.inject({ url: "/p/tok-09" })).json();
    expect(view.draft).toBeUndefined();
  });

  it("a red flag gives RED, an alert and the warning", async () => {
    const a = await make();
    const alerts = store.listAlerts().length;
    // pat-03's day-8 slot is due at 10:00; move the clock past it.
    await a.inject({
      method: "POST",
      url: "/sim/advance",
      payload: { minutes: 120 },
    });
    const res = await post(a, "tok-03", {
      final: true,
      pain: 3,
      wellbeing: 4,
      symptoms: ["chest-pain"],
      filledBy: "CAREGIVER",
    });
    const body = res.json();
    expect(body.assessment.status).toBe("RED");
    expect(body.alertCreated).toBe(true);
    expect(body.showContactDoctor).toBe(true);
    expect(body.showEmergency112).toBe(true);
    expect(body.reassuranceAllowed).toBe(false);
    expect(body.reassuranceText).toBeUndefined();
    expect(body.checkIn.filledBy).toBe("CAREGIVER");
    expect(store.listAlerts()).toHaveLength(alerts + 1);
  });

  it("uses the history: a pain jump over earlier check-ins", async () => {
    const a = await make();
    const res = await post(a, "tok-09", {
      final: true,
      pain: 10,
      wellbeing: 4,
      symptoms: [],
    });
    const ids = res
      .json()
      .assessment.reasons.map((r: { ruleId: string }) => r.ruleId);
    expect(ids).toContain("R4");
  });

  it.each(["wellbeing", "pain", "symptoms"])(
    "without %s answers 422 and stores nothing",
    async (field) => {
      const a = await make();
      const n = store.listCheckIns().length;
      const payload: Record<string, unknown> = {
        final: true,
        pain: 2,
        wellbeing: 4,
        symptoms: [],
      };
      delete payload[field];
      const res = await post(a, "tok-09", payload);
      expect(res.statusCode).toBe(422);
      expect(res.json().error.code).toBe("validation_error");
      expect(res.json().error.details[0].field).toBe(field);
      expect(store.listCheckIns()).toHaveLength(n);
    },
  );
});

describe("POST /checkins trends, measurements and one per slot", () => {
  const advance = (a: FastifyInstance, minutes: number) =>
    a.inject({ method: "POST", url: "/sim/advance", payload: { minutes } });

  it("answers 409 already_submitted when the current slot is not yet due", async () => {
    const a = await make();
    const before = store.listCheckIns().length;
    // pat-03 checked in on day 7; its day-8 slot is due at 10:00, now is 08:00.
    const res = await post(a, "tok-03", {
      final: true,
      pain: 3,
      wellbeing: 4,
      symptoms: [],
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("already_submitted");
    expect(res.json().error.message).toContain("oddali");
    expect(store.listCheckIns()).toHaveLength(before);
    const draft = await post(a, "tok-03", { final: false, pain: 3 });
    expect(draft.statusCode).toBe(200);
  });

  it("answers 409 for a second check-in of the same slot", async () => {
    const a = await make();
    const ok = { final: true, pain: 2, wellbeing: 4, symptoms: [] };
    expect((await post(a, "tok-09", ok)).statusCode).toBe(201);
    expect((await post(a, "tok-09", ok)).statusCode).toBe(409);
    await advance(a, 2880); // LOW tier: next slot is day 10
    expect((await post(a, "tok-09", ok)).statusCode).toBe(201);
  });

  it("stores trends and measurements and shows them as previousCheckIn", async () => {
    const a = await make();
    await advance(a, 120);
    const res = await post(a, "tok-07", {
      final: true,
      pain: 4,
      wellbeing: 3,
      painTrend: "BETTER",
      wellbeingTrend: "SAME",
      symptoms: ["ankle-swelling"],
      measurements: { weightKg: 82.4 },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().checkIn).toMatchObject({
      painTrend: "BETTER",
      wellbeingTrend: "SAME",
      measurements: { weightKg: 82.4 },
    });
    const view = (await a.inject({ url: "/p/tok-07" })).json();
    expect(view.trendApplies).toBe(true);
    expect(view.previousCheckIn).toEqual({
      timestamp: res.json().checkIn.timestamp,
      pain: 4,
      wellbeing: 3,
      painTrend: "BETTER",
      wellbeingTrend: "SAME",
      measurements: { weightKg: 82.4 },
    });
  });

  it("rejects a measurement id that is not a MEASUREMENT of the protocol", async () => {
    const a = await make();
    const res = await post(a, "tok-09", {
      final: true,
      pain: 2,
      wellbeing: 4,
      symptoms: [],
      measurements: { weightKg: 70 },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.details[0].field).toBe("measurements.weightKg");
  });

  it("rejects an unknown trend with a Slovenian message", async () => {
    const a = await make();
    const res = await post(a, "tok-09", {
      final: true,
      pain: 2,
      wellbeing: 4,
      symptoms: [],
      painTrend: "GREAT",
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.details[0].field).toBe("painTrend");
  });

  it("says which field is missing in Slovenian", async () => {
    const a = await make();
    const res = await post(a, "tok-09", {
      final: true,
      wellbeing: 4,
      symptoms: [],
    });
    expect(res.json().error.details).toEqual([
      { field: "pain", message: "Manjka obvezno polje pain." },
    ]);
  });
});
