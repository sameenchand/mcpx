#!/usr/bin/env node
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// src/index.ts
var import_commander = require("commander");

// src/commands/lint.ts
var import_ora = __toESM(require("ora"));
var import_chalk2 = __toESM(require("chalk"));

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
var import_chalk = __toESM(require("chalk"));
var DIVIDER = import_chalk.default.dim("\u2500".repeat(41));
function gradeColor(grade) {
  if (grade === "A") return import_chalk.default.green(grade);
  if (grade === "B") return import_chalk.default.cyan(grade);
  if (grade === "C") return import_chalk.default.yellow(grade);
  if (grade === "D") return import_chalk.default.magenta(grade);
  return import_chalk.default.red(grade);
}
var GRADE_ORDER = ["F", "D", "C", "B", "A"];
function printLint(result, failOn = "errors", minGrade, tokenBudgetExceeded) {
  console.log();
  console.log(import_chalk.default.bold("  MCP Playground \u2014 Schema Linter"));
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
    console.log(import_chalk.default.red.bold(`  ERRORS (${errors.length})`));
    for (const issue of errors) {
      const target = issue.target ? ` ${issue.category ?? "tool"} "${issue.target}" \u2014` : "";
      console.log(import_chalk.default.red(`  \u2717${target} ${issue.message}`));
    }
  }
  if (warnings.length > 0) {
    console.log();
    console.log(import_chalk.default.yellow.bold(`  WARNINGS (${warnings.length})`));
    for (const issue of warnings) {
      const target = issue.target ? ` ${issue.category ?? "tool"} "${issue.target}" \u2014` : "";
      console.log(import_chalk.default.yellow(`  \u26A0${target} ${issue.message}`));
    }
  }
  if (infos.length > 0) {
    console.log();
    console.log(import_chalk.default.blue.bold(`  INFO (${infos.length})`));
    for (const issue of infos) {
      const target = issue.target ? ` ${issue.category ?? "tool"} "${issue.target}" \u2014` : "";
      console.log(import_chalk.default.blue(`  \u2139${target} ${issue.message}`));
    }
  }
  const encoded = encodeURIComponent(result.url);
  console.log();
  console.log(
    import_chalk.default.dim(
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
    console.log(import_chalk.default.red.bold(`  \u2716 Failed (${parts.join(", ")})`));
  } else if (gradeFailed) {
    const parts = [];
    if (errCount > 0) parts.push(`${errCount} error${errCount > 1 ? "s" : ""}`);
    if (warnCount > 0) parts.push(`${warnCount} warning${warnCount > 1 ? "s" : ""}`);
    const suffix = parts.length > 0 ? `, ${parts.join(", ")}` : "";
    console.log(import_chalk.default.red.bold(`  \u2716 Failed (grade ${result.grade} below minimum ${minGrade}${suffix})`));
  } else if (ciPassed) {
    const parts = [];
    if (errCount > 0) parts.push(`${errCount} error${errCount > 1 ? "s" : ""}`);
    if (warnCount > 0) parts.push(`${warnCount} warning${warnCount > 1 ? "s" : ""}`);
    const suffix = parts.length > 0 ? ` (${parts.join(", ")})` : "";
    console.log(import_chalk.default.green.bold(`  \u2714 Passed${suffix}`));
  } else {
    const parts = [];
    if (errCount > 0) parts.push(`${errCount} error${errCount > 1 ? "s" : ""}`);
    if (warnCount > 0) parts.push(`${warnCount} warning${warnCount > 1 ? "s" : ""}`);
    console.log(import_chalk.default.red.bold(`  \u2716 Failed (${parts.join(", ")})`));
  }
  console.log();
}
function printInspect(result) {
  console.log();
  console.log(import_chalk.default.bold("  MCP Playground \u2014 Server Inspection"));
  console.log("  " + DIVIDER);
  if (result.tools.length > 0) {
    console.log(import_chalk.default.bold.cyan(`
  Tools (${result.tools.length})`));
    for (const tool of result.tools) {
      console.log(import_chalk.default.cyan(`  \u2022 ${tool.name}`));
      if (tool.description) {
        const firstLine = tool.description.split("\n")[0].trim();
        console.log(import_chalk.default.dim(`    ${firstLine}`));
      }
    }
  }
  if (result.resources.length > 0) {
    console.log(import_chalk.default.bold.magenta(`
  Resources (${result.resources.length})`));
    for (const r of result.resources) {
      console.log(import_chalk.default.magenta(`  \u2022 ${r.name}`));
      if (r.description) {
        const firstLine = r.description.split("\n")[0].trim();
        console.log(import_chalk.default.dim(`    ${firstLine}`));
      }
    }
  }
  if (result.prompts.length > 0) {
    console.log(import_chalk.default.bold.blue(`
  Prompts (${result.prompts.length})`));
    for (const p of result.prompts) {
      console.log(import_chalk.default.blue(`  \u2022 ${p.name}`));
      if (p.description) {
        const firstLine = p.description.split("\n")[0].trim();
        console.log(import_chalk.default.dim(`    ${firstLine}`));
      }
    }
  }
  console.log();
}
function printHealth(result, url) {
  const statusColor = {
    up: import_chalk.default.green,
    down: import_chalk.default.red,
    auth_required: import_chalk.default.yellow,
    unknown: import_chalk.default.dim
  };
  const color = statusColor[result.status] ?? import_chalk.default.dim;
  console.log();
  console.log(import_chalk.default.bold("  MCP Playground \u2014 Health Check"));
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
  const spinner = opts.quiet || opts.format === "json" ? null : (0, import_ora.default)("Linting server\u2026").start();
  let result;
  try {
    result = await lint(url);
  } catch (err) {
    spinner?.fail(import_chalk2.default.red("Could not reach server"));
    if (!opts.quiet) {
      console.error(
        import_chalk2.default.red(`  Error: ${err instanceof Error ? err.message : String(err)}`)
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
var import_ora2 = __toESM(require("ora"));
var import_chalk3 = __toESM(require("chalk"));
async function runInspect(url, opts) {
  const spinner = opts.format === "json" ? null : (0, import_ora2.default)("Inspecting server\u2026").start();
  let result;
  try {
    result = await inspect(url);
  } catch (err) {
    spinner?.fail(import_chalk3.default.red("Could not reach server"));
    console.error(
      import_chalk3.default.red(`  Error: ${err instanceof Error ? err.message : String(err)}`)
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
var import_ora3 = __toESM(require("ora"));
var import_chalk4 = __toESM(require("chalk"));
async function runHealth(url, opts) {
  const spinner = opts.format === "json" ? null : (0, import_ora3.default)("Checking server health\u2026").start();
  let result;
  try {
    result = await health(url);
  } catch (err) {
    spinner?.fail(import_chalk4.default.red("Could not reach server"));
    console.error(
      import_chalk4.default.red(`  Error: ${err instanceof Error ? err.message : String(err)}`)
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
var import_ora4 = __toESM(require("ora"));
var import_chalk5 = __toESM(require("chalk"));
var GRADE_ORDER3 = ["F", "D", "C", "B", "A"];
async function runDiff(opts) {
  const spinner = opts.format === "json" ? null : (0, import_ora4.default)("Fetching base and head lint results\u2026").start();
  let base, head;
  try {
    [base, head] = await Promise.all([lint(opts.base), lint(opts.head)]);
  } catch (err) {
    spinner?.fail(import_chalk5.default.red("Could not reach one or both servers"));
    console.error(
      import_chalk5.default.red(`  Error: ${err instanceof Error ? err.message : String(err)}`)
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
  const DIVIDER2 = import_chalk5.default.dim("\u2500".repeat(41));
  console.log();
  console.log(import_chalk5.default.bold("  MCP Playground \u2014 Diff"));
  console.log("  " + DIVIDER2);
  const gradeLine = gradeDrop ? import_chalk5.default.red(`  Grade  : ${base.grade} \u2192 ${head.grade}  \u2716 dropped`) : import_chalk5.default.green(`  Grade  : ${base.grade} \u2192 ${head.grade}  \u2714 ok`);
  console.log(gradeLine);
  const scoreLine = scoreDiff > 0 ? import_chalk5.default.red(`  Score  : ${base.score} \u2192 ${head.score}  (\u2212${scoreDiff})`) : scoreDiff < 0 ? import_chalk5.default.green(`  Score  : ${base.score} \u2192 ${head.score}  (+${Math.abs(scoreDiff)})`) : import_chalk5.default.green(`  Score  : ${base.score} \u2192 ${head.score}  (no change)`);
  console.log(scoreLine);
  const tokenLine = tokenIncreasePct > 0 ? import_chalk5.default.yellow(
    `  Tokens : ~${base.tokenEstimate.total.toLocaleString()} \u2192 ~${head.tokenEstimate.total.toLocaleString()}  (+${tokenIncreasePct.toFixed(1)}%)`
  ) : import_chalk5.default.green(
    `  Tokens : ~${base.tokenEstimate.total.toLocaleString()} \u2192 ~${head.tokenEstimate.total.toLocaleString()}`
  );
  console.log(tokenLine);
  console.log();
}

// src/index.ts
var program = new import_commander.Command();
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
