import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { memoryClockRepository } from "../repositories/clock.js";
import { memoryStoreRepository } from "../repositories/store.js";
import { listProtocols } from "../core/protocols.js";
import { SL } from "../strings.sl.js";
import { ProtocolService } from "./protocols.js";

const REAL = Date.parse("2026-11-21T07:00:00Z");
let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe("ProtocolService.list", () => {
  it("adds silence thresholds of the risk tier and the demo notice", () => {
    const list = new ProtocolService().list();
    expect(list.map((p) => p.id)).toEqual([
      "hip-replacement",
      "cardiac-surgery",
      "minor-abdominal-surgery",
    ]);
    expect(list.map((p) => p.silence)).toEqual([
      { yellowAfterHours: 24, redAfterHours: 48 },
      { yellowAfterHours: 12, redAfterHours: 24 },
      { yellowAfterHours: 48, redAfterHours: 72 },
    ]);
    for (const p of list) expect(p.demoNotice).toBe(SL.patient.demoNotice);
  });
});

describe("GET /protocols", () => {
  it("returns 200 with the base catalogue in order", async () => {
    app = await buildApp({
      clockRepository: memoryClockRepository(0),
      storeRepository: memoryStoreRepository(),
      realNow: () => REAL,
      logLevel: "silent",
    });
    const res = await app.inject({ method: "GET", url: "/protocols" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>[];
    const base = listProtocols();
    expect(body).toHaveLength(3);
    body.forEach((p, i) => {
      const b = base[i];
      expect(p.id).toBe(b?.id);
      expect(p.redFlags).toEqual(b?.redFlags);
      expect(p.checkInSchedule).toEqual(b?.checkInSchedule);
      expect(p.durationDays).toBe(b?.durationDays);
      expect(p.demoNotice).toBe(
        "Vse klinične vrednosti so demonstracijske in niso klinično preverjene.",
      );
    });
    expect(body[1]?.silence).toEqual({
      yellowAfterHours: 12,
      redAfterHours: 24,
    });
  });
});
