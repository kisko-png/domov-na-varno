import { dueReminders } from "../core/reminders.js";
import { protocolOfPatient } from "../core/personalProtocol.js";
import { toMillis } from "../core/time.js";
import type { Reminder, StoreRepository } from "../repositories/store.js";
import { SL } from "../strings.sl.js";
import type { ClockService } from "./clock.js";

/** Sends the simulated check-in reminders and reads their log. */
export class ReminderService {
  /** Creates the service over the store and the simulated clock. */
  constructor(
    private readonly store: StoreRepository,
    private readonly clock: ClockService,
  ) {}

  /** Adds every reminder due at the simulated now that has not been sent yet. */
  sendDue(): void {
    const now = this.clock.now();
    const checkIns = this.store.listCheckIns();
    const all = this.store.listReminders();
    let n = all.length;
    for (const patient of this.store.listPatients()) {
      const own = checkIns.filter((c) => c.patientId === patient.id);
      const sent = all.filter((r) => r.patientId === patient.id);
      const protocol = protocolOfPatient(patient, this.store.listReports());
      for (const d of dueReminders(protocol, patient, own, sent, now)) {
        const draftPending =
          this.store.getDraft(patient.id, d.slotDay, d.slotIndex) !== undefined;
        n += 1;
        const base =
          d.kind === "FIRST"
            ? SL.patient.reminderFirst
            : SL.patient.reminderFollowUp;
        this.store.addReminder({
          id: `rem-${n}`,
          patientId: patient.id,
          kind: d.kind,
          sentAt: d.sentAt,
          slotDay: d.slotDay,
          slotIndex: d.slotIndex,
          draftPending,
          text: draftPending ? base + SL.patient.reminderDraft : base,
        });
      }
    }
  }

  /** Sends the due reminders, then lists them latest `sentAt` first, of one patient when given. */
  list(patientId?: string): Reminder[] {
    this.sendDue();
    return this.store
      .listReminders(patientId)
      .map((r, i) => ({ r, i }))
      .sort((a, b) => toMillis(b.r.sentAt) - toMillis(a.r.sentAt) || a.i - b.i)
      .map(({ r }) => r);
  }
}
