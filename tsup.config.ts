import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: { index: "src/index.ts" },
    format: ["cjs", "esm"],
    dts: true,
    clean: true,
    banner: { js: "#!/usr/bin/env node" },
  },
  {
    entry: { action: "src/action.ts" },
    format: ["cjs"],
    dts: false,
    clean: false,
  },
]);
