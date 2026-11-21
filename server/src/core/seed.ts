import { SL } from "../strings.sl.js";
import {
  getProtocol,
  listProtocols,
  type CurvePoint,
  type Protocol,
} from "./protocols.js";
import {
  addDays,
  formatInstant,
  localDayOf,
  localTimeToMillis,
  toMillis,
} from "./time.js";

/** A discharge report. */
export interface Report {
  id: string;
  patientId: string;
  procedure: string;
  procedureDate: string;
  medications: string[];
  specialWarnings: string[];
  restrictions: string[];
  recommendations: string;
  doctorContactPhone: string;
}

/** A monitored patient. */
export interface Patient {
  id: string;
  name: string;
  phone: string;
  dischargeDate: string;
  protocolId: string;
  reportId: string;
  caregiverName?: string;
  preferredCheckInTime: string;
  accessToken: string;
}

/** A final, append-only daily check-in. */
export interface CheckIn {
  id: string;
  patientId: string;
  protocolVersion: string;
  dayAfterDischarge: number;
  timestamp: string;
  wellbeing: number;
  pain: number;
  symptoms: string[];
  temperatureC?: number;
  photoRef?: string;
  note?: string;
  filledBy: "PATIENT" | "CAREGIVER";
}

/** The demo data. */
export interface Seed {
  patients: Patient[];
  reports: Report[];
  checkIns: CheckIn[];
}

const NAMES = [
  "Marija Novak",
  "Janez Horvat",
  "Ana Kranjc",
  "Franc Zupančič",
  "Ivan Kovačič",
  "Milena Potočnik",
  "Jožef Mlakar",
  "Štefka Vidmar",
  "Matej Golob",
  "Nina Žagar",
  "Luka Bizjak",
  "Tanja Kos",
];
const CAREGIVERS: Record<number, string> = {
  1: "Petra Novak",
  5: "Mojca Kovačič",
  8: "Andrej Vidmar",
};
const TIMES = ["08:00", "09:00", "10:00", "08:30"];
const SEED_DAYS = 7;
const PAT01 = {
  pain: [6, 6, 5, 5, 5, 6, 7],
  wellbeing: [3, 3, 3, 3, 3, 2, 2],
  temp: [37.2, 37.3, 37.4, 37.5, 37.6, 37.8, 38.1],
};

function nn(n: number): string {
  return String(n).padStart(2, "0");
}

function expected(curve: CurvePoint[], day: number): number {
  const point = curve.find((p) => p.day === day);
  return point ? point.value : 0;
}

function medicationsFor(protocolId: string, n: number): string[] {
  const m = SL.medications;
  if (n === 2) return [m.apixaban, m.paracetamol];
  if (protocolId === "hip-replacement") return [m.enoxaparin, m.paracetamol];
  if (protocolId === "cardiac-surgery")
    return [m.aspirin, m.bisoprolol, m.paracetamol];
  return [m.ibuprofen, m.paracetamol];
}

function reportFor(
  protocol: Protocol,
  n: number,
  index: number,
  dischargeDate: string,
): Report {
  const procedures = SL.procedures[protocol.id as keyof typeof SL.procedures];
  const procedure = procedures[index] ?? procedures[0];
  const r = SL.restrictions;
  const kind =
    protocol.id === "hip-replacement"
      ? "hip"
      : protocol.id === "cardiac-surgery"
        ? "cardiac"
        : "abdominal";
  const warnings: string[] = [SL.warnings.wound];
  if (n === 2) warnings.unshift(SL.warnings.anticoagulant);
  if (kind === "cardiac") warnings.push(SL.warnings.sternum);
  const restrictions =
    kind === "hip"
      ? [r.hip, r.crutches]
      : kind === "cardiac"
        ? [r.cardiacDriving, r.lifting]
        : [r.lifting];
  return {
    id: `rep-${nn(n)}`,
    patientId: `pat-${nn(n)}`,
    procedure,
    procedureDate: addDays(dischargeDate, kind === "abdominal" ? -1 : -4),
    medications: medicationsFor(protocol.id, n),
    specialWarnings: warnings,
    restrictions,
    recommendations: SL.recommendations[kind],
    doctorContactPhone: "+386 1 000 0000",
  };
}

function values(
  protocol: Protocol,
  n: number,
  day: number,
): { pain: number; wellbeing: number; temp: number } {
  const ep = expected(protocol.expectedCurve.pain, day);
  const ew = expected(protocol.expectedCurve.wellbeing, day);
  const i = day - 1;
  if (n === 1)
    return {
      pain: PAT01.pain[i] ?? 0,
      wellbeing: PAT01.wellbeing[i] ?? 0,
      temp: PAT01.temp[i] ?? 0,
    };
  if (n === 9)
    return { pain: Math.floor(ep), wellbeing: Math.ceil(ew), temp: 36.8 };
  // Others: a small deterministic wobble around the expected curve, within tolerance.
  const wobble = (n + day) % 2 === 0 ? 0 : 1;
  const pain = Math.min(
    10,
    Math.max(
      0,
      Math.round(ep) + (wobble && protocol.painTolerance > 1 ? 1 : 0),
    ),
  );
  const wellbeing = Math.min(5, Math.max(1, Math.floor(ew)));
  const temp = Math.round((36.5 + ((n * 3 + day) % 7) / 10) * 10) / 10;
  return { pain, wellbeing, temp };
}

/** Builds the deterministic demo seed for the moment `now`: 12 patients, their reports and check-ins for days 1-7. */
export function buildSeed(now: Date | string): Seed {
  const today = localDayOf(toMillis(now));
  const dischargeDate = addDays(today, -8);
  const seed: Seed = { patients: [], reports: [], checkIns: [] };
  listProtocols().forEach((listed, p) => {
    const protocol = getProtocol(listed.id);
    for (let k = 0; k < 4; k++) {
      const n = p * 4 + k + 1;
      const id = `pat-${nn(n)}`;
      const time = TIMES[k] ?? "08:00";
      const caregiverName = CAREGIVERS[n];
      seed.patients.push({
        id,
        name: NAMES[n - 1] ?? id,
        phone: `+386 40 000 0${nn(n)}`,
        dischargeDate,
        protocolId: protocol.id,
        reportId: `rep-${nn(n)}`,
        ...(caregiverName ? { caregiverName } : {}),
        preferredCheckInTime: time,
        accessToken: `tok-${nn(n)}`,
      });
      seed.reports.push(reportFor(protocol, n, k, dischargeDate));
      const lastDay = n === 5 ? 4 : SEED_DAYS;
      for (let day = 1; day <= lastDay; day++) {
        const base = localTimeToMillis(addDays(dischargeDate, day), time);
        const slots =
          protocol.riskTier === "HIGH" && day <= 3
            ? [base, base + 12 * 3600_000]
            : [base];
        const v = values(protocol, n, day);
        slots.forEach((ms, s) => {
          seed.checkIns.push({
            id: `chk-${nn(n)}-${nn(day)}-${s + 1}`,
            patientId: id,
            protocolVersion: protocol.version,
            dayAfterDischarge: day,
            timestamp: formatInstant(ms),
            wellbeing: v.wellbeing,
            pain: v.pain,
            symptoms: [],
            temperatureC: v.temp,
            filledBy: caregiverName && day % 2 === 0 ? "CAREGIVER" : "PATIENT",
          });
        });
      }
    }
  });
  return seed;
}
