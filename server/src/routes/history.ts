import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type } from "typebox";
import { MethodNotAllowedError } from "../errors.js";
import type { HistoryService } from "../services/history.js";
import { SL } from "../strings.sl.js";
import { AssessmentSchema, CheckInSchema } from "./patient.js";

/** Options of the history routes. */
export interface HistoryRoutesOptions {
  history: HistoryService;
}

/** `GET /patients/{id}/checkins`, `GET /assessments`, and 405 on changing either. */
export const historyRoutes: FastifyPluginAsyncTypebox<
  HistoryRoutesOptions
> = async (app, opts) => {
  app.get(
    "/patients/:id/checkins",
    {
      schema: {
        params: Type.Object({ id: Type.String() }),
        response: { 200: Type.Array(CheckInSchema) },
      },
    },
    async (req) => opts.history.checkIns(req.params.id),
  );
  app.get(
    "/assessments",
    {
      schema: {
        querystring: Type.Object({ patientId: Type.String() }),
        response: { 200: Type.Array(AssessmentSchema) },
      },
    },
    async (req) => opts.history.assessments(req.query.patientId),
  );
  for (const url of ["/checkins/:id", "/assessments/:id"]) {
    app.route({
      method: ["PUT", "PATCH", "DELETE"],
      url,
      schema: { params: Type.Object({ id: Type.String() }) },
      onRequest: async (req) => {
        throw new MethodNotAllowedError(SL.errors.methodNotAllowed(req.method));
      },
      handler: async (req) => {
        throw new MethodNotAllowedError(SL.errors.methodNotAllowed(req.method));
      },
    });
  }
};
