import type { Db } from "./db.js";

/** Keeps the simulated clock's offset. */
export interface ClockRepository {
  /** The offset in minutes, 0 when none is stored. */
  getOffsetMinutes(): number;
  /** Stores the offset in minutes. */
  setOffsetMinutes(minutes: number): void;
}

/** A {@link ClockRepository} over the database. */
export function sqliteClockRepository(db: Db): ClockRepository {
  return {
    getOffsetMinutes() {
      const row = db
        .prepare("SELECT value FROM settings WHERE key = 'offsetMinutes'")
        .get();
      return row === undefined ? 0 : Number(row["value"]);
    },
    setOffsetMinutes(minutes) {
      db.prepare(
        "INSERT INTO settings (key, value) VALUES ('offsetMinutes', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      ).run(String(minutes));
    },
  };
}

/** An in-memory {@link ClockRepository}. */
export function memoryClockRepository(initial = 0): ClockRepository {
  let offset = initial;
  return {
    getOffsetMinutes: () => offset,
    setOffsetMinutes(minutes) {
      offset = minutes;
    },
  };
}
