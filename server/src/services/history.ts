import { NotFoundError } from "../errors.js";
import type { CheckIn } from "../core/seed.js";
import type { Assessment } from "../core/triage.js";
import type { StoreRepository } from "../repositories/store.js";
import { SL } from "../strings.sl.js";

/** Reads the append-only check-in and assessment history of patients. */
export class HistoryService {
  /** Creates the service over the store. */
  constructor(private readonly store: StoreRepository) {}

  private requirePatient(patientId: string): void {
    if (!this.store.listPatients().some((p) => p.id === patientId))
      throw new NotFoundError(SL.errors.notFound);
  }

  /** The check-ins of a patient, oldest first; throws NotFoundError for an unknown patient. */
  checkIns(patientId: string): CheckIn[] {
    this.requirePatient(patientId);
    return this.store
      .listCheckIns()
      .filter((c) => c.patientId === patientId)
      .map((c, i) => ({ c, i }))
      .sort(
        (a, b) =>
          Date.parse(a.c.timestamp) - Date.parse(b.c.timestamp) || a.i - b.i,
      )
      .map(({ c }) => c);
  }

  /** The assessments of a patient, oldest first; throws NotFoundError for an unknown patient. */
  assessments(patientId: string): Assessment[] {
    this.requirePatient(patientId);
    return this.store
      .listAssessments()
      .filter((a) => a.patientId === patientId)
      .map((a, i) => ({ a, i }))
      .sort(
        (x, y) =>
          Date.parse(x.a.createdAt) - Date.parse(y.a.createdAt) || x.i - y.i,
      )
      .map(({ a }) => a);
  }
}
