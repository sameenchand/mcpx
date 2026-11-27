#!/usr/bin/env node

// src/index.ts
import { Command } from "commander";

// src/commands/lint.ts
import ora from "ora";
import chalk2 from "chalk";

// src/lib/api.ts
var BASE = "https://mcpplayground.tech/api/v1";
async function get(path, url) {
  const encoded = encodeURIComponent(url);
  const res = await fetch(`${BASE}/${path}?url=${encoded}`);
  if (!res.ok) {
    throw new Error(`API error ${res.status}: ${res.statusText}`);
  }
  return res.json();
}
async function lint(url) {
  return get("lint", url);
}
async function inspect(url) {
  return get("inspect", url);
}
async function health(url) {
  return get("health", url);
}

// src/lib/client.ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { WebSocketClientTransport } from "@modelcontextprotocol/sdk/client/websocket.js";
var ConnectError = class extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = "ConnectError";
  }
};
var DEFAULT_URL_TIMEOUT_MS = 1e4;
var DEFAULT_STDIO_TIMEOUT_MS = 6e4;
var MAX_PAGES = 50;
var STDERR_TAIL_CHARS = 2e3;
var CLIENT_INFO = { name: "mcpx", version: "0.2.0" };
function isAuthError(msg) {
  const lower = msg.toLowerCase();
  return lower.includes("401") || lower.includes("403") || lower.includes("unauthorized") || lower.includes("forbidden") || lower.includes("invalid_token") || lower.includes("access denied");
}
async function withTimeout(work, ms) {
  let timer;
  try {
    return await Promise.race([
      work,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new ConnectError("TIMEOUT", "timed out")), ms);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
function inheritedEnv() {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== void 0) env[key] = value;
  }
  return env;
}
async function tryConnect(transport, timeoutMs) {
  const client = new Client(CLIENT_INFO);
  try {
    await withTimeout(client.connect(transport), timeoutMs);
    return client;
  } catch (err) {
    await client.close().catch(() => {
    });
    await transport.close().catch(() => {
    });
    throw err;
  }
}
function describe(err) {
  return err instanceof Error ? err.message : String(err);
}
async function connect(target, opts) {
  const started = Date.now();
  if (target.kind === "stdio") {
    const timeoutMs2 = opts.timeoutMs ?? DEFAULT_STDIO_TIMEOUT_MS;
    const transport = new StdioClientTransport({
      command: target.command,
      args: target.args,
      env: target.env ? { ...getDefaultEnvironment(), ...target.env } : inheritedEnv(),
      ...target.cwd ? { cwd: target.cwd } : {},
      stderr: "pipe"
    });
    let stderrTail = "";
    transport.stderr?.on("data", (chunk) => {
      stderrTail = (stderrTail + chunk.toString("utf8")).slice(-STDERR_TAIL_CHARS);
    });
    try {
      const client = await tryConnect(transport, timeoutMs2);
      return { client, transport: "stdio", connectionTimeMs: Date.now() - started };
    } catch (err) {
      if (err instanceof ConnectError && err.code === "TIMEOUT") {
        throw new ConnectError(
          "TIMEOUT",
          `Command did not complete the MCP handshake within ${Math.round(timeoutMs2 / 1e3)}s.`
        );
      }
      const tail = stderrTail.trim();
      throw new ConnectError(
        "CONNECTION_FAILED",
        `Could not start "${target.command}": ${describe(err)}${tail ? `
${tail}` : ""}`
      );
    }
  }
  const timeoutMs = opts.timeoutMs ?? DEFAULT_URL_TIMEOUT_MS;
  const serverUrl = new URL(target.url);
  const hasHeaders = opts.headers && Object.keys(opts.headers).length > 0;
  const requestInit = hasHeaders ? { headers: opts.headers } : void 0;
  const transportOpts = requestInit ? { requestInit } : void 0;
  const fail = (err) => {
    if (err instanceof ConnectError) {
      return new ConnectError("TIMEOUT", `Server did not respond within ${Math.round(timeoutMs / 1e3)}s.`);
    }
    const msg = describe(err);
    if (isAuthError(msg)) {
      return new ConnectError(
        "UNAUTHORIZED",
        'Server requires authentication. Pass credentials with --header "Authorization: Bearer <token>".'
      );
    }
    return new ConnectError("CONNECTION_FAILED", `Could not connect: ${msg}`);
  };
  if (/^wss?:/i.test(target.url)) {
    if (typeof globalThis.WebSocket === "undefined") {
      throw new ConnectError("CONNECTION_FAILED", "WebSocket servers need Node.js 22 or newer.");
    }
    try {
      const client = await tryConnect(new WebSocketClientTransport(serverUrl), timeoutMs);
      return { client, transport: "websocket", connectionTimeMs: Date.now() - started };
    } catch (err) {
      throw fail(err);
    }
  }
  try {
    const client = await tryConnect(new StreamableHTTPClientTransport(serverUrl, transportOpts), timeoutMs);
    return { client, transport: "streamable-http", connectionTimeMs: Date.now() - started };
  } catch (err) {
    const first = fail(err);
    if (first.code !== "CONNECTION_FAILED") throw first;
    try {
      const client = await tryConnect(new SSEClientTransport(serverUrl, transportOpts), timeoutMs);
      return { client, transport: "sse", connectionTimeMs: Date.now() - started };
    } catch (sseErr) {
      const second = fail(sseErr);
      throw second.code === "CONNECTION_FAILED" ? first : second;
    }
  }
}
async function listAll(fetchPage) {
  const all = [];
  let cursor;
  for (let page = 0; page < MAX_PAGES; page++) {
    const { items, nextCursor } = await fetchPage(cursor);
    all.push(...items);
    if (!nextCursor) break;
    cursor = nextCursor;
  }
  return all;
}
async function inspectDirect(target, opts = {}) {
  const { client, transport, connectionTimeMs } = await connect(target, opts);
  try {
    const info = client.getServerVersion();
    const caps = client.getServerCapabilities();
    const hasTools = !!caps?.tools;
    const hasResources = !!caps?.resources;
    const hasPrompts = !!caps?.prompts;
    const [tools, resources, prompts] = await Promise.all([
      hasTools ? listAll(async (cursor) => {
        const r = await client.listTools(cursor ? { cursor } : void 0);
        return {
          items: r.tools.map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema
          })),
          nextCursor: r.nextCursor
        };
      }) : Promise.resolve([]),
      hasResources ? listAll(async (cursor) => {
        const r = await client.listResources(cursor ? { cursor } : void 0);
        return {
          items: r.resources.map((x) => ({
            uri: x.uri,
            name: x.name,
            description: x.description,
            mimeType: x.mimeType
          })),
          nextCursor: r.nextCursor
        };
      }) : Promise.resolve([]),
      hasPrompts ? listAll(async (cursor) => {
        const r = await client.listPrompts(cursor ? { cursor } : void 0);
        return {
          items: r.prompts.map((p) => ({
            name: p.name,
            description: p.description,
            arguments: p.arguments
          })),
          nextCursor: r.nextCursor
        };
      }) : Promise.resolve([])
    ]);
    return {
      url: target.label,
      serverInfo: {
        name: info?.name ?? "Unknown Server",
        version: info?.version ?? "unknown"
      },
      capabilities: { tools: hasTools, resources: hasResources, prompts: hasPrompts },
      tools,
      resources,
      prompts,
      transport,
      connectionTimeMs
    };
  } catch (err) {
    if (err instanceof ConnectError) throw err;
    throw new ConnectError("CONNECTION_FAILED", `Connected, but listing failed: ${describe(err)}`);
  } finally {
    await client.close().catch(() => {
    });
  }
}
async function healthDirect(target, opts = {}) {
  const started = Date.now();
  try {
    const { client, connectionTimeMs } = await connect(target, opts);
    await client.close().catch(() => {
    });
    return { status: "up", latencyMs: connectionTimeMs };
  } catch (err) {
    const latencyMs = Date.now() - started;
    if (err instanceof ConnectError && err.code === "UNAUTHORIZED") {
      return { status: "auth_required", latencyMs };
    }
    return { status: "down", latencyMs };
  }
}

