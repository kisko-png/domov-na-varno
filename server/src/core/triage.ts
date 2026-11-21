import { SL } from "../strings.sl.js";
import type { Protocol } from "./protocols.js";
import type { CheckIn, Patient } from "./seed.js";
import { checkInSlots, expectedForDay } from "./schedule.js";
import { RISK_TIERS } from "./riskTiers.js";
import { formatInstant, toMillis } from "./time.js";

/** A triage status, in rising severity. */
export type TriageStatus = "GREEN" | "YELLOW" | "RED";

/** Why an assessment has its status. */
export interface Reason {
  text: string;
  ruleId: "R0" | "R1" | "R2" | "R3" | "R4" | "R5" | "R6" | "R7";
}

/** An append-only triage result; one of silence has no `checkInId`. */
export interface Assessment {
  id: string;
  patientId: string;
  checkInId?: string;
  status: TriageStatus;
  reasons: Reason[];
  createdAt: string;
}

/** An alert raised for an assessment. */
export interface Alert {
  id: string;
  assessmentId: string;
  recipientRole: "NURSE" | "COORDINATOR";
  createdAt: string;
  acknowledgedAt?: string;
  escalatedAt?: string;
}

/** A reason with the status it sets. */
export interface RuleResult {
  status: TriageStatus;
  reason: Reason;
}

/** Input of {@link assessCheckIn}. */
export interface AssessCheckInInput {
  checkIn: CheckIn;
  history: CheckIn[];
  protocol: Protocol;
  patient: Patient;
  now: Date | string;
  assessmentId: string;
  alertId: string;
}

/** Output of {@link assessCheckIn}. */
export interface AssessCheckInResult {
  assessment: Assessment;
  alert?: Alert;
}

const RANK: Record<TriageStatus, number> = { GREEN: 0, YELLOW: 1, RED: 2 };

/** Rule R1: a RED reason for every check-in symptom a red flag of the protocol names. */
export function ruleRedFlag(
  checkIn: CheckIn,
  protocol: Protocol,
): RuleResult[] {
  const flagged = new Set(protocol.redFlags.map((f) => f.symptom));
  const out: RuleResult[] = [];
  for (const id of checkIn.symptoms) {
    if (!flagged.has(id)) continue;
    const label = protocol.questions.find((q) => q.id === id)?.label ?? id;
    out.push({
      status: "RED",
      reason: { ruleId: "R1", text: SL.triage.redFlag(label) },
    });
  }
  return out;
}

/** Rule R2: YELLOW for 38.0 to below 38.5 °C, RED for 38.5 °C or more. */
export function ruleTemperature(checkIn: CheckIn): RuleResult[] {
  const t = checkIn.temperatureC;
  if (t === undefined) return [];
  if (t >= 38.5)
    return [
      {
        status: "RED",
        reason: { ruleId: "R2", text: SL.triage.feverHigh(t) },
      },
    ];
  if (t >= 38.0)
    return [
      {
        status: "YELLOW",
        reason: { ruleId: "R2", text: SL.triage.feverModerate(t) },
      },
    ];
  return [];
}

/** Pain and wellbeing deviation of a check-in from the expected curves of its day. */
export function deviation(
  checkIn: CheckIn,
  protocol: Protocol,
): { pain: number; wellbeing: number } {
  const e = expectedForDay(protocol, checkIn.dayAfterDischarge);
  return {
    pain: checkIn.pain - e.pain,
    wellbeing: e.wellbeing - checkIn.wellbeing,
  };
}

