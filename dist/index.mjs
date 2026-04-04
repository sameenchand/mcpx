#!/usr/bin/env node

// src/index.ts
import { Command } from "commander";

// src/commands/lint.ts
import ora from "ora";
import chalk2 from "chalk";

// src/lib/api.ts
var BASE = "https://mcpplayground.tech/api/v1";
async function get(path, url) {
  const encoded = encodeURIComponent(url);
  const res = await fetch(`${BASE}/${path}?url=${encoded}`);
  if (!res.ok) {
    throw new Error(`API error ${res.status}: ${res.statusText}`);
  }
  return res.json();
}
async function lint(url) {
  return get("lint", url);
}
async function inspect(url) {
  return get("inspect", url);
}
async function health(url) {
  return get("health", url);
}

// src/lib/format.ts
import chalk from "chalk";
var DIVIDER = chalk.dim("\u2500".repeat(41));
function gradeColor(grade) {
  if (grade === "A") return chalk.green(grade);
  if (grade === "B") return chalk.cyan(grade);
  if (grade === "C") return chalk.yellow(grade);
  if (grade === "D") return chalk.magenta(grade);
  return chalk.red(grade);
}
var GRADE_ORDER = ["F", "D", "C", "B", "A"];
function printLint(result, failOn = "errors", minGrade, tokenBudgetExceeded) {
  console.log();
  console.log(chalk.bold("  MCP Playground \u2014 Schema Linter"));
  console.log("  " + DIVIDER);
  if (result.server?.name) {
    console.log(`  Server : ${result.server.name}${result.server.version ? ` v${result.server.version}` : ""}`);
  }
  console.log(
    `  Tools  : ${result.summary.toolsChecked}  \xB7  Resources: ${result.summary.resourcesChecked}  \xB7  Prompts: ${result.summary.promptsChecked}`
  );
  console.log(
    `  Grade  : ${gradeColor(result.grade)}   \xB7  Score: ${result.score}/100`
  );
  console.log(`  Tokens : ~${result.tokenEstimate.total.toLocaleString()} estimated`);
  const errors = result.issues.filter((i) => i.severity === "error");
  const warnings = result.issues.filter((i) => i.severity === "warning");
  const infos = result.issues.filter((i) => i.severity === "info");
  if (errors.length > 0) {
    console.log();
    console.log(chalk.red.bold(`  ERRORS (${errors.length})`));
    for (const issue of errors) {
      const target = issue.target ? ` ${issue.category ?? "tool"} "${issue.target}" \u2014` : "";
      console.log(chalk.red(`  \u2717${target} ${issue.message}`));
    }
  }
  if (warnings.length > 0) {
    console.log();
    console.log(chalk.yellow.bold(`  WARNINGS (${warnings.length})`));
    for (const issue of warnings) {
      const target = issue.target ? ` ${issue.category ?? "tool"} "${issue.target}" \u2014` : "";
      console.log(chalk.yellow(`  \u26A0${target} ${issue.message}`));
    }
  }
  if (infos.length > 0) {
    console.log();
    console.log(chalk.blue.bold(`  INFO (${infos.length})`));
    for (const issue of infos) {
      const target = issue.target ? ` ${issue.category ?? "tool"} "${issue.target}" \u2014` : "";
      console.log(chalk.blue(`  \u2139${target} ${issue.message}`));
    }
  }
  const encoded = encodeURIComponent(result.url);
  console.log();
  console.log(
    chalk.dim(
      `  Open in MCP Playground \u2192 https://mcpplayground.tech/lint?url=${encoded}`
    )
  );
  console.log("  " + DIVIDER);
  const { errors: errCount, warnings: warnCount } = result.summary;
  const gradeFailed = minGrade !== void 0 && GRADE_ORDER.indexOf(result.grade) < GRADE_ORDER.indexOf(minGrade);
  const issueFailed = failOn === "warnings" ? errCount > 0 || warnCount > 0 : errCount > 0;
  const ciPassed = !tokenBudgetExceeded && !gradeFailed && !issueFailed;
  if (tokenBudgetExceeded) {
    const parts = [`token budget exceeded: ${tokenBudgetExceeded.actual.toLocaleString()} > ${tokenBudgetExceeded.budget.toLocaleString()}`];
    if (errCount > 0) parts.push(`${errCount} error${errCount > 1 ? "s" : ""}`);
    if (warnCount > 0) parts.push(`${warnCount} warning${warnCount > 1 ? "s" : ""}`);
    console.log(chalk.red.bold(`  \u2716 Failed (${parts.join(", ")})`));
  } else if (gradeFailed) {
    const parts = [];
    if (errCount > 0) parts.push(`${errCount} error${errCount > 1 ? "s" : ""}`);
    if (warnCount > 0) parts.push(`${warnCount} warning${warnCount > 1 ? "s" : ""}`);
    const suffix = parts.length > 0 ? `, ${parts.join(", ")}` : "";
    console.log(chalk.red.bold(`  \u2716 Failed (grade ${result.grade} below minimum ${minGrade}${suffix})`));
  } else if (ciPassed) {
    const parts = [];
    if (errCount > 0) parts.push(`${errCount} error${errCount > 1 ? "s" : ""}`);
    if (warnCount > 0) parts.push(`${warnCount} warning${warnCount > 1 ? "s" : ""}`);
    const suffix = parts.length > 0 ? ` (${parts.join(", ")})` : "";
    console.log(chalk.green.bold(`  \u2714 Passed${suffix}`));
  } else {
    const parts = [];
    if (errCount > 0) parts.push(`${errCount} error${errCount > 1 ? "s" : ""}`);
    if (warnCount > 0) parts.push(`${warnCount} warning${warnCount > 1 ? "s" : ""}`);
    console.log(chalk.red.bold(`  \u2716 Failed (${parts.join(", ")})`));
  }
  console.log();
}
function printInspect(result) {
  console.log();
  console.log(chalk.bold("  MCP Playground \u2014 Server Inspection"));
  console.log("  " + DIVIDER);
  if (result.tools.length > 0) {
    console.log(chalk.bold.cyan(`
  Tools (${result.tools.length})`));
    for (const tool of result.tools) {
      console.log(chalk.cyan(`  \u2022 ${tool.name}`));
      if (tool.description) {
        const firstLine = tool.description.split("\n")[0].trim();
        console.log(chalk.dim(`    ${firstLine}`));
      }
    }
  }
  if (result.resources.length > 0) {
    console.log(chalk.bold.magenta(`
  Resources (${result.resources.length})`));
    for (const r of result.resources) {
      console.log(chalk.magenta(`  \u2022 ${r.name}`));
      if (r.description) {
        const firstLine = r.description.split("\n")[0].trim();
        console.log(chalk.dim(`    ${firstLine}`));
      }
    }
  }
  if (result.prompts.length > 0) {
    console.log(chalk.bold.blue(`
  Prompts (${result.prompts.length})`));
    for (const p of result.prompts) {
      console.log(chalk.blue(`  \u2022 ${p.name}`));
      if (p.description) {
        const firstLine = p.description.split("\n")[0].trim();
        console.log(chalk.dim(`    ${firstLine}`));
      }
    }
  }
  console.log();
}
function printHealth(result, url) {
  const statusColor = {
    up: chalk.green,
    down: chalk.red,
    auth_required: chalk.yellow,
    unknown: chalk.dim
  };
  const color = statusColor[result.status] ?? chalk.dim;
  console.log();
  console.log(chalk.bold("  MCP Playground \u2014 Health Check"));
  console.log("  " + DIVIDER);
  console.log(`  URL    : ${url}`);
  console.log(`  Status : ${color(result.status)}`);
  console.log(`  Latency: ${result.latencyMs}ms`);
  console.log();
}

