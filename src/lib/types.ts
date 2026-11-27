/** Shared types for inspection and lint results. */

export interface ToolSchema {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export interface ResourceInfo {
  uri: string;
  name?: string;
  description?: string;
  mimeType?: string;
}

export interface PromptInfo {
  name: string;
  description?: string;
  arguments?: Array<{
    name: string;
    description?: string;
    required?: boolean;
  }>;
}

export type TransportKind = "streamable-http" | "sse" | "websocket" | "stdio";

export interface InspectResult {
  /** The URL or command that was inspected. */
  url: string;
  serverInfo: {
    name: string;
    version: string;
  };
  capabilities: {
    tools: boolean;
    resources: boolean;
    prompts: boolean;
  };
  tools: ToolSchema[];
  resources: ResourceInfo[];
  prompts: PromptInfo[];
  transport: TransportKind;
  connectionTimeMs: number;
}

export interface LintIssue {
  rule: string;
  severity: "error" | "warning" | "info";
  message: string;
  target?: string;
  category?: string;
}

export interface LintResult {
  ok: boolean;
  url: string;
  server?: { name: string; version?: string };
  transport?: string;
  grade: string;
  score: number;
  tokenEstimate: { total: number; perTool?: { name: string; tokens: number }[] };
  summary: {
    errors: number;
    warnings: number;
    infos: number;
    toolsChecked: number;
    resourcesChecked: number;
    promptsChecked: number;
  };
  issues: LintIssue[];
}

export interface HealthResult {
  status: "up" | "down" | "auth_required" | "unknown";
  latencyMs: number;
}
