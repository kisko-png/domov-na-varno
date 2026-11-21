import { listProtocols } from "protocols";
import type { CheckIn, Patient, Protocol, RiskTier } from "protocols";

export const DISCHARGE = "2025-03-01";

export function protocolOf(tier: RiskTier): Protocol {
  const p = listProtocols().find((x) => x.riskTier === tier);
  if (!p) throw new Error(`no protocol with riskTier ${tier}`);
  return p;
}

export function makePatient(protocol: Protocol, id = "pat-t"): Patient {
  return {
    id,
    name: "Test Pacient",
    phone: "+386 40 000 099",
    dischargeDate: DISCHARGE,
    protocolId: protocol.id,
    reportId: "rep-t",
    preferredCheckInTime: "09:00",
    accessToken: "tok-t",
  };
}

/** Moment on March 2025 day (1 + day) at hour, CET (+01:00). */
export function at(day: number, hour = 9): string {
  const d = String(1 + day).padStart(2, "0");
  const h = String(hour).padStart(2, "0");
  return `2025-03-${d}T${h}:00:00+01:00`;
}

export function makeCheckIn(
  protocol: Protocol,
  patient: Patient,
  day: number,
  fields: Partial<CheckIn> = {},
  hour = 9,
): CheckIn {
  return {
    id: `ci-${day}-${hour}`,
    patientId: patient.id,
    protocolVersion: protocol.version,
    dayAfterDischarge: day,
    timestamp: at(day, hour),
    wellbeing: 3,
    pain: 4,
    symptoms: [],
    filledBy: "PATIENT",
    ...fields,
  };
}
