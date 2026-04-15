import * as fs from "node:fs/promises";
import * as path from "node:path";

export interface DoneMarker {
  status: "done" | "failed";
  exitCode: number;
  ts: number;
}
export type ReconcileStatus =
  | "done"
  | "failed"
  | "interrupted"
  | "never-started"
  | "missing";

export async function readDoneMarker(
  wtPath: string,
): Promise<DoneMarker | null> {
  try {
    return JSON.parse(
      await fs.readFile(path.join(wtPath, ".orc", ".orc-done.json"), "utf-8"),
    );
  } catch {
    return null;
  }
}

export async function writeDoneMarker(
  wtPath: string,
  marker: DoneMarker,
): Promise<void> {
  await fs.writeFile(
    path.join(wtPath, ".orc", ".orc-done.json"),
    JSON.stringify(marker),
  );
}
