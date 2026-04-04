import ora from "ora";
import chalk from "chalk";
import { lint as apiLint } from "../lib/api.js";
import { printLint } from "../lib/format.js";
import { EXIT } from "../lib/exit-codes.js";

interface LintOptions {
  failOn: "errors" | "warnings";
  tokenBudget?: number;
  format?: "json";
  quiet?: boolean;
}

export async function runLint(url: string, opts: LintOptions): Promise<void> {
  const spinner = opts.quiet ? null : ora("Linting server…").start();

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

  if (opts.format === "json") {
    console.log(JSON.stringify(result, null, 2));
    const failed = shouldFail(result.totals, opts);
    process.exit(failed ? EXIT.FAIL : EXIT.PASS);
  }

  if (!opts.quiet) {
    printLint(result);
  }

  if (opts.tokenBudget && result.tokenEstimate > opts.tokenBudget) {
    if (!opts.quiet) {
      console.error(
        chalk.red(
          `  Token budget exceeded: ${result.tokenEstimate.toLocaleString()} > ${opts.tokenBudget.toLocaleString()}`
        )
      );
    }
    process.exit(EXIT.FAIL);
  }

  const failed = shouldFail(result.totals, opts);
  process.exit(failed ? EXIT.FAIL : EXIT.PASS);
}

function shouldFail(
  totals: { errors: number; warnings: number },
  opts: LintOptions
): boolean {
  if (opts.failOn === "warnings") {
    return totals.errors > 0 || totals.warnings > 0;
  }
  return totals.errors > 0;
}
