import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import chalk from "chalk";
import ora from "ora";
import { ConnectError, inspectDirect } from "../lib/client.js";
import { discoverServers, type ConfiguredServer } from "../lib/discover.js";
import { EXIT } from "../lib/exit-codes.js";
import { lintMcpServer } from "../lib/linter.js";
import { diffSchemas, type SchemaChange } from "../lib/schema-diff.js";
import type { Target } from "../lib/target.js";
import type { InspectResult, PromptInfo, ResourceInfo, ToolSchema } from "../lib/types.js";

export interface ScanOptions {
  includeProject?: boolean;
  contextWindow: number;
  timeoutMs?: number;
  save: boolean;
  list?: boolean;
  format?: "json";
}

const CONCURRENCY = 4;
const DEFAULT_TIMEOUT_MS = 30_000;
const LOCK_VERSION = 1;

interface Snapshot {
  name: string;
  scannedAt: string;
  tools: ToolSchema[];
  resources: ResourceInfo[];
  prompts: PromptInfo[];
}

interface LockFile {
  version: number;
  servers: Record<string, Snapshot>;
}

interface Finding {
  severity: "error" | "warning";
  rule: string;
  target: string;
  message: string;
}

interface ServerReport {
  name: string;
  clients: string[];
  status: "ok" | "skipped" | "auth_required" | "timeout" | "failed";
  note?: string;
  transport?: string;
  tools?: number;
  tokens?: number;
  grade?: string;
  score?: number;
  security: Finding[];
  /** Changes against the previous scan. Absent on the first scan of a server. */
  changes?: SchemaChange[];
  lastScannedAt?: string;
}

/** One entry per distinct server; the same server configured in two clients is scanned once. */
interface Group {
  key: string;
  name: string;
  clients: string[];
  server: ConfiguredServer;
}

/** Stable identity that never leaves the machine in readable form: URLs and args can carry tokens. */
function identity(target: Target): string {
  const raw =
    target.kind === "url"
      ? `url\n${target.url}`
      : `stdio\n${target.command}\n${target.args.join("\n")}\n${target.cwd ?? ""}`;
  return createHash("sha256").update(raw).digest("hex").slice(0, 32);
}

function group(servers: ConfiguredServer[]): Group[] {
  const groups = new Map<string, Group>();
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

function lockPath(): string {
  return join(process.env.MCPX_HOME ?? join(homedir(), ".mcpx"), "scan-lock.json");
}

function readLock(): LockFile {
  try {
    const doc = JSON.parse(readFileSync(lockPath(), "utf8")) as LockFile;
    if (doc.version === LOCK_VERSION && doc.servers && typeof doc.servers === "object") return doc;
  } catch {
    // no baseline yet
  }
  return { version: LOCK_VERSION, servers: {} };
}

function writeLock(lock: LockFile): void {
  const path = lockPath();
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(lock, null, 2) + "\n", { mode: 0o600 });
}

function asInspect(s: Snapshot): InspectResult {
  return {
    url: s.name,
    serverInfo: { name: s.name, version: "unknown" },
    capabilities: { tools: true, resources: true, prompts: true },
    tools: s.tools,
    resources: s.resources,
    prompts: s.prompts,
    transport: "stdio",
    connectionTimeMs: 0,
  };
}