// src/lib/exit-codes.ts
var EXIT = {
  PASS: 0,
  FAIL: 1,
  ERROR: 2
};

// src/commands/lint.ts
var GRADE_ORDER2 = ["F", "D", "C", "B", "A"];
async function runLint(url, opts) {
  const spinner = opts.quiet || opts.format === "json" ? null : ora("Linting server\u2026").start();
  let result;
  try {
    result = await lint(url);
  } catch (err) {
    spinner?.fail(chalk2.red("Could not reach server"));
    if (!opts.quiet) {
      console.error(
        chalk2.red(`  Error: ${err instanceof Error ? err.message : String(err)}`)
      );
    }
    process.exit(EXIT.ERROR);
  }
  spinner?.stop();
  const tokenBudgetExceeded = opts.tokenBudget !== void 0 && result.tokenEstimate.total > opts.tokenBudget ? { actual: result.tokenEstimate.total, budget: opts.tokenBudget } : void 0;
  if (opts.format === "json") {
    console.log(JSON.stringify(result, null, 2));
    process.exit(
      shouldFail(result.grade, result.summary, opts, tokenBudgetExceeded) ? EXIT.FAIL : EXIT.PASS
    );
  }
  if (!opts.quiet) {
    printLint(result, opts.failOn, opts.minGrade, tokenBudgetExceeded);
  }
  process.exit(
    shouldFail(result.grade, result.summary, opts, tokenBudgetExceeded) ? EXIT.FAIL : EXIT.PASS
  );
}
function shouldFail(grade, summary, opts, tokenBudgetExceeded) {
  if (tokenBudgetExceeded) return true;
  if (opts.minGrade) {
    const actual = GRADE_ORDER2.indexOf(grade);
    const minimum = GRADE_ORDER2.indexOf(opts.minGrade);
    if (actual < minimum) return true;
  }
  if (opts.failOn === "warnings") {
    return summary.errors > 0 || summary.warnings > 0;
  }
  return summary.errors > 0;
}

