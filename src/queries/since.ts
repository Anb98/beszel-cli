import { CliError } from "../types/errors.js";

export type IntervalBucket = "1m" | "10m" | "20m" | "120m" | "480m";

type Bucket = {
  interval: IntervalBucket;
  /** Maximum window (in ms) this bucket covers. */
  maxWindowMs: number;
};

const BUCKETS: readonly Bucket[] = [
  { interval: "1m",   maxWindowMs: 1.5 * 60 * 60 * 1000 },   // 1.5 hours
  { interval: "10m",  maxWindowMs: 12  * 60 * 60 * 1000 },   // 12 hours
  { interval: "20m",  maxWindowMs: 24  * 60 * 60 * 1000 },   // 24 hours
  { interval: "120m", maxWindowMs: 7   * 24 * 60 * 60 * 1000 }, // 7 days
  { interval: "480m", maxWindowMs: 30  * 24 * 60 * 60 * 1000 }, // 30 days
];

const MAX_WINDOW_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export function parseDuration(input: string): number {
  const match = /^(\d+(?:\.\d+)?)(s|m|h|d)$/.exec(input.trim());
  if (!match) {
    throw new CliError(
      "INVALID_DURATION",
      `Invalid duration string: "${input}". Expected format: <number><unit> where unit is s, m, h, or d.`,
      `Examples: 30m, 12h, 2d, 90s`,
    );
  }

  const value = parseFloat(match[1]!);
  const unit = match[2]!;

  switch (unit) {
    case "s": return value * 1000;
    case "m": return value * 60 * 1000;
    case "h": return value * 60 * 60 * 1000;
    case "d": return value * 24 * 60 * 60 * 1000;
    default:
      throw new CliError("INVALID_DURATION", `Unknown unit: "${unit}"`, "");
  }
}

export function selectInterval(windowMs: number): IntervalBucket {
  if (windowMs > MAX_WINDOW_MS) {
    process.stderr.write(
      `[beszel] WARNING: --since window exceeds 30 days. Clamping to 480m (30d) bucket.\n`,
    );
    return "480m";
  }

  for (const bucket of BUCKETS) {
    if (windowMs <= bucket.maxWindowMs) {
      return bucket.interval;
    }
  }

  return "480m";
}

// PocketBase datetime filters require space format, not ISO 'T'.
// "2026-06-24T17:00:00.000Z" → "2026-06-24 17:00:00.000Z"
export function toPocketBaseDateTime(iso: string): string {
  return iso.replace("T", " ");
}

export type SinceResult = {
  interval: IntervalBucket;
  from: string;
  to: string;
};

export function resolveSince(sinceFlag: string, now = new Date()): SinceResult {
  const windowMs = parseDuration(sinceFlag);
  const interval = selectInterval(windowMs);

  const toDate = now;
  const fromDate = new Date(toDate.getTime() - windowMs);

  return {
    interval,
    from: fromDate.toISOString(),
    to: toDate.toISOString(),
  };
}
