import type { BeszelClient } from "../client/beszelClient.js";
import { mapSystemDetail, mapSystemDetailsInfo } from "../mapping/key-map.js";
import type { SystemOutput } from "../types/output.js";
import {
  PocketBaseListSchema,
  SystemDetailsRecordSchema,
  SystemRecordSchema,
} from "../types/upstream.js";
import { CliError } from "../types/errors.js";

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

export async function fetchSystem(
  client: BeszelClient,
  nameOrId: string,
): Promise<SystemOutput> {
  const record = await resolveSystem(client, nameOrId);
  const system = mapSystemDetail(record);

  // system_details id == system id.
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
