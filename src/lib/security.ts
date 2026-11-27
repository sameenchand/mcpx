/**
 * Static checks for tool poisoning: text in a server's metadata that is
 * written for the model instead of the user. Tool names, descriptions and
 * parameter schemas are all placed in the model's context, so an attacker
 * who controls them can plant instructions there.
 *
 * These are pattern checks. They catch the common, published techniques and
 * are deliberately narrow to keep false positives low; a clean result is not
 * proof that a server is safe.
 */

import type { InspectResult } from "./types.js";

export interface SecurityFinding {
  target: string;
  category: "tool" | "resource" | "prompt";
  severity: "error" | "warning";
  rule: string;
  message: string;
}

/** Zero-width characters, bidirectional overrides and Unicode tag characters. */
const HIDDEN_CHARS = /[​-‏‪-‮⁠-⁤⁦-⁩﻿]|\uDB40[\uDC00-\uDC7F]/;

const INSTRUCTION_PATTERNS: Array<{ pattern: RegExp; what: string }> = [
  {
    pattern: /\b(ignore|disregard|forget|override)\b[^.\n]{0,30}\b(previous|prior|above|earlier|all|other|system)\b[^.\n]{0,20}\b(instructions?|prompts?|rules|guidelines)\b/i,
    what: "tells the model to ignore its instructions",
  },
  {
    pattern: /\b(do not|don't|never|without)\s+(tell|telling|mention|mentioning|inform|informing|notify|notifying|reveal|revealing|alert|alerting|show|showing)\b[^.\n]{0,25}\b(the )?(user|human|operator)\b/i,
    what: "tells the model to hide something from the user",
  },
  {
    pattern: /<\s*\/?\s*(important|system|instructions?|secret|hidden|admin)\s*>/i,
    what: "contains an instruction-style tag aimed at the model",
  },
  {
    pattern: /\b(before|prior to)\s+(using|calling|invoking|running)\s+(any|all|every)\s+(other\s+)?tools?\b/i,
    what: "tries to run ahead of every other tool",
  },
  {
    pattern: /\binstead of\s+(using|calling|invoking)\s+(the\s+)?[\w-]+\s+tool\b/i,
    what: "tries to replace another tool",
  },
];

const SENSITIVE_PATHS: Array<{ pattern: RegExp; what: string }> = [
  { pattern: /(~|\$HOME|\/home\/[\w.-]+|\/Users\/[\w.-]+)\/\.ssh\b|\bid_(rsa|ed25519|ecdsa)\b/i, what: "SSH keys" },
  { pattern: /\.aws\/credentials\b/i, what: "AWS credentials" },
  { pattern: /(^|[\s"'`/])\.env\b(?!\.example)/i, what: ".env files" },
  { pattern: /\/etc\/(passwd|shadow)\b/i, what: "system account files" },
  { pattern: /\.(cursor|claude|codeium|vscode)\/[\w./-]*mcp[\w.-]*\.json\b|claude_desktop_config\.json\b/i, what: "MCP client configuration" },
];

/** Long runs of blank space are used to push text out of view in client UIs. */
const PADDING = / {40,}|\t{10,}|(\r?\n[ \t]*){8,}/;

/** Every string a client would place in the model's context for one schema. */
function schemaStrings(node: unknown, out: string[] = [], depth = 0): string[] {
  if (depth > 12 || node === null || node === undefined) return out;
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

function checkText(
  texts: string[],
  target: string,
  category: SecurityFinding["category"],
): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  const seen = new Set<string>();
  const add = (severity: SecurityFinding["severity"], rule: string, message: string): void => {
    if (seen.has(rule)) return;
    seen.add(rule);
    findings.push({ target, category, severity, rule, message });
  };

  for (const text of texts) {
    if (HIDDEN_CHARS.test(text)) {
      add(
        "error",
        "sec-hidden-characters",
        "Contains invisible or direction-changing Unicode characters. These can hide instructions from a human reviewer.",
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
        "Contains a long run of blank space, which can push text out of view in a client's approval dialog.",
      );
    }
  }
  return findings;
}

export function auditMetadata(result: InspectResult): SecurityFinding[] {
  const findings: SecurityFinding[] = [];

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
      ...(prompt.arguments ?? []).flatMap((a) => [a.name, a.description ?? ""]),
    ];
    findings.push(...checkText(texts, prompt.name, "prompt"));
  }

  return findings;
}
