import { redFlagWarning } from "../core/patientView.js";
import { protocolOfPatient } from "../core/personalProtocol.js";
import type { Protocol, RedFlag, SurveyNode } from "../core/protocols.js";
import { dayAfterDischarge } from "../core/schedule.js";
import type { Patient, Report } from "../core/seed.js";
import { formatInstant } from "../core/time.js";
import type { Alert, Assessment } from "../core/triage.js";
import { ConflictError, NotFoundError, ValidationError } from "../errors.js";
import type {
  ChatSession,
  ChatSummary,
  StoreRepository,
} from "../repositories/store.js";
import { SL } from "../strings.sl.js";
import type { ClockService } from "./clock.js";
import { parseChoice, type LlmCandidate, type LlmClient } from "./llm.js";

/** A message of the patient to the bot. */
export interface ChatMessageIn {
  sessionId?: string;
  text?: string;
  surveyAnswerId?: string;
  startSurvey?: boolean;
}

/** A reply of the bot. */
export interface ChatReply {
  sessionId: string;
  type:
    | "GUIDANCE"
    | "SURVEY_QUESTION"
    | "ESCALATION"
    | "NOT_COVERED"
    | "REFUSAL"
    | "SUMMARY_READY";
  text: string;
  watchFor: string[];
  warningSigns?: string[];
  whenToCall?: string;
  alertCreated: boolean;
  alertId?: string;
  showContactDoctor: boolean;
  showEmergency112: boolean;
  doctorPhone: string;
  nextSurveyQuestion?: {
    nodeId: string;
    topic: SurveyNode["topic"];
    question: string;
    answers: { id: string; label: string }[];
  };
}

/** Where the chat service logs a replaced reply. */
export type ChatLog = (
  fields: Record<string, unknown>,
  message: string,
) => void;

const DOSE = /\d+(?:[.,]\d+)?\s*(?:mg|ml|tablet)/;

/** Why a lowercased bot text is unsafe, or undefined when it is safe. */
export function unsafeReason(
  lower: string,
  report: Report,
): string | undefined {
  if (SL.chat.diagnosisPhrases.some((p) => lower.includes(p)))
    return "diagnosis";
  const meds = report.medications
    .map((m) => m.toLowerCase().split(/\s+/)[0] ?? "")
    .filter((n) => n.length >= 4);
  if ([...SL.chat.medicationNames, ...meds].some((m) => lower.includes(m)))
    return "medication";
  if (DOSE.test(lower)) return "dose";
  if (SL.chat.procedurePhrases.some((p) => lower.includes(p)))
    return "procedure-or-test";
  return undefined;
}

/** Whether a lowercased message asks about a medication, a dose, a procedure, a test or a therapy. */
export function asksAboutTreatment(lower: string, report: Report): boolean {
  const names = report.medications
    .map((m) => m.toLowerCase().split(/\s+/)[0] ?? "")
    .filter((n) => n.length >= 4);
  return [...SL.chat.refusalStems, ...names].some((s) => lower.includes(s));
}

/** The patient's chat with the bot. */
export class ChatService {
  /** Creates the service over the store, the simulated clock and the language model. */
  constructor(
    private readonly store: StoreRepository,
    private readonly clock: ClockService,
    private readonly llm: LlmClient,
    private readonly log?: ChatLog,
  ) {}

  /** Answers one message, starting a session without `sessionId`. */
  async send(patient: Patient, msg: ChatMessageIn): Promise<ChatReply> {
    const given = [
      msg.text !== undefined,
      msg.surveyAnswerId !== undefined,
      msg.startSurvey !== undefined,
    ].filter(Boolean).length;
    if (given !== 1)
      throw new ValidationError(SL.errors.validation, [
        { field: "text", message: SL.chat.exactlyOne },
      ]);
    const session = this.sessionOf(patient, msg.sessionId);
    const at = formatInstant(this.clock.now().getTime());
    const patientText =
      msg.text ??
      (msg.startSurvey !== undefined
        ? SL.chat.startSurveyEntry
        : this.answerLabel(patient, session, msg.surveyAnswerId ?? ""));
    const raw =
      msg.text !== undefined
        ? await this.answerText(patient, session, msg.text, at)
        : this.answerSurvey(patient, session, msg, at);
    const reply = this.guardOutput(patient, raw);
    if (msg.text !== undefined)
      session.patientTexts = [...(session.patientTexts ?? []), msg.text];
    if (reply.type === "GUIDANCE")
      session.guidanceReplies = [
        ...(session.guidanceReplies ?? []),
        reply.text,
      ];
    session.transcript.push({ role: "PATIENT", text: patientText, at });
    session.transcript.push({ role: "BOT", text: reply.text, at });
    this.store.saveChatSession(session);
    return reply;
  }

