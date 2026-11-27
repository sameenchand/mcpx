import { execFile } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const exec = promisify(execFile);
const cli = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const fixture = fileURLToPath(new URL("./fixtures/stdio-server.mjs", import.meta.url));
const SECRET = "tok-do-not-print-9f3a";

let root: string;
let home: string;
let project: string;
let state: string;

async function scan(...args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const env = { ...process.env, HOME: home, USERPROFILE: home, MCPX_HOME: state, NO_COLOR: "1" };
  try {
    const { stdout, stderr } = await exec("node", [cli, "scan", ...args], { cwd: project, env, timeout: 60_000 });
    return { code: 0, stdout, stderr };
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string };
    return { code: e.code ?? -1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}

function cursorConfig(servers: Record<string, unknown>): void {
  mkdirSync(join(home, ".cursor"), { recursive: true });
  writeFileSync(join(home, ".cursor", "mcp.json"), JSON.stringify({ mcpServers: servers }));
}

const server = (mode: string) => ({
  command: "node",
  args: [fixture],
  env: { FIXTURE_MODE: mode, API_TOKEN: SECRET },
});

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "mcpx-scan-"));
  home = join(root, "home");
  project = join(root, "project");
  state = join(root, "state");
  mkdirSync(home, { recursive: true });
  mkdirSync(project, { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("mcpx scan", () => {
  it("says so when nothing is configured", async () => {
    const run = await scan();
    expect(run.code).toBe(0);
    expect(run.stdout).toMatch(/No MCP servers found/);
  });

  it("reports context cost per client and scans a shared server once", async () => {
    cursorConfig({ weather: server("good"), broken: { command: "definitely-not-a-real-binary-xyz" } });
    mkdirSync(join(home, ".codeium", "windsurf"), { recursive: true });
    writeFileSync(
      join(home, ".codeium", "windsurf", "mcp_config.json"),
      JSON.stringify({ mcpServers: { weather: server("good") } }),
    );

    const run = await scan("--format", "json", "--context-window", "1000");
    expect(run.code).toBe(0);
    const out = JSON.parse(run.stdout);

    const weather = out.servers.find((s: { name: string }) => s.name === "weather");
    expect(weather).toMatchObject({ status: "ok", tools: 2, grade: "A", clients: ["Cursor", "Windsurf"] });
    expect(weather.tokens).toBeGreaterThan(0);
    expect(out.servers.filter((s: { name: string }) => s.name === "weather")).toHaveLength(1);

    expect(out.servers.find((s: { name: string }) => s.name === "broken")).toMatchObject({ status: "failed" });

    expect(out.clients.map((c: { client: string }) => c.client).sort()).toEqual(["Cursor", "Windsurf"]);
    for (const c of out.clients) {
      expect(c.tokens).toBe(weather.tokens);
      expect(c.share).toBeCloseTo(weather.tokens / 1000);
    }
  });

  it("flags a poisoned server and exits 1", async () => {
    cursorConfig({ sneaky: server("poisoned") });
    const run = await scan();
    expect(run.code).toBe(1);
    expect(run.stdout).toContain("SECURITY");
    expect(run.stdout).toMatch(/sneaky · tool "add_numbers"/);
  });

  it("detects tool definitions that changed since the last scan", async () => {
    cursorConfig({ weather: server("good") });
    const first = await scan();
    expect(first.code).toBe(0);
    expect(first.stdout).toContain("Saved a baseline");
    expect(first.stdout).not.toContain("CHANGED SINCE YOUR LAST SCAN");

    const again = await scan();
    expect(again.stdout).toContain("No tool definitions changed");

    // Same command line, different behaviour: what a silent server update looks like.
    cursorConfig({ weather: server("poisoned") });
    const third = await scan("--format", "json");
    expect(third.code).toBe(1);
    const weather = JSON.parse(third.stdout).servers[0];
    expect(weather.changes.map((c: { rule: string }) => c.rule).sort()).toEqual([
      "tool-description-changed",
      "tool-removed",
    ]);
  });

  it("does not update the baseline with --no-save", async () => {
    cursorConfig({ weather: server("good") });
    await scan("--no-save");
    expect(existsSync(join(state, "scan-lock.json"))).toBe(false);
  });

  it("never writes or prints secrets from the config", async () => {
    cursorConfig({ weather: server("good"), failing: { command: "definitely-not-a-real-binary-xyz", args: [SECRET] } });
    const text = await scan();
    const json = await scan("--format", "json");
    const listed = await scan("--list");
    const lock = readFileSync(join(state, "scan-lock.json"), "utf8");
    for (const output of [text.stdout, text.stderr, json.stdout, json.stderr, listed.stdout, lock]) {
      expect(output).not.toContain(SECRET);
    }
    expect(statSync(join(state, "scan-lock.json")).mode & 0o077).toBe(0);
  });

  it("only starts project servers with --project", async () => {
    writeFileSync(join(project, ".mcp.json"), JSON.stringify({ mcpServers: { repo: server("good") } }));
    const off = await scan();
    expect(off.stdout).toMatch(/No MCP servers found/);
    expect(off.stdout).toContain("--project");

    const on = await scan("--project", "--format", "json");
    expect(JSON.parse(on.stdout).servers).toMatchObject([{ name: "repo", status: "ok" }]);
  });

  it("lists servers without starting them", async () => {
    cursorConfig({ weather: server("good") });
    const run = await scan("--list", "--format", "json");
    expect(JSON.parse(run.stdout).servers).toEqual([
      { name: "weather", clients: ["Cursor"], scope: "user", kind: "stdio" },
    ]);
    expect(existsSync(join(state, "scan-lock.json"))).toBe(false);
  });
});
