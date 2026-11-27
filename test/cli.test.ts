import { execFile } from "node:child_process";
import { createServer, type Server as HttpServer } from "node:http";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const exec = promisify(execFile);
const cli = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const fixture = fileURLToPath(new URL("./fixtures/stdio-server.mjs", import.meta.url));

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

async function mcpx(...args: string[]): Promise<Run> {
  try {
    const { stdout, stderr } = await exec("node", [cli, ...args], { timeout: 30_000 });
    return { code: 0, stdout, stderr };
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string };
    return { code: e.code ?? -1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}

const good = `node "${fixture}"`;
const bad = `node "${fixture}" bad`;

describe("mcpx against a local stdio server", () => {
  it("lints a good server: grade A, exit 0, all pages of tools", async () => {
    const run = await mcpx("lint", good, "--format", "json");
    expect(run.code).toBe(0);
    const result = JSON.parse(run.stdout);
    expect(result).toMatchObject({
      grade: "A",
      score: 100,
      transport: "stdio",
      server: { name: "good-fixture", version: "1.2.3" },
    });
    expect(result.summary.toolsChecked).toBe(2);
  });

  it("lints a bad server: exit 1 with the expected rules", async () => {
    const run = await mcpx("lint", bad, "--format", "json");
    expect(run.code).toBe(1);
    const rules = JSON.parse(run.stdout).issues.map((i: { rule: string }) => i.rule);
    expect(rules).toEqual(expect.arrayContaining(["tool-no-description", "required-not-in-properties"]));
  });

  it("enforces --token-budget and --min-grade", async () => {
    expect((await mcpx("lint", good, "--token-budget", "5", "--quiet")).code).toBe(1);
    expect((await mcpx("lint", good, "--token-budget", "5000", "--quiet")).code).toBe(0);
    expect((await mcpx("lint", bad, "--min-grade", "A", "--fail-on", "errors", "--quiet")).code).toBe(1);
  });

  it("does not print a playground link for a command target", async () => {
    const run = await mcpx("lint", good);
    expect(run.code).toBe(0);
    expect(run.stdout).not.toContain("mcpplayground.tech/lint?url=");
  });

  it("inspects and health-checks", async () => {
    const inspect = await mcpx("inspect", good, "--format", "json");
    expect(inspect.code).toBe(0);
    expect(JSON.parse(inspect.stdout).tools.map((t: { name: string }) => t.name)).toEqual([
      "get_weather",
      "add_numbers",
    ]);

    const health = await mcpx("health", good, "--format", "json");
    expect(health.code).toBe(0);
    expect(JSON.parse(health.stdout).status).toBe("up");
  });

  it("diffs two commands and fails on a regression", async () => {
    const same = await mcpx("diff", "--base", good, "--head", good, "--format", "json");
    expect(same.code).toBe(0);
    const worse = await mcpx("diff", "--base", good, "--head", bad, "--format", "json");
    expect(worse.code).toBe(1);
    expect(JSON.parse(worse.stdout).gradeDrop).toBe(true);
  });

  it("exits 2 when the command cannot start", async () => {
    const run = await mcpx("lint", "definitely-not-a-real-binary-xyz", "--quiet");
    expect(run.code).toBe(2);
  });

  it("refuses --remote for a command target", async () => {
    const run = await mcpx("lint", good, "--remote");
    expect(run.code).toBe(2);
    expect(run.stderr).toMatch(/--remote only works with a server URL/);
  });
});

describe("mcpx against a local HTTP endpoint", () => {
  let http: HttpServer;
  let base = "";
  let seenAuth: string | undefined;

  beforeAll(async () => {
    http = createServer((req, res) => {
      if (req.url?.startsWith("/locked")) {
        seenAuth = req.headers.authorization;
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "unauthorized" }));
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
    const addr = http.address();
    if (!addr || typeof addr === "string") throw new Error("no port");
    base = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => http.close(resolve));
  });

  it("reports auth_required and sends the --header value", async () => {
    const run = await mcpx("health", `${base}/locked`, "-H", "Authorization: Bearer test-token", "--format", "json");
    expect(JSON.parse(run.stdout).status).toBe("auth_required");
    expect(run.code).toBe(2);
    expect(seenAuth).toBe("Bearer test-token");
  });

  it("tells the user how to authenticate when lint hits a 401", async () => {
    const run = await mcpx("lint", `${base}/locked`);
    expect(run.code).toBe(2);
    expect(run.stderr).toMatch(/requires authentication/i);
  });

  it("exits 2 for an endpoint that is not an MCP server", async () => {
    const run = await mcpx("lint", `${base}/nothing`, "--quiet");
    expect(run.code).toBe(2);
  });
});
