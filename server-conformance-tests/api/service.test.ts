// conformance tests of checkins:patient-view
// conformance tests of checkins:sim-clock
// conformance tests of chat:chat-guidance
// conformance tests of api:admin-reset
import { afterAll, beforeAll, expect, it } from "vitest";
import {
  call,
  get,
  show,
  startService,
  type Service,
} from "../checkins/server.js";

// One service; order matters: previous-values runs right after start, reset-to-seed last.
let svc: Service;
beforeAll(async () => {
  svc = await startService();
}, 120_000);
afterAll(async () => {
  await svc?.stop();
});

// conformance scenario previous-values of checkins:patient-view
it("previous-values", async () => {
  const r = await call(svc, "GET", "/p/tok-01");
  expect(r.status, show(r)).toBe(200);
  expect(get(r.body, "trendApplies"), show(r)).toBe(true);
  expect(get(r.body, "previousCheckIn.pain"), show(r)).toBe(7);
  expect(get(r.body, "previousCheckIn.wellbeing"), show(r)).toBe(2);
});

// conformance scenario inflected-swelling of chat:chat-guidance
it("inflected-swelling", async () => {
  const r = await call(
    svc,
    "POST",
    "/chat",
    { text: "Noga mi je otekla" },
    "tok-03",
  );
  expect(r.status, show(r)).toBe(200);
  expect(get(r.body, "type"), show(r)).toBe("GUIDANCE");
  const w = get(r.body, "watchFor");
  expect(
    Array.isArray(w) && w.length > 0,
    `non-empty watchFor: ${show(r)}`,
  ).toBe(true);
});

// conformance scenario driving-topic of chat:chat-guidance
it("driving-topic", async () => {
  const r = await call(
    svc,
    "POST",
    "/chat",
    { text: "Kdaj bom lahko spet vozil avto?" },
    "tok-07",
  );
  expect(r.status, show(r)).toBe(200);
  expect(get(r.body, "type"), show(r)).toBe("GUIDANCE");
});

// conformance scenario advance-without-body of checkins:sim-clock
it("advance-without-body", async () => {
  const res = await fetch(`${svc.base}/sim/advance`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  const text = await res.text();
  expect(res.status, text).toBe(200);
  const body: unknown = JSON.parse(text);
  expect(get(body, "offsetMinutes"), text).toBe(1440);
});

// conformance scenario reset-to-seed of api:admin-reset
it("reset-to-seed", async () => {
  const rep = await call(svc, "POST", "/reports", {
    patient: {
      name: "Nova Pacientka",
      phone: "+386 40 000 099",
      dischargeDate: "2025-03-01",
      preferredCheckInTime: "09:00",
    },
    procedure: "Operacija na odprtem srcu - CARDIAC SURGERY",
    procedureDate: "2025-02-27",
    medications: [],
    specialWarnings: [],
    restrictions: [],
    recommendations: "Počitek.",
    doctorContactPhone: "+386 1 000 0000",
  });
  expect(rep.status, show(rep)).toBe(201);
  const adv = await call(svc, "POST", "/sim/advance", { minutes: 600 });
  expect(adv.status, show(adv)).toBe(200);
  const res = await fetch(`${svc.base}/admin/reset`, { method: "POST" });
  const text = await res.text();
  expect(res.status, text).toBe(200);
  const body: unknown = JSON.parse(text);
  expect(get(body, "offsetMinutes"), text).toBe(0);
  const pts = await call(svc, "GET", "/patients");
  expect(pts.status, show(pts)).toBe(200);
  const ids = Array.isArray(pts.body)
    ? pts.body.map((p) => String(get(p, "patient.id"))).sort()
    : [];
  const want = Array.from(
    { length: 12 },
    (_, i) => `pat-${String(i + 1).padStart(2, "0")}`,
  );
  expect(ids, show(pts)).toEqual(want);
});
