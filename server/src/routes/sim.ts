import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type } from "typebox";
import type { ClockService } from "../services/clock.js";

const SimClockSchema = Type.Object({
  now: Type.String({ format: "date-time" }),
  offsetMinutes: Type.Integer(),
});

const SimAdvanceSchema = Type.Object({
  minutes: Type.Integer({ minimum: 1 }),
});

/** Options of the sim routes. */
export interface SimRoutesOptions {
  clock: ClockService;
}

/** `GET /sim/now` and `POST /sim/advance`. */
export const simRoutes: FastifyPluginAsyncTypebox<SimRoutesOptions> = async (
  app,
  opts,
) => {
  app.get(
    "/sim/now",
    { schema: { response: { 200: SimClockSchema } } },
    async () => opts.clock.current(),
  );
  app.post(
    "/sim/advance",
    { schema: { body: SimAdvanceSchema, response: { 200: SimClockSchema } } },
    async (req) => opts.clock.advance(req.body.minutes),
  );
};