// src/lib/security.ts
var HIDDEN_CHARS = /[​-‏‪-‮⁠-⁤⁦-⁩﻿]|\uDB40[\uDC00-\uDC7F]/;
var INSTRUCTION_PATTERNS = [
  {
    pattern: /\b(ignore|disregard|forget|override)\b[^.\n]{0,30}\b(previous|prior|above|earlier|all|other|system)\b[^.\n]{0,20}\b(instructions?|prompts?|rules|guidelines)\b/i,
    what: "tells the model to ignore its instructions"
  },
  {
    pattern: /\b(do not|don't|never|without)\s+(tell|telling|mention|mentioning|inform|informing|notify|notifying|reveal|revealing|alert|alerting|show|showing)\b[^.\n]{0,25}\b(the )?(user|human|operator)\b/i,
    what: "tells the model to hide something from the user"
  },
  {
    pattern: /<\s*\/?\s*(important|system|instructions?|secret|hidden|admin)\s*>/i,
    what: "contains an instruction-style tag aimed at the model"
  },
  {
    pattern: /\b(before|prior to)\s+(using|calling|invoking|running)\s+(any|all|every)\s+(other\s+)?tools?\b/i,
    what: "tries to run ahead of every other tool"
  },
  {
    pattern: /\binstead of\s+(using|calling|invoking)\s+(the\s+)?[\w-]+\s+tool\b/i,
    what: "tries to replace another tool"
  }
];
var SENSITIVE_PATHS = [
  { pattern: /(~|\$HOME|\/home\/[\w.-]+|\/Users\/[\w.-]+)\/\.ssh\b|\bid_(rsa|ed25519|ecdsa)\b/i, what: "SSH keys" },
  { pattern: /\.aws\/credentials\b/i, what: "AWS credentials" },
  { pattern: /(^|[\s"'`/])\.env\b(?!\.example)/i, what: ".env files" },
  { pattern: /\/etc\/(passwd|shadow)\b/i, what: "system account files" },
  { pattern: /\.(cursor|claude|codeium|vscode)\/[\w./-]*mcp[\w.-]*\.json\b|claude_desktop_config\.json\b/i, what: "MCP client configuration" }
];
var PADDING = / {40,}|\t{10,}|(\r?\n[ \t]*){8,}/;
function schemaStrings(node, out = [], depth = 0) {
  if (depth > 12 || node === null || node === void 0) return out;
  if (typeof node === "string") {
    out.push(node);
  } else if (Array.isArray(node)) {
    for (const item of node) schemaStrings(item, out, depth + 1);
  } else if (typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      out.push(key);
      schemaStrings(value, out, depth + 1);
    }
  }
  return out;
}
function checkText(texts, target, category) {
  const findings = [];
  const seen = /* @__PURE__ */ new Set();
  const add = (severity, rule, message) => {
    if (seen.has(rule)) return;
    seen.add(rule);
    findings.push({ target, category, severity, rule, message });
  };
  for (const text of texts) {
    if (HIDDEN_CHARS.test(text)) {
      add(
        "error",
        "sec-hidden-characters",
        "Contains invisible or direction-changing Unicode characters. These can hide instructions from a human reviewer."
      );
    }
    for (const { pattern, what } of INSTRUCTION_PATTERNS) {
      if (pattern.test(text)) {
        add("error", "sec-prompt-injection", `Metadata ${what}. This is a tool-poisoning pattern.`);
      }
    }
    for (const { pattern, what } of SENSITIVE_PATHS) {
      if (pattern.test(text)) {
        add("warning", "sec-sensitive-path", `Metadata refers to ${what}. Check that the tool has a reason to mention them.`);
      }
    }
    if (PADDING.test(text)) {
      add(
        "warning",
        "sec-hidden-padding",
        "Contains a long run of blank space, which can push text out of view in a client's approval dialog."
      );
    }
  }
  return findings;
}
function auditMetadata(result) {
  const findings = [];
  for (const tool of result.tools) {
    const texts = [tool.name, tool.description ?? "", ...schemaStrings(tool.inputSchema)];
    findings.push(...checkText(texts, tool.name, "tool"));
  }
  for (const resource of result.resources) {
    const texts = [resource.uri, resource.name ?? "", resource.description ?? ""];
    findings.push(...checkText(texts, resource.name ?? resource.uri, "resource"));
  }
  for (const prompt of result.prompts) {
    const texts = [
      prompt.name,
      prompt.description ?? "",
      ...(prompt.arguments ?? []).flatMap((a) => [a.name, a.description ?? ""])
    ];
    findings.push(...checkText(texts, prompt.name, "prompt"));
  }
  return findings;
}

// src/lib/linter.ts
function estimateTokens(text) {
  return Math.ceil(text.length / 3.5);
}
function estimateToolTokens(tool) {
  let text = tool.name;
  if (tool.description) text += " " + tool.description;
  text += " " + JSON.stringify(tool.inputSchema);
  return estimateTokens(text);
}
function lintTool(tool) {
  const issues = [];
  const t = (rule, severity, message) => ({
    target: tool.name,
    category: "tool",
    severity,
    rule,
    message
  });
  if (!tool.description || tool.description.trim().length === 0) {
    issues.push(t("tool-no-description", "error", "Missing tool description. LLMs rely on this to select the right tool."));
  } else {
    const desc = tool.description.trim();
    if (desc.length < 10) {
      issues.push(t("tool-short-description", "warning", `Description is only ${desc.length} chars. Add more detail so models understand when to use this tool.`));
    }
    if (desc.length > 500) {
      issues.push(t("tool-long-description", "warning", `Description is ${desc.length} chars \u2014 consider trimming to reduce token cost. Aim for under 300 chars.`));
    }
    if (desc.toLowerCase().replace(/[_-]/g, " ") === tool.name.toLowerCase().replace(/[_-]/g, " ")) {
      issues.push(t("tool-description-is-name", "warning", "Description just repeats the tool name. Add a meaningful explanation."));
    }
  }
  const schema = tool.inputSchema;
  if (!schema || typeof schema !== "object") {
    issues.push(t("tool-no-schema", "warning", "Missing inputSchema. Clients won't know what arguments to send."));
  } else {
    const properties = schema.properties;
    const required2 = schema.required;
    if (schema.type !== "object") {
      issues.push(t("tool-schema-not-object", "info", `inputSchema type is "${String(schema.type)}" instead of "object". Most clients expect an object at the top level.`));
    }
    if (properties && typeof properties === "object") {
      const propNames = Object.keys(properties);
      for (const propName of propNames) {
        const prop = properties[propName];
        if (!prop) continue;
        if (!prop.description || typeof prop.description === "string" && prop.description.trim().length === 0) {
          issues.push(t("prop-no-description", "warning", `Property "${propName}" has no description. Models perform better with described parameters.`));
        }
        if (!prop.type && !prop.enum && !prop.oneOf && !prop.anyOf && !prop.allOf && !prop.$ref) {
          issues.push(t("prop-no-type", "warning", `Property "${propName}" has no type defined. Add a type (string, number, boolean, etc.).`));
        }
      }
      if (propNames.length > 0 && (!required2 || !Array.isArray(required2) || required2.length === 0)) {
        issues.push(t("tool-no-required", "info", "No required properties defined. Consider marking essential parameters as required."));
      }
      if (required2 && Array.isArray(required2)) {
        for (const req of required2) {
          if (!propNames.includes(req)) {
            issues.push(t("required-not-in-properties", "error", `"${req}" is listed as required but doesn't exist in properties.`));
          }
        }
      }
    } else if (schema.type === "object") {
      issues.push(t("tool-empty-schema", "info", "Tool accepts no arguments (empty schema). If it should accept inputs, add properties."));
    }
  }
  if (!/^[a-z][a-z0-9_-]*$/i.test(tool.name)) {
    issues.push(t("tool-name-convention", "info", "Tool name contains unusual characters. Prefer snake_case or kebab-case for compatibility."));
  }
  return issues;
}
function lintResource(resource) {
  const issues = [];
  const target = resource.name ?? resource.uri;
  const r = (rule, severity, message) => ({
    target,
    category: "resource",
    severity,
    rule,
    message
  });
  if (!resource.name) {
    issues.push(r("resource-no-name", "warning", "Missing resource name. A descriptive name helps users understand what this resource provides."));
  }
  if (!resource.description || resource.description.trim().length === 0) {
    issues.push(r("resource-no-description", "warning", "Missing resource description."));
  }
  if (!resource.mimeType) {
    issues.push(r("resource-no-mimetype", "info", "No MIME type specified. Adding one helps clients render content correctly."));
  }
  return issues;
}
function lintPrompt(prompt) {
  const issues = [];
  const p = (rule, severity, message) => ({
    target: prompt.name,
    category: "prompt",
    severity,
    rule,
    message
  });
  if (!prompt.description || prompt.description.trim().length === 0) {
    issues.push(p("prompt-no-description", "error", "Missing prompt description. Users won't know what this prompt does."));
  }
  if (prompt.arguments && prompt.arguments.length > 0) {
    for (const arg of prompt.arguments) {
      if (!arg.description || arg.description.trim().length === 0) {
        issues.push(p("prompt-arg-no-description", "warning", `Argument "${arg.name}" has no description.`));
      }
    }
  }
  return issues;
}
function lintServer(result) {
  const issues = [];
  const s = (rule, severity, message) => ({
    target: result.serverInfo.name,
    category: "server",
    severity,
    rule,
    message
  });
  if (result.tools.length === 0 && result.resources.length === 0 && result.prompts.length === 0) {
    issues.push(s("server-empty", "error", "Server exposes no tools, resources, or prompts. Nothing for clients to use."));
  }
  if (!result.serverInfo.name || result.serverInfo.name === "Unknown Server") {
    issues.push(s("server-no-name", "warning", "Server didn't provide a name in its initialize response."));
  }
  if (!result.serverInfo.version || result.serverInfo.version === "unknown") {
    issues.push(s("server-no-version", "warning", "Server didn't provide a version. Versioning helps clients track compatibility."));
  }
  const toolNames = result.tools.map((t) => t.name);
  const dupes = toolNames.filter((name, i) => toolNames.indexOf(name) !== i);
  if (dupes.length > 0) {
    issues.push(s("server-duplicate-tools", "error", `Duplicate tool names: ${[...new Set(dupes)].join(", ")}. Each tool must have a unique name.`));
  }
  return issues;
}
function computeScore(issues, result) {
  const totalItems = result.tools.length + result.resources.length + result.prompts.length;
  if (totalItems === 0) return 0;
  let score = 100;
  for (const issue of issues) {
    switch (issue.severity) {
      case "error":
        score -= 15;
        break;
      case "warning":
        score -= 5;
        break;
      case "info":
        score -= 1;
        break;
    }
  }
  const wellDescribed = result.tools.every(
    (t) => t.description && t.description.trim().length >= 20
  );
  if (wellDescribed && result.tools.length > 0) {
    score = Math.min(100, score + 5);
  }
  return Math.max(0, Math.min(100, score));
}
function scoreToGrade(score) {
  if (score >= 90) return "A";
  if (score >= 75) return "B";
  if (score >= 60) return "C";
  if (score >= 40) return "D";
  return "F";
}
function lintMcpServer(result) {
  const issues = [];
  issues.push(...lintServer(result));
  for (const tool of result.tools) {
    issues.push(...lintTool(tool));
  }
  for (const resource of result.resources) {
    issues.push(...lintResource(resource));
  }
  for (const prompt of result.prompts) {
    issues.push(...lintPrompt(prompt));
  }
  issues.push(...auditMetadata(result));
  const perTool = result.tools.map((tool) => ({
    name: tool.name,
    tokens: estimateToolTokens(tool)
  }));
  const totalTokens = perTool.reduce((sum, t) => sum + t.tokens, 0);
  const score = computeScore(issues, result);
  const grade = scoreToGrade(score);
  const errorCount = issues.filter((i) => i.severity === "error").length;
  if (grade === "F" && errorCount === 0) {
    issues.push({
      target: result.serverInfo.name,
      category: "server",
      severity: "error",
      rule: "server-grade-f",
      message: `Server received grade F (score ${score}/100) from accumulated warnings. Fix warnings above to improve quality.`
    });
  }
  return {
    grade,
    score,
    issues,
    tokenEstimate: {
      total: totalTokens,
      perTool
    },
    summary: {
      errors: issues.filter((i) => i.severity === "error").length,
      warnings: issues.filter((i) => i.severity === "warning").length,
      infos: issues.filter((i) => i.severity === "info").length,
      toolsChecked: result.tools.length,
      resourcesChecked: result.resources.length,
      promptsChecked: result.prompts.length
    }
  };
}

// src/lib/target.ts
var URL_PREFIX = /^(https?|wss?):\/\//i;
function parseTarget(input) {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    throw new Error("Target is empty. Pass a server URL or a command that starts a stdio server.");
  }
  if (URL_PREFIX.test(trimmed)) {
    try {
      new URL(trimmed);
    } catch {
      throw new Error(`"${trimmed}" is not a valid URL.`);
    }
    return { kind: "url", url: trimmed, label: trimmed };
  }
  const parts = splitCommand(trimmed);
  const [command, ...args] = parts;
  if (!command) {
    throw new Error(`Could not parse a command from "${trimmed}".`);
  }
  return { kind: "stdio", command, args, label: trimmed };
}
function splitCommand(input) {
  const out = [];
  let current = "";
  let inToken = false;
  let quote = null;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else if (ch === "\\" && quote === '"' && i + 1 < input.length) {
        current += input[++i];
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      inToken = true;
    } else if (ch === "\\" && i + 1 < input.length) {
      current += input[++i];
      inToken = true;
    } else if (/\s/.test(ch)) {
      if (inToken) {
        out.push(current);
        current = "";
        inToken = false;
      }
    } else {
      current += ch;
      inToken = true;
    }
  }
  if (quote) {
    throw new Error(`Unterminated ${quote} quote in command.`);
  }
  if (inToken) out.push(current);
  return out;
}
function isLocalUrl(url) {
  let host;
  try {
    host = new URL(url).hostname.replace(/^\[|\]$/g, "");
  } catch {
    return false;
  }
  return host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || host === "::1" || /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host) || /^169\.254\./.test(host) || !host.includes(".");
}
function parseHeaders(raw) {
  const headers = {};
  for (const entry of raw ?? []) {
    const line = entry.trim();
    if (line.length === 0) continue;
    const idx = line.indexOf(":");
    if (idx <= 0) {
      throw new Error(`Invalid header (expected "Name: value"). Check the header named "${line.split(/[:=\s]/)[0]}".`);
    }
    const name = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    headers[name] = value;
  }
  return headers;
}

