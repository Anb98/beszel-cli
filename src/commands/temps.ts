/**
 * commands/temps.ts — beszel temps command handler.
 *
 * REQ-7: Per-system temperature summary. Optional --disks merges disk temps.
 *
 * Pipeline: loadConfig → createClient → fetchTemps → emit
 *
 * This module is Ink-free (REQ-2 boundary). No static Ink/React import.
 * The Ink renderer is loaded ONLY via dynamic import() inside the TTY branch.
 */

import type { Command } from "commander";
import { loadConfig } from "../client/config.js";
import { createClient } from "../client/beszelClient.js";
import { fetchTemps } from "../queries/temps.js";
import { emit, resolveMode, type RenderCallback } from "../utils/output.js";
import { handleError } from "../utils/errors.js";
import type { TempsOutput } from "../types/output.js";

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

        // TTY renderer — loaded dynamically so Ink is never on the agent path.
        const renderer: RenderCallback<TempsOutput> = async (data) => {
          const { renderTempsList } = await import("../renderers/ink/TempsList.js");
          await renderTempsList(data);
        };

        await emit(result, { json, noColor: globalOpts.noColor, renderer });
      } catch (err) {
        handleError(err, { json });
      }
    });
}
