export type FieldStability = "stable" | "optional";

export type FieldDef = {
  name: string;
  type: string;
  stability: FieldStability;
  description: string;
};

export type FlagDef = {
  flag: string;
  argLabel?: string;
  env?: string;
  defaultValue?: string;
  description: string;
};

export type CommandContract = {
  name: string;
  usage: string;
  purpose: string;
  /** Human-readable prose for the JSON output shape. */
  outputShape: string;
  /** Top-level fields in the JSON output object. */
  outputFields: FieldDef[];
  flags: FlagDef[];
  /** Example invocations. key = label, value = CLI string. */
  examples: Record<string, string>;
};

export const GLOBAL_FLAGS: FlagDef[] = [
  {
    flag: "--json",
    description:
      "Force JSON output. Also active when stdout is not a TTY or CI=true.",
  },
  {
    flag: "--no-color",
    description: "Suppress ANSI colors in TTY output.",
  },
  {
    flag: "--no-cache",
    description: "Disable token cache; always re-authenticate.",
  },
];

export type ExitCodeDef = {
  code: number;
  condition: string;
  errorCode?: string;
};

export const EXIT_CODE_TABLE: ExitCodeDef[] = [
  { code: 0, condition: "Success — healthy fleet or warning-only (no --strict)" },
  {
    code: 1,
    condition:
      "Config/validation error (missing env, invalid threshold/duration) OR CRITICAL health issue OR --strict with any warning",
    errorCode: "CONFIG_MISSING | INVALID_THRESHOLD | INVALID_DURATION | INTERNAL_ERROR",
  },
  {
    code: 2,
    condition: "Authentication failed (bad credentials or expired session)",
    errorCode: "AUTH_FAILED",
  },
  {
    code: 3,
    condition: "System not found or ambiguous (multiple name matches)",
    errorCode: "NOT_FOUND | AMBIGUOUS_SYSTEM",
  },
  {
    code: 4,
    condition: "Network error (ECONNREFUSED, timeout, 5xx, non-JSON response)",
    errorCode: "NETWORK_ERROR",
  },
];

export const ERROR_ENVELOPE_SCHEMA = `{
  "error": {
    "code":    "<string — machine-readable ErrorCode>",
    "message": "<string — human-readable description>",
    "hint":    "<string — actionable suggestion>"
  }
}`;

export const ENV_VARS: Array<{ name: string; required: boolean; description: string }> = [
  { name: "BESZEL_URL", required: true, description: "Hub URL, e.g. https://beszel.example.com" },
  { name: "BESZEL_EMAIL", required: true, description: "Login email" },
  { name: "BESZEL_PASSWORD", required: true, description: "Login password" },
  {
    name: "BESZEL_AUTH_COLLECTION",
    required: false,
    description: 'PocketBase collection name (default "users")',
  },
];

/** Single constant — must match SUPPORTED_BESZEL in src/client/beszelClient.ts */
export const SUPPORTED_BESZEL_RANGE = ">=0.18 <0.19";

const systemsContract: CommandContract = {
  name: "systems",
  usage: "beszel systems [options]",
  purpose: "List all fleet systems with live snapshot metrics.",
  outputShape: '{ "systems": SystemItem[] }',
  outputFields: [
    { name: "systems[].id", type: "string", stability: "stable", description: "PocketBase record id" },
    { name: "systems[].name", type: "string", stability: "stable", description: "System display name" },
    { name: "systems[].host", type: "string | null", stability: "stable", description: "Host identifier" },
    { name: "systems[].status", type: "string", stability: "stable", description: "up | down | paused | pending" },
    { name: "systems[].cpu", type: "number | null", stability: "stable", description: "CPU %" },
    { name: "systems[].memPct", type: "number | null", stability: "stable", description: "Memory %" },
    { name: "systems[].diskPct", type: "number | null", stability: "stable", description: "Root disk %" },
    { name: "systems[].uptimeS", type: "number | null", stability: "stable", description: "Uptime in seconds" },
    { name: "systems[].agentVersion", type: "string | null", stability: "stable", description: "Beszel agent version" },
    { name: "systems[].tempC", type: "number", stability: "optional", description: "Display temperature °C (info.dt)" },
    { name: "systems[].containerCount", type: "number", stability: "optional", description: "Container count (info.ct)" },
    { name: "systems[].loadAvg", type: "number[]", stability: "optional", description: "Load avg [1m, 5m, 15m] (info.la)" },
    { name: "systems[].extraFs", type: "Record<string, number>", stability: "optional", description: "Extra/RAID filesystem usage % map (info.efs)" },
  ],
  flags: [
    {
      flag: "--status",
      argLabel: "<value>",
      description: "Filter by system status (e.g. up, down, paused).",
    },
  ],
  examples: {
    "List all systems as JSON": "beszel systems --json",
    "Filter to running systems": "beszel systems --status up --json",
    "Human TTY table": "beszel systems",
  },
};

