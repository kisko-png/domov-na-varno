import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type } from "typebox";
import type { StaffService } from "../services/staff.js";
import { AssessmentSchema } from "./patient.js";

/** Options of the staff patient routes. */
export interface StaffRoutesOptions {
  staff: StaffService;
}

const Status = Type.Union([
  Type.Literal("GREEN"),
  Type.Literal("YELLOW"),
  Type.Literal("RED"),
]);

const Role = Type.Union([Type.Literal("NURSE"), Type.Literal("COORDINATOR")]);

const alertFields = {
  id: Type.String(),
  assessmentId: Type.String(),
  recipientRole: Role,
  createdAt: Type.String(),
  acknowledgedAt: Type.Optional(Type.String()),
  escalatedAt: Type.Optional(Type.String()),
};

/** An `Alert` of the API. */
export const AlertSchema = Type.Object(alertFields);

/** An `AlertView` of the API. */
export const AlertViewSchema = Type.Object({
  ...alertFields,
  patientId: Type.String(),
  patientName: Type.String(),
  status: Status,
  reasons: Type.Array(
    Type.Object({ text: Type.String(), ruleId: Type.String() }),
  ),
});

/** A `Patient` of the API. */
export const PatientSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  phone: Type.String(),
  dischargeDate: Type.String(),
  protocolId: Type.String(),
  reportId: Type.String(),
  caregiverName: Type.Optional(Type.String()),
  preferredCheckInTime: Type.String(),
  accessToken: Type.String(),
});

/** A `PatientSummary` of the API. */
export const PatientSummarySchema = Type.Object({
  patient: PatientSchema,
  protocolName: Type.String(),
  riskTier: Type.Union([
    Type.Literal("HIGH"),
    Type.Literal("MEDIUM"),
    Type.Literal("LOW"),
  ]),
  dayAfterDischarge: Type.Integer(),
  status: Status,
  latestAssessment: Type.Optional(AssessmentSchema),
  lastCheckInAt: Type.Optional(Type.String()),
  openAlerts: Type.Integer(),
});

/** A `Brief` of the API. */
export const BriefSchema = Type.Object({
  forDay: Type.String(),
  generatedAt: Type.String(),
  demoNotice: Type.String(),
  entries: Type.Array(
    Type.Object({
      patientId: Type.String(),
      patientName: Type.String(),
      status: Status,
      reasons: Type.Array(
        Type.Object({ text: Type.String(), ruleId: Type.String() }),
      ),
      callScript: Type.String(),
    }),
  ),
});

/** `GET /patients`: the dashboard. */
export const staffRoutes: FastifyPluginAsyncTypebox<
  StaffRoutesOptions
> = async (app, opts) => {
  app.get(
    "/patients",
    { schema: { response: { 200: Type.Array(PatientSummarySchema) } } },
    async () => opts.staff.listPatients(),
  );
  app.get("/brief", { schema: { response: { 200: BriefSchema } } }, async () =>
    opts.staff.brief(),
  );
  app.get(
    "/alerts",
    {
      schema: {
        querystring: Type.Object({ role: Type.Optional(Role) }),
        response: { 200: Type.Array(AlertViewSchema) },
      },
    },
    async (req) => opts.staff.listAlerts(req.query.role),
  );
  app.post(
    "/alerts/:id/ack",
    {
      schema: {
        params: Type.Object({ id: Type.String() }),
        response: { 200: AlertSchema },
      },
    },
    async (req) => opts.staff.acknowledge(req.params.id),
  );
};
