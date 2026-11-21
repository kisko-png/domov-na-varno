import { randomUUID } from "node:crypto";
import cors from "@fastify/cors";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import Fastify, {
  LogController,
  type FastifyError,
  type FastifyInstance,
  type FastifyRequest,
} from "fastify";
import type { LogLevel } from "./config.js";
import {
  AlreadySubmittedError,
  ConflictError,
  DomovError,
  ForbiddenError,
  MethodNotAllowedError,
  NoMatchingProtocolError,
  NotFoundError,
  UnauthenticatedError,
  ValidationError,
  type FieldError,
} from "./errors.js";
import type { ClockRepository } from "./repositories/clock.js";
import type { StoreRepository } from "./repositories/store.js";
import { simRoutes } from "./routes/sim.js";
import { patientRoutes } from "./routes/patient.js";
import { historyRoutes } from "./routes/history.js";
import { reminderRoutes } from "./routes/reminders.js";
import { staffRoutes } from "./routes/staff.js";
import { reportRoutes } from "./routes/reports.js";
import { ReportService } from "./services/reports.js";
import { StaffService } from "./services/staff.js";
import { ReminderService } from "./services/reminders.js";
import { HistoryService } from "./services/history.js";
import { PatientService } from "./services/patient.js";
import { ClockService } from "./services/clock.js";
import { resetStore } from "./services/seed.js";
import { SL } from "./strings.sl.js";
import { protocolRoutes } from "./routes/protocols.js";
import { ProtocolService } from "./services/protocols.js";
import { chatRoutes } from "./routes/chat.js";
import { ChatService } from "./services/chat.js";
import { fakeLlmClient, type LlmClient } from "./services/llm.js";

/** What {@link buildApp} is given. */
export interface AppDeps {
  clockRepository: ClockRepository;
  storeRepository: StoreRepository;
  /** The real clock in epoch milliseconds. */
  realNow: () => number;
  /** The log level; `silent` turns logging off. */
  logLevel: LogLevel | "silent";
  /** The language model client; the fake one when not given. */
  llm?: LlmClient;
}

interface ErrorBody {
  error: { code: string; message: string; details?: FieldError[] };
}

function body(
  code: string,
  message: string,
  details?: FieldError[],
): ErrorBody {
  return { error: details ? { code, message, details } : { code, message } };
}

function domainStatus(err: DomovError): [number, string] | undefined {
  if (err instanceof NotFoundError) return [404, "not_found"];
  if (err instanceof AlreadySubmittedError) return [409, "already_submitted"];
  if (err instanceof ConflictError) return [409, "conflict"];
  if (err instanceof NoMatchingProtocolError)
    return [422, "no_matching_protocol"];
  if (err instanceof ValidationError) return [422, "validation_error"];
  if (err instanceof UnauthenticatedError) return [401, "unauthenticated"];
  if (err instanceof ForbiddenError) return [403, "forbidden"];
  if (err instanceof MethodNotAllowedError) return [405, "method_not_allowed"];
  return undefined;
}

