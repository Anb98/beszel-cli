/**
 * upstream.ts — Zod schemas mirroring real Beszel PocketBase collections.
 *
 * AUTHORITATIVE shapes from live recon (sdd/beszel-query-cli/live-schema #472),
 * Beszel agents v0.18.7. All schemas use z.looseObject() (Zod 4 idiom) so that
 * unknown upstream fields never cause parse failures (REQ-10 schema resilience).
 * Abbreviated keys are used here intentionally — key-map.ts is the ONLY place
 * that translates them to canonical output names (REQ-12).
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

/**
 * PocketBase standard autodate string (ISO 8601).
 * Present on systems, system_stats, smart_devices, system_details.
 */
const AutoDateSchema = z.string();

/**
 * Unix-millisecond timestamp (number).
 * Present on containers and systemd_services as the `updated` field.
 */
const UnixMsSchema = z.number();

// ---------------------------------------------------------------------------
// systems.info snapshot — abbreviated keys from live recon v0.18.7
// provenance: undocumented; discovered via live recon (#472)
// ---------------------------------------------------------------------------

export const SystemInfoSchema = z.looseObject({
  /** cpu% */ cpu: z.number().optional(),
  /** mem% */ mp: z.number().optional(),
  /** disk% */ dp: z.number().optional(),
  /** uptime seconds */ u: z.number().optional(),
  /** agent version string */ v: z.string().optional(),
  /** display temperature °C */ dt: z.number().optional(),
  /** load avg [1m, 5m, 15m] */ la: z.array(z.number()).optional(),
  /** container count */ ct: z.number().optional(),
  /** extra/RAID filesystems usage% map: {fsName: pct} */ efs: z
    .record(z.string(), z.number())
    .optional(),
  /** unknown field seen on some agents — possibly mem MB */ bb: z
    .unknown()
    .optional(),
  /** temp count? — seen as 4 on some hosts */ t: z.unknown().optional(),
});

export type SystemInfo = z.infer<typeof SystemInfoSchema>;

export const SystemRecordSchema = z.looseObject({
  id: z.string(),
  name: z.string(),
  /** PocketBase collection link — system host identifier */ host: z
    .string()
    .optional(),
  /** up | down | paused | pending */ status: z.string(),
  /** raw info snapshot containing abbreviated metric keys */ info: SystemInfoSchema.optional(),
  created: AutoDateSchema.optional(),
  updated: AutoDateSchema.optional(),
});

export type SystemRecord = z.infer<typeof SystemRecordSchema>;

// ---------------------------------------------------------------------------
// system_stats — per-interval time-series (type ∈ 1m|10m|20m|120m|480m)
// provenance: undocumented; discovered via live recon (#472)
// ---------------------------------------------------------------------------

/**
 * Per-sensor temperature map: {sensorName: celsius}
 * e.g. {cpu_thermal: 52, ddr_thermal: 40, gpu_thermal: 38, ve_thermal: 41}
 * NOTE: This is a MAP not an array (corrects early explore artifact).
 */
const SensorMapSchema = z.record(z.string(), z.number());

export const SystemStatsStatsSchema = z.looseObject({
  /** cpu% */ cpu: z.number().optional(),
  /** mem total GB */ m: z.number().optional(),
  /** mem used GB */ mu: z.number().optional(),
  /** mem% */ mp: z.number().optional(),
  /** mem buffer/cache GB */ mb: z.number().optional(),
  /** swap */ s: z.number().optional(),
  /** disk total GB */ d: z.number().optional(),
  /** disk used GB */ du: z.number().optional(),
  /** disk% */ dp: z.number().optional(),
  /** disk write */ dw: z.number().optional(),
  /** sensors map {sensorName: °C} */ t: SensorMapSchema.optional(),
  /** network [rx, tx] */ b: z.array(z.number()).optional(),
  /** load avg [1m, 5m, 15m] */ la: z.array(z.number()).optional(),
  /** network interfaces {iface: [4]} */ ni: z
    .record(z.string(), z.array(z.number()))
    .optional(),
  /** disk I/O [read, write] */ dio: z.array(z.number()).optional(),
  /** per-core cpu usage */ cpub: z.array(z.number()).optional(),
  /** cpu supplemental [4] */ cpus: z.array(z.number()).optional(),
  /** disk I/O supplemental [6] */ dios: z.array(z.number()).optional(),
});

export type SystemStatsStats = z.infer<typeof SystemStatsStatsSchema>;

export const SystemStatsRecordSchema = z.looseObject({
  id: z.string(),
  /** associated system id */ system: z.string(),
  /** interval bucket: 1m | 10m | 20m | 120m | 480m */ type: z.string(),
  stats: SystemStatsStatsSchema.optional(),
  created: AutoDateSchema.optional(),
  updated: AutoDateSchema.optional(),
});

export type SystemStatsRecord = z.infer<typeof SystemStatsRecordSchema>;

// ---------------------------------------------------------------------------
// container_stats — per-system-per-interval array of container metrics
// provenance: undocumented; discovered via live recon (#472)
// ---------------------------------------------------------------------------

/**
 * One container's stats snapshot within the array.
 * n=name, c=cpu%, m=memMB, b=[rxBytes,txBytes]
 */
