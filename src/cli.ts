/**
 * cli.ts — Commander wiring entry point for beszel.
 *
 * This is the ONLY file that wires Commander options to command handlers.
 * It does NOT perform any business logic; each sub-command module owns its own
 * pipeline (loadConfig → createClient → fetch → emit → handleError).
 *
 * Global options (available on every subcommand via .optsWithGlobals()):
 *   --json       Force JSON output regardless of TTY state (REQ-2).
 *   --no-color   Suppress ANSI codes in TTY output (REQ-2).
 *   --no-cache   Disable token cache; always re-authenticate (REQ-1).
 *
 * Exit-code ownership:
 *   Commands set process.exitCode (never call process.exit()) so the event
 *   loop drains normally. handleError() maps CliErrors to exit codes.
 */

import { createRequire } from "module";
import { Command } from "commander";

import { registerSystems } from "./commands/systems.js";
import { registerSystem } from "./commands/system.js";
import { registerContainers } from "./commands/containers.js";
import { registerDisks } from "./commands/disks.js";
import { registerTemps } from "./commands/temps.js";
import { registerHealth } from "./commands/health.js";

// ---------------------------------------------------------------------------
// Package version — loaded at runtime to avoid duplicating the version string.
// ---------------------------------------------------------------------------

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string };

// ---------------------------------------------------------------------------
// Root program
// ---------------------------------------------------------------------------

const program = new Command();

program
  .name("beszel")
  .description("Read-only Beszel monitoring CLI for humans and agents")
  .version(pkg.version, "-V, --version", "print the current version")
  // Global options — parsed by Commander and forwarded via .optsWithGlobals().
  .option("--json", "Force JSON output (also active when stdout is not a TTY or CI=true)")
  .option("--no-color", "Suppress ANSI colors in TTY output")
  .option("--no-cache", "Disable token cache; always re-authenticate");

// ---------------------------------------------------------------------------
// Subcommands (Phase 6)
// ---------------------------------------------------------------------------

registerSystems(program);
registerSystem(program);
registerContainers(program);
registerDisks(program);
registerTemps(program);
registerHealth(program);

// ---------------------------------------------------------------------------
// Parse
// ---------------------------------------------------------------------------

program.parse(process.argv);
