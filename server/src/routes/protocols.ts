import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type } from "typebox";
import type { ProtocolService } from "../services/protocols.js";
import { ProtocolSchema } from "./patient.js";

/** Options of the protocol routes. */
export interface ProtocolRoutesOptions {
  protocols: ProtocolService;
}

/** `GET /protocols`: the base protocols, not personalised. */
export const protocolRoutes: FastifyPluginAsyncTypebox<
  ProtocolRoutesOptions
> = async (app, opts) => {
  app.get(
    "/protocols",
    { schema: { response: { 200: Type.Array(ProtocolSchema) } } },
    async () => opts.protocols.list(),
  );
};
