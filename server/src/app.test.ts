import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app.js";
import { memoryClockRepository } from "./repositories/clock.js";
import { memoryStoreRepository } from "./repositories/store.js";
import { ClockService } from "./services/clock.js";

const REAL = Date.parse("2026-11-21T07:00:00Z");
let app: FastifyInstance | undefined;

async function make(offset = 0): Promise<FastifyInstance> {
  const built = await buildApp({
    clockRepository: memoryClockRepository(offset),
    storeRepository: memoryStoreRepository(),
    realNow: () => REAL,
    logLevel: "silent",
  });
  app = built;
  return built;
}

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe("ClockService", () => {
  it("adds the offset to the real clock", () => {
    const c = new ClockService(memoryClockRepository(), () => REAL);
    expect(c.current()).toEqual({
      now: "2026-11-21T08:00:00+01:00",
      offsetMinutes: 0,
    });
    expect(c.advance(90)).toEqual({
      now: "2026-11-21T09:30:00+01:00",
      offsetMinutes: 90,
    });
    expect(c.now().getTime()).toBe(REAL + 90 * 60000);
  });
});

describe("GET /sim/now", () => {
  it("returns the simulated now and offset", async () => {
    const app = await make(1440);
    const res = await app.inject({ method: "GET", url: "/sim/now" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      now: "2026-11-22T08:00:00+01:00",
      offsetMinutes: 1440,
    });
    expect(res.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("echoes X-Request-ID", async () => {
    const app = await make();
    const res = await app.inject({
      method: "GET",
      url: "/sim/now",
      headers: { "x-request-id": "abc" },
    });
    expect(res.headers["x-request-id"]).toBe("abc");
  });
});

describe("POST /sim/advance", () => {
  it("adds minutes to the offset, cumulatively", async () => {
    const app = await make();
    await app.inject({
      method: "POST",
      url: "/sim/advance",
      payload: { minutes: 1440 },
    });
    const res = await app.inject({
      method: "POST",
      url: "/sim/advance",
      payload: { minutes: 60 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      now: "2026-11-22T09:00:00+01:00",
      offsetMinutes: 1500,
    });
    const now = await app.inject({ method: "GET", url: "/sim/now" });
    expect(now.json()).toEqual(res.json());
  });

  it.each([{}, { minutes: 0 }, { minutes: 1.5 }, { minutes: "x" }])(
    "rejects %j with 422 validation_error",
    async (payload) => {
      const app = await make();
      const res = await app.inject({
        method: "POST",
        url: "/sim/advance",
        payload,
      });
      expect(res.statusCode).toBe(422);
      const body = res.json();
      expect(body.error.code).toBe("validation_error");
      expect(body.error.details[0].field).toBe("minutes");
    },
  );

  it("answers a bad JSON body with validation_error", async () => {
    const app = await make();
    const res = await app.inject({
      method: "POST",
      url: "/sim/advance",
      headers: { "content-type": "application/json" },
      payload: "{",
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("validation_error");
  });
});

describe("unknown routes", () => {
  it("answer 404 not_found", async () => {
    const app = await make();
    const res = await app.inject({ method: "GET", url: "/nope" });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("not_found");
  });
});
