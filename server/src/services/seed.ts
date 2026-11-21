import { protocolOfPatient } from "../core/personalProtocol.js";
import { buildSeed, type CheckIn } from "../core/seed.js";
import { assessCheckIn, type Alert, type Assessment } from "../core/triage.js";
import { toMillis } from "../core/time.js";
import type { StoreContents, StoreRepository } from "../repositories/store.js";

/** Builds the seed for `now` and assesses each seeded check-in in time order. */
export function buildAssessedSeed(now: Date): StoreContents {
  const seed = buildSeed(now);
  const ordered = seed.checkIns
    .map((c, i) => ({ c, i, t: toMillis(c.timestamp) }))
    .sort((a, b) => a.t - b.t || a.i - b.i)
    .map((x) => x.c);
  const assessments: Assessment[] = [];
  const alerts: Alert[] = [];
  const seen = new Map<string, CheckIn[]>();
  for (const checkIn of ordered) {
    const patient = seed.patients.find((p) => p.id === checkIn.patientId);
    if (patient === undefined) continue;
    const history = seen.get(patient.id) ?? [];
    const result = assessCheckIn({
      checkIn,
      history: [...history],
      protocol: protocolOfPatient(patient, seed.reports),
      patient,
      now: checkIn.timestamp,
      assessmentId: `asm-${assessments.length + 1}`,
      alertId: `alr-${alerts.length + 1}`,
    });
    assessments.push(result.assessment);
    if (result.alert) alerts.push(result.alert);
    seen.set(patient.id, [...history, checkIn]);
  }
  return { ...seed, checkIns: ordered, assessments, alerts };
}

/** Fills an empty store with the assessed seed for `now`; returns whether it seeded. */
export function seedStoreIfEmpty(store: StoreRepository, now: Date): boolean {
  if (!store.isEmpty()) return false;
  store.addAll(buildAssessedSeed(now));
  return true;
}
