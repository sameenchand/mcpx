import ora from "ora";
import chalk from "chalk";
import { lint as apiLint } from "../lib/api.js";
import { printLint } from "../lib/format.js";
import { EXIT } from "../lib/exit-codes.js";

const GRADE_ORDER = ["F", "D", "C", "B", "A"];

interface LintOptions {
  failOn: "errors" | "warnings";
  minGrade?: string;
  tokenBudget?: number;
  format?: "json";
  quiet?: boolean;
}

export async function runLint(url: string, opts: LintOptions): Promise<void> {
  const spinner = opts.quiet || opts.format === "json" ? null : ora("Linting server…").start();

  let result;
  try {
    result = await apiLint(url);
  } catch (err) {
    spinner?.fail(chalk.red("Could not reach server"));
    if (!opts.quiet) {
      console.error(
        chalk.red(`  Error: ${err instanceof Error ? err.message : String(err)}`)
      );
    }
    process.exit(EXIT.ERROR);
  }

  spinner?.stop();

  // Compute token budget failure before rendering anything
  const tokenBudgetExceeded =
    opts.tokenBudget !== undefined && result.tokenEstimate.total > opts.tokenBudget
      ? { actual: result.tokenEstimate.total, budget: opts.tokenBudget }
      : undefined;

  if (opts.format === "json") {
    console.log(JSON.stringify(result, null, 2));
    process.exit(
      shouldFail(result.grade, result.summary, opts, tokenBudgetExceeded)
        ? EXIT.FAIL
        : EXIT.PASS
    );
  }

  if (!opts.quiet) {
    printLint(result, opts.failOn, opts.minGrade, tokenBudgetExceeded);
  }

  process.exit(
    shouldFail(result.grade, result.summary, opts, tokenBudgetExceeded)
      ? EXIT.FAIL
      : EXIT.PASS
  );
}

function shouldFail(
  grade: string,
  summary: { errors: number; warnings: number },
  opts: LintOptions,
  tokenBudgetExceeded?: { actual: number; budget: number }
): boolean {
  if (tokenBudgetExceeded) return true;

  if (opts.minGrade) {
    const actual = GRADE_ORDER.indexOf(grade);
    const minimum = GRADE_ORDER.indexOf(opts.minGrade);
    if (actual < minimum) return true;
  }

  if (opts.failOn === "warnings") {
    return summary.errors > 0 || summary.warnings > 0;
  }
  return summary.errors > 0;
}
