import ora from "ora";
import chalk from "chalk";
import { inspectTarget, type RunOptions } from "../lib/run.js";
import { printInspect } from "../lib/format.js";
import { EXIT } from "../lib/exit-codes.js";

interface InspectOptions {
  format?: "json";
  run?: RunOptions;
}

export async function runInspect(
  url: string,
  opts: InspectOptions
): Promise<void> {
  const spinner = opts.format === "json" ? null : ora("Inspecting server…").start();

  let result;
  try {
    result = await inspectTarget(url, opts.run);
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
    printInspect(result);
  }

  process.exit(EXIT.PASS);
}
