import type { CheckIn, Patient, Report } from "../core/seed.js";
import type { Alert, Assessment } from "../core/triage.js";
import type { Db } from "./db.js";

/** An unfinished check-in of one patient and slot. */
export interface CheckInDraft {
  patientId: string;
  slotDay: number;
  slotIndex: 1 | 2;
  updatedAt: string;
  wellbeing?: number;
  pain?: number;
  symptoms?: string[];
  temperatureC?: number;
  photoRef?: string;
  note?: string;
  filledBy?: "PATIENT" | "CAREGIVER";
}

/** A simulated reminder message to a patient. */
export interface Reminder {
  id: string;
  patientId: string;
  kind: "FIRST" | "FOLLOW_UP";
  sentAt: string;
  slotDay?: number;
  slotIndex?: 1 | 2;
  draftPending: boolean;
  text?: string;
}

/** One line of a chat transcript. */
export interface TranscriptEntry {
  role: "PATIENT" | "BOT";
  text: string;
  at: string;
}

/** One conversation of a patient with the bot. */
export interface ChatSession {
  id: string;
  patientId: string;
  createdAt: string;
  transcript: TranscriptEntry[];
  surveyAnswers: {
    questionId: string;
    answerId: string;
    question: string;
    label: string;
  }[];
  /** The id of the survey node last asked and not answered yet, when one is open. */
  pendingSurveyNodeId?: string;
  /** Questions about medication, doses, procedures, tests or therapies, recorded for the summary. */
  patientQuestions: string[];
  /** Titles of the guidance topics given. */
  botGuidanceGiven: string[];
  /** Every `text` message of the patient, in order. */
  patientTexts?: string[];
  /** The text of every GUIDANCE reply given, in order. */
  guidanceReplies?: string[];
  /** The summary of the session, once it is ended. */
  summary?: ChatSummary;
}

/** The summary of one chat session. */
export interface ChatSummary {
  id: string;
  sessionId: string;
  patientId: string;
  fullTranscript: TranscriptEntry[];
  surveyAnswers: {
    nodeId: string;
    question: string;
    answerId: string;
    answer: string;
  }[];
  botGuidanceGiven: string[];
  patientQuestions: string[];
  createdAt: string;
  confirmedAt?: string;
  summaryStatus: "DRAFT" | "SENT";
}

/** The seedable contents of the store. */
export interface StoreContents {
  patients: Patient[];
  reports: Report[];
  checkIns: CheckIn[];
  assessments: Assessment[];
  alerts: Alert[];
}

/** Keeps patients, reports, check-ins, assessments and alerts, in insertion order. */
export interface StoreRepository {
  /** Whether no patient is stored. */
  isEmpty(): boolean;
  /** Adds all the given records in one transaction. */
  addAll(contents: StoreContents): void;
  /** Stores a final check-in with its assessment and alert, and deletes the draft of a slot, in one transaction. */
  addCheckIn(
    checkIn: CheckIn,
    assessment: Assessment,
    alert: Alert | undefined,
    slot: { day: number; index: number } | undefined,
  ): void;
  /** Stores an assessment without a check-in, with its alert, in one transaction. */
  addAssessment(assessment: Assessment, alert: Alert | undefined): void;
  /** Every patient, in insertion order. */
  listPatients(): Patient[];
  /** Every report, in insertion order. */
  listReports(): Report[];
  /** Every check-in, in insertion order. */
  listCheckIns(): CheckIn[];
  /** Every assessment, in insertion order. */
  listAssessments(): Assessment[];
  /** Every alert, in insertion order. */
  listAlerts(): Alert[];
  /** Adds an alert. */
  addAlert(alert: Alert): void;
  /** Replaces the stored alert of the same id. */
  updateAlert(alert: Alert): void;
  /** Stores a draft, replacing the one of the same patient and slot. */
  saveDraft(draft: CheckInDraft): void;
  /** The draft of a patient and slot, if any. */
  getDraft(
    patientId: string,
    slotDay: number,
    slotIndex: number,
  ): CheckInDraft | undefined;
  /** Adds a reminder. */
  addReminder(reminder: Reminder): void;
  /** Every reminder, of one patient when given, in insertion order. */
  listReminders(patientId?: string): Reminder[];
  /** Stores a chat session, replacing the one of the same id. */
  saveChatSession(session: ChatSession): void;
  /** The chat session of an id, if any. */
  getChatSession(id: string): ChatSession | undefined;
  /** The number of chat sessions stored. */
  countChatSessions(): number;
  /** The chat sessions of one patient, in insertion order. */
  listChatSessions(patientId: string): ChatSession[];
  /** The number of chat sessions that have a summary. */
  countChatSummaries(): number;
}

