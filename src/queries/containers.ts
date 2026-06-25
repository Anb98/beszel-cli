/**
 * containers.ts — Fetch containers from Beszel, map to ContainerInfo[].
 *
 * REQ-5: list all containers; support --top N, --sort cpu|memory (server-side),
 * --system (resolve name→id, filter server-side).
 *
 * CRITICAL gotcha (live recon #472):
 *   The `containers` collection has NO `created` field.
 *   Sorting by `-created` returns HTTP 400. Sort by `updated` or by metric only.
 *   Server-side sort by `-cpu` / `-memory` is supported and used for --top.
 *
 * This module is Ink-free (REQ-2 boundary).
 */

import type { BeszelClient } from "../client/beszelClient.js";
import { mapContainer } from "../mapping/key-map.js";
import type { ContainerInfo, ContainersOutput } from "../types/output.js";
import {
  ContainerRecordSchema,
  PocketBaseListSchema,
  SystemRecordSchema,
} from "../types/upstream.js";
import { CliError } from "../types/errors.js";

// ---------------------------------------------------------------------------
// ContainersOptions — mirrors the CLI flags
// ---------------------------------------------------------------------------

export type ContainersOptions = {
  /** Limit results to top N items (server-side perPage). */
  top?: number;
  /** Sort field: "cpu" → server sort `-cpu`, "memory" → server sort `-memory`. */
  sort?: "cpu" | "memory";
  /** Filter to containers on a named system (name or id). */
  system?: string;
};

// ---------------------------------------------------------------------------
// resolveSystemId — name → id lookup for --system filter
// ---------------------------------------------------------------------------

/**
 * Resolve a system name (case-insensitive) or id to a system id string.
 * Used for server-side filtering of the containers collection.
 *
 * @throws {CliError} NOT_FOUND if no system matches.
 * @throws {CliError} AMBIGUOUS_SYSTEM if multiple name matches.
 */
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

// ---------------------------------------------------------------------------
// fetchContainers — public API
// ---------------------------------------------------------------------------

/**
 * Fetch containers from the fleet, applying server-side sort and filter,
 * then mapping to ContainerInfo[].
 *
 * @param client - An authenticated BeszelClient.
 * @param opts - top, sort, system filter options.
 * @returns ContainersOutput envelope; empty array (never error) when none found.
 */
export async function fetchContainers(
  client: BeszelClient,
  opts: ContainersOptions = {},
): Promise<ContainersOutput> {
  const ListSchema = PocketBaseListSchema(ContainerRecordSchema);

  // Build server-side sort: -cpu or -memory for --sort flag; default -updated.
  // NEVER sort by -created (containers collection has NO created field → HTTP 400).
  let sort = "-updated";
  if (opts.sort === "cpu") sort = "-cpu";
  else if (opts.sort === "memory") sort = "-memory";

  // Server-side perPage: use --top N if provided (limits network payload).
  const perPage = opts.top ?? 500;

  // Build filter string for system lookup.
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

  // Build a system-id → system-name map for mapContainer().
  // We fetch system names to pass the human-readable name to ContainerInfo.
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