// src/lib/run.ts
function remoteUrl(input, opts) {
  const target = parseTarget(input);
  if (target.kind !== "url") {
    throw new Error("--remote only works with a server URL, not a command.");
  }
  if (opts.headers && Object.keys(opts.headers).length > 0) {
    throw new Error("--remote cannot send custom headers. Drop --remote to connect directly.");
  }
  return target.url;
}
async function inspectTarget(input, opts = {}) {
  if (opts.remote) return inspect(remoteUrl(input, opts));
  return inspectDirect(parseTarget(input), opts);
}
async function analyzeTarget(input, opts = {}) {
  if (opts.remote) {
    const url = remoteUrl(input, opts);
    const [inspect2, lint2] = await Promise.all([inspect(url), lint(url)]);
    return { inspect: inspect2, lint: lint2 };
  }
  const inspected = await inspectDirect(parseTarget(input), opts);
  const report = lintMcpServer(inspected);
  return {
    inspect: inspected,
    lint: {
      ok: true,
      url: inspected.url,
      server: inspected.serverInfo,
      transport: inspected.transport,
      grade: report.grade,
      score: report.score,
      tokenEstimate: report.tokenEstimate,
      summary: report.summary,
      issues: report.issues
    }
  };
}
async function lintTarget(input, opts = {}) {
  if (opts.remote) return lint(remoteUrl(input, opts));
  return (await analyzeTarget(input, opts)).lint;
}
async function healthTarget(input, opts = {}) {
  if (opts.remote) return health(remoteUrl(input, opts));
  return healthDirect(parseTarget(input), opts);
}

