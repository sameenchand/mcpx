/**
 * One place that decides how a target is reached: directly from this machine
 * (the default) or through the hosted MCP Playground API (--remote).
 */

import * as api from "./api.js";
import { healthDirect, inspectDirect } from "./client.js";
import { lintMcpServer } from "./linter.js";
import { parseTarget } from "./target.js";
import type { HealthResult, InspectResult, LintResult } from "./types.js";

export interface RunOptions {
  /** Use the hosted API instead of connecting from this machine. */
  remote?: boolean;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

function remoteUrl(input: string, opts: RunOptions): string {
  const target = parseTarget(input);
  if (target.kind !== "url") {
    throw new Error("--remote only works with a server URL, not a command.");
  }
  if (opts.headers && Object.keys(opts.headers).length > 0) {
    throw new Error("--remote cannot send custom headers. Drop --remote to connect directly.");
  }
  return target.url;
}

export async function inspectTarget(input: string, opts: RunOptions = {}): Promise<InspectResult> {
  if (opts.remote) return api.inspect(remoteUrl(input, opts));
  return inspectDirect(parseTarget(input), opts);
}

export async function lintTarget(input: string, opts: RunOptions = {}): Promise<LintResult> {
  if (opts.remote) return api.lint(remoteUrl(input, opts));

  const inspected = await inspectDirect(parseTarget(input), opts);
  const report = lintMcpServer(inspected);
  return {
    ok: true,
    url: inspected.url,
    server: inspected.serverInfo,
    transport: inspected.transport,
    grade: report.grade,
    score: report.score,
    tokenEstimate: report.tokenEstimate,
    summary: report.summary,
    issues: report.issues,
  };
}

export async function healthTarget(input: string, opts: RunOptions = {}): Promise<HealthResult> {
  if (opts.remote) return api.health(remoteUrl(input, opts));
  return healthDirect(parseTarget(input), opts);
}
