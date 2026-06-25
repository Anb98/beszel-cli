import { describe, it, expect } from "vitest";
import { evaluateHealth, healthExitCode } from "../../src/health/severity.js";
import { resolveThresholds } from "../../src/health/thresholds.js";
import type { HealthDevice, HealthSystem } from "../../src/health/severity.js";

const DEFAULT_THRESHOLDS = resolveThresholds({}, {});

function healthySystem(overrides: Partial<HealthSystem> = {}): HealthSystem {
  return {
    name: "Home Lab",
    status: "up",
    diskPct: 45.1,
    displayTempC: 52,
    sensors: {},
    ...overrides,
  };
}

function cleanRaid(overrides: Partial<HealthDevice> = {}): HealthDevice {
  return {
    system: "Home Lab",
    kind: "raid",
    state: "PASSED",
    arrayState: "clean",
    syncAction: "idle",
    ...overrides,
  };
}

function passedDisk(overrides: Partial<HealthDevice> = {}): HealthDevice {
  return {
    system: "Home Lab",
    kind: "disk",
    state: "PASSED",
    tempC: 32,
    ...overrides,
  };
}

describe("S1 — healthy fleet", () => {
  it("returns healthy:true with no issues and exit 0", () => {
    const systems = [healthySystem()];
    const devices = [cleanRaid(), passedDisk()];
    const report = evaluateHealth(systems, devices, DEFAULT_THRESHOLDS);
    expect(report.healthy).toBe(true);
    expect(report.issues).toHaveLength(0);
    expect(report.checked).toBe(1);
    expect(healthExitCode(report)).toBe(0);
  });

  it("multi-system healthy fleet: checked equals system count", () => {
    const systems = [
      healthySystem({ name: "Home Lab" }),
      healthySystem({ name: "OrangePi", displayTempC: 41 }),
      healthySystem({ name: "Zima blade", displayTempC: null }),
    ];
    const report = evaluateHealth(systems, [], DEFAULT_THRESHOLDS);
    expect(report.healthy).toBe(true);
    expect(report.checked).toBe(3);
    expect(healthExitCode(report)).toBe(0);
  });
});

describe("S2 — system down", () => {
  it("system status='down' → CRITICAL kind:'down', exit 1", () => {
    const systems = [healthySystem({ status: "down" })];
    const report = evaluateHealth(systems, [], DEFAULT_THRESHOLDS);
    expect(report.healthy).toBe(false);
    const issue = report.issues.find((i) => i.kind === "down");
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe("crit");
    expect(issue!.system).toBe("Home Lab");
    expect(healthExitCode(report)).toBe(1);
  });

  it("system status='paused' → CRITICAL kind:'down'", () => {
    const systems = [healthySystem({ status: "paused" })];
    const report = evaluateHealth(systems, [], DEFAULT_THRESHOLDS);
    const issue = report.issues.find((i) => i.kind === "down");
    expect(issue?.severity).toBe("crit");
  });
});

describe("S3 — SMART disk FAILED", () => {
  it("disk state='FAILED' → CRITICAL kind:'smart', exit 1", () => {
    const systems = [healthySystem()];
    const devices = [passedDisk({ state: "FAILED" })];
    const report = evaluateHealth(systems, devices, DEFAULT_THRESHOLDS);
    expect(report.healthy).toBe(false);
    const issue = report.issues.find((i) => i.kind === "smart");
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe("crit");
    expect(healthExitCode(report)).toBe(1);
  });

  it("disk state=null → CRITICAL kind:'smart' (unknown state treated as failing)", () => {
    const systems = [healthySystem()];
    const devices = [passedDisk({ state: null })];
    const report = evaluateHealth(systems, devices, DEFAULT_THRESHOLDS);
    const issue = report.issues.find((i) => i.kind === "smart");
    expect(issue?.severity).toBe("crit");
  });

  it("disk state='PASSED' → no smart issue", () => {
    const systems = [healthySystem()];
    const devices = [passedDisk({ state: "PASSED" })];
    const report = evaluateHealth(systems, devices, DEFAULT_THRESHOLDS);
    const smartIssues = report.issues.filter((i) => i.kind === "smart");
    expect(smartIssues).toHaveLength(0);
  });
});

