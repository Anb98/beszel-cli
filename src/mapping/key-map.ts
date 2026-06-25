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

// Beszel uses undocumented abbreviated keys (mp, dp, dt, u, la, efs, ct, v, etc.).
// This is the only module that maps them to canonical output names.

type RaidAttributes = {
  arrayState: string | null;
  raidLevel: string | null;
  raidDisks: number | null;
  syncAction: string | null;
};

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
      case "ArrayState": // undocumented Beszel field
        result.arrayState =
          typeof attr.rs === "string" ? attr.rs : String(attr.rs ?? "");
        break;
      case "RaidLevel": // undocumented Beszel field
        result.raidLevel =
          typeof attr.rs === "string" ? attr.rs : String(attr.rs ?? "");
        break;
      case "RaidDisks": // undocumented Beszel field
        result.raidDisks =
          typeof attr.rv === "number"
            ? attr.rv
            : typeof attr.rv === "string"
              ? parseInt(attr.rv, 10) || null
              : null;
        break;
      case "SyncAction": // undocumented Beszel field
        result.syncAction =
          typeof attr.rs === "string" ? attr.rs : String(attr.rs ?? "");
        break;
      // SyncCompleted and SyncSpeed are not mapped to output (informational only)
    }
  }

  return result;
}

export function mapSystem(record: SystemRecord): SystemItem {
  const info = record.info ?? {};

  const item: SystemItem = {
    id: record.id,
    name: record.name,
    host: record.host ?? null,
    status: record.status as import("../types/output.js").SystemStatus,
    // stable-mandatory: null when absent
    cpu: info.cpu ?? null,        // info.cpu → cpu%
    memPct: info.mp ?? null,      // info.mp  → memPct (undocumented Beszel field)
    diskPct: info.dp ?? null,     // info.dp  → diskPct (undocumented Beszel field)
    uptimeS: info.u ?? null,      // info.u   → uptimeS (undocumented Beszel field)
    agentVersion: info.v ?? null, // info.v   → agentVersion (undocumented Beszel field)
  };

  if (info.dt !== undefined) {
    item.tempC = info.dt; // info.dt → displayTempC (undocumented Beszel field)
  }
  if (info.ct !== undefined) {
    item.containerCount = info.ct; // info.ct → containerCount (undocumented Beszel field)
  }
  if (info.la !== undefined) {
    item.loadAvg = info.la; // info.la → loadAvg [1m,5m,15m] (undocumented Beszel field)
  }
  if (info.efs !== undefined) {
    item.extraFs = info.efs; // info.efs → extraFs {fs:pct} (undocumented Beszel field)
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
    cpu: s.cpu ?? null,          // stats.cpu → cpu%
    memTotalGB: s.m ?? null,     // stats.m   → memTotalGB (undocumented Beszel field)
    memUsedGB: s.mu ?? null,     // stats.mu  → memUsedGB (undocumented Beszel field)
    memPct: s.mp ?? null,        // stats.mp  → memPct (undocumented Beszel field)
    memBufCacheGB: s.mb ?? null, // stats.mb  → memBufCacheGB (undocumented Beszel field)
    diskTotalGB: s.d ?? null,    // stats.d   → diskTotalGB (undocumented Beszel field)
    diskUsedGB: s.du ?? null,    // stats.du  → diskUsedGB (undocumented Beszel field)
    diskPct: s.dp ?? null,       // stats.dp  → diskPct (undocumented Beszel field)
    diskWrite: s.dw ?? null,     // stats.dw  → diskWrite (undocumented Beszel field)
    sensors: s.t ?? {},          // stats.t   → sensors map (NOT array; undocumented Beszel field)
    net: s.b ?? null,            // stats.b   → net [rx, tx] (undocumented Beszel field)
    loadAvg: s.la ?? null,       // stats.la  → loadAvg [1m,5m,15m] (undocumented Beszel field)
    swap: s.s ?? null,           // stats.s   → swap (undocumented Beszel field)
  };
}

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
    name: item.n ?? null,   // n → name (undocumented Beszel field)
    cpuPct: item.c ?? null, // c → cpuPct (undocumented Beszel field)
    memMB: item.m ?? null,  // m → memMB (undocumented Beszel field)
    net: item.b ?? null,    // b → net [rx, tx] (undocumented Beszel field)
  };
}

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
    tempC: record.temp ?? null,        // smart_devices.temp → tempC (undocumented Beszel field)
    capacityBytes: record.capacity ?? null, // smart_devices.capacity → capacityBytes (undocumented Beszel field)
    type: record.type ?? null,
  };

  if (record.serial !== undefined) disk.serial = record.serial;
  if (record.firmware !== undefined) disk.firmware = record.firmware;
  if (record.hours !== undefined) disk.hours = record.hours;
  if (record.cycles !== undefined) disk.cycles = record.cycles;

  return disk;
}

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
        sensors[`${base}_temp`] = disk.temp; // smart_devices.temp (undocumented Beszel field)
      }
    }
  }

  return {
    system: systemName,
    displayTempC,
    sensors,
  };
}
