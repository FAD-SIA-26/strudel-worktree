import * as fs from "node:fs";
import * as path from "node:path";
import * as url from "node:url";
import Database from "better-sqlite3";
import {
  type BetterSQLite3Database,
  drizzle,
} from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema";

export type Db = BetterSQLite3Database<typeof schema>;
const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MIGRATIONS_DIR = path.join(__dirname, "migrations");

let _db: Db | null = null;

function makeDb(sqlite: Database.Database): Db {
  sqlite.pragma("journal_mode = WAL");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return db;
}

function openDb(dbPath: string): Db {
  const sqlite = new Database(dbPath);
  try {
    return makeDb(sqlite);
  } catch (error) {
    sqlite.close();
    throw error;
  }
}

function isCorruptSqliteError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as Error & { code?: string }).code;
  return (
    code === "SQLITE_CORRUPT" ||
    code === "SQLITE_NOTADB" ||
    /database disk image is malformed|file is not a database/i.test(error.message)
  );
}

function nextCorruptBackupPath(dbPath: string): string {
  const base = `${dbPath}.corrupt-${Date.now()}`;
  if (!fs.existsSync(base)) return base;

  let index = 1;
  while (fs.existsSync(`${base}-${index}`)) {
    index += 1;
  }
  return `${base}-${index}`;
}

function moveIfPresent(fromPath: string, toPath: string): void {
  if (!fs.existsSync(fromPath)) return;
  fs.renameSync(fromPath, toPath);
}

function rotateCorruptDbFiles(dbPath: string): string {
  const backupPath = nextCorruptBackupPath(dbPath);
  moveIfPresent(dbPath, backupPath);
  moveIfPresent(`${dbPath}-wal`, `${backupPath}-wal`);
  moveIfPresent(`${dbPath}-shm`, `${backupPath}-shm`);
  return backupPath;
}

export function initDb(dbPath: string): Db {
  try {
    _db = openDb(dbPath);
    return _db;
  } catch (error) {
    if (!isCorruptSqliteError(error) || !fs.existsSync(dbPath)) {
      throw error;
    }

    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    const backupPath = rotateCorruptDbFiles(dbPath);
    console.warn(
      `[orc] recovered corrupt state DB: moved ${dbPath} to ${backupPath}`,
    );
    _db = openDb(dbPath);
    return _db;
  }
}

export function getDb(): Db {
  if (!_db) throw new Error("DB not initialised — call initDb() first");
  return _db;
}

export function createTestDb(): Db {
  return makeDb(new Database(":memory:"));
}

export function getSQLite(db: Db): Database.Database {
  return (db as Db & { session: { client: Database.Database } }).session.client;
}
