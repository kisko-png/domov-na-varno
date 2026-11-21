import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type } from "typebox";
import type { PatientService } from "../services/patient.js";

const Any = Type.Unknown();
const FilledBy = Type.Union([
  Type.Literal("PATIENT"),
  Type.Literal("CAREGIVER"),
]);

const TrendSchema = Type.Union([
  Type.Literal("MUCH_BETTER"),
  Type.Literal("BETTER"),
  Type.Literal("SAME"),
  Type.Literal("WORSE"),
  Type.Literal("MUCH_WORSE"),
]);
const MeasurementsSchema = Type.Record(Type.String(), Type.Number());
const TrendFields = {
  painTrend: Type.Optional(TrendSchema),
  wellbeingTrend: Type.Optional(TrendSchema),
  measurements: Type.Optional(MeasurementsSchema),
};

const RedFlagSchema = Type.Object({
  id: Type.String(),
  symptom: Type.String(),
  severity: Type.Union([
    Type.Literal("CONTACT_DOCTOR"),
    Type.Literal("EMERGENCY"),
  ]),
  action: Type.String(),
  patterns: Type.Optional(Type.Array(Type.String())),
});

/** A `Protocol` of the API, with silence thresholds and the demo notice. */
export const ProtocolSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  riskTier: Type.String(),
  version: Type.String(),
  procedureKeywords: Type.Array(Type.String()),
  checkInSchedule: Type.Array(Any),
  durationDays: Type.Integer(),
  painTolerance: Type.Number(),
  silence: Type.Object({
    yellowAfterHours: Type.Integer(),
    redAfterHours: Type.Integer(),
  }),
  expectedCurve: Any,
  questions: Type.Array(
    Type.Object({
      id: Type.String(),
      label: Type.String(),
      kind: Type.Union([
        Type.Literal("RED_FLAG"),
        Type.Literal("SYMPTOM"),
        Type.Literal("MEASUREMENT"),
      ]),
      unit: Type.Optional(Type.String()),
    }),
  ),
  redFlags: Type.Array(RedFlagSchema),
  surveyGraph: Any,
  guidanceTopics: Type.Array(Any),
  sources: Type.Array(
    Type.Object({ title: Type.String(), url: Type.String() }),
  ),
  demoNotice: Type.String(),
});

const DraftSchema = Type.Object({
  patientId: Type.String(),
  slotDay: Type.Integer(),
  slotIndex: Type.Integer(),
  updatedAt: Type.String(),
  wellbeing: Type.Optional(Type.Integer()),
  pain: Type.Optional(Type.Integer()),
  symptoms: Type.Optional(Type.Array(Type.String())),
  ...TrendFields,
  temperatureC: Type.Optional(Type.Number()),
  photoRef: Type.Optional(Type.String()),
  note: Type.Optional(Type.String()),
  filledBy: Type.Optional(FilledBy),
});

/** The API schema of a Reminder. */
export const ReminderSchema = Type.Object({
  id: Type.String(),
  patientId: Type.String(),
  kind: Type.Union([Type.Literal("FIRST"), Type.Literal("FOLLOW_UP")]),
  sentAt: Type.String(),
  slotDay: Type.Optional(Type.Integer()),
  slotIndex: Type.Optional(Type.Integer()),
  draftPending: Type.Boolean(),
  text: Type.Optional(Type.String()),
});

const PatientViewSchema = Type.Object({
  patientName: Type.String(),
  dayAfterDischarge: Type.Integer(),
  protocol: ProtocolSchema,
  doctorPhone: Type.String(),
  patientInstructions: Type.Array(Type.String()),
  currentSlot: Type.Object({
    day: Type.Integer(),
    index: Type.Integer(),
    dueAt: Type.String(),
  }),
  draft: Type.Optional(DraftSchema),
  pendingReminder: Type.Optional(ReminderSchema),
  trendApplies: Type.Boolean(),
  previousCheckIn: Type.Optional(
    Type.Object({
      timestamp: Type.String(),
      pain: Type.Integer(),
      wellbeing: Type.Integer(),
      ...TrendFields,
    }),
  ),
  demoNotice: Type.String(),
});

const RedFlagWarningSchema = Type.Object({
  showContactDoctor: Type.Boolean(),
  showEmergency112: Type.Boolean(),
  doctorPhone: Type.String(),
  message: Type.Optional(Type.String()),
  redFlags: Type.Array(RedFlagSchema),
});

