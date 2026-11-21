import { ConfigError } from "./errors.js";

/** Log levels the service accepts in `LOG_LEVEL`. */
export const LOG_LEVELS = [
  "TRACE",
  "DEBUG",
  "INFO",
  "WARN",
  "ERROR",
  "FATAL",
] as const;

/** A log level of the service. */
export type LogLevel = (typeof LOG_LEVELS)[number];

/** The typed settings of the service, read once at start. */
export interface Settings {
  port: number;
  host: string;
  logLevel: LogLevel;
  databasePath: string;
  /** The language model client: `fake` (default) or `anthropic`. */
  llmProvider: "fake" | "anthropic";
  /** The Anthropic API key; a secret, required with `anthropic`. */
  anthropicApiKey?: string;
  /** The model of `LLM_MODEL`, when set. */
  llmModel?: string;
}

/** Reads the settings from an environment; throws {@link ConfigError} naming the bad setting. */
export function loadSettings(
  env: Record<string, string | undefined>,
): Settings {
  const portRaw = env["PORT"] ?? "3000";
  const port = Number(portRaw);
  if (!/^\d+$/.test(portRaw) || port < 1 || port > 65535) {
    throw new ConfigError(
      `PORT must be an integer 1-65535, got ${JSON.stringify(portRaw)}`,
    );
  }
  const levelRaw = (env["LOG_LEVEL"] ?? "INFO").toUpperCase();
  const logLevel = LOG_LEVELS.find((l) => l === levelRaw);
  if (logLevel === undefined) {
    throw new ConfigError(
      `LOG_LEVEL must be one of ${LOG_LEVELS.join(", ")}, got ${JSON.stringify(env["LOG_LEVEL"])}`,
    );
  }
  const databasePath = env["DATABASE_PATH"] ?? "domov.db";
  if (databasePath.trim() === "") {
    throw new ConfigError("DATABASE_PATH must not be empty");
  }
  const providerRaw = (env["LLM_PROVIDER"] ?? "fake").toLowerCase();
  if (providerRaw !== "fake" && providerRaw !== "anthropic") {
    throw new ConfigError(
      `LLM_PROVIDER must be fake or anthropic, got ${JSON.stringify(env["LLM_PROVIDER"])}`,
    );
  }
  const settings: Settings = {
    port,
    host: "0.0.0.0",
    logLevel,
    databasePath,
    llmProvider: providerRaw,
  };
  const key = env["ANTHROPIC_API_KEY"];
  if (providerRaw === "anthropic" && (key === undefined || key === "")) {
    throw new ConfigError(
      "ANTHROPIC_API_KEY is required when LLM_PROVIDER is anthropic",
    );
  }
  if (key) settings.anthropicApiKey = key;
  const model = env["LLM_MODEL"];
  if (model) settings.llmModel = model;
  return settings;
}