async function scanOne(g: Group, previous: Snapshot | undefined, timeoutMs: number): Promise<{ report: ServerReport; snapshot?: Snapshot }> {
  const base: ServerReport = { name: g.name, clients: g.clients, status: "skipped", security: [] };
  const { target, headers, skipped } = g.server;
  if (!target) return { report: { ...base, note: skipped ?? "not scannable" } };

  let inspected: InspectResult;
  try {
    inspected = await inspectDirect(target, { headers, timeoutMs });
  } catch (err) {
    const code = err instanceof ConnectError ? err.code : "CONNECTION_FAILED";
    if (code === "UNAUTHORIZED") {
      return { report: { ...base, status: "auth_required", note: "needs sign-in, so its tools could not be read" } };
    }
    if (code === "TIMEOUT") {
      return { report: { ...base, status: "timeout", note: `no response within ${Math.round(timeoutMs / 1000)}s` } };
    }
    return {
      report: {
        ...base,
        status: "failed",
        note: target.kind === "stdio" ? `could not start "${target.command}"` : "could not connect",
      },
    };
  }

  const lint = lintMcpServer(inspected);
  const security: Finding[] = lint.issues
    .filter((i) => i.rule.startsWith("sec-") && i.severity !== "info")
    .map((i) => ({
      severity: i.severity as "error" | "warning",
      rule: i.rule,
      target: `${i.category} "${i.target}"`,
      message: i.message,
    }));

  const snapshot: Snapshot = {
    name: g.name,
    scannedAt: new Date().toISOString(),
    tools: inspected.tools,
    resources: inspected.resources,
    prompts: inspected.prompts,
  };

  let changes: SchemaChange[] | undefined;
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
      tokens: lint.tokenEstimate.total,
      grade: lint.grade,
      score: lint.score,
      security,
      changes,
      lastScannedAt: previous?.scannedAt,
    },
  };
}

async function pool<T, R>(items: T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await work(items[index] as T);
    }
  });
  await Promise.all(runners);
  return results;
}

interface ClientCost {
  client: string;
  servers: number;
  tokens: number;
  share: number;
}

function clientCosts(reports: ServerReport[], contextWindow: number): ClientCost[] {
  const totals = new Map<string, { servers: number; tokens: number }>();
  for (const r of reports) {
    if (r.status !== "ok") continue;
    for (const client of r.clients) {
      const t = totals.get(client) ?? { servers: 0, tokens: 0 };
      t.servers += 1;
      t.tokens += r.tokens ?? 0;
      totals.set(client, t);
    }
  }
  return [...totals.entries()]
    .map(([client, t]) => ({ client, ...t, share: t.tokens / contextWindow }))
    .sort((a, b) => b.tokens - a.tokens);
}

const pad = (text: string, width: number): string => text + " ".repeat(Math.max(0, width - text.length));
const clip = (text: string, width: number): string => (text.length > width ? text.slice(0, width - 1) + "…" : text);

function gradeColor(grade: string): string {
  if (grade === "A") return chalk.green(grade);
  if (grade === "B") return chalk.cyan(grade);
  if (grade === "C") return chalk.yellow(grade);
  return chalk.red(grade);
}