export const ContainerStatsItemSchema = z.looseObject({
  /** container name */ n: z.string().optional(),
  /** cpu% */ c: z.number().optional(),
  /** mem MB */ m: z.number().optional(),
  /** net [rx, tx] */ b: z.array(z.number()).optional(),
});

export type ContainerStatsItem = z.infer<typeof ContainerStatsItemSchema>;

export const ContainerStatsRecordSchema = z.looseObject({
  id: z.string(),
  /** associated system id */ system: z.string(),
  /** interval bucket: 1m | 10m | 20m | 120m | 480m */ type: z.string(),
  /** array of per-container snapshots */ stats: z
    .array(ContainerStatsItemSchema)
    .optional(),
  created: AutoDateSchema.optional(),
  updated: AutoDateSchema.optional(),
});

export type ContainerStatsRecord = z.infer<typeof ContainerStatsRecordSchema>;

// ---------------------------------------------------------------------------
// containers — live container list (server-sortable by cpu, memory)
// provenance: verified via live recon (#472); totalItems=50 on test instance
// ---------------------------------------------------------------------------

export const ContainerRecordSchema = z.looseObject({
  id: z.string(),
  name: z.string(),
  /** "Up 2 days" style string */ status: z.string().optional(),
  health: z.string().optional(),
  /** cpu% */ cpu: z.number().optional(),
  /** mem MB */ memory: z.number().optional(),
  /** net */ net: z.unknown().optional(),
  image: z.string().optional(),
  ports: z.string().optional(),
  /** parent system id */ system: z.string().optional(),
  /** unix-ms number on containers */ updated: UnixMsSchema.optional(),
});

export type ContainerRecord = z.infer<typeof ContainerRecordSchema>;

// ---------------------------------------------------------------------------
// smart_devices — physical disks AND md-RAID arrays
// provenance: verified via live recon (#472); totalItems=12 on test instance
// ---------------------------------------------------------------------------

/**
 * RAID mdraid attribute entry.
 * n = attribute name (ArrayState | RaidLevel | RaidDisks | SyncAction | SyncCompleted | SyncSpeed)
 * rs = string value, rv = numeric value
 */
export const SmartAttributeSchema = z.looseObject({
  n: z.string(),
  rs: z.string().optional(),
  rv: z.union([z.number(), z.string()]).optional(),
});

export type SmartAttribute = z.infer<typeof SmartAttributeSchema>;

export const SmartDeviceRecordSchema = z.looseObject({
  id: z.string(),
  name: z.string(),
  model: z.string().optional(),
  serial: z.string().optional(),
  firmware: z.string().optional(),
  /** PASSED | FAILED */ state: z.string().optional(),
  /** temperature °C */ temp: z.number().optional(),
  /** sat | nvme | scsi | mdraid */ type: z.string().optional(),
  /** power-on hours */ hours: z.number().optional(),
  /** power cycles */ cycles: z.number().optional(),
  /** capacity bytes */ capacity: z.number().optional(),
  /** RAID/SMART attributes array */ attributes: z
    .array(SmartAttributeSchema)
    .optional(),
  /** associated system id */ system: z.string().optional(),
  /** autodate string on smart_devices */ updated: AutoDateSchema.optional(),
});

export type SmartDeviceRecord = z.infer<typeof SmartDeviceRecordSchema>;

// ---------------------------------------------------------------------------
// system_details — one record per system (id == system id)
// provenance: verified via live recon (#472)
// ---------------------------------------------------------------------------

export const SystemDetailsRecordSchema = z.looseObject({
  id: z.string(),
  hostname: z.string().optional(),
  /** e.g. "Alpine Linux" */ os_name: z.string().optional(),
  kernel: z.string().optional(),
  /** CPU model string */ cpu: z.string().optional(),
  arch: z.string().optional(),
  cores: z.number().optional(),
  threads: z.number().optional(),
  /** total memory bytes */ memory: z.number().optional(),
  podman: z.boolean().optional(),
  /** autodate string */ updated: AutoDateSchema.optional(),
});

export type SystemDetailsRecord = z.infer<typeof SystemDetailsRecordSchema>;

// ---------------------------------------------------------------------------
// systemd_services — EMPTY on Alpine/OpenRC hosts; CLI must handle gracefully
// provenance: verified via live recon (#472); totalItems=0 on test instance
// ---------------------------------------------------------------------------

export const SystemdServiceRecordSchema = z.looseObject({
  id: z.string(),
  name: z.string().optional(),
  status: z.string().optional(),
  /** unix-ms number on systemd_services */ updated: UnixMsSchema.optional(),
});

export type SystemdServiceRecord = z.infer<typeof SystemdServiceRecordSchema>;

// ---------------------------------------------------------------------------
// PocketBase list response envelope (generic)
// ---------------------------------------------------------------------------

export const PocketBaseListSchema = <T extends z.ZodTypeAny>(itemSchema: T) =>
  z.looseObject({
    page: z.number(),
    perPage: z.number(),
    totalItems: z.number(),
    totalPages: z.number(),
    items: z.array(itemSchema),
  });

export type PocketBaseList<T> = {
  page: number;
  perPage: number;
  totalItems: number;
  totalPages: number;
  items: T[];
};