// src/commands/inspect.ts
import ora2 from "ora";
import chalk3 from "chalk";
async function runInspect(url, opts) {
  const spinner = opts.format === "json" ? null : ora2("Inspecting server\u2026").start();
  let result;
  try {
    result = await inspect(url);
  } catch (err) {
    spinner?.fail(chalk3.red("Could not reach server"));
    console.error(
      chalk3.red(`  Error: ${err instanceof Error ? err.message : String(err)}`)
    );
    process.exit(EXIT.ERROR);
  }
  spinner?.stop();
  if (opts.format === "json") {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printInspect(result);
  }
  process.exit(EXIT.PASS);
}

// src/commands/health.ts
import ora3 from "ora";
import chalk4 from "chalk";
async function runHealth(url, opts) {
  const spinner = opts.format === "json" ? null : ora3("Checking server health\u2026").start();
  let result;
  try {
    result = await health(url);
  } catch (err) {
    spinner?.fail(chalk4.red("Could not reach server"));
    console.error(
      chalk4.red(`  Error: ${err instanceof Error ? err.message : String(err)}`)
    );
    process.exit(EXIT.ERROR);
  }
  spinner?.stop();
  if (opts.format === "json") {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printHealth(result, url);
  }
  const exit = result.status === "up" ? EXIT.PASS : result.status === "auth_required" ? EXIT.ERROR : EXIT.FAIL;
  process.exit(exit);
}

