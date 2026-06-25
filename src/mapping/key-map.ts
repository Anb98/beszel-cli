/**
 * key-map.ts — THE SINGLE MODULE translating abbreviated upstream keys to
 * canonical output field names.
 *
 * REQ-12: This is the ONLY file that may contain abbreviated upstream key
 * string literals (mp, dp, dt, u, la, efs, ct, v, c, m, n, b, t, mu, du,
 * dw, mb, etc.). All other source files reference canonical names only.
 *
 * Provenance comments cite: live recon (#472), Beszel agents v0.18.7.
 * Keys marked "undocumented" were discovered empirically — no public API doc.
 */

import type {
  SystemRecord,
  SystemStatsRecord,
  ContainerRecord,
  ContainerStatsItem,
  SmartDeviceRecord,
  SystemDetailsRecord,
} from "../types/upstream.js";
import type {
  SystemItem,
  SystemDetail,
  SystemDetailsInfo,
  ContainerInfo,
  DiskInfo,
  RaidInfo,
  DeviceInfo,
  TempInfo,
} from "../types/output.js";

type RaidAttributes = {
  arrayState: string | null;
  raidLevel: string | null;
  raidDisks: number | null;
  syncAction: string | null;
};

/**
 * Parse the `attributes` array of a smart_device mdraid record into named
 * fields. Attribute names: ArrayState, RaidLevel, RaidDisks, SyncAction.
 * Values come from `rs` (string) or `rv` (number).
 *
 * provenance: undocumented; discovered via live recon (#472) v0.18.7
 */
function extractRaidAttributes(
  attributes: SmartDeviceRecord["attributes"]
): RaidAttributes {
  const result: RaidAttributes = {
    arrayState: null,
    raidLevel: null,
    raidDisks: null,
    syncAction: null,
  };

  if (!attributes) return result;

  for (const attr of attributes) {
    switch (attr.n) {
      case "ArrayState": // provenance: live recon (#472)
        result.arrayState =
          typeof attr.rs === "string" ? attr.rs : String(attr.rs ?? "");
        break;
      case "RaidLevel": // provenance: live recon (#472)
        result.raidLevel =
          typeof attr.rs === "string" ? attr.rs : String(attr.rs ?? "");
        break;
      case "RaidDisks": // provenance: live recon (#472)
        result.raidDisks =
          typeof attr.rv === "number"
            ? attr.rv
            : typeof attr.rv === "string"
              ? parseInt(attr.rv, 10) || null
              : null;
        break;
      case "SyncAction": // provenance: live recon (#472)
        result.syncAction =
          typeof attr.rs === "string" ? attr.rs : String(attr.rs ?? "");
        break;
      // SyncCompleted and SyncSpeed are not mapped to output (informational only)
    }
  }

  return result;
}

/**
 * Maps an upstream systems record (abbreviated keys) to a canonical SystemItem.
 *
 * Abbreviated key mapping (provenance: undocumented; live recon #472 v0.18.7):
 *   info.cpu → cpu%
 *   info.mp  → memPct          (undocumented)
 *   info.dp  → diskPct         (undocumented)
 *   info.u   → uptimeS         (undocumented)
 *   info.v   → agentVersion    (undocumented)
 *   info.dt  → displayTempC    (undocumented)
 *   info.la  → loadAvg [3]     (undocumented)
 *   info.ct  → containerCount  (undocumented)
 *   info.efs → extraFs {fs:pct}(undocumented, includes md-RAID fs usage)
 *
 * Stable-mandatory fields absent in upstream → null (not omitted).
 * Optional fields absent in upstream → key omitted from output.
 */
