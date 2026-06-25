import type { BeszelClient } from "../client/beszelClient.js";
import { mapSmartDevice } from "../mapping/key-map.js";
import type { DeviceInfo, DisksOutput, DiskInfo, RaidInfo } from "../types/output.js";
import {
  PocketBaseListSchema,
  SmartDeviceRecordSchema,
  SystemRecordSchema,
} from "../types/upstream.js";
import { CliError } from "../types/errors.js";

export type DisksOptions = {
  /** Filter to one system by name or id. When absent, queries the entire fleet. */
  system?: string;
  /** Filter to failing devices only (disk: state!="PASSED"; raid: not clean+idle). */
  failing?: boolean;
};

function isFailing(device: DeviceInfo): boolean {
  if (device.kind === "disk") {
    const d = device as DiskInfo;
    return d.state !== "PASSED";
  } else {
    const r = device as RaidInfo;
    return r.arrayState !== "clean" || r.syncAction !== "idle";
  }
}

async function resolveSystemId(
  client: BeszelClient,
  nameOrId: string,
): Promise<{ id: string; name: string }> {
  const ListSchema = PocketBaseListSchema(SystemRecordSchema);

  const raw = await client.listRecords("systems", {
    sort: "name",
    perPage: 500,
    skipTotal: true,
  });
  const parsed = ListSchema.parse(raw);

  const lowerArg = nameOrId.toLowerCase();
  const nameMatches = parsed.items.filter(
    (s) => s.name.toLowerCase() === lowerArg,
  );

  if (nameMatches.length > 1) {
    const ids = nameMatches.map((s) => s.id).join(", ");
    throw new CliError(
      "AMBIGUOUS_SYSTEM",
      `Multiple systems match "${nameOrId}" (case-insensitive). Use an id.`,
      `Matching system ids: ${ids}`,
    );
  }
  if (nameMatches.length === 1) {
    return { id: nameMatches[0]!.id, name: nameMatches[0]!.name };
  }

  const idMatch = parsed.items.find((s) => s.id === nameOrId);
  if (idMatch) return { id: idMatch.id, name: idMatch.name };

  throw new CliError(
    "NOT_FOUND",
    `No system found matching name or id "${nameOrId}".`,
    `Run "beszel systems --json" to list available systems and their ids.`,
  );
}

export async function fetchDisks(
  client: BeszelClient,
  opts: DisksOptions = {},
): Promise<DisksOutput> {
  const ListSchema = PocketBaseListSchema(SmartDeviceRecordSchema);

  let filterParts: string[] = [];
  let systemNameMap: Map<string, string> = new Map();

  if (opts.system !== undefined) {
    const { id, name } = await resolveSystemId(client, opts.system);
    filterParts.push(`system="${id}"`);
    systemNameMap.set(id, name);
  } else {
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

  const filter = filterParts.length > 0 ? filterParts.join(" && ") : undefined;

  // smart_devices has no `created` field → sort by -updated, not -created.
  const raw = await client.listRecords("smart_devices", {
    sort: "-updated",
    perPage: 500,
    filter,
    skipTotal: true,
  });

  const parsed = ListSchema.parse(raw);

  let devices: DeviceInfo[] = parsed.items.map((record) => {
    const systemName = record.system
      ? (systemNameMap.get(record.system) ?? record.system)
      : "";
    return mapSmartDevice(record, systemName);
  });

  if (opts.failing) {
    devices = devices.filter(isFailing);
  }

  return { devices };
}