// src/lib/format.ts
import chalk from "chalk";
var DIVIDER = chalk.dim("\u2500".repeat(41));
function gradeColor(grade) {
  if (grade === "A") return chalk.green(grade);
  if (grade === "B") return chalk.cyan(grade);
  if (grade === "C") return chalk.yellow(grade);
  if (grade === "D") return chalk.magenta(grade);
  return chalk.red(grade);
}
var GRADE_ORDER = ["F", "D", "C", "B", "A"];
function printLint(result, failOn = "errors", minGrade, tokenBudgetExceeded) {
  console.log();
  console.log(chalk.bold("  MCP Playground \u2014 Schema Linter"));
  console.log("  " + DIVIDER);
  if (result.server?.name) {
    console.log(`  Server : ${result.server.name}${result.server.version ? ` v${result.server.version}` : ""}`);
  }
  console.log(
    `  Tools  : ${result.summary.toolsChecked}  \xB7  Resources: ${result.summary.resourcesChecked}  \xB7  Prompts: ${result.summary.promptsChecked}`
  );
  console.log(
    `  Grade  : ${gradeColor(result.grade)}   \xB7  Score: ${result.score}/100`
  );
  console.log(`  Tokens : ~${result.tokenEstimate.total.toLocaleString()} estimated`);
  const errors = result.issues.filter((i) => i.severity === "error");
  const warnings = result.issues.filter((i) => i.severity === "warning");
  const infos = result.issues.filter((i) => i.severity === "info");
  if (errors.length > 0) {
    console.log();
    console.log(chalk.red.bold(`  ERRORS (${errors.length})`));
    for (const issue of errors) {
      const target = issue.target ? ` ${issue.category ?? "tool"} "${issue.target}" \u2014` : "";
      console.log(chalk.red(`  \u2717${target} ${issue.message}`));
    }
  }
  if (warnings.length > 0) {
    console.log();
    console.log(chalk.yellow.bold(`  WARNINGS (${warnings.length})`));
    for (const issue of warnings) {
      const target = issue.target ? ` ${issue.category ?? "tool"} "${issue.target}" \u2014` : "";
      console.log(chalk.yellow(`  \u26A0${target} ${issue.message}`));
    }
  }
  if (infos.length > 0) {
    console.log();
    console.log(chalk.blue.bold(`  INFO (${infos.length})`));
    for (const issue of infos) {
      const target = issue.target ? ` ${issue.category ?? "tool"} "${issue.target}" \u2014` : "";
      console.log(chalk.blue(`  \u2139${target} ${issue.message}`));
    }
  }
  const isPublicUrl = /^https?:\/\//i.test(result.url) && !isLocalUrl(result.url);
  if (isPublicUrl) {
    const encoded = encodeURIComponent(result.url);
    console.log();
    console.log(
      chalk.dim(
        `  Open in MCP Playground \u2192 https://mcpplayground.tech/lint?url=${encoded}`
      )
    );
  } else {
    console.log();
  }
  console.log("  " + DIVIDER);
  const { errors: errCount, warnings: warnCount } = result.summary;
  const gradeFailed = minGrade !== void 0 && GRADE_ORDER.indexOf(result.grade) < GRADE_ORDER.indexOf(minGrade);
  const issueFailed = failOn === "warnings" ? errCount > 0 || warnCount > 0 : errCount > 0;
  const ciPassed = !tokenBudgetExceeded && !gradeFailed && !issueFailed;
  if (tokenBudgetExceeded) {
    const parts = [`token budget exceeded: ${tokenBudgetExceeded.actual.toLocaleString()} > ${tokenBudgetExceeded.budget.toLocaleString()}`];
    if (errCount > 0) parts.push(`${errCount} error${errCount > 1 ? "s" : ""}`);
    if (warnCount > 0) parts.push(`${warnCount} warning${warnCount > 1 ? "s" : ""}`);
    console.log(chalk.red.bold(`  \u2716 Failed (${parts.join(", ")})`));
  } else if (gradeFailed) {
    const parts = [];
    if (errCount > 0) parts.push(`${errCount} error${errCount > 1 ? "s" : ""}`);
    if (warnCount > 0) parts.push(`${warnCount} warning${warnCount > 1 ? "s" : ""}`);
    const suffix = parts.length > 0 ? `, ${parts.join(", ")}` : "";
    console.log(chalk.red.bold(`  \u2716 Failed (grade ${result.grade} below minimum ${minGrade}${suffix})`));
  } else if (ciPassed) {
    const parts = [];
    if (errCount > 0) parts.push(`${errCount} error${errCount > 1 ? "s" : ""}`);
    if (warnCount > 0) parts.push(`${warnCount} warning${warnCount > 1 ? "s" : ""}`);
    const suffix = parts.length > 0 ? ` (${parts.join(", ")})` : "";
    console.log(chalk.green.bold(`  \u2714 Passed${suffix}`));
  } else {
    const parts = [];
    if (errCount > 0) parts.push(`${errCount} error${errCount > 1 ? "s" : ""}`);
    if (warnCount > 0) parts.push(`${warnCount} warning${warnCount > 1 ? "s" : ""}`);
    console.log(chalk.red.bold(`  \u2716 Failed (${parts.join(", ")})`));
  }
  console.log();
}
function printInspect(result) {
  console.log();
  console.log(chalk.bold("  MCP Playground \u2014 Server Inspection"));
  console.log("  " + DIVIDER);
  if (result.tools.length > 0) {
    console.log(chalk.bold.cyan(`
  Tools (${result.tools.length})`));
    for (const tool of result.tools) {
      console.log(chalk.cyan(`  \u2022 ${tool.name}`));
      if (tool.description) {
        const firstLine = tool.description.split("\n")[0].trim();
        console.log(chalk.dim(`    ${firstLine}`));
      }
    }
  }
  if (result.resources.length > 0) {
    console.log(chalk.bold.magenta(`
  Resources (${result.resources.length})`));
    for (const r of result.resources) {
      console.log(chalk.magenta(`  \u2022 ${r.name ?? r.uri}`));
      if (r.description) {
        const firstLine = r.description.split("\n")[0].trim();
        console.log(chalk.dim(`    ${firstLine}`));
      }
    }
  }
  if (result.prompts.length > 0) {
    console.log(chalk.bold.blue(`
  Prompts (${result.prompts.length})`));
    for (const p of result.prompts) {
      console.log(chalk.blue(`  \u2022 ${p.name}`));
      if (p.description) {
        const firstLine = p.description.split("\n")[0].trim();
        console.log(chalk.dim(`    ${firstLine}`));
      }
    }
  }
  console.log();
}
function printHealth(result, url) {
  const statusColor = {
    up: chalk.green,
    down: chalk.red,
    auth_required: chalk.yellow,
    unknown: chalk.dim
  };
  const color = statusColor[result.status] ?? chalk.dim;
  console.log();
  console.log(chalk.bold("  MCP Playground \u2014 Health Check"));
  console.log("  " + DIVIDER);
  console.log(`  URL    : ${url}`);
  console.log(`  Status : ${color(result.status)}`);
  console.log(`  Latency: ${result.latencyMs}ms`);
  console.log();
}

// src/lib/exit-codes.ts
var EXIT = {
  PASS: 0,
  FAIL: 1,
  ERROR: 2
};

// src/commands/lint.ts
var GRADE_ORDER2 = ["F", "D", "C", "B", "A"];
async function runLint(url, opts) {
  const spinner = opts.quiet || opts.format === "json" ? null : ora("Linting server\u2026").start();
  let result;
  try {
    result = await lintTarget(url, opts.run);
  } catch (err) {
    spinner?.fail(chalk2.red("Could not reach server"));
    if (!opts.quiet) {
      console.error(
        chalk2.red(`  Error: ${err instanceof Error ? err.message : String(err)}`)
      );
    }
    process.exit(EXIT.ERROR);
  }
  spinner?.stop();
  const tokenBudgetExceeded = opts.tokenBudget !== void 0 && result.tokenEstimate.total > opts.tokenBudget ? { actual: result.tokenEstimate.total, budget: opts.tokenBudget } : void 0;
  if (opts.format === "json") {
    console.log(JSON.stringify(result, null, 2));
    process.exit(
      shouldFail(result.grade, result.summary, opts, tokenBudgetExceeded) ? EXIT.FAIL : EXIT.PASS
    );
  }
  if (!opts.quiet) {
    printLint(result, opts.failOn, opts.minGrade, tokenBudgetExceeded);
  }
  process.exit(
    shouldFail(result.grade, result.summary, opts, tokenBudgetExceeded) ? EXIT.FAIL : EXIT.PASS
  );
}
function shouldFail(grade, summary, opts, tokenBudgetExceeded) {
  if (tokenBudgetExceeded) return true;
  if (opts.minGrade) {
    const actual = GRADE_ORDER2.indexOf(grade);
    const minimum = GRADE_ORDER2.indexOf(opts.minGrade);
    if (actual < minimum) return true;
  }
  if (opts.failOn === "warnings") {
    return summary.errors > 0 || summary.warnings > 0;
  }
  return summary.errors > 0;
}

// src/commands/inspect.ts
import ora2 from "ora";
import chalk3 from "chalk";
async function runInspect(url, opts) {
  const spinner = opts.format === "json" ? null : ora2("Inspecting server\u2026").start();
  let result;
  try {
    result = await inspectTarget(url, opts.run);
  } catch (err) {
    spinner?.fail(chalk3.red("Could not reach server"));
    console.error(
      chalk3.red(`  Error: ${err instanceof Error ? err.message : String(err)}`)
    );
    process.exit(EXIT.ERROR);
  }
  spinner?.stop();
  if (opts.format === "json") {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printInspect(result);
  }
  process.exit(EXIT.PASS);
}

