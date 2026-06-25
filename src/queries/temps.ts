/**
 * temps.ts — Per-system temperature query.
 *
 * REQ-7: returns {systems:[TempInfo]} where each item carries:
 *   - displayTempC from systems.info.dt
 *   - sensors map from NEWEST system_stats record with type=="1m" (stats.t)
 *   - optionally merges smart_devices.temp when --disks is set
 *
 * Design R4: one query per run — fetch newest 1m row per system (sort -created).
 *   system_stats DOES have `created` → sort by -created is valid here.
 *   smart_devices has NO `created` → if --disks, sort smart_devices by -updated.
 *
 * This module is Ink-free (REQ-2 boundary).
 */

import type { BeszelClient } from "../client/beszelClient.js";
import { mapTempInfo } from "../mapping/key-map.js";
import type { TempInfo, TempsOutput } from "../types/output.js";
import {
  PocketBaseListSchema,
  SmartDeviceRecordSchema,
  SystemRecordSchema,
  SystemStatsRecordSchema,
} from "../types/upstream.js";
import type { SmartDeviceRecord, SystemStatsRecord } from "../types/upstream.js";

export type TempsOptions = {
  /** When true, merge smart_devices.temp into the sensors map. */
  disks?: boolean;
};

/**
 * Fetch temperature data for all systems.
 *
 * @param client - An authenticated BeszelClient.
 * @param opts - disks flag.
 * @returns TempsOutput envelope.
 */
export async function fetchTemps(
  client: BeszelClient,
  opts: TempsOptions = {},
): Promise<TempsOutput> {
  const SysListSchema = PocketBaseListSchema(SystemRecordSchema);
  const StatsListSchema = PocketBaseListSchema(SystemStatsRecordSchema);

  const sysRaw = await client.listRecords("systems", {
    sort: "name",
    perPage: 500,
    skipTotal: true,
  });
  const sysParsed = SysListSchema.parse(sysRaw);
  const allSystems = sysParsed.items;

  // system_stats DOES have `created` → sort -created is valid here.
  const statsRaw = await client.listRecords("system_stats", {
    filter: `type="1m"`,
    sort: "-created",
    perPage: 500,
    skipTotal: true,
  });
  const statsParsed = StatsListSchema.parse(statsRaw);

  const statsMap: Map<string, SystemStatsRecord> = new Map();
  for (const record of statsParsed.items) {
    if (!statsMap.has(record.system)) {
      statsMap.set(record.system, record);
    }
  }

  // smart_devices has NO `created` → sort by -updated.
  let diskMap: Map<string, SmartDeviceRecord[]> = new Map();
  if (opts.disks) {
    const SmartListSchema = PocketBaseListSchema(SmartDeviceRecordSchema);
    const smartRaw = await client.listRecords("smart_devices", {
      sort: "-updated",
      perPage: 500,
      skipTotal: true,
    });
    const smartParsed = SmartListSchema.parse(smartRaw);

    for (const record of smartParsed.items) {
      if (!record.system) continue;
      const existing = diskMap.get(record.system) ?? [];
      existing.push(record);
      diskMap.set(record.system, existing);
    }
  }

  const systems: TempInfo[] = allSystems.map((sysRecord) => {
    const statsRecord = statsMap.get(sysRecord.id) ?? null;
    const diskRecords = opts.disks ? (diskMap.get(sysRecord.id) ?? []) : undefined;

    return mapTempInfo(sysRecord.name, sysRecord, statsRecord, diskRecords);
  });

  return { systems };
}
