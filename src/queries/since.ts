/**
 * since.ts — Duration string parser + interval bucket selector for --since queries.
 *
 * REQ-9: auto-selects the SMALLEST retention bucket that covers the requested window.
 *
 * Retention buckets (Beszel stat intervals):
 *   1m  ≈ 1.5h retention
 *   10m ≈ 12h retention
 *   20m ≈ 24h retention
 *   120m ≈ 7d retention
 *   480m ≈ 30d retention
 *
 * Window > 30d → clamp to 480m + warn on stderr. Exit stays 0.
 * Unparseable duration string → throw CliError(INVALID_DURATION) exit 1.
 *
 * This module is Ink-free (REQ-2 boundary).
 */

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

/**
 * Parse a duration string into milliseconds.
 *
 * Supported units: s (seconds), m (minutes), h (hours), d (days).
 * Throws CliError(INVALID_DURATION) for unrecognized formats.
 *
 * @example parseDuration("30m") → 1800000
 * @example parseDuration("12h") → 43200000
 * @example parseDuration("2d")  → 172800000
 * @example parseDuration("90s") → 90000
 */
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

/**
 * Select the smallest interval bucket whose retention covers the requested
 * window (in milliseconds). Windows > 30d are clamped and warned.
 *
 * @param windowMs - Window size in milliseconds (from parseDuration).
 * @returns The interval bucket string.
 */
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

/**
 * Convert an ISO 8601 datetime string to the PocketBase datetime filter format.
 *
 * PocketBase's `created >=` filter comparisons REQUIRE a space separator
 * instead of the ISO 8601 `T` separator. The trailing `Z` and milliseconds
 * are preserved. Milliseconds are kept for sub-second filter precision.
 *
 * PROVEN via live smoke test (2026-06-24): space-format → 37 rows returned;
 * T-format → 0 rows returned on identical system/type/window queries.
 *
 * @example
 *   toPocketBaseDateTime("2026-06-24T17:00:00.000Z")
 *   // → "2026-06-24 17:00:00.000Z"
 *
 * @param iso - ISO 8601 string (e.g. from Date.toISOString()).
 * @returns PocketBase filter datetime string with space separator.
 */
export function toPocketBaseDateTime(iso: string): string {
  return iso.replace("T", " ");
}

export type SinceResult = {
  /** Selected interval bucket, e.g. "10m" */
  interval: IntervalBucket;
  /**
   * ISO 8601 start of window (now - window).
   * For PocketBase filter strings, use toPocketBaseDateTime(from).
   */
  from: string;
  /**
   * ISO 8601 end of window (now).
   * For PocketBase filter strings, use toPocketBaseDateTime(to).
   */
  to: string;
};

/**
 * Full pipeline: parse the --since flag value, select the interval bucket,
 * and produce the {interval, from, to} envelope.
 *
 * @param sinceFlag - Raw --since flag value, e.g. "12h".
 * @param now - Optional override for "current time" (for deterministic tests).
 * @returns SinceResult with interval, from, to.
 * @throws {CliError} INVALID_DURATION if sinceFlag cannot be parsed.
 */
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
