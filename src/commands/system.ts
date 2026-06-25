import type { Command } from "commander";
import { loadConfig } from "../client/config.js";
import { createClient } from "../client/beszelClient.js";
import { fetchSystem } from "../queries/system.js";
import { fetchStats } from "../queries/stats.js";
import { emit, resolveMode, type RenderCallback } from "../utils/output.js";
import { handleError } from "../utils/errors.js";
import type { SystemOutput } from "../types/output.js";

export function registerSystem(program: Command): void {
  program
    .command("system <name>")
    .description("Show detail for one system (resolved by name or id)")
    .option("--since <duration>", "Historical window (e.g. 30m, 12h, 7d)")
    .action(async (nameArg: string, opts: { since?: string }, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals() as {
        json?: boolean;
        noColor?: boolean;
        noCache?: boolean;
      };

      const json = resolveMode({ json: globalOpts.json }) === "json";

      try {
        const config = loadConfig();
        const client = await createClient(config, globalOpts.noCache ?? false);

        const renderer: RenderCallback<SystemOutput> = async (data) => {
          const { renderSystemDetail } = await import("../renderers/ink/SystemDetail.js");
          await renderSystemDetail(data);
        };

        const systemResult = await fetchSystem(client, nameArg);

        if (!opts.since) {
          await emit(systemResult, { json, noColor: globalOpts.noColor, renderer });
          return;
        }

        const statsEnvelope = await fetchStats(client, {
          since: opts.since,
          systemId: systemResult.system.id,
        });

        const result = {
          ...systemResult,
          history: statsEnvelope,
        };

        const rendererExtended = renderer as RenderCallback<typeof result>;
        await emit(result, { json, noColor: globalOpts.noColor, renderer: rendererExtended });
      } catch (err) {
        handleError(err, { json });
      }
    });
}
