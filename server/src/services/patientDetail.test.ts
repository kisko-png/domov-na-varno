import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { memoryClockRepository } from "../repositories/clock.js";
import {
  memoryStoreRepository,
  type ChatSession,
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

function session(
  id: string,
  patientId: string,
  status: "DRAFT" | "SENT",
  confirmedAt?: string,
): ChatSession {
  return {
    id,
    patientId,
    createdAt: "2026-11-20T08:00:00+01:00",
    transcript: [],
    surveyAnswers: [],
    patientQuestions: [],
    botGuidanceGiven: [],
    summary: {
      id: `sum-${id}`,
      sessionId: id,
      patientId,
      fullTranscript: [],
      surveyAnswers: [],
      botGuidanceGiven: [],
      patientQuestions: [],
      createdAt: "2026-11-20T08:00:00+01:00",
      summaryStatus: status,
      ...(confirmedAt ? { confirmedAt } : {}),
    },
  };
}

describe("GET /patients/:id", () => {
  it("returns the summary as GET /patients gives it, report, personal protocol and instructions", async () => {
    const a = await make();
    const res = await a.inject({ method: "GET", url: "/patients/pat-05" });
    expect(res.statusCode).toBe(200);
    const d = res.json();
    const list = (await a.inject({ method: "GET", url: "/patients" })).json();
    const summary = list.find(
      (s: { patient: { id: string } }) => s.patient.id === "pat-05",
    );
    expect(d.status).toBe(summary.status);
    expect(d.status).not.toBe("GREEN");
    expect(d.latestAssessment).toEqual(summary.latestAssessment);
    expect(d.report.id).toBe("rep-05");
    expect(d.protocol.id).toBe("cardiac-surgery");
    expect(d.protocol.demoNotice).toBeTruthy();
    const r = d.report;
    expect(d.patientInstructions).toEqual([
      ...r.specialWarnings,
      ...r.restrictions,
      r.recommendations,
    ]);
    expect(d.sentSummaries).toEqual([]);
  });

  it("uses the personal protocol", async () => {
    const a = await make();
    const d = (
      await a.inject({ method: "GET", url: "/patients/pat-02" })
    ).json();
    expect(d.protocol.redFlags.map((f: { id: string }) => f.id)).toContain(
      "anticoagulant-bleeding",
    );
  });

  it("lists SENT summaries only, latest confirmedAt first", async () => {
    const a = await make();
    store.saveChatSession(
      session("chat-1", "pat-01", "SENT", "2026-11-20T09:00:00+01:00"),
    );
    store.saveChatSession(session("chat-2", "pat-01", "DRAFT"));
    store.saveChatSession(
      session("chat-3", "pat-01", "SENT", "2026-11-20T10:00:00+01:00"),
    );
    store.saveChatSession(
      session("chat-4", "pat-03", "SENT", "2026-11-20T11:00:00+01:00"),
    );
    const d = (
      await a.inject({ method: "GET", url: "/patients/pat-01" })
    ).json();
    expect(d.sentSummaries).toEqual([
      { sessionId: "chat-3", confirmedAt: "2026-11-20T10:00:00+01:00" },
      { sessionId: "chat-1", confirmedAt: "2026-11-20T09:00:00+01:00" },
    ]);
  });

  it("returns 404 not_found for an unknown id", async () => {
    const a = await make();
    const res = await a.inject({ method: "GET", url: "/patients/pat-99" });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("not_found");
  });
});
