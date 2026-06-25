export type SystemStatus = "up" | "down" | "paused" | "pending";

/** Discriminant for the DiskInfo / RaidInfo union. */
export type DeviceKind = "disk" | "raid";

/** Health issue severity level. */
export type HealthSeverity = "crit" | "warn";

/** Health issue category. */
export type HealthKind = "down" | "smart" | "raid" | "disk" | "temp";

/** Stat retention bucket intervals. */
export type StatsInterval = "1m" | "10m" | "20m" | "120m" | "480m";

/**
 * SMART overall state string from Beszel.
 * Known values + open union so new values from future agent releases pass through
 * without breaking the schema.
 */
export type SmartState = "PASSED" | "FAILED" | "UNKNOWN" | (string & {});

/**
 * Physical disk protocol type from Beszel smart_devices.type.
 * Open union — Beszel may add new types across versions.
 */
export type DiskType = "sat" | "nvme" | "scsi" | "emmc" | "mdraid" | (string & {});

/**
 * md-RAID array state string from ArrayState attribute.
 * Open union — Beszel may add new states across versions.
 */
export type RaidArrayState = "clean" | "degraded" | "failed" | "inactive" | "write-pending" | (string & {});

/**
 * md-RAID sync action string from SyncAction attribute.
 * Open union — Beszel may add new actions across versions.
 */
export type RaidSyncAction = "idle" | "resync" | "recover" | "recovery" | "check" | "repair" | "reshape" | (string & {});

/** One system in the fleet listing. */
export type SystemItem = {
  // --- stable-mandatory ---
  id: string;
  name: string;
  host: string | null;
  status: SystemStatus;
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
};

export type SystemsOutput = {
  systems: SystemItem[];
};

/** Detailed system info (merged snapshot + system_details). */
export type SystemDetail = {
  // from systems record
  id: string;
  name: string;
  host: string | null;
  status: SystemStatus;
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
};

/** Hardware/OS detail from system_details collection. */
export type SystemDetailsInfo = {
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
};

export type SystemOutput = {
  system: SystemDetail;
  /** null when system_details record is absent for this host */
  details: SystemDetailsInfo | null;
};

export type ContainerInfo = {
  // --- stable ---
  name: string;
  /** parent system name */
  system: string;
  status: string | null;
  /**
   * Health status code — NUMBER (e.g. 0).
   * Beszel returns a numeric health code, not a string.
   */
  health: number | null;
  /** cpu% */
  cpuPct: number | null;
  /** mem MB */
  memMB: number | null;
  image: string | null;
  // --- optional ---
  ports?: string;
};

export type ContainersOutput = {
  containers: ContainerInfo[];
};

/** Physical SMART disk (type: sat | nvme | scsi). */
export type DiskInfo = {
  kind: "disk";
  name: string;
  system: string;
  state: SmartState | null;
  model: string | null;
  /** temperature °C */
  tempC: number | null;
  capacityBytes: number | null;
  type: DiskType | null;
  // optional
  serial?: string;
  firmware?: string;
  hours?: number;
  cycles?: number;
};

/** md-RAID array (type: mdraid). */
export type RaidInfo = {
  kind: "raid";
  name: string;
  system: string;
  state: SmartState | null;
  /** e.g. raid5 */
  raidLevel: string | null;
  arrayState: RaidArrayState | null;
  raidDisks: number | null;
  syncAction: RaidSyncAction | null;
};

export type DeviceInfo = DiskInfo | RaidInfo;

export type DisksOutput = {
  devices: DeviceInfo[];
};

export type TempInfo = {
  /** system name */
  system: string;
  /** from systems.info.dt */
  displayTempC: number | null;
  /** from system_stats.stats.t (1m bucket); merged with disk temps when --disks */
  sensors: Record<string, number>;
};

export type TempsOutput = {
  systems: TempInfo[];
};

export type IssueSeverity = HealthSeverity;
export type IssueKind = HealthKind;

export type HealthIssue = {
  system: string;
  severity: IssueSeverity;
  kind: IssueKind;
  detail: string;
};

export type HealthReport = {
  healthy: boolean;
  issues: HealthIssue[];
  checked: number;
};

/**
 * Wraps time-series output when --since is passed.
 * Commands that support --since wrap their payload in this shape.
 */
export type HistoricalEnvelope<T> = {
  /** selected interval bucket: 1m | 10m | 20m | 120m | 480m */
  interval: StatsInterval;
  /** ISO 8601 start of window */
  from: string;
  /** ISO 8601 end of window (now) */
  to: string;
  /** ordered data points */
  points: T[];
};

export type ErrorEnvelope = {
  error: {
    code: string;
    message: string;
    hint: string;
  };
};
