#!/usr/bin/env node
import { Command } from "commander";
import { runLint } from "./commands/lint.js";
import { runInspect } from "./commands/inspect.js";
import { runHealth } from "./commands/health.js";
import { runDiff } from "./commands/diff.js";

const program = new Command();

program
  .name("mcpx")
  .description("Lint and inspect MCP servers. Powered by MCP Playground.")
  .version("0.1.0");

program
  .command("lint <url>")
  .description("Lint an MCP server schema")
  .option(
    "--fail-on <level>",
    "Fail on: errors (default) or warnings",
    "errors"
  )
  .option("--token-budget <n>", "Fail if token footprint exceeds N", parseInt)
  .option("--format <fmt>", "Output format: json")
  .option("--quiet", "No output, just exit code")
  .action((url: string, opts) => {
    runLint(url, {
      failOn: opts.failOn,
      tokenBudget: opts.tokenBudget,
      format: opts.format,
      quiet: opts.quiet,
    });
  });

program
  .command("inspect <url>")
  .description("Show tools, resources, and prompts for an MCP server")
  .option("--format <fmt>", "Output format: json")
  .action((url: string, opts) => {
    runInspect(url, { format: opts.format });
  });

program
  .command("health <url>")
  .description("Check if an MCP server is reachable")
  .option("--format <fmt>", "Output format: json")
  .action((url: string, opts) => {
    runHealth(url, { format: opts.format });
  });

program
  .command("diff")
  .description("Compare two MCP server versions and fail CI on regressions")
  .requiredOption("--base <url>", "Base server URL")
  .requiredOption("--head <url>", "Head server URL")
  .option("--score-drop <n>", "Fail if score drops more than N points", parseInt, 10)
  .option(
    "--token-threshold <n>",
    "Fail if token footprint increases more than N%",
    parseInt,
    20
  )
  .option("--format <fmt>", "Output format: json")
  .action((opts) => {
    runDiff({
      base: opts.base,
      head: opts.head,
      scoreDrop: opts.scoreDrop,
      tokenThreshold: opts.tokenThreshold,
      format: opts.format,
    });
  });

program.parse();
