import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type } from "typebox";
import type { ChatService } from "../services/chat.js";
import type { PatientService } from "../services/patient.js";

const ChatMessageInSchema = Type.Object({
  sessionId: Type.Optional(Type.String()),
  text: Type.Optional(Type.String({ minLength: 1, maxLength: 2000 })),
  surveyAnswerId: Type.Optional(Type.String()),
  startSurvey: Type.Optional(Type.Boolean()),
});

/** The `ChatReply` schema of the API. */
export const ChatReplySchema = Type.Object({
  sessionId: Type.String(),
  type: Type.Union([
    Type.Literal("GUIDANCE"),
    Type.Literal("SURVEY_QUESTION"),
    Type.Literal("ESCALATION"),
    Type.Literal("NOT_COVERED"),
    Type.Literal("REFUSAL"),
    Type.Literal("SUMMARY_READY"),
  ]),
  text: Type.String(),
  watchFor: Type.Array(Type.String()),
  warningSigns: Type.Optional(Type.Array(Type.String())),
  whenToCall: Type.Optional(Type.String()),
  alertCreated: Type.Boolean(),
  alertId: Type.Optional(Type.String()),
  showContactDoctor: Type.Boolean(),
  showEmergency112: Type.Boolean(),
  doctorPhone: Type.String(),
  nextSurveyQuestion: Type.Optional(
    Type.Object({
      nodeId: Type.String(),
      topic: Type.Union([
        Type.Literal("onset"),
        Type.Literal("severity"),
        Type.Literal("accompanying"),
        Type.Literal("modifiers"),
      ]),
      question: Type.String(),
      answers: Type.Array(
        Type.Object({ id: Type.String(), label: Type.String() }),
      ),
    }),
  ),
});

const SessionParams = Type.Object({ id: Type.String() });

const TranscriptEntrySchema = Type.Object({
  role: Type.Union([Type.Literal("PATIENT"), Type.Literal("BOT")]),
  text: Type.String(),
  at: Type.String(),
});

/** The `ChatSummary` schema of the API. */
export const ChatSummarySchema = Type.Object({
  id: Type.String(),
  sessionId: Type.String(),
  patientId: Type.String(),
  fullTranscript: Type.Array(TranscriptEntrySchema),
  surveyAnswers: Type.Array(
    Type.Object({
      nodeId: Type.String(),
      question: Type.String(),
      answerId: Type.String(),
      answer: Type.String(),
    }),
  ),
  botGuidanceGiven: Type.Array(Type.String()),
  patientQuestions: Type.Array(Type.String()),
  createdAt: Type.String(),
  confirmedAt: Type.Optional(Type.String()),
  summaryStatus: Type.Union([Type.Literal("DRAFT"), Type.Literal("SENT")]),
});

/** Options of the chat routes. */
export interface ChatRoutesOptions {
  chat: ChatService;
  patients: PatientService;
}

function tokenOf(headers: Record<string, unknown>): string | undefined {
  const header = headers["x-patient-token"];
  return typeof header === "string" ? header : undefined;
}

/** `POST /chat`, ending a chat and its summary. */
export const chatRoutes: FastifyPluginAsyncTypebox<ChatRoutesOptions> = async (
  app,
  opts,
) => {
  app.post(
    "/chat",
    {
      schema: {
        body: ChatMessageInSchema,
        response: { 200: ChatReplySchema },
      },
      preValidation: async (req) => {
        opts.patients.authenticate(tokenOf(req.headers));
      },
    },
    async (req) => {
      const patient = opts.patients.authenticate(tokenOf(req.headers));
      return opts.chat.send(patient, req.body);
    },
  );

  const auth = {
    preValidation: async (req: { headers: Record<string, unknown> }) => {
      opts.patients.authenticate(tokenOf(req.headers));
    },
  };

  app.post(
    "/chat/:id/end",
    {
      schema: { params: SessionParams, response: { 200: ChatSummarySchema } },
      preValidation: auth.preValidation,
    },
    async (req) => {
      const patient = opts.patients.authenticate(tokenOf(req.headers));
      return opts.chat.end(patient, req.params.id);
    },
  );

  app.post(
    "/chat/:id/summary/confirm",
    {
      schema: { params: SessionParams, response: { 200: ChatSummarySchema } },
      preValidation: auth.preValidation,
    },
    async (req) => {
      const patient = opts.patients.authenticate(tokenOf(req.headers));
      return opts.chat.confirm(patient, req.params.id);
    },
  );

  app.get(
    "/chat/:id/summary",
    {
      schema: { params: SessionParams, response: { 200: ChatSummarySchema } },
    },
    async (req) => {
      const token = tokenOf(req.headers);
      const patient =
        token === undefined ? undefined : opts.patients.authenticate(token);
      return opts.chat.summaryOf(patient, req.params.id);
    },
  );
};
