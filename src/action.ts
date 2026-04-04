import { lint as apiLint } from "./lib/api.js";
import { EXIT } from "./lib/exit-codes.js";

// GitHub Actions sets inputs as INPUT_<NAME> env vars
function getInput(name: string): string {
  return process.env[`INPUT_${name.toUpperCase().replace(/-/g, "_")}`] ?? "";
}

async function run(): Promise<void> {
  const url = getInput("url");
  const failOn = (getInput("fail-on") || "errors") as "errors" | "warnings";
  const tokenBudgetRaw = getInput("token-budget");
  const tokenBudget = tokenBudgetRaw ? parseInt(tokenBudgetRaw, 10) : undefined;

  if (!url) {
    console.error("::error::Input 'url' is required");
    process.exit(EXIT.ERROR);
  }

  let result;
  try {
    result = await apiLint(url);
  } catch (err) {
    console.error(
      `::error::Could not reach server: ${err instanceof Error ? err.message : String(err)}`
    );
    process.exit(EXIT.ERROR);
  }

  // Emit GitHub Actions output
  console.log(`::set-output name=grade::${result.grade}`);
  console.log(`::set-output name=score::${result.score}`);
  console.log(`::set-output name=errors::${result.totals.errors}`);
  console.log(`::set-output name=warnings::${result.totals.warnings}`);

  for (const issue of result.issues) {
    const level = issue.severity === "error" ? "error" : "warning";
    console.log(`::${level}::${issue.message}`);
  }

  if (tokenBudget && result.tokenEstimate > tokenBudget) {
    console.error(
      `::error::Token budget exceeded: ${result.tokenEstimate} > ${tokenBudget}`
    );
    process.exit(EXIT.FAIL);
  }

  const failed =
    failOn === "warnings"
      ? result.totals.errors > 0 || result.totals.warnings > 0
      : result.totals.errors > 0;

  process.exit(failed ? EXIT.FAIL : EXIT.PASS);
}

run();
