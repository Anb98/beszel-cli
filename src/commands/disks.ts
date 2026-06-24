/**
 * commands/disks.ts — beszel disks command handler.
 *
 * REQ-6: Unified disk + RAID device listing. Optional --system and --failing.
 *
 * Pipeline: loadConfig → createClient → fetchDisks → emit
 *
 * This module is Ink-free (REQ-2 boundary). No static Ink/React import.
 */

import type { Command } from "commander";
import { loadConfig } from "../client/config.js";
import { createClient } from "../client/beszelClient.js";
import { fetchDisks } from "../queries/disks.js";
import { emit, resolveMode } from "../utils/output.js";
import { handleError } from "../utils/errors.js";

// ---------------------------------------------------------------------------
// registerDisks — attach the `disks` subcommand to a Commander program
// ---------------------------------------------------------------------------

export function registerDisks(program: Command): void {
  program
    .command("disks")
    .description("List SMART disks and RAID arrays across the fleet")
    .option("--system <name>", "Filter to one system (name or id)")
    .option("--failing", "Show only failing devices (state != PASSED or RAID not clean+idle)")
    .action(async (opts: { system?: string; failing?: boolean }, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals() as {
        json?: boolean;
        noColor?: boolean;
        noCache?: boolean;
      };

      const json = resolveMode({ json: globalOpts.json }) === "json";

      try {
        const config = loadConfig();
        const client = await createClient(config, globalOpts.noCache ?? false);
        const result = await fetchDisks(client, {
          system: opts.system,
          failing: opts.failing,
        });
        await emit(result, { json, noColor: globalOpts.noColor });
      } catch (err) {
        handleError(err, { json });
      }
    });
}
