import { InvalidMomentError } from "../errors.js";

/** The time zone of every LocalDay. */
export const TIME_ZONE = "Europe/Ljubljana";

const PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function parts(ms: number): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of PARTS.formatToParts(new Date(ms))) out[p.type] = p.value;
  return out;
}

/** Converts a Date or ISO string to epoch milliseconds; throws `InvalidMomentError` when invalid. */
export function toMillis(moment: Date | string): number {
  const ms = typeof moment === "string" ? Date.parse(moment) : moment.getTime();
  if (Number.isNaN(ms))
    throw new InvalidMomentError(`Invalid moment: ${String(moment)}`);
  return ms;
}

/** Offset of Europe/Ljubljana from UTC at the instant, in minutes. */
export function offsetMinutes(ms: number): number {
  const p = parts(ms);
  const asUtc = Date.UTC(
    Number(p["year"]),
    Number(p["month"]) - 1,
    Number(p["day"]),
    Number(p["hour"]),
    Number(p["minute"]),
    Number(p["second"]),
  );
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60000);
}

/** The LocalDay (YYYY-MM-DD in Europe/Ljubljana) of an instant. */
export function localDayOf(ms: number): string {
  const p = parts(ms);
  return `${p["year"]}-${p["month"]}-${p["day"]}`;
}

/** Adds `days` calendar days to a LocalDay. */
export function addDays(day: string, days: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const date = new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, (d ?? 1) + days));
  return date.toISOString().slice(0, 10);
}

/** Formats an instant as ISO 8601 with the Europe/Ljubljana offset, e.g. `2025-03-01T08:00:00+01:00`. */
export function formatInstant(ms: number): string {
  const p = parts(ms);
  const off = offsetMinutes(ms);
  const sign = off < 0 ? "-" : "+";
  const abs = Math.abs(off);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return `${p["year"]}-${p["month"]}-${p["day"]}T${p["hour"]}:${p["minute"]}:${p["second"]}${sign}${hh}:${mm}`;
}

/** The instant of local time `HH:MM` on a LocalDay in Europe/Ljubljana. */
export function localTimeToMillis(day: string, time: string): number {
  const [y, mo, d] = day.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  const naive = Date.UTC(y ?? 0, (mo ?? 1) - 1, d ?? 1, h ?? 0, mi ?? 0);
  let guess = naive - offsetMinutes(naive) * 60000;
  guess = naive - offsetMinutes(guess) * 60000;
  return guess;
}
