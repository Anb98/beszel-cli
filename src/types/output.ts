/**
 * output.ts — Canonical output types the CLI emits.
 *
 * These are the STABLE JSON contract shapes (REQ-3 through REQ-9).
 * Field names here are human-readable. The mapping from abbreviated upstream
 * keys to these names lives exclusively in src/mapping/key-map.ts (REQ-12).
 *
 * Stable-mandatory fields: always present (may be null if upstream is absent).
 * Optional fields: present only when the upstream snapshot includes the source key.
 */

// ---------------------------------------------------------------------------
// REQ-3: systems command output
// ---------------------------------------------------------------------------

/** One system in the fleet listing. */
export interface SystemItem {
  // --- stable-mandatory ---
  id: string;
  name: string;
  host: string | null;
  /** up | down | paused | pending */
  status: string;
  /** cpu% — null when upstream info is absent */
  cpu: number | null;
  /** mem% — null when upstream mp is absent */
  memPct: number | null;
  /** disk% — null when upstream dp is absent */
  diskPct: number | null;
  /** uptime in seconds — null when upstream u is absent */
  uptimeS: number | null;
  /** agent version string — null when upstream v is absent */
  agentVersion: string | null;
  // --- optional ---
  /** display temperature °C from systems.info.dt */
  tempC?: number;
  /** container count from systems.info.ct */
  containerCount?: number;
  /** load avg [1m, 5m, 15m] from systems.info.la */
  loadAvg?: number[];
  /** extra/RAID fs usage% map from systems.info.efs */
  extraFs?: Record<string, number>;
}

export interface SystemsOutput {
  systems: SystemItem[];
}

// ---------------------------------------------------------------------------
// REQ-4: system <name> command output
// ---------------------------------------------------------------------------

/** Detailed system info (merged snapshot + system_details). */
export interface SystemDetail {
  // from systems record
  id: string;
  name: string;
  host: string | null;
  status: string;
  cpu: number | null;
  memPct: number | null;
  diskPct: number | null;
  uptimeS: number | null;
  agentVersion: string | null;
  // optional snapshot fields
  tempC?: number;
  containerCount?: number;
  loadAvg?: number[];
  extraFs?: Record<string, number>;
}

/** Hardware/OS detail from system_details collection. */
export interface SystemDetailsInfo {
  hostname: string | null;
  /** OS name string, e.g. "Alpine Linux" */
  os: string | null;
  kernel: string | null;
  /** CPU model string */
  cpuModel: string | null;
  arch: string | null;
  cores: number | null;
  threads: number | null;
  /** total memory bytes */
  memoryBytes: number | null;
  /** true when container runtime is Podman */
  podman?: boolean;
}

export interface SystemOutput {
  system: SystemDetail;
  /** null when system_details record is absent for this host */
  details: SystemDetailsInfo | null;
}

// ---------------------------------------------------------------------------
// REQ-5: containers command output
// ---------------------------------------------------------------------------

export interface ContainerInfo {
  // --- stable ---
  name: string;
  /** parent system name */
  system: string;
  status: string | null;
  /**
   * Health status code — NUMBER (e.g. 0).
   * Bug fix: was incorrectly typed as string; Beszel returns a numeric health
   * code. See upstream.ts ContainerRecordSchema fix (2026-06-24).
   */
  health: number | null;
  /** cpu% */
  cpuPct: number | null;
  /** mem MB */
  memMB: number | null;
  image: string | null;
  // --- optional ---
  ports?: string;
}

export interface ContainersOutput {
  containers: ContainerInfo[];
}

// ---------------------------------------------------------------------------
// REQ-6: disks command output
// ---------------------------------------------------------------------------

/** Physical SMART disk (type: sat | nvme | scsi). */
export interface DiskInfo {
  kind: "disk";
  name: string;
  system: string;
  /** PASSED | FAILED */
  state: string | null;
  model: string | null;
  /** temperature °C */
  tempC: number | null;
  capacityBytes: number | null;
  /** sat | nvme | scsi */
  type: string | null;
  // optional
  serial?: string;
  firmware?: string;
  hours?: number;
  cycles?: number;
}

/** md-RAID array (type: mdraid). */
export interface RaidInfo {
  kind: "raid";
  name: string;
  system: string;
  /** PASSED | FAILED (overall SMART state) */
  state: string | null;
  /** e.g. raid5 */
  raidLevel: string | null;
  /** clean | degraded | inactive | failed */
  arrayState: string | null;
  raidDisks: number | null;
  /** idle | resync | recover | check | repair | reshape */
  syncAction: string | null;
}

export type DeviceInfo = DiskInfo | RaidInfo;

export interface DisksOutput {
  devices: DeviceInfo[];
}

// ---------------------------------------------------------------------------
// REQ-7: temps command output
// ---------------------------------------------------------------------------

export interface TempInfo {
  /** system name */
  system: string;
  /** from systems.info.dt */
  displayTempC: number | null;
  /** from system_stats.stats.t (1m bucket); merged with disk temps when --disks */
  sensors: Record<string, number>;
}

export interface TempsOutput {
  systems: TempInfo[];
}

// ---------------------------------------------------------------------------
// REQ-8: health command output
// ---------------------------------------------------------------------------

export type IssueSeverity = "crit" | "warn";
export type IssueKind = "down" | "smart" | "raid" | "disk" | "temp";

export interface HealthIssue {
  system: string;
  severity: IssueSeverity;
  kind: IssueKind;
  detail: string;
}

export interface HealthReport {
  healthy: boolean;
  issues: HealthIssue[];
  checked: number;
}

// ---------------------------------------------------------------------------
// REQ-9: historical --since query envelope
// ---------------------------------------------------------------------------

/**
 * Wraps time-series output when --since is passed.
 * Commands that support --since wrap their payload in this shape.
 */
export interface HistoricalEnvelope<T> {
  /** selected interval bucket: 1m | 10m | 20m | 120m | 480m */
  interval: string;
  /** ISO 8601 start of window */
  from: string;
  /** ISO 8601 end of window (now) */
  to: string;
  /** ordered data points */
  points: T[];
}

// ---------------------------------------------------------------------------
// Error envelope (cross-cutting)
// ---------------------------------------------------------------------------

export interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    hint: string;
  };
}