const systemContract: CommandContract = {
  name: "system",
  usage: "beszel system <name> [options]",
  purpose:
    "Show detail for one system resolved by name (case-insensitive) or id. Optionally include historical stats with --since.",
  outputShape: '{ "system": SystemDetail, "details": SystemDetailsInfo | null } | with --since: adds "history": HistoricalEnvelope<StatsPoint[]>',
  outputFields: [
    { name: "system.id", type: "string", stability: "stable", description: "PocketBase record id" },
    { name: "system.name", type: "string", stability: "stable", description: "System display name" },
    { name: "system.host", type: "string | null", stability: "stable", description: "Host identifier" },
    { name: "system.status", type: "string", stability: "stable", description: "up | down | paused | pending" },
    { name: "system.cpu", type: "number | null", stability: "stable", description: "CPU %" },
    { name: "system.memPct", type: "number | null", stability: "stable", description: "Memory %" },
    { name: "system.diskPct", type: "number | null", stability: "stable", description: "Root disk %" },
    { name: "system.uptimeS", type: "number | null", stability: "stable", description: "Uptime in seconds" },
    { name: "system.agentVersion", type: "string | null", stability: "stable", description: "Beszel agent version" },
    { name: "system.tempC", type: "number", stability: "optional", description: "Display temperature °C" },
    { name: "system.containerCount", type: "number", stability: "optional", description: "Container count" },
    { name: "system.loadAvg", type: "number[]", stability: "optional", description: "Load avg [1m, 5m, 15m]" },
    { name: "system.extraFs", type: "Record<string, number>", stability: "optional", description: "Extra/RAID filesystem usage % map" },
    { name: "details", type: "SystemDetailsInfo | null", stability: "stable", description: "Hardware/OS details (null when absent)" },
    { name: "details.hostname", type: "string | null", stability: "stable", description: "Hostname" },
    { name: "details.os", type: "string | null", stability: "stable", description: "OS name (e.g. Alpine Linux)" },
    { name: "details.kernel", type: "string | null", stability: "stable", description: "Kernel version" },
    { name: "details.cpuModel", type: "string | null", stability: "stable", description: "CPU model string" },
    { name: "details.arch", type: "string | null", stability: "stable", description: "CPU architecture" },
    { name: "details.cores", type: "number | null", stability: "stable", description: "Physical cores" },
    { name: "details.threads", type: "number | null", stability: "stable", description: "Hardware threads" },
    { name: "details.memoryBytes", type: "number | null", stability: "stable", description: "Total memory bytes" },
    { name: "details.podman", type: "boolean", stability: "optional", description: "true when container runtime is Podman" },
    { name: "history", type: "HistoricalEnvelope<StatsPoint[]>", stability: "optional", description: "Present only when --since is passed" },
    { name: "history.interval", type: "string", stability: "stable", description: "Bucket: 1m | 10m | 20m | 120m | 480m" },
    { name: "history.from", type: "string", stability: "stable", description: "ISO 8601 window start" },
    { name: "history.to", type: "string", stability: "stable", description: "ISO 8601 window end (now)" },
    { name: "history.points", type: "StatsPoint[]", stability: "stable", description: "Ordered time-series data points" },
  ],
  flags: [
    {
      flag: "--since",
      argLabel: "<duration>",
      description: "Historical window. Format: <number><unit> where unit = m (minutes), h (hours), d (days). Max 30d (capped with stderr warning). Examples: 30m, 12h, 7d.",
    },
  ],
  examples: {
    "System snapshot JSON": 'beszel system "Zima Blade" --json',
    "With 24h history": 'beszel system "Zima Blade" --since 24h --json',
    "Lookup by id": "beszel system sys001homela --json",
    "Human TTY view": 'beszel system "Home Lab"',
  },
};

