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

// ---------------------------------------------------------------------------
// fetchSystems — retrieve all systems from the PocketBase `systems` collection
// ---------------------------------------------------------------------------

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

  // Fetch up to 500 systems per page; most fleets are <<500.
  const raw = await client.listRecords("systems", {
    sort: "name",   // server-side by name for efficiency
    perPage: 500,
    skipTotal: true,
  });

  const parsed = ListSchema.parse(raw);

  // Check agent version against SUPPORTED_BESZEL on the first system encountered.
  // Emits a stderr warning if out of range; never throws (design R5 / T-9.4).
  if (parsed.items.length > 0) {
    const firstVersion = parsed.items[0]!.info?.v;
    checkVersion(firstVersion);
  }

  let systems: SystemItem[] = parsed.items.map((record) => mapSystem(record));

  // Optional client-side status filter (REQ-3 --status flag).
  if (statusFilter !== undefined) {
    systems = systems.filter((s) => s.status === statusFilter);
  }

  // Deterministic sort by name ascending (client-side for stability).
  systems.sort((a, b) => a.name.localeCompare(b.name));

  return { systems };
}