// src/commands/health.ts
import ora3 from "ora";
import chalk4 from "chalk";
async function runHealth(url, opts) {
  const spinner = opts.format === "json" ? null : ora3("Checking server health\u2026").start();
  let result;
  try {
    result = await healthTarget(url, opts.run);
  } catch (err) {
    spinner?.fail(chalk4.red("Could not reach server"));
    console.error(
      chalk4.red(`  Error: ${err instanceof Error ? err.message : String(err)}`)
    );
    process.exit(EXIT.ERROR);
  }
  spinner?.stop();
  if (opts.format === "json") {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printHealth(result, url);
  }
  const exit = result.status === "up" ? EXIT.PASS : result.status === "auth_required" ? EXIT.ERROR : EXIT.FAIL;
  process.exit(exit);
}

// src/commands/diff.ts
import ora4 from "ora";
import chalk5 from "chalk";

// src/lib/schema-diff.ts
function props(schema) {
  const p = schema?.properties;
  return p && typeof p === "object" ? p : {};
}
function required(schema) {
  const r = schema?.required;
  return Array.isArray(r) ? r.filter((x) => typeof x === "string") : [];
}
function typeLabel(prop) {
  if (!prop) return "unspecified";
  const t = prop.type;
  if (typeof t === "string") return t;
  if (Array.isArray(t)) return [...t].map(String).sort().join(" | ");
  if (Array.isArray(prop.enum)) return "enum";
  for (const key of ["oneOf", "anyOf", "allOf", "$ref"]) {
    if (prop[key] !== void 0) return key;
  }
  return "unspecified";
}
function enumValues(prop) {
  return Array.isArray(prop?.enum) ? prop.enum.map((v) => JSON.stringify(v)) : void 0;
}
function diffTool(base, head) {
  const out = [];
  const change = (kind, rule, message) => {
    out.push({ kind, rule, category: "tool", target: base.name, message });
  };
  const baseProps = props(base.inputSchema);
  const headProps = props(head.inputSchema);
  const baseReq = new Set(required(base.inputSchema));
  const headReq = new Set(required(head.inputSchema));
  for (const name of Object.keys(baseProps)) {
    if (!(name in headProps)) {
      change("breaking", "param-removed", `Parameter "${name}" was removed. Calls that still send it may be rejected.`);
      continue;
    }
    const before = typeLabel(baseProps[name]);
    const after = typeLabel(headProps[name]);
    if (before !== after) {
      change("breaking", "param-type-changed", `Parameter "${name}" changed type from ${before} to ${after}.`);
    }
    const beforeEnum = enumValues(baseProps[name]);
    const afterEnum = enumValues(headProps[name]);
    if (afterEnum) {
      if (!beforeEnum) {
        if (before === after) {
          change("breaking", "param-enum-added", `Parameter "${name}" is now restricted to a fixed set of values.`);
        }
      } else {
        const removed = beforeEnum.filter((v) => !afterEnum.includes(v));
        const added = afterEnum.filter((v) => !beforeEnum.includes(v));
        if (removed.length > 0) {
          change("breaking", "param-enum-value-removed", `Parameter "${name}" no longer accepts ${removed.join(", ")}.`);
        }
        if (added.length > 0) {
          change("changed", "param-enum-value-added", `Parameter "${name}" now also accepts ${added.join(", ")}.`);
        }
      }
    }
    if (!baseReq.has(name) && headReq.has(name)) {
      change("breaking", "param-now-required", `Parameter "${name}" was optional and is now required.`);
    } else if (baseReq.has(name) && !headReq.has(name)) {
      change("changed", "param-now-optional", `Parameter "${name}" was required and is now optional.`);
    }
    if ((baseProps[name]?.description ?? "") !== (headProps[name]?.description ?? "")) {
      change("changed", "param-description-changed", `Description of parameter "${name}" changed.`);
    }
  }
  for (const name of Object.keys(headProps)) {
    if (name in baseProps) continue;
    if (headReq.has(name)) {
      change("breaking", "param-added-required", `New required parameter "${name}". Existing calls do not send it.`);
    } else {
      change("added", "param-added-optional", `New optional parameter "${name}".`);
    }
  }
  if ((base.description ?? "") !== (head.description ?? "")) {
    change(
      "changed",
      "tool-description-changed",
      "Tool description changed. Models pick tools by description, so selection behaviour can shift."
    );
  }
  return out;
}
function diffPrompt(base, head) {
  const out = [];
  const change = (kind, rule, message) => {
    out.push({ kind, rule, category: "prompt", target: base.name, message });
  };
  const baseArgs = new Map((base.arguments ?? []).map((a) => [a.name, a]));
  const headArgs = new Map((head.arguments ?? []).map((a) => [a.name, a]));
  for (const [name, arg] of baseArgs) {
    const next = headArgs.get(name);
    if (!next) {
      change("breaking", "prompt-arg-removed", `Argument "${name}" was removed.`);
    } else if (!arg.required && next.required) {
      change("breaking", "prompt-arg-now-required", `Argument "${name}" was optional and is now required.`);
    }
  }
  for (const [name, arg] of headArgs) {
    if (baseArgs.has(name)) continue;
    if (arg.required) {
      change("breaking", "prompt-arg-added-required", `New required argument "${name}".`);
    } else {
      change("added", "prompt-arg-added-optional", `New optional argument "${name}".`);
    }
  }
  if ((base.description ?? "") !== (head.description ?? "")) {
    change("changed", "prompt-description-changed", "Prompt description changed.");
  }
  return out;
}
function diffSchemas(base, head) {
  const all = [];
  const baseTools = new Map(base.tools.map((t) => [t.name, t]));
  const headTools = new Map(head.tools.map((t) => [t.name, t]));
  for (const [name, tool] of baseTools) {
    const next = headTools.get(name);
    if (!next) {
      all.push({
        kind: "breaking",
        rule: "tool-removed",
        category: "tool",
        target: name,
        message: "Tool was removed or renamed. Agents that call it will fail."
      });
    } else {
      all.push(...diffTool(tool, next));
    }
  }
  for (const name of headTools.keys()) {
    if (!baseTools.has(name)) {
      all.push({ kind: "added", rule: "tool-added", category: "tool", target: name, message: "New tool." });
    }
  }
  const baseResources = new Set(base.resources.map((r) => r.uri));
  const headResources = new Set(head.resources.map((r) => r.uri));
  for (const uri of baseResources) {
    if (!headResources.has(uri)) {
      all.push({
        kind: "breaking",
        rule: "resource-removed",
        category: "resource",
        target: uri,
        message: "Resource was removed or its URI changed."
      });
    }
  }
  for (const uri of headResources) {
    if (!baseResources.has(uri)) {
      all.push({ kind: "added", rule: "resource-added", category: "resource", target: uri, message: "New resource." });
    }
  }
  const basePrompts = new Map(base.prompts.map((p) => [p.name, p]));
  const headPrompts = new Map(head.prompts.map((p) => [p.name, p]));
  for (const [name, prompt] of basePrompts) {
    const next = headPrompts.get(name);
    if (!next) {
      all.push({
        kind: "breaking",
        rule: "prompt-removed",
        category: "prompt",
        target: name,
        message: "Prompt was removed or renamed."
      });
    } else {
      all.push(...diffPrompt(prompt, next));
    }
  }
  for (const name of headPrompts.keys()) {
    if (!basePrompts.has(name)) {
      all.push({ kind: "added", rule: "prompt-added", category: "prompt", target: name, message: "New prompt." });
    }
  }
  return {
    breaking: all.filter((c) => c.kind === "breaking"),
    changed: all.filter((c) => c.kind === "changed"),
    added: all.filter((c) => c.kind === "added")
  };
}

