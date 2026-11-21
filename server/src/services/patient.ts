import {
  currentSlot,
  redFlagWarning,
  type RedFlagWarning,
} from "../core/patientView.js";
import { protocolOfPatient } from "../core/personalProtocol.js";
import { type Protocol } from "../core/protocols.js";
import { assessCheckIn, type Assessment } from "../core/triage.js";
import type { CheckIn } from "../core/seed.js";
import { expectedForDay } from "../core/schedule.js";
import { formatInstant } from "../core/time.js";
import { ValidationError, type FieldError } from "../errors.js";
import { RISK_TIERS, type RiskTierSettings } from "../core/riskTiers.js";
import {
  checkInSlots,
  dayAfterDischarge,
  type CheckInSlot,
} from "../core/schedule.js";
import type { Patient, Report } from "../core/seed.js";
import { toMillis } from "../core/time.js";
import { NotFoundError, UnauthenticatedError } from "../errors.js";
import type {
  CheckInDraft,
  Reminder,
  StoreRepository,
} from "../repositories/store.js";
import { SL } from "../strings.sl.js";
import type { ClockService } from "./clock.js";

/** A protocol as the API shows it: with its risk tier's silence thresholds and the demo notice. */
export type ProtocolView = Protocol & {
  silence: RiskTierSettings["silence"];
  demoNotice: string;
};

/** The fields of a check-in as the patient submits them. */
export interface CheckInFields {
  wellbeing?: number;
  pain?: number;
  symptoms?: string[];
  temperatureC?: number;
  photoRef?: string;
  note?: string;
  filledBy?: "PATIENT" | "CAREGIVER";
}

/** One compared value of a check-in. */
export interface Compared {
  actual: number;
  expected: number;
  tolerance: number;
}

/** The result of a final check-in. */
export interface CheckInResult {
  checkIn: CheckIn;
  assessment: Assessment;
  comparison: { pain: Compared; wellbeing: Compared };
  showContactDoctor: boolean;
  showEmergency112: boolean;
  doctorPhone: string;
  alertCreated: boolean;
  reassuranceAllowed: boolean;
  reassuranceText?: string;
  demoNotice: string;
}

const FIELDS = [
  "wellbeing",
  "pain",
  "symptoms",
  "temperatureC",
  "photoRef",
  "note",
  "filledBy",
] as const;

/** What the patient's magic link shows. */
export interface PatientView {
  patientName: string;
  dayAfterDischarge: number;
  protocol: ProtocolView;
  doctorPhone: string;
  patientInstructions: string[];
  currentSlot: CheckInSlot;
  draft?: CheckInDraft;
  pendingReminder?: Reminder;
  demoNotice: string;
}

/** The patient-facing business logic. */
export class PatientService {
  /** Creates the service over the store and the simulated clock. */
  constructor(
    private readonly store: StoreRepository,
    private readonly clock: ClockService,
  ) {}

  /** The patient of a magic-link token; throws UnauthenticatedError when it is missing or unknown. */
  authenticate(token: string | undefined): Patient {
    const patient =
      token === undefined || token === "" ? undefined : this.byToken(token);
    if (!patient) throw new UnauthenticatedError(SL.errors.unauthenticated);
    return patient;
  }

  /** The patient view of a token; throws NotFoundError when no patient has it. */
  view(token: string): PatientView {
    const patient = this.byToken(token);
    if (!patient) throw new NotFoundError(SL.errors.patientNotFound);
    const now = this.clock.now();
    const protocol = protocolOfPatient(patient, this.store.listReports());
    const report = this.reportOf(patient);
    const checkIns = this.store
      .listCheckIns()
      .filter((c) => c.patientId === patient.id);
    const slot =
      currentSlot(protocol, patient, checkIns, now) ??
      checkInSlots(protocol, patient).at(-1);
    if (!slot) throw new NotFoundError(SL.errors.patientNotFound);
    const view: PatientView = {
      patientName: patient.name,
      dayAfterDischarge: dayAfterDischarge(patient.dischargeDate, now),
      protocol: {
        ...protocol,
        silence: { ...RISK_TIERS[protocol.riskTier].silence },
        demoNotice: SL.patient.demoNotice,
      },
      doctorPhone: report.doctorContactPhone,
      patientInstructions: [
        ...report.specialWarnings,
        ...report.restrictions,
        report.recommendations,
      ],
      currentSlot: slot,
      demoNotice: SL.patient.demoNotice,
    };
    const draft = this.store.getDraft(patient.id, slot.day, slot.index);
    if (draft) view.draft = draft;
    const latest = Math.max(
      -Infinity,
      ...checkIns.map((c) => toMillis(c.timestamp)),
    );
    const reminder = this.store
      .listReminders(patient.id)
      .filter((r) => toMillis(r.sentAt) > latest)
      .at(-1);
    if (reminder) view.pendingReminder = reminder;
    return view;
  }

