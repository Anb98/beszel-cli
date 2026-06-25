import type { Command } from "commander";
import { loadConfig } from "../client/config.js";
import { createClient } from "../client/beszelClient.js";
import { fetchTemps } from "../queries/temps.js";
import { emit, resolveMode, type RenderCallback } from "../utils/output.js";
import { handleError } from "../utils/errors.js";
import type { TempsOutput } from "../types/output.js";

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
