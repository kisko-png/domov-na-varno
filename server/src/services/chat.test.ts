import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { memoryClockRepository } from "../repositories/clock.js";
import {
  memoryStoreRepository,
  type StoreRepository,
} from "../repositories/store.js";
import { buildAssessedSeed } from "./seed.js";
import { fakeLlmClient, parseChoice } from "./llm.js";

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
    llm: fakeLlmClient(),
  });
  return app;
}

const chat = (a: FastifyInstance, token: string, payload: object) =>
  a.inject({
    method: "POST",
    url: "/chat",
    headers: { "x-patient-token": token },
    payload,
  });

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe("POST /chat session", () => {
  it("starts a session and keeps the transcript", async () => {
    const a = await make();
    const res = await chat(a, "tok-01", { text: "Kakšno bo jutri vreme?" });
    expect(res.statusCode).toBe(200);
    const reply = res.json();
    expect(reply.sessionId).toBe("chat-1");
    const next = await chat(a, "tok-01", {
      sessionId: "chat-1",
      text: "Še eno vprašanje o vremenu",
    });
    expect(next.json().sessionId).toBe("chat-1");
    const s = store.getChatSession("chat-1");
    expect(s?.transcript.map((t) => t.role)).toEqual([
      "PATIENT",
      "BOT",
      "PATIENT",
      "BOT",
    ]);
    expect(s?.transcript[0]).toEqual({
      role: "PATIENT",
      text: "Kakšno bo jutri vreme?",
      at: "2026-11-21T08:00:00+01:00",
    });
    expect(s?.transcript[1]?.text).toBe(reply.text);
    expect((await chat(a, "tok-02", { text: "x" })).json().sessionId).toBe(
      "chat-2",
    );
  });

  it("returns 404 for an unknown session or one of another patient", async () => {
    const a = await make();
    await chat(a, "tok-01", { text: "vreme" });
    for (const [tok, id] of [
      ["tok-01", "chat-99"],
      ["tok-02", "chat-1"],
    ] as const) {
      const res = await chat(a, tok, { sessionId: id, text: "vreme" });
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe("not_found");
    }
  });

  it("needs a token", async () => {
    const a = await make();
    const res = await a.inject({
      method: "POST",
      url: "/chat",
      payload: { text: "x" },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe("input guard", () => {
  it("escalates a red-flag pattern with a RED R1 assessment and NURSE alert", async () => {
    const a = await make();
    const before = store.listAssessments().length;
    const alertsBefore = store.listAlerts().length;
    const res = await chat(a, "tok-01", {
      text: "Zelo TEŽKO DIHAM že zjutraj",
    });
    const reply = res.json();
    expect(reply).toMatchObject({
      type: "ESCALATION",
      showContactDoctor: true,
      showEmergency112: true,
      alertCreated: true,
      alertId: `alr-${alertsBefore + 1}`,
      watchFor: [],
    });
    expect(reply.text).toContain("112");
    expect(reply.text).toContain(reply.doctorPhone);
    const asm = store.listAssessments().at(-1);
    expect(asm).toMatchObject({
      id: `asm-${before + 1}`,
      patientId: "pat-01",
      status: "RED",
    });
    expect(asm?.checkInId).toBeUndefined();
    expect(asm?.reasons.map((r) => r.ruleId)).toEqual(["R1"]);
    expect(store.listAlerts().at(-1)).toMatchObject({
      id: reply.alertId,
      assessmentId: asm?.id,
      recipientRole: "NURSE",
    });
  });

  it("a CONTACT_DOCTOR flag does not show 112", async () => {
    const a = await make();
    const reply = (await chat(a, "tok-01", { text: "Rana se cedi." })).json();
    expect(reply).toMatchObject({
      type: "ESCALATION",
      showContactDoctor: true,
      showEmergency112: false,
    });
  });

  it("the fake classifier answers the first matching candidate or none", async () => {
    const llm = fakeLlmClient();
    const candidates = [
      { id: "a", phrases: ["x"] },
      { id: "b", phrases: ["kri teče"] },
    ];
    const ans = await llm.complete([{ role: "user", content: "KRI TEČE" }], {
      task: "red-flag-classifier",
      candidates,
    });
    expect(ans).toBe("b");
    expect(parseChoice(ans, candidates)).toBe("b");
    const none = await llm.complete([{ role: "user", content: "nič" }], {
      task: "topic-matcher",
      candidates,
    });
    expect(parseChoice(none, candidates)).toBeUndefined();
  });
});

describe("chat guidance", () => {
  it("refuses a medication question and records it", async () => {
    const a = await make();
    const reply = (
      await chat(a, "tok-01", { text: "Ali naj vzamem ibuprofen?" })
    ).json();
    expect(reply).toMatchObject({
      type: "REFUSAL",
      alertCreated: false,
      showContactDoctor: false,
      showEmergency112: false,
      watchFor: [],
    });
    expect(reply.text).toMatch(/zdravnik/);
    expect(store.getChatSession("chat-1")?.patientQuestions).toEqual([
      "Ali naj vzamem ibuprofen?",
    ]);
  });

  it("gives guidance on a matched topic with the day after discharge", async () => {
    const a = await make();
    const reply = (
      await chat(a, "tok-01", { text: "Rana je malo rdeča, ali je normalno?" })
    ).json();
    expect(reply.type).toBe("GUIDANCE");
    expect(reply.text).toContain("Rana");
    expect(reply.text).toContain("8.");
    expect(reply.watchFor).toEqual([
      "Barvo in toploto kože okoli rane",
      "Ali se iz rane kaj cedi",
    ]);
    expect(reply.warningSigns).toHaveLength(3);
    expect(reply.whenToCall).toContain("pokličite zdravnika");
    expect(reply.alertCreated).toBe(false);
  });

  it("answers NOT_COVERED otherwise, offering the survey", async () => {
    const a = await make();
    const before = store.listAssessments().length;
    const reply = (
      await chat(a, "tok-01", { text: "Kakšno bo vreme?" })
    ).json();
    expect(reply.type).toBe("NOT_COVERED");
    expect(reply.text).toMatch(/ne pokriva/);
    expect(reply.watchFor).toEqual([]);
    expect(store.listAssessments()).toHaveLength(before);
  });
});

describe("chat summary", () => {
  const post = (a: FastifyInstance, url: string, token?: string) =>
    a.inject({
      method: "POST",
      url,
      headers: token === undefined ? {} : { "x-patient-token": token },
    });
  const get = (a: FastifyInstance, url: string, token?: string) =>
    a.inject({
      method: "GET",
      url,
      headers: token === undefined ? {} : { "x-patient-token": token },
    });

  it("ends a session into a DRAFT summary of its parts", async () => {
    const a = await make();
    const g = await chat(a, "tok-01", { text: "Kako je z mojo rana?" });
    expect(g.json().type).toBe("GUIDANCE");
    await chat(a, "tok-01", { sessionId: "chat-1", text: "Kakšno je vreme?" });
    await chat(a, "tok-01", { sessionId: "chat-1", startSurvey: true });
    await chat(a, "tok-01", { sessionId: "chat-1", surveyAnswerId: "today" });
    const res = await post(a, "/chat/chat-1/end", "tok-01");
    expect(res.statusCode).toBe(200);
    const s = res.json();
    expect(s).toMatchObject({
      id: "sum-1",
      sessionId: "chat-1",
      patientId: "pat-01",
      summaryStatus: "DRAFT",
      createdAt: "2026-11-21T08:00:00+01:00",
      botGuidanceGiven: [g.json().text],
      patientQuestions: ["Kako je z mojo rana?", "Kakšno je vreme?"],
      surveyAnswers: [
        {
          nodeId: "onset",
          question: "Kdaj se je težava začela?",
          answerId: "today",
          answer: "Danes",
        },
      ],
    });
    expect(s.confirmedAt).toBeUndefined();
    expect(s.fullTranscript).toHaveLength(8);
    await chat(a, "tok-02", { text: "vreme" });
    expect((await post(a, "/chat/chat-2/end", "tok-02")).json().id).toBe(
      "sum-2",
    );
  });

  it("guards end with the token and the session's patient", async () => {
    const a = await make();
    await chat(a, "tok-01", { text: "vreme" });
    expect((await post(a, "/chat/chat-1/end")).statusCode).toBe(401);
    expect((await post(a, "/chat/chat-1/end", "tok-02")).statusCode).toBe(404);
    expect((await post(a, "/chat/chat-9/end", "tok-01")).statusCode).toBe(404);
  });

  it("confirms only an ended session, and shows staff only SENT ones", async () => {
    const a = await make();
    await chat(a, "tok-01", { text: "vreme" });
    const early = await post(a, "/chat/chat-1/summary/confirm", "tok-01");
    expect(early.statusCode).toBe(409);
    expect(early.json().error.code).toBe("conflict");
    expect((await get(a, "/chat/chat-1/summary", "tok-01")).statusCode).toBe(
      404,
    );
    await post(a, "/chat/chat-1/end", "tok-01");
    const own = await get(a, "/chat/chat-1/summary", "tok-01");
    expect(own.statusCode).toBe(200);
    expect(own.json().summaryStatus).toBe("DRAFT");
    const staff = await get(a, "/chat/chat-1/summary");
    expect(staff.statusCode).toBe(404);
    expect(staff.json().error.code).toBe("not_found");
    expect((await get(a, "/chat/chat-1/summary", "tok-02")).statusCode).toBe(
      404,
    );
    await a.inject({
      method: "POST",
      url: "/sim/advance",
      payload: { minutes: 30 },
    });
    const ok = await post(a, "/chat/chat-1/summary/confirm", "tok-01");
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({
      summaryStatus: "SENT",
      confirmedAt: "2026-11-21T08:30:00+01:00",
    });
    const sent = await get(a, "/chat/chat-1/summary");
    expect(sent.statusCode).toBe(200);
    expect(sent.json().summaryStatus).toBe("SENT");
  });
});
