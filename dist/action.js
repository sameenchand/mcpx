"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// src/lib/api.ts
var BASE = "https://mcpplayground.tech/api/v1";
async function get(path, url) {
  const encoded = encodeURIComponent(url);
  const res = await fetch(`${BASE}/${path}?url=${encoded}`);
  if (!res.ok) {
    throw new Error(`API error ${res.status}: ${res.statusText}`);
  }
  return res.json();
}
async function lint(url) {
  return get("lint", url);
}

// src/lib/exit-codes.ts
var EXIT = {
  PASS: 0,
  FAIL: 1,
  ERROR: 2
};

// src/action.ts
var GRADE_ORDER = ["F", "D", "C", "B", "A"];
function getInput(name) {
  return process.env[`INPUT_${name.toUpperCase().replace(/-/g, "_")}`] ?? "";
}
async function run() {
  const url = getInput("url");
  const failOn = getInput("fail-on") || "errors";
  const minGrade = getInput("min-grade").toUpperCase() || void 0;
  const tokenBudgetRaw = getInput("token-budget");
  const tokenBudget = tokenBudgetRaw ? parseInt(tokenBudgetRaw, 10) : void 0;
  if (!url) {
    console.error("::error::Input 'url' is required");
    process.exit(EXIT.ERROR);
  }
  let result;
  try {
    result = await lint(url);
  } catch (err) {
    console.error(
      `::error::Could not reach server: ${err instanceof Error ? err.message : String(err)}`
    );
    process.exit(EXIT.ERROR);
  }
  const outputFile = process.env.GITHUB_OUTPUT;
  if (outputFile) {
    const { appendFileSync } = await import("fs");
    appendFileSync(outputFile, `grade=${result.grade}
`);
    appendFileSync(outputFile, `score=${result.score}
`);
    appendFileSync(outputFile, `errors=${result.summary.errors}
`);
    appendFileSync(outputFile, `warnings=${result.summary.warnings}
`);
  }
  for (const issue of result.issues) {
    const level = issue.severity === "error" ? "error" : "warning";
    console.log(`::${level}::${issue.message}`);
  }
  if (tokenBudget && result.tokenEstimate.total > tokenBudget) {
    console.error(
      `::error::Token budget exceeded: ${result.tokenEstimate.total} > ${tokenBudget}`
    );
    process.exit(EXIT.FAIL);
  }
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
  const failed = failOn === "warnings" ? result.summary.errors > 0 || result.summary.warnings > 0 : result.summary.errors > 0;
  process.exit(failed ? EXIT.FAIL : EXIT.PASS);
}
run();
