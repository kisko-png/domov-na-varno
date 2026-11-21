import { getProtocol, orderQuestions, type Protocol } from "./protocols.js";
import type { Patient, Report } from "./seed.js";
import { SL } from "../strings.sl.js";

/** Lowercased name fragments that mark a medication as an anticoagulant. */
export const ANTICOAGULANTS = [
  "apixaban",
  "rivaroxaban",
  "rivaroksaban",
  "dabigatran",
  "edoxaban",
  "edoksaban",
  "warfarin",
  "varfarin",
  "acenocoumarol",
  "acenokumarol",
  "enoxaparin",
  "enoksaparin",
  "heparin",
] as const;

/** Whether a medication is an anticoagulant. */
export function isAnticoagulant(medication: string): boolean {
  const lower = medication.toLowerCase();
  return ANTICOAGULANTS.some((a) => lower.includes(a));
}

/** A protocol personalised from a report: an anticoagulant adds the bleeding red flag (and symptom when missing). */
export function personalProtocol(protocol: Protocol, report: Report): Protocol {
  const copy = structuredClone(protocol);
  if (!report.medications.some(isAnticoagulant)) return copy;
  if (!copy.questions.some((q) => q.id === "heavy-bleeding"))
    copy.questions = orderQuestions([
      ...copy.questions,
      {
        id: "heavy-bleeding",
        label: SL.personal.bleedingLabel,
        kind: "RED_FLAG",
      },
    ]);
  copy.redFlags.push({
    id: "anticoagulant-bleeding",
    symptom: "heavy-bleeding",
    severity: "CONTACT_DOCTOR",
    action: SL.personal.bleedingAction,
  });
  return copy;
}

/** The personal protocol of a patient, its report looked up among `reports` (base protocol without one). */
export function protocolOfPatient(
  patient: Patient,
  reports: readonly Report[],
): Protocol {
  const base = getProtocol(patient.protocolId);
  const report = reports.find((r) => r.id === patient.reportId);
  return report ? personalProtocol(base, report) : base;
}