const containersContract: CommandContract = {
  name: "containers",
  usage: "beszel containers [options]",
  purpose: "List containers across the fleet, sortable by cpu or memory, filterable by system.",
  outputShape: '{ "containers": ContainerInfo[] }',
  outputFields: [
    { name: "containers[].name", type: "string", stability: "stable", description: "Container name" },
    { name: "containers[].system", type: "string", stability: "stable", description: "Parent system name" },
    { name: "containers[].status", type: "string | null", stability: "stable", description: "Status string (e.g. Up 2 days)" },
    { name: "containers[].health", type: "number | null", stability: "stable", description: "Health code (numeric; e.g. 0)" },
    { name: "containers[].cpuPct", type: "number | null", stability: "stable", description: "CPU %" },
    { name: "containers[].memMB", type: "number | null", stability: "stable", description: "Memory MB" },
    { name: "containers[].image", type: "string | null", stability: "stable", description: "Container image" },
    { name: "containers[].ports", type: "string", stability: "optional", description: "Port mapping string (when present in upstream)" },
  ],
  flags: [
    { flag: "--top", argLabel: "<n>", description: "Limit results to top N items." },
    { flag: "--sort", argLabel: "<field>", defaultValue: "cpu", description: "Sort field: cpu or memory." },
    { flag: "--system", argLabel: "<name>", description: "Filter containers to one system (by name or id)." },
    { flag: "--since", argLabel: "<duration>", description: "Historical window (e.g. 30m, 12h, 7d)." },
  ],
  examples: {
    "All containers JSON": "beszel containers --json",
    "Top 10 by memory": "beszel containers --top 10 --sort memory --json",
    "Filter by system": 'beszel containers --system "Home Lab" --json',
    "Human TTY view": "beszel containers",
  },
};

const disksContract: CommandContract = {
  name: "disks",
  usage: "beszel disks [options]",
  purpose:
    "List SMART disks and RAID arrays across the fleet. RAID entries include arrayState and syncAction.",
  outputShape: '{ "devices": Array<DiskInfo | RaidInfo> }',
  outputFields: [
    { name: "devices[].kind", type: '"disk" | "raid"', stability: "stable", description: "Device type discriminator" },
    { name: "devices[].name", type: "string", stability: "stable", description: "Device path (e.g. /dev/sda)" },
    { name: "devices[].system", type: "string", stability: "stable", description: "Parent system name" },
    { name: "devices[].state", type: "string | null", stability: "stable", description: "PASSED | FAILED (SMART overall state)" },
    // disk-specific stable fields
    { name: "devices[].model", type: "string | null", stability: "stable", description: "Disk model string [disk only]" },
    { name: "devices[].tempC", type: "number | null", stability: "stable", description: "Temperature °C [disk only]" },
    { name: "devices[].capacityBytes", type: "number | null", stability: "stable", description: "Capacity in bytes [disk only]" },
    { name: "devices[].type", type: "string | null", stability: "stable", description: "sat | nvme | scsi [disk only]" },
    // disk-specific optional fields
    { name: "devices[].serial", type: "string", stability: "optional", description: "Serial number [disk only]" },
    { name: "devices[].firmware", type: "string", stability: "optional", description: "Firmware revision [disk only]" },
    { name: "devices[].hours", type: "number", stability: "optional", description: "Power-on hours [disk only]" },
    { name: "devices[].cycles", type: "number", stability: "optional", description: "Power cycles [disk only]" },
    // raid-specific stable fields
    { name: "devices[].raidLevel", type: "string | null", stability: "stable", description: "e.g. raid5 [raid only]" },
    { name: "devices[].arrayState", type: "string | null", stability: "stable", description: "clean | degraded | inactive | failed [raid only]" },
    { name: "devices[].raidDisks", type: "number | null", stability: "stable", description: "Disk count in array [raid only]" },
    { name: "devices[].syncAction", type: "string | null", stability: "stable", description: "idle | resync | recover | check | repair | reshape [raid only]" },
  ],
  flags: [
    { flag: "--system", argLabel: "<name>", description: "Filter to one system (name or id)." },
    {
      flag: "--failing",
      description:
        "Show only failing devices: disks where state != PASSED, or RAID where arrayState != clean or syncAction != idle.",
    },
  ],
  examples: {
    "All devices JSON": "beszel disks --json",
    "Failing devices only": "beszel disks --failing --json",
    "One system disks": 'beszel disks --system "Home Lab" --json',
    "Human TTY view": "beszel disks",
  },
};

