import { type ChildProcess, spawn } from "node:child_process";
import * as fs from "node:fs";
import * as http from "node:http";
import { createRequire } from "node:module";
import * as net from "node:net";
import * as path from "node:path";

interface DashboardOptions {
  apiPort: number;
  dashboardPort: number;
  stateDir: string;
  webRoot?: string;
}

export interface DashboardHandle {
  process: ChildProcess | null;
  url: string;
  stop: () => void;
}

class DashboardStartupError extends Error {
  constructor(
    message: string,
    readonly output: string,
  ) {
    super(message);
  }
}

function isPortOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.end();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

function waitForDashboard(url: string, timeoutMs = 20_000): Promise<void> {
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    const check = () => {
      const req = http.get(url, (res) => {
        res.resume();
        if ((res.statusCode ?? 500) < 500) {
          resolve();
          return;
        }
        if (Date.now() - startedAt >= timeoutMs) {
          reject(new Error(`dashboard did not become ready at ${url}`));
          return;
        }
        setTimeout(check, 250);
      });

      req.on("error", () => {
        if (Date.now() - startedAt >= timeoutMs) {
          reject(new Error(`dashboard did not become ready at ${url}`));
          return;
        }
        setTimeout(check, 250);
      });
    };

    check();
  });
}

export function pickReusableDashboardUrl(output: string): string | null {
  if (!output.includes("Another next dev server is already running"))
    return null;
  const matches = [...output.matchAll(/Local:\s+(https?:\/\/[^\s]+)/g)];
  return matches.at(-1)?.[1] ?? null;
}

export function pickDashboardCandidateUrls(
  output: string,
  preferredPort: number,
): string[] {
  const matches = [...output.matchAll(/Local:\s+(https?:\/\/[^\s]+)/g)]
    .map((match) => match[1])
    .filter((url): url is string => Boolean(url));

  const candidates = [
    pickReusableDashboardUrl(output),
    `http://127.0.0.1:${preferredPort}`,
    `http://localhost:${preferredPort}`,
    ...matches,
  ].filter((url): url is string => Boolean(url));

  return [...new Set(candidates)];
}

function waitForDashboardUrl(
  proc: ChildProcess,
  timeoutMs = 20_000,
): Promise<string> {
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    let output = "";

    const onData = (chunk: Buffer) => {
      output += chunk.toString();
      const match = output.match(/Local:\s+(https?:\/\/[^\s]+)/);
      if (match?.[1]) {
        cleanup();
        resolve(match[1]);
        return;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        cleanup();
        reject(
          new DashboardStartupError(
            "dashboard did not report a local URL",
            output,
          ),
        );
      }
    };

    const onExit = () => {
      cleanup();
      reject(
        new DashboardStartupError(
          "dashboard process exited before it became ready",
          output,
        ),
      );
    };

    const cleanup = () => {
      proc.stdout?.off("data", onData);
      proc.stderr?.off("data", onData);
      proc.off("exit", onExit);
    };

    proc.stdout?.on("data", onData);
    proc.stderr?.on("data", onData);
    proc.once("exit", onExit);

    setTimeout(() => {
      cleanup();
      reject(
        new DashboardStartupError(
          "dashboard did not report a local URL",
          output,
        ),
      );
    }, timeoutMs);
  });
}

async function startDashboardServer(
  opts: DashboardOptions,
): Promise<DashboardHandle> {
  if (
    !opts.webRoot ||
    !fs.existsSync(path.join(opts.webRoot, "package.json"))
  ) {
    return { process: null, url: "", stop: () => {} };
  }

  const preferredDashboardUrl = `http://127.0.0.1:${opts.dashboardPort}`;

  if (await isPortOpen(opts.dashboardPort)) {
    return { process: null, url: preferredDashboardUrl, stop: () => {} };
  }

  fs.mkdirSync(opts.stateDir, { recursive: true });
  const logPath = path.join(opts.stateDir, "dashboard.log");
  const logStream = fs.createWriteStream(logPath, { flags: "a" });
  const require = createRequire(import.meta.url);
  let nextBin: string;
  try {
    nextBin = require.resolve("next/dist/bin/next", {
      paths: [opts.webRoot],
    });
  } catch {
    logStream.end();
    return { process: null, url: "", stop: () => {} };
  }
  let output = "";

  const proc = spawn(
    process.execPath,
    [
      nextBin,
      "dev",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(opts.dashboardPort),
    ],
    {
      cwd: opts.webRoot,
      env: {
        ...process.env,
        NEXT_PUBLIC_API_URL: `http://localhost:${opts.apiPort}`,
        NEXT_PUBLIC_WS_URL: `ws://localhost:${opts.apiPort}`,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  proc.stdout?.on("data", (chunk) => {
    output += chunk.toString();
    logStream.write(chunk);
  });
  proc.stderr?.on("data", (chunk) => {
    output += chunk.toString();
    logStream.write(chunk);
  });

  const stop = () => {
    if (!proc.killed) proc.kill("SIGTERM");
    logStream.end();
  };

  try {
    const dashboardUrl = await waitForDashboardUrl(proc);
    try {
      await waitForDashboard(dashboardUrl);
    } catch {
      throw new DashboardStartupError(
        `dashboard did not become ready at ${dashboardUrl}`,
        output,
      );
    }
    return {
      process: proc,
      url: dashboardUrl,
      stop,
    };
  } catch (error) {
    stop();
    throw error;
  }
}

export async function ensureDashboardServer(
  opts: DashboardOptions,
): Promise<DashboardHandle> {
  try {
    return await startDashboardServer(opts);
  } catch (error) {
    if (!(error instanceof DashboardStartupError)) throw error;

    for (const candidateUrl of pickDashboardCandidateUrls(
      error.output,
      opts.dashboardPort,
    )) {
      try {
        await waitForDashboard(candidateUrl, 5_000);
        return { process: null, url: candidateUrl, stop: () => {} };
      } catch {}
    }

    await new Promise((resolve) => setTimeout(resolve, 1_000));
    return startDashboardServer(opts);
  }
}