describe("S4 — RAID degraded", () => {
  it("arrayState='degraded' → CRITICAL kind:'raid', exit 1", () => {
    const systems = [healthySystem()];
    const devices = [cleanRaid({ arrayState: "degraded", syncAction: "recover" })];
    const report = evaluateHealth(systems, devices, DEFAULT_THRESHOLDS);
    expect(report.healthy).toBe(false);
    const issue = report.issues.find((i) => i.kind === "raid");
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe("crit");
    expect(healthExitCode(report)).toBe(1);
  });

  it("arrayState='failed' → CRITICAL kind:'raid'", () => {
    const systems = [healthySystem()];
    const devices = [cleanRaid({ arrayState: "failed", syncAction: "idle" })];
    const report = evaluateHealth(systems, devices, DEFAULT_THRESHOLDS);
    const issue = report.issues.find((i) => i.kind === "raid");
    expect(issue?.severity).toBe("crit");
  });

  it("arrayState='inactive' → CRITICAL kind:'raid'", () => {
    const systems = [healthySystem()];
    const devices = [cleanRaid({ arrayState: "inactive", syncAction: "idle" })];
    const report = evaluateHealth(systems, devices, DEFAULT_THRESHOLDS);
    const issue = report.issues.find((i) => i.kind === "raid");
    expect(issue?.severity).toBe("crit");
  });

  it("SMART state='FAILED' on RAID → CRITICAL kind:'raid'", () => {
    const systems = [healthySystem()];
    const devices = [cleanRaid({ state: "FAILED", arrayState: "clean", syncAction: "idle" })];
    const report = evaluateHealth(systems, devices, DEFAULT_THRESHOLDS);
    const issue = report.issues.find((i) => i.kind === "raid");
    expect(issue?.severity).toBe("crit");
  });
});

describe("S5 — RAID syncing", () => {
  it("arrayState='clean', syncAction='resync' → WARNING kind:'raid', exit 0", () => {
    const systems = [healthySystem()];
    const devices = [cleanRaid({ arrayState: "clean", syncAction: "resync" })];
    const report = evaluateHealth(systems, devices, DEFAULT_THRESHOLDS);
    expect(report.healthy).toBe(false);
    const issue = report.issues.find((i) => i.kind === "raid");
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe("warn");
    expect(healthExitCode(report)).toBe(0); // warning-only exits 0
  });

  it("syncAction='recover' → WARNING kind:'raid'", () => {
    const systems = [healthySystem()];
    const devices = [cleanRaid({ arrayState: "clean", syncAction: "recover" })];
    const report = evaluateHealth(systems, devices, DEFAULT_THRESHOLDS);
    const issue = report.issues.find((i) => i.kind === "raid");
    expect(issue?.severity).toBe("warn");
    expect(healthExitCode(report)).toBe(0);
  });

  it("syncAction='check' → WARNING kind:'raid'", () => {
    const systems = [healthySystem()];
    const devices = [cleanRaid({ arrayState: "clean", syncAction: "check" })];
    const report = evaluateHealth(systems, devices, DEFAULT_THRESHOLDS);
    const issue = report.issues.find((i) => i.kind === "raid");
    expect(issue?.severity).toBe("warn");
  });

  it("syncAction='repair' → WARNING kind:'raid'", () => {
    const systems = [healthySystem()];
    const devices = [cleanRaid({ arrayState: "clean", syncAction: "repair" })];
    const report = evaluateHealth(systems, devices, DEFAULT_THRESHOLDS);
    const issue = report.issues.find((i) => i.kind === "raid");
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe("warn");
    expect(healthExitCode(report)).toBe(0);
  });

  it("syncAction='reshape' → WARNING kind:'raid'", () => {
    const systems = [healthySystem()];
    const devices = [cleanRaid({ arrayState: "clean", syncAction: "reshape" })];
    const report = evaluateHealth(systems, devices, DEFAULT_THRESHOLDS);
    const issue = report.issues.find((i) => i.kind === "raid");
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe("warn");
    expect(healthExitCode(report)).toBe(0);
  });

  it("arrayState='clean', syncAction='idle' → no raid issue (OK)", () => {
    const systems = [healthySystem()];
    const devices = [cleanRaid({ arrayState: "clean", syncAction: "idle" })];
    const report = evaluateHealth(systems, devices, DEFAULT_THRESHOLDS);
    const raidIssues = report.issues.filter((i) => i.kind === "raid");
    expect(raidIssues).toHaveLength(0);
  });
});

