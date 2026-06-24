/**
 * disks.ts — Fetch smart_devices for a system (or fleet), map to DeviceInfo[].
 *
 * REQ-6: unified DiskInfo / RaidInfo discriminated union.
 *   kind:"disk" — physical SMART devices (sat | nvme | scsi).
 *   kind:"raid" — md-RAID arrays (type==mdraid), with RAID attributes.
 *
 * --failing filter: state != "PASSED" (disks) OR arrayState != "clean" OR
 *   syncAction != "idle" (raid) — per design R1.
 *
 * CRITICAL gotcha (live recon #472):
 *   smart_devices has NO `created` field → sort by `updated` (autodate string).
 *   NEVER sort by -created on this collection → HTTP 400.
 *
 * This module is Ink-free (REQ-2 boundary).
 */

import type { BeszelClient } from "../client/beszelClient.js";
import { mapSmartDevice } from "../mapping/key-map.js";
import type { DeviceInfo, DisksOutput, DiskInfo, RaidInfo } from "../types/output.js";
import {
  PocketBaseListSchema,
  SmartDeviceRecordSchema,
  SystemRecordSchema,
} from "../types/upstream.js";
import { CliError } from "../types/errors.js";

// ---------------------------------------------------------------------------
// DisksOptions
// ---------------------------------------------------------------------------

export interface DisksOptions {
  /** Filter to one system by name or id. When absent, queries the entire fleet. */
  system?: string;
  /** Filter to failing devices only (disk: state!="PASSED"; raid: not clean+idle). */
  failing?: boolean;
}

// ---------------------------------------------------------------------------
// isFailing — determine whether a mapped DeviceInfo is failing
// ---------------------------------------------------------------------------

/**
 * A device is "failing" when:
 *   - kind:"disk" → state != "PASSED" (or null → treat as unknown → failing)
 *   - kind:"raid" → arrayState != "clean" OR syncAction != "idle"
 *
 * Design R1: degraded raid is CRITICAL regardless of SMART `state`.
 */
function isFailing(device: DeviceInfo): boolean {
  if (device.kind === "disk") {
    const d = device as DiskInfo;
    return d.state !== "PASSED";
  } else {
    const r = device as RaidInfo;
    return r.arrayState !== "clean" || r.syncAction !== "idle";
  }
}

// ---------------------------------------------------------------------------
// resolveSystemId — name/id → system id (for server-side filter)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// fetchDisks — public API
// ---------------------------------------------------------------------------

/**
 * Fetch smart_devices for the fleet (or a single system), map to DeviceInfo[].
 *
 * @param client - An authenticated BeszelClient.
 * @param opts - system filter and failing flag.
 * @returns DisksOutput with a devices array; empty = no devices (never error).
 */
export async function fetchDisks(
  client: BeszelClient,
  opts: DisksOptions = {},
): Promise<DisksOutput> {
  const ListSchema = PocketBaseListSchema(SmartDeviceRecordSchema);

  // Build filter and system name map for mapSmartDevice().
  let filterParts: string[] = [];
  let systemNameMap: Map<string, string> = new Map();

  if (opts.system !== undefined) {
    const { id, name } = await resolveSystemId(client, opts.system);
    filterParts.push(`system="${id}"`);
    systemNameMap.set(id, name);
  } else {
    // Fleet mode: fetch system names for labelling.
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

  // Sort by -updated (smart_devices has NO created field → NEVER sort by -created).
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

  // Apply --failing filter client-side.
  if (opts.failing) {
    devices = devices.filter(isFailing);
  }

  return { devices };
}
