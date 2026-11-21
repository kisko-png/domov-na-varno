// conformance tests of alerts:silence-on-read
// conformance tests of alerts:list-patients
// conformance tests of alerts:escalate-alerts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  call,
  get,
  show,
  startService,
  type Service,
} from "../checkins/server.js";

let svc: Service;
// One service for the file: silence and dashboard scenarios run first, on the state right after start.
beforeAll(async () => {
  svc = await startService();
}, 120_000);
afterAll(async () => {
  await svc?.stop();
});

function list(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function hasR5(a: unknown): boolean {
  return list(get(a, "reasons")).some((r) => get(r, "ruleId") === "R5");
}

/** Advances 1440 minutes, then submits a RED check-in for a seeded minor abdominal patient (used once per service) and returns its assessment id. */
async function redCheckIn(token: string): Promise<string> {
  const adv = await call(svc, "POST", "/sim/advance", { minutes: 1440 });
  expect(adv.status, `advance 1440: ${show(adv)}`).toBe(200);
  const sub = await call(
    svc,
    "POST",
    "/checkins",
    { final: true, wellbeing: 4, pain: 2, symptoms: ["vomiting"] },
    token,
  );
  expect(sub.status, `RED check-in: ${show(sub)}`).toBe(201);
  expect(get(sub.body, "assessment.status"), show(sub)).toBe("RED");
  const id = get(sub.body, "assessment.id");
  expect(typeof id, show(sub)).toBe("string");
  return id as string;
}

async function alertsOf(asmId: string): Promise<unknown[]> {
  const r = await call(svc, "GET", "/alerts");
  expect(r.status, `GET /alerts: ${show(r)}`).toBe(200);
  return list(r.body).filter((a) => get(a, "assessmentId") === asmId);
}

describe("alerts:silence-on-read", () => {
  // conformance scenario silent-patient-red of alerts:silence-on-read
  it("silent-patient-red", async () => {
    const r = await call(svc, "GET", "/patients");
    expect(r.status, show(r)).toBe(200);
    const p = list(r.body).find((i) => get(i, "patient.id") === "pat-05");
    expect(p, `pat-05 in ${show(r)}`).toBeDefined();
    expect(get(p, "status"), JSON.stringify(p)).toBe("RED");
    const la = get(p, "latestAssessment");
    const reasons = list(get(la, "reasons"));
    expect(reasons.length, JSON.stringify(la)).toBe(1);
    expect(get(reasons[0], "ruleId"), JSON.stringify(la)).toBe("R5");
    expect(get(la, "checkInId"), JSON.stringify(la)).toBeUndefined();
  });

  // conformance scenario no-duplicate-silence of alerts:silence-on-read
  it("no-duplicate-silence", async () => {
    const a = await call(svc, "GET", "/patients");
    const b = await call(svc, "GET", "/patients");
    expect([a.status, b.status], show(b)).toEqual([200, 200]);
    const r = await call(svc, "GET", "/assessments?patientId=pat-05");
    expect(r.status, show(r)).toBe(200);
    const silent = list(r.body).filter(
      (x) => hasR5(x) && get(x, "status") === "RED",
    );
    expect(silent.length, `RED R5 assessments: ${show(r)}`).toBe(1);
  });
});

describe("alerts:list-patients", () => {
  // conformance scenario seeded-dashboard-order of alerts:list-patients
  it("seeded-dashboard-order", async () => {
    const r = await call(svc, "GET", "/patients");
    expect(r.status, show(r)).toBe(200);
    const items = list(r.body);
    expect(items.length, show(r)).toBe(12);
    const rank: Record<string, number> = { RED: 0, YELLOW: 1, GREEN: 2 };
    const ranks = items.map((i) => rank[String(get(i, "status"))] ?? -1);
    const order = items.map(
      (i) => `${get(i, "patient.id")}:${get(i, "status")}`,
    );
    expect(ranks, `order ${order.join(", ")}`).toEqual(
      [...ranks].sort((x, y) => x - y),
    );
    expect(ranks.includes(-1), `unknown status in ${order.join(", ")}`).toBe(
      false,
    );
    const p9 = items.find((i) => get(i, "patient.id") === "pat-09");
    expect(get(p9, "status"), JSON.stringify(p9)).toBe("GREEN");
    for (const i of items) {
      expect(get(i, "dayAfterDischarge"), JSON.stringify(i)).toBe(8);
    }
  });
});

describe("alerts:escalate-alerts", () => {
  // conformance scenario t8-escalation of alerts:escalate-alerts
  it("t8-escalation", async () => {
    const asmId = await redCheckIn("tok-09");
    const before = await alertsOf(asmId);
    const nurse = before.find((a) => get(a, "recipientRole") === "NURSE");
    expect(
      nurse,
      `NURSE alert for ${asmId}: ${JSON.stringify(before)}`,
    ).toBeDefined();
    expect(get(nurse, "escalatedAt"), JSON.stringify(nurse)).toBeUndefined();
    const adv = await call(svc, "POST", "/sim/advance", { minutes: 15 });
    expect(adv.status, show(adv)).toBe(200);
    const after = await alertsOf(asmId);
    const n2 = after.find((a) => get(a, "id") === get(nurse, "id"));
    expect(typeof get(n2, "escalatedAt"), JSON.stringify(after)).toBe("string");
    const coord = after.filter(
      (a) => get(a, "recipientRole") === "COORDINATOR",
    );
    expect(coord.length, `COORDINATOR alerts: ${JSON.stringify(after)}`).toBe(
      1,
    );
  });

  // conformance scenario acknowledged-not-escalated of alerts:escalate-alerts
  it("acknowledged-not-escalated", async () => {
    const asmId = await redCheckIn("tok-10");
    const before = await alertsOf(asmId);
    const nurse = before.find((a) => get(a, "recipientRole") === "NURSE");
    expect(
      nurse,
      `NURSE alert for ${asmId}: ${JSON.stringify(before)}`,
    ).toBeDefined();
    const ack = await call(
      svc,
      "POST",
      `/alerts/${String(get(nurse, "id"))}/ack`,
    );
    expect(ack.status, show(ack)).toBe(200);
    const adv = await call(svc, "POST", "/sim/advance", { minutes: 20 });
    expect(adv.status, show(adv)).toBe(200);
    const after = await alertsOf(asmId);
    const n2 = after.find((a) => get(a, "id") === get(nurse, "id"));
    expect(n2, JSON.stringify(after)).toBeDefined();
    expect(get(n2, "escalatedAt"), JSON.stringify(n2)).toBeUndefined();
    const coord = after.filter(
      (a) => get(a, "recipientRole") === "COORDINATOR",
    );
    expect(coord, `COORDINATOR alerts: ${JSON.stringify(after)}`).toEqual([]);
  });
});
