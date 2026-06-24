/**
 * commands/containers.ts — beszel containers command handler.
 *
 * REQ-5: List containers with --top N, --sort cpu|memory, --system <name>.
 * REQ-9: Optional --since <dur> adds historical container stats.
 *
 * Pipeline: loadConfig → createClient → fetchContainers (+ fetchStats) → emit
 *
 * This module is Ink-free (REQ-2 boundary). No static Ink/React import.
 * The Ink renderer is loaded ONLY via dynamic import() inside the TTY branch.
 */

import type { Command } from "commander";
import { loadConfig } from "../client/config.js";
import { createClient } from "../client/beszelClient.js";
import { fetchContainers } from "../queries/containers.js";
import { emit, resolveMode, type RenderCallback } from "../utils/output.js";
import { handleError } from "../utils/errors.js";
import type { ContainersOutput } from "../types/output.js";

// ---------------------------------------------------------------------------
// registerContainers — attach the `containers` subcommand to a Commander program
// ---------------------------------------------------------------------------

export function registerContainers(program: Command): void {
  program
    .command("containers")
    .description("List containers across the fleet")
    .option("--top <n>", "Limit results to top N items", parseInt)
    .option("--sort <field>", "Sort field: cpu or memory", "cpu")
    .option("--system <name>", "Filter containers to one system")
    .option("--since <duration>", "Historical window (e.g. 30m, 12h, 7d)")
    .action(
      async (
        opts: {
          top?: number;
          sort?: string;
          system?: string;
          since?: string;
        },
        cmd: Command,
      ) => {
        const globalOpts = cmd.optsWithGlobals() as {
          json?: boolean;
          noColor?: boolean;
          noCache?: boolean;
        };

        const json = resolveMode({ json: globalOpts.json }) === "json";

        try {
          const config = loadConfig();
          const client = await createClient(config, globalOpts.noCache ?? false);

          // Validate --sort value.
          const sortField =
            opts.sort === "memory" ? "memory" : "cpu";

          const result = await fetchContainers(client, {
            top: opts.top,
            sort: sortField as "cpu" | "memory",
            system: opts.system,
          });

          // TTY renderer — loaded dynamically so Ink is never on the agent path.
          const renderer: RenderCallback<ContainersOutput> = async (data) => {
            const { renderContainersList } = await import("../renderers/ink/ContainersList.js");
            await renderContainersList(data);
          };

          await emit(result, { json, noColor: globalOpts.noColor, renderer });
        } catch (err) {
          handleError(err, { json });
        }
      },
    );
}
