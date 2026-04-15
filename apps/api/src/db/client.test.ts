import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import Database from "better-sqlite3";
import { afterAll, describe, expect, it } from "vitest";
import { getSQLite, initDb } from "./client";

const tempDirs: string[] = [];

afterAll(async () => {
  await Promise.all(
    tempDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "orc-db-client-"));
  tempDirs.push(dir);
  return dir;
}

async function createCorruptDb(dbPath: string): Promise<void> {
  const db = new Database(dbPath);
  db.exec(`
    create table t (id integer primary key, v text);
    with recursive c(x) as (
      select 1
      union all
      select x + 1 from c where x < 1000
    )
    insert into t(v) select hex(randomblob(50)) from c;
  `);
  db.close();

  const file = await fs.open(dbPath, "r+");
  try {
    await file.truncate(4096);
  } finally {
    await file.close();
  }
}

describe("initDb", () => {
  it("rotates a corrupt on-disk database and recreates the schema", async () => {
    const dir = await makeTempDir();
    const dbPath = path.join(dir, "orc.db");

    await createCorruptDb(dbPath);

    const db = initDb(dbPath);
    const sqlite = getSQLite(db);

    expect(
      sqlite
        .prepare(
          "select name from sqlite_master where type = 'table' and name = 'tasks'",
        )
        .get(),
    ).toEqual({ name: "tasks" });

    const files = await fs.readdir(dir);
    expect(files.some((file) => file.startsWith("orc.db.corrupt-"))).toBe(true);

    sqlite.close();
  });
});
