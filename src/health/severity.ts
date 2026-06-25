import type { HealthIssue, HealthReport, HealthSeverity } from "../types/output.js";
import type { Thresholds } from "./thresholds.js";

export type HealthSystem = {
  name: string;
  status: string;
  diskPct: number | null;
  /** displayTempC from systems.info.dt */
  displayTempC?: number | null;
  /** sensor map from system_stats.stats.t (1m bucket) */
  sensors?: Record<string, number>;
};

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

  const finalIssues = thresholds.strict
    ? issues.map((issue) => ({ ...issue, severity: "crit" as HealthSeverity }))
    : issues;

  return {
    healthy: finalIssues.length === 0,
    issues: finalIssues,
    checked: systems.length,
  };
}

export function healthExitCode(report: HealthReport): number {
  const hasCritical = report.issues.some((i) => i.severity === "crit");
  return hasCritical ? 1 : 0;
}

const CRITICAL_RAID_STATES = new Set(["degraded", "failed", "inactive"]);
const WARNING_SYNC_ACTIONS = new Set(["resync", "recover", "recovery", "check", "repair", "reshape"]);

/** Collect all health issues for a single system (rules 1, 6–9). */
function collectSystemIssues(
  system: HealthSystem,
  thresholds: Thresholds,
  issues: HealthIssue[],
): void {
  if (system.status !== "up") {
    issues.push({
      system: system.name,
      severity: "crit",
      kind: "down",
      detail: `System is ${system.status} (expected "up").`,
    });
  }

  if (system.diskPct !== null && system.diskPct !== undefined) {
    const diskIssue = evalDiskUsage(system.name, system.diskPct, thresholds);
    if (diskIssue) issues.push(diskIssue);
  }

  if (system.displayTempC !== null && system.displayTempC !== undefined) {
    const tempIssue = evalTemp(system.name, "displayTempC", system.displayTempC, thresholds);
    if (tempIssue) issues.push(tempIssue);
  }

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
    if (device.state !== "PASSED") {
      issues.push({
        system: device.system,
        severity: "crit",
        kind: "smart",
        detail: `SMART state is "${device.state ?? "unknown"}" (expected "PASSED").`,
      });
    }
    if (device.tempC !== null && device.tempC !== undefined) {
      const tempIssue = evalDiskTemp(device.system, device.tempC, thresholds);
      if (tempIssue) issues.push(tempIssue);
    }
  } else {
    const raidIssue = evalRaid(device, thresholds);
    if (raidIssue) issues.push(raidIssue);
  }
}

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

function evalRaid(device: HealthDevice, _thresholds: Thresholds): HealthIssue | null {
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

  return null;
}

function buildRaidDetail(device: HealthDevice): string {
  const parts: string[] = [];
  if (device.arrayState) parts.push(`arrayState="${device.arrayState}"`);
  if (device.syncAction) parts.push(`syncAction="${device.syncAction}"`);
  if (device.state && device.state !== "PASSED") parts.push(`smartState="${device.state}"`);
  return parts.length > 0 ? parts.join(", ") : "RAID issue detected.";
}

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