/** Rule R3: pain and wellbeing deviation from the expected curves, RED when it persists from the day before. */
export function rulePainCurve(
  checkIn: CheckIn,
  history: CheckIn[],
  protocol: Protocol,
): RuleResult[] {
  const tol = protocol.painTolerance;
  const d = deviation(checkIn, protocol);
  const dayBefore = history
    .filter((h) => h.dayAfterDischarge === checkIn.dayAfterDischarge - 1)
    .map((h) => deviation(h, protocol));
  const out: RuleResult[] = [];
  if (d.pain > 2 * tol) {
    out.push({
      status: "RED",
      reason: { ruleId: "R3", text: SL.triage.painAboveCurve(checkIn.pain) },
    });
  } else if (d.pain > tol) {
    const persists = dayBefore.some((h) => h.pain > tol);
    out.push({
      status: persists ? "RED" : "YELLOW",
      reason: {
        ruleId: "R3",
        text: persists
          ? SL.triage.painAboveCurvePersisting(checkIn.pain)
          : SL.triage.painAboveCurve(checkIn.pain),
      },
    });
  }
  if (d.wellbeing >= 2) {
    const persists = dayBefore.some((h) => h.wellbeing >= 2);
    out.push({
      status: persists ? "RED" : "YELLOW",
      reason: {
        ruleId: "R3",
        text: persists
          ? SL.triage.wellbeingBelowCurvePersisting(checkIn.wellbeing)
          : SL.triage.wellbeingBelowCurve(checkIn.wellbeing),
      },
    });
  }
  return out;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Rule R4: YELLOW when pain is 3 or more above a history check-in of the 24 hours before. */
export function rulePainJump(
  checkIn: CheckIn,
  history: CheckIn[],
): RuleResult[] {
  const at = toMillis(checkIn.timestamp);
  const recent = history.filter((h) => {
    const t = toMillis(h.timestamp);
    return t < at && t >= at - DAY_MS;
  });
  const lowest = Math.min(...recent.map((h) => h.pain));
  if (recent.length === 0 || checkIn.pain - lowest < 3) return [];
  return [
    {
      status: "YELLOW",
      reason: {
        ruleId: "R4",
        text: SL.triage.painJump(lowest, checkIn.pain),
      },
    },
  ];
}

/** Rule R6: YELLOW for a second WORSE in a row or a MUCH_WORSE (RED in the HIGH tier), per pain and wellbeing trend. */
export function ruleTrend(
  checkIn: CheckIn,
  history: CheckIn[],
  protocol: Protocol,
): RuleResult[] {
  let latest: CheckIn | undefined;
  for (const h of history)
    if (!latest || toMillis(h.timestamp) >= toMillis(latest.timestamp))
      latest = h;
  const out: RuleResult[] = [];
  const trends = [
    ["pain", checkIn.painTrend, latest?.painTrend],
    ["wellbeing", checkIn.wellbeingTrend, latest?.wellbeingTrend],
  ] as const;
  for (const [what, now, before] of trends) {
    if (now === "MUCH_WORSE") {
      out.push({
        status: protocol.riskTier === "HIGH" ? "RED" : "YELLOW",
        reason: { ruleId: "R6", text: SL.triage.trendMuchWorse(what) },
      });
    } else if (
      now === "WORSE" &&
      (before === "WORSE" || before === "MUCH_WORSE")
    ) {
      out.push({
        status: "YELLOW",
        reason: { ruleId: "R6", text: SL.triage.trendWorse(what) },
      });
    }
  }
  return out;
}

/** Rule R7: one YELLOW reason for a weight gain of 1 kg vs the day before or 2 kg within 7 days; gives the largest such gain. */
export function ruleWeight(checkIn: CheckIn, history: CheckIn[]): RuleResult[] {
  const w = checkIn.measurements?.weightKg;
  if (w === undefined) return [];
  const at = toMillis(checkIn.timestamp);
  let gain = -Infinity;
  for (const h of history) {
    const hw = h.measurements?.weightKg;
    if (hw === undefined) continue;
    const g = w - hw;
    const t = toMillis(h.timestamp);
    const dayBefore = h.dayAfterDischarge === checkIn.dayAfterDischarge - 1;
    const inWeek = t < at && t >= at - 7 * DAY_MS;
    if ((dayBefore && g >= 1 - 1e-9) || (inWeek && g >= 2 - 1e-9))
      gain = Math.max(gain, g);
  }
  if (gain === -Infinity) return [];
  return [
    {
      status: "YELLOW",
      reason: {
        ruleId: "R7",
        text: SL.triage.weightGain(
          (Math.round(gain * 10) / 10).toFixed(1).replace(".", ","),
        ),
      },
    },
  ];
}

/** Assesses a check-in against its history and protocol; a RED assessment comes with a NURSE alert. */
export function assessCheckIn(input: AssessCheckInInput): AssessCheckInResult {
  const { checkIn, protocol, now, assessmentId, alertId } = input;
  const createdAt = formatInstant(toMillis(now));
  const results = [
    ...ruleRedFlag(checkIn, protocol),
    ...ruleTemperature(checkIn),
    ...rulePainCurve(checkIn, input.history, protocol),
    ...rulePainJump(checkIn, input.history),
    ...ruleTrend(checkIn, input.history, protocol),
    ...ruleWeight(checkIn, input.history),
  ];
  let status: TriageStatus = "GREEN";
  for (const r of results) if (RANK[r.status] > RANK[status]) status = r.status;
  const reasons: Reason[] =
    results.length > 0
      ? results.map((r) => r.reason)
      : [{ ruleId: "R0", text: SL.triage.withinExpected }];
  const assessment: Assessment = {
    id: assessmentId,
    patientId: checkIn.patientId,
    checkInId: checkIn.id,
    status,
    reasons,
    createdAt,
  };
  if (status !== "RED") return { assessment };
  return {
    assessment,
    alert: {
      id: alertId,
      assessmentId,
      recipientRole: "NURSE",
      createdAt,
    },
  };
}

/** Input of {@link assessSilence}. */
export interface AssessSilenceInput {
  patient: Patient;
  protocol: Protocol;
  checkIns: CheckIn[];
  now: Date | string;
  assessmentId: string;
  alertId: string;
}

const HOUR_MS = 3600000;

/** Rule R5: assesses a patient's silence - the earliest uncovered due slot after the latest check-in; null when not silent. */
export function assessSilence(
  input: AssessSilenceInput,
): AssessCheckInResult | null {
  const { patient, protocol, checkIns, now, assessmentId, alertId } = input;
  const nowMs = toMillis(now);
  const latest = Math.max(
    -Infinity,
    ...checkIns.map((c) => toMillis(c.timestamp)),
  );
  const perDay = new Map<number, number>();
  for (const c of checkIns)
    perDay.set(c.dayAfterDischarge, (perDay.get(c.dayAfterDischarge) ?? 0) + 1);
  const slot = checkInSlots(protocol, patient).find((s) => {
    const due = toMillis(s.dueAt);
    return due <= nowMs && due > latest && (perDay.get(s.day) ?? 0) < s.index;
  });
  if (!slot) return null;
  const lateMs = nowMs - toMillis(slot.dueAt);
  const { yellowAfterHours, redAfterHours } =
    RISK_TIERS[protocol.riskTier].silence;
  let status: TriageStatus;
  if (lateMs >= redAfterHours * HOUR_MS) status = "RED";
  else if (lateMs >= yellowAfterHours * HOUR_MS) status = "YELLOW";
  else return null;
  const createdAt = formatInstant(nowMs);
  const assessment: Assessment = {
    id: assessmentId,
    patientId: patient.id,
    status,
    reasons: [
      {
        ruleId: "R5",
        text: SL.triage.silence(Math.floor(lateMs / HOUR_MS)),
      },
    ],
    createdAt,
  };
  if (status !== "RED") return { assessment };
  return {
    assessment,
    alert: { id: alertId, assessmentId, recipientRole: "NURSE", createdAt },
  };
}
