import { lint as apiLint } from "./lib/api.js";
import { EXIT } from "./lib/exit-codes.js";

const GRADE_ORDER = ["F", "D", "C", "B", "A"];

// GitHub Actions sets inputs as INPUT_<NAME> env vars
function getInput(name: string): string {
  return process.env[`INPUT_${name.toUpperCase().replace(/-/g, "_")}`] ?? "";
}

async function run(): Promise<void> {
  const url = getInput("url");
  const failOn = (getInput("fail-on") || "errors") as "errors" | "warnings";
  const minGrade = getInput("min-grade").toUpperCase() || undefined;
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

  // Emit GitHub Actions outputs (new GITHUB_OUTPUT env file method)
  const outputFile = process.env.GITHUB_OUTPUT;
  if (outputFile) {
    const { appendFileSync } = await import("fs");
    appendFileSync(outputFile, `grade=${result.grade}\n`);
    appendFileSync(outputFile, `score=${result.score}\n`);
    appendFileSync(outputFile, `errors=${result.summary.errors}\n`);
    appendFileSync(outputFile, `warnings=${result.summary.warnings}\n`);
  }

  // Annotate issues in the Actions UI
  for (const issue of result.issues) {
    const level = issue.severity === "error" ? "error" : "warning";
    console.log(`::${level}::${issue.message}`);
  }

  // Token budget check
  if (tokenBudget && result.tokenEstimate.total > tokenBudget) {
    console.error(
      `::error::Token budget exceeded: ${result.tokenEstimate.total} > ${tokenBudget}`
    );
    process.exit(EXIT.FAIL);
  }

  // Min grade check
  if (minGrade) {
    const actual = GRADE_ORDER.indexOf(result.grade);
    const minimum = GRADE_ORDER.indexOf(minGrade);
    if (actual < minimum) {
      console.error(
        `::error::Grade ${result.grade} is below minimum required grade ${minGrade}`
      );
      process.exit(EXIT.FAIL);
    }
  }

  // fail-on check
  const failed =
    failOn === "warnings"
      ? result.summary.errors > 0 || result.summary.warnings > 0
      : result.summary.errors > 0;

  process.exit(failed ? EXIT.FAIL : EXIT.PASS);
}

run();
