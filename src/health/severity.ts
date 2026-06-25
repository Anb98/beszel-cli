/**
 * health/severity.ts — Evaluate fleet data into HealthIssue[] and HealthReport.
 *
 * Design rules (top-down first-match per device/system; design R1):
 *
 *   1. system status != "up"                              → CRITICAL kind:"down"
 *   2. SMART disk: state != "PASSED"                      → CRITICAL kind:"smart"
 *   3. RAID: state != "PASSED" OR arrayState ∈
 *      {degraded, failed, inactive}                       → CRITICAL kind:"raid"
 *   4. RAID: syncAction != "idle"                         → WARNING  kind:"raid"
 *   5. RAID: arrayState == "clean" && syncAction == "idle"→ OK (skip)
 *   6. disk% > diskCrit                                   → CRITICAL kind:"disk"
 *   7. disk% > diskWarn                                   → WARNING  kind:"disk"
 *   8. displayTempC or sensor > tempCrit                  → CRITICAL kind:"temp"
 *   9. displayTempC or sensor > tempWarn                  → WARNING  kind:"temp"
 *  10. smart_devices tempC > diskTempCrit                 → CRITICAL kind:"temp"
 *  11. smart_devices tempC > diskTempWarn                 → WARNING  kind:"temp"
 *
 * --strict (Thresholds.strict): promotes every "warn" to "crit" POST-aggregation.
 *
 * Exit semantics (R5):
 *   - any CRITICAL → exit 1 (healthExitCode returns 1)
 *   - warning-only → healthy:false but exit 0
 *   - no issues    → healthy:true, exit 0
 *
 * This module is Ink-free (REQ-2 boundary).
 * Input: plain data objects (already mapped from key-map). No BeszelClient calls.
 */

import type { HealthIssue, HealthReport, HealthSeverity } from "../types/output.js";
import type { Thresholds } from "./thresholds.js";

// ---------------------------------------------------------------------------
// FleetData — input to evaluateHealth
// ---------------------------------------------------------------------------

/**
 * Minimal shape of a mapped system needed for health evaluation.
 * Accepts SystemItem from output types or a subset for testing.
 */
export type HealthSystem = {
  name: string;
  status: string;
  diskPct: number | null;
  /** displayTempC from systems.info.dt */
  displayTempC?: number | null;
  /** sensor map from system_stats.stats.t (1m bucket) */
  sensors?: Record<string, number>;
};

/**
 * Minimal shape of a mapped DeviceInfo needed for health evaluation.
 * Accepts DiskInfo or RaidInfo from output types.
 */
export type HealthDevice = {
  /** system name */
  system: string;
  kind: "disk" | "raid";
  // --- kind:"disk" fields ---
  /** PASSED | FAILED | null */
  state?: string | null;
  /** temperature °C */
  tempC?: number | null;
  // --- kind:"raid" fields ---
  /** clean | degraded | inactive | failed */
  arrayState?: string | null;
  /** idle | resync | recover | recovery | check | repair | reshape */
  syncAction?: string | null;
};

// ---------------------------------------------------------------------------
// evaluateHealth — public API
// ---------------------------------------------------------------------------

/**
 * Evaluate fleet health and return a HealthReport.
 *
 * @param systems  - Mapped system records (HealthSystem[]).
 * @param devices  - Mapped device records (HealthDevice[]). Pass [] when no SMART data.
 * @param thresholds - Resolved thresholds from resolveThresholds().
 * @returns HealthReport { healthy, issues, checked }.
 */
export function evaluateHealth(
  systems: HealthSystem[],
  devices: HealthDevice[],
  thresholds: Thresholds,
): HealthReport {
  const issues: HealthIssue[] = [];

  for (const system of systems) {
    collectSystemIssues(system, thresholds, issues);
  }

  for (const device of devices) {
    collectDeviceIssues(device, thresholds, issues);
  }

  // --strict: promote all "warn" to "crit" post-aggregation.
  const finalIssues = thresholds.strict
    ? issues.map((issue) => ({ ...issue, severity: "crit" as HealthSeverity }))
    : issues;

  return {
    healthy: finalIssues.length === 0,
    issues: finalIssues,
    checked: systems.length,
  };
}

// ---------------------------------------------------------------------------
// healthExitCode — derive exit code from HealthReport (design R5)
// ---------------------------------------------------------------------------

/**
 * Return the process exit code for a HealthReport.
 *   - 1 when any CRITICAL issue exists
 *   - 0 when healthy (no issues) or warning-only
 */
