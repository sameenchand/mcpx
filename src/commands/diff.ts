import ora from "ora";
import chalk from "chalk";
import { lint as apiLint } from "../lib/api.js";
import { EXIT } from "../lib/exit-codes.js";

const GRADE_ORDER = ["F", "D", "C", "B", "A"];

interface DiffOptions {
  base: string;
  head: string;
  tokenThreshold: number;
  scoreDrop: number;
  format?: "json";
}

export async function runDiff(opts: DiffOptions): Promise<void> {
  const spinner =
    opts.format === "json" ? null : ora("Fetching base and head lint results…").start();

  let base, head;
  try {
    [base, head] = await Promise.all([apiLint(opts.base), apiLint(opts.head)]);
  } catch (err) {
    spinner?.fail(chalk.red("Could not reach one or both servers"));
    console.error(
      chalk.red(`  Error: ${err instanceof Error ? err.message : String(err)}`)
    );
    process.exit(EXIT.ERROR);
  }

  spinner?.stop();

  const gradeDrop =
    GRADE_ORDER.indexOf(head.grade) < GRADE_ORDER.indexOf(base.grade);
  const scoreDiff = base.score - head.score;
  const tokenIncreasePct =
    base.tokenEstimate > 0
      ? ((head.tokenEstimate - base.tokenEstimate) / base.tokenEstimate) * 100
      : 0;

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

  const failed =
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
  base: { grade: string; score: number; tokenEstimate: number };
  head: { grade: string; score: number; tokenEstimate: number };
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
      : chalk.green(
          `  Score  : ${base.score} → ${head.score}  (+${Math.abs(scoreDiff)})`
        );
  console.log(scoreLine);

  const tokenLine =
    tokenIncreasePct > 0
      ? chalk.yellow(
          `  Tokens : ~${base.tokenEstimate.toLocaleString()} → ~${head.tokenEstimate.toLocaleString()}  (+${tokenIncreasePct.toFixed(1)}%)`
        )
      : chalk.green(
          `  Tokens : ~${base.tokenEstimate.toLocaleString()} → ~${head.tokenEstimate.toLocaleString()}`
        );
  console.log(tokenLine);
  console.log();
}