  /** Ends a session and makes its summary draft; ending again returns the summary made. */
  end(patient: Patient, sessionId: string): ChatSummary {
    const session = this.sessionOf(patient, sessionId);
    if (session.summary) return session.summary;
    const summary: ChatSummary = {
      id: `sum-${this.store.countChatSummaries() + 1}`,
      sessionId: session.id,
      patientId: patient.id,
      fullTranscript: [...session.transcript],
      surveyAnswers: session.surveyAnswers.map((a) => ({
        nodeId: a.questionId,
        question: a.question,
        answerId: a.answerId,
        answer: a.label,
      })),
      botGuidanceGiven: [...(session.guidanceReplies ?? [])],
      patientQuestions: [...(session.patientTexts ?? [])],
      createdAt: formatInstant(this.clock.now().getTime()),
      summaryStatus: "DRAFT",
    };
    session.summary = summary;
    this.store.saveChatSession(session);
    return summary;
  }

  /** Confirms the summary of a session and marks it sent. */
  confirm(patient: Patient, sessionId: string): ChatSummary {
    const session = this.sessionOf(patient, sessionId);
    const summary = session.summary;
    if (!summary) throw new ConflictError(SL.chat.noSummary);
    if (summary.summaryStatus !== "SENT") {
      summary.confirmedAt = formatInstant(this.clock.now().getTime());
      summary.summaryStatus = "SENT";
      this.store.saveChatSession(session);
    }
    return summary;
  }

  /** The summary of a session: to its patient in any status, without a patient only once sent. */
  summaryOf(patient: Patient | undefined, sessionId: string): ChatSummary {
    const s = this.store.getChatSession(sessionId);
    const summary = s?.summary;
    if (
      !s ||
      !summary ||
      (patient !== undefined && s.patientId !== patient.id) ||
      (patient === undefined && summary.summaryStatus !== "SENT")
    )
      throw new NotFoundError(SL.chat.summaryNotFound);
    return summary;
  }

  /** The output guard: replaces an unsafe reply by the safe fallback. */
  guardOutput(patient: Patient, reply: ChatReply): ChatReply {
    if (reply.type === "ESCALATION") {
      const lower = reply.text.toLowerCase();
      if (
        unsafeReason(lower, this.reportOf(patient)) ||
        SL.chat.reassuringPhrases.some((p) => lower.includes(p))
      ) {
        this.log?.({ sessionId: reply.sessionId }, "escalation text replaced");
        return {
          ...reply,
          text: SL.patient.contactDoctor(
            reply.doctorPhone,
            reply.showEmergency112,
          ),
          watchFor: [],
          warningSigns: [],
        };
      }
      return reply;
    }
    const all = [
      reply.text,
      ...reply.watchFor,
      ...(reply.warningSigns ?? []),
      reply.whenToCall ?? "",
    ]
      .join("\n")
      .toLowerCase();
    const why = unsafeReason(all, this.reportOf(patient));
    if (!why) return reply;
    this.log?.(
      { sessionId: reply.sessionId, replyType: reply.type, reason: why },
      "output guard replaced a bot reply",
    );
    const safe: ChatReply = {
      ...reply,
      type: "REFUSAL",
      text: SL.chat.safeFallback,
      watchFor: [],
      warningSigns: [],
    };
    delete safe.whenToCall;
    delete safe.nextSurveyQuestion;
    return safe;
  }

  private answerLabel(
    patient: Patient,
    session: ChatSession,
    answerId: string,
  ): string {
    const node = this.pendingNode(patient, session);
    return node?.answers.find((a) => a.id === answerId)?.label ?? answerId;
  }

  private pendingNode(
    patient: Patient,
    session: ChatSession,
  ): SurveyNode | undefined {
    if (session.pendingSurveyNodeId === undefined) return undefined;
    const protocol = protocolOfPatient(patient, this.store.listReports());
    return protocol.surveyGraph.nodes.find(
      (n) => n.id === session.pendingSurveyNodeId,
    );
  }

  private answerSurvey(
    patient: Patient,
    session: ChatSession,
    msg: ChatMessageIn,
    at: string,
  ): ChatReply {
    const protocol = protocolOfPatient(patient, this.store.listReports());
    const report = this.reportOf(patient);
    const base = this.baseReply(session, report);
    const ask = (nodeId: string): ChatReply => {
      const node = protocol.surveyGraph.nodes.find((n) => n.id === nodeId);
      if (!node) throw new NotFoundError(SL.errors.notFound);
      session.pendingSurveyNodeId = node.id;
      return {
        ...base,
        type: "SURVEY_QUESTION",
        text: node.question,
        nextSurveyQuestion: {
          nodeId: node.id,
          topic: node.topic,
          question: node.question,
          answers: node.answers.map((a) => ({ id: a.id, label: a.label })),
        },
      };
    };
    if (msg.startSurvey !== undefined) return ask(protocol.surveyGraph.start);
    const node = this.pendingNode(patient, session);
    const answer = node?.answers.find((a) => a.id === msg.surveyAnswerId);
    if (!node || !answer)
      throw new ValidationError(SL.errors.validation, [
        { field: "surveyAnswerId", message: SL.chat.surveyAnswerUnknown },
      ]);
    session.surveyAnswers.push({
      questionId: node.id,
      answerId: answer.id,
      question: node.question,
      label: answer.label,
    });
    if (answer.redFlag !== undefined) {
      const flag = protocol.redFlags.find((f) => f.id === answer.redFlag);
      delete session.pendingSurveyNodeId;
      if (flag) return this.escalate(patient, protocol, report, flag, at, base);
    }
    if (answer.next === null || answer.redFlag !== undefined) {
      delete session.pendingSurveyNodeId;
      return { ...base, type: "SUMMARY_READY", text: SL.chat.summaryReady };
    }
    return ask(answer.next);
  }