export function mapSystem(record: SystemRecord): SystemItem {
  const info = record.info ?? {};

  const item: SystemItem = {
    id: record.id,
    name: record.name,
    host: record.host ?? null,
    status: record.status as import("../types/output.js").SystemStatus,
    // stable-mandatory: null when absent
    cpu: info.cpu ?? null,        // info.cpu → cpu% (provenance: live recon #472)
    memPct: info.mp ?? null,      // info.mp  → memPct (undocumented; live recon #472)
    diskPct: info.dp ?? null,     // info.dp  → diskPct (undocumented; live recon #472)
    uptimeS: info.u ?? null,      // info.u   → uptimeS (undocumented; live recon #472)
    agentVersion: info.v ?? null, // info.v   → agentVersion (undocumented; live recon #472)
  };

  if (info.dt !== undefined) {
    item.tempC = info.dt; // info.dt → displayTempC (undocumented; live recon #472)
  }
  if (info.ct !== undefined) {
    item.containerCount = info.ct; // info.ct → containerCount (undocumented; live recon #472)
  }
  if (info.la !== undefined) {
    item.loadAvg = info.la; // info.la → loadAvg [1m,5m,15m] (undocumented; live recon #472)
  }
  if (info.efs !== undefined) {
    item.extraFs = info.efs; // info.efs → extraFs {fs:pct} (undocumented; live recon #472)
  }

  return item;
}

export function mapSystemDetail(record: SystemRecord): SystemDetail {
  return mapSystem(record);
}

export function mapSystemDetailsInfo(
  record: SystemDetailsRecord
): SystemDetailsInfo {
  const info: SystemDetailsInfo = {
    hostname: record.hostname ?? null,
    os: record.os_name ?? null,
    kernel: record.kernel ?? null,
    cpuModel: record.cpu ?? null,
    arch: record.arch ?? null,
    cores: record.cores ?? null,
    threads: record.threads ?? null,
    memoryBytes: record.memory ?? null,
  };

  if (record.podman !== undefined) {
    info.podman = record.podman;
  }

  return info;
}

/**
 * Maps a containers record to ContainerInfo.
 *
 * The containers collection uses READABLE field names (not abbreviated),
 * verified via live recon (#472). The `memory` field is stored as MB.
 */
export function mapContainer(
  record: ContainerRecord,
  systemName: string
): ContainerInfo {
  const info: ContainerInfo = {
    name: record.name,
    system: systemName,
    status: record.status ?? null,
    health: record.health ?? null,
    cpuPct: record.cpu ?? null,
    memMB: record.memory ?? null,
    image: record.image ?? null,
  };

  if (record.ports !== undefined) {
    info.ports = record.ports;
  }

  return info;
}

/**
 * Maps system_stats.stats abbreviated fields to canonical names.
 *
 * Abbreviated key mapping (provenance: undocumented; live recon #472 v0.18.7):
 *   stats.cpu → cpu%
 *   stats.m   → memTotalGB
 *   stats.mu  → memUsedGB
 *   stats.mp  → memPct
 *   stats.mb  → memBufCacheGB
 *   stats.d   → diskTotalGB
 *   stats.du  → diskUsedGB
 *   stats.dp  → diskPct
 *   stats.dw  → diskWrite
 *   stats.t   → sensors {sensorName: °C}  (MAP not array; live recon #472)
 *   stats.b   → net [rx, tx]
 *   stats.la  → loadAvg [1m, 5m, 15m]
 *   stats.s   → swap
 */
export type MappedSystemStats = {
  cpu: number | null;
  memTotalGB: number | null;
  memUsedGB: number | null;
  memPct: number | null;
  memBufCacheGB: number | null;
  diskTotalGB: number | null;
  diskUsedGB: number | null;
  diskPct: number | null;
  diskWrite: number | null;
  /** sensor name → °C map; empty object when absent */
  sensors: Record<string, number>;
  net: number[] | null;
  loadAvg: number[] | null;
  swap: number | null;
};

export function mapSystemStats(record: SystemStatsRecord): MappedSystemStats {
  const s = record.stats ?? {};

  return {
    cpu: s.cpu ?? null,          // stats.cpu → cpu% (live recon #472)
    memTotalGB: s.m ?? null,     // stats.m   → memTotalGB (undocumented; live recon #472)
    memUsedGB: s.mu ?? null,     // stats.mu  → memUsedGB (undocumented; live recon #472)
    memPct: s.mp ?? null,        // stats.mp  → memPct (undocumented; live recon #472)
    memBufCacheGB: s.mb ?? null, // stats.mb  → memBufCacheGB (undocumented; live recon #472)
    diskTotalGB: s.d ?? null,    // stats.d   → diskTotalGB (undocumented; live recon #472)
    diskUsedGB: s.du ?? null,    // stats.du  → diskUsedGB (undocumented; live recon #472)
    diskPct: s.dp ?? null,       // stats.dp  → diskPct (undocumented; live recon #472)
    diskWrite: s.dw ?? null,     // stats.dw  → diskWrite (undocumented; live recon #472)
    sensors: s.t ?? {},          // stats.t   → sensors map (NOT array; live recon #472)
    net: s.b ?? null,            // stats.b   → net [rx, tx] (undocumented; live recon #472)
    loadAvg: s.la ?? null,       // stats.la  → loadAvg [1m,5m,15m] (undocumented; live recon #472)
    swap: s.s ?? null,           // stats.s   → swap (undocumented; live recon #472)
  };
}

