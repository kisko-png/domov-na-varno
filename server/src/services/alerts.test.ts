import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { memoryClockRepository } from "../repositories/clock.js";
import {
  memoryStoreRepository,
  type StoreRepository,
} from "../repositories/store.js";
import type { Assessment } from "../core/triage.js";

const REAL = Date.parse("2026-11-21T07:00:00Z");
let app: FastifyInstance | undefined;
let store: StoreRepository;

interface View {
  id: string;
  assessmentId: string;
  recipientRole: string;
  createdAt: string;
  acknowledgedAt?: string;
  escalatedAt?: string;
  patientId: string;
  patientName: string;
  status: string;
  reasons: { text: string; ruleId: string }[];
}

const patient = {
  id: "pat-x",
  name: "Test Testni",
  phone: "+386 40 000 099",
  dischargeDate: "2026-11-20",
  protocolId: "minor-abdominal-surgery",
  reportId: "rep-x",
  preferredCheckInTime: "09:00",
  accessToken: "tok-x",
};

function asm(id: string, at: string): Assessment {
  return {
    id,
    patientId: "pat-x",
    checkInId: "chk-x",
    status: "RED",
    reasons: [{ text: "rdeče", ruleId: "R1" }],
    createdAt: at,
  };
}

/** One patient discharged yesterday (no silence yet) with two RED assessments. */
async function make(): Promise<FastifyInstance> {
  store = memoryStoreRepository();
  store.addAll({
    patients: [patient],
    reports: [],
    checkIns: [],
    assessments: [
      asm("asm-1", "2026-11-21T07:45:01+01:00"), // 14m59s before now
      asm("asm-2", "2026-11-21T07:45:00+01:00"), // exactly 15m before now
    ],
    alerts: [
      {
        id: "alr-1",
        assessmentId: "asm-1",
        recipientRole: "NURSE",
        createdAt: "2026-11-21T07:45:01+01:00",
      },
      {
        id: "alr-2",
        assessmentId: "asm-2",
        recipientRole: "NURSE",
        createdAt: "2026-11-21T07:45:00+01:00",
      },
    ],
  });
  app = await buildApp({
    clockRepository: memoryClockRepository(0),
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

describe("GET /alerts", () => {
  it("escalates a NURSE alert 15 minutes old, not one younger", async () => {
    const a = await make();
    const res = await a.inject({ url: "/alerts" });
    expect(res.statusCode).toBe(200);
    const views = res.json<View[]>();
    expect(views.map((v) => v.id)).toEqual(["alr-3", "alr-1", "alr-2"]);
    const [coord, young, old] = views;
    expect(coord).toMatchObject({
      assessmentId: "asm-2",
      recipientRole: "COORDINATOR",
      createdAt: "2026-11-21T08:00:00+01:00",
      patientId: "pat-x",
      patientName: "Test Testni",
      status: "RED",
      reasons: [{ text: "rdeče", ruleId: "R1" }],
    });
    expect(coord?.escalatedAt).toBeUndefined();
    expect(young?.escalatedAt).toBeUndefined();
    expect(old?.escalatedAt).toBe("2026-11-21T08:00:00+01:00");
  });

  it("escalates only once, and filters by role", async () => {
    const a = await make();
    await a.inject({ url: "/alerts" });
    const nurse = (await a.inject({ url: "/alerts?role=NURSE" })).json<
      View[]
    >();
    expect(nurse.map((v) => v.id)).toEqual(["alr-1", "alr-2"]);
    const coord = (await a.inject({ url: "/alerts?role=COORDINATOR" })).json<
      View[]
    >();
    expect(coord.map((v) => v.id)).toEqual(["alr-3"]);
  });

  it("rejects an unknown role with 422", async () => {
    const a = await make();
    const res = await a.inject({ url: "/alerts?role=DOCTOR" });
    expect(res.statusCode).toBe(422);
  });

  it("does not escalate an acknowledged alert", async () => {
    const a = await make();
    await a.inject({ method: "POST", url: "/alerts/alr-2/ack" });
    const views = (await a.inject({ url: "/alerts" })).json<View[]>();
    expect(views).toHaveLength(2);
    expect(views.every((v) => v.escalatedAt === undefined)).toBe(true);
  });

  it("GET /patients escalates too", async () => {
    const a = await make();
    await a.inject({ url: "/patients" });
    expect(store.listAlerts().map((x) => x.recipientRole)).toEqual([
      "NURSE",
      "NURSE",
      "COORDINATOR",
    ]);
  });
});

describe("POST /alerts/:id/ack", () => {
  it("sets acknowledgedAt once and keeps the first", async () => {
    const a = await make();
    const first = await a.inject({ method: "POST", url: "/alerts/alr-1/ack" });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual({
      id: "alr-1",
      assessmentId: "asm-1",
      recipientRole: "NURSE",
      createdAt: "2026-11-21T07:45:01+01:00",
      acknowledgedAt: "2026-11-21T08:00:00+01:00",
    });
    await a.inject({
      method: "POST",
      url: "/sim/advance",
      payload: { minutes: 5 },
    });
    const again = await a.inject({ method: "POST", url: "/alerts/alr-1/ack" });
    expect(again.json<View>().acknowledgedAt).toBe("2026-11-21T08:00:00+01:00");
    expect(store.listAlerts()[0]?.acknowledgedAt).toBe(
      "2026-11-21T08:00:00+01:00",
    );
  });

  it("returns 404 not_found for an unknown id", async () => {
    const a = await make();
    const res = await a.inject({ method: "POST", url: "/alerts/alr-99/ack" });
    expect(res.statusCode).toBe(404);
    expect(res.json<{ error: { code: string } }>().error.code).toBe(
      "not_found",
    );
  });
});
