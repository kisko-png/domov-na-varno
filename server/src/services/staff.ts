import { protocolOfPatient } from "../core/personalProtocol.js";
import type { RiskTier } from "../core/riskTiers.js";
import { dayAfterDischarge } from "../core/schedule.js";
import type { Patient } from "../core/seed.js";
import { addDays, formatInstant, localDayOf, toMillis } from "../core/time.js";
import {
  assessSilence,
  type Alert,
  type Assessment,
  type Reason,
  type TriageStatus,
} from "../core/triage.js";
import { NotFoundError } from "../errors.js";
import { SL } from "../strings.sl.js";
import type { StoreRepository } from "../repositories/store.js";
import type { ClockService } from "./clock.js";

/** One row of the staff dashboard. */
export interface PatientSummary {
  patient: Patient;
  protocolName: string;
  riskTier: RiskTier;
  dayAfterDischarge: number;
  status: TriageStatus;
  latestAssessment?: Assessment;
  lastCheckInAt?: string;
  openAlerts: number;
}

const RANK: Record<TriageStatus, number> = { RED: 0, YELLOW: 1, GREEN: 2 };

/** One entry of the morning brief. */
export interface BriefEntry {
  patientId: string;
  patientName: string;
  status: TriageStatus;
  reasons: Reason[];
  callScript: string;
}

/** The morning brief of the day before. */
export interface Brief {
  forDay: string;
  generatedAt: string;
  demoNotice: string;
  entries: BriefEntry[];
}

/** NURSE alerts open this long are escalated. */
export const ESCALATE_AFTER_MS = 15 * 60 * 1000;

/** An alert with its assessment's patient, status and reasons. */
export interface AlertView extends Alert {
  patientId: string;
  patientName: string;
  status: TriageStatus;
  reasons: Reason[];
}

/** The latest of a list by a moment, ties going to the later in list order. */
function latestBy<T>(items: T[], at: (x: T) => string): T | undefined {
  let best: T | undefined;
  for (const x of items)
    if (best === undefined || toMillis(at(x)) >= toMillis(at(best))) best = x;
  return best;
}

/** Silence assessment on read, and the staff dashboard. */
export class StaffService {
  /** Creates the service over the store and the simulated clock. */
  constructor(
    private readonly store: StoreRepository,
    private readonly clock: ClockService,
  ) {}

  /** Runs `assessSilence` for every patient at the simulated now and keeps what is new. */
  assessSilences(): void {
    const now = formatInstant(this.clock.now().getTime());
    const checkIns = this.store.listCheckIns();
    for (const patient of this.store.listPatients()) {
      const own = checkIns.filter((c) => c.patientId === patient.id);
      const result = assessSilence({
        patient,
        protocol: protocolOfPatient(patient, this.store.listReports()),
        checkIns: own,
        now,
        assessmentId: `asm-${this.store.listAssessments().length + 1}`,
        alertId: `alr-${this.store.listAlerts().length + 1}`,
      });
      if (result === null) continue;
      const latest = latestBy(own, (c) => c.timestamp);
      const since =
        latest === undefined ? -Infinity : toMillis(latest.timestamp);
      const already = this.store
        .listAssessments()
        .some(
          (a) =>
            a.patientId === patient.id &&
            a.checkInId === undefined &&
            a.status === result.assessment.status &&
            toMillis(a.createdAt) > since,
        );
      if (!already) this.store.addAssessment(result.assessment, result.alert);
    }
  }

  /** Escalates every open, unescalated NURSE alert 15 minutes or older to a COORDINATOR alert. */
  escalateAlerts(): void {
    const nowMs = this.clock.now().getTime();
    const now = formatInstant(nowMs);
    let count = this.store.listAlerts().length;
    for (const alert of this.store.listAlerts()) {
      if (
        alert.recipientRole !== "NURSE" ||
        alert.acknowledgedAt !== undefined ||
        alert.escalatedAt !== undefined ||
        nowMs - toMillis(alert.createdAt) < ESCALATE_AFTER_MS
      )
        continue;
      this.store.updateAlert({ ...alert, escalatedAt: now });
      count += 1;
      this.store.addAlert({
        id: `alr-${count}`,
        assessmentId: alert.assessmentId,
        recipientRole: "COORDINATOR",
        createdAt: now,
      });
    }
  }

