import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { memoryClockRepository } from "../repositories/clock.js";
import {
  memoryStoreRepository,
  type StoreRepository,
} from "../repositories/store.js";
import { buildAssessedSeed } from "./seed.js";
import { ClockService } from "./clock.js";
import { PatientService } from "./patient.js";
import { UnauthenticatedError } from "../errors.js";
import { getProtocol } from "../core/protocols.js";
import { currentSlot, redFlagWarning } from "../core/patientView.js";
import { buildSeed } from "../core/seed.js";

const REAL = Date.parse("2026-11-21T07:00:00Z");
const NOTICE =
  "Vse klinične vrednosti so demonstracijske in niso klinično preverjene.";
let app: FastifyInstance | undefined;
let store: StoreRepository;

async function make(offset = 0): Promise<FastifyInstance> {
  store = memoryStoreRepository();
  store.addAll(buildAssessedSeed(new Date(REAL)));
  app = await buildApp({
    clockRepository: memoryClockRepository(offset),
    storeRepository: store,
    realNow: () => REAL,
    logLevel: "silent",
  });
  return app;
}

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe("patient token", () => {
  it.each([undefined, "", "tok-99"])(
    "rejects token %j with 401 unauthenticated",
    async (token) => {
      const app = await make();
      const res = await app.inject({
        method: "POST",
        url: "/checkins/preview",
        headers: token === undefined ? {} : { "x-patient-token": token },
        payload: { symptoms: [] },
      });
      expect(res.statusCode).toBe(401);
      expect(res.json().error.code).toBe("unauthenticated");
    },
  );

  it("is checked before the body", async () => {
    const app = await make();
    const res = await app.inject({
      method: "POST",
      url: "/checkins/preview",
      payload: {},
    });
    expect(res.statusCode).toBe(401);
  });

  it("authenticate returns the patient of the token", () => {
    const s = memoryStoreRepository();
    s.addAll(buildAssessedSeed(new Date(REAL)));
    const svc = new PatientService(
      s,
      new ClockService(memoryClockRepository(), () => REAL),
    );
    expect(svc.authenticate("tok-03").id).toBe("pat-03");
    expect(() => svc.authenticate("nope")).toThrow(UnauthenticatedError);
  });
});

