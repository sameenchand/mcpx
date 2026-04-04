import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: { index: "src/index.ts" },
    format: ["cjs", "esm"],
    dts: true,
    clean: true,
  },
  {
    entry: { action: "src/action.ts" },
    format: ["cjs"],
    dts: false,
    clean: false,
  },
]);
