import type { Protocol } from "./protocols.js";
import { checkInSlots } from "./schedule.js";
import type { CheckIn, Patient } from "./seed.js";
import { formatInstant, toMillis } from "./time.js";

/** Hours after a slot's due time when the follow-up reminder is sent. */
export const FOLLOW_UP_HOURS = 3;

/** A reminder that is due: its kind, slot and the moment it is sent. */
export interface DueReminder {
  kind: "FIRST" | "FOLLOW_UP";
  slotDay: number;
  slotIndex: 1 | 2;
  sentAt: string;
}

/**
 * The reminders due at `now` for the slots due at or before `now`, after the latest check-in and not covered
 * (a slot of index n is covered when its day has at least n check-ins): a FIRST at `dueAt` and, once
 * 3 hours have passed, a FOLLOW_UP at `dueAt` plus 3 hours. Reminders in `sent` (same kind and slot) are left out.
 * Returned in time order.
 */
export function dueReminders(
  protocol: Protocol,
  patient: Patient,
  checkIns: readonly CheckIn[],
  sent: readonly { kind: string; slotDay?: number; slotIndex?: number }[],
  now: Date | string,
): DueReminder[] {
  const nowMs = toMillis(now);
  const latest = checkIns.reduce(
    (m, c) => Math.max(m, toMillis(c.timestamp)),
    -Infinity,
  );
  const perDay = new Map<number, number>();
  for (const c of checkIns)
    perDay.set(c.dayAfterDischarge, (perDay.get(c.dayAfterDischarge) ?? 0) + 1);
  const done = new Set(
    sent.map((r) => `${r.kind}|${r.slotDay}|${r.slotIndex}`),
  );
  const out: DueReminder[] = [];
  for (const s of checkInSlots(protocol, patient)) {
    const due = toMillis(s.dueAt);
    if (due > nowMs || due <= latest || (perDay.get(s.day) ?? 0) >= s.index)
      continue;
    const index = s.index as 1 | 2;
    if (!done.has(`FIRST|${s.day}|${index}`))
      out.push({
        kind: "FIRST",
        slotDay: s.day,
        slotIndex: index,
        sentAt: formatInstant(due),
      });
    const follow = due + FOLLOW_UP_HOURS * 3600000;
    if (follow <= nowMs && !done.has(`FOLLOW_UP|${s.day}|${index}`))
      out.push({
        kind: "FOLLOW_UP",
        slotDay: s.day,
        slotIndex: index,
        sentAt: formatInstant(follow),
      });
  }
  return out.sort((a, b) => toMillis(a.sentAt) - toMillis(b.sentAt));
}