describe("S6 — disk usage warning", () => {
  it("diskPct=92 (> 90 warn, < 95 crit) → WARNING kind:'disk', healthy:false, exit 0", () => {
    const systems = [healthySystem({ diskPct: 92 })];
    const report = evaluateHealth(systems, [], DEFAULT_THRESHOLDS);
    expect(report.healthy).toBe(false);
    const issue = report.issues.find((i) => i.kind === "disk");
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe("warn");
    expect(healthExitCode(report)).toBe(0);
  });

  it("diskPct=96 (> 95 crit) → CRITICAL kind:'disk', exit 1", () => {
    const systems = [healthySystem({ diskPct: 96 })];
    const report = evaluateHealth(systems, [], DEFAULT_THRESHOLDS);
    const issue = report.issues.find((i) => i.kind === "disk");
    expect(issue?.severity).toBe("crit");
    expect(healthExitCode(report)).toBe(1);
  });

  it("diskPct=90 (== warn threshold) → no disk issue (not strictly greater)", () => {
    const systems = [healthySystem({ diskPct: 90 })];
    const report = evaluateHealth(systems, [], DEFAULT_THRESHOLDS);
    const diskIssues = report.issues.filter((i) => i.kind === "disk");
    expect(diskIssues).toHaveLength(0);
  });

  it("diskPct=null → no disk issue", () => {
    const systems = [healthySystem({ diskPct: null })];
    const report = evaluateHealth(systems, [], DEFAULT_THRESHOLDS);
    const diskIssues = report.issues.filter((i) => i.kind === "disk");
    expect(diskIssues).toHaveLength(0);
  });
});

describe("S7 — temperature CRITICAL", () => {
  it("displayTempC=91 (> 90 crit) → CRITICAL kind:'temp', exit 1", () => {
    const systems = [healthySystem({ displayTempC: 91 })];
    const report = evaluateHealth(systems, [], DEFAULT_THRESHOLDS);
    expect(report.healthy).toBe(false);
    const issue = report.issues.find((i) => i.kind === "temp");
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe("crit");
    expect(healthExitCode(report)).toBe(1);
  });

  it("displayTempC=82 (> 80 warn, < 90 crit) → WARNING kind:'temp', exit 0", () => {
    const systems = [healthySystem({ displayTempC: 82 })];
    const report = evaluateHealth(systems, [], DEFAULT_THRESHOLDS);
    const issue = report.issues.find((i) => i.kind === "temp");
    expect(issue?.severity).toBe("warn");
    expect(healthExitCode(report)).toBe(0);
  });

  it("sensor temp > 90 in sensors map → CRITICAL kind:'temp'", () => {
    const systems = [
      healthySystem({ displayTempC: 50, sensors: { cpu_thermal: 95 } }),
    ];
    const report = evaluateHealth(systems, [], DEFAULT_THRESHOLDS);
    const issue = report.issues.find((i) => i.kind === "temp" && i.detail.includes("cpu_thermal"));
    expect(issue?.severity).toBe("crit");
    expect(healthExitCode(report)).toBe(1);
  });

  it("disk temp (smart device) > 65 → CRITICAL kind:'temp'", () => {
    const systems = [healthySystem()];
    const devices = [passedDisk({ tempC: 70 })];
    const report = evaluateHealth(systems, devices, DEFAULT_THRESHOLDS);
    const issue = report.issues.find((i) => i.kind === "temp");
    expect(issue?.severity).toBe("crit");
    expect(healthExitCode(report)).toBe(1);
  });

  it("disk temp (smart device) between 55 and 65 → WARNING kind:'temp'", () => {
    const systems = [healthySystem()];
    const devices = [passedDisk({ tempC: 60 })];
    const report = evaluateHealth(systems, devices, DEFAULT_THRESHOLDS);
    const issue = report.issues.find((i) => i.kind === "temp");
    expect(issue?.severity).toBe("warn");
    expect(healthExitCode(report)).toBe(0);
  });
});

