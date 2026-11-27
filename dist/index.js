#!/usr/bin/env node
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// src/index.ts
var import_commander = require("commander");

// src/commands/lint.ts
var import_ora = __toESM(require("ora"));
var import_chalk2 = __toESM(require("chalk"));

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
var import_client = require("@modelcontextprotocol/sdk/client/index.js");
var import_streamableHttp = require("@modelcontextprotocol/sdk/client/streamableHttp.js");
var import_sse = require("@modelcontextprotocol/sdk/client/sse.js");
var import_stdio = require("@modelcontextprotocol/sdk/client/stdio.js");
var import_websocket = require("@modelcontextprotocol/sdk/client/websocket.js");
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
async function tryConnect(transport, timeoutMs) {
  const client = new import_client.Client(CLIENT_INFO);
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
    const transport = new import_stdio.StdioClientTransport({
      command: target.command,
      args: target.args,
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
      const client = await tryConnect(new import_websocket.WebSocketClientTransport(serverUrl), timeoutMs);
      return { client, transport: "websocket", connectionTimeMs: Date.now() - started };
    } catch (err) {
      throw fail(err);
    }
  }
  try {
    const client = await tryConnect(new import_streamableHttp.StreamableHTTPClientTransport(serverUrl, transportOpts), timeoutMs);
    return { client, transport: "streamable-http", connectionTimeMs: Date.now() - started };
  } catch (err) {
    const first = fail(err);
    if (first.code !== "CONNECTION_FAILED") throw first;
    try {
      const client = await tryConnect(new import_sse.SSEClientTransport(serverUrl, transportOpts), timeoutMs);
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
var import_chalk = __toESM(require("chalk"));
var DIVIDER = import_chalk.default.dim("\u2500".repeat(41));
function gradeColor(grade) {
  if (grade === "A") return import_chalk.default.green(grade);
  if (grade === "B") return import_chalk.default.cyan(grade);
  if (grade === "C") return import_chalk.default.yellow(grade);
  if (grade === "D") return import_chalk.default.magenta(grade);
  return import_chalk.default.red(grade);
}
var GRADE_ORDER = ["F", "D", "C", "B", "A"];
function printLint(result, failOn = "errors", minGrade, tokenBudgetExceeded) {
  console.log();
  console.log(import_chalk.default.bold("  MCP Playground \u2014 Schema Linter"));
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
    console.log(import_chalk.default.red.bold(`  ERRORS (${errors.length})`));
    for (const issue of errors) {
      const target = issue.target ? ` ${issue.category ?? "tool"} "${issue.target}" \u2014` : "";
      console.log(import_chalk.default.red(`  \u2717${target} ${issue.message}`));
    }
  }
  if (warnings.length > 0) {
    console.log();
    console.log(import_chalk.default.yellow.bold(`  WARNINGS (${warnings.length})`));
    for (const issue of warnings) {
      const target = issue.target ? ` ${issue.category ?? "tool"} "${issue.target}" \u2014` : "";
      console.log(import_chalk.default.yellow(`  \u26A0${target} ${issue.message}`));
    }
  }
  if (infos.length > 0) {
    console.log();
    console.log(import_chalk.default.blue.bold(`  INFO (${infos.length})`));
    for (const issue of infos) {
      const target = issue.target ? ` ${issue.category ?? "tool"} "${issue.target}" \u2014` : "";
      console.log(import_chalk.default.blue(`  \u2139${target} ${issue.message}`));
    }
  }
  const isPublicUrl = /^https?:\/\//i.test(result.url) && !isLocalUrl(result.url);
  if (isPublicUrl) {
    const encoded = encodeURIComponent(result.url);
    console.log();
    console.log(
      import_chalk.default.dim(
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
    console.log(import_chalk.default.red.bold(`  \u2716 Failed (${parts.join(", ")})`));
  } else if (gradeFailed) {
    const parts = [];
    if (errCount > 0) parts.push(`${errCount} error${errCount > 1 ? "s" : ""}`);
    if (warnCount > 0) parts.push(`${warnCount} warning${warnCount > 1 ? "s" : ""}`);
    const suffix = parts.length > 0 ? `, ${parts.join(", ")}` : "";
    console.log(import_chalk.default.red.bold(`  \u2716 Failed (grade ${result.grade} below minimum ${minGrade}${suffix})`));
  } else if (ciPassed) {
    const parts = [];
    if (errCount > 0) parts.push(`${errCount} error${errCount > 1 ? "s" : ""}`);
    if (warnCount > 0) parts.push(`${warnCount} warning${warnCount > 1 ? "s" : ""}`);
    const suffix = parts.length > 0 ? ` (${parts.join(", ")})` : "";
    console.log(import_chalk.default.green.bold(`  \u2714 Passed${suffix}`));
  } else {
    const parts = [];
    if (errCount > 0) parts.push(`${errCount} error${errCount > 1 ? "s" : ""}`);
    if (warnCount > 0) parts.push(`${warnCount} warning${warnCount > 1 ? "s" : ""}`);
    console.log(import_chalk.default.red.bold(`  \u2716 Failed (${parts.join(", ")})`));
  }
  console.log();
}
function printInspect(result) {
  console.log();
  console.log(import_chalk.default.bold("  MCP Playground \u2014 Server Inspection"));
  console.log("  " + DIVIDER);
  if (result.tools.length > 0) {
    console.log(import_chalk.default.bold.cyan(`
  Tools (${result.tools.length})`));
    for (const tool of result.tools) {
      console.log(import_chalk.default.cyan(`  \u2022 ${tool.name}`));
      if (tool.description) {
        const firstLine = tool.description.split("\n")[0].trim();
        console.log(import_chalk.default.dim(`    ${firstLine}`));
      }
    }
  }
  if (result.resources.length > 0) {
    console.log(import_chalk.default.bold.magenta(`
  Resources (${result.resources.length})`));
    for (const r of result.resources) {
      console.log(import_chalk.default.magenta(`  \u2022 ${r.name ?? r.uri}`));
      if (r.description) {
        const firstLine = r.description.split("\n")[0].trim();
        console.log(import_chalk.default.dim(`    ${firstLine}`));
      }
    }
  }
  if (result.prompts.length > 0) {
    console.log(import_chalk.default.bold.blue(`
  Prompts (${result.prompts.length})`));
    for (const p of result.prompts) {
      console.log(import_chalk.default.blue(`  \u2022 ${p.name}`));
      if (p.description) {
        const firstLine = p.description.split("\n")[0].trim();
        console.log(import_chalk.default.dim(`    ${firstLine}`));
      }
    }
  }
  console.log();
}
function printHealth(result, url) {
  const statusColor = {
    up: import_chalk.default.green,
    down: import_chalk.default.red,
    auth_required: import_chalk.default.yellow,
    unknown: import_chalk.default.dim
  };
  const color = statusColor[result.status] ?? import_chalk.default.dim;
  console.log();
  console.log(import_chalk.default.bold("  MCP Playground \u2014 Health Check"));
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
  const spinner = opts.quiet || opts.format === "json" ? null : (0, import_ora.default)("Linting server\u2026").start();
  let result;
  try {
    result = await lintTarget(url, opts.run);
  } catch (err) {
    spinner?.fail(import_chalk2.default.red("Could not reach server"));
    if (!opts.quiet) {
      console.error(
        import_chalk2.default.red(`  Error: ${err instanceof Error ? err.message : String(err)}`)
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
var import_ora2 = __toESM(require("ora"));
var import_chalk3 = __toESM(require("chalk"));
async function runInspect(url, opts) {
  const spinner = opts.format === "json" ? null : (0, import_ora2.default)("Inspecting server\u2026").start();
  let result;
  try {
    result = await inspectTarget(url, opts.run);
  } catch (err) {
    spinner?.fail(import_chalk3.default.red("Could not reach server"));
    console.error(
      import_chalk3.default.red(`  Error: ${err instanceof Error ? err.message : String(err)}`)
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
var import_ora3 = __toESM(require("ora"));
var import_chalk4 = __toESM(require("chalk"));
async function runHealth(url, opts) {
  const spinner = opts.format === "json" ? null : (0, import_ora3.default)("Checking server health\u2026").start();
  let result;
  try {
    result = await healthTarget(url, opts.run);
  } catch (err) {
    spinner?.fail(import_chalk4.default.red("Could not reach server"));
    console.error(
      import_chalk4.default.red(`  Error: ${err instanceof Error ? err.message : String(err)}`)
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
var import_ora4 = __toESM(require("ora"));
var import_chalk5 = __toESM(require("chalk"));

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
  const spinner = opts.format === "json" ? null : (0, import_ora4.default)("Fetching base and head lint results\u2026").start();
  let baseAnalysis, headAnalysis;
  try {
    [baseAnalysis, headAnalysis] = await Promise.all([
      analyzeTarget(opts.base, opts.run),
      analyzeTarget(opts.head, opts.run)
    ]);
  } catch (err) {
    spinner?.fail(import_chalk5.default.red("Could not reach one or both servers"));
    console.error(
      import_chalk5.default.red(`  Error: ${err instanceof Error ? err.message : String(err)}`)
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
  const DIVIDER2 = import_chalk5.default.dim("\u2500".repeat(41));
  console.log();
  console.log(import_chalk5.default.bold("  MCP Playground \u2014 Diff"));
  console.log("  " + DIVIDER2);
  const gradeLine = gradeDrop ? import_chalk5.default.red(`  Grade  : ${base.grade} \u2192 ${head.grade}  \u2716 dropped`) : import_chalk5.default.green(`  Grade  : ${base.grade} \u2192 ${head.grade}  \u2714 ok`);
  console.log(gradeLine);
  const scoreLine = scoreDiff > 0 ? import_chalk5.default.red(`  Score  : ${base.score} \u2192 ${head.score}  (\u2212${scoreDiff})`) : scoreDiff < 0 ? import_chalk5.default.green(`  Score  : ${base.score} \u2192 ${head.score}  (+${Math.abs(scoreDiff)})`) : import_chalk5.default.green(`  Score  : ${base.score} \u2192 ${head.score}  (no change)`);
  console.log(scoreLine);
  const tokenLine = tokenIncreasePct > 0 ? import_chalk5.default.yellow(
    `  Tokens : ~${base.tokenEstimate.total.toLocaleString()} \u2192 ~${head.tokenEstimate.total.toLocaleString()}  (+${tokenIncreasePct.toFixed(1)}%)`
  ) : import_chalk5.default.green(
    `  Tokens : ~${base.tokenEstimate.total.toLocaleString()} \u2192 ~${head.tokenEstimate.total.toLocaleString()}`
  );
  console.log(tokenLine);
  console.log();
}
function printSchemaDiff(schema, allowBreaking) {
  const line = (c) => `${c.category} "${c.target}" \u2014 ${c.message}`;
  if (schema.breaking.length > 0) {
    console.log(import_chalk5.default.red.bold(`  BREAKING (${schema.breaking.length})`));
    for (const c of schema.breaking) console.log(import_chalk5.default.red(`  \u2717 ${line(c)}`));
    console.log();
  }
  if (schema.changed.length > 0) {
    console.log(import_chalk5.default.yellow.bold(`  CHANGED (${schema.changed.length})`));
    for (const c of schema.changed) console.log(import_chalk5.default.yellow(`  ~ ${line(c)}`));
    console.log();
  }
  if (schema.added.length > 0) {
    console.log(import_chalk5.default.green.bold(`  ADDED (${schema.added.length})`));
    for (const c of schema.added) console.log(import_chalk5.default.green(`  + ${line(c)}`));
    console.log();
  }
  if (schema.breaking.length === 0 && schema.changed.length === 0 && schema.added.length === 0) {
    console.log(import_chalk5.default.green("  Schema : no changes"));
    console.log();
  } else if (schema.breaking.length > 0 && allowBreaking) {
    console.log(import_chalk5.default.dim("  Breaking changes allowed by --allow-breaking."));
    console.log();
  }
}

// src/index.ts
var program = new import_commander.Command();
program.name("mcpx").description(
  "Lint and inspect MCP servers. A target is a server URL or a quoted command that starts a stdio server."
).version("0.2.0");
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
  ).option("--min-grade <grade>", "Fail if grade is below threshold (A, B, C, D, F)").option("--token-budget <n>", "Fail if token footprint exceeds N", parseInt).option("--format <fmt>", "Output format: json").option("--quiet", "No output, just exit code")
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
  program.command("diff").description("Compare two MCP server versions and fail CI on regressions").requiredOption("--base <target>", "Base server URL or command").requiredOption("--head <target>", "Head server URL or command").option("--score-drop <n>", "Fail if score drops more than N points", parseInt, 10).option(
    "--token-threshold <n>",
    "Fail if token footprint increases more than N%",
    parseInt,
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
program.parse();
