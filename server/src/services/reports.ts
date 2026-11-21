import { randomUUID } from "node:crypto";
import { personalProtocol } from "../core/personalProtocol.js";
import {
  getProtocol,
  listProtocols,
  type Protocol,
} from "../core/protocols.js";
import { RISK_TIERS } from "../core/riskTiers.js";
import type { Patient, Report } from "../core/seed.js";
import { NoMatchingProtocolError, NotFoundError } from "../errors.js";
import type { StoreRepository } from "../repositories/store.js";
import { SL } from "../strings.sl.js";
import type { ProtocolView } from "./patient.js";
import type { PatientSummary, StaffService } from "./staff.js";

/** A discharge report as entered by staff. */
export interface ReportCreate {
  patient: {
    name: string;
    phone: string;
    dischargeDate: string;
    preferredCheckInTime: string;
    caregiverName?: string;
  };
  procedure: string;
  procedureDate: string;
  medications: string[];
  specialWarnings: string[];
  restrictions: string[];
  recommendations: string;
  doctorContactPhone: string;
}

/** A patient with report, personal protocol and instructions. */
export interface PatientDetail extends PatientSummary {
  report: Report;
  protocol: ProtocolView;
  patientInstructions: string[];
  sentSummaries: { sessionId: string; confirmedAt: string }[];
}

/** The first catalogue protocol with a keyword contained in the lowercased procedure. */
export function matchProtocol(procedure: string): Protocol | undefined {
  const lower = procedure.toLowerCase();
  return listProtocols().find((p) =>
    p.procedureKeywords.some((k) => lower.includes(k)),
  );
}

function nextNumber(ids: string[], prefix: string): number {
  const re = new RegExp(`^${prefix}-(\\d+)$`);
  let max = 12;
  for (const id of ids) {
    const m = re.exec(id);
    if (m?.[1] !== undefined) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}

/** Creates patients from discharge reports. */
export class ReportService {
  /** Creates the service over the store and the staff service. */
  constructor(
    private readonly store: StoreRepository,
    private readonly staff: StaffService,
    private readonly newToken: () => string = randomUUID,
  ) {}

  /** Creates a patient and its report; throws NoMatchingProtocolError when no protocol matches. */
  create(input: ReportCreate): PatientDetail {
    const base = matchProtocol(input.procedure);
    if (base === undefined)
      throw new NoMatchingProtocolError(
        SL.errors.noMatchingProtocol(input.procedure),
      );
    const nn = (n: number): string => String(n).padStart(2, "0");
    const patientId = `pat-${nn(
      nextNumber(
        this.store.listPatients().map((p) => p.id),
        "pat",
      ),
    )}`;
    const reportId = `rep-${nn(
      nextNumber(
        this.store.listReports().map((r) => r.id),
        "rep",
      ),
    )}`;
    const report: Report = {
      id: reportId,
      patientId,
      procedure: input.procedure,
      procedureDate: input.procedureDate,
      medications: [...input.medications],
      specialWarnings: [...input.specialWarnings],
      restrictions: [...input.restrictions],
      recommendations: input.recommendations,
      doctorContactPhone: input.doctorContactPhone,
    };
    const patient: Patient = {
      id: patientId,
      name: input.patient.name,
      phone: input.patient.phone,
      dischargeDate: input.patient.dischargeDate,
      protocolId: base.id,
      reportId,
      preferredCheckInTime: input.patient.preferredCheckInTime,
      accessToken: this.newToken(),
    };
    if (input.patient.caregiverName !== undefined)
      patient.caregiverName = input.patient.caregiverName;
    this.store.addAll({
      patients: [patient],
      reports: [report],
      checkIns: [],
      assessments: [],
      alerts: [],
    });
    return this.detailOf(this.staff.summaryOf(patient), patient, report);
  }

  /** The detail of a patient, its summary as GET /patients gives it; throws NotFoundError for an unknown id. */
  detail(id: string): PatientDetail {
    const summary = this.staff.listPatients().find((s) => s.patient.id === id);
    const patient = this.store.listPatients().find((p) => p.id === id);
    const report = this.store
      .listReports()
      .find((r) => r.id === patient?.reportId);
    if (!summary || !patient || !report)
      throw new NotFoundError(SL.errors.notFound);
    return this.detailOf(summary, patient, report);
  }

  private detailOf(
    summary: PatientSummary,
    patient: Patient,
    report: Report,
  ): PatientDetail {
    const protocol = personalProtocol(getProtocol(patient.protocolId), report);
    const sentSummaries = this.store
      .listChatSessions(patient.id)
      .flatMap((c) =>
        c.summary?.summaryStatus === "SENT" && c.summary.confirmedAt
          ? [{ sessionId: c.id, confirmedAt: c.summary.confirmedAt }]
          : [],
      )
      .sort((x, y) => Date.parse(y.confirmedAt) - Date.parse(x.confirmedAt));
    return {
      ...summary,
      report,
      protocol: {
        ...protocol,
        silence: { ...RISK_TIERS[protocol.riskTier].silence },
        demoNotice: SL.patient.demoNotice,
      },
      patientInstructions: [
        ...report.specialWarnings,
        ...report.restrictions,
        report.recommendations,
      ],
      sentSummaries,
    };
  }
}
