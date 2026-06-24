/**
 * commands/temps.ts — beszel temps command handler.
 *
 * REQ-7: Per-system temperature summary. Optional --disks merges disk temps.
 *
 * Pipeline: loadConfig → createClient → fetchTemps → emit
 *
 * This module is Ink-free (REQ-2 boundary). No static Ink/React import.
 */

import type { Command } from "commander";
import { loadConfig } from "../client/config.js";
import { createClient } from "../client/beszelClient.js";
import { fetchTemps } from "../queries/temps.js";
import { emit, resolveMode } from "../utils/output.js";
import { handleError } from "../utils/errors.js";

// ---------------------------------------------------------------------------
// registerTemps — attach the `temps` subcommand to a Commander program
// ---------------------------------------------------------------------------

export function registerTemps(program: Command): void {
  program
    .command("temps")
    .description("Show temperatures for all fleet systems")
    .option("--disks", "Include disk (SMART) temperatures in the sensor map")
    .action(async (opts: { disks?: boolean }, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals() as {
        json?: boolean;
        noColor?: boolean;
        noCache?: boolean;
      };

      const json = resolveMode({ json: globalOpts.json }) === "json";

      try {
        const config = loadConfig();
        const client = await createClient(config, globalOpts.noCache ?? false);
        const result = await fetchTemps(client, { disks: opts.disks });
        await emit(result, { json, noColor: globalOpts.noColor });
      } catch (err) {
        handleError(err, { json });
      }
    });
}
