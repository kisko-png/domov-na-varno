import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { memoryClockRepository } from "../repositories/clock.js";
import { openDb } from "../repositories/db.js";
import { sqliteClockRepository } from "../repositories/clock.js";
import {
  memoryStoreRepository,
  sqliteStoreRepository,
  type StoreRepository,
} from "../repositories/store.js";
import { buildAssessedSeed } from "./seed.js";

const REAL = Date.parse("2026-11-21T07:00:00Z");
let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function exercise(store: StoreRepository, a: FastifyInstance) {
  await a.inject({ method: "POST", url: "/sim/advance", payload: {} });
  await a.inject({ method: "GET", url: "/patients" });
  await a.inject({ method: "GET", url: "/reminders" });
  await a.inject({
    method: "POST",
    url: "/chat",
    headers: { "x-patient-token": "tok-01" },
    payload: { text: "Pozdravljeni" },
  });
  const created = await a.inject({
    method: "POST",
    url: "/reports",
    payload: {
      patient: {
        name: "Nova Oseba",
        phone: "+386 40 111 222",
        dischargeDate: "2026-11-12",
        preferredCheckInTime: "08:00",
      },
      procedure: "Zamenjava kolka",
      procedureDate: "2026-11-10",
      medications: [],
      specialWarnings: [],
      restrictions: [],
      recommendations: "Hodite.",
      doctorContactPhone: "+386 1 000 000",
    },
  });
  expect(created.statusCode).toBe(201);
  expect(store.countChatSessions()).toBe(1);
  expect(store.listReminders().length).toBeGreaterThan(0);
}

async function checkReset(store: StoreRepository, a: FastifyInstance) {
  const res = await a.inject({ method: "POST", url: "/admin/reset" });
  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({
    now: "2026-11-21T08:00:00+01:00",
    offsetMinutes: 0,
  });
  expect((await a.inject({ method: "GET", url: "/sim/now" })).json()).toEqual(
    res.json(),
  );
  const fresh = buildAssessedSeed(new Date(REAL));
  expect(store.listPatients()).toEqual(fresh.patients);
  expect(store.listAssessments()).toEqual(fresh.assessments);
  expect(store.listAlerts()).toEqual(fresh.alerts);
  expect(store.listCheckIns()).toEqual(fresh.checkIns);
  expect(store.countChatSessions()).toBe(0);
  expect(store.listReminders()).toEqual([]);
  const patients = (await a.inject({ method: "GET", url: "/patients" })).json<
    { patient: { id: string } }[]
  >();
  expect(patients.map((p) => p.patient.id).sort()).toEqual(
    fresh.patients.map((p) => p.id).sort(),
  );
}

describe("POST /admin/reset", () => {
  it("reseeds an in-memory store at offset 0", async () => {
    const store = memoryStoreRepository();
    store.addAll(buildAssessedSeed(new Date(REAL)));
    app = await buildApp({
      clockRepository: memoryClockRepository(0),
      storeRepository: store,
      realNow: () => REAL,
      logLevel: "silent",
    });
    await exercise(store, app);
    await checkReset(store, app);
  });

  it("empties the sqlite database despite the append-only triggers", async () => {
    const db = openDb(":memory:");
    const store = sqliteStoreRepository(db);
    store.addAll(buildAssessedSeed(new Date(REAL)));
    app = await buildApp({
      clockRepository: sqliteClockRepository(db),
      storeRepository: store,
      realNow: () => REAL,
      logLevel: "silent",
    });
    await exercise(store, app);
    await checkReset(store, app);
  });
});
