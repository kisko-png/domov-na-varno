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
      protocolVersion: "1.0.0",
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
