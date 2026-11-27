import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

const { version } = JSON.parse(readFileSync("./package.json", "utf8")) as { version: string };
const define = { __VERSION__: JSON.stringify(version) };

export default defineConfig([
  {
    entry: { index: "src/index.ts" },
    format: ["cjs", "esm"],
    dts: true,
    clean: true,
    define,
  },
  {
    // The GitHub Action runs dist/action.js straight from the repo with no
    // node_modules, so every dependency has to be bundled into it.
    entry: { action: "src/action.ts" },
    format: ["cjs"],
    dts: false,
    clean: false,
    noExternal: [/.*/],
    define,
  },
]);