/** The `CheckIn` schema of the API. */
export const CheckInSchema = Type.Object({
  id: Type.String(),
  patientId: Type.String(),
  protocolVersion: Type.String(),
  dayAfterDischarge: Type.Integer(),
  timestamp: Type.String(),
  wellbeing: Type.Integer(),
  pain: Type.Integer(),
  symptoms: Type.Array(Type.String()),
  ...TrendFields,
  temperatureC: Type.Optional(Type.Number()),
  photoRef: Type.Optional(Type.String()),
  note: Type.Optional(Type.String()),
  filledBy: FilledBy,
});

/** The `Assessment` schema of the API. */
export const AssessmentSchema = Type.Object({
  id: Type.String(),
  patientId: Type.String(),
  checkInId: Type.Optional(Type.String()),
  status: Type.Union([
    Type.Literal("GREEN"),
    Type.Literal("YELLOW"),
    Type.Literal("RED"),
  ]),
  reasons: Type.Array(
    Type.Object({ text: Type.String(), ruleId: Type.String() }),
  ),
  createdAt: Type.String(),
});

const Compared = Type.Object({
  actual: Type.Number(),
  expected: Type.Number(),
  tolerance: Type.Number(),
});

const CheckInResultSchema = Type.Object({
  checkIn: CheckInSchema,
  assessment: AssessmentSchema,
  comparison: Type.Object({ pain: Compared, wellbeing: Compared }),
  showContactDoctor: Type.Boolean(),
  showEmergency112: Type.Boolean(),
  doctorPhone: Type.String(),
  alertCreated: Type.Optional(Type.Boolean()),
  reassuranceAllowed: Type.Boolean(),
  reassuranceText: Type.Optional(Type.String()),
  demoNotice: Type.String(),
});

const CheckInSubmitSchema = Type.Object({
  final: Type.Boolean(),
  wellbeing: Type.Optional(Type.Integer({ minimum: 1, maximum: 5 })),
  pain: Type.Optional(Type.Integer({ minimum: 0, maximum: 10 })),
  symptoms: Type.Optional(Type.Array(Type.String())),
  ...TrendFields,
  temperatureC: Type.Optional(Type.Number({ minimum: 34, maximum: 43 })),
  photoRef: Type.Optional(Type.String()),
  note: Type.Optional(Type.String({ maxLength: 2000 })),
  filledBy: Type.Optional(FilledBy),
});

function tokenOf(headers: Record<string, unknown>): string | undefined {
  const header = headers["x-patient-token"];
  return typeof header === "string" ? header : undefined;
}

/** Options of the patient routes. */
export interface PatientRoutesOptions {
  patients: PatientService;
}

/** `GET /p/{token}` and `POST /checkins/preview`. */
export const patientRoutes: FastifyPluginAsyncTypebox<
  PatientRoutesOptions
> = async (app, opts) => {
  app.get(
    "/p/:token",
    {
      schema: {
        params: Type.Object({ token: Type.String() }),
        response: { 200: PatientViewSchema },
      },
    },
    async (req) => opts.patients.view(req.params.token),
  );
  app.post(
    "/checkins/preview",
    {
      schema: {
        body: Type.Object({ symptoms: Type.Array(Type.String()) }),
        response: { 200: RedFlagWarningSchema },
      },
      preValidation: async (req) => {
        const header = req.headers["x-patient-token"];
        opts.patients.authenticate(
          typeof header === "string" ? header : undefined,
        );
      },
    },
    async (req) => {
      const header = req.headers["x-patient-token"];
      const patient = opts.patients.authenticate(
        typeof header === "string" ? header : undefined,
      );
      return opts.patients.preview(patient, req.body.symptoms);
    },
  );
  app.post(
    "/checkins",
    {
      schema: {
        body: CheckInSubmitSchema,
        response: { 200: DraftSchema, 201: CheckInResultSchema },
      },
      preValidation: async (req) => {
        opts.patients.authenticate(tokenOf(req.headers));
      },
    },
    async (req, reply) => {
      const patient = opts.patients.authenticate(tokenOf(req.headers));
      const { final, ...fields } = req.body;
      if (!final)
        return reply.code(200).send(opts.patients.saveDraft(patient, fields));
      return reply.code(201).send(opts.patients.submit(patient, fields));
    },
  );
};
