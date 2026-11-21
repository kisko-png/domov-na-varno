// conformance tests of checkins:append-only
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call, get, show, startService, type Service } from "./server.js";

let svc: Service;
beforeAll(async () => {
  svc = await startService();
}, 120_000);
afterAll(async () => {
  await svc?.stop();
});

describe("checkins:append-only", () => {
  // conformance scenario t13-append-only of checkins:append-only
  it("t13-append-only", async () => {
    const chk0 = await call(svc, "GET", "/patients/pat-01/checkins");
    const asm0 = await call(svc, "GET", "/assessments?patientId=pat-01");
    expect(chk0.status, show(chk0)).toBe(200);
    expect(asm0.status, show(asm0)).toBe(200);
    const chkId = get(chk0.body, "0.id");
    const asmId = get(asm0.body, "0.id");
    expect(typeof chkId, `seeded check-ins: ${show(chk0)}`).toBe("string");
    expect(typeof asmId, `seeded assessments: ${show(asm0)}`).toBe("string");
    const update = { wellbeing: 1, pain: 10, symptoms: [], status: "RED" };
    for (const url of [
      `/checkins/${String(chkId)}`,
      `/assessments/${String(asmId)}`,
    ]) {
      for (const method of ["PUT", "PATCH", "DELETE"]) {
        const r = await call(
          svc,
          method,
          url,
          method === "DELETE" ? undefined : update,
        );
        expect(r.status, `${method} ${url}: ${show(r)}`).toBe(405);
        expect(get(r.body, "error.code"), `${method} ${url}: ${show(r)}`).toBe(
          "method_not_allowed",
        );
      }
    }
    const chk1 = await call(svc, "GET", "/patients/pat-01/checkins");
    const asm1 = await call(svc, "GET", "/assessments?patientId=pat-01");
    expect(chk1.body, "check-ins changed after rejected updates").toEqual(
      chk0.body,
    );
    expect(asm1.body, "assessments changed after rejected updates").toEqual(
      asm0.body,
    );
  });
});
