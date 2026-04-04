const BASE = "https://mcpplayground.tech/api/v1";

export interface LintIssue {
  rule: string;
  severity: "error" | "warning" | "info";
  message: string;
  tool?: string;
}

export interface LintResult {
  url: string;
  grade: string;
  score: number;
  tokenEstimate: number;
  totals: { errors: number; warnings: number; infos: number };
  issues: LintIssue[];
  summary: { tools: number; resources: number; prompts: number };
}

export interface InspectResult {
  url: string;
  tools: { name: string; description?: string; inputSchema?: unknown }[];
  resources: { name: string; description?: string }[];
  prompts: { name: string; description?: string }[];
}

export interface HealthResult {
  status: "up" | "down" | "auth_required" | "unknown";
  latencyMs: number;
}

export interface DiffResult {
  base: LintResult;
  head: LintResult;
  gradeDrop: boolean;
  scoreDrop: number;
  tokenIncreasePct: number;
}

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
