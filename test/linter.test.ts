import { describe, expect, it } from "vitest";
import { lintMcpServer } from "../src/lib/linter";
import type { InspectResult } from "../src/lib/types";

function server(overrides: Partial<InspectResult>): InspectResult {
  return {
    url: "test",
    serverInfo: { name: "fixture", version: "1.0.0" },
    capabilities: { tools: true, resources: false, prompts: false },
    tools: [],
    resources: [],
    prompts: [],
    transport: "stdio",
    connectionTimeMs: 1,
    ...overrides,
  };
}

const goodTool = {
  name: "get_weather",
  description: "Look up the current weather conditions for a named city.",
  inputSchema: {
    type: "object",
    properties: { city: { type: "string", description: "City name" } },
    required: ["city"],
  },
};

describe("lintMcpServer", () => {
  it("gives a clean, well-described server an A with no issues", () => {
    const report = lintMcpServer(server({ tools: [goodTool] }));
    expect(report.grade).toBe("A");
    expect(report.score).toBe(100);
    expect(report.issues).toEqual([]);
    expect(report.tokenEstimate.total).toBeGreaterThan(0);
    expect(report.tokenEstimate.perTool).toHaveLength(1);
  });

  it("scores an empty server 0 with an error", () => {
    const report = lintMcpServer(server({}));
    expect(report.score).toBe(0);
    expect(report.grade).toBe("F");
    expect(report.issues.map((i) => i.rule)).toContain("server-empty");
  });

  it("reports the specific rule for each schema defect", () => {
    const report = lintMcpServer(
      server({
        tools: [
          { name: "do", inputSchema: { type: "object", properties: { x: {} }, required: ["missing"] } },
        ],
      }),
    );
    const rules = report.issues.map((i) => i.rule);
    expect(rules).toEqual(
      expect.arrayContaining([
        "tool-no-description",
        "prop-no-description",
        "prop-no-type",
        "required-not-in-properties",
      ]),
    );
    expect(report.summary.errors).toBe(2);
    expect(report.summary.warnings).toBe(2);
    // 100 - 2*15 - 2*5 = 60
    expect(report.score).toBe(60);
    expect(report.grade).toBe("C");
  });

  it("flags duplicate tool names", () => {
    const report = lintMcpServer(server({ tools: [goodTool, goodTool] }));
    expect(report.issues.map((i) => i.rule)).toContain("server-duplicate-tools");
  });

  it("explains an F that comes only from warnings", () => {
    // 14 warnings: 100 - 14*5 + 5 (well-described bonus) = 35, below the D floor of 40.
    const noisy = Array.from({ length: 14 }, (_, i) => ({
      name: `tool_${i}`,
      description: "A reasonably long description of this tool.",
      inputSchema: { type: "object", properties: { q: { type: "string" } }, required: ["q"] },
    }));
    const report = lintMcpServer(server({ tools: noisy }));
    expect(report.grade).toBe("F");
    expect(report.issues.map((i) => i.rule)).toContain("server-grade-f");
  });
});
