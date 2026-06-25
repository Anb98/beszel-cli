/**
 * system.ts — Resolve and fetch a single system by name or id.
 *
 * REQ-4: Two-step lookup:
 *   1. Case-insensitive exact name match (all systems, compare lowercased).
 *   2. If zero name matches → exact id match.
 *   Multiple case-insensitive name matches → AMBIGUOUS_SYSTEM exit 3.
 *   Zero matches total → NOT_FOUND exit 3.
 *
 * Merges the live snapshot (systems record) with system_details.
 * system_details absent → details: null (never error; REQ-4).
 *
 * Design R3: case-INSENSITIVE overrides spec REQ-4 "case-sensitive" — friendlier.
 *
 * This module is Ink-free (REQ-2 boundary).
 */

import type { BeszelClient } from "../client/beszelClient.js";
import { mapSystemDetail, mapSystemDetailsInfo } from "../mapping/key-map.js";
import type { SystemOutput } from "../types/output.js";
import {
  PocketBaseListSchema,
  SystemDetailsRecordSchema,
  SystemRecordSchema,
} from "../types/upstream.js";
import { CliError } from "../types/errors.js";

/**
 * Resolve a name-or-id argument to a single system record.
 *
 * @throws {CliError} AMBIGUOUS_SYSTEM (exit 3) if multiple systems share the name (case-insensitive).
 * @throws {CliError} NOT_FOUND (exit 3) if no name or id match.
 */
async function resolveSystem(
  client: BeszelClient,
  nameOrId: string,
) {
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
      `Multiple systems match the name "${nameOrId}" (case-insensitive). Use an id to disambiguate.`,
      `Matching system ids: ${ids}`,
    );
  }

  if (nameMatches.length === 1) {
    return nameMatches[0]!;
  }

  const idMatch = allSystems.find((s) => s.id === nameOrId);
  if (idMatch) return idMatch;

  throw new CliError(
    "NOT_FOUND",
    `No system found matching name or id "${nameOrId}".`,
    `Run "beszel systems --json" to list available systems and their ids.`,
  );
}

/**
 * Fetch one system by name or id, merging the live snapshot with system_details.
 *
 * @param client - An authenticated BeszelClient.
 * @param nameOrId - System name (case-insensitive) or exact id.
 * @returns SystemOutput with `system` (snapshot) and `details` (hardware info or null).
 */
export async function fetchSystem(
  client: BeszelClient,
  nameOrId: string,
): Promise<SystemOutput> {
  const record = await resolveSystem(client, nameOrId);
  const system = mapSystemDetail(record);

  // system_details id == system id (verified via live recon #472).
  const DetailsListSchema = PocketBaseListSchema(SystemDetailsRecordSchema);

  let details: SystemOutput["details"] = null;

  try {
    const rawDetails = await client.listRecords("system_details", {
      filter: `id="${record.id}"`,
      perPage: 1,
      skipTotal: true,
    });
    const parsedDetails = DetailsListSchema.parse(rawDetails);

    if (parsedDetails.items.length > 0) {
      details = mapSystemDetailsInfo(parsedDetails.items[0]!);
    }
  } catch (err) {
    // If system_details is absent or returns nothing, details stays null.
    // Only re-throw real CliErrors (network, auth); swallow NOT_FOUND gracefully.
    if (
      err instanceof CliError &&
      err.code !== "NOT_FOUND"
    ) {
      throw err;
    }
    details = null;
  }

  return { system, details };
}
