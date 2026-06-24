/**
 * renderers/json.ts — Pure JSON serialization helper for the agent/pipe output path.
 *
 * This module has NO Ink or React dependency. It is the only renderer that runs
 * on the non-TTY path and is always safe to import from any module (including
 * those under the Ink-free boundary).
 *
 * Design note: stable key ordering is applied via a custom replacer to make
 * output predictable for snapshot tests and diffing. The ordering groups
 * structural/identity keys first, then domain-specific fields, with unknown
 * extra keys appended last.
 */

// ---------------------------------------------------------------------------
// serializeJson — public API
// ---------------------------------------------------------------------------

/**
 * Serialize a value to a pretty-printed JSON string (2-space indent).
 *
 * Applies a stable key ordering so that structural keys (id, name, kind,
 * status, healthy, issues, checked, error) always appear first, making diffs
 * and snapshot tests readable.
 *
 * @param data - Any JSON-serializable value.
 * @returns Newline-terminated JSON string.
 */
export function serializeJson(data: unknown): string {
  return JSON.stringify(data, stableReplacer(), 2) + "\n";
}

// ---------------------------------------------------------------------------
// stableReplacer — deterministic key ordering
// ---------------------------------------------------------------------------

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
  // The replacer is called for every value in the object graph.
  // We return a Proxy/sorted object only for plain objects so arrays stay in order.
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
