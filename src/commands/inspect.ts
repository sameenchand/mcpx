import ora from "ora";
import chalk from "chalk";
import { inspect as apiInspect } from "../lib/api.js";
import { printInspect } from "../lib/format.js";
import { EXIT } from "../lib/exit-codes.js";

interface InspectOptions {
  format?: "json";
}

export async function runInspect(
  url: string,
  opts: InspectOptions
): Promise<void> {
  const spinner = opts.format === "json" ? null : ora("Inspecting server…").start();

  let result;
  try {
    result = await apiInspect(url);
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
