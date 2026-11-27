import ora from "ora";
import chalk from "chalk";
import { healthTarget, type RunOptions } from "../lib/run.js";
import { printHealth } from "../lib/format.js";
import { EXIT } from "../lib/exit-codes.js";

interface HealthOptions {
  format?: "json";
  run?: RunOptions;
}

export async function runHealth(
  url: string,
  opts: HealthOptions
): Promise<void> {
  const spinner = opts.format === "json" ? null : ora("Checking server health…").start();

  let result;
  try {
    result = await healthTarget(url, opts.run);
  } catch (err) {
    spinner?.fail(chalk.red("Could not reach server"));
    console.error(
      chalk.red(`  Error: ${err instanceof Error ? err.message : String(err)}`)
    );
    process.exit(EXIT.ERROR);
  }

  spinner?.stop();

  if (opts.format === "json") {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printHealth(result, url);
  }

  const exit =
    result.status === "up"
      ? EXIT.PASS
      : result.status === "auth_required"
      ? EXIT.ERROR
      : EXIT.FAIL;

  process.exit(exit);
}