  /** Every alert with its assessment and patient, newest first, of one role when given. */
  listAlerts(role?: Alert["recipientRole"]): AlertView[] {
    this.assessSilences();
    this.escalateAlerts();
    const assessments = new Map(
      this.store.listAssessments().map((a) => [a.id, a]),
    );
    const patients = new Map(this.store.listPatients().map((p) => [p.id, p]));
    const views: AlertView[] = [];
    for (const alert of this.store.listAlerts()) {
      if (role !== undefined && alert.recipientRole !== role) continue;
      const a = assessments.get(alert.assessmentId);
      if (a === undefined) continue;
      views.push({
        ...alert,
        patientId: a.patientId,
        patientName: patients.get(a.patientId)?.name ?? "",
        status: a.status,
        reasons: a.reasons,
      });
    }
    // Ties in createdAt: the later stored first.
    return views
      .reverse()
      .sort((x, y) => toMillis(y.createdAt) - toMillis(x.createdAt));
  }

  /** Acknowledges an alert at the simulated now, keeping an earlier acknowledgement. */
  acknowledge(id: string): Alert {
    const alert = this.store.listAlerts().find((a) => a.id === id);
    if (alert === undefined) throw new NotFoundError(SL.errors.notFound);
    if (alert.acknowledgedAt !== undefined) return alert;
    const acked = {
      ...alert,
      acknowledgedAt: formatInstant(this.clock.now().getTime()),
    };
    this.store.updateAlert(acked);
    return acked;
  }

  /** The morning brief: every patient's status and reasons with a call script, ordered as the dashboard. */
  brief(): Brief {
    const rows = this.listPatients();
    const nowMs = this.clock.now().getTime();
    return {
      forDay: addDays(localDayOf(nowMs), -1),
      generatedAt: formatInstant(nowMs),
      demoNotice: SL.patient.demoNotice,
      entries: rows.map((r) => {
        const reasons = r.latestAssessment?.reasons ?? [];
        return {
          patientId: r.patient.id,
          patientName: r.patient.name,
          status: r.status,
          reasons,
          callScript:
            r.status === "GREEN"
              ? SL.patient.noCallNeeded
              : SL.patient.callScript(
                  r.patient.name,
                  r.patient.phone,
                  reasons.map((x) => x.text),
                ),
        };
      }),
    };
  }

  /** The dashboard summary of one patient at the simulated now, without running silence or escalation. */
  summaryOf(patient: Patient): PatientSummary {
    const now = this.clock.now();
    const checkIns = this.store.listCheckIns();
    const assessments = this.store.listAssessments();
    const alerts = this.store.listAlerts();
    const protocol = protocolOfPatient(patient, this.store.listReports());
    const own = assessments.filter((a) => a.patientId === patient.id);
    const ids = new Set(own.map((a) => a.id));
    const latestAssessment = latestBy(own, (a) => a.createdAt);
    const lastCheckIn = latestBy(
      checkIns.filter((c) => c.patientId === patient.id),
      (c) => c.timestamp,
    );
    const row: PatientSummary = {
      patient,
      protocolName: protocol.name,
      riskTier: protocol.riskTier,
      dayAfterDischarge: dayAfterDischarge(patient.dischargeDate, now),
      status: latestAssessment?.status ?? "GREEN",
      openAlerts: alerts.filter(
        (al) => ids.has(al.assessmentId) && al.acknowledgedAt === undefined,
      ).length,
    };
    if (latestAssessment) row.latestAssessment = latestAssessment;
    if (lastCheckIn) row.lastCheckInAt = lastCheckIn.timestamp;
    return row;
  }

  /** Every patient's summary, RED first, then by latest assessment, newest first. */
  listPatients(): PatientSummary[] {
    this.assessSilences();
    this.escalateAlerts();
    const rows = this.store.listPatients().map((p) => this.summaryOf(p));
    const at = (r: PatientSummary): number =>
      r.latestAssessment ? toMillis(r.latestAssessment.createdAt) : -Infinity;
    return rows.sort(
      (x, y) => RANK[x.status] - RANK[y.status] || at(y) - at(x),
    );
  }
}
