/**
 * Finds the MCP servers already configured for the AI clients on this machine.
 *
 * Configuration files hold secrets (tokens in env blocks, headers and URLs).
 * Nothing in this module prints or returns them for display: callers get the
 * values only inside a Target, to start the server the same way the client does.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { Target } from "./target.js";

export type Scope = "user" | "project";

export interface ConfiguredServer {
  /** Name the user gave the server in the config file. */
  name: string;
  client: string;
  scope: Scope;
  /** Present when the server can be started or reached. */
  target?: Target;
  /** HTTP headers from the config. URL servers only. */
  headers?: Record<string, string>;
  /** Why the server cannot be scanned, when target is absent. */
  skipped?: string;
}

export interface DiscoverOptions {
  home?: string;
  cwd?: string;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  /** Also read config files checked into the current project. */
  includeProject?: boolean;
}

interface Source {
  client: string;
  scope: Scope;
  path: string;
  /** Pulls the name → entry map out of the parsed file. */
  pick: (doc: Record<string, unknown>) => unknown;
}

type Entry = Record<string, unknown>;

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Remove // and block comments and trailing commas, leaving string contents alone. */
export function stripJsonComments(text: string): string {
  let out = "";
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string;
    const next = text[i + 1];
    if (inString) {
      out += ch;
      if (ch === "\\" && next !== undefined) {
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

function readJson(path: string): Record<string, unknown> | undefined {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
  for (const candidate of [text, stripJsonComments(text)]) {
    try {
      const doc: unknown = JSON.parse(candidate);
      return isObject(doc) ? doc : undefined;
    } catch {
      // try the next form
    }
  }
  return undefined;
}

function appData(home: string, platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string {
  if (platform === "darwin") return join(home, "Library", "Application Support");
  if (platform === "win32") return env.APPDATA ?? join(home, "AppData", "Roaming");
  return env.XDG_CONFIG_HOME ?? join(home, ".config");
}

function sources(home: string, cwd: string, platform: NodeJS.Platform, env: NodeJS.ProcessEnv): Source[] {
  const data = appData(home, platform, env);
  const mcpServers = (doc: Record<string, unknown>): unknown => doc.mcpServers;
  const vscode = (doc: Record<string, unknown>): unknown => doc.servers ?? doc.mcpServers;

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
        const project = isObject(projects) ? projects[cwd] : undefined;
        return isObject(project) ? project.mcpServers : undefined;
      },
    },
    { client: "Cursor", scope: "user", path: join(home, ".cursor", "mcp.json"), pick: mcpServers },
    { client: "VS Code", scope: "user", path: join(data, "Code", "User", "mcp.json"), pick: vscode },
    { client: "Windsurf", scope: "user", path: join(home, ".codeium", "windsurf", "mcp_config.json"), pick: mcpServers },
    { client: "Claude Code", scope: "project", path: join(cwd, ".mcp.json"), pick: mcpServers },
    { client: "Cursor", scope: "project", path: join(cwd, ".cursor", "mcp.json"), pick: mcpServers },
    { client: "VS Code", scope: "project", path: join(cwd, ".vscode", "mcp.json"), pick: vscode },
  ];
}

class Unresolved extends Error {}

/** Expand ${VAR}, ${VAR:-default} and ${env:VAR}. Throws for anything that needs a prompt. */
function expand(value: string, env: NodeJS.ProcessEnv): string {
  return value.replace(/\$\{([^}]+)\}/g, (_, expr: string) => {
    if (expr.startsWith("input:")) throw new Unresolved("needs a value the client asks for at startup");
    const body = expr.startsWith("env:") ? expr.slice(4) : expr;
    const [name, fallback] = body.split(":-", 2) as [string, string | undefined];
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return `\${${expr}}`;
    const resolved = env[name] ?? fallback;
    if (resolved === undefined) throw new Unresolved(`environment variable ${name} is not set`);
    return resolved;
  });
}

function stringMap(value: unknown, env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  if (!isObject(value)) return out;
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw === "string") out[key] = expand(raw, env);
    else if (typeof raw === "number" || typeof raw === "boolean") out[key] = String(raw);
  }
  return out;
}

function toServer(name: string, entry: Entry, source: Source, env: NodeJS.ProcessEnv): ConfiguredServer {
  const base = { name, client: source.client, scope: source.scope };
  if (entry.disabled === true || entry.enabled === false) {
    return { ...base, skipped: "disabled in the client" };
  }

  try {
    const url = typeof entry.url === "string" ? entry.url : typeof entry.serverUrl === "string" ? entry.serverUrl : undefined;
    if (url) {
      const expanded = expand(url, env);
      new URL(expanded);
      return {
        ...base,
        target: { kind: "url", url: expanded, label: name },
        headers: stringMap(entry.headers, env),
      };
    }

    if (typeof entry.command === "string" && entry.command.trim().length > 0) {
      const args = Array.isArray(entry.args)
        ? entry.args.filter((a): a is string | number => typeof a === "string" || typeof a === "number").map((a) => expand(String(a), env))
        : [];
      const cwd = typeof entry.cwd === "string" ? expand(entry.cwd, env) : undefined;
      return {
        ...base,
        target: {
          kind: "stdio",
          command: expand(entry.command, env),
          args,
          label: name,
          env: stringMap(entry.env, env),
          ...(cwd ? { cwd } : {}),
        },
      };
    }
  } catch (err) {
    if (err instanceof Unresolved) return { ...base, skipped: err.message };
    return { ...base, skipped: "the config entry has an invalid URL" };
  }

  return { ...base, skipped: "the config entry has no command or url" };
}

export interface Discovery {
  servers: ConfiguredServer[];
  /** Project config files that exist but were not read because includeProject is off. */
  projectFilesSkipped: string[];
}

export function discoverServers(opts: DiscoverOptions = {}): Discovery {
  const home = opts.home ?? homedir();
  const cwd = resolve(opts.cwd ?? process.cwd());
  const platform = opts.platform ?? process.platform;
  const env = opts.env ?? process.env;

  const servers: ConfiguredServer[] = [];
  const projectFilesSkipped: string[] = [];

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