describe("POST /checkins/preview", () => {
  it("warns of an EMERGENCY red flag with 112", async () => {
    const app = await make();
    const res = await app.inject({
      method: "POST",
      url: "/checkins/preview",
      headers: { "x-patient-token": "tok-01" },
      payload: { symptoms: ["shortness-of-breath", "tiredness"] },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.showContactDoctor).toBe(true);
    expect(body.showEmergency112).toBe(true);
    expect(body.doctorPhone).toBe("+386 1 000 0000");
    expect(body.message).toContain("Kontaktirajte zdravnika");
    expect(body.message).toContain("+386 1 000 0000");
    expect(body.message).toContain("112");
    expect(body.redFlags.map((f: { id: string }) => f.id)).toEqual(["hip-sob"]);
  });

  it("CONTACT_DOCTOR only: no 112", async () => {
    const app = await make();
    const res = await app.inject({
      method: "POST",
      url: "/checkins/preview",
      headers: { "x-patient-token": "tok-01" },
      payload: { symptoms: ["wound-redness"] },
    });
    const body = res.json();
    expect(body.showContactDoctor).toBe(true);
    expect(body.showEmergency112).toBe(false);
    expect(body.message).not.toContain("112");
  });

  it("no red flag: no message", async () => {
    const app = await make();
    const res = await app.inject({
      method: "POST",
      url: "/checkins/preview",
      headers: { "x-patient-token": "tok-01" },
      payload: { symptoms: ["tiredness"] },
    });
    expect(res.json()).toEqual({
      showContactDoctor: false,
      showEmergency112: false,
      doctorPhone: "+386 1 000 0000",
      redFlags: [],
    });
  });

  it("rejects a missing symptoms list with 422", async () => {
    const app = await make();
    const res = await app.inject({
      method: "POST",
      url: "/checkins/preview",
      headers: { "x-patient-token": "tok-01" },
      payload: {},
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.details[0].field).toBe("symptoms");
  });
});

describe("redFlagWarning", () => {
  it("uses the protocol's red flags", () => {
    const seed = buildSeed(new Date(REAL));
    const report = seed.reports[4]!;
    const w = redFlagWarning(getProtocol("cardiac-surgery"), report, [
      "palpitations",
    ]);
    expect(w.redFlags.map((f) => f.id)).toEqual(["cardiac-palpitations"]);
    expect(w.showEmergency112).toBe(false);
  });
});

describe("currentSlot", () => {
  const seed = buildSeed(new Date(REAL));
  const patient = seed.patients[0]!;
  const protocol = getProtocol(patient.protocolId);
  it("is the earliest uncovered due slot", () => {
    const slot = currentSlot(protocol, patient, [], new Date(REAL));
    expect(slot?.day).toBe(1);
  });
  it("is the next slot when every due one is covered", () => {
    const own = seed.checkIns.filter((c) => c.patientId === patient.id);
    const slot = currentSlot(protocol, patient, own, new Date(REAL - 86400000));
    expect(slot?.day).toBe(8);
    expect(Date.parse(slot!.dueAt)).toBeGreaterThan(REAL - 86400000);
  });
});

describe("GET /p/{token}", () => {
  it("returns the patient view", async () => {
    const app = await make();
    const res = await app.inject({ method: "GET", url: "/p/tok-01" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const report = store.listReports()[0]!;
    expect(body.patientName).toBe(store.listPatients()[0]!.name);
    expect(body.dayAfterDischarge).toBe(8);
    expect(body.protocol.id).toBe("hip-replacement");
    expect(body.protocol.silence).toEqual({
      yellowAfterHours: 24,
      redAfterHours: 48,
    });
    expect(body.protocol.questions.length).toBeGreaterThan(0);
    expect(body.doctorPhone).toBe(report.doctorContactPhone);
    expect(body.patientInstructions).toEqual([
      ...report.specialWarnings,
      ...report.restrictions,
      report.recommendations,
    ]);
    expect(body.currentSlot.day).toBe(8);
    expect(body.demoNotice).toBe(NOTICE);
    expect(body.draft).toBeUndefined();
    expect(body.pendingReminder).toBeUndefined();
  });

  it("includes the current slot's draft and a reminder after the latest check-in", async () => {
    const app = await make();
    const first = await app.inject({ method: "GET", url: "/p/tok-01" });
    const slot = first.json().currentSlot;
    const draft = {
      patientId: "pat-01",
      slotDay: slot.day,
      slotIndex: slot.index,
      updatedAt: "2026-11-21T08:00:00+01:00",
      pain: 4,
    };
    store.saveDraft(draft);
    store.saveDraft({ ...draft, slotDay: slot.day + 1, pain: 9 });
    const base = {
      patientId: "pat-01",
      kind: "FIRST" as const,
      draftPending: true,
    };
    store.addReminder({
      ...base,
      id: "rem-1",
      sentAt: "2026-11-10T08:00:00+01:00",
    });
    store.addReminder({
      ...base,
      id: "rem-2",
      sentAt: "2026-11-21T07:30:00+01:00",
    });
    store.addReminder({
      ...base,
      id: "rem-3",
      patientId: "pat-02",
      sentAt: "2026-11-21T07:40:00+01:00",
    });
    const res = await app.inject({ method: "GET", url: "/p/tok-01" });
    const body = res.json();
    expect(body.draft).toEqual(draft);
    expect(body.pendingReminder.id).toBe("rem-2");
  });

  it("omits a reminder sent before the latest check-in", async () => {
    const app = await make();
    store.addReminder({
      id: "rem-1",
      patientId: "pat-01",
      kind: "FIRST",
      draftPending: false,
      sentAt: "2026-11-10T08:00:00+01:00",
    });
    const res = await app.inject({ method: "GET", url: "/p/tok-01" });
    expect(res.json().pendingReminder).toBeUndefined();
  });

  it("answers an unknown token with 404 not_found", async () => {
    const app = await make();
    const res = await app.inject({ method: "GET", url: "/p/tok-99" });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("not_found");
  });
});
