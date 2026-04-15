import { describe, expect, it } from "vitest";
import {
  pickDashboardCandidateUrls,
  pickReusableDashboardUrl,
} from "./dashboard";

describe("pickReusableDashboardUrl", () => {
  it("returns the already-running dashboard URL from Next duplicate-server output", () => {
    const output = [
      "▲ Next.js 16.2.3 (Turbopack)",
      "- Local:         http://127.0.0.1:3301",
      "✓ Ready in 184ms",
      "⨯ Another next dev server is already running.",
      "",
      "- Local:        http://localhost:3121",
      "- PID:          2093291",
    ].join("\n");

    expect(pickReusableDashboardUrl(output)).toBe("http://localhost:3121");
  });

  it("returns null for normal startup output", () => {
    const output = [
      "▲ Next.js 16.2.3 (Turbopack)",
      "- Local:         http://127.0.0.1:3301",
      "✓ Ready in 184ms",
    ].join("\n");

    expect(pickReusableDashboardUrl(output)).toBeNull();
  });

  it("returns the reused dashboard URL only when the running server env matches the requested API targets", () => {
    const output = [
      "▲ Next.js 16.2.3 (Turbopack)",
      "- Local:         http://127.0.0.1:3301",
      "✓ Ready in 184ms",
      "⨯ Another next dev server is already running.",
      "",
      "- Local:        http://localhost:3121",
      "- PID:          2093291",
    ].join("\n");

    expect(
      pickReusableDashboardUrl(
        output,
        {
          apiUrl: "http://localhost:4000",
          wsUrl: "ws://localhost:4000",
        },
        () => ({
          NEXT_PUBLIC_API_URL: "http://127.0.0.1:4000",
          NEXT_PUBLIC_WS_URL: "ws://127.0.0.1:4000",
        }),
      ),
    ).toBe("http://localhost:3121");
  });

  it("rejects the reused dashboard URL when the running server env points at a different API target", () => {
    const output = [
      "▲ Next.js 16.2.3 (Turbopack)",
      "- Local:         http://127.0.0.1:3301",
      "✓ Ready in 184ms",
      "⨯ Another next dev server is already running.",
      "",
      "- Local:        http://localhost:3121",
      "- PID:          2093291",
    ].join("\n");

    expect(
      pickReusableDashboardUrl(
        output,
        {
          apiUrl: "http://localhost:4001",
          wsUrl: "ws://localhost:4001",
        },
        () => ({
          NEXT_PUBLIC_API_URL: "http://127.0.0.1:4000",
          NEXT_PUBLIC_WS_URL: "ws://127.0.0.1:4000",
        }),
      ),
    ).toBeNull();
  });
});

describe("pickDashboardCandidateUrls", () => {
  it("prefers the reused dashboard URL and keeps the requested port as a fallback", () => {
    const output = [
      "▲ Next.js 16.2.3 (Turbopack)",
      "- Local:         http://127.0.0.1:3301",
      "✓ Ready in 184ms",
      "⨯ Another next dev server is already running.",
      "",
      "- Local:        http://localhost:3121",
      "- PID:          2093291",
    ].join("\n");

    expect(pickDashboardCandidateUrls(output, 3121)).toEqual([
      "http://localhost:3121",
      "http://127.0.0.1:3121",
      "http://127.0.0.1:3301",
    ]);
  });

  it("omits the duplicate-server URL when the caller rejected it as stale", () => {
    const output = [
      "▲ Next.js 16.2.3 (Turbopack)",
      "- Local:         http://127.0.0.1:3301",
      "✓ Ready in 184ms",
      "⨯ Another next dev server is already running.",
      "",
      "- Local:        http://localhost:3121",
      "- PID:          2093291",
    ].join("\n");

    expect(pickDashboardCandidateUrls(output, 3121, null)).toEqual([
      "http://127.0.0.1:3301",
    ]);
  });

  it("deduplicates repeated Local URLs", () => {
    const output = [
      "- Local:         http://127.0.0.1:3121",
      "- Local:         http://127.0.0.1:3121",
    ].join("\n");

    expect(pickDashboardCandidateUrls(output, 3121)).toEqual([
      "http://127.0.0.1:3121",
      "http://localhost:3121",
    ]);
  });
});