  /** The red-flag warning of `symptoms` for a patient. */
  preview(patient: Patient, symptoms: string[]): RedFlagWarning {
    return redFlagWarning(
      protocolOfPatient(patient, this.store.listReports()),
      this.reportOf(patient),
      symptoms,
    );
  }

  /** Saves `fields` as the draft of the patient's current slot, replacing an earlier one. */
  saveDraft(patient: Patient, fields: CheckInFields): CheckInDraft {
    const now = this.clock.now();
    const slot = this.slotOf(patient, now);
    const draft: CheckInDraft = {
      patientId: patient.id,
      slotDay: slot.day,
      slotIndex: slot.index,
      updatedAt: formatInstant(now.getTime()),
    };
    for (const k of FIELDS) {
      const v = fields[k];
      if (v !== undefined) Object.assign(draft, { [k]: v });
    }
    this.store.saveDraft(draft);
    return draft;
  }

  /** Stores a final check-in and its assessment; throws ValidationError without wellbeing, pain or symptoms. */
  submit(patient: Patient, fields: CheckInFields): CheckInResult {
    const { wellbeing, pain, symptoms } = fields;
    if (
      wellbeing === undefined ||
      pain === undefined ||
      symptoms === undefined
    ) {
      const details: FieldError[] = (["wellbeing", "pain", "symptoms"] as const)
        .filter((k) => fields[k] === undefined)
        .map((field) => ({ field, message: SL.errors.requiredField }));
      throw new ValidationError(SL.errors.validation, details);
    }
    const now = this.clock.now();
    const protocol = protocolOfPatient(patient, this.store.listReports());
    const report = this.reportOf(patient);
    const all = this.store.listCheckIns();
    const history = all.filter((c) => c.patientId === patient.id);
    const slot = this.slotOf(patient, now, history);
    const n = all.filter((c) => /^chk-\d+$/.test(c.id)).length + 1;
    const checkIn: CheckIn = {
      id: `chk-${n}`,
      patientId: patient.id,
      protocolVersion: protocol.version,
      dayAfterDischarge: dayAfterDischarge(patient.dischargeDate, now),
      timestamp: formatInstant(now.getTime()),
      wellbeing,
      pain,
      symptoms,
      filledBy: fields.filledBy ?? "PATIENT",
    };
    if (fields.temperatureC !== undefined)
      checkIn.temperatureC = fields.temperatureC;
    if (fields.photoRef !== undefined) checkIn.photoRef = fields.photoRef;
    if (fields.note !== undefined) checkIn.note = fields.note;
    const { assessment, alert } = assessCheckIn({
      checkIn,
      history,
      protocol,
      patient,
      now: checkIn.timestamp,
      assessmentId: `asm-${this.store.listAssessments().length + 1}`,
      alertId: `alr-${this.store.listAlerts().length + 1}`,
    });
    this.store.addCheckIn(checkIn, assessment, alert, slot);
    const warning = redFlagWarning(protocol, report, symptoms);
    const expected = expectedForDay(protocol, checkIn.dayAfterDischarge);
    const green = assessment.status === "GREEN";
    const result: CheckInResult = {
      checkIn,
      assessment,
      comparison: {
        pain: {
          actual: pain,
          expected: expected.pain,
          tolerance: expected.painTolerance,
        },
        wellbeing: {
          actual: wellbeing,
          expected: expected.wellbeing,
          tolerance: 2,
        },
      },
      showContactDoctor: warning.showContactDoctor,
      showEmergency112: warning.showEmergency112,
      doctorPhone: warning.doctorPhone,
      alertCreated: alert !== undefined,
      reassuranceAllowed: green,
      demoNotice: SL.patient.demoNotice,
    };
    if (green) result.reassuranceText = SL.patient.reassurance;
    return result;
  }

  private slotOf(
    patient: Patient,
    now: Date,
    checkIns?: CheckIn[],
  ): CheckInSlot {
    const protocol = protocolOfPatient(patient, this.store.listReports());
    const mine =
      checkIns ??
      this.store.listCheckIns().filter((c) => c.patientId === patient.id);
    const slot =
      currentSlot(protocol, patient, mine, now) ??
      checkInSlots(protocol, patient).at(-1);
    if (!slot) throw new NotFoundError(SL.errors.patientNotFound);
    return slot;
  }

  private byToken(token: string): Patient | undefined {
    return this.store.listPatients().find((p) => p.accessToken === token);
  }

  private reportOf(patient: Patient): Report {
    const report = this.store
      .listReports()
      .find((r) => r.id === patient.reportId);
    if (!report) throw new NotFoundError(SL.errors.notFound);
    return report;
  }
}
