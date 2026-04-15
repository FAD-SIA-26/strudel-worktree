import * as fs from "node:fs";
import * as path from "node:path";
import * as url from "node:url";

export interface OrcPaths {
  stateDir: string;
  dbPath: string;
  worktreesDir: string;
  runsDir: string;
}

export interface OrcAppRoots {
  packageRoot: string;
  apiRoot: string;
  webRoot?: string;
}

function pathExists(targetPath: string): boolean {
  return fs.existsSync(targetPath);
}

function findInstallRoot(startDir: string): string {
  let dir = startDir;
  let nearestPackageRoot: string | null = null;

  while (true) {
    if (pathExists(path.join(dir, "package.json"))) {
      nearestPackageRoot = dir;
    }
    if (pathExists(path.join(dir, "pnpm-workspace.yaml"))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return nearestPackageRoot ?? startDir;
    }
    dir = parent;
  }
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
  const installRoot = findInstallRoot(path.dirname(filename));
  const sourceApiRoot = path.join(installRoot, "apps", "api");
  const sourceWebRoot = path.join(installRoot, "apps", "web");
  const packagedWebRoot = path.join(installRoot, "web");
  const apiRoot = pathExists(sourceApiRoot) ? sourceApiRoot : installRoot;

  let webRoot: string | undefined;
  if (pathExists(sourceWebRoot)) {
    webRoot = sourceWebRoot;
  } else if (pathExists(packagedWebRoot)) {
    webRoot = packagedWebRoot;
  }

  return {
    packageRoot: installRoot,
    apiRoot,
    webRoot,
  };
}

export function resolveOrcAssetPath(
  moduleUrl: string,
  ...segments: string[]
): string | undefined {
  const { packageRoot } = getOrcAppRoots(moduleUrl);
  const assetPath = path.join(packageRoot, ...segments);
  return pathExists(assetPath) ? assetPath : undefined;
}