// src/commands/diff.ts
var GRADE_ORDER3 = ["F", "D", "C", "B", "A"];
async function runDiff(opts) {
  const spinner = opts.format === "json" ? null : ora4("Fetching base and head lint results\u2026").start();
  let baseAnalysis, headAnalysis;
  try {
    [baseAnalysis, headAnalysis] = await Promise.all([
      analyzeTarget(opts.base, opts.run),
      analyzeTarget(opts.head, opts.run)
    ]);
  } catch (err) {
    spinner?.fail(chalk5.red("Could not reach one or both servers"));
    console.error(
      chalk5.red(`  Error: ${err instanceof Error ? err.message : String(err)}`)
    );
    process.exit(EXIT.ERROR);
  }
  spinner?.stop();
  const base = baseAnalysis.lint;
  const head = headAnalysis.lint;
  const schema = diffSchemas(baseAnalysis.inspect, headAnalysis.inspect);
  const gradeDrop = GRADE_ORDER3.indexOf(head.grade) < GRADE_ORDER3.indexOf(base.grade);
  const scoreDiff = base.score - head.score;
  const tokenIncreasePct = base.tokenEstimate.total > 0 ? (head.tokenEstimate.total - base.tokenEstimate.total) / base.tokenEstimate.total * 100 : 0;
  if (opts.format === "json") {
    console.log(
      JSON.stringify(
        { base, head, gradeDrop, scoreDiff, tokenIncreasePct, schema },
        null,
        2
      )
    );
  } else {
    printDiff({ base, head, gradeDrop, scoreDiff, tokenIncreasePct });
    printSchemaDiff(schema, opts.allowBreaking === true);
  }
  const failed = schema.breaking.length > 0 && !opts.allowBreaking || gradeDrop || scoreDiff > opts.scoreDrop || tokenIncreasePct > opts.tokenThreshold;
  process.exit(failed ? EXIT.FAIL : EXIT.PASS);
}
function printDiff({
  base,
  head,
  gradeDrop,
  scoreDiff,
  tokenIncreasePct
}) {
  const DIVIDER2 = chalk5.dim("\u2500".repeat(41));
  console.log();
  console.log(chalk5.bold("  MCP Playground \u2014 Diff"));
  console.log("  " + DIVIDER2);
  const gradeLine = gradeDrop ? chalk5.red(`  Grade  : ${base.grade} \u2192 ${head.grade}  \u2716 dropped`) : chalk5.green(`  Grade  : ${base.grade} \u2192 ${head.grade}  \u2714 ok`);
  console.log(gradeLine);
  const scoreLine = scoreDiff > 0 ? chalk5.red(`  Score  : ${base.score} \u2192 ${head.score}  (\u2212${scoreDiff})`) : scoreDiff < 0 ? chalk5.green(`  Score  : ${base.score} \u2192 ${head.score}  (+${Math.abs(scoreDiff)})`) : chalk5.green(`  Score  : ${base.score} \u2192 ${head.score}  (no change)`);
  console.log(scoreLine);
  const tokenLine = tokenIncreasePct > 0 ? chalk5.yellow(
    `  Tokens : ~${base.tokenEstimate.total.toLocaleString()} \u2192 ~${head.tokenEstimate.total.toLocaleString()}  (+${tokenIncreasePct.toFixed(1)}%)`
  ) : chalk5.green(
    `  Tokens : ~${base.tokenEstimate.total.toLocaleString()} \u2192 ~${head.tokenEstimate.total.toLocaleString()}`
  );
  console.log(tokenLine);
  console.log();
}
function printSchemaDiff(schema, allowBreaking) {
  const line = (c) => `${c.category} "${c.target}" \u2014 ${c.message}`;
  if (schema.breaking.length > 0) {
    console.log(chalk5.red.bold(`  BREAKING (${schema.breaking.length})`));
    for (const c of schema.breaking) console.log(chalk5.red(`  \u2717 ${line(c)}`));
    console.log();
  }
  if (schema.changed.length > 0) {
    console.log(chalk5.yellow.bold(`  CHANGED (${schema.changed.length})`));
    for (const c of schema.changed) console.log(chalk5.yellow(`  ~ ${line(c)}`));
    console.log();
  }
  if (schema.added.length > 0) {
    console.log(chalk5.green.bold(`  ADDED (${schema.added.length})`));
    for (const c of schema.added) console.log(chalk5.green(`  + ${line(c)}`));
    console.log();
  }
  if (schema.breaking.length === 0 && schema.changed.length === 0 && schema.added.length === 0) {
    console.log(chalk5.green("  Schema : no changes"));
    console.log();
  } else if (schema.breaking.length > 0 && allowBreaking) {
    console.log(chalk5.dim("  Breaking changes allowed by --allow-breaking."));
    console.log();
  }
}

// src/commands/scan.ts
import { createHash } from "crypto";
import { mkdirSync, readFileSync as readFileSync2, writeFileSync } from "fs";
import { homedir as homedir2 } from "os";
import { join as join2 } from "path";
import chalk6 from "chalk";
import ora5 from "ora";

// src/lib/discover.ts
import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { join, resolve } from "path";
var isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
function stripJsonComments(text) {
  let out = "";
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (inString) {
      out += ch;
      if (ch === "\\" && next !== void 0) {
        out += next;
        i++;
      } else if (ch === '"') {
        inString = false;
      }
    } else if (ch === '"') {
      inString = true;
      out += ch;
    } else if (ch === "/" && next === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
    } else if (ch === "/" && next === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end === -1 ? text.length : end + 1;
    } else {
      out += ch;
    }
  }
  return out.replace(/,(\s*[}\]])/g, "$1");
}
function readJson(path) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return void 0;
  }
  for (const candidate of [text, stripJsonComments(text)]) {
    try {
      const doc = JSON.parse(candidate);
      return isObject(doc) ? doc : void 0;
    } catch {
    }
  }
  return void 0;
}
function appData(home, platform, env) {
  if (platform === "darwin") return join(home, "Library", "Application Support");
  if (platform === "win32") return env.APPDATA ?? join(home, "AppData", "Roaming");
  return env.XDG_CONFIG_HOME ?? join(home, ".config");
}
function sources(home, cwd, platform, env) {
  const data = appData(home, platform, env);
  const mcpServers = (doc) => doc.mcpServers;
  const vscode = (doc) => doc.servers ?? doc.mcpServers;
  return [
    { client: "Claude Desktop", scope: "user", path: join(data, "Claude", "claude_desktop_config.json"), pick: mcpServers },
    { client: "Claude Code", scope: "user", path: join(home, ".claude.json"), pick: mcpServers },
    {
      // Servers the user added for this project only. Stored in their own home directory.
      client: "Claude Code",
      scope: "user",
      path: join(home, ".claude.json"),
      pick: (doc) => {
        const projects = doc.projects;
        const project = isObject(projects) ? projects[cwd] : void 0;
        return isObject(project) ? project.mcpServers : void 0;
      }
    },
    { client: "Cursor", scope: "user", path: join(home, ".cursor", "mcp.json"), pick: mcpServers },
    { client: "VS Code", scope: "user", path: join(data, "Code", "User", "mcp.json"), pick: vscode },
    { client: "Windsurf", scope: "user", path: join(home, ".codeium", "windsurf", "mcp_config.json"), pick: mcpServers },
    { client: "Claude Code", scope: "project", path: join(cwd, ".mcp.json"), pick: mcpServers },
    { client: "Cursor", scope: "project", path: join(cwd, ".cursor", "mcp.json"), pick: mcpServers },
    { client: "VS Code", scope: "project", path: join(cwd, ".vscode", "mcp.json"), pick: vscode }
  ];
}
var Unresolved = class extends Error {
};
function expand(value, env) {
  return value.replace(/\$\{([^}]+)\}/g, (_, expr) => {
    if (expr.startsWith("input:")) throw new Unresolved("needs a value the client asks for at startup");
    const body = expr.startsWith("env:") ? expr.slice(4) : expr;
    const [name, fallback] = body.split(":-", 2);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return `\${${expr}}`;
    const resolved = env[name] ?? fallback;
    if (resolved === void 0) throw new Unresolved(`environment variable ${name} is not set`);
    return resolved;
  });
}
function stringMap(value, env) {
  const out = {};
  if (!isObject(value)) return out;
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw === "string") out[key] = expand(raw, env);
    else if (typeof raw === "number" || typeof raw === "boolean") out[key] = String(raw);
  }
  return out;
}
function toServer(name, entry, source, env) {
  const base = { name, client: source.client, scope: source.scope };
  if (entry.disabled === true || entry.enabled === false) {
    return { ...base, skipped: "disabled in the client" };
  }
  try {
    const url = typeof entry.url === "string" ? entry.url : typeof entry.serverUrl === "string" ? entry.serverUrl : void 0;
    if (url) {
      const expanded = expand(url, env);
      new URL(expanded);
      return {
        ...base,
        target: { kind: "url", url: expanded, label: name },
        headers: stringMap(entry.headers, env)
      };
    }
    if (typeof entry.command === "string" && entry.command.trim().length > 0) {
      const args = Array.isArray(entry.args) ? entry.args.filter((a) => typeof a === "string" || typeof a === "number").map((a) => expand(String(a), env)) : [];
      const cwd = typeof entry.cwd === "string" ? expand(entry.cwd, env) : void 0;
      return {
        ...base,
        target: {
          kind: "stdio",
          command: expand(entry.command, env),
          args,
          label: name,
          env: stringMap(entry.env, env),
          ...cwd ? { cwd } : {}
        }
      };
    }
  } catch (err) {
    if (err instanceof Unresolved) return { ...base, skipped: err.message };
    return { ...base, skipped: "the config entry has an invalid URL" };
  }
  return { ...base, skipped: "the config entry has no command or url" };
}
function discoverServers(opts = {}) {
  const home = opts.home ?? homedir();
  const cwd = resolve(opts.cwd ?? process.cwd());
  const platform = opts.platform ?? process.platform;
  const env = opts.env ?? process.env;
  const servers = [];
  const projectFilesSkipped = [];
  for (const source of sources(home, cwd, platform, env)) {
    if (source.scope === "project" && !opts.includeProject) {
      if (existsSync(source.path)) projectFilesSkipped.push(source.path);
      continue;
    }
    const doc = readJson(source.path);
    if (!doc) continue;
    const map = source.pick(doc);
    if (!isObject(map)) continue;
    for (const [name, entry] of Object.entries(map)) {
      if (isObject(entry)) servers.push(toServer(name, entry, source, env));
    }
  }
  return { servers, projectFilesSkipped };
}

