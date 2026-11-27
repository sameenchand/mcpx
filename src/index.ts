#!/usr/bin/env node
import { Command } from "commander";
import { runLint } from "./commands/lint.js";
import { runInspect } from "./commands/inspect.js";
import { runHealth } from "./commands/health.js";
import { runDiff } from "./commands/diff.js";
import { parseHeaders } from "./lib/target.js";
import type { RunOptions } from "./lib/run.js";

const program = new Command();

program
  .name("mcpx")
  .description(
    "Lint and inspect MCP servers. A target is a server URL or a quoted command that starts a stdio server."
  )
  .version(__VERSION__);

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

/** Options shared by every command that connects to a server. */
function withConnectionOptions(cmd: Command): Command {
  return cmd
    .option(
      "-H, --header <header>",
      'HTTP header to send, as "Name: value". Repeatable.',
      collect,
      []
    )
    .option("--timeout <seconds>", "Seconds to wait for the server to connect", parseFloat)
    .option("--remote", "Run through the hosted MCP Playground API instead of connecting directly");
}

function runOptions(opts: { header?: string[]; timeout?: number; remote?: boolean }): RunOptions {
  try {
    if (opts.timeout !== undefined && !(opts.timeout > 0)) {
      throw new Error("--timeout must be a positive number of seconds.");
    }
    return {
      remote: opts.remote,
      headers: parseHeaders(opts.header),
      timeoutMs: opts.timeout !== undefined ? Math.round(opts.timeout * 1000) : undefined,
    };
  } catch (err) {
    console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

withConnectionOptions(
  program
    .command("lint <target>")
    .description("Lint an MCP server schema")
    .option(
      "--fail-on <level>",
      "Fail on: errors (default) or warnings",
      "errors"
    )
    .option("--min-grade <grade>", "Fail if grade is below threshold (A, B, C, D, F)")
    .option("--token-budget <n>", "Fail if token footprint exceeds N", parseInt)
    .option("--format <fmt>", "Output format: json")
    .option("--quiet", "No output, just exit code")
).action((target: string, opts) => {
  if (opts.failOn !== "errors" && opts.failOn !== "warnings") {
    console.error(`error: --fail-on must be "errors" or "warnings", got "${opts.failOn}"`);
    process.exit(1);
  }
  const validGrades = ["A", "B", "C", "D", "F"];
  if (opts.minGrade && !validGrades.includes(opts.minGrade.toUpperCase())) {
    console.error(`error: --min-grade must be one of A, B, C, D, F — got "${opts.minGrade}"`);
    process.exit(1);
  }
  runLint(target, {
    failOn: opts.failOn,
    minGrade: opts.minGrade?.toUpperCase(),
    tokenBudget: opts.tokenBudget,
    format: opts.format,
    quiet: opts.quiet,
    run: runOptions(opts),
  });
});

withConnectionOptions(
  program
    .command("inspect <target>")
    .description("Show tools, resources, and prompts for an MCP server")
    .option("--format <fmt>", "Output format: json")
).action((target: string, opts) => {
  runInspect(target, { format: opts.format, run: runOptions(opts) });
});

withConnectionOptions(
  program
    .command("health <target>")
    .description("Check if an MCP server is reachable")
    .option("--format <fmt>", "Output format: json")
).action((target: string, opts) => {
  runHealth(target, { format: opts.format, run: runOptions(opts) });
});

withConnectionOptions(
  program
    .command("diff")
    .description("Compare two MCP server versions and fail CI on regressions")
    .requiredOption("--base <target>", "Base server URL or command")
    .requiredOption("--head <target>", "Head server URL or command")
    .option("--score-drop <n>", "Fail if score drops more than N points", parseInt, 10)
    .option(
      "--token-threshold <n>",
      "Fail if token footprint increases more than N%",
      parseInt,
      20
    )
    .option("--allow-breaking", "Do not fail when tools or parameters are removed or changed incompatibly")
    .option("--format <fmt>", "Output format: json")
).action((opts) => {
  runDiff({
    base: opts.base,
    head: opts.head,
    scoreDrop: opts.scoreDrop,
    tokenThreshold: opts.tokenThreshold,
    format: opts.format,
    allowBreaking: opts.allowBreaking,
    run: runOptions(opts),
  });
});

program.parse();