/**
 * Maps one item from container_stats.stats[] to a named output shape.
 *
 * Abbreviated key mapping (provenance: undocumented; live recon #472 v0.18.7):
 *   n → name
 *   c → cpuPct
 *   m → memMB
 *   b → net [rx, tx]
 */
export type ContainerStatsOutput = {
  name: string | null;
  cpuPct: number | null;
  memMB: number | null;
  net: number[] | null;
};

export function mapContainerStatsItem(
  item: ContainerStatsItem
): ContainerStatsOutput {
  return {
    name: item.n ?? null,   // n → name (undocumented; live recon #472)
    cpuPct: item.c ?? null, // c → cpuPct (undocumented; live recon #472)
    memMB: item.m ?? null,  // m → memMB (undocumented; live recon #472)
    net: item.b ?? null,    // b → net [rx, tx] (undocumented; live recon #472)
  };
}

/**
 * Maps a smart_devices record to either a DiskInfo or RaidInfo depending on
 * the `type` field.
 *
 * type = "mdraid" → RaidInfo (parse attributes array for RAID metadata)
 * type ∈ "sat"|"nvme"|"scsi" → DiskInfo
 *
 * provenance: undocumented; discovered via live recon (#472) v0.18.7
 *   smart_devices.temp  → tempC °C
 *   smart_devices.capacity → capacityBytes
 *   mdraid attributes: ArrayState(rs) / RaidLevel(rs) / RaidDisks(rv) / SyncAction(rs)
 */
export function mapSmartDevice(
  record: SmartDeviceRecord,
  systemName: string
): DeviceInfo {
  if (record.type === "mdraid") {
    const attrs = extractRaidAttributes(record.attributes);

    return {
      kind: "raid",
      name: record.name,
      system: systemName,
      state: record.state ?? null,
      raidLevel: attrs.raidLevel,
      arrayState: attrs.arrayState,
      raidDisks: attrs.raidDisks,
      syncAction: attrs.syncAction,
    } satisfies RaidInfo;
  }

  const disk: DiskInfo = {
    kind: "disk",
    name: record.name,
    system: systemName,
    state: record.state ?? null,
    model: record.model ?? null,
    tempC: record.temp ?? null,        // smart_devices.temp → tempC (live recon #472)
    capacityBytes: record.capacity ?? null, // smart_devices.capacity → capacityBytes (live recon #472)
    type: record.type ?? null,
  };

  if (record.serial !== undefined) disk.serial = record.serial;
  if (record.firmware !== undefined) disk.firmware = record.firmware;
  if (record.hours !== undefined) disk.hours = record.hours;
  if (record.cycles !== undefined) disk.cycles = record.cycles;

  return disk;
}

/**
 * Produces a TempInfo for a system using:
 *   - displayTempC from systems.info.dt (undocumented; live recon #472)
 *   - sensors from system_stats.stats.t (sensor map; live recon #472)
 * Optionally merges disk temps from smart_devices.temp.
 */
export function mapTempInfo(
  systemName: string,
  systemRecord: SystemRecord,
  statsRecord: SystemStatsRecord | null,
  diskRecords?: SmartDeviceRecord[]
): TempInfo {
  const displayTempC = systemRecord.info?.dt ?? null;
  const sensors: Record<string, number> = statsRecord?.stats?.t ?? {};

  if (diskRecords) {
    for (const disk of diskRecords) {
      if (disk.temp !== undefined && disk.type !== "mdraid") {
        const base = disk.name.replace(/^\/dev\//, "").replace(/[^a-zA-Z0-9]/g, "_");
        sensors[`${base}_temp`] = disk.temp; // smart_devices.temp (live recon #472)
      }
    }
  }

  return {
    system: systemName,
    displayTempC,
    sensors,
  };
}
