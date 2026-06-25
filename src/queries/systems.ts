/**
 * systems.ts — Fetch all fleet systems from Beszel, map to SystemItem[].
 *
 * REQ-3: returns all systems sorted by name ascending. Optional --status filter
 * is applied client-side after mapping.
 *
 * Uses listRecords to paginate if needed (perPage=500 to avoid multiple
 * round-trips for the typical fleet size). Sort by `updated` (systems DO have
 * the `created` field, but name-sort is deterministic and server-agnostic).
 *
 * This module is Ink-free (REQ-2 boundary).
 */

import type { BeszelClient } from "../client/beszelClient.js";
import { checkVersion } from "../client/beszelClient.js";
import { mapSystem } from "../mapping/key-map.js";
import type { SystemItem, SystemsOutput } from "../types/output.js";
import { PocketBaseListSchema, SystemRecordSchema } from "../types/upstream.js";

/**
 * Fetch all systems and return them mapped to SystemItem[], sorted by name
 * ascending (deterministic; REQ-3).
 *
 * @param client - An authenticated BeszelClient.
 * @param statusFilter - Optional status value to filter by (e.g. "down").
 * @returns SystemsOutput envelope.
 */
export async function fetchSystems(
  client: BeszelClient,
  statusFilter?: string,
): Promise<SystemsOutput> {
  const ListSchema = PocketBaseListSchema(SystemRecordSchema);

  const raw = await client.listRecords("systems", {
    sort: "name",
    perPage: 500,
    skipTotal: true,
  });

  const parsed = ListSchema.parse(raw);

  if (parsed.items.length > 0) {
    const firstVersion = parsed.items[0]!.info?.v;
    checkVersion(firstVersion);
  }

  let systems: SystemItem[] = parsed.items.map((record) => mapSystem(record));

  if (statusFilter !== undefined) {
    systems = systems.filter((s) => s.status === statusFilter);
  }

  systems.sort((a, b) => a.name.localeCompare(b.name));

  return { systems };
}
