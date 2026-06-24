/**
 * health/thresholds.ts — Resolve health check thresholds.
 *
 * Precedence: flag > env (BESZEL_*) > default (design R2).
 *
 * Defaults (design R2 / decisions-resolved):
 *   disk%    > 90 → warn,  > 95 → crit
 *   temp     > 80 → warn,  > 90 → crit  (displayTempC + sensors)
 *   disk temp > 55 → warn, > 65 → crit  (smart_devices.tempC)
 *
 * Validation: crit >= warn else CliError(INVALID_THRESHOLD) exit 1.
 *
 * Flags (design R2):
 *   --disk-warn <pct>      / BESZEL_DISK_WARN
 *   --disk-crit <pct>      / BESZEL_DISK_CRIT
 *   --temp-warn <°C>       / BESZEL_TEMP_WARN
 *   --temp-crit <°C>       / BESZEL_TEMP_CRIT
 *   --disk-temp-warn <°C>  / BESZEL_DISK_TEMP_WARN
 *   --disk-temp-crit <°C>  / BESZEL_DISK_TEMP_CRIT
 *   --strict               / BESZEL_STRICT=1  (promotes all warn → crit)
 *
 * This module is Ink-free (REQ-2 boundary).
 */

import { CliError } from "../types/errors.js";

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULTS = {
  diskWarn: 90,
  diskCrit: 95,
  tempWarn: 80,
  tempCrit: 90,
  diskTempWarn: 55,
  diskTempCrit: 65,
} as const;

// ---------------------------------------------------------------------------
// ThresholdFlags — flag values supplied by Commander (may be undefined)
// ---------------------------------------------------------------------------

export interface ThresholdFlags {
  diskWarn?: number;
  diskCrit?: number;
  tempWarn?: number;
  tempCrit?: number;
  diskTempWarn?: number;
  diskTempCrit?: number;
  strict?: boolean;
}

// ---------------------------------------------------------------------------
// Thresholds — fully-resolved threshold configuration
// ---------------------------------------------------------------------------

export interface Thresholds {
  diskWarn: number;
  diskCrit: number;
  tempWarn: number;
  tempCrit: number;
  diskTempWarn: number;
  diskTempCrit: number;
  /** When true, severity.ts promotes all "warn" issues to "crit". */
  strict: boolean;
}

// ---------------------------------------------------------------------------
// resolveThresholds — public API
// ---------------------------------------------------------------------------

/**
 * Resolve health thresholds with precedence: flag > env > default.
 *
 * Reads BESZEL_DISK_WARN, BESZEL_DISK_CRIT, BESZEL_TEMP_WARN, BESZEL_TEMP_CRIT,
 * BESZEL_DISK_TEMP_WARN, BESZEL_DISK_TEMP_CRIT, BESZEL_STRICT from process.env
 * (or an injectable override via `env` parameter for testing).
 *
 * Throws CliError(INVALID_THRESHOLD) if any crit < warn after resolution.
 *
 * @param flags - Flag values from Commander (undefined = not provided).
 * @param env   - Environment variables (defaults to process.env; injectable for tests).
 * @returns Fully-resolved Thresholds object.
 */
export function resolveThresholds(
  flags: ThresholdFlags = {},
  env: Record<string, string | undefined> = process.env,
): Thresholds {
  const diskWarn = resolveNum(flags.diskWarn, env["BESZEL_DISK_WARN"], DEFAULTS.diskWarn);
  const diskCrit = resolveNum(flags.diskCrit, env["BESZEL_DISK_CRIT"], DEFAULTS.diskCrit);
  const tempWarn = resolveNum(flags.tempWarn, env["BESZEL_TEMP_WARN"], DEFAULTS.tempWarn);
  const tempCrit = resolveNum(flags.tempCrit, env["BESZEL_TEMP_CRIT"], DEFAULTS.tempCrit);
  const diskTempWarn = resolveNum(
    flags.diskTempWarn,
    env["BESZEL_DISK_TEMP_WARN"],
    DEFAULTS.diskTempWarn,
  );
  const diskTempCrit = resolveNum(
    flags.diskTempCrit,
    env["BESZEL_DISK_TEMP_CRIT"],
    DEFAULTS.diskTempCrit,
  );

  // --strict: flag wins; then BESZEL_STRICT=1; else false.
  const strict =
    flags.strict !== undefined
      ? Boolean(flags.strict)
      : env["BESZEL_STRICT"] === "1" || env["BESZEL_STRICT"] === "true";

  // Validate crit >= warn for each pair.
  validatePair("disk", diskWarn, diskCrit);
  validatePair("temp", tempWarn, tempCrit);
  validatePair("disk-temp", diskTempWarn, diskTempCrit);

  return { diskWarn, diskCrit, tempWarn, tempCrit, diskTempWarn, diskTempCrit, strict };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Resolve a single threshold value: flag > env-string-parsed > fallback.
 */
function resolveNum(
  flag: number | undefined,
  envVal: string | undefined,
  fallback: number,
): number {
  if (flag !== undefined) return flag;
  if (envVal !== undefined && envVal !== "") {
    const parsed = Number(envVal);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return fallback;
}

/**
 * Validate that crit >= warn; throw CliError(INVALID_THRESHOLD) if not.
 */
function validatePair(name: string, warn: number, crit: number): void {
  if (crit < warn) {
    throw new CliError(
      "INVALID_THRESHOLD",
      `${name}-crit (${crit}) must be >= ${name}-warn (${warn}).`,
      `Adjust --${name}-crit or --${name}-warn so that crit >= warn.`,
    );
  }
}
