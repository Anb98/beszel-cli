/**
 * commands/systems.ts — beszel systems command handler.
 *
 * REQ-3: List all fleet systems, optional --status filter.
 * Pipeline: loadConfig → createClient → fetchSystems → emit
 *
 * This module is Ink-free (REQ-2 boundary). No static Ink/React import.
 * The Ink renderer is loaded ONLY via dynamic import() inside the TTY branch
 * of emit() — never statically here.
 */

import type { Command } from "commander";
import { loadConfig } from "../client/config.js";
import { createClient } from "../client/beszelClient.js";
import { fetchSystems } from "../queries/systems.js";
import { emit, resolveMode, type RenderCallback } from "../utils/output.js";
import { handleError } from "../utils/errors.js";
import type { SystemsOutput } from "../types/output.js";

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

        // TTY renderer — loaded dynamically so Ink is never on the agent path.
        const renderer: RenderCallback<SystemsOutput> = async (data) => {
          const { renderSystemsTable } = await import("../renderers/ink/SystemsTable.js");
          await renderSystemsTable(data);
        };

        await emit(result, { json, noColor: globalOpts.noColor, renderer });
      } catch (err) {
        handleError(err, { json });
      }
    });
}
