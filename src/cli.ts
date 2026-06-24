import { createRequire } from "module";
import { Command } from "commander";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string };

const program = new Command();

program
  .name("beszel")
  .description("Read-only Beszel monitoring CLI for humans and agents")
  .version(pkg.version, "-V, --version", "print the current version");

program.parse(process.argv);
