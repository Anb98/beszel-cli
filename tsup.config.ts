import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/cli.ts"],
  format: ["esm"],
  dts: false,
  clean: true,
  banner: {
    js: "#!/usr/bin/env node",
  },
  onSuccess: process.platform === "win32"
    ? undefined
    : "chmod +x dist/cli.js",
});
