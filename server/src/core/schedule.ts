import { InvalidMomentError } from "../errors.js";
import type { Protocol, CurvePoint } from "./protocols.js";
import type { Patient } from "./seed.js";
import {
  addDays,
  formatInstant,
  localDayOf,
  localTimeToMillis,
  toMillis,
} from "./time.js";

/** The expected values of a protocol for one day after discharge. */
export interface ExpectedValues {
  pain: number;
  wellbeing: number;
  painTolerance: number;
}

/** One check-in a patient is due to make; `index` is 1 or 2 within its day, `dueAt` ISO 8601 with offset. */
export interface CheckInSlot {
  day: number;
  index: 1 | 2;
  dueAt: string;
}

function curveValue(curve: CurvePoint[], day: number): number {
  const sorted = [...curve].sort((a, b) => a.day - b.day);
  const first = sorted[0];
  if (!first) throw new InvalidMomentError("Empty expected curve");
  let value = first.value;
  for (const p of sorted) if (p.day <= day) value = p.value;
  return value;
}

/** Returns the expected pain, wellbeing and pain tolerance of a protocol for a day after discharge. */
export function expectedForDay(
  protocol: Protocol,
  day: number,
): ExpectedValues {
  return {
    pain: curveValue(protocol.expectedCurve.pain, day),
    wellbeing: curveValue(protocol.expectedCurve.wellbeing, day),
    painTolerance: protocol.painTolerance,
  };
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function dayNumber(day: string): number {
  const ms = DAY_RE.test(day) ? Date.parse(`${day}T00:00:00Z`) : NaN;
  if (Number.isNaN(ms))
    throw new InvalidMomentError(`Invalid LocalDay: ${day}`);
  return Math.round(ms / 86400000);
}

/** Returns the day after discharge of a moment: the discharge LocalDay is 0, the next 1. */
export function dayAfterDischarge(
  dischargeDate: string,
  moment: Date | string,
): number {
  return dayNumber(localDayOf(toMillis(moment))) - dayNumber(dischargeDate);
}

/** Returns the check-in slots of a patient in time order, on days 1 to the protocol's `durationDays`. */
export function checkInSlots(
  protocol: Protocol,
  patient: Patient,
): CheckInSlot[] {
  const slots: CheckInSlot[] = [];
  for (let day = 1; day <= protocol.durationDays; day++) {
    let count = 0;
    for (const e of protocol.checkInSchedule) {
      if (day < e.fromDay || day > e.toDay) continue;
      const n = "perDay" in e ? e.perDay : e.days.includes(day) ? 1 : 0;
      count = Math.max(count, n);
    }
    if (count === 0) continue;
    const first = localTimeToMillis(
      addDays(patient.dischargeDate, day),
      patient.preferredCheckInTime,
    );
    slots.push({ day, index: 1, dueAt: formatInstant(first) });
    if (count >= 2)
      slots.push({ day, index: 2, dueAt: formatInstant(first + 12 * 3600000) });
  }
  return slots;
}