// src/commands/scan.ts
var CONCURRENCY = 4;
var DEFAULT_TIMEOUT_MS = 3e4;
var LOCK_VERSION = 1;
function identity(target) {
  const raw = target.kind === "url" ? `url
${target.url}` : `stdio
${target.command}
${target.args.join("\n")}
${target.cwd ?? ""}`;
  return createHash("sha256").update(raw).digest("hex").slice(0, 32);
}
function group(servers) {
  const groups = /* @__PURE__ */ new Map();
  for (const server of servers) {
    const key = server.target ? identity(server.target) : `skipped:${server.client}:${server.name}`;
    const existing = groups.get(key);
    if (existing) {
      if (!existing.clients.includes(server.client)) existing.clients.push(server.client);
    } else {
      groups.set(key, { key, name: server.name, clients: [server.client], server });
    }
  }
  return [...groups.values()];
}
function lockPath() {
  return join2(process.env.MCPX_HOME ?? join2(homedir2(), ".mcpx"), "scan-lock.json");
}
function readLock() {
  try {
    const doc = JSON.parse(readFileSync2(lockPath(), "utf8"));
    if (doc.version === LOCK_VERSION && doc.servers && typeof doc.servers === "object") return doc;
  } catch {
  }
  return { version: LOCK_VERSION, servers: {} };
}
function writeLock(lock) {
  const path = lockPath();
  mkdirSync(join2(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(lock, null, 2) + "\n", { mode: 384 });
}
function asInspect(s) {
  return {
    url: s.name,
    serverInfo: { name: s.name, version: "unknown" },
    capabilities: { tools: true, resources: true, prompts: true },
    tools: s.tools,
    resources: s.resources,
    prompts: s.prompts,
    transport: "stdio",
    connectionTimeMs: 0
  };
}
async function scanOne(g, previous, timeoutMs) {
  const base = { name: g.name, clients: g.clients, status: "skipped", security: [] };
  const { target, headers, skipped } = g.server;
  if (!target) return { report: { ...base, note: skipped ?? "not scannable" } };
  let inspected;
  try {
    inspected = await inspectDirect(target, { headers, timeoutMs });
  } catch (err) {
    const code = err instanceof ConnectError ? err.code : "CONNECTION_FAILED";
    if (code === "UNAUTHORIZED") {
      return { report: { ...base, status: "auth_required", note: "needs sign-in, so its tools could not be read" } };
    }
    if (code === "TIMEOUT") {
      return { report: { ...base, status: "timeout", note: `no response within ${Math.round(timeoutMs / 1e3)}s` } };
    }
    return {
      report: {
        ...base,
        status: "failed",
        note: target.kind === "stdio" ? `could not start "${target.command}"` : "could not connect"
      }
    };
  }
  const lint2 = lintMcpServer(inspected);
  const security = lint2.issues.filter((i) => i.rule.startsWith("sec-") && i.severity !== "info").map((i) => ({
    severity: i.severity,
    rule: i.rule,
    target: `${i.category} "${i.target}"`,
    message: i.message
  }));
  const snapshot = {
    name: g.name,
    scannedAt: (/* @__PURE__ */ new Date()).toISOString(),
    tools: inspected.tools,
    resources: inspected.resources,
    prompts: inspected.prompts
  };
  let changes;
  if (previous) {
    const d = diffSchemas(asInspect(previous), inspected);
    changes = [...d.breaking, ...d.changed, ...d.added];
  }
  return {
    snapshot,
    report: {
      ...base,
      status: "ok",
      transport: inspected.transport,
      tools: inspected.tools.length,
      tokens: lint2.tokenEstimate.total,
      grade: lint2.grade,
      score: lint2.score,
      security,
      changes,
      lastScannedAt: previous?.scannedAt
    }
  };
}
async function pool(items, limit, work) {
  const results = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await work(items[index]);
    }
  });
  await Promise.all(runners);
  return results;
}
function clientCosts(reports, contextWindow) {
  const totals = /* @__PURE__ */ new Map();
  for (const r of reports) {
    if (r.status !== "ok") continue;
    for (const client of r.clients) {
      const t = totals.get(client) ?? { servers: 0, tokens: 0 };
      t.servers += 1;
      t.tokens += r.tokens ?? 0;
      totals.set(client, t);
    }
  }
  return [...totals.entries()].map(([client, t]) => ({ client, ...t, share: t.tokens / contextWindow })).sort((a, b) => b.tokens - a.tokens);
}
var pad = (text, width) => text + " ".repeat(Math.max(0, width - text.length));
var clip = (text, width) => text.length > width ? text.slice(0, width - 1) + "\u2026" : text;
function gradeColor2(grade) {
  if (grade === "A") return chalk6.green(grade);
  if (grade === "B") return chalk6.cyan(grade);
  if (grade === "C") return chalk6.yellow(grade);
  return chalk6.red(grade);
}
function printReport(reports, costs, opts, firstRun, projectFilesSkipped) {
  const scanned = reports.filter((r) => r.status === "ok").sort((a, b) => (b.tokens ?? 0) - (a.tokens ?? 0));
  const rest = reports.filter((r) => r.status !== "ok");
  const nameWidth = Math.min(28, Math.max(6, ...reports.map((r) => r.name.length)));
  const clientWidth = Math.min(30, Math.max(7, ...reports.map((r) => r.clients.join(", ").length)));
  const rule = chalk6.dim("\u2500".repeat(nameWidth + clientWidth + 30));
  console.log();
  console.log(chalk6.bold("  mcpx scan"));
  console.log("  " + rule);
  console.log(
    chalk6.dim(`  ${pad("SERVER", nameWidth)}  ${pad("CLIENTS", clientWidth)}  ${pad("TOOLS", 5)}  ${pad("TOKENS", 8)}  GRADE`)
  );
  for (const r of scanned) {
    const flag = r.security.some((f) => f.severity === "error") ? chalk6.red("  \u2717 security") : "";
    console.log(
      `  ${pad(clip(r.name, nameWidth), nameWidth)}  ${pad(clip(r.clients.join(", "), clientWidth), clientWidth)}  ${pad(String(r.tools), 5)}  ${pad("~" + (r.tokens ?? 0).toLocaleString("en-US"), 8)}  ${gradeColor2(r.grade ?? "?")}${flag}`
    );
  }
  for (const r of rest) {
    console.log(
      chalk6.dim(`  ${pad(clip(r.name, nameWidth), nameWidth)}  ${pad(clip(r.clients.join(", "), clientWidth), clientWidth)}  ${r.note ?? r.status}`)
    );
  }
  console.log("  " + rule);
  if (costs.length > 0) {
    console.log();
    console.log(chalk6.bold("  CONTEXT COST"));
    console.log(chalk6.dim("  Tool definitions are loaded into every conversation before you type anything."));
    for (const c of costs) {
      const pct = (c.share * 100).toFixed(1);
      const color = c.share >= 0.2 ? chalk6.red : c.share >= 0.1 ? chalk6.yellow : chalk6.green;
      console.log(
        `  ${pad(c.client, clientWidth)}  ${color(`~${c.tokens.toLocaleString("en-US")} tokens`)}  ${color(`${pct}%`)} of a ${opts.contextWindow.toLocaleString("en-US")}-token window`
      );
    }
    console.log(chalk6.dim("  Token counts are estimates; clients that load tools on demand use less."));
  }
  const findings = scanned.flatMap((r) => r.security.map((f) => ({ server: r.name, ...f })));
  if (findings.length > 0) {
    console.log();
    console.log(chalk6.bold.red(`  SECURITY (${findings.length})`));
    for (const f of findings) {
      const mark = f.severity === "error" ? chalk6.red("\u2717") : chalk6.yellow("\u26A0");
      console.log(`  ${mark} ${f.server} \xB7 ${f.target} \u2014 ${f.message}`);
    }
  }
  const changed = scanned.filter((r) => r.changes && r.changes.length > 0);
  if (changed.length > 0) {
    console.log();
    console.log(chalk6.bold.yellow("  CHANGED SINCE YOUR LAST SCAN"));
    for (const r of changed) {
      const since = r.lastScannedAt ? ` (last scanned ${r.lastScannedAt.slice(0, 10)})` : "";
      console.log(chalk6.dim(`  ${r.name}${since}`));
      for (const c of r.changes ?? []) {
        const mark = c.kind === "breaking" ? chalk6.red("\u2717") : c.kind === "changed" ? chalk6.yellow("~") : chalk6.green("+");
        console.log(`    ${mark} ${c.category} "${c.target}" \u2014 ${c.message}`);
      }
    }
  } else if (!firstRun && scanned.length > 0) {
    console.log();
    console.log(chalk6.green("  No tool definitions changed since your last scan."));
  }
  console.log();
  if (firstRun && opts.save && scanned.length > 0) {
    console.log(chalk6.dim("  Saved a baseline. Run mcpx scan again later to see which tool definitions changed."));
  }
  if (projectFilesSkipped.length > 0) {
    console.log(
      chalk6.dim(
        `  ${projectFilesSkipped.length} project config file${projectFilesSkipped.length > 1 ? "s" : ""} in this directory not scanned. Add --project if you trust this repo: scanning starts its servers.`
      )
    );
  }
  console.log();
}
async function runScan(opts) {
  const { servers, projectFilesSkipped } = discoverServers({ includeProject: opts.includeProject });
  const groups = group(servers);
  if (opts.list) {
    const listing = groups.map((g) => ({
      name: g.name,
      clients: g.clients,
      scope: g.server.scope,
      kind: g.server.target?.kind ?? "skipped",
      ...g.server.skipped ? { skipped: g.server.skipped } : {}
    }));
    if (opts.format === "json") {
      console.log(JSON.stringify({ servers: listing }, null, 2));
    } else if (listing.length === 0) {
      console.log("\n  No MCP servers found in Claude Desktop, Claude Code, Cursor, VS Code or Windsurf.\n");
    } else {
      console.log();
      for (const s of listing) {
        console.log(`  ${s.name}  ${chalk6.dim(`${s.clients.join(", ")} \xB7 ${s.kind}${s.skipped ? ` \xB7 ${s.skipped}` : ""}`)}`);
      }
      console.log();
    }
    process.exit(EXIT.PASS);
  }
  if (groups.length === 0) {
    if (opts.format === "json") {
      console.log(JSON.stringify({ servers: [], clients: [], contextWindow: opts.contextWindow }, null, 2));
    } else {
      console.log("\n  No MCP servers found in Claude Desktop, Claude Code, Cursor, VS Code or Windsurf.");
      if (projectFilesSkipped.length > 0) {
        console.log("  This directory has project config files. Add --project to scan them if you trust this repo.");
      }
      console.log();
    }
    process.exit(EXIT.PASS);
  }
  const lock = readLock();
  const firstRun = Object.keys(lock.servers).length === 0;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const spinner = opts.format === "json" ? null : ora5(`Scanning ${groups.length} MCP server${groups.length > 1 ? "s" : ""}\u2026`).start();
  const results = await pool(groups, CONCURRENCY, (g) => scanOne(g, lock.servers[g.key], timeoutMs));
  spinner?.stop();
  const reports = results.map((r) => r.report);
  const costs = clientCosts(reports, opts.contextWindow);
  if (opts.save) {
    results.forEach((r, i) => {
      const g = groups[i];
      if (r.snapshot && g) lock.servers[g.key] = r.snapshot;
    });
    try {
      writeLock(lock);
    } catch {
      if (opts.format !== "json") console.error(chalk6.yellow("  Could not save the baseline for next time."));
    }
  }
  if (opts.format === "json") {
    console.log(JSON.stringify({ servers: reports, clients: costs, contextWindow: opts.contextWindow }, null, 2));
  } else {
    printReport(reports, costs, opts, firstRun, projectFilesSkipped);
  }
  const hasSecurityError = reports.some((r) => r.security.some((f) => f.severity === "error"));
  process.exit(hasSecurityError ? EXIT.FAIL : EXIT.PASS);
}

