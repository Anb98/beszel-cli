export function serializeJson(data: unknown): string {
  return JSON.stringify(data, stableReplacer(), 2) + "\n";
}

/**
 * Key priority list — lower index = earlier in output.
 * Keys not in this list are appended in their natural insertion order.
 */
const KEY_PRIORITY: ReadonlyArray<string> = [
  // Error envelope
  "error",
  "code",
  "message",
  "hint",
  // Health
  "healthy",
  "issues",
  "checked",
  "severity",
  "kind",
  "detail",
  // Identity
  "id",
  "name",
  "system",
  "host",
  // Status / classification
  "status",
  "health",
  "type",
  // Metrics
  "cpu",
  "memPct",
  "diskPct",
  "tempC",
  "displayTempC",
  "sensors",
  "uptimeS",
  "agentVersion",
  "containerCount",
  "loadAvg",
  "extraFs",
  // Container
  "cpuPct",
  "memMB",
  "image",
  "ports",
  // Disk / RAID
  "kind",
  "state",
  "model",
  "capacityBytes",
  "serial",
  "firmware",
  "hours",
  "cycles",
  "raidLevel",
  "arrayState",
  "raidDisks",
  "syncAction",
  // Historical
  "interval",
  "from",
  "to",
  "points",
  // Collections
  "systems",
  "containers",
  "devices",
  "details",
];

const PRIORITY_INDEX = new Map(KEY_PRIORITY.map((k, i) => [k, i]));
const UNKNOWN_PRIORITY = KEY_PRIORITY.length; // append after known keys

function stableReplacer() {
    return function (_key: string, value: unknown): unknown {
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      const sorted: Record<string, unknown> = {};
      const keys = Object.keys(value as Record<string, unknown>).sort((a, b) => {
        const pa = PRIORITY_INDEX.get(a) ?? UNKNOWN_PRIORITY;
        const pb = PRIORITY_INDEX.get(b) ?? UNKNOWN_PRIORITY;
        if (pa !== pb) return pa - pb;
        // Stable secondary sort: alphabetical for keys with equal priority.
        return a.localeCompare(b);
      });
      for (const k of keys) {
        sorted[k] = (value as Record<string, unknown>)[k];
      }
      return sorted;
    }
    return value;
  };
}
