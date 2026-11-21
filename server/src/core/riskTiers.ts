/** A slot rule of a check-in schedule: `perDay` check-ins on each day, or check-ins on the listed `days`. */
export type CheckInScheduleEntry =
  | { fromDay: number; toDay: number; perDay: number }
  | { fromDay: number; toDay: number; days: number[] };

/** A risk tier of a protocol, in rising order of monitoring intensity. */
export type RiskTier = "HIGH" | "MEDIUM" | "LOW";

/** The settings of one risk tier. All values are DEMO VALUES - not clinically validated. */
export interface RiskTierSettings {
  checkInSchedule: CheckInScheduleEntry[];
  durationDays: number;
  painTolerance: number;
  silence: { yellowAfterHours: number; redAfterHours: number };
}

/** The risk tier settings, as in resources/risk-tiers.yaml. DEMO VALUES - not clinically validated. */
export const RISK_TIERS: Readonly<Record<RiskTier, RiskTierSettings>> = {
  HIGH: {
    checkInSchedule: [
      { fromDay: 1, toDay: 3, perDay: 2 },
      { fromDay: 4, toDay: 30, perDay: 1 },
    ],
    durationDays: 30,
    painTolerance: 1,
    silence: { yellowAfterHours: 12, redAfterHours: 24 },
  },
  MEDIUM: {
    checkInSchedule: [{ fromDay: 1, toDay: 14, perDay: 1 }],
    durationDays: 14,
    painTolerance: 2,
    silence: { yellowAfterHours: 24, redAfterHours: 48 },
  },
  LOW: {
    checkInSchedule: [
      { fromDay: 1, toDay: 7, perDay: 1 },
      { fromDay: 8, toDay: 14, days: [8, 10, 12] },
    ],
    durationDays: 14,
    painTolerance: 3,
    silence: { yellowAfterHours: 48, redAfterHours: 72 },
  },
};
