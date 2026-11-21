import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { memoryClockRepository } from "../repositories/clock.js";
import { openDb } from "../repositories/db.js";
import {
  memoryStoreRepository,
  sqliteStoreRepository,
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

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe("GET /patients/{id}/checkins", () => {
  it("returns the patient's check-ins oldest first", async () => {
    const a = await make();
    const res = await a.inject({ url: "/patients/pat-05/checkins" });
    expect(res.statusCode).toBe(200);
    const list = res.json<{ patientId: string; timestamp: string }[]>();
    const expected = store
      .listCheckIns()
      .filter((c) => c.patientId === "pat-05");
    expect(list.length).toBe(expected.length);
    expect(list.length).toBeGreaterThan(1);
    expect(list.every((c) => c.patientId === "pat-05")).toBe(true);
    const times = list.map((c) => Date.parse(c.timestamp));
    expect(times).toEqual([...times].sort((x, y) => x - y));
  });

  it("lists a new check-in last", async () => {
    const a = await make();
    const post = await a.inject({
      method: "POST",
      url: "/checkins",
      headers: { "x-patient-token": "tok-01" },
      payload: { final: true, wellbeing: 3, pain: 4, symptoms: [] },
    });
    expect(post.statusCode).toBe(201);
    const list = (await a.inject({ url: "/patients/pat-01/checkins" })).json<
      { id: string }[]
    >();
    expect(list.at(-1)?.id).toBe(
      post.json<{ checkIn: { id: string } }>().checkIn.id,
    );
  });

  it("answers 404 for an unknown patient", async () => {
    const a = await make();
    const res = await a.inject({ url: "/patients/pat-99/checkins" });
    expect(res.statusCode).toBe(404);
    expect(res.json<{ error: { code: string } }>().error.code).toBe(
      "not_found",
    );
  });
});

describe("GET /assessments", () => {
  it("returns the patient's assessments oldest first", async () => {
    const a = await make();
    const res = await a.inject({ url: "/assessments?patientId=pat-01" });
    expect(res.statusCode).toBe(200);
    const list = res.json<{ patientId: string; createdAt: string }[]>();
    expect(list.length).toBe(
      store.listAssessments().filter((x) => x.patientId === "pat-01").length,
    );
    expect(list.length).toBeGreaterThan(1);
    expect(list.every((x) => x.patientId === "pat-01")).toBe(true);
    const times = list.map((x) => Date.parse(x.createdAt));
    expect(times).toEqual([...times].sort((x, y) => x - y));
  });

  it("answers 404 for an unknown patient and 422 without patientId", async () => {
    const a = await make();
    const res = await a.inject({ url: "/assessments?patientId=nobody" });
    expect(res.statusCode).toBe(404);
    expect(res.json<{ error: { code: string } }>().error.code).toBe(
      "not_found",
    );
    const bad = await a.inject({ url: "/assessments" });
    expect(bad.statusCode).toBe(422);
  });
});

describe("append-only", () => {
  for (const method of ["PUT", "PATCH", "DELETE"] as const) {
    for (const base of ["/checkins", "/assessments"]) {
      it(`${method} ${base}/{id} answers 405 and changes nothing`, async () => {
        const a = await make();
        const before = [store.listCheckIns(), store.listAssessments()];
        const id = base === "/checkins" ? "chk-01-01-1" : "asm-1";
        const res = await a.inject({
          method,
          url: `${base}/${id}`,
          ...(method === "DELETE" ? {} : { payload: { pain: 0 } }),
        });
        expect(res.statusCode).toBe(405);
        expect(res.json<{ error: { code: string } }>().error.code).toBe(
          "method_not_allowed",
        );
        expect([store.listCheckIns(), store.listAssessments()]).toEqual(before);
      });
    }
  }

  it("the database aborts UPDATE and DELETE of check-ins and assessments", () => {
    const db = openDb(":memory:");
    const s = sqliteStoreRepository(db);
    s.addAll(buildAssessedSeed(new Date(REAL)));
    for (const t of ["check_ins", "assessments"]) {
      expect(() => db.exec(`UPDATE ${t} SET data = '{}'`)).toThrow(
        /append-only/,
      );
      expect(() => db.exec(`DELETE FROM ${t}`)).toThrow(/append-only/);
    }
    expect(s.listCheckIns().length).toBeGreaterThan(0);
    db.close();
  });
});
