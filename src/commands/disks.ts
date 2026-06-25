/**
 * commands/disks.ts — beszel disks command handler.
 *
 * REQ-6: Unified disk + RAID device listing. Optional --system and --failing.
 *
 * Pipeline: loadConfig → createClient → fetchDisks → emit
 *
 * This module is Ink-free (REQ-2 boundary). No static Ink/React import.
 * The Ink renderer is loaded ONLY via dynamic import() inside the TTY branch.
 */

import type { Command } from "commander";
import { loadConfig } from "../client/config.js";
import { createClient } from "../client/beszelClient.js";
import { fetchDisks } from "../queries/disks.js";
import { emit, resolveMode, type RenderCallback } from "../utils/output.js";
import { handleError } from "../utils/errors.js";
import type { DisksOutput } from "../types/output.js";

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

        const renderer: RenderCallback<DisksOutput> = async (data) => {
          const { renderDisksList } = await import("../renderers/ink/DisksList.js");
          await renderDisksList(data);
        };

        await emit(result, { json, noColor: globalOpts.noColor, renderer });
      } catch (err) {
        handleError(err, { json });
      }
    });
}
