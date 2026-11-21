import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type } from "typebox";
import type { ReminderService } from "../services/reminders.js";
import { ReminderSchema } from "./patient.js";

/** Options of the reminder routes. */
export interface ReminderRoutesOptions {
  reminders: ReminderService;
}

/** `GET /reminders`. */
export const reminderRoutes: FastifyPluginAsyncTypebox<
  ReminderRoutesOptions
> = async (app, opts) => {
  app.get(
    "/reminders",
    {
      schema: {
        querystring: Type.Object({ patientId: Type.Optional(Type.String()) }),
        response: { 200: Type.Array(ReminderSchema) },
      },
    },
    async (req) => opts.reminders.list(req.query.patientId),
  );
};