describe("S8 — --strict promotes all warnings to critical", () => {
  it("disk usage 92% (warning) → CRITICAL with --strict, exit 1", () => {
    const strictThresholds = resolveThresholds({ strict: true }, {});
    const systems = [healthySystem({ diskPct: 92 })];
    const report = evaluateHealth(systems, [], strictThresholds);
    expect(report.healthy).toBe(false);
    const issue = report.issues.find((i) => i.kind === "disk");
    expect(issue?.severity).toBe("crit");
    expect(healthExitCode(report)).toBe(1);
  });

  it("RAID resync (warning) → CRITICAL with --strict", () => {
    const strictThresholds = resolveThresholds({ strict: true }, {});
    const systems = [healthySystem()];
    const devices = [cleanRaid({ arrayState: "clean", syncAction: "resync" })];
    const report = evaluateHealth(systems, devices, strictThresholds);
    const issue = report.issues.find((i) => i.kind === "raid");
    expect(issue?.severity).toBe("crit");
    expect(healthExitCode(report)).toBe(1);
  });

  it("healthy fleet with --strict → still healthy, exit 0", () => {
    const strictThresholds = resolveThresholds({ strict: true }, {});
    const systems = [healthySystem()];
    const devices = [cleanRaid(), passedDisk()];
    const report = evaluateHealth(systems, devices, strictThresholds);
    expect(report.healthy).toBe(true);
    expect(healthExitCode(report)).toBe(0);
  });
});

describe("S9 — custom threshold via flag", () => {
  it("--disk-warn 85: diskPct=87 triggers WARNING", () => {
    const customThresholds = resolveThresholds({ diskWarn: 85 }, {});
    const systems = [healthySystem({ diskPct: 87 })];
    const report = evaluateHealth(systems, [], customThresholds);
    const issue = report.issues.find((i) => i.kind === "disk");
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe("warn");
  });

  it("--disk-warn 85 --disk-crit 88: diskPct=89 triggers CRITICAL", () => {
    const customThresholds = resolveThresholds({ diskWarn: 85, diskCrit: 88 }, {});
    const systems = [healthySystem({ diskPct: 89 })];
    const report = evaluateHealth(systems, [], customThresholds);
    const issue = report.issues.find((i) => i.kind === "disk");
    expect(issue?.severity).toBe("crit");
    expect(healthExitCode(report)).toBe(1);
  });

  it("--temp-crit 100: displayTempC=91 stays below crit, triggers WARNING only", () => {
    const customThresholds = resolveThresholds({ tempCrit: 100 }, {});
    const systems = [healthySystem({ displayTempC: 91 })];
    const report = evaluateHealth(systems, [], customThresholds);
    const issue = report.issues.find((i) => i.kind === "temp");
    // tempCrit=100, tempWarn=80 (default), displayTempC=91 → between warn and crit → WARNING
    expect(issue?.severity).toBe("warn");
    expect(healthExitCode(report)).toBe(0);
  });
});

describe("healthExitCode", () => {
  it("returns 1 when any CRITICAL issue exists", () => {
    const report = evaluateHealth(
      [healthySystem({ status: "down" })],
      [],
      DEFAULT_THRESHOLDS,
    );
    expect(healthExitCode(report)).toBe(1);
  });

  it("returns 0 for warning-only fleet", () => {
    const report = evaluateHealth(
      [healthySystem({ diskPct: 92 })],
      [],
      DEFAULT_THRESHOLDS,
    );
    expect(healthExitCode(report)).toBe(0);
  });

  it("returns 0 for fully healthy fleet", () => {
    const report = evaluateHealth(
      [healthySystem()],
      [],
      DEFAULT_THRESHOLDS,
    );
    expect(healthExitCode(report)).toBe(0);
  });
});