function printReport(reports: ServerReport[], costs: ClientCost[], opts: ScanOptions, firstRun: boolean, projectFilesSkipped: string[]): void {
  const scanned = reports.filter((r) => r.status === "ok").sort((a, b) => (b.tokens ?? 0) - (a.tokens ?? 0));
  const rest = reports.filter((r) => r.status !== "ok");
  const nameWidth = Math.min(28, Math.max(6, ...reports.map((r) => r.name.length)));
  const clientWidth = Math.min(30, Math.max(7, ...reports.map((r) => r.clients.join(", ").length)));
  const rule = chalk.dim("─".repeat(nameWidth + clientWidth + 30));

  console.log();
  console.log(chalk.bold("  mcpx scan"));
  console.log("  " + rule);
  console.log(
    chalk.dim(`  ${pad("SERVER", nameWidth)}  ${pad("CLIENTS", clientWidth)}  ${pad("TOOLS", 5)}  ${pad("TOKENS", 8)}  GRADE`),
  );
  for (const r of scanned) {
    const flag = r.security.some((f) => f.severity === "error") ? chalk.red("  ✗ security") : "";
    console.log(
      `  ${pad(clip(r.name, nameWidth), nameWidth)}  ${pad(clip(r.clients.join(", "), clientWidth), clientWidth)}  ${pad(String(r.tools), 5)}  ${pad("~" + (r.tokens ?? 0).toLocaleString("en-US"), 8)}  ${gradeColor(r.grade ?? "?")}${flag}`,
    );
  }
  for (const r of rest) {
    console.log(
      chalk.dim(`  ${pad(clip(r.name, nameWidth), nameWidth)}  ${pad(clip(r.clients.join(", "), clientWidth), clientWidth)}  ${r.note ?? r.status}`),
    );
  }
  console.log("  " + rule);

  if (costs.length > 0) {
    console.log();
    console.log(chalk.bold("  CONTEXT COST"));
    console.log(chalk.dim("  Tool definitions are loaded into every conversation before you type anything."));
    for (const c of costs) {
      const pct = (c.share * 100).toFixed(1);
      const color = c.share >= 0.2 ? chalk.red : c.share >= 0.1 ? chalk.yellow : chalk.green;
      console.log(
        `  ${pad(c.client, clientWidth)}  ${color(`~${c.tokens.toLocaleString("en-US")} tokens`)}  ${color(`${pct}%`)} of a ${opts.contextWindow.toLocaleString("en-US")}-token window`,
      );
    }
    console.log(chalk.dim("  Token counts are estimates; clients that load tools on demand use less."));
  }

  const findings = scanned.flatMap((r) => r.security.map((f) => ({ server: r.name, ...f })));
  if (findings.length > 0) {
    console.log();
    console.log(chalk.bold.red(`  SECURITY (${findings.length})`));
    for (const f of findings) {
      const mark = f.severity === "error" ? chalk.red("✗") : chalk.yellow("⚠");
      console.log(`  ${mark} ${f.server} · ${f.target} — ${f.message}`);
    }
  }

  const changed = scanned.filter((r) => r.changes && r.changes.length > 0);
  if (changed.length > 0) {
    console.log();
    console.log(chalk.bold.yellow("  CHANGED SINCE YOUR LAST SCAN"));
    for (const r of changed) {
      const since = r.lastScannedAt ? ` (last scanned ${r.lastScannedAt.slice(0, 10)})` : "";
      console.log(chalk.dim(`  ${r.name}${since}`));
      for (const c of r.changes ?? []) {
        const mark = c.kind === "breaking" ? chalk.red("✗") : c.kind === "changed" ? chalk.yellow("~") : chalk.green("+");
        console.log(`    ${mark} ${c.category} "${c.target}" — ${c.message}`);
      }
    }
  } else if (!firstRun && scanned.length > 0) {
    console.log();
    console.log(chalk.green("  No tool definitions changed since your last scan."));
  }

  console.log();
  if (firstRun && opts.save && scanned.length > 0) {
    console.log(chalk.dim("  Saved a baseline. Run mcpx scan again later to see which tool definitions changed."));
  }
  if (projectFilesSkipped.length > 0) {
    console.log(
      chalk.dim(
        `  ${projectFilesSkipped.length} project config file${projectFilesSkipped.length > 1 ? "s" : ""} in this directory not scanned. Add --project if you trust this repo: scanning starts its servers.`,
      ),
    );
  }
  console.log();
}

export async function runScan(opts: ScanOptions): Promise<void> {
  const { servers, projectFilesSkipped } = discoverServers({ includeProject: opts.includeProject });
  const groups = group(servers);

  if (opts.list) {
    const listing = groups.map((g) => ({
      name: g.name,
      clients: g.clients,
      scope: g.server.scope,
      kind: g.server.target?.kind ?? "skipped",
      ...(g.server.skipped ? { skipped: g.server.skipped } : {}),
    }));
    if (opts.format === "json") {
      console.log(JSON.stringify({ servers: listing }, null, 2));
    } else if (listing.length === 0) {
      console.log("\n  No MCP servers found in Claude Desktop, Claude Code, Cursor, VS Code or Windsurf.\n");
    } else {
      console.log();
      for (const s of listing) {
        console.log(`  ${s.name}  ${chalk.dim(`${s.clients.join(", ")} · ${s.kind}${s.skipped ? ` · ${s.skipped}` : ""}`)}`);
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

  const spinner = opts.format === "json" ? null : ora(`Scanning ${groups.length} MCP server${groups.length > 1 ? "s" : ""}…`).start();
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
      if (opts.format !== "json") console.error(chalk.yellow("  Could not save the baseline for next time."));
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
