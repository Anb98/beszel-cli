import { CliError } from "../types/errors.js";

const DEFAULTS = {
  diskWarn: 90,
  diskCrit: 95,
  tempWarn: 80,
  tempCrit: 90,
  diskTempWarn: 55,
  diskTempCrit: 65,
} as const;

export type ThresholdFlags = {
  diskWarn?: number;
  diskCrit?: number;
  tempWarn?: number;
  tempCrit?: number;
  diskTempWarn?: number;
  diskTempCrit?: number;
  strict?: boolean;
};

export type Thresholds = {
  diskWarn: number;
  diskCrit: number;
  tempWarn: number;
  tempCrit: number;
  diskTempWarn: number;
  diskTempCrit: number;
  /** When true, severity.ts promotes all "warn" issues to "crit". */
  strict: boolean;
};

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

  const strict =
    flags.strict !== undefined
      ? Boolean(flags.strict)
      : env["BESZEL_STRICT"] === "1" || env["BESZEL_STRICT"] === "true";

  validatePair("disk", diskWarn, diskCrit);
  validatePair("temp", tempWarn, tempCrit);
  validatePair("disk-temp", diskTempWarn, diskTempCrit);

  return { diskWarn, diskCrit, tempWarn, tempCrit, diskTempWarn, diskTempCrit, strict };
}

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

function validatePair(name: string, warn: number, crit: number): void {
  if (crit < warn) {
    throw new CliError(
      "INVALID_THRESHOLD",
      `${name}-crit (${crit}) must be >= ${name}-warn (${warn}).`,
      `Adjust --${name}-crit or --${name}-warn so that crit >= warn.`,
    );
  }
}
