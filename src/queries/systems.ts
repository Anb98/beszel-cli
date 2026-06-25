import type { BeszelClient } from "../client/beszelClient.js";
import { checkVersion } from "../client/beszelClient.js";
import { mapSystem } from "../mapping/key-map.js";
import type { SystemItem, SystemsOutput } from "../types/output.js";
import { PocketBaseListSchema, SystemRecordSchema } from "../types/upstream.js";

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
