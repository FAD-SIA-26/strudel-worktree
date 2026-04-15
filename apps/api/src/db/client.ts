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

export function initDb(dbPath: string): Db {
  _db = makeDb(new Database(dbPath));
  return _db;
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
