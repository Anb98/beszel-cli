import type { Command } from "commander";
import { loadConfig } from "../client/config.js";
import { createClient } from "../client/beszelClient.js";
import { fetchContainers } from "../queries/containers.js";
import { emit, resolveMode, type RenderCallback } from "../utils/output.js";
import { handleError } from "../utils/errors.js";
import type { ContainersOutput } from "../types/output.js";

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

          const sortField =
            opts.sort === "memory" ? "memory" : "cpu";

          const result = await fetchContainers(client, {
            top: opts.top,
            sort: sortField as "cpu" | "memory",
            system: opts.system,
          });

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
