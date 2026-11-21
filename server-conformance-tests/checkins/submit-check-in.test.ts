// conformance tests of checkins:submit-check-in
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  call,
  get,
  show,
  startService,
  type Res,
  type Service,
} from "./server.js";

// One service; each submitting test advances 1440 minutes first and uses its own patient.
let svc: Service;
beforeAll(async () => {
  svc = await startService();
}, 120_000);
afterAll(async () => {
  await svc?.stop();
});

async function advanceDay(): Promise<void> {
  const adv = await call(svc, "POST", "/sim/advance", { minutes: 1440 });
  expect(adv.status, `advance 1440: ${show(adv)}`).toBe(200);
}

function count(r: Res): number {
  return Array.isArray(r.body) ? r.body.length : -1;
}

describe("checkins:submit-check-in", () => {
  // conformance scenario t10-magic-link of checkins:submit-check-in
  it("t10-magic-link", async () => {
    const TOKEN = "tok-08";
    await advanceDay();
    // Step 1: open the magic link - no login, no header.
    const view = await call(svc, "GET", `/p/${TOKEN}`);
    expect(view.status, `step 1 GET /p/${TOKEN}: ${show(view)}`).toBe(200);
    const questions = get(view.body, "protocol.questions");
    expect(Array.isArray(questions), `protocol.questions: ${show(view)}`).toBe(
      true,
    );
    // Step 2: preview the ticked symptoms.
    const prev = await call(
      svc,
      "POST",
      "/checkins/preview",
      { symptoms: [] },
      TOKEN,
    );
    expect(prev.status, `step 2 preview: ${show(prev)}`).toBe(200);
    // Step 3: submit the final check-in.
    const sub = await call(
      svc,
      "POST",
      "/checkins",
      { final: true, wellbeing: 4, pain: 2, symptoms: [] },
      TOKEN,
    );
    expect(sub.status, `step 3 submit: ${show(sub)}`).toBe(201);
    const id = get(sub.body, "checkIn.id");
    expect(get(sub.body, "checkIn.patientId"), show(sub)).toBe("pat-08");
    const hist = await call(svc, "GET", "/patients/pat-08/checkins");
    const ids = Array.isArray(hist.body)
      ? hist.body.map((c) => get(c, "id"))
      : [];
    expect(ids, `stored check-ins: ${show(hist)}`).toContain(id);
  });

  // conformance scenario t15-required-fields of checkins:submit-check-in
  it("t15-required-fields", async () => {
    const TOKEN = "tok-11";
    const before = await call(svc, "GET", "/patients/pat-11/checkins");
    const missing = [
      { final: true, pain: 2, symptoms: [] },
      { final: true, wellbeing: 4, symptoms: [] },
      { final: true, wellbeing: 4, pain: 2 },
    ];
    for (const body of missing) {
      const r = await call(svc, "POST", "/checkins", body, TOKEN);
      expect(r.status, `${JSON.stringify(body)}: ${show(r)}`).toBe(422);
      expect(
        get(r.body, "error.code"),
        `${JSON.stringify(body)}: ${show(r)}`,
      ).toBe("validation_error");
    }
    const after = await call(svc, "GET", "/patients/pat-11/checkins");
    expect(after.body, "a rejected check-in was stored").toEqual(before.body);

    const draft = await call(
      svc,
      "POST",
      "/checkins",
      { final: false, wellbeing: 3 },
      TOKEN,
    );
    expect(draft.status, `draft: ${show(draft)}`).toBe(200);
    expect(get(draft.body, "wellbeing"), show(draft)).toBe(3);
    const slotDay = get(draft.body, "slotDay");
    const slotIndex = get(draft.body, "slotIndex");

    // Move time past the slot's due time so its reminder is sent.
    const view = await call(svc, "GET", `/p/${TOKEN}`);
    const dueAt = Date.parse(String(get(view.body, "currentSlot.dueAt")));
    const now = await call(svc, "GET", "/sim/now");
    const nowMs = Date.parse(String(get(now.body, "now")));
    expect(
      Number.isNaN(dueAt) || Number.isNaN(nowMs),
      `${show(view)} ${show(now)}`,
    ).toBe(false);
    if (dueAt > nowMs) {
      const minutes = Math.ceil((dueAt - nowMs) / 60000) + 1;
      const adv = await call(svc, "POST", "/sim/advance", { minutes });
      expect(adv.status, show(adv)).toBe(200);
    }
    const rem = await call(svc, "GET", "/reminders?patientId=pat-11");
    expect(rem.status, show(rem)).toBe(200);
    const list = Array.isArray(rem.body) ? rem.body : [];
    const mine = list.find(
      (x) => get(x, "slotDay") === slotDay && get(x, "slotIndex") === slotIndex,
    );
    expect(
      mine,
      `reminder for slot ${String(slotDay)}/${String(slotIndex)}: ${show(rem)}`,
    ).toBeDefined();
    expect(get(mine, "draftPending"), show(rem)).toBe(true);
    const back = await call(svc, "GET", `/p/${TOKEN}`);
    expect(
      get(back.body, "draft.wellbeing"),
      `draft in patient view: ${show(back)}`,
    ).toBe(3);
  });

  // conformance scenario t16-red-flag-check-in of checkins:submit-check-in
  it("t16-red-flag-check-in", async () => {
    const TOKEN = "tok-12";
    await advanceDay();
    const prev = await call(
      svc,
      "POST",
      "/checkins/preview",
      { symptoms: ["vomiting"] },
      TOKEN,
    );
    expect(prev.status, show(prev)).toBe(200);
    expect(get(prev.body, "showContactDoctor"), show(prev)).toBe(true);
    expect(String(get(prev.body, "message")), show(prev)).toContain(
      "Kontaktirajte zdravnika",
    );
    const sub = await call(
      svc,
      "POST",
      "/checkins",
      { final: true, wellbeing: 4, pain: 2, symptoms: ["vomiting"] },
      TOKEN,
    );
    expect(sub.status, show(sub)).toBe(201);
    expect(get(sub.body, "showContactDoctor"), show(sub)).toBe(true);
    expect(get(sub.body, "assessment.status"), show(sub)).toBe("RED");
    expect(get(sub.body, "alertCreated"), show(sub)).toBe(true);
  });

  // conformance scenario fever-red of checkins:submit-check-in
  it("fever-red", async () => {
    await advanceDay();
    const sub = await call(
      svc,
      "POST",
      "/checkins",
      { final: true, wellbeing: 4, pain: 1, symptoms: [], temperatureC: 38.7 },
      "tok-09",
    );
    expect(sub.status, show(sub)).toBe(201);
    expect(get(sub.body, "assessment.status"), show(sub)).toBe("RED");
    expect(get(sub.body, "reassuranceAllowed"), show(sub)).toBe(false);
    expect(get(sub.body, "alertCreated"), show(sub)).toBe(true);
    expect(get(sub.body, "reassuranceText"), show(sub)).toBeUndefined();
  });

  // conformance scenario stable-green of checkins:submit-check-in
  it("stable-green", async () => {
    await advanceDay();
    const sub = await call(
      svc,
      "POST",
      "/checkins",
      { final: true, wellbeing: 5, pain: 0, symptoms: [], temperatureC: 36.8 },
      "tok-10",
    );
    expect(sub.status, show(sub)).toBe(201);
    expect(get(sub.body, "assessment.status"), show(sub)).toBe("GREEN");
    expect(get(sub.body, "reassuranceAllowed"), show(sub)).toBe(true);
    expect(get(sub.body, "reassuranceText"), show(sub)).toBe(
      "v okviru pričakovanega za ta dan",
    );
  });

  // conformance scenario one-final-per-slot of checkins:submit-check-in
  it("one-final-per-slot", async () => {
    await advanceDay();
    const before = await call(svc, "GET", "/patients/pat-03/checkins");
    expect(before.status, show(before)).toBe(200);
    const body = { final: true, wellbeing: 4, pain: 3, symptoms: [] };
    const first = await call(svc, "POST", "/checkins", body, "tok-03");
    expect(first.status, `first: ${show(first)}`).toBe(201);
    const again = await call(svc, "POST", "/checkins", body, "tok-03");
    expect(again.status, `again: ${show(again)}`).toBe(409);
    expect(get(again.body, "error.code"), show(again)).toBe(
      "already_submitted",
    );
    const after = await call(svc, "GET", "/patients/pat-03/checkins");
    expect(count(after), `before ${show(before)} after ${show(after)}`).toBe(
      count(before) + 1,
    );
  });

  // conformance scenario first-check-in-without-trend of checkins:submit-check-in
  it("first-check-in-without-trend", async () => {
    await advanceDay();
    const sub = await call(
      svc,
      "POST",
      "/checkins",
      { final: true, wellbeing: 4, pain: 3, symptoms: [] },
      "tok-04",
    );
    expect(sub.status, show(sub)).toBe(201);
  });
});