function fieldOf(v: {
  instancePath?: string;
  params?: Record<string, unknown>;
}): string {
  const base = (v.instancePath ?? "").replace(/^\//, "").replaceAll("/", ".");
  const missing = v.params?.["missingProperty"];
  if (typeof missing === "string") return base ? `${base}.${missing}` : missing;
  return base;
}

/** A Slovenian message for one schema-layer validation error. */
export function slovenianMessage(v: {
  keyword?: string;
  instancePath?: string;
  params?: Record<string, unknown>;
}): string {
  const p = v.params ?? {};
  switch (v.keyword) {
    case "required":
      return SL.errors.requiredField(fieldOf(v));
    case "type":
      return SL.errors.invalidType;
    case "minimum":
    case "exclusiveMinimum":
    case "minItems":
      return SL.errors.tooSmall(p["limit"]);
    case "maximum":
    case "exclusiveMaximum":
    case "maxItems":
      return SL.errors.tooLarge(p["limit"]);
    case "maxLength":
      return SL.errors.tooLong(p["limit"]);
    case "enum":
    case "const":
    case "anyOf":
      return SL.errors.notAllowedValue;
    case "additionalProperties": {
      const extra = p["additionalProperty"];
      return SL.errors.unknownField(
        typeof extra === "string" ? extra : fieldOf(v),
      );
    }
    default:
      return SL.errors.invalidField;
  }
}

/** Builds the HTTP service over its repositories and real clock. */
export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger:
      deps.logLevel === "silent"
        ? false
        : {
            level: deps.logLevel.toLowerCase(),
            name: "domov",
            messageKey: "message",
            base: { logger: "domov" },
            timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
            formatters: { level: (label) => ({ level: label.toUpperCase() }) },
          },
    requestIdHeader: "x-request-id",
    genReqId: () => randomUUID(),
    logController: new LogController({
      requestIdLogLabel: "request_id",
      disableRequestLogging: true,
    }),
  }).withTypeProvider<TypeBoxTypeProvider>();

  app.addHook("onRequest", async (req, reply) => {
    reply.header("X-Request-ID", req.id);
  });
  // A POST with no body, or an empty one, is an empty JSON object, whatever its Content-Type.
  app.removeAllContentTypeParsers();
  const parseBody = (
    req: FastifyRequest,
    raw: string | Buffer,
    done: (err: Error | null, body?: unknown) => void,
  ): void => {
    const text = String(raw);
    if (text.trim() === "") return done(null, {});
    try {
      done(null, JSON.parse(text) as unknown);
    } catch (err) {
      req.log.warn({ err }, "request body is not valid JSON");
      done(new ValidationError(SL.errors.badRequest));
    }
  };
  app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    parseBody,
  );
  app.addContentTypeParser("*", { parseAs: "string" }, parseBody);
  app.addHook("preValidation", async (req) => {
    if (req.method === "POST" && (req.body === undefined || req.body === null))
      req.body = {};
  });
  app.addHook("onResponse", async (req, reply) => {
    req.log.info(
      {
        method: req.method,
        path: req.url.split("?")[0],
        status: reply.statusCode,
        duration_ms: Math.round(reply.elapsedTime),
      },
      "request completed",
    );
  });

  app.setErrorHandler((err: FastifyError, req, reply) => {
    if (err.validation) {
      const details = err.validation.map((v) => ({
        field: fieldOf(v),
        message: slovenianMessage(v),
      }));
      return reply
        .status(422)
        .send(body("validation_error", SL.errors.validation, details));
    }
    if (err instanceof DomovError) {
      const mapped = domainStatus(err);
      if (mapped) {
        const details =
          err instanceof ValidationError ? err.details : undefined;
        return reply
          .status(mapped[0])
          .send(body(mapped[1], err.message, details));
      }
    }
    const status = err.statusCode;
    if (status !== undefined && status >= 400 && status < 500) {
      req.log.warn({ err }, "request rejected by the framework");
      return reply
        .status(422)
        .send(body("validation_error", SL.errors.badRequest, []));
    }
    req.log.error({ err }, "unexpected failure");
    return reply.status(500).send(body("internal_error", SL.errors.internal));
  });
  app.setNotFoundHandler((req, reply) =>
    reply
      .status(404)
      .send(body("not_found", SL.errors.routeNotFound(req.method, req.url))),
  );

  await app.register(cors, { origin: "*" });
  const clock = new ClockService(deps.clockRepository, deps.realNow);
  await app.register(simRoutes, {
    clock,
    reset: () => resetStore(deps.storeRepository, clock),
  });
  const patients = new PatientService(deps.storeRepository, clock);
  await app.register(patientRoutes, { patients });
  const history = new HistoryService(deps.storeRepository);
  await app.register(historyRoutes, { history });
  const reminders = new ReminderService(deps.storeRepository, clock);
  await app.register(reminderRoutes, { reminders });
  const staff = new StaffService(deps.storeRepository, clock);
  await app.register(staffRoutes, { staff });
  const reports = new ReportService(deps.storeRepository, staff);
  await app.register(reportRoutes, { reports });
  await app.register(protocolRoutes, { protocols: new ProtocolService() });
  const chat = new ChatService(
    deps.storeRepository,
    clock,
    deps.llm ?? fakeLlmClient(),
    (fields, message) => app.log.warn(fields, message),
  );
  await app.register(chatRoutes, { chat, patients });
  return app;
}