// src/index.ts
var program = new Command();
program.name("mcpx").description(
  "Lint and inspect MCP servers. A target is a server URL or a quoted command that starts a stdio server."
).version("0.2.0");
function int(value) {
  return Number.parseInt(value, 10);
}
function collect(value, previous) {
  return [...previous, value];
}
function withConnectionOptions(cmd) {
  return cmd.option(
    "-H, --header <header>",
    'HTTP header to send, as "Name: value". Repeatable.',
    collect,
    []
  ).option("--timeout <seconds>", "Seconds to wait for the server to connect", parseFloat).option("--remote", "Run through the hosted MCP Playground API instead of connecting directly");
}
function runOptions(opts) {
  try {
    if (opts.timeout !== void 0 && !(opts.timeout > 0)) {
      throw new Error("--timeout must be a positive number of seconds.");
    }
    return {
      remote: opts.remote,
      headers: parseHeaders(opts.header),
      timeoutMs: opts.timeout !== void 0 ? Math.round(opts.timeout * 1e3) : void 0
    };
  } catch (err) {
    console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}
withConnectionOptions(
  program.command("lint <target>").description("Lint an MCP server schema").option(
    "--fail-on <level>",
    "Fail on: errors (default) or warnings",
    "errors"
  ).option("--min-grade <grade>", "Fail if grade is below threshold (A, B, C, D, F)").option("--token-budget <n>", "Fail if token footprint exceeds N", int).option("--format <fmt>", "Output format: json").option("--quiet", "No output, just exit code")
).action((target, opts) => {
  if (opts.failOn !== "errors" && opts.failOn !== "warnings") {
    console.error(`error: --fail-on must be "errors" or "warnings", got "${opts.failOn}"`);
    process.exit(1);
  }
  const validGrades = ["A", "B", "C", "D", "F"];
  if (opts.minGrade && !validGrades.includes(opts.minGrade.toUpperCase())) {
    console.error(`error: --min-grade must be one of A, B, C, D, F \u2014 got "${opts.minGrade}"`);
    process.exit(1);
  }
  runLint(target, {
    failOn: opts.failOn,
    minGrade: opts.minGrade?.toUpperCase(),
    tokenBudget: opts.tokenBudget,
    format: opts.format,
    quiet: opts.quiet,
    run: runOptions(opts)
  });
});
withConnectionOptions(
  program.command("inspect <target>").description("Show tools, resources, and prompts for an MCP server").option("--format <fmt>", "Output format: json")
).action((target, opts) => {
  runInspect(target, { format: opts.format, run: runOptions(opts) });
});
withConnectionOptions(
  program.command("health <target>").description("Check if an MCP server is reachable").option("--format <fmt>", "Output format: json")
).action((target, opts) => {
  runHealth(target, { format: opts.format, run: runOptions(opts) });
});
withConnectionOptions(
  program.command("diff").description("Compare two MCP server versions and fail CI on regressions").requiredOption("--base <target>", "Base server URL or command").requiredOption("--head <target>", "Head server URL or command").option("--score-drop <n>", "Fail if score drops more than N points", int, 10).option(
    "--token-threshold <n>",
    "Fail if token footprint increases more than N%",
    int,
    20
  ).option("--allow-breaking", "Do not fail when tools or parameters are removed or changed incompatibly").option("--format <fmt>", "Output format: json")
).action((opts) => {
  runDiff({
    base: opts.base,
    head: opts.head,
    scoreDrop: opts.scoreDrop,
    tokenThreshold: opts.tokenThreshold,
    format: opts.format,
    allowBreaking: opts.allowBreaking,
    run: runOptions(opts)
  });
});
program.command("scan").description(
  "Find the MCP servers configured for your AI clients and report their context cost, security findings and changes since the last scan"
).option("--project", "Also scan config files checked into the current directory. Starts the servers they define").option("--context-window <tokens>", "Context window size used for the percentage", int, 2e5).option("--timeout <seconds>", "Seconds to wait for each server", parseFloat).option("--no-save", "Do not update the baseline used to detect changes").option("--list", "List the servers that would be scanned without starting them").option("--format <fmt>", "Output format: json").action((opts) => {
  if (!(opts.contextWindow > 0)) {
    console.error("error: --context-window must be a positive number of tokens.");
    process.exit(1);
  }
  if (opts.timeout !== void 0 && !(opts.timeout > 0)) {
    console.error("error: --timeout must be a positive number of seconds.");
    process.exit(1);
  }
  runScan({
    includeProject: opts.project,
    contextWindow: opts.contextWindow,
    timeoutMs: opts.timeout !== void 0 ? Math.round(opts.timeout * 1e3) : void 0,
    save: opts.save,
    list: opts.list,
    format: opts.format
  });
});
program.parse();
