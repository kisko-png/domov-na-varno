import { buildApp } from "./app.js";
import { loadSettings, type Settings } from "./config.js";
import { ConfigError } from "./errors.js";
import { sqliteClockRepository } from "./repositories/clock.js";
import { openDb } from "./repositories/db.js";
import { sqliteStoreRepository } from "./repositories/store.js";
import { ClockService } from "./services/clock.js";
import { seedStoreIfEmpty } from "./services/seed.js";
import { anthropicLlmClient, fakeLlmClient } from "./services/llm.js";

async function main(): Promise<void> {
  let settings: Settings;
  try {
    settings = loadSettings(process.env);
  } catch (err) {
    if (err instanceof ConfigError) {
      process.stderr.write(`Invalid configuration: ${err.message}\n`);
      process.exit(1);
    }
    throw err;
  }
  const db = openDb(settings.databasePath);
  const clockRepository = sqliteClockRepository(db);
  const storeRepository = sqliteStoreRepository(db);
  const realNow = (): number => Date.now();
  seedStoreIfEmpty(
    storeRepository,
    new ClockService(clockRepository, realNow).now(),
  );
  const app = await buildApp({
    clockRepository,
    storeRepository,
    realNow,
    logLevel: settings.logLevel,
    llm:
      settings.llmProvider === "anthropic" && settings.anthropicApiKey
        ? anthropicLlmClient(settings.anthropicApiKey, settings.llmModel)
        : fakeLlmClient(),
  });
  let stopping = false;
  const stop = (signal: string): void => {
    if (stopping) return;
    stopping = true;
    app.log.info({ signal }, "shutting down");
    const timer = setTimeout(() => {
      app.log.error("shutdown took longer than 10 s; exiting");
      process.exit(1);
    }, 10_000);
    timer.unref();
    app.close().then(
      () => {
        db.close();
        process.exit(0);
      },
      (err: unknown) => {
        app.log.error({ err }, "shutdown failed");
        process.exit(1);
      },
    );
  };
  process.on("SIGTERM", () => stop("SIGTERM"));
  process.on("SIGINT", () => stop("SIGINT"));
  await app.listen({ port: settings.port, host: settings.host });
}

main().catch((err: unknown) => {
  process.stderr.write(
    `Failed to start: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
  );
  process.exit(1);
});
