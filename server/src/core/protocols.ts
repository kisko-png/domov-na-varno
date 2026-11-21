import { ProtocolFormatError, UnknownProtocolError } from "../errors.js";
import {
  RISK_TIERS,
  type CheckInScheduleEntry,
  type RiskTier,
} from "./riskTiers.js";
import hipReplacement from "./protocols/hip-replacement.json" with { type: "json" };
import cardiacSurgery from "./protocols/cardiac-surgery.json" with { type: "json" };
import minorAbdominalSurgery from "./protocols/minor-abdominal-surgery.json" with { type: "json" };

/** One point of an expected recovery curve. */
export interface CurvePoint {
  day: number;
  value: number;
}

/** The kind of a check-in question. */
export type QuestionKind = "RED_FLAG" | "SYMPTOM" | "MEASUREMENT";

/** A question of the daily check-in: a red-flag symptom, another symptom, or a measurement in `unit`. */
export interface Symptom {
  id: string;
  label: string;
  kind: QuestionKind;
  unit?: string;
}

const KIND_ORDER: Record<QuestionKind, number> = {
  RED_FLAG: 0,
  SYMPTOM: 1,
  MEASUREMENT: 2,
};

/** Orders questions RED_FLAG, then SYMPTOM, then MEASUREMENT, each kind keeping its order (stable). */
export function orderQuestions(questions: readonly Symptom[]): Symptom[] {
  return [...questions].sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
}

function isKind(value: unknown): value is QuestionKind {
  return value === "RED_FLAG" || value === "SYMPTOM" || value === "MEASUREMENT";
}

/** A red flag of a protocol. */
export interface RedFlag {
  id: string;
  symptom: string;
  severity: "CONTACT_DOCTOR" | "EMERGENCY";
  action: string;
  patterns?: string[];
}

/** An answer of a survey node. */
export interface SurveyAnswer {
  id: string;
  label: string;
  next: string | null;
  redFlag?: string;
}

/** A node of a protocol's survey graph. */
export interface SurveyNode {
  id: string;
  topic: "onset" | "severity" | "accompanying" | "modifiers";
  question: string;
  answers: SurveyAnswer[];
}

/** A guidance topic of a protocol. */
export interface GuidanceTopic {
  id: string;
  title: string;
  keywords: string[];
  watchFor: string[];
  warningSigns: string[];
  whenToCall: string;
}

/** A monitoring protocol, with the check-in schedule, duration and pain tolerance of its risk tier. */
export interface Protocol {
  id: string;
  name: string;
  riskTier: RiskTier;
  version: string;
  procedureKeywords: string[];
  expectedCurve: { pain: CurvePoint[]; wellbeing: CurvePoint[] };
  questions: Symptom[];
  redFlags: RedFlag[];
  surveyGraph: { start: string; nodes: SurveyNode[] };
  guidanceTopics: GuidanceTopic[];
  sources: { title: string; url: string }[];
  checkInSchedule: CheckInScheduleEntry[];
  durationDays: number;
  painTolerance: number;
}

const REQUIRED_ARRAYS = [
  "procedureKeywords",
  "questions",
  "redFlags",
  "guidanceTopics",
  "sources",
];

function isRiskTier(value: unknown): value is RiskTier {
  return value === "HIGH" || value === "MEDIUM" || value === "LOW";
}

/** Checks the shape of a protocol file and adds its risk tier settings. */
export function toProtocol(file: unknown): Protocol {
  if (typeof file !== "object" || file === null) {
    throw new ProtocolFormatError("Protocol file is not an object");
  }
  const record = file as Record<string, unknown>;
  const id = record["id"];
  if (typeof id !== "string")
    throw new ProtocolFormatError("Protocol file has no string id");
  if (
    typeof record["name"] !== "string" ||
    typeof record["version"] !== "string"
  ) {
    throw new ProtocolFormatError(`Protocol ${id} has no name or version`);
  }
  const tier = record["riskTier"];
  if (!isRiskTier(tier))
    throw new ProtocolFormatError(`Protocol ${id} has an invalid riskTier`);
  for (const key of REQUIRED_ARRAYS) {
    if (!Array.isArray(record[key]))
      throw new ProtocolFormatError(`Protocol ${id} has no ${key} array`);
  }
  const curve = record["expectedCurve"] as Record<string, unknown> | undefined;
  if (
    !curve ||
    !Array.isArray(curve["pain"]) ||
    !Array.isArray(curve["wellbeing"])
  ) {
    throw new ProtocolFormatError(`Protocol ${id} has no expectedCurve`);
  }
  const graph = record["surveyGraph"] as Record<string, unknown> | undefined;
  if (
    !graph ||
    typeof graph["start"] !== "string" ||
    !Array.isArray(graph["nodes"])
  ) {
    throw new ProtocolFormatError(`Protocol ${id} has no surveyGraph`);
  }
  for (const q of record["questions"] as unknown[]) {
    const kind = (q as Record<string, unknown> | null)?.["kind"];
    if (!isKind(kind))
      throw new ProtocolFormatError(
        `Protocol ${id} has a question without a valid kind`,
      );
  }
  const settings = RISK_TIERS[tier];
  const base = structuredClone(record) as unknown as Omit<
    Protocol,
    "checkInSchedule" | "durationDays" | "painTolerance"
  >;
  return {
    ...base,
    questions: orderQuestions(base.questions),
    checkInSchedule: structuredClone(settings.checkInSchedule),
    durationDays: settings.durationDays,
    painTolerance: settings.painTolerance,
  };
}

const CATALOGUE: readonly Protocol[] = [
  hipReplacement,
  cardiacSurgery,
  minorAbdominalSurgery,
].map((file: unknown) => toProtocol(file));

/** Returns the protocol catalogue: hip replacement, cardiac surgery, minor abdominal surgery, in that order. */
export function listProtocols(): Protocol[] {
  return CATALOGUE.map((p) => structuredClone(p));
}

/** Returns the protocol with the given id; throws `UnknownProtocolError` when there is none. */
export function getProtocol(id: string): Protocol {
  const found = CATALOGUE.find((p) => p.id === id);
  if (!found) throw new UnknownProtocolError(id);
  return structuredClone(found);
}
