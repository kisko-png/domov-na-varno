import type { Protocol, RedFlag } from "./protocols.js";
import { checkInSlots, type CheckInSlot } from "./schedule.js";
import type { CheckIn, Patient, Report } from "./seed.js";
import { toMillis } from "./time.js";
import { SL } from "../strings.sl.js";

/** The red-flag warning for a list of symptom ids. */
export interface RedFlagWarning {
  showContactDoctor: boolean;
  showEmergency112: boolean;
  doctorPhone: string;
  message?: string;
  redFlags: RedFlag[];
}

/** Builds the red-flag warning of `symptoms` for a patient's protocol and report. */
export function redFlagWarning(
  protocol: Protocol,
  report: Report,
  symptoms: readonly string[],
): RedFlagWarning {
  const ids = new Set(symptoms);
  const redFlags = protocol.redFlags.filter((f) => ids.has(f.symptom));
  const showContactDoctor = redFlags.length > 0;
  const showEmergency112 = redFlags.some((f) => f.severity === "EMERGENCY");
  const doctorPhone = report.doctorContactPhone;
  const warning: RedFlagWarning = {
    showContactDoctor,
    showEmergency112,
    doctorPhone,
    redFlags,
  };
  if (showContactDoctor)
    warning.message = SL.patient.contactDoctor(doctorPhone, showEmergency112);
  return warning;
}

/**
 * The current slot: the earliest slot due at or before `now` that is not covered
 * (a slot of index n is covered when its day has at least n check-ins); else the next slot after `now`.
 * Returns undefined when the schedule has neither.
 */
export function currentSlot(
  protocol: Protocol,
  patient: Patient,
  checkIns: readonly CheckIn[],
  now: Date | string,
): CheckInSlot | undefined {
  const nowMs = toMillis(now);
  const perDay = new Map<number, number>();
  for (const c of checkIns)
    perDay.set(c.dayAfterDischarge, (perDay.get(c.dayAfterDischarge) ?? 0) + 1);
  const slots = checkInSlots(protocol, patient);
  return (
    slots.find(
      (s) => toMillis(s.dueAt) <= nowMs && (perDay.get(s.day) ?? 0) < s.index,
    ) ?? slots.find((s) => toMillis(s.dueAt) > nowMs)
  );
}
