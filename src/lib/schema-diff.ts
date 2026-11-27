/**
 * Structural diff between two versions of an MCP server.
 *
 * A change is "breaking" when a client or agent that worked against the base
 * version can fail against the head version without changing anything itself.
 */

import type { InspectResult, PromptInfo, ToolSchema } from "./types.js";

export type ChangeKind = "breaking" | "changed" | "added";

export interface SchemaChange {
  kind: ChangeKind;
  /** Short rule ID for programmatic use. */
  rule: string;
  category: "tool" | "resource" | "prompt";
  /** Name of the tool, resource or prompt. */
  target: string;
  message: string;
}

export interface SchemaDiff {
  breaking: SchemaChange[];
  /** Compatible changes that can still alter agent behaviour, such as a reworded description. */
  changed: SchemaChange[];
  added: SchemaChange[];
}

type Props = Record<string, Record<string, unknown>>;

function props(schema: Record<string, unknown> | undefined): Props {
  const p = schema?.properties;
  return p && typeof p === "object" ? (p as Props) : {};
}

function required(schema: Record<string, unknown> | undefined): string[] {
  const r = schema?.required;
  return Array.isArray(r) ? r.filter((x): x is string => typeof x === "string") : [];
}

/** Normalised type label, so ["string","null"] and ["null","string"] compare equal. */
function typeLabel(prop: Record<string, unknown> | undefined): string {
  if (!prop) return "unspecified";
  const t = prop.type;
  if (typeof t === "string") return t;
  if (Array.isArray(t)) return [...t].map(String).sort().join(" | ");
  if (Array.isArray(prop.enum)) return "enum";
  for (const key of ["oneOf", "anyOf", "allOf", "$ref"]) {
    if (prop[key] !== undefined) return key;
  }
  return "unspecified";
}

function enumValues(prop: Record<string, unknown> | undefined): string[] | undefined {
  return Array.isArray(prop?.enum) ? prop.enum.map((v) => JSON.stringify(v)) : undefined;
}

function diffTool(base: ToolSchema, head: ToolSchema): SchemaChange[] {
  const out: SchemaChange[] = [];
  const change = (kind: ChangeKind, rule: string, message: string): void => {
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
      "Tool description changed. Models pick tools by description, so selection behaviour can shift.",
    );
  }

  return out;
}

function diffPrompt(base: PromptInfo, head: PromptInfo): SchemaChange[] {
  const out: SchemaChange[] = [];
  const change = (kind: ChangeKind, rule: string, message: string): void => {
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

export function diffSchemas(base: InspectResult, head: InspectResult): SchemaDiff {
  const all: SchemaChange[] = [];

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
        message: "Tool was removed or renamed. Agents that call it will fail.",
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
        message: "Resource was removed or its URI changed.",
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
        message: "Prompt was removed or renamed.",
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
    added: all.filter((c) => c.kind === "added"),
  };
}
