import { describe, expect, it } from "vitest";
import { loadSettings } from "./config.js";
import { ConfigError } from "./errors.js";

describe("loadSettings", () => {
  it("has defaults", () => {
    expect(loadSettings({})).toEqual({
      port: 3000,
      host: "0.0.0.0",
      logLevel: "INFO",
      databasePath: "domov.db",
      llmProvider: "fake",
    });
  });
  it("reads PORT, LOG_LEVEL and DATABASE_PATH", () => {
    expect(
      loadSettings({ PORT: "8000", LOG_LEVEL: "debug", DATABASE_PATH: "x.db" }),
    ).toMatchObject({ port: 8000, logLevel: "DEBUG", databasePath: "x.db" });
  });
  it("reads the LLM settings", () => {
    expect(
      loadSettings({
        LLM_PROVIDER: "anthropic",
        ANTHROPIC_API_KEY: "k",
        LLM_MODEL: "m",
      }),
    ).toMatchObject({
      llmProvider: "anthropic",
      anthropicApiKey: "k",
      llmModel: "m",
    });
  });
  it.each([
    { PORT: "abc" },
    { PORT: "0" },
    { LOG_LEVEL: "loud" },
    { LLM_PROVIDER: "openai" },
    { LLM_PROVIDER: "anthropic" },
  ])("rejects %j", (env) => {
    expect(() => loadSettings(env)).toThrow(ConfigError);
  });
});
