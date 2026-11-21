import { DatabaseSync } from "node:sqlite";
import { StorageError } from "../errors.js";

/** The service's SQLite database. */
export type Db = DatabaseSync;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS patients (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS reports (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS check_ins (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, patient_id TEXT NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS assessments (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, patient_id TEXT NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS alerts (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, assessment_id TEXT NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS drafts (seq INTEGER PRIMARY KEY AUTOINCREMENT, patient_id TEXT NOT NULL, slot TEXT NOT NULL, data TEXT NOT NULL, UNIQUE (patient_id, slot));
CREATE TABLE IF NOT EXISTS reminders (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, patient_id TEXT NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS chat_sessions (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, patient_id TEXT NOT NULL, data TEXT NOT NULL);
CREATE TRIGGER IF NOT EXISTS check_ins_no_update BEFORE UPDATE ON check_ins BEGIN SELECT RAISE(ABORT, 'check_ins are append-only'); END;
CREATE TRIGGER IF NOT EXISTS check_ins_no_delete BEFORE DELETE ON check_ins BEGIN SELECT RAISE(ABORT, 'check_ins are append-only'); END;
CREATE TRIGGER IF NOT EXISTS assessments_no_update BEFORE UPDATE ON assessments BEGIN SELECT RAISE(ABORT, 'assessments are append-only'); END;
CREATE TRIGGER IF NOT EXISTS assessments_no_delete BEFORE DELETE ON assessments BEGIN SELECT RAISE(ABORT, 'assessments are append-only'); END;
`;

/** Opens the database at `path` (`:memory:` for an in-memory one) and creates missing tables. */
export function openDb(path: string): Db {
  try {
    const db = new DatabaseSync(path);
    db.exec(SCHEMA);
    return db;
  } catch (err) {
    throw new StorageError(`Cannot open database at ${path}`, { cause: err });
  }
}
