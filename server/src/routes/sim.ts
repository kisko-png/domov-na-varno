import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type } from "typebox";
import type { ClockService, SimClock } from "../services/clock.js";

const SimClockSchema = Type.Object({
  now: Type.String({ format: "date-time" }),
  offsetMinutes: Type.Integer(),
});

const SimAdvanceSchema = Type.Object({
  minutes: Type.Optional(Type.Integer({ minimum: 1, default: 1440 })),
});

/** Options of the sim routes. */
export interface SimRoutesOptions {
  clock: ClockService;
  /** Empties the store and reseeds it at offset 0. */
  reset: () => SimClock;
}

/** `GET /sim/now`, `POST /sim/advance` and `POST /admin/reset`. */
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
    async (req) => opts.clock.advance(req.body.minutes ?? 1440),
  );
  app.post(
    "/admin/reset",
    { schema: { response: { 200: SimClockSchema } } },
    async () => opts.reset(),
  );
};
