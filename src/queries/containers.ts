import type { BeszelClient } from "../client/beszelClient.js";
import { mapContainer } from "../mapping/key-map.js";
import type { ContainerInfo, ContainersOutput } from "../types/output.js";
import {
  ContainerRecordSchema,
  PocketBaseListSchema,
  SystemRecordSchema,
} from "../types/upstream.js";
import { CliError } from "../types/errors.js";

export type ContainersOptions = {
  /** Limit results to top N items (server-side perPage). */
  top?: number;
  /** Sort field: "cpu" → server sort `-cpu`, "memory" → server sort `-memory`. */
  sort?: "cpu" | "memory";
  /** Filter to containers on a named system (name or id). */
  system?: string;
};

async function resolveSystemId(
  client: BeszelClient,
  nameOrId: string,
): Promise<string> {
  const ListSchema = PocketBaseListSchema(SystemRecordSchema);

  const raw = await client.listRecords("systems", {
    sort: "name",
    perPage: 500,
    skipTotal: true,
  });

  const parsed = ListSchema.parse(raw);
  const allSystems = parsed.items;

  const lowerArg = nameOrId.toLowerCase();
  const nameMatches = allSystems.filter(
    (s) => s.name.toLowerCase() === lowerArg,
  );

  if (nameMatches.length > 1) {
    const ids = nameMatches.map((s) => s.id).join(", ");
    throw new CliError(
      "AMBIGUOUS_SYSTEM",
      `Multiple systems match the name "${nameOrId}" (case-insensitive). Use an id.`,
      `Matching system ids: ${ids}`,
    );
  }

  if (nameMatches.length === 1) {
    return nameMatches[0]!.id;
  }

  // Fallback: exact id match.
  const idMatch = allSystems.find((s) => s.id === nameOrId);
  if (idMatch) return idMatch.id;

  throw new CliError(
    "NOT_FOUND",
    `No system found matching name or id "${nameOrId}".`,
    `Run "beszel systems --json" to list available systems and their ids.`,
  );
}

export async function fetchContainers(
  client: BeszelClient,
  opts: ContainersOptions = {},
): Promise<ContainersOutput> {
  const ListSchema = PocketBaseListSchema(ContainerRecordSchema);

  // containers has no `created` field → sort by -updated, not -created.
  let sort = "-updated";
  if (opts.sort === "cpu") sort = "-cpu";
  else if (opts.sort === "memory") sort = "-memory";

  const perPage = opts.top ?? 500;
  let filterParts: string[] = [];

  if (opts.system !== undefined) {
    const systemId = await resolveSystemId(client, opts.system);
    filterParts.push(`system="${systemId}"`);
  }

  const filter = filterParts.length > 0 ? filterParts.join(" && ") : undefined;

  const raw = await client.listRecords("containers", {
    sort,
    perPage,
    filter,
    skipTotal: true,
  });

  const parsed = ListSchema.parse(raw);

  const systemIds = [...new Set(parsed.items.map((c) => c.system).filter(Boolean))] as string[];

  let systemNameMap: Map<string, string> = new Map();
  if (systemIds.length > 0) {
    const SysListSchema = PocketBaseListSchema(SystemRecordSchema);
    const sysRaw = await client.listRecords("systems", {
      sort: "name",
      perPage: 500,
      skipTotal: true,
    });
    const sysParsed = SysListSchema.parse(sysRaw);
    for (const s of sysParsed.items) {
      systemNameMap.set(s.id, s.name);
    }
  }

  const containers: ContainerInfo[] = parsed.items.map((record) => {
    const systemName = record.system
      ? (systemNameMap.get(record.system) ?? record.system)
      : "";
    return mapContainer(record, systemName);
  });

  return { containers };
}