  private baseReply(session: ChatSession, report: Report): ChatReply {
    return {
      sessionId: session.id,
      type: "NOT_COVERED",
      text: "",
      watchFor: [],
      alertCreated: false,
      showContactDoctor: false,
      showEmergency112: false,
      doctorPhone: report.doctorContactPhone,
    };
  }

  private sessionOf(patient: Patient, id: string | undefined): ChatSession {
    if (id === undefined) {
      return {
        id: `chat-${this.store.countChatSessions() + 1}`,
        patientId: patient.id,
        createdAt: formatInstant(this.clock.now().getTime()),
        transcript: [],
        surveyAnswers: [],
        patientQuestions: [],
        botGuidanceGiven: [],
      };
    }
    const s = this.store.getChatSession(id);
    if (!s || s.patientId !== patient.id)
      throw new NotFoundError(SL.chat.sessionNotFound);
    return s;
  }

  private async answerText(
    patient: Patient,
    session: ChatSession,
    text: string,
    at: string,
  ): Promise<ChatReply> {
    const protocol = protocolOfPatient(patient, this.store.listReports());
    const report = this.reportOf(patient);
    const base = this.baseReply(session, report);
    const lower = text.toLowerCase();
    const flag = await this.redFlagOf(protocol, text, lower);
    if (flag) return this.escalate(patient, protocol, report, flag, at, base);
    if (asksAboutTreatment(lower, report)) {
      session.patientQuestions.push(text);
      return { ...base, type: "REFUSAL", text: SL.chat.refusal };
    }
    const candidates: LlmCandidate[] = protocol.guidanceTopics.map((t) => ({
      id: t.id,
      phrases: t.keywords,
    }));
    const topicId = parseChoice(
      await this.llm.complete([{ role: "user", content: text }], {
        task: "topic-matcher",
        candidates,
      }),
      candidates,
    );
    const topic = protocol.guidanceTopics.find((t) => t.id === topicId);
    if (topic) {
      session.botGuidanceGiven.push(topic.title);
      return {
        ...base,
        type: "GUIDANCE",
        text: SL.chat.guidance(
          topic.title,
          dayAfterDischarge(patient.dischargeDate, at),
        ),
        watchFor: [...topic.watchFor],
        warningSigns: [...topic.warningSigns],
        whenToCall: topic.whenToCall,
      };
    }
    return { ...base, type: "NOT_COVERED", text: SL.chat.notCovered };
  }

  private async redFlagOf(
    protocol: Protocol,
    text: string,
    lower: string,
  ): Promise<RedFlag | undefined> {
    const byPattern = protocol.redFlags.find((f) =>
      (f.patterns ?? []).some((p) => lower.includes(p.toLowerCase())),
    );
    if (byPattern) return byPattern;
    const candidates: LlmCandidate[] = protocol.redFlags.map((f) => ({
      id: f.id,
      phrases: f.patterns ?? [],
    }));
    const id = parseChoice(
      await this.llm.complete([{ role: "user", content: text }], {
        task: "red-flag-classifier",
        candidates,
      }),
      candidates,
    );
    return protocol.redFlags.find((f) => f.id === id);
  }

  private escalate(
    patient: Patient,
    protocol: Protocol,
    report: Report,
    flag: RedFlag,
    at: string,
    base: ChatReply,
  ): ChatReply {
    const warning = redFlagWarning(protocol, report, [flag.symptom]);
    const label =
      protocol.questions.find((q) => q.id === flag.symptom)?.label ??
      flag.symptom;
    const assessment: Assessment = {
      id: `asm-${this.store.listAssessments().length + 1}`,
      patientId: patient.id,
      status: "RED",
      reasons: [{ text: SL.triage.redFlag(label), ruleId: "R1" }],
      createdAt: at,
    };
    const alert: Alert = {
      id: `alr-${this.store.listAlerts().length + 1}`,
      assessmentId: assessment.id,
      recipientRole: "NURSE",
      createdAt: at,
    };
    this.store.addAssessment(assessment, alert);
    return {
      ...base,
      type: "ESCALATION",
      text:
        warning.message ??
        SL.patient.contactDoctor(report.doctorContactPhone, false),
      alertCreated: true,
      alertId: alert.id,
      showContactDoctor: warning.showContactDoctor,
      showEmergency112: warning.showEmergency112,
    };
  }

  private reportOf(patient: Patient): Report {
    const report = this.store
      .listReports()
      .find((r) => r.id === patient.reportId);
    if (!report) throw new NotFoundError(SL.errors.notFound);
    return report;
  }
}
