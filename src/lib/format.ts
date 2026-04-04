import chalk from "chalk";
import type { LintResult, InspectResult, HealthResult } from "./api.js";

const DIVIDER = chalk.dim("─".repeat(41));

function gradeColor(grade: string): string {
  if (grade === "A") return chalk.green(grade);
  if (grade === "B") return chalk.cyan(grade);
  if (grade === "C") return chalk.yellow(grade);
  if (grade === "D") return chalk.magenta(grade);
  return chalk.red(grade);
}

const GRADE_ORDER = ["F", "D", "C", "B", "A"];

export function printLint(result: LintResult, failOn: "errors" | "warnings" = "errors", minGrade?: string): void {
  console.log();
  console.log(chalk.bold("  MCP Playground — Schema Linter"));
  console.log("  " + DIVIDER);

  if (result.server?.name) {
    console.log(`  Server : ${result.server.name}${result.server.version ? ` v${result.server.version}` : ""}`);
  }
  console.log(
    `  Tools  : ${result.summary.toolsChecked}  ·  Resources: ${result.summary.resourcesChecked}  ·  Prompts: ${result.summary.promptsChecked}`
  );
  console.log(
    `  Grade  : ${gradeColor(result.grade)}   ·  Score: ${result.score}/100`
  );
  console.log(`  Tokens : ~${result.tokenEstimate.total.toLocaleString()} estimated`);

  const errors = result.issues.filter((i) => i.severity === "error");
  const warnings = result.issues.filter((i) => i.severity === "warning");
  const infos = result.issues.filter((i) => i.severity === "info");

  if (errors.length > 0) {
    console.log();
    console.log(chalk.red.bold(`  ERRORS (${errors.length})`));
    for (const issue of errors) {
      const target = issue.target ? ` ${issue.category ?? "tool"} "${issue.target}" —` : "";
      console.log(chalk.red(`  ✗${target} ${issue.message}`));
    }
  }

  if (warnings.length > 0) {
    console.log();
    console.log(chalk.yellow.bold(`  WARNINGS (${warnings.length})`));
    for (const issue of warnings) {
      const target = issue.target ? ` ${issue.category ?? "tool"} "${issue.target}" —` : "";
      console.log(chalk.yellow(`  ⚠${target} ${issue.message}`));
    }
  }

  if (infos.length > 0) {
    console.log();
    console.log(chalk.blue.bold(`  INFO (${infos.length})`));
    for (const issue of infos) {
      const target = issue.target ? ` ${issue.category ?? "tool"} "${issue.target}" —` : "";
      console.log(chalk.blue(`  ℹ${target} ${issue.message}`));
    }
  }

  const encoded = encodeURIComponent(result.url);
  console.log();
  console.log(
    chalk.dim(
      `  Open in MCP Playground → https://mcpplayground.tech/lint?url=${encoded}`
    )
  );
  console.log("  " + DIVIDER);

  const { errors: errCount, warnings: warnCount } = result.summary;

  const gradeFailed =
    minGrade !== undefined &&
    GRADE_ORDER.indexOf(result.grade) < GRADE_ORDER.indexOf(minGrade);

  const ciPassed =
    !gradeFailed &&
    (failOn === "warnings"
      ? errCount === 0 && warnCount === 0
      : errCount === 0);

  if (gradeFailed && !ciPassed) {
    const parts = [];
    if (errCount > 0) parts.push(`${errCount} error${errCount > 1 ? "s" : ""}`);
    if (warnCount > 0) parts.push(`${warnCount} warning${warnCount > 1 ? "s" : ""}`);
    const suffix = parts.length > 0 ? `, ${parts.join(", ")}` : "";
    console.log(chalk.red.bold(`  ✖ Failed (grade ${result.grade} below minimum ${minGrade}${suffix})`));
  } else if (ciPassed) {
    const parts = [];
    if (errCount > 0) parts.push(`${errCount} error${errCount > 1 ? "s" : ""}`);
    if (warnCount > 0)
      parts.push(`${warnCount} warning${warnCount > 1 ? "s" : ""}`);
    const suffix = parts.length > 0 ? ` (${parts.join(", ")})` : "";
    console.log(chalk.green.bold(`  ✔ Passed${suffix}`));
  } else {
    const parts = [];
    if (errCount > 0) parts.push(`${errCount} error${errCount > 1 ? "s" : ""}`);
    if (warnCount > 0)
      parts.push(`${warnCount} warning${warnCount > 1 ? "s" : ""}`);
    console.log(chalk.red.bold(`  ✖ Failed (${parts.join(", ")})`));
  }
  console.log();
}

export function printInspect(result: InspectResult): void {
  console.log();
  console.log(chalk.bold("  MCP Playground — Server Inspection"));
  console.log("  " + DIVIDER);

  if (result.tools.length > 0) {
    console.log(chalk.bold.cyan(`\n  Tools (${result.tools.length})`));
    for (const tool of result.tools) {
      console.log(chalk.cyan(`  • ${tool.name}`));
      if (tool.description) {
        // Trim description to first line only — full schema is in --format json
        const firstLine = tool.description.split("\n")[0].trim();
        console.log(chalk.dim(`    ${firstLine}`));
      }
    }
  }

  if (result.resources.length > 0) {
    console.log(chalk.bold.magenta(`\n  Resources (${result.resources.length})`));
    for (const r of result.resources) {
      console.log(chalk.magenta(`  • ${r.name}`));
      if (r.description) {
        const firstLine = r.description.split("\n")[0].trim();
        console.log(chalk.dim(`    ${firstLine}`));
      }
    }
  }

  if (result.prompts.length > 0) {
    console.log(chalk.bold.blue(`\n  Prompts (${result.prompts.length})`));
    for (const p of result.prompts) {
      console.log(chalk.blue(`  • ${p.name}`));
      if (p.description) {
        const firstLine = p.description.split("\n")[0].trim();
        console.log(chalk.dim(`    ${firstLine}`));
      }
    }
  }

  console.log();
}

export function printHealth(result: HealthResult, url: string): void {
  const statusColor: Record<string, (s: string) => string> = {
    up: chalk.green,
    down: chalk.red,
    auth_required: chalk.yellow,
    unknown: chalk.dim,
  };
  const color = statusColor[result.status] ?? chalk.dim;

  console.log();
  console.log(chalk.bold("  MCP Playground — Health Check"));
  console.log("  " + DIVIDER);
  console.log(`  URL    : ${url}`);
  console.log(`  Status : ${color(result.status)}`);
  console.log(`  Latency: ${result.latencyMs}ms`);
  console.log();
}
