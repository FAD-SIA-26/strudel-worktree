import * as path from "node:path";
import * as url from "node:url";

export interface OrcPaths {
  stateDir: string;
  dbPath: string;
  worktreesDir: string;
  runsDir: string;
}

export interface OrcAppRoots {
  apiRoot: string;
  webRoot: string;
}

export function getOrcPaths(repoRoot: string): OrcPaths {
  const stateDir = path.join(repoRoot, ".orc");
  return {
    stateDir,
    dbPath: path.join(stateDir, "orc.db"),
    worktreesDir: path.join(stateDir, "worktrees"),
    runsDir: path.join(stateDir, "runs"),
  };
}

export function getOrcAppRoots(moduleUrl: string): OrcAppRoots {
  const filename = url.fileURLToPath(moduleUrl);
  const srcDir = path.dirname(filename);
  const apiRoot = path.resolve(srcDir, "..");
  return {
    apiRoot,
    webRoot: path.resolve(apiRoot, "../web"),
  };
}
