import { describe, expect, it } from "vitest";
import { diffSchemas } from "../src/lib/schema-diff";
import type { InspectResult, ToolSchema } from "../src/lib/types";

function server(tools: ToolSchema[], extra: Partial<InspectResult> = {}): InspectResult {
  return {
    url: "test",
    serverInfo: { name: "fixture", version: "1.0.0" },
    capabilities: { tools: true, resources: true, prompts: true },
    tools,
    resources: [],
    prompts: [],
    transport: "stdio",
    connectionTimeMs: 1,
    ...extra,
  };
}

const search: ToolSchema = {
  name: "search",
  description: "Search the catalogue.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search text" },
      limit: { type: "number", description: "Max results" },
      sort: { type: "string", enum: ["asc", "desc"] },
    },
    required: ["query"],
  },
};

function variant(change: (schema: any) => void, description = search.description): ToolSchema {
  const copy = JSON.parse(JSON.stringify(search)) as ToolSchema;
  change(copy.inputSchema);
  return { ...copy, description };
}

const rules = (list: { rule: string }[]) => list.map((c) => c.rule);

describe("diffSchemas", () => {
  it("reports nothing for identical servers", () => {
    const d = diffSchemas(server([search]), server([search]));
    expect(d).toEqual({ breaking: [], changed: [], added: [] });
  });

  it("flags a removed tool as breaking and a new tool as added", () => {
    const other = { ...search, name: "lookup" };
    const d = diffSchemas(server([search]), server([other]));
    expect(d.breaking).toMatchObject([{ rule: "tool-removed", target: "search" }]);
    expect(d.added).toMatchObject([{ rule: "tool-added", target: "lookup" }]);
  });

  it("flags removed, retyped and newly required parameters as breaking", () => {
    const head = variant((s) => {
      delete s.properties.limit;
      s.properties.query.type = "array";
      s.properties.tenant = { type: "string" };
      s.required = ["query", "tenant", "sort"];
    });
    const d = diffSchemas(server([search]), server([head]));
    expect(rules(d.breaking).sort()).toEqual(
      ["param-added-required", "param-now-required", "param-removed", "param-type-changed"].sort(),
    );
  });

  it("treats a narrowed enum as breaking and a widened enum as compatible", () => {
    const narrowed = variant((s) => (s.properties.sort.enum = ["asc"]));
    expect(rules(diffSchemas(server([search]), server([narrowed])).breaking)).toEqual([
      "param-enum-value-removed",
    ]);

    const widened = variant((s) => (s.properties.sort.enum = ["asc", "desc", "relevance"]));
    const d = diffSchemas(server([search]), server([widened]));
    expect(d.breaking).toEqual([]);
    expect(rules(d.changed)).toEqual(["param-enum-value-added"]);
  });

  it("flags a free-form parameter that becomes an enum as breaking", () => {
    const head = variant((s) => (s.properties.query.enum = ["a", "b"]));
    expect(rules(diffSchemas(server([search]), server([head])).breaking)).toEqual(["param-enum-added"]);
  });

  it("treats optional additions and loosened requirements as compatible", () => {
    const head = variant((s) => {
      s.properties.cursor = { type: "string" };
      s.required = [];
    });
    const d = diffSchemas(server([search]), server([head]));
    expect(d.breaking).toEqual([]);
    expect(rules(d.added)).toEqual(["param-added-optional"]);
    expect(rules(d.changed)).toEqual(["param-now-optional"]);
  });

  it("reports reworded descriptions as changed, not breaking", () => {
    const head = variant((s) => (s.properties.query.description = "Free text"), "Find items.");
    const d = diffSchemas(server([search]), server([head]));
    expect(d.breaking).toEqual([]);
    expect(rules(d.changed).sort()).toEqual(["param-description-changed", "tool-description-changed"]);
  });

  it("ignores the order of a union type", () => {
    const a = variant((s) => (s.properties.limit.type = ["number", "null"]));
    const b = variant((s) => (s.properties.limit.type = ["null", "number"]));
    expect(diffSchemas(server([a]), server([b])).breaking).toEqual([]);
  });

  it("covers resources and prompts", () => {
    const base = server([], {
      resources: [{ uri: "file:///a" }],
      prompts: [{ name: "summarise", arguments: [{ name: "text", required: true }, { name: "tone" }] }],
    });
    const head = server([], {
      resources: [{ uri: "file:///b" }],
      prompts: [
        { name: "summarise", arguments: [{ name: "tone", required: true }, { name: "length", required: true }] },
      ],
    });
    const d = diffSchemas(base, head);
    expect(rules(d.breaking).sort()).toEqual(
      ["prompt-arg-added-required", "prompt-arg-now-required", "prompt-arg-removed", "resource-removed"].sort(),
    );
    expect(rules(d.added)).toEqual(["resource-added"]);
  });
});
