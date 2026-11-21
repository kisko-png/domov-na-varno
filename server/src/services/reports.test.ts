import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { memoryClockRepository } from "../repositories/clock.js";
import {
  memoryStoreRepository,
  type StoreRepository,
} from "../repositories/store.js";
import { buildAssessedSeed } from "./seed.js";
import { getProtocol } from "../core/protocols.js";
import { isAnticoagulant, personalProtocol } from "../core/personalProtocol.js";
import type { Report } from "../core/seed.js";

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

const BODY = {
  patient: {
    name: "Marija Novak",
    phone: "+386 40 123 456",
    dischargeDate: "2026-11-01",
    preferredCheckInTime: "08:00",
  },
  procedure: "Operacija SRCA - obvod",
  procedureDate: "2026-10-28",
  medications: ["Apixaban 2,5 mg"],
  specialWarnings: ["W1"],
  restrictions: ["R1", "R2"],
  recommendations: "Hodite.",
  doctorContactPhone: "+386 1 000",
};

function report(medications: string[]): Report {
  return {
    id: "r",
    patientId: "p",
    procedure: "x",
    procedureDate: "2026-01-01",
    medications,
    specialWarnings: [],
    restrictions: [],
    recommendations: "",
    doctorContactPhone: "",
  };
}

describe("personal protocol", () => {
  it("recognises anticoagulants case-insensitively", () => {
    expect(isAnticoagulant("VARFARIN 5 mg")).toBe(true);
    expect(isAnticoagulant("paracetamol")).toBe(false);
  });

  it("adds the bleeding red flag and symptom when missing", () => {
    const p = personalProtocol(
      getProtocol("cardiac-surgery"),
      report(["heparin"]),
    );
    expect(p.redFlags.at(-1)).toMatchObject({
      id: "anticoagulant-bleeding",
      symptom: "heavy-bleeding",
      severity: "CONTACT_DOCTOR",
    });
    expect(p.questions.find((q) => q.id === "heavy-bleeding")?.label).toBe(
      "Močna krvavitev",
    );
    expect(getProtocol("cardiac-surgery").redFlags).toHaveLength(6);
  });

  it("keeps an existing heavy-bleeding symptom once", () => {
    const p = personalProtocol(
      getProtocol("hip-replacement"),
      report(["apixaban"]),
    );
    expect(p.questions.filter((q) => q.id === "heavy-bleeding")).toHaveLength(
      1,
    );
    expect(p.redFlags.some((f) => f.id === "anticoagulant-bleeding")).toBe(
      true,
    );
  });

  it("is the base protocol without an anticoagulant", () => {
    expect(
      personalProtocol(getProtocol("cardiac-surgery"), report(["aspirin"])),
    ).toEqual(getProtocol("cardiac-surgery"));
  });

  it("is used for the seeded anticoagulant patient's view and preview", async () => {
    const a = await make();
    const view = await a.inject({ method: "GET", url: "/p/tok-02" });
    const flags = (view.json() as { protocol: { redFlags: { id: string }[] } })
      .protocol.redFlags;
    expect(flags.some((f) => f.id === "anticoagulant-bleeding")).toBe(true);
    const other = await a.inject({ method: "GET", url: "/p/tok-05" });
    expect(other.body).not.toContain("anticoagulant-bleeding");
    const prev = await a.inject({
      method: "POST",
      url: "/checkins/preview",
      headers: { "x-patient-token": "tok-02" },
      payload: { symptoms: ["heavy-bleeding"] },
    });
    expect(prev.body).toContain("anticoagulant-bleeding");
  });
});

describe("POST /reports", () => {
  it("creates the patient with a personal protocol", async () => {
    const a = await make();
    const res = await a.inject({
      method: "POST",
      url: "/reports",
      payload: BODY,
    });
    expect(res.statusCode).toBe(201);
    const d = res.json() as {
      patient: {
        id: string;
        reportId: string;
        protocolId: string;
        accessToken: string;
      };
      status: string;
      protocol: { redFlags: { id: string }[]; questions: { id: string }[] };
      patientInstructions: string[];
      report: { id: string; patientId: string };
    };
    expect(d.patient.id).toBe("pat-13");
    expect(d.patient.reportId).toBe("rep-13");
    expect(d.report).toMatchObject({ id: "rep-13", patientId: "pat-13" });
    expect(d.patient.protocolId).toBe("cardiac-surgery");
    expect(d.patient.accessToken).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(d.status).toBe("GREEN");
    expect(d.patientInstructions).toEqual(["W1", "R1", "R2", "Hodite."]);
    expect(
      d.protocol.redFlags.some((f) => f.id === "anticoagulant-bleeding"),
    ).toBe(true);
    expect(store.listPatients()).toHaveLength(13);
    expect(store.listAssessments().some((x) => x.patientId === "pat-13")).toBe(
      false,
    );

    const second = await a.inject({
      method: "POST",
      url: "/reports",
      payload: BODY,
    });
    expect((second.json() as { patient: { id: string } }).patient.id).toBe(
      "pat-14",
    );
  });

  it("uses the first catalogue protocol that matches", async () => {
    const a = await make();
    const res = await a.inject({
      method: "POST",
      url: "/reports",
      payload: { ...BODY, procedure: "Kolk in srca", medications: [] },
    });
    expect(
      (res.json() as { patient: { protocolId: string } }).patient.protocolId,
    ).toBe("hip-replacement");
  });

  it("answers 422 no_matching_protocol and stores nothing", async () => {
    const a = await make();
    const res = await a.inject({
      method: "POST",
      url: "/reports",
      payload: { ...BODY, procedure: "Ekstrakcija zoba" },
    });
    expect(res.statusCode).toBe(422);
    expect((res.json() as { error: { code: string } }).error.code).toBe(
      "no_matching_protocol",
    );
    expect(store.listPatients()).toHaveLength(12);
    expect(store.listReports()).toHaveLength(12);
  });

  it("answers 422 validation_error on an invalid body", async () => {
    const a = await make();
    const res = await a.inject({
      method: "POST",
      url: "/reports",
      payload: { procedure: "kolk" },
    });
    expect(res.statusCode).toBe(422);
    expect((res.json() as { error: { code: string } }).error.code).toBe(
      "validation_error",
    );
  });
});
