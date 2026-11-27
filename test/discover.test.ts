import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { discoverServers, stripJsonComments } from "../src/lib/discover";

let root: string;
let home: string;
let cwd: string;

function write(path: string, content: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, typeof content === "string" ? content : JSON.stringify(content));
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "mcpx-discover-"));
  home = join(root, "home");
  cwd = join(root, "project");
  mkdirSync(home, { recursive: true });
  mkdirSync(cwd, { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const discover = (extra: Record<string, unknown> = {}) =>
  discoverServers({ home, cwd, platform: "darwin", env: { API_KEY: "k-123" }, ...extra });

describe("discoverServers", () => {
  it("reads every user-level client config", () => {
    write(join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json"), {
      mcpServers: { files: { command: "npx", args: ["-y", "fs-server", "/tmp"] } },
    });
    write(join(home, ".cursor", "mcp.json"), { mcpServers: { docs: { url: "https://docs.example.com/mcp" } } });
    write(join(home, ".codeium", "windsurf", "mcp_config.json"), {
      mcpServers: { remote: { serverUrl: "https://w.example.com/mcp" } },
    });
    write(join(home, "Library", "Application Support", "Code", "User", "mcp.json"), {
      servers: { gh: { type: "http", url: "https://gh.example.com/mcp" } },
    });
    write(join(home, ".claude.json"), {
      mcpServers: { global: { command: "node", args: ["g.js"] } },
      projects: {
        [cwd]: { mcpServers: { local: { command: "node", args: ["l.js"] } } },
        "/somewhere/else": { mcpServers: { other: { command: "node", args: ["o.js"] } } },
      },
    });

    const { servers } = discover();
    expect(servers.map((s) => `${s.client}:${s.name}`).sort()).toEqual([
      "Claude Code:global",
      "Claude Code:local",
      "Claude Desktop:files",
      "Cursor:docs",
      "VS Code:gh",
      "Windsurf:remote",
    ]);
    expect(servers.find((s) => s.name === "files")?.target).toMatchObject({
      kind: "stdio",
      command: "npx",
      args: ["-y", "fs-server", "/tmp"],
      env: {},
    });
    expect(servers.find((s) => s.name === "remote")?.target).toMatchObject({
      kind: "url",
      url: "https://w.example.com/mcp",
    });
  });

  it("uses the Linux and Windows config locations", () => {
    write(join(home, ".config", "Claude", "claude_desktop_config.json"), {
      mcpServers: { a: { command: "a" } },
    });
    expect(discover({ platform: "linux" }).servers.map((s) => s.name)).toEqual(["a"]);

    const appdata = join(root, "AppData", "Roaming");
    write(join(appdata, "Claude", "claude_desktop_config.json"), { mcpServers: { b: { command: "b" } } });
    expect(discover({ platform: "win32", env: { APPDATA: appdata } }).servers.map((s) => s.name)).toEqual(["b"]);
  });

  it("leaves project files alone unless asked, and reports that they exist", () => {
    write(join(cwd, ".mcp.json"), { mcpServers: { repo: { command: "node", args: ["x.js"] } } });
    write(join(cwd, ".vscode", "mcp.json"), { servers: { ws: { command: "node" } } });

    const off = discover();
    expect(off.servers).toEqual([]);
    expect(off.projectFilesSkipped).toHaveLength(2);

    const on = discover({ includeProject: true });
    expect(on.servers.map((s) => `${s.scope}:${s.name}`).sort()).toEqual(["project:repo", "project:ws"]);
  });

  it("expands environment references in env, args, headers and urls", () => {
    write(join(home, ".cursor", "mcp.json"), {
      mcpServers: {
        a: { command: "node", args: ["--key=${API_KEY}"], env: { TOKEN: "${env:API_KEY}", MODE: "${MODE:-fast}", N: 3 } },
        b: { url: "https://x.example.com/${API_KEY}/mcp", headers: { Authorization: "Bearer ${API_KEY}" } },
      },
    });
    const { servers } = discover();
    expect(servers[0]?.target).toMatchObject({
      args: ["--key=k-123"],
      env: { TOKEN: "k-123", MODE: "fast", N: "3" },
    });
    expect(servers[1]?.target).toMatchObject({ url: "https://x.example.com/k-123/mcp" });
    expect(servers[1]?.headers).toEqual({ Authorization: "Bearer k-123" });
  });

  it("skips entries it cannot run, with a reason that holds no secret", () => {
    write(join(home, ".cursor", "mcp.json"), {
      mcpServers: {
        off: { command: "node", disabled: true },
        unset: { command: "node", env: { TOKEN: "${MISSING_VAR}" } },
        prompt: { command: "node", env: { TOKEN: "${input:token}" } },
        empty: {},
        badurl: { url: "not a url" },
      },
    });
    const byName = Object.fromEntries(discover().servers.map((s) => [s.name, s]));
    expect(byName.off?.skipped).toMatch(/disabled/);
    expect(byName.unset?.skipped).toBe("environment variable MISSING_VAR is not set");
    expect(byName.prompt?.skipped).toMatch(/asks for at startup/);
    expect(byName.empty?.skipped).toMatch(/no command or url/);
    expect(byName.badurl?.skipped).toMatch(/invalid URL/);
    for (const s of Object.values(byName)) expect(s?.target).toBeUndefined();
  });

  it("reads config files with comments and trailing commas, and ignores broken ones", () => {
    write(
      join(home, ".cursor", "mcp.json"),
      `{
        // my servers
        "mcpServers": {
          "a": { "command": "node", "args": ["http://not-a-comment//x"], }, /* block */
        },
      }`,
    );
    write(join(home, ".codeium", "windsurf", "mcp_config.json"), "{ this is not json");
    const { servers } = discover();
    expect(servers).toHaveLength(1);
    expect(servers[0]?.target).toMatchObject({ args: ["http://not-a-comment//x"] });
  });
});

describe("stripJsonComments", () => {
  it("keeps comment-like text inside strings", () => {
    expect(JSON.parse(stripJsonComments('{"a": "x // y /* z */", "b": "q\\"//"} // tail'))).toEqual({
      a: "x // y /* z */",
      b: 'q"//',
    });
  });
});