const tempsContract: CommandContract = {
  name: "temps",
  usage: "beszel temps [options]",
  purpose:
    "Show temperatures for all fleet systems. displayTempC is from the live snapshot; sensors is from the latest 1-minute stats bucket.",
  outputShape: '{ "systems": TempInfo[] }',
  outputFields: [
    { name: "systems[].system", type: "string", stability: "stable", description: "System name" },
    { name: "systems[].displayTempC", type: "number | null", stability: "stable", description: "Display temp °C (systems.info.dt)" },
    { name: "systems[].sensors", type: "Record<string, number>", stability: "stable", description: "Sensor name → °C map (empty object when no 1m record). With --disks, disk temps are added as <dev>_temp keys." },
  ],
  flags: [
    {
      flag: "--disks",
      description:
        "Include disk (SMART) temperatures merged into the sensors map as <deviceBase>_temp keys.",
    },
  ],
  examples: {
    "All temps JSON": "beszel temps --json",
    "Include disk temps": "beszel temps --disks --json",
    "Human TTY view": "beszel temps",
  },
};

const healthContract: CommandContract = {
  name: "health",
  usage: "beszel health [options]",
  purpose:
    "Evaluate fleet health across status, SMART state, RAID arrays, disk usage, and temperatures. Emits structured issues list. Exit 0 = healthy/warning-only; exit 1 = CRITICAL (or any issue with --strict).",
  outputShape: '{ "healthy": boolean, "issues": HealthIssue[], "checked": number }',
  outputFields: [
    { name: "healthy", type: "boolean", stability: "stable", description: "true when issues is empty" },
    { name: "issues", type: "HealthIssue[]", stability: "stable", description: "Array of issues (empty = clean)" },
    { name: "issues[].system", type: "string", stability: "stable", description: "System name where issue was detected" },
    { name: "issues[].severity", type: '"crit" | "warn"', stability: "stable", description: "Issue severity level" },
    { name: "issues[].kind", type: '"down" | "smart" | "raid" | "disk" | "temp"', stability: "stable", description: "Issue category" },
    { name: "issues[].detail", type: "string", stability: "stable", description: "Human-readable description" },
    { name: "checked", type: "number", stability: "stable", description: "Count of systems evaluated" },
  ],
  flags: [
    { flag: "--disk-warn", argLabel: "<pct>", env: "BESZEL_DISK_WARN", defaultValue: "90", description: "Disk usage warning threshold %" },
    { flag: "--disk-crit", argLabel: "<pct>", env: "BESZEL_DISK_CRIT", defaultValue: "95", description: "Disk usage critical threshold %" },
    { flag: "--temp-warn", argLabel: "<c>", env: "BESZEL_TEMP_WARN", defaultValue: "80", description: "System temperature warning threshold °C" },
    { flag: "--temp-crit", argLabel: "<c>", env: "BESZEL_TEMP_CRIT", defaultValue: "90", description: "System temperature critical threshold °C" },
    { flag: "--disk-temp-warn", argLabel: "<c>", env: "BESZEL_DISK_TEMP_WARN", defaultValue: "55", description: "Disk temperature warning threshold °C" },
    { flag: "--disk-temp-crit", argLabel: "<c>", env: "BESZEL_DISK_TEMP_CRIT", defaultValue: "65", description: "Disk temperature critical threshold °C" },
    {
      flag: "--strict",
      env: "BESZEL_STRICT",
      description:
        "Promote all warnings to critical. Exit 1 when any issue exists (not just CRITICAL).",
    },
  ],
  examples: {
    "Fleet health JSON": "beszel health --json",
    "Strict mode (any issue = exit 1)": "beszel health --strict --json",
    "Custom disk threshold": "beszel health --disk-warn 80 --disk-crit 90 --json",
    "Human TTY report": "beszel health",
  },
};

export const COMMAND_REGISTRY: CommandContract[] = [
  systemsContract,
  systemContract,
  containersContract,
  disksContract,
  tempsContract,
  healthContract,
];
