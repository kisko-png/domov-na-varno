// conformance tests of checkins:patient-token
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call, get, show, startService, type Service } from "./server.js";

let svc: Service;
beforeAll(async () => {
  svc = await startService();
}, 120_000);
afterAll(async () => {
  await svc?.stop();
});

describe("checkins:patient-token", () => {
  // conformance scenario missing-or-unknown-token of checkins:patient-token
  it("missing-or-unknown-token", async () => {
    const none = await call(svc, "POST", "/checkins/preview", { symptoms: [] });
    expect(none.status, `no token: ${show(none)}`).toBe(401);
    expect(get(none.body, "error.code"), `no token: ${show(none)}`).toBe(
      "unauthenticated",
    );
    const bad = await call(
      svc,
      "POST",
      "/checkins/preview",
      { symptoms: [] },
      "tok-99",
    );
    expect(bad.status, `tok-99: ${show(bad)}`).toBe(401);
    expect(get(bad.body, "error.code"), `tok-99: ${show(bad)}`).toBe(
      "unauthenticated",
    );
  });
});
