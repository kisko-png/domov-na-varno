import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type } from "typebox";
import type { ReportService } from "../services/reports.js";
import { ProtocolSchema } from "./patient.js";
import { PatientSummarySchema } from "./staff.js";

/** Options of the report routes. */
export interface ReportRoutesOptions {
  reports: ReportService;
}

const LocalDay = Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" });

/** A `ReportCreate` of the API. */
export const ReportCreateSchema = Type.Object({
  patient: Type.Object({
    name: Type.String({ minLength: 1 }),
    phone: Type.String(),
    dischargeDate: LocalDay,
    preferredCheckInTime: Type.String({
      pattern: "^([01][0-9]|2[0-3]):[0-5][0-9]$",
    }),
    caregiverName: Type.Optional(Type.String()),
  }),
  procedure: Type.String({ minLength: 1 }),
  procedureDate: LocalDay,
  medications: Type.Array(Type.String()),
  specialWarnings: Type.Array(Type.String()),
  restrictions: Type.Array(Type.String()),
  recommendations: Type.String(),
  doctorContactPhone: Type.String(),
});

/** A `Report` of the API. */
export const ReportSchema = Type.Object({
  id: Type.String(),
  patientId: Type.String(),
  procedure: Type.String(),
  procedureDate: Type.String(),
  medications: Type.Array(Type.String()),
  specialWarnings: Type.Array(Type.String()),
  restrictions: Type.Array(Type.String()),
  recommendations: Type.String(),
  doctorContactPhone: Type.String(),
});

/** A `PatientDetail` of the API. */
export const PatientDetailSchema = Type.Intersect([
  PatientSummarySchema,
  Type.Object({
    report: ReportSchema,
    protocol: ProtocolSchema,
    patientInstructions: Type.Array(Type.String()),
    sentSummaries: Type.Array(
      Type.Object({ sessionId: Type.String(), confirmedAt: Type.String() }),
    ),
  }),
]);

/** `POST /reports`: enter a discharge report and create its patient. */
export const reportRoutes: FastifyPluginAsyncTypebox<
  ReportRoutesOptions
> = async (app, opts) => {
  app.post(
    "/reports",
    {
      schema: {
        body: ReportCreateSchema,
        response: { 201: PatientDetailSchema },
      },
    },
    async (req, reply) => reply.status(201).send(opts.reports.create(req.body)),
  );
  app.get(
    "/patients/:id",
    {
      schema: {
        params: Type.Object({ id: Type.String() }),
        response: { 200: PatientDetailSchema },
      },
    },
    async (req) => opts.reports.detail(req.params.id),
  );
};