export function healthExitCode(report: HealthReport): number {
  const hasCritical = report.issues.some((i) => i.severity === "crit");
  return hasCritical ? 1 : 0;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const CRITICAL_RAID_STATES = new Set(["degraded", "failed", "inactive"]);
const WARNING_SYNC_ACTIONS = new Set(["resync", "recover", "recovery", "check", "repair", "reshape"]);

/** Collect all health issues for a single system (rules 1, 6–9). */
function collectSystemIssues(
  system: HealthSystem,
  thresholds: Thresholds,
  issues: HealthIssue[],
): void {
  // Rule 1: system down.
  if (system.status !== "up") {
    issues.push({
      system: system.name,
      severity: "crit",
      kind: "down",
      detail: `System is ${system.status} (expected "up").`,
    });
  }

  // Rules 6–7: disk usage.
  if (system.diskPct !== null && system.diskPct !== undefined) {
    const diskIssue = evalDiskUsage(system.name, system.diskPct, thresholds);
    if (diskIssue) issues.push(diskIssue);
  }

  // Rules 8–9: system temperature (displayTempC).
  if (system.displayTempC !== null && system.displayTempC !== undefined) {
    const tempIssue = evalTemp(system.name, "displayTempC", system.displayTempC, thresholds);
    if (tempIssue) issues.push(tempIssue);
  }

  // Rules 8–9: sensor temperatures (from system_stats.stats.t).
  if (system.sensors) {
    for (const [sensor, celsius] of Object.entries(system.sensors)) {
      const tempIssue = evalTemp(system.name, sensor, celsius, thresholds);
      if (tempIssue) issues.push(tempIssue);
    }
  }
}

/** Collect all health issues for a single device (rules 2–5, 10–11). */
function collectDeviceIssues(
  device: HealthDevice,
  thresholds: Thresholds,
  issues: HealthIssue[],
): void {
  if (device.kind === "disk") {
    // Rule 2: SMART disk state.
    if (device.state !== "PASSED") {
      issues.push({
        system: device.system,
        severity: "crit",
        kind: "smart",
        detail: `SMART state is "${device.state ?? "unknown"}" (expected "PASSED").`,
      });
    }
    // Rules 10–11: disk temp.
    if (device.tempC !== null && device.tempC !== undefined) {
      const tempIssue = evalDiskTemp(device.system, device.tempC, thresholds);
      if (tempIssue) issues.push(tempIssue);
    }
  } else {
    // kind === "raid" — Rules 3–5 (top-down first-match).
    const raidIssue = evalRaid(device, thresholds);
    if (raidIssue) issues.push(raidIssue);
  }
}

/**
 * Evaluate disk usage percentage against diskWarn / diskCrit thresholds.
 */
function evalDiskUsage(
  systemName: string,
  diskPct: number,
  thresholds: Thresholds,
): HealthIssue | null {
  if (diskPct > thresholds.diskCrit) {
    return {
      system: systemName,
      severity: "crit",
      kind: "disk",
      detail: `Disk usage ${diskPct.toFixed(1)}% exceeds critical threshold ${thresholds.diskCrit}%.`,
    };
  }
  if (diskPct > thresholds.diskWarn) {
    return {
      system: systemName,
      severity: "warn",
      kind: "disk",
      detail: `Disk usage ${diskPct.toFixed(1)}% exceeds warning threshold ${thresholds.diskWarn}%.`,
    };
  }
  return null;
}

/**
 * Evaluate a RAID device (top-down first-match per design R1).
 */
function evalRaid(device: HealthDevice, _thresholds: Thresholds): HealthIssue | null {
  // Rule 3: SMART state not PASSED OR arrayState in {degraded, failed, inactive} → CRITICAL.
  if (
    device.state !== "PASSED" ||
    (device.arrayState !== null &&
      device.arrayState !== undefined &&
      CRITICAL_RAID_STATES.has(device.arrayState))
  ) {
    return {
      system: device.system,
      severity: "crit",
      kind: "raid",
      detail: buildRaidDetail(device),
    };
  }

  // Rule 4: syncAction not idle → WARNING.
  if (
    device.syncAction !== null &&
    device.syncAction !== undefined &&
    device.syncAction !== "idle" &&
    WARNING_SYNC_ACTIONS.has(device.syncAction)
  ) {
    return {
      system: device.system,
      severity: "warn",
      kind: "raid",
      detail: buildRaidDetail(device),
    };
  }

  // Rule 5: clean + idle → OK.
  return null;
}

function buildRaidDetail(device: HealthDevice): string {
  const parts: string[] = [];
  if (device.arrayState) parts.push(`arrayState="${device.arrayState}"`);
  if (device.syncAction) parts.push(`syncAction="${device.syncAction}"`);
  if (device.state && device.state !== "PASSED") parts.push(`smartState="${device.state}"`);
  return parts.length > 0 ? parts.join(", ") : "RAID issue detected.";
}

/**
 * Evaluate a system or sensor temperature against tempWarn / tempCrit.
 */
function evalTemp(
  systemName: string,
  label: string,
  celsius: number,
  thresholds: Thresholds,
): HealthIssue | null {
  if (celsius > thresholds.tempCrit) {
    return {
      system: systemName,
      severity: "crit",
      kind: "temp",
      detail: `${label} ${celsius}°C exceeds critical threshold ${thresholds.tempCrit}°C.`,
    };
  }
  if (celsius > thresholds.tempWarn) {
    return {
      system: systemName,
      severity: "warn",
      kind: "temp",
      detail: `${label} ${celsius}°C exceeds warning threshold ${thresholds.tempWarn}°C.`,
    };
  }
  return null;
}

/**
 * Evaluate a disk (SMART device) temperature against diskTempWarn / diskTempCrit.
 */
function evalDiskTemp(
  systemName: string,
  celsius: number,
  thresholds: Thresholds,
): HealthIssue | null {
  if (celsius > thresholds.diskTempCrit) {
    return {
      system: systemName,
      severity: "crit",
      kind: "temp",
      detail: `Disk temperature ${celsius}°C exceeds critical threshold ${thresholds.diskTempCrit}°C.`,
    };
  }
  if (celsius > thresholds.diskTempWarn) {
    return {
      system: systemName,
      severity: "warn",
      kind: "temp",
      detail: `Disk temperature ${celsius}°C exceeds warning threshold ${thresholds.diskTempWarn}°C.`,
    };
  }
  return null;
}
