import ora from "ora";
import chalk from "chalk";
import { analyzeTarget, type RunOptions } from "../lib/run.js";
import { diffSchemas, type SchemaChange, type SchemaDiff } from "../lib/schema-diff.js";
import { EXIT } from "../lib/exit-codes.js";

const GRADE_ORDER = ["F", "D", "C", "B", "A"];

interface DiffOptions {
  base: string;
  head: string;
  tokenThreshold: number;
  scoreDrop: number;
  format?: "json";
  allowBreaking?: boolean;
  run?: RunOptions;
}

export async function runDiff(opts: DiffOptions): Promise<void> {
  const spinner =
    opts.format === "json" ? null : ora("Fetching base and head lint results…").start();

  let baseAnalysis, headAnalysis;
  try {
    [baseAnalysis, headAnalysis] = await Promise.all([
      analyzeTarget(opts.base, opts.run),
      analyzeTarget(opts.head, opts.run),
    ]);
  } catch (err) {
    spinner?.fail(chalk.red("Could not reach one or both servers"));
    console.error(
      chalk.red(`  Error: ${err instanceof Error ? err.message : String(err)}`)
    );
    process.exit(EXIT.ERROR);
  }

  spinner?.stop();

  const base = baseAnalysis.lint;
  const head = headAnalysis.lint;
  const schema = diffSchemas(baseAnalysis.inspect, headAnalysis.inspect);

  const gradeDrop =
    GRADE_ORDER.indexOf(head.grade) < GRADE_ORDER.indexOf(base.grade);
  const scoreDiff = base.score - head.score;
  const tokenIncreasePct =
    base.tokenEstimate.total > 0
      ? ((head.tokenEstimate.total - base.tokenEstimate.total) / base.tokenEstimate.total) * 100
      : 0;

  if (opts.format === "json") {
    console.log(
      JSON.stringify(
        { base, head, gradeDrop, scoreDiff, tokenIncreasePct, schema },
        null,
        2
      )
    );
  } else {
    printDiff({ base, head, gradeDrop, scoreDiff, tokenIncreasePct });
    printSchemaDiff(schema, opts.allowBreaking === true);
  }

  const failed =
    (schema.breaking.length > 0 && !opts.allowBreaking) ||
    gradeDrop ||
    scoreDiff > opts.scoreDrop ||
    tokenIncreasePct > opts.tokenThreshold;

  process.exit(failed ? EXIT.FAIL : EXIT.PASS);
}

function printDiff({
  base,
  head,
  gradeDrop,
  scoreDiff,
  tokenIncreasePct,
}: {
  base: { grade: string; score: number; tokenEstimate: { total: number } };
  head: { grade: string; score: number; tokenEstimate: { total: number } };
  gradeDrop: boolean;
  scoreDiff: number;
  tokenIncreasePct: number;
}): void {
  const DIVIDER = chalk.dim("─".repeat(41));
  console.log();
  console.log(chalk.bold("  MCP Playground — Diff"));
  console.log("  " + DIVIDER);

  const gradeLine = gradeDrop
    ? chalk.red(`  Grade  : ${base.grade} → ${head.grade}  ✖ dropped`)
    : chalk.green(`  Grade  : ${base.grade} → ${head.grade}  ✔ ok`);
  console.log(gradeLine);

  const scoreLine =
    scoreDiff > 0
      ? chalk.red(`  Score  : ${base.score} → ${head.score}  (−${scoreDiff})`)
      : scoreDiff < 0
      ? chalk.green(`  Score  : ${base.score} → ${head.score}  (+${Math.abs(scoreDiff)})`)
      : chalk.green(`  Score  : ${base.score} → ${head.score}  (no change)`);
  console.log(scoreLine);

  const tokenLine =
    tokenIncreasePct > 0
      ? chalk.yellow(
          `  Tokens : ~${base.tokenEstimate.total.toLocaleString()} → ~${head.tokenEstimate.total.toLocaleString()}  (+${tokenIncreasePct.toFixed(1)}%)`
        )
      : chalk.green(
          `  Tokens : ~${base.tokenEstimate.total.toLocaleString()} → ~${head.tokenEstimate.total.toLocaleString()}`
        );
  console.log(tokenLine);
  console.log();
}

function printSchemaDiff(schema: SchemaDiff, allowBreaking: boolean): void {
  const line = (c: SchemaChange): string => `${c.category} "${c.target}" — ${c.message}`;

  if (schema.breaking.length > 0) {
    console.log(chalk.red.bold(`  BREAKING (${schema.breaking.length})`));
    for (const c of schema.breaking) console.log(chalk.red(`  ✗ ${line(c)}`));
    console.log();
  }
  if (schema.changed.length > 0) {
    console.log(chalk.yellow.bold(`  CHANGED (${schema.changed.length})`));
    for (const c of schema.changed) console.log(chalk.yellow(`  ~ ${line(c)}`));
    console.log();
  }
  if (schema.added.length > 0) {
    console.log(chalk.green.bold(`  ADDED (${schema.added.length})`));
    for (const c of schema.added) console.log(chalk.green(`  + ${line(c)}`));
    console.log();
  }

  if (schema.breaking.length === 0 && schema.changed.length === 0 && schema.added.length === 0) {
    console.log(chalk.green("  Schema : no changes"));
    console.log();
  } else if (schema.breaking.length > 0 && allowBreaking) {
    console.log(chalk.dim("  Breaking changes allowed by --allow-breaking."));
    console.log();
  }
}
