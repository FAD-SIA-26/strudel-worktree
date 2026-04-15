import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    cli: "apps/api/src/cli.ts",
  },
  format: ["esm"],
  target: "node20",
  platform: "node",
  bundle: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  outDir: "dist",
  outExtension: () => ({ js: ".mjs" }),
  noExternal: [/^@orc\//],
});
