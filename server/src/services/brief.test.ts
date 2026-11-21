import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { memoryClockRepository } from "../repositories/clock.js";
import { memoryStoreRepository } from "../repositories/store.js";
import type { Assessment } from "../core/triage.js";

const REAL = Date.parse("2026-11-21T07:00:00Z");
let app: FastifyInstance | undefined;

interface Brief {
  forDay: string;
  generatedAt: string;
  demoNotice: string;
  entries: {
    patientId: string;
    patientName: string;
    status: string;
    reasons: { text: string; ruleId: string }[];
    callScript: string;
  }[];
}

function pat(n: number) {
  return {
    id: `pat-${n}`,
    name: `Ime ${n}`,
    phone: `+386 40 000 00${n}`,
    dischargeDate: "2026-11-20",
    protocolId: "minor-abdominal-surgery",
    reportId: `rep-${n}`,
    preferredCheckInTime: "09:00",
    accessToken: `tok-${n}`,
  };
}

function asm(
  id: string,
  patientId: string,
  status: Assessment["status"],
  reasons: Assessment["reasons"],
): Assessment {
  return {
    id,
    patientId,
    checkInId: "chk-x",
    status,
    reasons,
    createdAt: "2026-11-21T07:00:00+01:00",
  };
}

async function make(): Promise<FastifyInstance> {
  const store = memoryStoreRepository();
  store.addAll({
    patients: [pat(1), pat(2), pat(3)],
    reports: [],
    checkIns: [],
    assessments: [
      asm("asm-1", "pat-1", "GREEN", [{ text: "v redu", ruleId: "R0" }]),
      asm("asm-2", "pat-2", "YELLOW", [
        { text: "a", ruleId: "R2" },
        { text: "b", ruleId: "R3" },
      ]),
      asm("asm-3", "pat-3", "RED", [{ text: "rdeče", ruleId: "R1" }]),
    ],
    alerts: [],
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

describe("GET /brief", () => {
  it("orders entries by status and writes call scripts", async () => {
    const a = await make();
    const res = await a.inject({ url: "/brief" });
    expect(res.statusCode).toBe(200);
    const b = res.json<Brief>();
    expect(b.forDay).toBe("2026-11-20");
    expect(b.generatedAt).toBe("2026-11-21T08:00:00+01:00");
    expect(b.demoNotice).toBe(
      "Vse klinične vrednosti so demonstracijske in niso klinično preverjene.",
    );
    expect(b.entries.map((e) => e.patientId)).toEqual([
      "pat-3",
      "pat-2",
      "pat-1",
    ]);
    expect(b.entries[0]?.callScript).toBe(
      "Pokličite Ime 3 (+386 40 000 003): rdeče",
    );
    expect(b.entries[1]).toMatchObject({
      patientName: "Ime 2",
      status: "YELLOW",
      reasons: [
        { text: "a", ruleId: "R2" },
        { text: "b", ruleId: "R3" },
      ],
      callScript: "Pokličite Ime 2 (+386 40 000 002): a; b",
    });
    expect(b.entries[2]).toMatchObject({
      status: "GREEN",
      reasons: [{ text: "v redu", ruleId: "R0" }],
      callScript: "Klic ni potreben.",
    });
  });
});
