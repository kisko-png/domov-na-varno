import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { getProtocol } from "../core/protocols.js";
import { checkInSlots } from "../core/schedule.js";
import { formatInstant } from "../core/time.js";
import { memoryClockRepository } from "../repositories/clock.js";
import {
  memoryStoreRepository,
  type Reminder,
  type StoreRepository,
} from "../repositories/store.js";
import { buildAssessedSeed } from "./seed.js";

const REAL = Date.parse("2026-11-21T07:00:00Z");
const H = 3600000;
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

const get = async (a: FastifyInstance, q = ""): Promise<Reminder[]> => {
  const res = await a.inject({ url: `/reminders${q}` });
  expect(res.statusCode).toBe(200);
  return res.json();
};

/** The reminders expected for pat-05 (no check-ins after day 4) at `nowMs`. */
function expectedPat05(nowMs: number) {
  const patient = store.listPatients().find((p) => p.id === "pat-05")!;
  const slots = checkInSlots(getProtocol(patient.protocolId), patient).filter(
    (s) => s.day >= 5 && Date.parse(s.dueAt) <= nowMs,
  );
  const out: { kind: string; slotDay: number; sentAt: string }[] = [];
  for (const s of slots) {
    out.push({ kind: "FIRST", slotDay: s.day, sentAt: s.dueAt });
    const f = Date.parse(s.dueAt) + 3 * H;
    if (f <= nowMs)
      out.push({ kind: "FOLLOW_UP", slotDay: s.day, sentAt: formatInstant(f) });
  }
  return out.sort((a, b) => Date.parse(b.sentAt) - Date.parse(a.sentAt));
}

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe("GET /reminders", () => {
  it("sends FIRST and FOLLOW_UP reminders of uncovered slots after the latest check-in, latest first", async () => {
    const a = await make();
    const list = await get(a, "?patientId=pat-05");
    const expected = expectedPat05(REAL);
    expect(expected.length).toBeGreaterThan(4);
    expect(
      list.map((r) => ({ kind: r.kind, slotDay: r.slotDay, sentAt: r.sentAt })),
    ).toEqual(expected);
    for (const r of list) {
      expect(r.patientId).toBe("pat-05");
      expect(r.slotIndex).toBe(1);
      expect(r.draftPending).toBe(false);
      expect(r.id).toMatch(/^rem-\d+$/);
      expect(r.text).toMatch(/vprašalnik/);
    }
  });

  it("lists every patient's reminders latest first, with unique ids from rem-1", async () => {
    const a = await make();
    const all = await get(a);
    expect(all.length).toBeGreaterThan(0);
    const times = all.map((r) => Date.parse(r.sentAt));
    expect([...times].sort((x, y) => y - x)).toEqual(times);
    const ids = all.map((r) => Number(r.id.slice(4))).sort((x, y) => x - y);
    expect(ids).toEqual(all.map((_, i) => i + 1));
    expect(all.some((r) => r.patientId === "pat-05")).toBe(true);
  });

  it("sends each reminder once, and the follow-up once 3 hours have passed", async () => {
    const a = await make();
    const first = await get(a, "?patientId=pat-05");
    expect(await get(a, "?patientId=pat-05")).toEqual(first);
    await a.inject({
      method: "POST",
      url: "/sim/advance",
      payload: { minutes: 24 * 60 },
    });
    const later = await get(a, "?patientId=pat-05");
    expect(later.map((r) => r.sentAt)).toEqual(
      expectedPat05(REAL + 24 * H).map((r) => r.sentAt),
    );
    for (const r of first) expect(later).toContainEqual(r);
  });

  it("sends nothing for a slot covered by a check-in", async () => {
    const a = await make();
    await a.inject({
      method: "POST",
      url: "/sim/advance",
      payload: { minutes: 24 * 60 },
    });
    const view = (await a.inject({ url: "/p/tok-09" })).json();
    await a.inject({
      method: "POST",
      url: "/checkins",
      headers: { "x-patient-token": "tok-09" },
      payload: { final: true, wellbeing: 4, pain: 2, symptoms: [] },
    });
    const list = await get(a, "?patientId=pat-09");
    expect(list.some((r) => r.slotDay === view.currentSlot.day)).toBe(false);
  });

  it("marks draftPending when the patient has a draft of the slot", async () => {
    const a = await make();
    const view = (await a.inject({ url: "/p/tok-05" })).json();
    await a.inject({
      method: "POST",
      url: "/checkins",
      headers: { "x-patient-token": "tok-05" },
      payload: { final: false, pain: 4 },
    });
    const list = await get(a, "?patientId=pat-05");
    const slot = list.filter((r) => r.slotDay === view.currentSlot.day);
    expect(slot.length).toBeGreaterThan(0);
    for (const r of slot) expect(r.draftPending).toBe(true);
    for (const r of list.filter((x) => x.slotDay !== view.currentSlot.day))
      expect(r.draftPending).toBe(false);
  });
});
