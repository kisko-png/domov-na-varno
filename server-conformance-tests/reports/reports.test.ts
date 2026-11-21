// conformance tests of reports:create-report
// conformance tests of reports:personal-protocol
import { afterAll, beforeAll, expect, it } from "vitest";
import {
  call,
  get,
  show,
  startService,
  type Service,
} from "../checkins/server.js";

let svc: Service;
// One service for the file; order matters: no-match (12), match-cardiac (13), then T9.
beforeAll(async () => {
  svc = await startService();
}, 120_000);
afterAll(async () => {
  await svc?.stop();
});

function report(procedure: string, medications: string[]): unknown {
  return {
    patient: {
      name: "Testna Oseba",
      phone: "+386 40 111 222",
      dischargeDate: "2025-03-01",
      preferredCheckInTime: "09:00",
    },
    procedure,
    procedureDate: "2025-02-27",
    medications,
    specialWarnings: ["Pazite na rano."],
    restrictions: ["Ne dvigujte bremen."],
    recommendations: "Veliko počivajte.",
    doctorContactPhone: "+386 1 000 0000",
  };
}

async function patientCount(): Promise<number> {
  const r = await call(svc, "GET", "/patients");
  expect(r.status, show(r)).toBe(200);
  expect(Array.isArray(r.body), show(r)).toBe(true);
  return (r.body as unknown[]).length;
}

// acceptance scenario no-match of reports:create-report
it("no-match: unmatched procedure is 422 no_matching_protocol, nothing stored", async () => {
  const r = await call(svc, "POST", "/reports", report("Ekstrakcija zoba", []));
  expect(r.status, show(r)).toBe(422);
  expect(get(r.body, "error.code"), show(r)).toBe("no_matching_protocol");
  expect(await patientCount(), "GET /patients after no-match").toBe(12);
});

// conformance scenario match-cardiac of reports:create-report
it("match-cardiac: cardiac procedure picks cardiac-surgery, GREEN, 13 patients", async () => {
  const r = await call(
    svc,
    "POST",
    "/reports",
    report("Operacija na odprtem srcu - CARDIAC SURGERY", []),
  );
  expect(r.status, show(r)).toBe(201);
  expect(get(r.body, "protocol.id"), show(r)).toBe("cardiac-surgery");
  expect(get(r.body, "status"), show(r)).toBe("GREEN");
  expect(await patientCount(), "GET /patients after match-cardiac").toBe(13);
});

// conformance scenario t9-anticoagulant of reports:personal-protocol
it("T9: a report with an anticoagulant adds bleeding as a red flag", async () => {
  const r = await call(
    svc,
    "POST",
    "/reports",
    report("Bypass operacija srca", ["Apixaban 5 mg"]),
  );
  expect(r.status, show(r)).toBe(201);
  const flags = get(r.body, "protocol.redFlags");
  expect(Array.isArray(flags), show(r)).toBe(true);
  const bleeding = (flags as unknown[]).filter(
    (f) => get(f, "symptom") === "heavy-bleeding",
  );
  expect(
    bleeding.length,
    `bleeding red flag in ${JSON.stringify(flags)}`,
  ).toBeGreaterThan(0);
  const questions = get(r.body, "protocol.questions");
  expect(
    Array.isArray(questions) &&
      questions.some((q: unknown) => get(q, "id") === "heavy-bleeding"),
    `heavy-bleeding symptom in ${JSON.stringify(questions)}`,
  ).toBe(true);
});