/** A {@link StoreRepository} over the database. */
export function sqliteStoreRepository(db: Db): StoreRepository {
  const list = <T>(table: string): T[] =>
    db
      .prepare(`SELECT data FROM ${table} ORDER BY seq`)
      .all()
      .map((r) => JSON.parse(String(r["data"])) as T);
  return {
    isEmpty() {
      return db.prepare("SELECT 1 FROM patients LIMIT 1").get() === undefined;
    },
    addAll(c) {
      db.exec("BEGIN");
      try {
        const p = db.prepare("INSERT INTO patients (id, data) VALUES (?, ?)");
        for (const x of c.patients) p.run(x.id, JSON.stringify(x));
        const r = db.prepare("INSERT INTO reports (id, data) VALUES (?, ?)");
        for (const x of c.reports) r.run(x.id, JSON.stringify(x));
        const ch = db.prepare(
          "INSERT INTO check_ins (id, patient_id, data) VALUES (?, ?, ?)",
        );
        for (const x of c.checkIns)
          ch.run(x.id, x.patientId, JSON.stringify(x));
        const a = db.prepare(
          "INSERT INTO assessments (id, patient_id, data) VALUES (?, ?, ?)",
        );
        for (const x of c.assessments)
          a.run(x.id, x.patientId, JSON.stringify(x));
        const al = db.prepare(
          "INSERT INTO alerts (id, assessment_id, data) VALUES (?, ?, ?)",
        );
        for (const x of c.alerts)
          al.run(x.id, x.assessmentId, JSON.stringify(x));
        db.exec("COMMIT");
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
    },
    listPatients: () => list<Patient>("patients"),
    addCheckIn(c, a, al, slot) {
      db.exec("BEGIN");
      try {
        db.prepare(
          "INSERT INTO check_ins (id, patient_id, data) VALUES (?, ?, ?)",
        ).run(c.id, c.patientId, JSON.stringify(c));
        db.prepare(
          "INSERT INTO assessments (id, patient_id, data) VALUES (?, ?, ?)",
        ).run(a.id, a.patientId, JSON.stringify(a));
        if (al)
          db.prepare(
            "INSERT INTO alerts (id, assessment_id, data) VALUES (?, ?, ?)",
          ).run(al.id, al.assessmentId, JSON.stringify(al));
        if (slot)
          db.prepare(
            "DELETE FROM drafts WHERE patient_id = ? AND slot = ?",
          ).run(c.patientId, `${slot.day}-${slot.index}`);
        db.exec("COMMIT");
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
    },
    addAssessment(a, al) {
      db.exec("BEGIN");
      try {
        db.prepare(
          "INSERT INTO assessments (id, patient_id, data) VALUES (?, ?, ?)",
        ).run(a.id, a.patientId, JSON.stringify(a));
        if (al)
          db.prepare(
            "INSERT INTO alerts (id, assessment_id, data) VALUES (?, ?, ?)",
          ).run(al.id, al.assessmentId, JSON.stringify(al));
        db.exec("COMMIT");
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
    },
    listReports: () => list<Report>("reports"),
    listCheckIns: () => list<CheckIn>("check_ins"),
    listAssessments: () => list<Assessment>("assessments"),
    listAlerts: () => list<Alert>("alerts"),
    addAlert(al) {
      db.prepare(
        "INSERT INTO alerts (id, assessment_id, data) VALUES (?, ?, ?)",
      ).run(al.id, al.assessmentId, JSON.stringify(al));
    },
    updateAlert(al) {
      db.prepare("UPDATE alerts SET data = ? WHERE id = ?").run(
        JSON.stringify(al),
        al.id,
      );
    },
    saveDraft(d) {
      db.prepare(
        "INSERT INTO drafts (patient_id, slot, data) VALUES (?, ?, ?) ON CONFLICT(patient_id, slot) DO UPDATE SET data = excluded.data",
      ).run(d.patientId, `${d.slotDay}-${d.slotIndex}`, JSON.stringify(d));
    },
    getDraft(patientId, slotDay, slotIndex) {
      const row = db
        .prepare("SELECT data FROM drafts WHERE patient_id = ? AND slot = ?")
        .get(patientId, `${slotDay}-${slotIndex}`);
      return row === undefined
        ? undefined
        : (JSON.parse(String(row["data"])) as CheckInDraft);
    },
    addReminder(r) {
      db.prepare(
        "INSERT INTO reminders (id, patient_id, data) VALUES (?, ?, ?)",
      ).run(r.id, r.patientId, JSON.stringify(r));
    },
    listReminders(patientId) {
      if (patientId === undefined) return list<Reminder>("reminders");
      return db
        .prepare("SELECT data FROM reminders WHERE patient_id = ? ORDER BY seq")
        .all(patientId)
        .map((r) => JSON.parse(String(r["data"])) as Reminder);
    },
    listChatSessions(patientId) {
      return db
        .prepare(
          "SELECT data FROM chat_sessions WHERE patient_id = ? ORDER BY seq",
        )
        .all(patientId)
        .map((r) => JSON.parse(String(r["data"])) as ChatSession);
    },
    saveChatSession(c) {
      db.prepare(
        "INSERT INTO chat_sessions (id, patient_id, data) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data",
      ).run(c.id, c.patientId, JSON.stringify(c));
    },
    getChatSession(id) {
      const row = db
        .prepare("SELECT data FROM chat_sessions WHERE id = ?")
        .get(id);
      return row === undefined
        ? undefined
        : (JSON.parse(String(row["data"])) as ChatSession);
    },
    countChatSessions() {
      const row = db.prepare("SELECT COUNT(*) AS n FROM chat_sessions").get();
      return Number(row?.["n"] ?? 0);
    },
    countChatSummaries() {
      const row = db
        .prepare(
          "SELECT COUNT(*) AS n FROM chat_sessions WHERE json_extract(data, '$.summary') IS NOT NULL",
        )
        .get();
      return Number(row?.["n"] ?? 0);
    },
  };
}

/** An in-memory {@link StoreRepository}. */
export function memoryStoreRepository(): StoreRepository {
  const s: StoreContents = {
    patients: [],
    reports: [],
    checkIns: [],
    assessments: [],
    alerts: [],
  };
  const drafts = new Map<string, CheckInDraft>();
  const reminders: Reminder[] = [];
  const chats = new Map<string, ChatSession>();
  return {
    isEmpty: () => s.patients.length === 0,
    addAll(c) {
      s.patients.push(...structuredClone(c.patients));
      s.reports.push(...structuredClone(c.reports));
      s.checkIns.push(...structuredClone(c.checkIns));
      s.assessments.push(...structuredClone(c.assessments));
      s.alerts.push(...structuredClone(c.alerts));
    },
    listPatients: () => structuredClone(s.patients),
    addCheckIn(c, a, al, slot) {
      s.checkIns.push(structuredClone(c));
      s.assessments.push(structuredClone(a));
      if (al) s.alerts.push(structuredClone(al));
      if (slot) drafts.delete(`${c.patientId}|${slot.day}-${slot.index}`);
    },
    addAssessment(a, al) {
      s.assessments.push(structuredClone(a));
      if (al) s.alerts.push(structuredClone(al));
    },
    listReports: () => structuredClone(s.reports),
    listCheckIns: () => structuredClone(s.checkIns),
    listAssessments: () => structuredClone(s.assessments),
    listAlerts: () => structuredClone(s.alerts),
    addAlert(al) {
      s.alerts.push(structuredClone(al));
    },
    updateAlert(al) {
      const i = s.alerts.findIndex((x) => x.id === al.id);
      if (i >= 0) s.alerts[i] = structuredClone(al);
    },
    saveDraft(d) {
      drafts.set(
        `${d.patientId}|${d.slotDay}-${d.slotIndex}`,
        structuredClone(d),
      );
    },
    getDraft(patientId, slotDay, slotIndex) {
      const d = drafts.get(`${patientId}|${slotDay}-${slotIndex}`);
      return d === undefined ? undefined : structuredClone(d);
    },
    addReminder(r) {
      reminders.push(structuredClone(r));
    },
    listReminders: (patientId) =>
      structuredClone(
        reminders.filter(
          (r) => patientId === undefined || r.patientId === patientId,
        ),
      ),
    saveChatSession(c) {
      chats.set(c.id, structuredClone(c));
    },
    getChatSession(id) {
      const c = chats.get(id);
      return c === undefined ? undefined : structuredClone(c);
    },
    countChatSessions: () => chats.size,
    listChatSessions: (patientId) =>
      [...chats.values()]
        .filter((c) => c.patientId === patientId)
        .map((c) => structuredClone(c)),
    countChatSummaries: () =>
      [...chats.values()].filter((c) => c.summary !== undefined).length,
  };
}
