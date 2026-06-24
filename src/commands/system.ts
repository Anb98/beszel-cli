/**
 * commands/system.ts — beszel system <name|id> command handler.
 *
 * REQ-4: Resolve one system by name (case-insensitive) or id.
 *   - Optional --since <dur>: fetch historical stats via fetchStats().
 *   - Merges system_details (null when absent; never error).
 *   - NOT_FOUND / AMBIGUOUS_SYSTEM → exit 3.
 *
 * REQ-9: --since adds HistoricalEnvelope<StatsPoint[]> to the response.
 *
 * This module is Ink-free (REQ-2 boundary). No static Ink/React import.
 */

import type { Command } from "commander";
import { loadConfig } from "../client/config.js";
import { createClient } from "../client/beszelClient.js";
import { fetchSystem } from "../queries/system.js";
import { fetchStats } from "../queries/stats.js";
import { emit, resolveMode } from "../utils/output.js";
import { handleError } from "../utils/errors.js";

// ---------------------------------------------------------------------------
// registerSystem — attach the `system` subcommand to a Commander program
// ---------------------------------------------------------------------------

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

        // Fetch system snapshot + system_details.
        const systemResult = await fetchSystem(client, nameArg);

        if (!opts.since) {
          // No historical window — emit the snapshot directly.
          await emit(systemResult, { json, noColor: globalOpts.noColor });
          return;
        }

        // --since: wrap in HistoricalEnvelope.
        const statsEnvelope = await fetchStats(client, {
          since: opts.since,
          systemId: systemResult.system.id,
        });

        const result = {
          ...systemResult,
          history: statsEnvelope,
        };

        await emit(result, { json, noColor: globalOpts.noColor });
      } catch (err) {
        handleError(err, { json });
      }
    });
}
