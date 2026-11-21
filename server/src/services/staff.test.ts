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

interface Summary {
  patient: { id: string };
  protocolName: string;
  riskTier: string;
  dayAfterDischarge: number;
  status: string;
  latestAssessment?: { id: string; status: string; createdAt: string };
  lastCheckInAt?: string;
  openAlerts: number;
}

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

describe("silence on read", () => {
  it("keeps a RED silence assessment and alert for pat-05, ids continuing", async () => {
    const a = await make();
    const asm = store.listAssessments().length;
    const alr = store.listAlerts().length;
    expect((await a.inject({ url: "/patients" })).statusCode).toBe(200);
    const added = store.listAssessments().slice(asm);
    const p5 = added.filter((x) => x.patientId === "pat-05");
    expect(p5).toHaveLength(1);
    expect(p5[0]?.status).toBe("RED");
    expect(p5[0]?.checkInId).toBeUndefined();
    expect(p5[0]?.reasons[0]?.ruleId).toBe("R5");
    expect(added.map((x) => x.id)).toEqual(
      added.map((_, i) => `asm-${asm + i + 1}`),
    );
    const alerts = store.listAlerts().slice(alr);
    const p5Alert = alerts.find((x) => x.assessmentId === p5[0]?.id);
    expect(p5Alert?.id).toMatch(/^alr-\d+$/);
    expect(Number(p5Alert?.id.slice(4))).toBeGreaterThan(alr);
  });

  it("does not repeat a silence assessment of the same status", async () => {
    const a = await make();
    await a.inject({ url: "/patients" });
    const n = store.listAssessments().length;
    const m = store.listAlerts().length;
    await a.inject({ url: "/patients" });
    expect(store.listAssessments()).toHaveLength(n);
    expect(store.listAlerts()).toHaveLength(m);
  });

  it("adds a new one when the status changes", async () => {
    const a = await make();
    // pat-01 checks in now, then stays silent.
    await a.inject({
      method: "POST",
      url: "/checkins",
      headers: { "x-patient-token": "tok-01" },
      payload: { final: true, wellbeing: 3, pain: 3, symptoms: [] },
    });
    const silence = (): string[] =>
      store
        .listAssessments()
        .filter((x) => x.patientId === "pat-01" && x.checkInId === undefined)
        .map((x) => x.status);
    await a.inject({
      method: "POST",
      url: "/sim/advance",
      payload: { minutes: 60 * 50 },
    });
    await a.inject({ url: "/patients" });
    const first = silence();
    expect(first.length).toBeGreaterThan(0);
    await a.inject({ url: "/patients" });
    expect(silence()).toEqual(first);
    await a.inject({
      method: "POST",
      url: "/sim/advance",
      payload: { minutes: 60 * 30 },
    });
    await a.inject({ url: "/patients" });
    expect(silence()).toEqual([...first, "RED"]);
  });
});

describe("GET /patients", () => {
  it("returns a summary per patient, ordered by status then recency", async () => {
    const a = await make();
    const res = await a.inject({ url: "/patients" });
    expect(res.statusCode).toBe(200);
    const list = res.json<Summary[]>();
    expect(list).toHaveLength(12);
    const rank: Record<string, number> = { RED: 0, YELLOW: 1, GREEN: 2 };
    for (let i = 1; i < list.length; i++) {
      const x = list[i - 1]!;
      const y = list[i]!;
      const d = (rank[x.status] ?? 9) - (rank[y.status] ?? 9);
      expect(d).toBeLessThanOrEqual(0);
      if (d === 0)
        expect(
          Date.parse(x.latestAssessment!.createdAt),
        ).toBeGreaterThanOrEqual(Date.parse(y.latestAssessment!.createdAt));
    }
    expect(list[0]?.status).toBe("RED");
  });

  it("fills each field from the store", async () => {
    const a = await make();
    const list = (await a.inject({ url: "/patients" })).json<Summary[]>();
    const p5 = list.find((s) => s.patient.id === "pat-05")!;
    expect(p5.protocolName).toBe("Operacija srca");
    expect(p5.riskTier).toBe("HIGH");
    expect(p5.dayAfterDischarge).toBe(8);
    expect(p5.status).toBe("RED");
    const own = store.listAssessments().filter((x) => x.patientId === "pat-05");
    expect(p5.latestAssessment?.id).toBe(own.at(-1)?.id);
    const ids = new Set(own.map((x) => x.id));
    expect(p5.openAlerts).toBe(
      store.listAlerts().filter((x) => ids.has(x.assessmentId)).length,
    );
    expect(p5.openAlerts).toBeGreaterThan(0);
    const times = store
      .listCheckIns()
      .filter((c) => c.patientId === "pat-05")
      .map((c) => Date.parse(c.timestamp));
    expect(Date.parse(p5.lastCheckInAt!)).toBe(Math.max(...times));
    const p9 = list.find((s) => s.patient.id === "pat-09")!;
    expect(p9.status).toBe("GREEN");
    expect(p9.openAlerts).toBe(0);
  });
});
