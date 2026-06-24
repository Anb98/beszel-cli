/**
 * commands/systems.ts — beszel systems command handler.
 *
 * REQ-3: List all fleet systems, optional --status filter.
 * Pipeline: loadConfig → createClient → fetchSystems → emit
 *
 * This module is Ink-free (REQ-2 boundary). No static Ink/React import.
 */

import type { Command } from "commander";
import { loadConfig } from "../client/config.js";
import { createClient } from "../client/beszelClient.js";
import { fetchSystems } from "../queries/systems.js";
import { emit, resolveMode } from "../utils/output.js";
import { handleError } from "../utils/errors.js";

// ---------------------------------------------------------------------------
// registerSystems — attach the `systems` subcommand to a Commander program
// ---------------------------------------------------------------------------

export function registerSystems(program: Command): void {
  program
    .command("systems")
    .description("List all fleet systems")
    .option("--status <value>", "Filter by system status (e.g. up, down)")
    .action(async (opts: { status?: string }, cmd: Command) => {
      // Resolve global options from the root command.
      const globalOpts = cmd.optsWithGlobals() as {
        json?: boolean;
        noColor?: boolean;
        noCache?: boolean;
      };

      const json = resolveMode({ json: globalOpts.json }) === "json";

      try {
        const config = loadConfig();
        const client = await createClient(config, globalOpts.noCache ?? false);
        const result = await fetchSystems(client, opts.status);
        await emit(result, { json, noColor: globalOpts.noColor });
      } catch (err) {
        handleError(err, { json });
      }
    });
}