// src/commands/diff.ts
import ora4 from "ora";
import chalk5 from "chalk";
var GRADE_ORDER3 = ["F", "D", "C", "B", "A"];
async function runDiff(opts) {
  const spinner = opts.format === "json" ? null : ora4("Fetching base and head lint results\u2026").start();
  let base, head;
  try {
    [base, head] = await Promise.all([lint(opts.base), lint(opts.head)]);
  } catch (err) {
    spinner?.fail(chalk5.red("Could not reach one or both servers"));
    console.error(
      chalk5.red(`  Error: ${err instanceof Error ? err.message : String(err)}`)
    );
    process.exit(EXIT.ERROR);
  }
  spinner?.stop();
  const gradeDrop = GRADE_ORDER3.indexOf(head.grade) < GRADE_ORDER3.indexOf(base.grade);
  const scoreDiff = base.score - head.score;
  const tokenIncreasePct = base.tokenEstimate.total > 0 ? (head.tokenEstimate.total - base.tokenEstimate.total) / base.tokenEstimate.total * 100 : 0;
  if (opts.format === "json") {
    console.log(
      JSON.stringify(
        { base, head, gradeDrop, scoreDiff, tokenIncreasePct },
        null,
        2
      )
    );
  } else {
    printDiff({ base, head, gradeDrop, scoreDiff, tokenIncreasePct });
  }
  const failed = gradeDrop || scoreDiff > opts.scoreDrop || tokenIncreasePct > opts.tokenThreshold;
  process.exit(failed ? EXIT.FAIL : EXIT.PASS);
}
function printDiff({
  base,
  head,
  gradeDrop,
  scoreDiff,
  tokenIncreasePct
}) {
  const DIVIDER2 = chalk5.dim("\u2500".repeat(41));
  console.log();
  console.log(chalk5.bold("  MCP Playground \u2014 Diff"));
  console.log("  " + DIVIDER2);
  const gradeLine = gradeDrop ? chalk5.red(`  Grade  : ${base.grade} \u2192 ${head.grade}  \u2716 dropped`) : chalk5.green(`  Grade  : ${base.grade} \u2192 ${head.grade}  \u2714 ok`);
  console.log(gradeLine);
  const scoreLine = scoreDiff > 0 ? chalk5.red(`  Score  : ${base.score} \u2192 ${head.score}  (\u2212${scoreDiff})`) : scoreDiff < 0 ? chalk5.green(`  Score  : ${base.score} \u2192 ${head.score}  (+${Math.abs(scoreDiff)})`) : chalk5.green(`  Score  : ${base.score} \u2192 ${head.score}  (no change)`);
  console.log(scoreLine);
  const tokenLine = tokenIncreasePct > 0 ? chalk5.yellow(
    `  Tokens : ~${base.tokenEstimate.total.toLocaleString()} \u2192 ~${head.tokenEstimate.total.toLocaleString()}  (+${tokenIncreasePct.toFixed(1)}%)`
  ) : chalk5.green(
    `  Tokens : ~${base.tokenEstimate.total.toLocaleString()} \u2192 ~${head.tokenEstimate.total.toLocaleString()}`
  );
  console.log(tokenLine);
  console.log();
}

// src/index.ts
var program = new Command();
program.name("mcpx").description("Lint and inspect MCP servers. Powered by MCP Playground.").version("0.1.0");
program.command("lint <url>").description("Lint an MCP server schema").option(
  "--fail-on <level>",
  "Fail on: errors (default) or warnings",
  "errors"
).option("--min-grade <grade>", "Fail if grade is below threshold (A, B, C, D, F)").option("--token-budget <n>", "Fail if token footprint exceeds N", parseInt).option("--format <fmt>", "Output format: json").option("--quiet", "No output, just exit code").action((url, opts) => {
  if (opts.failOn !== "errors" && opts.failOn !== "warnings") {
    console.error(`error: --fail-on must be "errors" or "warnings", got "${opts.failOn}"`);
    process.exit(1);
  }
  const validGrades = ["A", "B", "C", "D", "F"];
  if (opts.minGrade && !validGrades.includes(opts.minGrade.toUpperCase())) {
    console.error(`error: --min-grade must be one of A, B, C, D, F \u2014 got "${opts.minGrade}"`);
    process.exit(1);
  }
  runLint(url, {
    failOn: opts.failOn,
    minGrade: opts.minGrade?.toUpperCase(),
    tokenBudget: opts.tokenBudget,
    format: opts.format,
    quiet: opts.quiet
  });
});
program.command("inspect <url>").description("Show tools, resources, and prompts for an MCP server").option("--format <fmt>", "Output format: json").action((url, opts) => {
  runInspect(url, { format: opts.format });
});
program.command("health <url>").description("Check if an MCP server is reachable").option("--format <fmt>", "Output format: json").action((url, opts) => {
  runHealth(url, { format: opts.format });
});
program.command("diff").description("Compare two MCP server versions and fail CI on regressions").requiredOption("--base <url>", "Base server URL").requiredOption("--head <url>", "Head server URL").option("--score-drop <n>", "Fail if score drops more than N points", parseInt, 10).option(
  "--token-threshold <n>",
  "Fail if token footprint increases more than N%",
  parseInt,
  20
).option("--format <fmt>", "Output format: json").action((opts) => {
  runDiff({
    base: opts.base,
    head: opts.head,
    scoreDrop: opts.scoreDrop,
    tokenThreshold: opts.tokenThreshold,
    format: opts.format
  });
});
program.parse();
