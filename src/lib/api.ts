/** Client for the hosted MCP Playground API. Used only with --remote. */

import type { HealthResult, InspectResult, LintResult } from "./types.js";

const BASE = "https://mcpplayground.tech/api/v1";

async function get<T>(path: string, url: string): Promise<T> {
  const encoded = encodeURIComponent(url);
  const res = await fetch(`${BASE}/${path}?url=${encoded}`);
  if (!res.ok) {
    throw new Error(`API error ${res.status}: ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export async function lint(url: string): Promise<LintResult> {
  return get<LintResult>("lint", url);
}

export async function inspect(url: string): Promise<InspectResult> {
  return get<InspectResult>("inspect", url);
}

export async function health(url: string): Promise<HealthResult> {
  return get<HealthResult>("health", url);
}
